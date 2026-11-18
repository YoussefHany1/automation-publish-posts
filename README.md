# 🎮 Gaming News Auto-Publisher Bot

> يراقب مصدر أخبار ألعاب (RSS/HTML)، يُنشئ محتوى بالـ AI لكل منصة، وينشر تلقائيًا على **Facebook** (عربي) و **Instagram** (إنجليزي).

- **Facebook**: عنوان/كابشن بالعربية (أسلوب قصير ومباشر) + صورة مبرندة مولّدة محليًا.
- **Instagram**: عنوان/كابشن بالإنجليزية (أطول، مع إيموجي/هاشتاغات مسموحة) + صورة مبرندة مولّدة محليًا ثم رفعها إلى **Cloudinary** للحصول على رابط عام (متطلب Instagram Graph API).
- **إعادة المحاولة لكل منصة**: إذا نجح النشر على منصة وفشل على الأخرى، يحتفظ البوت بالحالة ويعيد محاولة المنصة الفاشلة فقط في الدورات التالية.

---

## 🗂️ هيكل المشروع

```
gaming-bot/
├── index.js              ← نقطة البداية + Cron Scheduler + تنسيق النشر لكل منصة
├── .env.example          ← قالب المتغيرات البيئية
├── package.json
├── src/
│   ├── scraper.js        ← جلب المقالات (RSS/HTML) مع fallback
│   ├── ai.js             ← توليد المحتوى (Gemini/Groq) حسب المنصة/اللغة
│   ├── imageGenerator.js ← توليد صور مبرندة (عنوان عربي/إنجليزي)
│   ├── cloudinary.js     ← رفع الصورة إلى Cloudinary (لـ Instagram)
│   ├── facebook.js       ← النشر على Facebook Graph API
│   ├── instagram.js      ← النشر على Instagram Graph API (Container + Publish)
│   ├── db.js             ← SQLite: حالة النشر لكل منصة + محاولات مستقلة
│   ├── diagnose.js       ← أداة تشخيص الإعدادات
│   └── logger.js         ← Winston Logger
├── data/
│   └── published.db      ← (يُنشأ تلقائيًا)
└── logs/
    ├── combined.log
    └── error.log
```

---

## ⚙️ خطوات الإعداد

### 1️⃣ تثبيت المشروع

```bash
git clone <repo> && cd gaming-bot
npm install
cp .env.example .env
```

### 2️⃣ مزودات الذكاء الاصطناعي (Gemini / Groq)

يدعم البوت مزودين مع fallback تلقائي (يمكن اختيار الأساسي عبر `AI_PROVIDER`):

- **Gemini**: https://aistudio.google.com/app/apikey → `GEMINI_API_KEY`
- **Groq**: https://console.groq.com → `GROQ_API_KEY`

في `.env`:
```
AI_PROVIDER=gemini
GEMINI_API_KEY=...
# GEMINI_MODEL=gemini-3.5-flash-lite
GROQ_API_KEY=...
# GROQ_MODEL=openai/gpt-oss-120b
```

> ملاحظة: يتم توليد محتوى مختلف لكل منصة (Facebook عربي قصير، Instagram إنجليزي أطول مع هاشتاغات/إيموجي).

### 3️⃣ Facebook Page Access Token (للنشر بالعربية)

1. أنشئ/استخدم Facebook App مع **Pages API**.
2. من **Graph API Explorer** احصل على صلاحيات: `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`.
3. حوّل التوكن إلى Long-Lived ثم احصل على **Page Access Token** عبر `/me/accounts`.
4. في `.env`:
   ```
   FACEBOOK_PAGE_ACCESS_TOKEN=EAAxxxx
   FACEBOOK_PAGE_ID=123456789012345
   # ENABLE_FACEBOOK=true
   ```

### 4️⃣ Instagram Graph API (للنشر بالإنجليزية) + Cloudinary

> Instagram Graph API يتطلب `image_url` عام (HTTPS). لذلك يستخدم البوت **Cloudinary** لرفع الصورة المبرندة المولّدة ثم نشرها على Instagram.

**Instagram/Facebook:**
- حساب Instagram يجب أن يكون Business/Creator ومربوطًا بصفحة Facebook.
- صلاحيات مطلوبة: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement`.
- احصل على `INSTAGRAM_BUSINESS_ACCOUNT_ID` من: `GET /{page-id}?fields=instagram_business_account`

**Cloudinary:**
- أنشئ حسابًا واحصل على `Cloud Name`, `API Key`, `API Secret`.
- يرفع البوت الصور بمعرّف ثابت (deterministic `public_id`) مع `overwrite: true` لتجنّب تكرار الملفات عند إعادة المحاولة.

في `.env`:
```
INSTAGRAM_ACCESS_TOKEN=EAAxxxx   # يمكن أن يكون نفس Page Token إن كان صالحًا
INSTAGRAM_BUSINESS_ACCOUNT_ID=17841400000000000
# ENABLE_INSTAGRAM=true

CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
CLOUDINARY_FOLDER=gaming-bot
```

> لتشخيص الإعدادات: `node -r dotenv/config src/diagnose.js`

---

## 🚀 التشغيل

```bash
# تشغيل عادي (Cron محلي)
npm start

# تشغيل مرة واحدة (مناسب لـ GitHub Actions)
node index.js --once

# تشغيل في وضع التطوير (مع إعادة تشغيل تلقائي)
npm run dev

# اختبار الـ Scraper فقط
npm run test:scraper

# اختبار توليد المحتوى (Facebook عربي + Instagram إنجليزي)
npm run test:caption

# عرض آخر المقالات المنشورة وحالتها
npm run status

# تشخيص إعدادات Facebook/Instagram/Cloudinary
node -r dotenv/config src/diagnose.js
```

---

## 🎛️ متغيرات السلوك

| المتغير                | الافتراضي | الوصف                                                        |
|------------------------|-----------|--------------------------------------------------------------|
| `MAX_POSTS_PER_CYCLE`  | `2`       | أقصى عدد **مقالات** تحقق نشرًا ناجحًا على منصة واحدة على الأقل في الدورة (مع محاولة كل المنصات المعلّقة لنفس المقال ضمن نفس الدورة) |
| `MAX_PUBLISH_ATTEMPTS` | `3`       | عدد محاولات النشر الفاشلة **لكل منصة** لكل مقال قبل إيقاف إعادة المحاولة لتلك المنصة |
| `POST_DELAY_MS`        | `5000`    | فاصل زمني بين عمليات النشر (ملّي ثانية)                     |
| `MAX_ARTICLES`         | `10`      | عدد المقالات التي تُفحص في كل دورة                            |
| `ENABLE_FACEBOOK`      | auto      | تفعيل/تعطيل Facebook (افتراضيًا: عند توفر بيانات الاعتماد)     |
| `ENABLE_INSTAGRAM`     | auto      | تفعيل/تعطيل Instagram (افتراضيًا: عند توفر بيانات IG + Cloudinary) |

> **سلوك الحالة/إعادة المحاولة:** يتم تتبع النجاح والمحاولات **لكل منصة** (`fb_ok`, `ig_ok`). إذا نجحت منصة وفشلت الأخرى، تُحفظ الحالة ويُعاد المحاولة للمنصة الفاشلة فقط في الدورات التالية.

---

## 🔄 سير العمل (مختصر)

```
Cron / --once
  -> Scrape articles
  -> For each article (until MAX_POSTS_PER_CYCLE articles with >=1 successful publish):
       - Determine pending platforms (enabled, not ok, attempts < MAX_PUBLISH_ATTEMPTS)
       - Generate platform-specific content (AR for FB, EN+hashtags/emojis for IG)
       - Generate branded image(s)
       - IG: upload image buffer to Cloudinary (deterministic public_id, overwrite)
       - Publish per platform, record per-platform success/failure
       - Persist status in SQLite (partial progress kept)
```

---

## ⚠️ حدود وتنبيهات

| الخدمة      | ملاحظات                                                                 |
|-------------|-------------------------------------------------------------------------|
| Facebook    | حدود نشر يومية حسب الصفحة/التطبيق؛ يجب تجديد التوكن عند انتهاء صلاحيته    |
| Instagram   | حتى 25 منشور/يوم للحساب؛ الصورة يجب أن تكون رابط HTTPS عام؛ قد يستغرق تجهيز الحاوية وقتًا |
| Cloudinary  | يُستخدم لاستضافة صور Instagram؛ البوت يعيد استخدام نفس `public_id` لتقليل التكرار |
| AI Providers| Gemini/Groq لديهم حدود معدل واستهلاك؛ يوجد fallback تلقائي بين المزودين  |

---

## 🛡️ نصائح الأمان

- **لا تُضِف `.env` إلى Git** — أضفه لـ `.gitignore`
- جدّد الـ Access Tokens كل 60 يوم
- استخدم `pm2` للإبقاء على Bot يعمل في production:

```bash
npm install -g pm2
pm2 start "npm start" --name gaming-bot
pm2 save && pm2 startup
```
