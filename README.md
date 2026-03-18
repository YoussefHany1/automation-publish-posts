# 🎮 Gaming News Auto-Publisher Bot

> يراقب موقع **Destructoid**، يُنشئ كابشن بالـ AI، وينشر تلقائيًا على **Facebook** و **Instagram**.

---

## 🗂️ هيكل المشروع

```
gaming-bot/
├── index.js              ← نقطة البداية + Cron Scheduler
├── .env.example          ← قالب المتغيرات البيئية
├── package.json
├── src/
│   ├── scraper.js        ← جلب المقالات من Destructoid (Cheerio)
│   ├── ai.js             ← توليد الكابشن (OpenAI)
│   ├── facebook.js       ← النشر على Facebook Graph API
│   ├── instagram.js      ← النشر على Instagram Graph API
│   ├── db.js             ← SQLite لمنع التكرار
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

---

### 2️⃣ OpenAI API Key

1. اذهب إلى: https://platform.openai.com/api-keys
2. Create new secret key → انسخها
3. في `.env`:
   ```
   OPENAI_API_KEY=sk-xxxx
   OPENAI_MODEL=gpt-4o-mini    # الأرخص والأسرع
   ```

---

### 3️⃣ Facebook Page Access Token

#### أ) إنشاء الـ App
1. اذهب إلى: https://developers.facebook.com/
2. **My Apps → Create App → Business**
3. App Name: `Gaming Bot` → Create App

#### ب) إضافة Pages API
- من لوحة التحكم: **Add Product → Pages API**

#### ج) الحصول على Access Token
1. اذهب إلى: **Tools → Graph API Explorer**
2. من القائمة العلوية، اختر **App** الخاصة بك
3. اختر **User Token** → Add Permissions:
   - ✅ `pages_manage_posts`
   - ✅ `pages_read_engagement`
   - ✅ `pages_show_list`
4. انقر **Generate Access Token** → وافق على الأذونات
5. **قم بتحويله لـ Long-Lived Token (60 يوم):**

```bash
# استبدل القيم بـ App ID و App Secret من Settings > Basic
curl "https://graph.facebook.com/oauth/access_token\
?grant_type=fb_exchange_token\
&client_id={APP_ID}\
&client_secret={APP_SECRET}\
&fb_exchange_token={SHORT_USER_TOKEN}"
```

6. **احصل على Page Token الدائم:**

```bash
curl "https://graph.facebook.com/me/accounts?access_token={LONG_LIVED_USER_TOKEN}"
# ستجد في النتيجة: { "access_token": "...", "id": "PAGE_ID" }
```

7. في `.env`:
   ```
   FACEBOOK_PAGE_ACCESS_TOKEN=EAAxxxx   # Page Token (وليس User Token)
   FACEBOOK_PAGE_ID=123456789012345
   ```

---

### 4️⃣ Instagram Graph API

> **شرط مسبق**: Instagram Business/Creator Account مربوط بـ Facebook Page

#### أ) ربط الحسابات
- في Instagram: Settings → Account → Switch to Professional Account
- في Facebook Page: Settings → Instagram → Connect Account

#### ب) إضافة Instagram في الـ App
- Facebook Developer App → **Add Product → Instagram Graph API**

#### ج) Permissions
في Graph API Explorer أضف:
- ✅ `instagram_basic`
- ✅ `instagram_content_publish`
- ✅ `pages_read_engagement`

#### د) الحصول على Instagram Business Account ID

```bash
# أولاً: احصل على Page ID
curl "https://graph.facebook.com/me/accounts?access_token={PAGE_TOKEN}"

# ثانياً: احصل على Instagram Account ID
curl "https://graph.facebook.com/{PAGE_ID}?fields=instagram_business_account&access_token={PAGE_TOKEN}"
# { "instagram_business_account": { "id": "17841400000000000" } }
```

7. في `.env`:
   ```
   INSTAGRAM_ACCESS_TOKEN=EAAxxxx    # نفس Page Token
   INSTAGRAM_BUSINESS_ACCOUNT_ID=17841400000000000
   ```

---

## 🚀 التشغيل

```bash
# تشغيل عادي
npm start

# تشغيل في وضع التطوير (مع إعادة تشغيل تلقائي)
npm run dev

# اختبار الـ Scraper فقط
npm run test:scraper

# اختبار الـ AI Caption فقط
npm run test:caption

# عرض آخر المقالات المنشورة
npm run status
```

---

## 🔄 سير العمل

```
┌─────────────────┐
│  Cron (15 min)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐    مكرر؟
│ Scrape News     │──────────► تخطّي
│ (Destructoid)   │
└────────┬────────┘
         │ جديد
         ▼
┌─────────────────┐
│  OpenAI API     │
│  توليد كابشن    │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌───────┐ ┌──────────┐
│  FB   │ │    IG    │
│ Page  │ │ Business │
└───┬───┘ └────┬─────┘
    │           │
    ▼           ▼
┌─────────────────────┐
│  SQLite: حفظ الـ URL │
└─────────────────────┘
```

---

## ⚠️ حدود API

| الخدمة      | الحد                                    |
|-------------|-----------------------------------------|
| Facebook    | 200 نشرة/يوم للصفحة                     |
| Instagram   | 25 نشرة/يوم                             |
| OpenAI      | حسب خطتك (gpt-4o-mini رخيص جداً)        |
| Destructoid | لا توجد قيود — نقرأ فقط                 |

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
