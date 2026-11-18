/**
 * 📸 instagram.js
 * ────────────────
 * Publishes an image + caption to an Instagram Business Account
 * using Instagram Graph API (Two-Step: Create → Publish)
 *
 * ─── Setup Steps ──────────────────────────────────────
 * 1. Make sure your Instagram account is Business or Creator.
 * 2. Link it to a Facebook Page (from Instagram settings).
 * 3. In Facebook Developer App (same App):
 *    Add Product → Instagram Graph API
 * 4. Tools → Graph API Explorer:
 *    Required Permissions:
 *      • instagram_basic
 *      • instagram_content_publish
 *      • pages_read_engagement
 * 5. Get the Instagram Business Account ID:
 *    GET /me/accounts → id is the Facebook Page ID
 *    GET /{page-id}?fields=instagram_business_account
 *    → instagram_business_account.id is what we need
 * 6. Use the same Long-Lived Page Access Token as Facebook.
 *
 * ⚠️  Important limits:
 *    - The image must be available at a public URL (HTTPS).
 *    - GIF not supported.
 *    - Aspect ratio: 4:5 to 1.91:1 accepted.
 *    - Limit of 25 posts/day.
 * ────────────────────────────────────────────────────────
 */

const axios = require("axios");
const logger = require("./logger");

const BASE = "https://graph.facebook.com/v19.0";
const IG_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
const TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN;

/**
 * Publishes an image with a caption on Instagram.
 * Goes through two steps:
 *   1. Create a Container (media object)
 *   2. Publish the Container
 *
 * @param {{ caption: string, imageUrl: string|null }} params
 */
async function publishToInstagram({ caption, imageUrl }) {
  if (!IG_ID || !TOKEN) {
    throw new Error(
      "INSTAGRAM_BUSINESS_ACCOUNT_ID or INSTAGRAM_ACCESS_TOKEN is missing",
    );
  }

  if (!imageUrl) {
    logger.warn("⚠️  Instagram: No image, skipping");
    return null;
  }

  // ─── Step 1: Create Media Container ─────────────────
  const containerId = await createMediaContainer({ caption, imageUrl });
  logger.debug(`📦 Instagram container_id: ${containerId}`);

  // ─── Wait 3 seconds for processing ──────────────────────────
  await waitForContainerReady(containerId);

  // ─── Step 2: Publish the Container ──────────────────────
  const publishId = await publishContainer(containerId);
  logger.debug(`📸 Instagram publish_id: ${publishId}`);

  return publishId;
}

/**
 * Step 1: Create the Container.
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
    { timeout: 30000 },
  );

  if (!data.id) {
    throw new Error(`Failed to create container: ${JSON.stringify(data)}`);
  }

  return data.id;
}

/**
 * Waits until the Container is ready to publish.
 * Checks every 3 seconds for up to 30 seconds.
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
      throw new Error("Instagram container failed to process");
    }
  }

  logger.warn("⚠️  Wait time exceeded — will attempt to publish anyway");
}

/**
 * Step 2: Publish the Container.
 */
async function publishContainer(containerId) {
  const endpoint = `${BASE}/${IG_ID}/media_publish`;

  const { data } = await axios.post(
    endpoint,
    {
      creation_id: containerId,
      access_token: TOKEN,
    },
    { timeout: 30000 },
  );

  if (!data.id) {
    throw new Error(`Container deployment failed: ${JSON.stringify(data)}`);
  }

  return data.id;
}

module.exports = { publishToInstagram };
