/**
 * 🎮 Gaming News Auto-Publisher Bot
 */

const cron = require("node-cron");
const { scrapeLatestNews, enrichArticles } = require("./src/scraper");
const { generateContent } = require("./src/ai");
const { generateNewsImage } = require("./src/imageGenerator");
const { publishToFacebook } = require("./src/facebook");
const { publishToInstagram } = require("./src/instagram");
const { uploadImageBuffer } = require("./src/cloudinary");
const {
  initDB,
  closeDB,
  getArticleStatus,
  markPlatformPublished,
  getPlatformAttempts,
  recordPlatformFailure,
  clearPlatformAttempts,
} = require("./src/db");
const logger = require("./src/logger");

const DETAIL_FETCH_CONCURRENCY = Math.max(1, parseInt(process.env.DETAIL_FETCH_CONCURRENCY || "4", 10));

// --once flag: run only once (for GitHub Actions)
const RUN_ONCE = process.argv.includes("--once");

// ─── Publishing behavior (configurable via .env) ──────────────────
// Max distinct articles that achieve >=1 successful platform publish in this cycle
const MAX_POSTS_PER_CYCLE = parseInt(process.env.MAX_POSTS_PER_CYCLE || "2", 10);
// Per-platform failed publish attempts before giving up on that platform
const MAX_PUBLISH_ATTEMPTS = parseInt(process.env.MAX_PUBLISH_ATTEMPTS || "3", 10);
// Delay between publish actions (milliseconds)
const POST_DELAY_MS = parseInt(process.env.POST_DELAY_MS || "5000", 10);

// ─── Graceful shutdown state (cron/persistent mode) ──────────────────
let activeRuns = 0;
let shuttingDown = false;
let cronTask = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function truthyEnv(v, defaultValue = true) {
  if (v == null || v === "") return defaultValue;
  return !/^(0|false|no|off)$/i.test(String(v).trim());
}

function getEnabledPlatforms() {
  const fbConfigured = !!(process.env.FACEBOOK_PAGE_ID && process.env.FACEBOOK_PAGE_ACCESS_TOKEN);
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const igConfigured = !!(process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID && igToken);
  const cloudinaryConfigured = !!(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
  );

  const platforms = [];
  if (fbConfigured && truthyEnv(process.env.ENABLE_FACEBOOK, true)) platforms.push("facebook");
  if (igConfigured && cloudinaryConfigured && truthyEnv(process.env.ENABLE_INSTAGRAM, true)) {
    platforms.push("instagram");
  } else if (igConfigured && !cloudinaryConfigured && truthyEnv(process.env.ENABLE_INSTAGRAM, true)) {
    logger.warn("⚠️  Instagram is configured but Cloudinary is missing — Instagram publishing disabled (Option B requires Cloudinary).");
  }

  return platforms;
}

async function getPendingPlatforms(articleUrl, enabledPlatforms) {
  const status = await getArticleStatus(articleUrl);
  const pending = [];
  for (const platform of enabledPlatforms) {
    const ok = platform === "facebook" ? status.fb_ok : status.ig_ok;
    if (ok) continue;
    const attempts = await getPlatformAttempts(articleUrl, platform);
    if (attempts >= MAX_PUBLISH_ATTEMPTS) continue;
    pending.push(platform);
  }
  return { status, pending };
}

function fallbackContent(platform, article) {
  const baseHeadline = String(article.title || "").trim();
  const baseSummary = String(article.summary || "").trim();
  return {
    headline: baseHeadline,
    caption: baseSummary || baseHeadline,
    platform,
  };
}

/**
 * Processes a single article across all pending/enabled platforms.
 * @returns {Promise<{ successCount: number, attempted: boolean }>}
 */
async function processArticle(article, enabledPlatforms) {
  const { title, summary, link, image } = article;
  const { status, pending } = await getPendingPlatforms(link, enabledPlatforms);

  if (pending.length === 0) {
    const anyEnabledOk = enabledPlatforms.some((p) => (p === "facebook" ? status.fb_ok : status.ig_ok));
    const allEnabledDone = enabledPlatforms.every((p) => (p === "facebook" ? status.fb_ok : status.ig_ok));
    if (allEnabledDone) {
      logger.debug(`⏭️  Already published on all enabled platforms: ${link}`);
    } else if (anyEnabledOk) {
      logger.warn(`🚫 No pending platforms left (retries exhausted) for: ${link}`);
    }
    return { successCount: 0, attempted: false };
  }

  logger.info(`🔍 Processing: ${title}`);
  logger.info(`   Pending platforms: ${pending.join(", ")}`);

  // Generate content only for pending platforms
  const contentByPlatform = {};
  for (const platform of pending) {
    try {
      contentByPlatform[platform] = await generateContent({ title, summary, link }, { platform });
    } catch (err) {
      logger.error(`❌ ${platform} content generation failed: ${err.message}`);
      contentByPlatform[platform] = null; // treated as transient; do not count as publish attempt
    }
  }

  // Generate images/upload only for platforms with content
  let fbImageBuffer = null;
  let igImageUrl = null;

  if (pending.includes("facebook") && contentByPlatform.facebook) {
    const fbHeadline = (contentByPlatform.facebook.headline || title || "").trim();
    try {
      fbImageBuffer = await generateNewsImage({ imageUrl: image, titleText: fbHeadline });
      logger.info("🎨 Facebook image generated");
    } catch (err) {
      logger.warn(`⚠️  Failed to generate Facebook image: ${err.message}`);
    }
  }

  if (pending.includes("instagram") && contentByPlatform.instagram) {
    const igHeadline = (contentByPlatform.instagram.headline || title || "").trim();
    try {
      const igBuffer = await generateNewsImage({ imageUrl: image, titleText: igHeadline });
      logger.info("🎨 Instagram image generated");
      const uploaded = await uploadImageBuffer(igBuffer, { articleUrl: link, platform: "instagram" });
      igImageUrl = uploaded.secureUrl;
    } catch (err) {
      logger.error(`❌ Instagram image preparation/upload failed: ${err.message}`);
      igImageUrl = null; // will cause IG attempt to fail below if content exists
    }
  }

  let successCount = 0;
  let attempted = false;

  for (const platform of pending) {
    const content = contentByPlatform[platform];
    if (!content) {
      logger.warn(`⏭️  Skipping ${platform} publish this cycle (content unavailable)`);
      continue;
    }

    const headline = String(content.headline || title || "").trim();
    let caption = String(content.caption || "").trim();
    if (!caption) caption = String(summary || headline).trim();

    if (platform === "facebook") logger.info(`✍️  [FB] Headline: ${headline}`);
    if (platform === "instagram") logger.info(`✍️  [IG] Headline: ${headline}`);
    logger.info(`✍️  [${platform}] Caption:\n${caption}`);

    attempted = true;
    try {
      if (platform === "facebook") {
        await publishToFacebook({ caption, imageBuffer: fbImageBuffer, imageUrl: image, link });
      } else if (platform === "instagram") {
        if (!igImageUrl) throw new Error("No public image URL available for Instagram (Cloudinary upload missing)");
        await publishToInstagram({ caption, imageUrl: igImageUrl });
      }

      await markPlatformPublished(link, platform, { title, headline, caption });
      await clearPlatformAttempts(link, platform);
      successCount++;
      logger.info(`✅ Published on ${platform}`);
    } catch (err) {
      const attempts = await recordPlatformFailure(link, platform, err.message);
      logger.error(`❌ ${platform} publish failed (attempt ${attempts}/${MAX_PUBLISH_ATTEMPTS}): ${err.message}`);
      if (attempts >= MAX_PUBLISH_ATTEMPTS) {
        logger.warn(`🚫 ${platform} reached max attempts for: ${link}`);
      }
    }

    // Delay between publish actions (including between platforms for same article)
    await sleep(POST_DELAY_MS);
  }

  const after = await getArticleStatus(link);
  logger.info(
    `📌 Status ${link} -> facebook=${after.fb_ok ? "ok" : "pending"} instagram=${after.ig_ok ? "ok" : "pending"} (enabled: ${enabledPlatforms.join(",") || "none"})`,
  );

  return { successCount, attempted };
}

async function runBot() {
  logger.info("🤖 Bot started a new checking cycle...");
  try {
    const enabledPlatforms = getEnabledPlatforms();
    if (enabledPlatforms.length === 0) {
      logger.warn("⚠️  No publishing platforms are enabled/configured. Check environment variables.");
      return;
    }
    logger.info(`📣 Enabled platforms: ${enabledPlatforms.join(", ")}`);

    // 1) Scrape cheap metadata (no per-article detail fetches)
    const rawArticles = await scrapeLatestNews({ enrich: false });
    logger.info(`📰 Found ${rawArticles.length} articles (metadata)`);

    // 2) Filter to articles with at least one pending enabled platform
    const candidates = [];
    for (const article of rawArticles) {
      const { status, pending } = await getPendingPlatforms(article.link, enabledPlatforms);
      const allDone = enabledPlatforms.every((p) => (p === "facebook" ? status.fb_ok : status.ig_ok));
      if (allDone) {
        logger.debug(`⏭️  Skipping (done on all enabled platforms): ${article.link}`);
        continue;
      }
      if (pending.length === 0) {
        logger.warn(`🚫 Skipping (no pending platforms / retries exhausted): ${article.link}`);
        continue;
      }
      candidates.push({ ...article, _pending: pending });
    }

    // 3) Bounded concurrent enrichment only for pending candidates missing details
    const toEnrich = candidates.filter((a) => !a.image || !a.summary);
    let enrichedMap = new Map();
    if (toEnrich.length > 0) {
      logger.info(`🔎 Enriching ${toEnrich.length} pending article(s) (concurrency=${DETAIL_FETCH_CONCURRENCY})...`);
      const enriched = await enrichArticles(toEnrich, {
        concurrency: DETAIL_FETCH_CONCURRENCY,
        shouldEnrich: (a) => !a.image || !a.summary,
      });
      enrichedMap = new Map(enriched.map((a) => [a.link, a]));
    }

    const prepared = candidates.map((a) => {
      const e = enrichedMap.get(a.link);
      const merged = e ? { ...a, ...e } : a;
      // Final platform-aware eligibility: IG needs a publishable image URL after prep.
      // Branded image generation can fall back without a source image; Cloudinary upload is validated during processing.
      // FB can fall back (buffer/url/link) per publisher logic. So do not discard solely due to missing source image.
      return merged;
    });

    let articlesWithSuccess = 0;

    for (const article of prepared) {
      if (shuttingDown) {
        logger.info("🛑 Shutdown requested — stopping after current safe point (no new articles).");
        break;
      }

      if (articlesWithSuccess >= MAX_POSTS_PER_CYCLE) {
        logger.info(
          `⏳ Cycle limit reached (${MAX_POSTS_PER_CYCLE} articles with >=1 successful publish) — deferring remaining articles`,
        );
        break;
      }

      // Re-check pending at processing time (state may have changed)
      const { pending } = await getPendingPlatforms(article.link, enabledPlatforms);
      if (pending.length === 0) {
        logger.debug(`⏭️  Skipping (no pending platforms at processing time): ${article.link}`);
        continue;
      }

      const result = await processArticle(article, enabledPlatforms);
      if (result.successCount > 0) {
        articlesWithSuccess++;
      }

      // Small pause between articles to be gentle (publish actions already delayed)
      if (!result.attempted) {
        await sleep(500);
      }
    }

    logger.info(`📤 Cycle summary: ${articlesWithSuccess}/${MAX_POSTS_PER_CYCLE} article(s) had >=1 successful publish`);
  } catch (err) {
    logger.error(`💥 Error in runBot: ${err.message}`);
  }
}

async function guardedRun() {
  if (shuttingDown) return;
  activeRuns++;
  try {
    await runBot();
  } catch (err) {
    logger.error(`💥 Unexpected run error: ${err && err.message ? err.message : err}`);
  } finally {
    activeRuns--;
    if (!RUN_ONCE && shuttingDown && activeRuns === 0) {
      logger.info("🛑 Shutdown: in-flight work finished, closing DB...");
      try { closeDB(); } catch {}
      process.exit(0);
    }
  }
}

function initiateShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`🛑 Received ${signal}, shutting down gracefully...`);
  if (cronTask && typeof cronTask.stop === "function") {
    try {
      cronTask.stop();
    } catch (err) {
      logger.warn(`Failed to stop cron task: ${err.message}`);
    }
  }
  if (RUN_ONCE) {
    // In --once mode, let the guarded run finish and the normal once-exit path handle cleanup.
    logger.info("⏳ Waiting for current run to complete (--once mode)...");
    return;
  }
  if (activeRuns === 0) {
    closeDB();
    process.exit(0);
  } else {
    logger.info("⏳ Waiting for in-flight run to complete before exit...");
  }
}

process.on("SIGINT", () => initiateShutdown("SIGINT"));
process.on("SIGTERM", () => initiateShutdown("SIGTERM"));
process.on("SIGQUIT", () => initiateShutdown("SIGQUIT"));

(async () => {
  let fatal = null;
  try {
    await initDB();
    logger.info(`🚀 Bot running (Mode: ${RUN_ONCE ? "Once" : "Cron"})`);
    await guardedRun();
  } catch (err) {
    fatal = err;
    logger.error(`💥 Fatal error: ${err && err.message ? err.message : err}`);
  }

  if (RUN_ONCE) {
    logger.info("✅ Run finished — GitHub Actions mode");
    try {
      closeDB();
    } catch (e) {
      logger.error(`Failed to close DB: ${e.message}`);
    }
    process.exit(fatal ? 1 : 0);
  }

  if (fatal) {
    try {
      closeDB();
    } catch {}
    process.exit(1);
  }

  cronTask = cron.schedule("*/15 * * * *", guardedRun);
  logger.info("⏰ Cron scheduled every 15 minutes...");
})();