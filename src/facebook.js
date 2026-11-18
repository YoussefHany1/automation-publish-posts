/**
 * 📘 facebook.js
 * ───────────────
 * Publishes an image + caption to a Facebook Page
 * using Graph API v19.0
 *
 * ─── Setup Steps ──────────────────────────────────────
 * 1. Go to: https://developers.facebook.com/
 * 2. My Apps → Create App → Business
 * 3. Add Product: Pages API
 * 4. Settings → Basic → save App ID & App Secret
 * 5. Tools → Graph API Explorer:
 *    - select your page from the list
 *    - request Permissions:
 *      • pages_manage_posts
 *      • pages_read_engagement
 *      • pages_show_list
 * 6. Generate Access Token (short-lived, 1 hour)
 * 7. Exchange for Long-Lived (60 days):
 *    GET https://graph.facebook.com/oauth/access_token
 *      ?grant_type=fb_exchange_token
 *      &client_id={APP_ID}
 *      &client_secret={APP_SECRET}
 *      &fb_exchange_token={SHORT_TOKEN}
 * 8. Get the permanent Page Token:
 *    GET /me/accounts?access_token={LONG_LIVED_USER_TOKEN}
 * ────────────────────────────────────────────────────────
 */

const axios = require("axios");
const FormData = require("form-data");
const logger = require("./logger");

const BASE = "https://graph.facebook.com/v19.0";
const PAGE_ID = process.env.FACEBOOK_PAGE_ID;
const TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

/**
 * Extracts the error object from a Facebook Graph API response, if present.
 */
function getFacebookError(err) {
  return err?.response?.data?.error || null;
}

/**
 * Detects Access Token expiration/revocation errors.
 * Code 190 or messages such as "Error validating access token" / "Session has expired".
 * @param {any} err
 * @returns {boolean}
 */
function isTokenError(err) {
  const fbError = getFacebookError(err);
  const TOKEN_MSG = /Error validating access token|Session has expired|Invalid OAuth access token|access token has expired/i;

  if (fbError) {
    if (fbError.code === 190) return true;
    if (TOKEN_MSG.test(fbError.message || "")) return true;
  }
  return TOKEN_MSG.test(err?.message || "");
}

/**
 * Builds a clear description of a Facebook error (message + code + subcode).
 */
function formatFacebookError(err) {
  const fbError = getFacebookError(err);
  if (!fbError) return err?.message || String(err);

  const parts = [fbError.message || "خطأ غير معروف"];
  if (fbError.code) parts.push(`code=${fbError.code}`);
  if (fbError.error_subcode) parts.push(`subcode=${fbError.error_subcode}`);
  return parts.join(" | ");
}

/**
 * Publishes an image with a caption to a Facebook Page.
 * @param {{ caption: string, imageBuffer?: Buffer|null, imageUrl?: string|null, link: string }} params
 */
async function publishToFacebook({ caption, imageBuffer, imageUrl, link }) {
  if (!PAGE_ID || !TOKEN) {
    throw new Error("FACEBOOK_PAGE_ID أو FACEBOOK_PAGE_ACCESS_TOKEN غير موجود");
  }

  try {
    // ─── Path 1: publish a locally prepared image Buffer ────────
    if (imageBuffer) {
      return await postWithPhotoBuffer({ caption, imageBuffer });
    }

    // ─── Path 2: publish with an image from a URL (/photos) ────────────
    if (imageUrl) {
      return await postWithPhoto({ caption, imageUrl });
    }

    // ─── Path 3: publish a link only, no image (/feed) ─────────
    return await postLinkOnly({ caption, link });
  } catch (err) {
    // ─── Prominent alert on Token expiration (Error 190) ───
    if (isTokenError(err)) {
      const detail = formatFacebookError(err);
      logger.error("════════════════════════════════════════════════════════════");
      logger.error("🚨 تنبيه عاجل: صلاحية FACEBOOK_PAGE_ACCESS_TOKEN منتهية أو ملغاة!");
      logger.error(`   التفاصيل: ${detail}`);
      logger.error("   👉 جدّد الـ Token من Graph API Explorer ثم حدّث .env / GitHub Secrets");
      logger.error("════════════════════════════════════════════════════════════");

      const tokenErr = new Error(
        `Facebook access token منتهي أو غير صالح — يجب تجديده. (${detail})`,
      );
      tokenErr.code = "FB_TOKEN_EXPIRED";
      tokenErr.cause = err;
      throw tokenErr;
    }

    throw err;
  }
}

/**
 * Uploads an image from a Buffer via multipart/form-data.
 */
async function postWithPhotoBuffer({ caption, imageBuffer }) {
  const endpoint = `${BASE}/${PAGE_ID}/photos`;

  const form = new FormData();
  form.append("source", imageBuffer, {
    filename: "post.png",
    contentType: "image/png",
  });
  form.append("caption", caption);
  form.append("access_token", TOKEN);
  form.append("published", "true");

  const { data } = await axios.post(endpoint, form, {
    headers: form.getHeaders(),
    timeout: 45000,
    proxy: false,
  });

  if (!data.post_id && !data.id) {
    throw new Error(`Facebook API رد غير متوقع: ${JSON.stringify(data)}`);
  }

  logger.debug(`📘 Facebook post_id: ${data.post_id || data.id}`);
  return data;
}

/**
 * Fetches the image from a URL and publishes it with the caption.
 */
async function postWithPhoto({ caption, imageUrl }) {
  const endpoint = `${BASE}/${PAGE_ID}/photos`;

  const payload = {
    url: imageUrl,          // Facebook fetches the image from the URL directly
    caption: caption,
    access_token: TOKEN,
    published: true,
  };

  const { data } = await axios.post(endpoint, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  if (!data.post_id && !data.id) {
    throw new Error(`Facebook API رد غير متوقع: ${JSON.stringify(data)}`);
  }

  logger.debug(`📘 Facebook post_id: ${data.post_id || data.id}`);
  return data;
}

/**
 * Publishes a caption + link without an image (fallback).
 */
async function postLinkOnly({ caption, link }) {
  const endpoint = `${BASE}/${PAGE_ID}/feed`;

  const { data } = await axios.post(
    endpoint,
    {
      message: caption,
      link: link,
      access_token: TOKEN,
    },
    { timeout: 30000 }
  );

  if (!data.id) {
    throw new Error(`Facebook feed error: ${JSON.stringify(data)}`);
  }

  return data;
}

module.exports = { publishToFacebook, isTokenError };
