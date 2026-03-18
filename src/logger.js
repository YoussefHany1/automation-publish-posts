/**
 * 📝 logger.js
 * ─────────────
 * Logger بسيط وملوّن باستخدام winston.
 */

const { createLogger, format, transports } = require("winston");
const { combine, timestamp, colorize, printf } = format;
const path = require("path");
const { mkdirSync } = require("fs");

// إنشاء مجلد logs
const LOG_DIR = path.join(__dirname, "..", "logs");
mkdirSync(LOG_DIR, { recursive: true });

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// فورمات طباعة مخصص
const consoleFmt = printf(({ level, message, timestamp: ts }) => {
  return `${ts}  ${level.padEnd(7)} ${message}`;
});

const logger = createLogger({
  level: LOG_LEVEL,
  format: combine(
    timestamp({ format: "HH:mm:ss" }),
    format.errors({ stack: true })
  ),
  transports: [
    // ─── الطرفية ─────────────────────────────────────
    new transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: "HH:mm:ss" }),
        consoleFmt
      ),
    }),
    // ─── ملف الأخطاء ─────────────────────────────────
    new transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,  // 5MB
      maxFiles: 3,
    }),
    // ─── ملف كل شيء ──────────────────────────────────
    new transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
