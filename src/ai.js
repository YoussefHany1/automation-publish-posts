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

function buildUserPrompt({ title, summary }, platform = "facebook", opts = {}) {
  const cfg = getPlatformConfig(platform);
  const strictHint = opts.strictJson
    ? "\nIMPORTANT: Your previous response was malformed or truncated. Return a COMPLETE, valid JSON object only (properly closed), with no extra text."
    : "";
  return `${cfg.userInstruction}${strictHint}

Title: ${title}
Summary: ${summary || "No summary provided"}

Return ONLY the JSON object with the "headline" and "caption" fields.`;
}

function makeParseError(message, details = {}) {
  const err = new Error(message);
  err.code = "AI_PARSE_ERROR";
  Object.assign(err, details);
  return err;
}

function isLikelyTruncatedJson(cleaned, parseErrorMessage = "") {
  if (!cleaned) return false;
  const msg = String(parseErrorMessage || "").toLowerCase();
  if (/unexpected end|unterminated|end of json|unexpected eof/.test(msg)) return true;
  const trimmed = cleaned.trimEnd();
  if (trimmed.startsWith("{") && !trimmed.endsWith("}")) return true;
  if (trimmed.startsWith("[") && !trimmed.endsWith("]")) return true;
  // common truncation: ends mid-string or mid-object without closing quote/brace
  if (trimmed.startsWith("{") && /["\\,:[]$/.test(trimmed.slice(-1)) && !trimmed.endsWith("}")) return true;
  return false;
}

function parsePlainTextFallback(cleaned) {
  const lines = String(cleaned || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    headline: lines[0] || "",
    caption: lines.slice(1).join("\n") || String(cleaned || "").trim(),
  };
}

/**
 * Parses a provider's reply and returns a structured { headline, caption } object.
 * Throws AI_PARSE_ERROR for malformed/truncated JSON attempts (retryable with correction).
 * Falls back to plain text only for non-JSON responses (last resort).
 * @param {string} raw
 * @returns {{ headline: string, caption: string }}
 */
function parseStructured(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Empty response from the AI provider");

  // Strip markdown fences if present
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const looksLikeJson = cleaned.startsWith("{") || cleaned.startsWith("```") || start !== -1;

  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      const obj = JSON.parse(candidate);
      const headline = String(obj.headline || "").trim();
      const caption = String(obj.caption || "").trim();
      if (headline || caption) return { headline, caption };
      throw makeParseError("Parsed JSON missing headline/caption", {
        retryable: true,
        truncated: false,
        rawLength: text.length,
      });
    } catch (e) {
      if (e && e.code === "AI_PARSE_ERROR") throw e;
      const truncated = isLikelyTruncatedJson(candidate, e.message);
      const snippet = cleaned.slice(0, 220).replace(/\s+/g, " ");
      logger.warn(
        `⚠️  AI JSON parse failed (${truncated ? "likely truncated" : "malformed"}): ${e.message} | len=${text.length} | snippet="${snippet}${cleaned.length > 220 ? "…" : ""}"`,
      );
      throw makeParseError(`AI JSON parse failed: ${e.message}`, {
        retryable: true,
        truncated,
        rawLength: text.length,
        cause: e,
      });
    }
  }

  // JSON-like but no complete object found (common truncation: missing closing brace)
  if (looksLikeJson && start !== -1) {
    const truncated = isLikelyTruncatedJson(cleaned, "missing closing brace");
    const snippet = cleaned.slice(0, 220).replace(/\s+/g, " ");
    logger.warn(
      `⚠️  AI response looks like incomplete JSON (${truncated ? "likely truncated" : "malformed"}): len=${text.length} | snippet="${snippet}${cleaned.length > 220 ? "…" : ""}"`,
    );
    throw makeParseError("AI response is incomplete/malformed JSON", {
      retryable: true,
      truncated,
      rawLength: text.length,
    });
  }

  // Last resort: plain-text response (not a JSON attempt)
  logger.warn(`⚠️  AI response was not JSON; using plain-text fallback (len=${text.length})`);
  return parsePlainTextFallback(cleaned);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Providers
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini({ title, summary }, platform, callOpts = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY Not found in .env");

  const cfg = getPlatformConfig(platform);
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxOutputTokens = callOpts.maxOutputTokens || cfg.maxOutputTokens;

  const { data } = await axios.post(
    url,
    {
      system_instruction: {
        parts: [{ text: cfg.systemPrompt }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt({ title, summary }, platform, callOpts) }],
        },
      ],
      generationConfig: {
        maxOutputTokens,
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
  if (!text) {
    const finish = data.candidates?.[0]?.finishReason;
    throw new Error(`Gemini: Empty response${finish ? ` (finishReason=${finish})` : ""} [model=${model}]`);
  }
  return text;
}

async function callGroq({ title, summary }, platform, callOpts = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY Not found in .env");

  const cfg = getPlatformConfig(platform);
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
  const maxTokens = callOpts.maxOutputTokens || cfg.maxOutputTokens;

  const { data } = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model,
      max_tokens: maxTokens,
      temperature: 0.85,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: cfg.systemPrompt },
        { role: "user", content: buildUserPrompt({ title, summary }, platform, callOpts) },
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
  if (!text) {
    const finish = data.choices?.[0]?.finish_reason;
    throw new Error(`Groq: Empty response${finish ? ` (finish_reason=${finish})` : ""} [model=${model}]`);
  }
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
  const cfg = getPlatformConfig(platform); // validate

  const order = getFallbackOrder(DEFAULT_PROVIDER);
  let lastError;

  for (const providerKey of order) {
    const provider = PROVIDERS[providerKey];
    if (!provider) continue;

    let transientRetried = false;
    let correctiveParseRetried = false;
    let callOpts = {};
    let lastParseFailure = null;

    while (true) {
      let raw;
      try {
        const mode = callOpts.strictJson ? " (corrective JSON retry)" : (callOpts._retryLabel || "");
        logger.info(`🤖 Generating ${platform} content using ${provider.label}...${mode}`);
        raw = await provider.fn(article, platform, callOpts);

        let result;
        try {
          result = parseStructured(raw);
        } catch (parseErr) {
          const isParseError = parseErr && parseErr.code === "AI_PARSE_ERROR";
          if (isParseError && parseErr.retryable && !correctiveParseRetried) {
            correctiveParseRetried = true;
            lastParseFailure = parseErr;
            const bumpedTokens = Math.max(cfg.maxOutputTokens + 300, Math.ceil(cfg.maxOutputTokens * 1.5));
            callOpts = { ...callOpts, strictJson: true, maxOutputTokens: bumpedTokens, _retryLabel: "" };
            logger.warn(
              `⚠️  ${provider.label}: ${parseErr.truncated ? "truncated/malformed JSON" : "invalid structured output"} — corrective retry (maxOutputTokens=${bumpedTokens})`,
            );
            continue;
          }

          // Last resort after corrective retry (or non-retryable parse shape): salvage plain text if possible
          if (isParseError) {
            try {
              const cleaned = String(raw || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
              const salvaged = parsePlainTextFallback(cleaned);
              if (salvaged.headline || salvaged.caption) {
                logger.warn(`⚠️  ${provider.label}: using plain-text salvage after structured parse failure`);
                return { ...salvaged, platform };
              }
            } catch {}
          }
          throw parseErr;
        }

        if (!result.headline && !result.caption) {
          throw makeParseError("Reply without headline/caption", { retryable: true, rawLength: String(raw || "").length });
        }

        logger.info(`✅ ${platform} content ready (${provider.label})`);
        return { ...result, platform };
      } catch (err) {
        lastError = err;
        const status = err.response?.status;

        // Transient HTTP/provider errors: retry same provider once with delay
        const isTransientHttp = status === 429 || (status >= 500 && status < 600);
        if (isTransientHttp && !transientRetried) {
          transientRetried = true;
          const delayMs = status === 429 ? 3000 : 2000;
          callOpts = { ...callOpts, _retryLabel: " (transient retry)" };
          logger.warn(`⚠️  ${provider.label}: transient error (${status}) — retrying in ${delayMs / 1000}s...`);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }

        const isParseError = err && err.code === "AI_PARSE_ERROR";
        if (status === 429) {
          logger.warn(`⚠️  ${provider.label}: Rate limit exceeded (429) — trying next provider... [model=${providerKey}]`);
        } else if (status === 401 || status === 403) {
          logger.warn(`⚠️  ${provider.label}: Invalid key/auth (${status}) — trying next provider...`);
        } else if (isParseError) {
          logger.warn(`⚠️  ${provider.label}: structured output invalid — trying next provider...`);
        } else {
          logger.warn(`⚠️  ${provider.label}: ${err.message} — trying next provider...`);
        }
        break;
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
