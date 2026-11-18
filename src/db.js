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

/**
 * Initializes the database and creates the table if it does not exist.
 */
async function initDB() {
  // Create the data directory if it does not exist
  const { mkdirSync } = require("fs");
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);

  // WAL mode: better performance for concurrent read/write
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS published_articles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      url         TEXT    NOT NULL UNIQUE,
      title       TEXT,
      caption     TEXT,
      fb_ok       INTEGER DEFAULT 0,
      ig_ok       INTEGER DEFAULT 0,
      created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_url ON published_articles(url);

    -- Track failed publish attempts per link to avoid retrying forever
    CREATE TABLE IF NOT EXISTS article_attempts (
      url         TEXT PRIMARY KEY,
      attempts    INTEGER NOT NULL DEFAULT 0,
      last_error  TEXT,
      updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  logger.info(`💾 DB ready: ${DB_PATH}`);
}

/**
 * Checks whether a URL has been published before.
 * @param {string} url
 * @returns {boolean}
 */
async function isPublished(url) {
  if (!db) throw new Error("DB غير مُهيَّأة — استدعِ initDB() أولاً");

  const row = db
    .prepare("SELECT id FROM published_articles WHERE url = ?")
    .get(url);

  return !!row;
}

/**
 * Records an article as "published".
 * @param {string} url
 * @param {{ title?: string, caption?: string, facebook?: boolean, instagram?: boolean }} meta
 */
async function markAsPublished(url, meta = {}) {
  if (!db) throw new Error("DB غير مُهيَّأة — استدعِ initDB() أولاً");

  db.prepare(`
    INSERT OR IGNORE INTO published_articles (url, title, caption, fb_ok, ig_ok)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    url,
    meta.title || "",
    meta.caption || "",
    meta.facebook ? 1 : 0,
    meta.instagram ? 1 : 0
  );
}

/**
 * Returns the number of failed publish attempts for a given URL (0 if none).
 * @param {string} url
 * @returns {number}
 */
async function getAttempts(url) {
  if (!db) throw new Error("DB غير مُهيَّأة — استدعِ initDB() أولاً");

  const row = db
    .prepare("SELECT attempts FROM article_attempts WHERE url = ?")
    .get(url);

  return row ? row.attempts : 0;
}

/**
 * Records a failed publish attempt for a URL (increments the counter by 1).
 * @param {string} url
 * @param {string} [error] Last error message
 * @returns {number} Number of attempts after the increment
 */
async function recordFailure(url, error = "") {
  if (!db) throw new Error("DB غير مُهيَّأة — استدعِ initDB() أولاً");

  db.prepare(`
    INSERT INTO article_attempts (url, attempts, last_error, updated_at)
    VALUES (?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(url) DO UPDATE SET
      attempts   = attempts + 1,
      last_error = excluded.last_error,
      updated_at = CURRENT_TIMESTAMP
  `).run(url, String(error).slice(0, 500));

  const row = db
    .prepare("SELECT attempts FROM article_attempts WHERE url = ?")
    .get(url);

  return row ? row.attempts : 0;
}

/**
 * Deletes the attempt record for a URL (called after a successful publish).
 * @param {string} url
 */
async function clearAttempts(url) {
  if (!db) throw new Error("DB غير مُهيَّأة — استدعِ initDB() أولاً");
  db.prepare("DELETE FROM article_attempts WHERE url = ?").run(url);
}

/**
 * Returns the last N published articles (useful for debugging).
 * @param {number} limit
 */
function getRecentPublished(limit = 20) {
  if (!db) return [];
  return db
    .prepare(
      "SELECT * FROM published_articles ORDER BY created_at DESC LIMIT ?"
    )
    .all(limit);
}

/**
 * Closes the database connection.
 */
function closeDB() {
  if (db) {
    // Merge all transactions into the main file and truncate WAL files before closing.
    // Important in GitHub Actions where the DB is committed to Git — prevents
    // conflicts/corruption of the temporary files (published.db-wal / published.db-shm).
    try {
      const result = db.pragma("wal_checkpoint(TRUNCATE)");
      logger.debug(`🧹 WAL checkpoint: ${JSON.stringify(result)}`);
    } catch (err) {
      logger.warn(`⚠️ فشل wal_checkpoint قبل الإغلاق: ${err.message}`);
    }

    db.close();
    logger.info("🔌 DB closed");
  }
}

module.exports = {
  initDB,
  isPublished,
  markAsPublished,
  getAttempts,
  recordFailure,
  clearAttempts,
  getRecentPublished,
  closeDB,
};
