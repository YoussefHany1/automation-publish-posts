/**
 * 📸 instagram.js
 * ────────────────
 * ينشر صورة + كابشن على Instagram Business Account
 * باستخدام Instagram Graph API (Two-Step: Create → Publish)
 *
 * ─── خطوات الإعداد ──────────────────────────────────────
 * 1. تأكد أن حسابك Instagram نوعه Business أو Creator.
 * 2. اربطه بصفحة Facebook Page (من إعدادات Instagram).
 * 3. في Facebook Developer App (نفس الـ App):
 *    Add Product → Instagram Graph API
 * 4. Tools → Graph API Explorer:
 *    Permissions المطلوبة:
 *      • instagram_basic
 *      • instagram_content_publish
 *      • pages_read_engagement
 * 5. احصل على Instagram Business Account ID:
 *    GET /me/accounts → id هو Facebook Page ID
 *    GET /{page-id}?fields=instagram_business_account
 *    → instagram_business_account.id هو ما نحتاجه
 * 6. استخدم نفس Long-Lived Page Access Token من Facebook.
 *
 * ⚠️  قيود مهمة:
 *    - الصورة يجب أن تكون متاحة على URL عام (HTTPS).
 *    - لا يدعم GIF.
 *    - نسبة الأبعاد: 4:5 إلى 1.91:1 مقبولة.
 *    - حد 25 نشرة/يوم.
 * ────────────────────────────────────────────────────────
 */

const axios = require("axios");
const logger = require("./logger");

const BASE = "https://graph.facebook.com/v19.0";
const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

/**
 * ينشر صورة مع كابشن على Instagram.
 * يمرّ بخطوتين:
 *   1. إنشاء Container (media object)
 *   2. نشر الـ Container
 *
 * @param {{ caption: string, imageUrl: string|null }} params
 */
async function publishToInstagram({ caption, imageUrl }) {
  if (!IG_ID || !TOKEN) {
    throw new Error(
      "INSTAGRAM_BUSINESS_ACCOUNT_ID أو INSTAGRAM_ACCESS_TOKEN غير موجود"
    );
  }

  if (!imageUrl) {
    logger.warn("⚠️  Instagram: No image, skipping");
    return null;
  }

  // ─── الخطوة 1: إنشاء Media Container ─────────────────
  const containerId = await createMediaContainer({ caption, imageUrl });
  logger.debug(`📦 Instagram container_id: ${containerId}`);

  // ─── انتظر 3 ثوانٍ للمعالجة ──────────────────────────
  await waitForContainerReady(containerId);

  // ─── الخطوة 2: نشر الـ Container ──────────────────────
  const publishId = await publishContainer(containerId);
  logger.debug(`📸 Instagram publish_id: ${publishId}`);

  return publishId;
}

/**
 * الخطوة 1: إنشاء الـ Container.
 */
async function createMediaContainer({ caption, imageUrl }) {
  const endpoint = `${BASE}/${IG_ID}/media`;

  const { data } = await axios.post(
    endpoint,
    {
      image_url: imageUrl,
      caption: caption,
      access_token: TOKEN,
    },
    { timeout: 30000 }
  );

  if (!data.id) {
    throw new Error(`فشل إنشاء Container: ${JSON.stringify(data)}`);
  }

  return data.id;
}

/**
 * ينتظر حتى يصبح الـ Container جاهزاً للنشر.
 * يتحقق كل 3 ثوانٍ لمدة أقصاها 30 ثانية.
 */
async function waitForContainerReady(containerId, maxWaitMs = 30000) {
  const interval = 3000;
  let waited = 0;

  while (waited < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval));
    waited += interval;

    const { data } = await axios.get(`${BASE}/${containerId}`, {
      params: {
        fields: "status_code",
        access_token: TOKEN,
      },
      timeout: 10000,
    });

    logger.debug(`⏳ Container status: ${data.status_code}`);

    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error("Instagram Container فشل في المعالجة");
    }
  }

  logger.warn("⚠️  Wait time exceeded — will attempt to publish anyway");
}

/**
 * الخطوة 2: نشر الـ Container.
 */
async function publishContainer(containerId) {
  const endpoint = `${BASE}/${IG_ID}/media_publish`;

  const { data } = await axios.post(
    endpoint,
    {
      creation_id: containerId,
      access_token: TOKEN,
    },
    { timeout: 30000 }
  );

  if (!data.id) {
    throw new Error(`فشل نشر Container: ${JSON.stringify(data)}`);
  }

  return data.id;
}

module.exports = { publishToInstagram };
