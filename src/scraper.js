/**
 * 📰 scraper.js
 * ─────────────
 * Fetches gaming news. Supports:
 *  - RSS/Atom Feeds (direct)
 *  - Fallback to rss2json (to bypass Cloudflare protection on Destructoid)
 *  - HTML scraping (for sites that allow it)
 */
const axios = require("axios");
const cheerio = require("cheerio");
const logger = require("./logger");

const TARGET_URL = process.env.TARGET_URL || "https://www.destructoid.com/category/news/";
const MAX_ARTICLES = parseInt(process.env.MAX_ARTICLES || "10", 10);
const DETAIL_FETCH_CONCURRENCY = Math.max(1, parseInt(process.env.DETAIL_FETCH_CONCURRENCY || "4", 10));

// Headers that mimic a real browser
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Cache-Control": "no-cache",
};

async function mapWithConcurrency(items, limit, mapper) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, list.length || 1) }, async () => {
    while (true) {
      const i = index++;
      if (i >= list.length) break;
      results[i] = await mapper(list[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Helpers ─────────────────────────────────────────────
function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractImage(html) {
  if (!html) return null;
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!m) return null;
  let url = m[1];
  if (url.includes("?")) url = url.split("?")[0];
  return url;
}

function cleanImageUrl(url) {
  if (!url) return null;
  let u = String(url).trim();
  if (u.includes("?")) u = u.split("?")[0];
  return u || null;
}

// ─── fetchArticleDetails (HTML sites) ────────────────────
async function fetchArticleDetails(articleUrl) {
  try {
    const { data } = await axios.get(articleUrl, {
      headers: HEADERS,
      timeout: 10000,
    });
    const $ = cheerio.load(data);

    let image =
      $('meta[property="og:image"]').attr("content") ||
      $(".article-content img").first().attr("src") ||
      $("article img").first().attr("src") ||
      null;

    if (image && image.includes("?")) image = image.split("?")[0];

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

// ─── HTML scraping (original Destructoid selectors) ──────
function scrapeHtml(html) {
  const $ = cheerio.load(html);
  const articles = [];

  const articleCards = $(
    "article.article-card, .c-entry-card, article[class*='post']",
  );
  const cards =
    articleCards.length > 0 ? articleCards : $("article");

  // Process synchronously-collect first, then fetch details
  const collected = [];
  cards.slice(0, MAX_ARTICLES).each((_, el) => {
    const card = $(el);
    const title = (card.find("h1, h2, h3, .c-entry-card__title").first().text() || "").trim();
    if (!title) return;
    const href =
      card.find("a").first().attr("href") ||
      card.closest("a").attr("href") ||
      "";
    if (!href || !href.startsWith("http")) return;
    const thumbImage =
      card.find("img").first().attr("src") ||
      card.find("img").first().attr("data-src") ||
      null;
    collected.push({ title, href, thumbImage });
  });

  // We'll fetch details lazily; store placeholders
  for (const c of collected) {
    articles.push({
      title: c.title,
      summary: "",
      link: c.href,
      image: c.thumbImage,
      _needsDetails: true,
    });
  }
  return articles;
}

function needsEnrichment(article) {
  return !article || !article.image || !article.summary;
}

async function enrichArticles(articles, options = {}) {
  const list = Array.isArray(articles) ? articles : [];
  const concurrency = Math.max(1, options.concurrency || DETAIL_FETCH_CONCURRENCY);
  const shouldEnrich = typeof options.shouldEnrich === "function" ? options.shouldEnrich : needsEnrichment;

  return mapWithConcurrency(list, concurrency, async (art) => {
    if (!art) return art;
    const { _needsDetails, ...rest } = art;
    if (!shouldEnrich(rest, art)) return rest;

    const details = await fetchArticleDetails(rest.link);
    return {
      title: rest.title,
      summary: details.summary || rest.summary || "",
      link: rest.link,
      image: rest.image || details.image || null,
    };
  });
}

// ─── RSS XML parsing ─────────────────────────────────────
function parseRssXml(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];

  $("item").each((_, el) => {
    const item = $(el);
    const title = item.find("title").first().text().trim();
    // link may be text node
    let link = item.find("link").first().text().trim();
    if (!link) {
      // sometimes link is next sibling text
      const linkNode = item.find("link");
      if (linkNode.length) link = linkNode.text().trim();
    }
    if (!link) link = item.find("guid").first().text().trim();

    const desc = item.find("description").first().text();
    // content:encoded (namespaced)
    let content = "";
    item.children().each((_, child) => {
      const name = (child.name || "").toLowerCase();
      if (name === "content:encoded" || name === "encoded" || name.endsWith("encoded")) {
        content = $(child).text();
      }
    });
    if (!content) {
      // try cheerio find with escaped colon
      try {
        content = item.find("content\\:encoded").first().text();
      } catch (e) {}
    }

    const html = content || desc;
    let image =
      item.find("enclosure").attr("url") ||
      null;
    if (!image) {
      // media:content / media:thumbnail
      item.children().each((_, child) => {
        const name = (child.name || "").toLowerCase();
        if ((name.includes("content") || name.includes("thumbnail")) && !image) {
          const url = $(child).attr("url") || $(child).attr("href");
          if (url) image = url;
        }
      });
    }
    if (!image) image = extractImage(html);
    image = cleanImageUrl(image);

    const summary = stripHtml(desc || content).slice(0, 500);

    if (title && link) {
      items.push({ title, summary, link, image });
    }
  });

  // Atom feeds
  if (items.length === 0) {
    $("entry").each((_, el) => {
      const entry = $(el);
      const title = entry.find("title").first().text().trim();
      let link = entry.find("link").attr("href") || entry.find("link").first().text().trim();
      const desc = entry.find("summary").first().text() || entry.find("content").first().text();
      const image = extractImage(desc);
      if (title && link) items.push({ title, summary: stripHtml(desc).slice(0, 500), link, image });
    });
  }

  return items;
}

// ─── rss2json parsing ────────────────────────────────────
function fromRssJson(items) {
  return (items || []).map((it) => {
    const html = it.content || it.description || "";
    const image = cleanImageUrl(it.thumbnail || extractImage(html));
    const summarySource = it.description || it.content || "";
    const summary = stripHtml(summarySource).slice(0, 500);
    return {
      title: String(it.title || "").trim(),
      summary,
      link: it.link,
      image,
    };
  }).filter((a) => a.title && a.link);
}

async function tryRss2Json(feedUrl) {
  try {
    const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feedUrl)}`;
    const { data } = await axios.get(apiUrl, { timeout: 20000 });
    if (data && data.status === "ok" && Array.isArray(data.items)) {
      return fromRssJson(data.items);
    }
    logger.warn(`rss2json failed: ${data?.message || "unknown"}`);
  } catch (err) {
    logger.warn(`rss2json error: ${err.message}`);
  }
  return null;
}

// ─── Direct fetch ────────────────────────────────────────
async function tryDirect(url, options = {}) {
  const { enrich = true, enrichConcurrency = DETAIL_FETCH_CONCURRENCY } = options;
  try {
    const { data } = await axios.get(url, {
      headers: HEADERS,
      timeout: 15000,
      responseType: "text",
    });
    if (typeof data !== "string") return null;

    // Cloudflare challenge?
    if (/Just a moment|Performing security verification|Enable JavaScript and cookies/i.test(data)) {
      logger.warn("🛡️  Cloudflare challenge detected — will try fallback");
      return null;
    }

    // RSS/Atom?
    if (/<rss|<feed/i.test(data)) {
      const parsed = parseRssXml(data);
      if (parsed && parsed.length) return parsed;
      return null;
    }

    // HTML scraping
    const scraped = scrapeHtml(data);
    if (!enrich) {
      return scraped.map(({ _needsDetails, ...rest }) => rest);
    }
    return enrichArticles(scraped, { concurrency: enrichConcurrency, shouldEnrich: () => true });
  } catch (err) {
    logger.warn(`Direct fetch failed: ${err.message}`);
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────
async function scrapeLatestNews(options = {}) {
  const { enrich = true, enrichConcurrency = DETAIL_FETCH_CONCURRENCY } = options;
  logger.info(`🌐 Fetching: ${TARGET_URL}`);

  const isDestructoid = /destructoid\.com/i.test(TARGET_URL);
  const isInsiderGaming = /insider-gaming\.com/i.test(TARGET_URL);
  // These feeds are protected/blocked for direct fetch; use rss2json
  const skipDirect = isDestructoid || isInsiderGaming;

  // Destructoid category pages are behind Cloudflare; use main feed instead
  const feedUrl = isDestructoid ? "https://www.destructoid.com/feed/" : TARGET_URL;

  let articles = null;
  if (!skipDirect) {
    articles = await tryDirect(feedUrl, { enrich, enrichConcurrency });
  }

  if (!articles || articles.length === 0) {
    if (!skipDirect) logger.info("🔄 Trying rss2json fallback...");
    articles = await tryRss2Json(feedUrl);
  }

  // If still nothing and feedUrl != TARGET_URL, try original target
  if ((!articles || articles.length === 0) && feedUrl !== TARGET_URL) {
    articles = await tryDirect(TARGET_URL, { enrich, enrichConcurrency });
  }

  // Enrich missing images/summaries by fetching article pages
  // (works for accessible sites like insider-gaming; skipped for Destructoid)
  if (enrich && !isDestructoid && Array.isArray(articles)) {
    articles = await enrichArticles(articles, { concurrency: enrichConcurrency });
  }

  articles = (articles || []).slice(0, MAX_ARTICLES);

  // Ensure no _needsDetails leak
  articles = articles.map(({ _needsDetails, ...rest }) => rest);

  logger.info(`✅ Extracted ${articles.length} articles`);
  return articles;
}

module.exports = { scrapeLatestNews, fetchArticleDetails, enrichArticles };