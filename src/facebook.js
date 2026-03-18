/**
 * 📘 facebook.js
 * ───────────────
 * ينشر صورة + كابشن على Facebook Page
 * باستخدام Graph API v19.0
 *
 * ─── خطوات الإعداد ──────────────────────────────────────
 * 1. اذهب إلى: https://developers.facebook.com/
 * 2. My Apps → Create App → Business
 * 3. Add Product: Pages API
 * 4. Settings → Basic → احفظ App ID & App Secret
 * 5. Tools → Graph API Explorer:
 *    - اختر صفحتك من القائمة
 *    - اطلب Permissions:
 *      • pages_manage_posts
 *      • pages_read_engagement
 *      • pages_show_list
 * 6. Generate Access Token (قصير 1 ساعة)
 * 7. حوّله لـ Long-Lived (60 يوم):
 *    GET https://graph.facebook.com/oauth/access_token
 *      ?grant_type=fb_exchange_token
 *      &client_id={APP_ID}
 *      &client_secret={APP_SECRET}
 *      &fb_exchange_token={SHORT_TOKEN}
 * 8. احصل على Page Token الدائم:
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
 * ينشر صورة مع كابشن على صفحة Facebook.
 * @param {{ caption: string, imageUrl: string|null, link: string }} params
 */
async function publishToFacebook({ caption, imageUrl, link }) {
  if (!PAGE_ID || !TOKEN) {
    throw new Error("FACEBOOK_PAGE_ID أو FACEBOOK_PAGE_ACCESS_TOKEN غير موجود");
  }

  // ─── مسار 1: نشر مع صورة (/photos) ──────────────────
  if (imageUrl) {
    return await postWithPhoto({ caption, imageUrl });
  }

  // ─── مسار 2: نشر رابط فقط بدون صورة (/feed) ─────────
  return await postLinkOnly({ caption, link });
}

/**
 * يرفع الصورة من URL وينشرها مع الكابشن.
 */
async function postWithPhoto({ caption, imageUrl }) {
  const endpoint = `${BASE}/${PAGE_ID}/photos`;

  const payload = {
    url: imageUrl,          // Facebook يجلب الصورة من الـ URL مباشرةً
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
 * ينشر كابشن + رابط بدون صورة (fallback).
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

module.exports = { publishToFacebook };
