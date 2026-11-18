/**
 * 🤖 ai.js — Multi-Provider AI Caption Generator
 * ─────────────────────────────────────────────────
 * Supports two free providers, in the following order:
 *
 *  1. Gemini  ← generous free tier from Google  (gemini-3.5-flash-lite)
 *  2. Groq    ← fastest and best free tier  (openai/gpt-oss-120b)
 *
 * The provider is selected via: AI_PROVIDER=gemini | groq
 * If the first provider fails, the next one is tried automatically (Fallback).
 *
 * Platform-aware generation:
 *  - facebook: Arabic headline + short caption (FB style)
 *  - instagram: English headline + longer caption (hashtags/emojis allowed)
 */

const axios = require("axios");
const logger = require("./logger");

// ─── Default provider selection ─────────────────────────────────────────────
const DEFAULT_PROVIDER = (process.env.AI_PROVIDER || "gemini").toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════
//  Prompts
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_FB = `
You are an expert Arabic gaming social media content creator. Your job is to convert English gaming news into concise, punchy Arabic content matching a very specific personal writing style.

Return ONLY a valid JSON object (no markdown, no code fences, no extra text) with exactly these two string fields:

{
  "headline": "...",
  "caption": "..."
}

### Field Rules:

1. **"headline"** (the title drawn on the news image):
   - A clear, specific, and concise title, at most about 70 characters.
   - It MUST ALWAYS include the main game / entity name (the game title, platform, or studio).
   - Keep major game titles, platforms, and consoles in English capitalized form (e.g., GTA 6, THE LAST OF US 3, RED DEAD REDEMPTION 2, BATTLEFIELD 6, ASSASSIN'S CREED BLACK FLAG, PS5, PC, ROBLOX).
   - Arabic wording, natural and direct. No emojis. No hashtags. No URLs.

2. **"caption"** (the full post text):
   - The post body / details, WITHOUT repeating the headline.
   - Short, focused, and punchy: 1 to 3 short lines/sentences.
   - Modern, natural Arabic used by top gaming channels. Direct, exciting, and credible. Not overly colloquial street slang.
   - Keep major game titles, platforms, and consoles in English capitalized form.
   - If listing multiple studios/games/items, use clean bullet points with "◾️".
   - Minimal and purposeful emojis (0 to 2 maximum). Never spam emojis.
   - NO hashtags. NO URLs. NO intro greetings. NO commentary. NO questions to the audience.

### Output Rules:
- Return ONLY the JSON object.
- No markdown, no code fences, no explanations, no labels.

### Style Reference Examples:

Example 1:
{"headline": "نوتي دوج تعمل على THE LAST OF US 3", "caption": "لكنها لن تصدر قبل 2030 وليس قبل منتصف عمر PS6 🤔"}

Example 2:
{"headline": "دولة قطر تمنع لعبة ROBLOX", "caption": "بمزاعم تهديد سلامة الأطفال وأخلاقهم، وأيضاً للحفاظ على المراهقين من تعلم السلوكيات الضارة.."}

Example 3:
{"headline": "تسريبات: حصريات PS5 تصل إلى PC", "caption": "ستبدأ في الوصول بعد أشهر فقط من إطلاقها الأول"}

Example 4:
{"headline": "بيتا BATTLEFIELD 6 المفتوحة متاحة للجميع", "caption": "يمكن للجميع تجربتها الآن"}

Example 5:
{"headline": "RED DEAD REDEMPTION 2 تتجاوز 77 مليون نسخة", "caption": "تُعد الأكثر مبيعاً من حيث الإيرادات في السنوات السبع الأخيرة 🔥"}

Example 6:
{"headline": "GTA 6 لا يزال محدداً في 26 مايو 2026", "caption": "أكدت ROCKSTAR GAMES أن الموعد دون أي تغيير"}

Example 7:
{"headline": "سوني تلغي لعبتين خدماتيتين جديدتين", "caption": "ليصل مجموع ما تم إلغاؤه إلى 9 ألعاب من بداية الجيل\n◾️ إحداهما خدماتية في عالم God of War\n◾️ والأخرى كان يعمل عليها نفس استديو Days Gone.."}

Example 8:
{"headline": "توقعات: GTA 6 أول لعبة بسعر 100 دولار", "caption": "وستكون هي البداية لرفع أسعار الألعاب بعدها! 😶"}

Example 9:
{"headline": "ريميك ASSASSIN'S CREED BLACK FLAG قد يصدر في نوفمبر 2025", "caption": "أفضل أجزاء السلسلة قادمة من جديد 🔥"}

Example 10:
{"headline": "عام 2025 يبدأ بإغلاق ثلاثة استوديوهات!", "caption": "وهذه الاستوديوهات هي:\n◾️ Freejam (Robocraft)\n◾️ Counterplay Games (Godfall)\n◾️ Toadman Interactive (Immortal: Unchained, Killing Floor, Dead Island)"}
`.trim();

const SYSTEM_PROMPT_IG = `
You are an expert English gaming social media content creator for Instagram. Your job is to convert English gaming news into a clear, engaging headline and a longer Instagram caption.

Return ONLY a valid JSON object (no markdown, no code fences, no extra text) with exactly these two string fields:

{
  "headline": "...",
  "caption": "..."
}

### Field Rules:

1. **"headline"** (the title drawn on the news image):
   - A clear, specific, concise English title, at most about 70 characters.
   - It MUST ALWAYS include the main game / entity name (game title, platform, or studio).
   - Keep official game titles, platforms, and studios in their proper names/capitalization (e.g., GTA 6, The Last of Us Part III, Red Dead Redemption 2, Battlefield 6, Assassin's Creed Black Flag, PS5, PC, Roblox).
   - No emojis. No hashtags. No URLs.

2. **"caption"** (the Instagram post text):
   - Write in English. Longer than a short news blurb: about 3 to 5 sentences (roughly 350–900 characters) giving useful context/details from the source.
   - Engaging, informative, and credible. Do NOT repeat the headline as the first line.
   - Emojis are allowed and encouraged in moderation where they fit naturally.
   - Hashtags are allowed: include 3 to 8 relevant hashtags (e.g. game name, platform, #GamingNews) typically at the end.
   - NO URLs. No "link in bio" prompts. No questions to the audience required.

### Output Rules:
- Return ONLY the JSON object.
- No markdown, no code fences, no explanations, no labels.
`.trim();

const PLATFORM_CONFIG = {
  facebook: {
    systemPrompt: SYSTEM_PROMPT_FB,
    userInstruction:
      'Convert the following English gaming news into the JSON format described above for a Facebook post (Arabic). Return ONLY the JSON object with the "headline" and "caption" fields.',
    maxOutputTokens: 500,
    label: "Facebook (AR)",
  },
  instagram: {
    systemPrompt: SYSTEM_PROMPT_IG,
    userInstruction:
      'Convert the following English gaming news into the JSON format described above for an Instagram post (English, longer caption with hashtags/emojis allowed). Return ONLY the JSON object with the "headline" and "caption" fields.',
    maxOutputTokens: 900,
    label: "Instagram (EN)",
  },
};

function getPlatformConfig(platform) {
  const cfg = PLATFORM_CONFIG[platform];
  if (!cfg) throw new Error(`Unsupported platform: ${platform}`);
  return cfg;
}

function buildUserPrompt({ title, summary }, platform = "facebook") {
  const cfg = getPlatformConfig(platform);
  return `${cfg.userInstruction}

Title: ${title}
Summary: ${summary || "No summary provided"}

Return ONLY the JSON object with the "headline" and "caption" fields.`;
}

/**
 * Parses a provider's reply and returns a structured { headline, caption } object.
 * Tolerates replies wrapped in markdown fences, with a fallback to plain text.
 * @param {string} raw
 * @returns {{ headline: string, caption: string }}
 */
function parseStructured(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty response from the AI ​​provider");

  // Strip markdown fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Extract the first JSON object
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      const obj = JSON.parse(cleaned.slice(start, end + 1));
      const headline = String(obj.headline || "").trim();
      const caption = String(obj.caption || "").trim();
      if (headline || caption) return { headline, caption };
    } catch (e) {
      // Ignore the error and fall back below
    }
  }

  // fallback: treat the text as a plain caption (first line = headline)
  const lines = cleaned
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    headline: lines[0] || "",
    caption: lines.slice(1).join("\n") || cleaned,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Providers
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini({ title, summary }, platform) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY Not found in .env");

  const cfg = getPlatformConfig(platform);
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const { data } = await axios.post(
    url,
    {
      system_instruction: {
        parts: [{ text: cfg.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt({ title, summary }, platform) }],
        },
      ],
      generationConfig: {
        maxOutputTokens: cfg.maxOutputTokens,
        temperature: 0.85,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            headline: { type: "STRING" },
            caption: { type: "STRING" },
          },
          required: ["headline", "caption"],
        },
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 25000,
    },
  );

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini: Empty response");
  return text;
}

async function callGroq({ title, summary }, platform) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY Not found in .env");

  const cfg = getPlatformConfig(platform);
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

  const { data } = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model,
      max_tokens: cfg.maxOutputTokens,
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: cfg.systemPrompt },
        { role: "user", content: buildUserPrompt({ title, summary }, platform) },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 25000,
    },
  );

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq: Empty response");
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Provider map + Fallback order
// ═══════════════════════════════════════════════════════════════════════════

const PROVIDERS = {
  gemini: { fn: callGemini, label: "Gemini" },
  groq: { fn: callGroq, label: "Groq" },
};

function getFallbackOrder(primary) {
  const all = ["gemini", "groq"];
  return [primary, ...all.filter((p) => p !== primary)];
}

/**
 * Generates platform-specific headline and caption from article data.
 * @param {{ title: string, summary: string, link?: string }} article
 * @param {{ platform?: 'facebook'|'instagram' }} [options]
 * @returns {Promise<{ headline: string, caption: string, platform: string }>}
 */
async function generateContent(article, options = {}) {
  const platform = options.platform || "facebook";
  getPlatformConfig(platform); // validate

  const order = getFallbackOrder(DEFAULT_PROVIDER);
  let lastError;

  for (const providerKey of order) {
    const provider = PROVIDERS[providerKey];
    if (!provider) continue;

    try {
      logger.info(`🤖 Generating ${platform} content using ${provider.label}...`);
      const raw = await provider.fn(article, platform);
      const result = parseStructured(raw);

      if (!result.headline && !result.caption) {
        throw new Error("Reply without headline/caption");
      }

      logger.info(`✅ ${platform} content ready (${provider.label})`);
      return { ...result, platform };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;

      if (status === 429) {
        logger.warn(`⚠️  ${provider.label}: Rate limit exceeded (429) — trying next provider...`);
      } else if (status === 401 || status === 403) {
        logger.warn(`⚠️  ${provider.label}: Invalid key (${status}) — trying next provider...`);
      } else {
        logger.warn(`⚠️  ${provider.label}: ${err.message} — trying next provider...`);
      }
    }
  }

  throw new Error(`All AI providers have failed (${platform}): ${lastError?.message}`);
}

/**
 * Backward-compatible wrapper (defaults to Facebook/Arabic).
 */
async function generateCaption(article) {
  const { headline, caption } = await generateContent(article, { platform: "facebook" });
  return { headline, caption };
}

module.exports = { generateCaption, generateContent, parseStructured };
