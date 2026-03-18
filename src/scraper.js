/**
 * 📰 scraper.js
 * ─────────────
 * يجلب صفحة Destructoid/news ويستخرج المقالات باستخدام Cheerio.
 * لا يحتاج API key — مجاني بالكامل.
 */

const axios = require("axios");
const cheerio = require("cheerio");
const logger = require("./logger");

const TARGET_URL =
  process.env.TARGET_URL || "https://www.destructoid.com/category/news/";
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES || "10", 10);

// Headers تحاكي متصفح حقيقي لتجنّب الحجب
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Cache-Control": "no-cache",
};

/**
 * يجلب تفاصيل المقال الكاملة (صورة + ملخص) من صفحته المباشرة.
 * @param {string} articleUrl
 */
async function fetchArticleDetails(articleUrl) {
  try {
    const { data } = await axios.get(articleUrl, {
      headers: HEADERS,
      timeout: 10000,
    });
    const $ = cheerio.load(data);

    // ─── الصورة الرئيسية ──────────────────────────────
    let image =
      $('meta[property="og:image"]').attr("content") ||
      $(".article-content img").first().attr("src") ||
      $("article img").first().attr("src") ||
      null;

    // نظّف الـ URL من أي query params للحجم
    if (image && image.includes("?")) {
      image = image.split("?")[0];
    }

    // ─── الملخص ───────────────────────────────────────
    const summary =
      $('meta[property="og:description"]').attr("content") ||
      $('meta[name="description"]').attr("content") ||
      $(".article-content p").first().text().trim() ||
      "";

    return { image, summary: summary.slice(0, 500) };
  } catch (err) {
    logger.warn(`⚠️  Failed to fetch details: ${articleUrl} — ${err.message}`);
    return { image: null, summary: "" };
  }
}

/**
 * يجلب قائمة المقالات من صفحة الأخبار الرئيسية.
 * @returns {Promise<Array<{title, summary, link, image}>>}
 */
async function scrapeLatestNews() {
  logger.info(`🌐 Fetching: ${TARGET_URL}`);

  const { data } = await axios.get(TARGET_URL, {
    headers: HEADERS,
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const articles = [];

  // ─── محدّدات CSS الخاصة بـ Destructoid ──────────────
  // الموقع يستخدم بطاقات مقالات بهذه الـ selectors
  const articleCards = $(
    "article.article-card, .c-entry-card, article[class*='post']"
  ).slice(0, MAX_ARTICLES);

  logger.debug(`🔎 Cards found in DOM: ${articleCards.length}`);

  // Fallback: إذا لم تُطابق السيليكتور
  const cards =
    articleCards.length > 0
      ? articleCards
      : $("article").slice(0, MAX_ARTICLES);

  for (const el of cards.toArray()) {
    try {
      const card = $(el);

      // ─── العنوان ──────────────────────────────────────
      const title = (
        card.find("h1, h2, h3, .c-entry-card__title").first().text() || ""
      ).trim();

      if (!title) continue;

      // ─── الرابط ───────────────────────────────────────
      const href =
        card.find("a").first().attr("href") ||
        card.closest("a").attr("href") ||
        "";
      if (!href || !href.startsWith("http")) continue;

      // ─── صورة مصغّرة (من البطاقة مباشرةً) ──────────────
      const thumbImage =
        card.find("img").first().attr("src") ||
        card.find("img").first().attr("data-src") ||
        null;

      // ─── جلب التفاصيل من صفحة المقال ────────────────
      const { image: detailImage, summary } = await fetchArticleDetails(href);

      const image = detailImage || thumbImage;

      if (!image) {
        logger.warn(`🚫 No image for article: ${title}`);
      }

      articles.push({
        title,
        summary,
        link: href,
        image,
      });
    } catch (err) {
      logger.warn(`⚠️  Error processing card: ${err.message}`);
    }
  }

  logger.info(`✅ Extracted ${articles.length} articles`);
  return articles;
}

module.exports = { scrapeLatestNews };
