/**
 * 📸 instagram.js
 * ────────────────
 * Publishes an image + caption to an Instagram Business Account
 * using Instagram Graph API (Two-Step: Create → Publish)
 *
 * Requirements:
 *  - Instagram Business/Creator account linked to a Facebook Page
 *  - Permissions: instagram_basic, instagram_content_publish, pages_read_engagement
 *  - image_url must be publicly accessible over HTTPS
 */

const axios = require("axios");
const logger = require("./logger");

const BASE = "https://graph.facebook.com/v19.0";

function getInstagramConfig() {
  const igId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  // Allow fallback to FB page token when IG token is not explicitly set
  const token = process.env.INSTAGRAM_ACCESS_TOKEN || process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  return { igId, token };
}

function getInstagramError(err) {
  return err?.response?.data?.error || null;
}

function isTokenError(err) {
  const fbError = getInstagramError(err);
  const TOKEN_MSG =
    /Error validating access token|Session has expired|Invalid OAuth access token|access token has expired/i;
  if (fbError) {
    if (fbError.code === 190) return true;
    if (TOKEN_MSG.test(fbError.message || "")) return true;
  }
  return TOKEN_MSG.test(err?.message || "");
}

function formatInstagramError(err) {
  const fbError = getInstagramError(err);
  if (!fbError) return err?.message || String(err);
  const parts = [fbError.message || "Unknown error"];
  if (fbError.code != null) parts.push(`code=${fbError.code}`);
  if (fbError.error_subcode != null) parts.push(`subcode=${fbError.error_subcode}`);
  if (fbError.type) parts.push(`type=${fbError.type}`);
  return parts.join(" | ");
}

function wrapInstagramError(err, context) {
  const detail = formatInstagramError(err);
  if (isTokenError(err)) {
    const e = new Error(`Instagram token expired/invalid during ${context}: ${detail}`);
    e.code = "IG_TOKEN_EXPIRED";
    e.cause = err;
    return e;
  }
  const e = new Error(`Instagram ${context} failed: ${detail}`);
  e.cause = err;
  return e;
}

/**
 * Publishes an image with a caption on Instagram.
 * @param {{ caption: string, imageUrl: string }} params
 */
async function publishToInstagram({ caption, imageUrl }) {
  const { igId, token } = getInstagramConfig();
  if (!igId || !token) {
    throw new Error(
      "INSTAGRAM_BUSINESS_ACCOUNT_ID or Instagram access token is missing (set INSTAGRAM_ACCESS_TOKEN or FACEBOOK_PAGE_ACCESS_TOKEN)",
    );
  }

  if (!imageUrl) {
    throw new Error("Instagram publish requires a public imageUrl (HTTPS)");
  }

  try {
    const containerId = await createMediaContainer({ igId, token, caption, imageUrl });
    logger.debug(`📦 Instagram container_id: ${containerId}`);

    await waitForContainerReady(containerId, token);

    const publishId = await publishContainer(containerId, { igId, token });
    logger.debug(`📸 Instagram publish_id: ${publishId}`);
    return publishId;
  } catch (err) {
    const wrapped = wrapInstagramError(err, "publish");
    if (wrapped.code === "IG_TOKEN_EXPIRED") {
      logger.error("════════════════════════════════════════════════════════════");
      logger.error("🚨 Instagram access token expired or was revoked!");
      logger.error(`   Detail: ${formatInstagramError(err)}`);
      logger.error("   👉 Renew the token and update INSTAGRAM_ACCESS_TOKEN / FACEBOOK_PAGE_ACCESS_TOKEN.");
      logger.error("════════════════════════════════════════════════════════════");
    }
    throw wrapped;
  }
}

async function createMediaContainer({ igId, token, caption, imageUrl }) {
  const endpoint = `${BASE}/${igId}/media`;

  try {
    const { data } = await axios.post(
      endpoint,
      {
        image_url: imageUrl,
        caption: caption,
        access_token: token,
      },
      { timeout: 30000 },
    );

    if (!data.id) {
      throw new Error(`No container id in response: ${JSON.stringify(data)}`);
    }
    return data.id;
  } catch (err) {
    throw wrapInstagramError(err, "container creation");
  }
}

/**
 * Polls container status until FINISHED or a terminal error/timeout.
 * Handles IN_PROGRESS, FINISHED, ERROR, EXPIRED explicitly.
 */
async function waitForContainerReady(containerId, token, maxWaitMs = 90000) {
  const interval = 3000;
  let waited = 0;

  while (waited < maxWaitMs) {
    await new Promise((r) => setTimeout(r, interval));
    waited += interval;

    let data;
    try {
      ({ data } = await axios.get(`${BASE}/${containerId}`, {
        params: {
          fields: "status_code,status",
          access_token: token,
        },
        timeout: 15000,
      }));
    } catch (err) {
      throw wrapInstagramError(err, "container status check");
    }

    const statusCode = String(data.status_code || "UNKNOWN").toUpperCase();
    logger.debug(`⏳ Instagram container ${containerId} status: ${statusCode}`);

    if (statusCode === "FINISHED") return;
    if (statusCode === "IN_PROGRESS") continue;
    if (statusCode === "ERROR") {
      throw new Error(`Instagram container processing error (status=ERROR): ${JSON.stringify(data)}`);
    }
    if (statusCode === "EXPIRED") {
      throw new Error(`Instagram container expired before publish (status=EXPIRED): ${JSON.stringify(data)}`);
    }

    throw new Error(`Unexpected Instagram container status: ${JSON.stringify(data)}`);
  }

  throw new Error(`Instagram container not ready after ${Math.round(maxWaitMs / 1000)}s (container=${containerId})`);
}

async function publishContainer(containerId, { igId, token }) {
  const endpoint = `${BASE}/${igId}/media_publish`;

  try {
    const { data } = await axios.post(
      endpoint,
      {
        creation_id: containerId,
        access_token: token,
      },
      { timeout: 30000 },
    );

    if (!data.id) {
      throw new Error(`No publish id in response: ${JSON.stringify(data)}`);
    }
    return data.id;
  } catch (err) {
    throw wrapInstagramError(err, "media publish");
  }
}

module.exports = { publishToInstagram, isTokenError };
