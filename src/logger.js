/**
 * 📝 logger.js
 * ─────────────
 * Simple colored logger using winston.
 */

const { createLogger, format, transports } = require("winston");
const { combine, timestamp, colorize, printf } = format;
const path = require("path");
const { mkdirSync } = require("fs");

// Create the logs directory
const LOG_DIR = path.join(__dirname, "..", "logs");
mkdirSync(LOG_DIR, { recursive: true });

const LOG_LEVEL = process.env.LOG_LEVEL || "info";

// Disable ANSI colors in CI / non-interactive (GitHub Actions logs) to avoid
// stray escape sequences like "[32minfo[39m" appearing in the run output.
const useColors =
  process.stdout.isTTY === true &&
  !process.env.CI &&
  !process.env.GITHUB_ACTIONS;

// Custom print format
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
    // ─── Console ─────────────────────────────────────
    new transports.Console({
      format: combine(
        ...(useColors ? [colorize({ all: true })] : []),
        timestamp({ format: "HH:mm:ss" }),
        consoleFmt
      ),
    }),
    // ─── Error file ─────────────────────────────────
    new transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,  // 5MB
      maxFiles: 3,
    }),
    // ─── All-logs file ──────────────────────────────────
    new transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      maxsize: 10 * 1024 * 1024, // 10MB
      maxFiles: 5,
    }),
  ],
});

module.exports = logger;
