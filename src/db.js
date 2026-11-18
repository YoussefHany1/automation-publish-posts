/**
 * 💾 db.js
 * ─────────
 * Lightweight SQLite database for storing published links
 * and avoiding duplicates — free and serverless.
 */

const Database = require("better-sqlite3");
const path = require("path");
const logger = require("./logger");

const DB_PATH = path.join(__dirname, "..", "data", "published.db");
let db;

function assertDB() {
  if (!db) throw new Error("DB is not initialized — call initDB() first");
}

function tableHasColumn(table, column) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === column);
}

/**
 * Initializes the database and runs lightweight migrations.
 */
async function initDB() {
  const { mkdirSync } = require("fs");
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS published_articles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT    NOT NULL UNIQUE,
      title       TEXT,
      caption     TEXT,
      headline_fb TEXT,
      caption_fb  TEXT,
      headline_ig TEXT,
      caption_ig  TEXT,
      fb_ok       INTEGER DEFAULT 0,
      ig_ok       INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_url ON published_articles(url);

    -- Per-platform failed publish attempts (independent retries)
    CREATE TABLE IF NOT EXISTS publish_attempts (
      url         TEXT    NOT NULL,
      platform    TEXT    NOT NULL,
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (url, platform)
    );
  `);

  // Migrate existing published_articles rows (add bilingual columns)
  const articleCols = [
    ["headline_fb", "TEXT"],
    ["caption_fb", "TEXT"],
    ["headline_ig", "TEXT"],
    ["caption_ig", "TEXT"],
  ];
  for (const [col, type] of articleCols) {
    if (!tableHasColumn("published_articles", col)) {
      db.exec(`ALTER TABLE published_articles ADD COLUMN ${col} ${type}`);
    }
  }

  // Backfill fb caption/headline from legacy columns when possible
  if (tableHasColumn("published_articles", "caption")) {
    db.exec(`
      UPDATE published_articles
      SET caption_fb = COALESCE(NULLIF(caption_fb, ''), caption)
      WHERE caption IS NOT NULL AND caption != '' AND (caption_fb IS NULL OR caption_fb = '');
    `);
  }

  // Migrate legacy global attempts -> per-platform (facebook) to preserve backoff history
  const legacy = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='article_attempts'",
    )
    .get();
  if (legacy) {
    try {
      const rows = db
        .prepare("SELECT url, attempts, last_error, updated_at FROM article_attempts")
        .all();
      const insert = db.prepare(`
        INSERT OR IGNORE INTO publish_attempts (url, platform, attempts, last_error, updated_at)
        VALUES (?, 'facebook', ?, ?, ?)
      `);
      const migrate = db.transaction((items) => {
        for (const r of items) insert.run(r.url, r.attempts || 0, r.last_error || null, r.updated_at || null);
      });
      migrate(rows);
      db.exec("DROP TABLE IF EXISTS article_attempts");
      if (rows.length) logger.info(`💾 Migrated ${rows.length} legacy attempt records to per-platform tracking`);
    } catch (err) {
      logger.warn(`Legacy attempts migration skipped: ${err.message}`);
    }
  }

  logger.info(`💾 DB ready: ${DB_PATH}`);
}

/**
 * Returns per-platform publish status for an article URL.
 */
async function getArticleStatus(url) {
  assertDB();
  const row = db
    .prepare(
      `SELECT url, title, headline_fb, caption_fb, headline_ig, caption_ig, fb_ok, ig_ok, created_at
       FROM published_articles WHERE url = ?`,
    )
    .get(url);
  if (!row) {
    return {
      exists: false,
      fb_ok: false,
      ig_ok: false,
      title: "",
      headline_fb: "",
      caption_fb: "",
      headline_ig: "",
      caption_ig: "",
    };
  }
  return {
    exists: true,
    fb_ok: !!row.fb_ok,
    ig_ok: !!row.ig_ok,
    title: row.title || "",
    headline_fb: row.headline_fb || "",
    caption_fb: row.caption_fb || row.caption || "",
    headline_ig: row.headline_ig || "",
    caption_ig: row.caption_ig || "",
    created_at: row.created_at,
  };
}

/**
 * Legacy helper: true if an article row exists.
 * Prefer getArticleStatus() for per-platform decisions.
 */
async function isPublished(url) {
  const status = await getArticleStatus(url);
  return status.exists;
}

function ensureArticleRow(url, title = "") {
  assertDB();
  db.prepare(
    `INSERT INTO published_articles (url, title, caption, fb_ok, ig_ok)
     VALUES (?, ?, '', 0, 0)
     ON CONFLICT(url) DO UPDATE SET title = CASE WHEN excluded.title != '' THEN excluded.title ELSE published_articles.title END`,
  ).run(url, title || "");
}

/**
 * Marks a single platform as successfully published and stores its content.
 * @param {string} url
 * @param {'facebook'|'instagram'} platform
 * @param {{ title?: string, headline?: string, caption?: string }} meta
 */
async function markPlatformPublished(url, platform, meta = {}) {
  assertDB();
  ensureArticleRow(url, meta.title || "");
  const headline = meta.headline || "";
  const caption = meta.caption || "";
  if (platform === "facebook") {
    db.prepare(
      `UPDATE published_articles
       SET fb_ok = 1,
           headline_fb = CASE WHEN ? != '' THEN ? ELSE headline_fb END,
           caption_fb = CASE WHEN ? != '' THEN ? ELSE caption_fb END,
           caption = CASE WHEN ? != '' THEN ? ELSE caption END,
           title = CASE WHEN ? != '' THEN ? ELSE title END
       WHERE url = ?`,
    ).run(headline, headline, caption, caption, caption, caption, meta.title || "", meta.title || "", url);
  } else if (platform === "instagram") {
    db.prepare(
      `UPDATE published_articles
       SET ig_ok = 1,
           headline_ig = CASE WHEN ? != '' THEN ? ELSE headline_ig END,
           caption_ig = CASE WHEN ? != '' THEN ? ELSE caption_ig END,
           title = CASE WHEN ? != '' THEN ? ELSE title END
       WHERE url = ?`,
    ).run(headline, headline, caption, caption, meta.title || "", meta.title || "", url);
  } else {
    throw new Error(`Unknown platform: ${platform}`);
  }
}

/**
 * Legacy wrapper for compatibility.
 */
async function markAsPublished(url, meta = {}) {
  if (meta.facebook) {
    await markPlatformPublished(url, "facebook", {
      title: meta.title,
      headline: meta.headline_fb || meta.headline || "",
      caption: meta.caption_fb || meta.caption || "",
    });
  }
  if (meta.instagram) {
    await markPlatformPublished(url, "instagram", {
      title: meta.title,
      headline: meta.headline_ig || meta.headline || "",
      caption: meta.caption_ig || meta.caption || "",
    });
  }
  if (!meta.facebook && !meta.instagram) {
    ensureArticleRow(url, meta.title || "");
  }
}

async function getPlatformAttempts(url, platform) {
  assertDB();
  const row = db
    .prepare("SELECT attempts FROM publish_attempts WHERE url = ? AND platform = ?")
    .get(url, platform);
  return row ? row.attempts : 0;
}

async function recordPlatformFailure(url, platform, error = "") {
  assertDB();
  db.prepare(
    `INSERT INTO publish_attempts (url, platform, attempts, last_error, updated_at)
     VALUES (?, ?, 1, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(url, platform) DO UPDATE SET
       attempts = attempts + 1,
       last_error = excluded.last_error,
       updated_at = CURRENT_TIMESTAMP`,
  ).run(url, platform, String(error).slice(0, 500));

  const row = db
    .prepare("SELECT attempts FROM publish_attempts WHERE url = ? AND platform = ?")
    .get(url, platform);
  return row ? row.attempts : 0;
}

async function clearPlatformAttempts(url, platform) {
  assertDB();
  db.prepare("DELETE FROM publish_attempts WHERE url = ? AND platform = ?").run(url, platform);
}

// Legacy wrappers (facebook-scoped) retained for compatibility
async function getAttempts(url) {
  return getPlatformAttempts(url, "facebook");
}
async function recordFailure(url, error = "") {
  return recordPlatformFailure(url, "facebook", error);
}
async function clearAttempts(url) {
  return clearPlatformAttempts(url, "facebook");
}

function getRecentPublished(limit = 20) {
  if (!db) return [];
  return db
    .prepare("SELECT * FROM published_articles ORDER BY created_at DESC LIMIT ?")
    .all(limit);
}

function closeDB() {
  if (db) {
    try {
      const result = db.pragma("wal_checkpoint(TRUNCATE)");
      logger.debug(`🧹 WAL checkpoint: ${JSON.stringify(result)}`);
    } catch (err) {
      logger.warn(`WAL checkpoint failed before shutdown: ${err.message}`);
    }

    db.close();
    logger.info("DB closed");
  }
}

module.exports = {
  initDB,
  isPublished,
  getArticleStatus,
  markAsPublished,
  markPlatformPublished,
  getAttempts,
  recordFailure,
  clearAttempts,
  getPlatformAttempts,
  recordPlatformFailure,
  clearPlatformAttempts,
  getRecentPublished,
  closeDB,
};
