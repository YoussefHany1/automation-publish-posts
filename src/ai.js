/**
 * 🤖 ai.js — Multi-Provider AI Caption Generator
 * ─────────────────────────────────────────────────
 * يدعم 3 مزوّدين مجانيين بالترتيب التالي:
 *
 *  1. Groq       ← الأسرع والأفضل مجاناً  (llama-3.3-70b)
 *  2. Gemini     ← مجاني بسخاء من Google  (gemini-1.5-flash)
 *  3. OpenAI     ← احتياطي (يحتاج بطاقة) (gpt-4o-mini)
 *
 * يُحدَّد المزوّد عبر: AI_PROVIDER=groq | gemini | openai
 * وإذا فشل المزوّد الأول يُجرَّب التالي تلقائياً (Fallback).
 */

const axios   = require("axios");
const logger  = require("./logger");

// ─── اختيار المزوّد الافتراضي ─────────────────────────────────────────────
const DEFAULT_PROVIDER = (process.env.AI_PROVIDER || "groq").toLowerCase();

// ═══════════════════════════════════════════════════════════════════════════
//  Prompts (مشتركة بين كل المزوّدين)
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `
أنت كاتب محتوى سوشال ميديا مصري بيتكلم بأسلوب طبيعي جدًا وعفوي، كأنك بتكلم صحابك مش بتكتب خبر رسمي. هيجيلك أخبار ألعاب بالإنجليزي — مهمتك تحولها لكابشن عربي باللهجة المصرية، خفيف، سريع، وفيه روح.

**اشتراطات الإخراج:**
- أخرج **الكابشن فقط** بدون أي مقدمة أو شرح.
- ممنوع روابط أو هاشتاجات.
- استخدم أسلوب: عنوان جذاب قصير، وبعده سطر أو سطرين شرح.
- خليك بسيط وعفوي: استخدم تعبيرات زي (واضح إن، شكلها، الموضوع باين، الناس مش عاجبها، حلوة الصراحة، إلخ)
- ينفع تضيف تعليق خفيف منك أو إحساس الناس، بس من غير مبالغة أو تأليف.
- استخدم إيموجي بشكل خفيف ولطيف (:sweat_smile::confused::fire::upside_down::sleeping:) على حسب السياق.
- خلي الكلام بشري وطبيعي، وابعد عن الصياغة الرسمية أو الروبوتية.
- حافظ على الأرقام وأسماء الألعاب زي ما هي.

**شكل الكابشن:**
عنوان بسيط!
سطر شرح كده خفيف يوصل الفكرة بسرعة

**المُدخل:** أخبار باللغة الإنجليزية  
**المُخرج:** الكابشن العربي فقط بنفس الأسلوب ده
`.trim();

function buildUserPrompt({ title, summary }) {
  return `اكتب كابشن سوشيال ميديا للخبر التالي:

📰 العنوان: ${title}

📝 الملخص: ${summary || "لا يوجد ملخص"}

المصدر: Destructoid Gaming News`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  المزوّد 1: Groq (مجاني — الأسرع)
//  سجّل على: https://console.groq.com → API Keys
//  الحد المجاني: 14,400 طلب/يوم | 6,000 token/دقيقة
// ═══════════════════════════════════════════════════════════════════════════

async function callGroq({ title, summary }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY غير موجود في .env");

  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const { data } = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model,
      max_tokens: 400,
      temperature: 0.85,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildUserPrompt({ title, summary }) },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq: رد فارغ");
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  المزوّد 2: Google Gemini (مجاني)
//  سجّل على: https://aistudio.google.com/app/apikey
//  الحد المجاني: 1,500 طلب/يوم | 1,000,000 token/يوم
// ═══════════════════════════════════════════════════════════════════════════

async function callGemini({ title, summary }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY غير موجود في .env");

  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const { data } = await axios.post(
    url,
    {
      system_instruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        {
          role: "user",
          parts: [{ text: buildUserPrompt({ title, summary }) }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.85,
      },
    },
    {
      headers: { "Content-Type": "application/json" },
      timeout: 20000,
    }
  );

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!text) throw new Error("Gemini: رد فارغ");
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  المزوّد 3: OpenAI (احتياطي — يحتاج بطاقة)
//  سجّل على: https://platform.openai.com/api-keys
// ═══════════════════════════════════════════════════════════════════════════

async function callOpenAI({ title, summary }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY غير موجود في .env");

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const { data } = await axios.post(
    "https://api.openai.com/v1/chat/completions",
    {
      model,
      max_tokens: 400,
      temperature: 0.85,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildUserPrompt({ title, summary }) },
      ],
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 20000,
    }
  );

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("OpenAI: رد فارغ");
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
//  خريطة المزوّدين + ترتيب الـ Fallback
// ═══════════════════════════════════════════════════════════════════════════

const PROVIDERS = {
  groq:   { fn: callGroq,   label: "Groq (llama-3.3-70b)" },
  gemini: { fn: callGemini, label: "Gemini 1.5 Flash"      },
  openai: { fn: callOpenAI, label: "OpenAI gpt-4o-mini"    },
};

function getFallbackOrder(primary) {
  const all = ["groq", "gemini", "openai"];
  return [primary, ...all.filter((p) => p !== primary)];
}

// ═══════════════════════════════════════════════════════════════════════════
//  الدالة الرئيسية — مع Retry + Fallback تلقائي
// ═══════════════════════════════════════════════════════════════════════════

/**
 * يولّد كابشن سوشيال ميديا من بيانات المقال.
 * @param {{ title: string, summary: string, link: string }} article
 * @returns {Promise<string>} الكابشن الجاهز
 */
async function generateCaption({ title, summary, link }) {
  const order = getFallbackOrder(DEFAULT_PROVIDER);
  let lastError;

  for (const providerKey of order) {
    const provider = PROVIDERS[providerKey];
    if (!provider) continue;

    try {
      logger.info(`🤖 Generating caption using ${provider.label}...`);
      const caption = await provider.fn({ title, summary });

      const final = caption

      logger.info(`✅ Caption ready (${provider.label})`);
      return final;

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

  throw new Error(`فشلت جميع مزوّدي الـ AI: ${lastError?.message}`);
}

module.exports = { generateCaption };