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
 * Wraps text into lines based on the available width (Word Wrap)
 */
function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines;
}

/**
 * Splits a line into consecutive "runs" of the same kind:
 *   - Latin/numbers (colored blue)  isLatin = true
 *   - Arabic                        isLatin = false
 *
 * This keeps the coloring while letting the rendering engine (Skia/HarfBuzz)
 * order words inside each run correctly, instead of moving words manually
 * (which corrupted bidirectional (BiDi) text ordering).
 *
 * @param {string} line
 * @returns {{ text: string, isLatin: boolean }[]}
 */
function splitRuns(line) {
  const tokens = line.split(/\s+/).filter(Boolean);
  const runs = [];

  for (const token of tokens) {
    const isLatin = /[a-zA-Z0-9]/.test(token);
    const last = runs[runs.length - 1];
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
  const canvas = createCanvas(width, height);
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

  // ─── 3. Draw the Arabic news headline ────────────────────────────────────
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

      // Runs in logical order, then reversed visually in the Arabic case
      // (the first logical run appears at the far right) — preserving
      // word order inside each run, letting the engine handle BiDi within it.
      let runs = splitRuns(line);
      if (hasArabic) runs = runs.slice().reverse();

      const widths = runs.map((run) => {
        ctx.direction = run.isLatin ? "ltr" : hasArabic ? "rtl" : "ltr";
        return ctx.measureText(run.text).width;
      });

      const totalWidth =
        widths.reduce((a, b) => a + b, 0) + spaceWidth * (runs.length - 1);

      // Center the line block, then draw runs left-to-right in visual order
      let x = (width - totalWidth) / 2;

      runs.forEach((run, i) => {
        ctx.direction = run.isLatin ? "ltr" : hasArabic ? "rtl" : "ltr";
        // Latin/numbers → #6c9ef7 | Arabic → white
        ctx.fillStyle = run.isLatin ? "#6c9ef7" : "#FFFFFF";
        ctx.fillText(run.text, x, lineY);
        x += widths[i] + spaceWidth;
      });
    });

    // Reset the shadow
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
  }

  return canvas.toBuffer("image/png");
}

module.exports = { generateNewsImage };
