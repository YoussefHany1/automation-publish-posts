const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { createCanvas, loadImage, GlobalFonts } = require("@napi-rs/canvas");
const logger = require("./logger");

// Register the Cairo font
const FONT_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "fonts",
  "Cairo-Bold.ttf",
);
if (fs.existsSync(FONT_PATH)) {
  GlobalFonts.registerFromPath(FONT_PATH, "Cairo");
}

const OVERLAY_PATH = path.join(__dirname, "..", "assets", "logos png.png");

/**
 * Draws an image in cover mode (fill frame without stretching)
 */
function drawImageCover(ctx, img, targetWidth, targetHeight) {
  const imgRatio = img.width / img.height;
  const targetRatio = targetWidth / targetHeight;
  let drawWidth, drawHeight, offsetX, offsetY;

  if (imgRatio > targetRatio) {
    drawHeight = targetHeight;
    drawWidth = img.width * (targetHeight / img.height);
    offsetX = (targetWidth - drawWidth) / 2;
    offsetY = 0;
  } else {
    drawWidth = targetWidth;
    drawHeight = img.height * (targetWidth / img.width);
    offsetX = 0;
    offsetY = (targetHeight - drawHeight) / 2;
  }

  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
}

/**
 * Breaks a single token into chunks that fit within maxWidth (fallback for long words).
 */
function breakLongWord(ctx, word, maxWidth) {
  if (!word) return [""];
  if (ctx.measureText(word).width <= maxWidth) return [word];
  const chars = Array.from(word);
  const parts = [];
  let current = "";
  for (const ch of chars) {
    const test = current + ch;
    if (current && ctx.measureText(test).width > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current = test;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [word];
}

/**
 * Wraps text into lines based on the available width (Word Wrap)
 * with a fallback for tokens longer than maxWidth.
 */
function wrapText(ctx, text, maxWidth) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const pieces = breakLongWord(ctx, word, maxWidth);
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      if (!currentLine) {
        currentLine = piece;
        continue;
      }
      const testLine = `${currentLine} ${piece}`;
      if (ctx.measureText(testLine).width > maxWidth) {
        lines.push(currentLine);
        currentLine = piece;
      } else {
        currentLine = testLine;
      }
      // if a word was broken, subsequent pieces should start new lines naturally
      if (pieces.length > 1 && i < pieces.length - 1) {
        lines.push(currentLine);
        currentLine = "";
      }
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length ? lines : [""];
}

/**
 * Splits a line into consecutive "runs" of the same kind:
 *   - Latin/numbers (colored blue)  isLatin = true
 *   - Arabic/other                  isLatin = false
 *
 * Neutral tokens (punctuation/symbols without strong script) attach to the
 * previous run to reduce boundary quirks in mixed Arabic-English headlines.
 *
 * @param {string} line
 * @returns {{ text: string, isLatin: boolean }[]}
 */
function splitRuns(line) {
  const tokens = String(line || "").split(/\s+/).filter(Boolean);
  const runs = [];

  const classify = (token) => {
    if (/[a-zA-Z0-9]/.test(token)) return "latin";
    if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(token)) return "arabic";
    return "neutral";
  };

  for (const token of tokens) {
    const kind = classify(token);
    const last = runs[runs.length - 1];

    if (kind === "neutral") {
      if (last) {
        last.text += ` ${token}`;
      } else {
        runs.push({ text: token, isLatin: false });
      }
      continue;
    }

    const isLatin = kind === "latin";
    if (last && last.isLatin === isLatin) {
      last.text += ` ${token}`;
    } else {
      runs.push({ text: token, isLatin });
    }
  }

  return runs;
}

/**
 * Generates a combined news image:
 * news background + gradient/logo (overlay) + styled Arabic headline
 *
 * @param {{ imageUrl: string, titleText: string }} params
 * @returns {Promise<Buffer>} PNG image as a Buffer
 */
async function generateNewsImage({ imageUrl, titleText }) {
  const width = 1080;
  const height = 1080;
  let canvas;
  try {
    canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // ─── 1. Draw the news background image ──────────────────────────────────────────
    let bgLoaded = false;
    if (imageUrl) {
      try {
        const response = await axios.get(imageUrl, {
          responseType: "arraybuffer",
          timeout: 15000,
          proxy: false,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        const bgImg = await loadImage(Buffer.from(response.data));
        drawImageCover(ctx, bgImg, width, height);
        bgLoaded = true;
      } catch (err) {
        logger.warn(
          `⚠️ Failed to load the news image: ${err.message}; a default background will be used.`,
        );
      }
    }

    // Dark fallback background when no image is available
    if (!bgLoaded) {
      const bgGrad = ctx.createLinearGradient(0, 0, width, height);
      bgGrad.addColorStop(0, "#0f172a");
      bgGrad.addColorStop(1, "#1e293b");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, width, height);
    }

    // ─── 2. Draw the gradient and logo (Overlay) layer ──────────────────────────────
    if (fs.existsSync(OVERLAY_PATH)) {
      try {
        const overlayImg = await loadImage(OVERLAY_PATH);
        ctx.drawImage(overlayImg, 0, 0, width, height);
      } catch (err) {
        logger.error(`❌ Error loading the overlay: ${err.message}`);
      }
    }

    // ─── 3. Draw the news headline ────────────────────────────────────
    if (titleText && titleText.trim()) {
      // Strip emojis
      const cleanText = titleText
        .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
        .replace(/\s+/g, " ")
        .trim();

      const paddingX = 80;
      const maxWidth = width - paddingX * 2;

      // Adjust font size based on text length
      let fontSize = 60;
      if (cleanText.length > 70) fontSize = 52;
      if (cleanText.length > 110) fontSize = 44;

      // Base direction: RTL if the text contains Arabic letters, otherwise LTR
      const hasArabic = /[\u0600-\u06FF]/.test(cleanText);

      const isImportantEnglishToken = (token) => {
        if (/[0-9]/.test(token)) return true; // numbers/digits
        const letters = token.replace(/[^A-Za-z]/g, "");
        return letters.length >= 2 && letters === letters.toUpperCase(); // ALL-CAPS words (e.g. GTA, DLC)
      };

      ctx.font = `bold ${fontSize}px Cairo, sans-serif`;
      ctx.direction = hasArabic ? "rtl" : "ltr";
      ctx.lang = hasArabic ? "ar" : "en";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const lines = wrapText(ctx, cleanText, maxWidth);
      const lineHeight = fontSize * 1.35;
      const totalTextHeight = lines.length * lineHeight;

      // Text position at the bottom of the image (centered)
      const bottomMargin = 90;
      const firstLineY = height - bottomMargin - totalTextHeight + lineHeight / 2;

      // Light text shadow for better readability
      ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 4;

      ctx.textAlign = "left";
      const spaceWidth = ctx.measureText(" ").width;

      lines.forEach((line, index) => {
        const lineY = firstLineY + index * lineHeight;

        if (hasArabic) {
          // Arabic/mixed headlines (Facebook): keep existing behavior unchanged
          // Latin/numbers → blue, Arabic → white. Preserve BiDi-aware run rendering.
          let runs = splitRuns(line);
          runs = runs.slice().reverse();

          const widths = runs.map((run) => {
            ctx.direction = run.isLatin ? "ltr" : "rtl";
            return ctx.measureText(run.text).width;
          });

          const totalWidth =
            widths.reduce((a, b) => a + b, 0) + spaceWidth * (runs.length - 1);

          let x = (width - totalWidth) / 2;
          runs.forEach((run, i) => {
            ctx.direction = run.isLatin ? "ltr" : "rtl";
            ctx.fillStyle = run.isLatin ? "#6c9ef7" : "#FFFFFF";
            ctx.fillText(run.text, x, lineY);
            x += widths[i] + spaceWidth;
          });
        } else {
          // English headlines (Instagram): main text white, important words/numbers blue
          const tokens = line.split(/\s+/).filter(Boolean);
          const widths = tokens.map((token) => {
            ctx.direction = "ltr";
            return ctx.measureText(token).width;
          });
          const totalWidth =
            widths.reduce((a, b) => a + b, 0) + spaceWidth * Math.max(0, tokens.length - 1);

          let x = (width - totalWidth) / 2;
          ctx.direction = "ltr";
          tokens.forEach((token, i) => {
            ctx.fillStyle = isImportantEnglishToken(token) ? "#6c9ef7" : "#FFFFFF";
            ctx.fillText(token, x, lineY);
            x += widths[i] + spaceWidth;
          });
        }
      });

      // Reset the shadow
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
    }

    return canvas.toBuffer("image/png");
  } finally {
    // Release native canvas backing memory promptly in batch/serverless runs
    if (canvas) {
      try {
        canvas.width = 0;
        canvas.height = 0;
      } catch {}
    }
  }
}

module.exports = { generateNewsImage };
