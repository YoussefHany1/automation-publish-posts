/**
 * 💾 db.js
 * ─────────
 * قاعدة بيانات SQLite خفيفة لتخزين الروابط المنشورة
 * وتجنّب التكرار — مجانية وتعمل بدون server.
 */

const Database = require("better-sqlite3");
const path = require("path");
const logger = require("./logger");

const DB_PATH = path.join(__dirname, "..", "data", "published.db");
let db;

/**
 * تهيئة قاعدة البيانات وإنشاء الجدول إذا لم يكن موجوداً.
 */
async function initDB() {
  // إنشاء مجلد data إذا لم يكن موجوداً
  const { mkdirSync } = require("fs");
  mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);

  // WAL mode: أداء أفضل في القراءة/الكتابة المتزامنة
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
  `);

  logger.info(`💾 DB ready: ${DB_PATH}`);
}

/**
 * يتحقق إذا كان الرابط منشوراً من قبل.
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
 * يسجّل الخبر كـ "منشور".
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
 * يُعيد آخر N مقالات منشورة (مفيد للـ debugging).
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

module.exports = { initDB, isPublished, markAsPublished, getRecentPublished };
