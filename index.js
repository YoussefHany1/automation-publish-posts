/**
 * 🎮 Gaming News Auto-Publisher Bot
 */

const cron = require("node-cron");
const { scrapeLatestNews }  = require("./src/scraper");
const { generateCaption }   = require("./src/ai");
const { publishToFacebook } = require("./src/facebook");
// const { publishToInstagram }= require("./src/instagram");
const { isPublished, markAsPublished, initDB } = require("./src/db");
const logger = require("./src/logger");

// --once flag: تشغيل مرة واحدة فقط (لـ GitHub Actions)
const RUN_ONCE = process.argv.includes("--once");

async function processArticle(article) {
  const { title, summary, link, image } = article;
  logger.info(`🔍 New article: ${title}`);

  const caption = await generateCaption({ title, summary, link });
  logger.info(`✍️  Caption:\n${caption}`);

  const results = { facebook: false, instagram: false };

  try {
    await publishToFacebook({ caption, imageUrl: image, link });
    results.facebook = true;
    logger.info("✅ Published on Facebook");
  } catch (err) {
    logger.error(`❌ Facebook error: ${err.message}`);
  }

  // try {
  //   await publishToInstagram({ caption, imageUrl: image });
  //   results.instagram = true;
  //   logger.info("✅ Published on Instagram");
  // } catch (err) {
  //   logger.error(`❌ Instagram error: ${err.message}`);
  // }

  await markAsPublished(link, { title, caption, ...results });
  logger.info(`💾 Saved: ${link}`);
}

async function runBot() {
  logger.info("🤖 Bot started a new checking cycle...");
  try {
    const articles = await scrapeLatestNews();
    logger.info(`📰 Found ${articles.length} articles`);

    for (const article of articles) {
      if (await isPublished(article.link)) {
        logger.debug(`⏭️  Skipping duplicate: ${article.link}`);
        continue;
      }
      await processArticle(article);
      await new Promise((r) => setTimeout(r, 5000));
    }
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
    process.exit(0);
  }

  cron.schedule("*/15 * * * *", runBot);
  logger.info("⏰ Cron scheduled every 15 minutes...");
})();