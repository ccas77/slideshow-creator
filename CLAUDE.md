# CLAUDE.md

## What This App Does

Slideshow Creator is a multi-user SaaS for creating and auto-posting TikTok/Instagram slideshows from book quotes and excerpts. Users log in via Google OAuth, manage books and slideshows, configure per-account automated posting schedules, and generate "Top N" book list videos.

Deployed at: `www.bookpulls.com`
GitHub: `ccas77/slideshow-creator`

**This is a multi-user app — distinct from the single-user Generator app (slideshow-generator).** The two apps share the same PostBridge API but must never mix accounts or data.

## Tech Stack

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **Styling**: Tailwind CSS 4, Framer Motion
- **Database**: Upstash Redis (sole database — all users, books, configs stored here)
- **Auth**: Google OAuth 2.0, JWT sessions via `jose`
- **AI**: Google Gemini (`@google/genai`) for image generation, Anthropic Claude for slide text generation
- **Image rendering**: `@resvg/resvg-js` (SVG to PNG), `sharp` (image processing)
- **Video**: `ffmpeg-static` + `fluent-ffmpeg` (image sequences to MP4)
- **Publishing**: PostBridge API (TikTok/Instagram posting)
- **Hosting**: Vercel

## Authentication

- **Google OAuth only** — no passwords, no local accounts. Flow: `/api/auth/login` → Google → `/api/auth/callback/google` → JWT session cookie.
- **Invite-only** — users must be added by an admin. If a Google email isn't in Redis, login is rejected with `not_invited`.
- **Bootstrap admin** — on first login, if the Google email matches `ADMIN_EMAIL` env var, an admin account is auto-created (`lib/auth.ts:91-97`).
- **Sessions** — JWT (HS256) signed with `AUTH_SECRET`, stored in httpOnly cookie `sc_session`, 30-day TTL. Payload: `{ userId, role }`.
- **Middleware** (`middleware.ts`) — enforces session on all routes except `PUBLIC_API_PREFIXES` (auth, cron, admin diagnostic routes). Admin routes require `role === "admin"`.
- **Session helpers** — `requireSession(req)` returns 401 if not logged in; `requireAdmin(req)` returns 403 if not admin. Used by every API route that accesses user data.

## Data Isolation

All user data in Redis is scoped to `u:${userId}:...` keys. The `lib/kv.ts` functions all require a `userId` parameter. Key patterns:

- `u:${userId}:account:${accountId}` — per-account automation config
- `u:${userId}:books` — book library
- `u:${userId}:book-cover:${bookId}` — cover image (stored separately due to size)
- `u:${userId}:top-books-index` + `u:${userId}:top-book:${id}` — Top-N books
- `u:${userId}:top-n-lists` — Top-N list configs
- `u:${userId}:topn-automation` — Top-N automation settings
- `u:${userId}:ig-slideshows` — Instagram slideshows
- `u:${userId}:ig-automation` — Instagram automation settings
- `u:${userId}:music-tracks-index` + `u:${userId}:music-track:${id}` — music tracks
- `u:${userId}:app-settings` — per-user settings (allowedAccountIds)

Global keys (not user-scoped):
- `users:all`, `users:${id}`, `users:by-email:${email}` — user accounts
- `cron-scheduled:YYYY-MM-DD` — daily dedup tracking (auto-expires)

## Folder Structure

```
app/
├── page.tsx                    # Home/dashboard
├── login/page.tsx              # Google OAuth login
├── admin/page.tsx              # Admin panel (user management)
├── books/page.tsx              # Book library
├── create/page.tsx             # Slideshow creation editor
├── instagram/page.tsx          # Instagram automation
├── posts/page.tsx              # Post history
├── top-books/page.tsx          # Top-N book lists
└── api/
    ├── auth/
    │   ├── login/              # OAuth initiation
    │   ├── callback/google/    # OAuth callback
    │   ├── me/                 # Current user
    │   └── logout/             # Session clearing
    ├── admin/
    │   ├── users/              # User CRUD + role management
    │   ├── diagnose-configs/   # Raw Redis diagnostic
    │   └── migrate-configs/    # Config migration
    ├── cron/post/              # Automated posting (TikTok, IG, Top-N)
    ├── post-tiktok/            # Manual posting + account listing
    ├── post-results/           # PostBridge results (CRON_SECRET auth)
    ├── books/                  # Books CRUD
    ├── book-cover/             # Cover image upload/delete
    ├── account-data/           # Per-account config & drafts
    ├── generate-slides/        # AI slide text generation (Anthropic)
    ├── generate/               # AI image generation (Gemini)
    ├── top-books/              # Top-N books CRUD
    ├── top-n-lists/            # Top-N list CRUD
    ├── top-n-generate/         # Top-N video generation & posting
    ├── top-n-preview/          # Top-N video preview
    ├── topn-automation/        # Top-N automation config
    ├── ig-slideshows/          # Instagram slideshow CRUD
    ├── ig-automation/          # Instagram automation config
    ├── music-tracks/           # Music track upload/delete
    ├── settings/all-accounts/  # All PostBridge accounts (admin)
    ├── health/                 # Health check
    └── ...                     # analyze-slide, fetch-book-url, etc.

components/
├── AppHeader.tsx               # Navigation header
├── SlidePreview.tsx            # Slide image preview
└── HowItWorks.tsx              # Onboarding/guide component

lib/
├── kv.ts                       # Redis operations, types, config migration
├── auth.ts                     # User CRUD, invite system, bootstrap admin
├── session.ts                  # JWT sessions, cookie helpers, auth guards
├── post-bridge.ts              # PostBridge API client (retry-safe)
├── gemini.ts                   # Gemini AI client
├── render-slide.ts             # SVG to PNG slide rendering
├── render-topn-slide.ts        # Top-N slide rendering
├── render-video.ts             # ffmpeg video assembly
├── topn-publisher.ts           # Top-N publishing orchestration
├── publisher-champ.ts          # PublisherChamp analytics client
└── utils.ts                    # cn() helper (clsx + tailwind-merge)
```

## Environment Variables

**Required:**
| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | JWT signing key (use 32+ random bytes, base64-encoded) |
| `ADMIN_EMAIL` | Google email for bootstrap admin account |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL (default: `https://www.bookpulls.com/api/auth/callback/google`) |
| `CRON_SECRET` | Bearer token for cron routes and admin CLI access |
| `KV_REST_API_URL` | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Upstash Redis REST token |
| `POSTBRIDGE_API_KEY` | PostBridge API key for TikTok/IG posting |
| `GEMINI_API_KEY` | Google Gemini API key for image generation |

**Optional:**
| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic Claude API for slide text generation |

## Running Locally

```bash
npm install
cp .env.local.example .env.local   # Fill in env vars
npm run dev                         # http://localhost:3000
npm run build                       # Production build
```

## Key Architecture Notes

- **Multi-user with invite-only access** — users are added by admins, not self-signup. Each user's data is fully isolated in Redis via `u:${userId}:...` keys.
- **Per-user account filtering** — each user has `allowedAccountIds` in their settings. Non-admins only see/post to their allowed TikTok accounts. Admins see all.
- **Redis is the only database** — all users, books, configs, slideshows, music tracks, and state live in Upstash Redis via `lib/kv.ts`.
- **Config migration** — `migrateAutomationConfig()` in `lib/kv.ts` normalizes legacy config shapes on read. Canonical shape: `{ enabled, intervals: TimeWindow[], selections: Array<{bookId, slideshowId}>, pointer }`.
- **POST retry safety** — `lib/post-bridge.ts` does NOT retry non-GET requests on 429 to prevent duplicate posts.
- **Cron posting** — `app/api/cron/post/route.ts` runs every 30 minutes, handling TikTok, Instagram, and Top-N automation for all users. Uses Redis-based dedup (`cron-scheduled:YYYY-MM-DD`) and random scheduling within time windows.
- **Midnight-crossing windows** — Time windows like 22:00→00:30 are supported (`endMin += 1440` when end <= start).
- **`next.config.mjs`** — explicit `outputFileTracingIncludes` for fonts and ffmpeg binaries (required for Vercel serverless).
- **Admin routes** accept either an admin session cookie or a `CRON_SECRET` bearer token (for CLI/cron access). They are listed in middleware's `PUBLIC_API_PREFIXES` so they can handle their own auth.

## Git Workflow

Commit and push to GitHub after every set of changes. Always run `npm run typecheck` and `npm run lint` locally before pushing — this is a multi-user production app, so broken pushes affect real users. No branch workflow required for routine changes; consider a feature branch for anything risky.
