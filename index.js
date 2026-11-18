/**
 * 🎮 Gaming News Auto-Publisher Bot
 */

const cron = require("node-cron");
const { scrapeLatestNews }  = require("./src/scraper");
const { generateCaption }   = require("./src/ai");
const { generateNewsImage } = require("./src/imageGenerator");
const { publishToFacebook } = require("./src/facebook");
// const { publishToInstagram }= require("./src/instagram");
const {
  isPublished,
  markAsPublished,
  getAttempts,
  recordFailure,
  clearAttempts,
  initDB,
  closeDB,
} = require("./src/db");
const logger = require("./src/logger");

// --once flag: run only once (for GitHub Actions)
const RUN_ONCE = process.argv.includes("--once");

// ─── Publishing behavior (configurable via .env) ──────────────────
// Max successful posts per cycle (remaining are deferred to the next cycle)
const MAX_POSTS_PER_CYCLE = parseInt(process.env.MAX_POSTS_PER_CYCLE || "2", 10);
// After this many failed publish attempts the article is skipped permanently
const MAX_PUBLISH_ATTEMPTS = parseInt(process.env.MAX_PUBLISH_ATTEMPTS || "3", 10);
// Delay between posts within a cycle (milliseconds)
const POST_DELAY_MS = parseInt(process.env.POST_DELAY_MS || "5000", 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Processes a single article and attempts to publish it.
 * @returns {Promise<boolean>} true only if published on at least one platform
 */
async function processArticle(article) {
  const { title, summary, link, image } = article;
  logger.info(`🔍 New article: ${title}`);

  let result;
  try {
    result = await generateCaption({ title, summary, link });
  } catch (err) {
    // Caption generation failure is transient (AI providers) — not counted as a publish failure
    logger.error(`❌ Caption generation failed: ${err.message}`);
    return false;
  }

  // Image headline (must include the game name) + post caption (no headline duplication)
  const headline = (result.headline || title || "").trim();
  let postedCaption = (result.caption || "").trim();
  if (!postedCaption) postedCaption = summary || headline;

  logger.info(`✍️  Headline: ${headline}`);
  logger.info(`✍️  Caption:\n${postedCaption}`);

  let imageBuffer = null;
  try {
    imageBuffer = await generateNewsImage({
      imageUrl: image,
      titleText: headline,
    });
    logger.info("🎨 Image generated successfully");
  } catch (err) {
    logger.warn(`⚠️ Failed to generate image: ${err.message}`);
  }

  const results = { facebook: false, instagram: false };
  const errors = [];

  try {
    await publishToFacebook({ caption: postedCaption, imageBuffer, imageUrl: image, link });
    results.facebook = true;
    logger.info("✅ Published on Facebook");
  } catch (err) {
    logger.error(`❌ Facebook error: ${err.message}`);
    errors.push(`Facebook: ${err.message}`);
  }

  // try {
  //   await publishToInstagram({ caption, imageUrl: image });
  //   results.instagram = true;
  //   logger.info("✅ Published on Instagram");
  // } catch (err) {
  //   logger.error(`❌ Instagram error: ${err.message}`);
  //   errors.push(`Instagram: ${err.message}`);
  // }

  // ─── Only save to the database after an actual successful publish ───
  if (results.facebook || results.instagram) {
    await markAsPublished(link, { title, caption: postedCaption, ...results });
    await clearAttempts(link);
    logger.info(`💾 Saved: ${link}`);
    return true;
  }

  // Publish failed on all platforms — record the attempt and retry later
  const attempts = await recordFailure(link, errors.join(" | "));
  logger.warn(
    `⚠️  Publish failed on all platforms (attempt ${attempts}/${MAX_PUBLISH_ATTEMPTS}) — not saved, will retry: ${link}`,
  );
  return false;
}

async function runBot() {
  logger.info("🤖 Bot started a new checking cycle...");
  try {
    const articles = await scrapeLatestNews();
    logger.info(`📰 Found ${articles.length} articles`);

    let posted = 0;

    for (const article of articles) {
      // Reached the per-cycle publish limit — defer remaining articles to the next cycle
      if (posted >= MAX_POSTS_PER_CYCLE) {
        logger.info(
          `⏳ Cycle limit reached (${MAX_POSTS_PER_CYCLE}) — deferring remaining articles to next cycle`,
        );
        break;
      }

      if (await isPublished(article.link)) {
        logger.debug(`⏭️  Skipping duplicate: ${article.link}`);
        continue;
      }

      // Article exceeded the failed-attempt limit — skip it permanently
      const attempts = await getAttempts(article.link);
      if (attempts >= MAX_PUBLISH_ATTEMPTS) {
        logger.warn(
          `🚫 Skipping after ${attempts} failed attempts: ${article.link}`,
        );
        continue;
      }

      const ok = await processArticle(article);
      if (ok) posted++;

      await sleep(POST_DELAY_MS);
    }

    logger.info(`📤 Posted ${posted}/${MAX_POSTS_PER_CYCLE} this cycle`);
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