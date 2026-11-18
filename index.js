/**
 * 🎮 Gaming News Auto-Publisher Bot
 */

const cron = require("node-cron");
const { scrapeLatestNews } = require("./src/scraper");
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

// --once flag: run only once (for GitHub Actions)
const RUN_ONCE = process.argv.includes("--once");

// ─── Publishing behavior (configurable via .env) ──────────────────
// Max distinct articles that achieve >=1 successful platform publish in this cycle
const MAX_POSTS_PER_CYCLE = parseInt(process.env.MAX_POSTS_PER_CYCLE || "2", 10);
// Per-platform failed publish attempts before giving up on that platform
const MAX_PUBLISH_ATTEMPTS = parseInt(process.env.MAX_PUBLISH_ATTEMPTS || "3", 10);
// Delay between publish actions (milliseconds)
const POST_DELAY_MS = parseInt(process.env.POST_DELAY_MS || "5000", 10);

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

    const articles = await scrapeLatestNews();
    logger.info(`📰 Found ${articles.length} articles`);

    let articlesWithSuccess = 0;

    for (const article of articles) {
      if (articlesWithSuccess >= MAX_POSTS_PER_CYCLE) {
        logger.info(
          `⏳ Cycle limit reached (${MAX_POSTS_PER_CYCLE} articles with >=1 successful publish) — deferring remaining articles`,
        );
        break;
      }

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

(async () => {
  await initDB();
  logger.info(`🚀 Bot running (Mode: ${RUN_ONCE ? "Once" : "Cron"})`);

  await runBot();

  if (RUN_ONCE) {
    logger.info("✅ Run finished — GitHub Actions mode");
    closeDB();
    process.exit(0);
  }

  cron.schedule("*/15 * * * *", runBot);
  logger.info("⏰ Cron scheduled every 15 minutes...");
})();