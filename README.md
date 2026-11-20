# Gaming News Auto-Publisher Bot

A Node.js bot that scrapes gaming news, generates platform-specific captions with AI, creates branded images, and publishes to **Facebook** and **Instagram** with per-platform state tracking and retries.

- **Facebook:** Arabic headline + short caption (existing FB post style)
- **Instagram:** English headline + longer caption (hashtags/emojis allowed), published using a Cloudinary-hosted branded image URL

## Features

- **Multi-platform publishing**
  - Facebook (Arabic content)
  - Instagram (English content, two-step Graph API publish flow with container status polling)
- **Platform-aware AI generation**
  - Primary/fallback providers: **Gemini** and **Groq** (configurable)
  - Structured JSON output parsing with logging, corrective retry for malformed/truncated responses, and safe fallback behavior
- **Branded image generation**
  - Generates news images with overlay/headline rendering (`@napi-rs/canvas`)
  - English (Instagram) headline styling: main text white, important words/numbers highlighted
  - Arabic/mixed headline rendering path preserved for Facebook
- **Cloudinary image hosting (Instagram)**
  - Uploads generated branded image buffer to Cloudinary via REST API
  - Deterministic `public_id` per article/platform for idempotent uploads
- **State & reliability**
  - SQLite (`better-sqlite3`) persistence in `data/published.db*`
  - Per-platform publish status (`fb_ok`, `ig_ok`) and per-platform retry attempts
  - `MAX_POSTS_PER_CYCLE` counts distinct articles with at least one successful platform publish per cycle
  - Graceful shutdown handling (`SIGINT`/`SIGTERM`/`SIGQUIT`) in persistent mode
- **Scraping/enrichment optimizations**
  - Fetches metadata first, filters pending/retry-eligible articles, then enriches only needed candidates
  - Bounded-concurrency detail enrichment (`DETAIL_FETCH_CONCURRENCY`)
- **GitHub Actions workflow**
  - Scheduled/manual runs (`--once`) with concurrency control
  - Persists DB state by committing `data/published.db*` after runs (including on failure)

## How it works

1. Scrape latest news metadata from `TARGET_URL`
2. Check SQLite state to find articles pending for enabled platforms (respecting per-platform retry limits)
3. Enrich only pending candidates missing image/summary (bounded concurrency)
4. For each pending article/platform:
   - Generate platform-specific headline/caption via AI
   - Generate branded image
   - Publish to Facebook and/or upload+p publish to Instagram
   - Record per-platform success/failure and attempts in DB
5. In GitHub Actions, commit updated `data/published.db*` to persist dedupe/retry state across runs

## Requirements

- **Node.js** `>= 18` (workflow uses Node 20)
- npm
- API credentials for the platforms/providers you enable:
  - AI: Gemini and/or Groq
  - Facebook Page publishing (for Facebook)
  - Instagram Graph API + Cloudinary (for Instagram)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create your environment file:
   ```bash
   cp .env.example .env
   ```
3. Fill in `.env` with your API keys/credentials.
4. Run locally:
   ```bash
   npm start
   ```
   or run a single cycle (CI-style):
   ```bash
   node -r dotenv/config index.js --once
   ```

## Configuration (`.env`)

Copy from [`.env.example`](.env.example) and adjust as needed.

### AI providers
| Variable | Description | Default |
|---|---|---|
| `AI_PROVIDER` | Primary provider (`gemini` or `groq`), fallback to the other on failure | `gemini` |
| `GEMINI_API_KEY` | Google Gemini API key | - |
| `GEMINI_MODEL` | Gemini model name | `gemini-3.5-flash-lite` |
| `GROQ_API_KEY` | Groq API key | - |
| `GROQ_MODEL` | Groq model name | `openai/gpt-oss-120b` |

### Facebook (Arabic posts)
| Variable | Description | Default |
|---|---|---|
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Facebook Page access token | - |
| `FACEBOOK_PAGE_ID` | Facebook Page ID | - |
| `ENABLE_FACEBOOK` | Enable/disable Facebook publishing | auto/enabled when configured |

### Instagram (English posts, Cloudinary image hosting)
| Variable | Description | Default |
|---|---|---|
| `INSTAGRAM_ACCESS_TOKEN` | Instagram Graph API token (falls back to `FACEBOOK_PAGE_ACCESS_TOKEN` if unset) | - |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Instagram Business/Creator account ID | - |
| `ENABLE_INSTAGRAM` | Enable/disable Instagram publishing | auto/enabled when configured |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name (**required for Instagram**) | - |
| `CLOUDINARY_API_KEY` | Cloudinary API key (**required for Instagram**) | - |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret (**required for Instagram**) | - |
| `CLOUDINARY_FOLDER` | Cloudinary folder for uploads | `gaming-bot` |
| `CLOUDINARY_TAG` | Optional Cloudinary tag (supported by upload logic) | `gaming-bot` (code default) |

> Instagram publishing requires a public HTTPS `image_url`; this project uploads the generated branded image to Cloudinary and publishes that URL.

### Scraper / bot behavior
| Variable | Description | Default |
|---|---|---|
| `TARGET_URL` | News source/feed/page URL | `https://insider-gaming.com/category/news/feed/` |
| `MAX_ARTICLES` | Articles fetched/checked per cycle | `10` |
| `MAX_POSTS_PER_CYCLE` | Max distinct articles with >=1 successful platform publish per cycle (remaining deferred) | `2` |
| `MAX_PUBLISH_ATTEMPTS` | Per-platform failed publish attempts before giving up for an article/platform | `3` |
| `POST_DELAY_MS` | Delay between publish actions (ms) | `5000` |
| `DETAIL_FETCH_CONCURRENCY` | Bounded concurrency for article detail enrichment | `4` |
| `LOG_LEVEL` | Logger level | `info` |

> Note: `CRON_INTERVAL_MINUTES` appears in `.env.example`, but the persistent scheduler in `index.js` is currently fixed to every 15 minutes. In GitHub Actions, scheduling is controlled by `.github/workflows/bot.yml`.

## Scripts

| Command | Description |
|---|---|
| `npm start` | Run bot with dotenv (`node -r dotenv/config index.js`) |
| `npm run dev` | Run with nodemon + dotenv |
| `npm run test:scraper` | Scrape and print latest articles (JSON) |
| `npm run test:caption` | Generate sample Facebook + Instagram content via AI |
| `npm run status` | Print recent published records from SQLite |
| `npm run lint` | Lint `src/` and `index.js` (if ESLint is configured locally) |

### Useful one-off commands
```bash
# Single run (same mode used in GitHub Actions)
node -r dotenv/config index.js --once

# Facebook only / Instagram only (PowerShell example)
$env:ENABLE_FACEBOOK="false"; $env:ENABLE_INSTAGRAM="true"; node -r dotenv/config index.js --once

# Diagnostics (validates FB/IG/Cloudinary configuration)
node -r dotenv/config src/diagnose.js
```

## GitHub Actions

Workflow: [`.github/workflows/bot.yml`](.github/workflows/bot.yml)

- Triggers: schedule (`*/15 * * * *`), manual dispatch, and `repository_dispatch` (`run-bot`)
- Runs: `node index.js --once`
- Concurrency: single `gaming-bot-run` group (no cancel in progress)
- Persists state: commits `data/published.db*` via `stefanzweifel/git-auto-commit-action@v5` with `if: always()`
- Explicitly sets `ENABLE_FACEBOOK=true` and `ENABLE_INSTAGRAM=true` in the run environment

### Required repository secrets (set what you use)
- AI: `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GROQ_API_KEY`
- Facebook: `FACEBOOK_PAGE_ACCESS_TOKEN`, `FACEBOOK_PAGE_ID`
- Instagram: `INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_BUSINESS_ACCOUNT_ID`
- Cloudinary (for Instagram): `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` (optional)
- Scraper/behavior (optional): `TARGET_URL`, `MAX_ARTICLES`, `MAX_POSTS_PER_CYCLE`, `MAX_PUBLISH_ATTEMPTS`, `POST_DELAY_MS`

### Important: state persistence
This repo is configured to persist dedupe/retry state in git (`data/published.db*` is unignored for this purpose). If the DB state is not present on the branch, the first run after enabling persistence may repost once; subsequent runs should dedupe correctly once DB commits succeed.

## Troubleshooting

- **Only Facebook is enabled**
  - Instagram requires IG credentials **and** Cloudinary credentials. Check logs for the exact missing variables (runtime now reports why IG is unavailable).
- **Same news/posts repeated in GitHub Actions**
  - Ensure `data/published.db*` changes are being committed after runs and not ignored.
  - Check the "Commit Database Changes" step logs and repository push permissions/branch protections.
- **Instagram publish failures**
  - Verify IG Business/Creator account linkage and token permissions.
  - Ensure Cloudinary credentials are valid (image upload must return a public HTTPS URL).
- **AI failures/rate limits**
  - The bot retries transient provider errors and falls back between providers; verify model names/keys and provider quotas.
- **No platforms enabled**
  - Confirm credentials are set and `ENABLE_FACEBOOK` / `ENABLE_INSTAGRAM` are not explicitly disabled.

## Project structure

```text
.
├─ .github/workflows/bot.yml      # Scheduled/manual GitHub Actions workflow
├─ assets/                        # Fonts and overlay assets for image generation
├─ data/                          # SQLite DB files (published state/retries)
├─ src/
│  ├─ ai.js                       # AI provider integration and caption/headline generation
│  ├─ cloudinary.js               # Cloudinary REST upload (deterministic public_id)
│  ├─ db.js                       # SQLite schema, migrations, per-platform state/attempts
│  ├─ facebook.js                 # Facebook publishing
│  ├─ imageGenerator.js           # Branded image rendering
│  ├─ instagram.js                # Instagram container publish + polling
│  ├─ logger.js                   # Winston logger config
│  └─ scraper.js                  # Scraping, detail fetch, bounded enrichment
├─ index.js                       # Main orchestration (cron/once, retries, shutdown)
├─ .env.example                   # Environment variable template
└─ package.json
```

## Notes

- The bot stores publish history and per-platform retry state in SQLite; deleting `data/published.db*` resets dedupe/retry history.
- `index.js --once` is intended for CI/single-run execution; without `--once` it runs an initial cycle and schedules subsequent cycles every 15 minutes.