const axios = require("axios");
const crypto = require("crypto");
const FormData = require("form-data");
const logger = require("./logger");

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder = (process.env.CLOUDINARY_FOLDER || "gaming-bot").trim();
  const tag = (process.env.CLOUDINARY_TAG || "gaming-bot").trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.",
    );
  }

  return { cloudName, apiKey, apiSecret, folder, tag };
}

function deterministicPublicId(articleUrl, platform = "instagram") {
  const hash = crypto
    .createHash("sha256")
    .update(String(articleUrl || ""))
    .digest("hex")
    .slice(0, 16);
  const suffix = platform === "instagram" ? "ig" : platform;
  return `${suffix}_${hash}`;
}

function signParams(paramsToSign, apiSecret) {
  const toSign = Object.keys(paramsToSign)
    .filter((k) => paramsToSign[k] !== undefined && paramsToSign[k] !== null && paramsToSign[k] !== "")
    .sort()
    .map((k) => `${k}=${paramsToSign[k]}`)
    .join("&");
  return crypto.createHash("sha1").update(toSign + apiSecret).digest("hex");
}

/**
 * Uploads an image buffer to Cloudinary using a deterministic public_id.
 * Retries overwrite the same asset to avoid duplicate storage usage.
 *
 * @param {Buffer} buffer
 * @param {{ articleUrl: string, platform?: string }} options
 * @returns {Promise<{ url: string, secureUrl: string, publicId: string }>}
 */
async function uploadImageBuffer(buffer, { articleUrl, platform = "instagram" } = {}) {
  if (!buffer) throw new Error("uploadImageBuffer: image buffer is required");
  if (!articleUrl) throw new Error("uploadImageBuffer: articleUrl is required for deterministic public_id");

  const { cloudName, apiKey, apiSecret, folder, tag } = getCloudinaryConfig();
  const publicIdBase = deterministicPublicId(articleUrl, platform);
  const publicId = folder ? `${folder}/${publicIdBase}` : publicIdBase;
  const timestamp = Math.floor(Date.now() / 1000);

  const paramsToSign = {
    overwrite: "true",
    public_id: publicId,
    tags: tag,
    timestamp,
  };
  const signature = signParams(paramsToSign, apiSecret);

  const form = new FormData();
  form.append("file", buffer, { filename: `${publicIdBase}.png`, contentType: "image/png" });
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("public_id", publicId);
  form.append("overwrite", "true");
  form.append("tags", tag);

  const endpoint = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;

  try {
    const { data } = await axios.post(endpoint, form, {
      headers: form.getHeaders(),
      timeout: 45000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const secureUrl = data.secure_url || data.url;
    if (!secureUrl) {
      throw new Error(`Cloudinary upload returned no URL: ${JSON.stringify(data)}`);
    }

    logger.info(`☁️  Uploaded image to Cloudinary (${publicId})`);
    return {
      url: data.url || secureUrl,
      secureUrl,
      publicId: data.public_id || publicId,
    };
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    throw new Error(`Cloudinary upload failed: ${detail}`);
  }
}

module.exports = { uploadImageBuffer, deterministicPublicId };
