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
| `ANTHROPIC_API_KEY` | Anthropic Claude API for slide text generation and top-N BookTok generator |
| `RESEND_API_KEY` | Enables failure-notification emails. Without it, `notify()` no-ops silently and the cron behaves exactly as before. |
| `NOTIFY_EMAIL` | Where failure emails go. Defaults to `cordeliacastel@gmail.com`. |
| `NOTIFY_FROM` | From address. Defaults to `Slideshow Generator <onboarding@resend.dev>`. |

## Failure notifications

`lib/notify.ts` wraps Resend with a Redis-backed dedupe cooldown so the same failure doesn't email more than once per cooldown window (default 1h). It no-ops when `RESEND_API_KEY` is unset. Wired in:

- `app/api/cron/post/route.ts` — top-level catch (cron crashed) + per-phase wrappers, so one phase crashing alerts but doesn't kill the other phases.
- `lib/cron/{tiktok,topn,instagram}.ts` — per-post catches send "post failed for account X" emails (dedupe key includes accountId + the current hour). Per-user per-phase outer catch sends "phase X failed for user Y".
- `lib/cron/stuck-detector.ts` — runs at the start of each cron, compares the previous two days of `post-log` (grouped by userId+accountId), and emails one summary if any account posted the same slideshow/list on both days. Dedupe key is per-day (cooldown 24h). Alarm for the 2026-05-07 (TikTok) and 2026-06-02 (TopN) class of stuck-pointer incidents.
- `app/api/admin/test-notify` — POST (admin-only) sends a one-shot test email so you can confirm the path works without waiting for a real failure. Bypasses dedupe via per-call dedupeKey.

## Image generation with Vercel AI Gateway failover

`lib/image-gen.ts` is the primary image-generation surface. It calls the Vercel AI Gateway (`experimental_generateImage` from the `ai` package) and walks an ordered fallback chain: `google/gemini-2.5-flash-image` → `google/imagen-4.0-generate-001` → `openai/dall-e-3`. First success wins. On Vercel, Gateway auth is automatic via OIDC; `AI_GATEWAY_API_KEY` is only needed locally.

`lib/gemini.ts` keeps its existing exports (`generateImage`, `generateImageWithInfo`, `describeImageForPrompt`) for backward compatibility and now delegates the two image-gen functions to `lib/image-gen.ts`. If Gateway returns no data or throws, it falls back to the direct `@google/genai` SDK path. The result includes `providerUsed` so logs surface which provider rendered the image. The cron's "image gen failed" notify path only fires when BOTH Gateway and direct Gemini are dead.

## Top-N BookTok generator

In the Top Books page → Lists tab, the list editor modal has a "Generate" button between the List Name and Title Slide Texts fields. It calls `app/api/topn-booktok/route.ts` (session-auth), which sends the list name, the selected genres, and the current contents of the three pools (titles, captions, background image prompts) to Claude Sonnet 4.6 and appends 16-20 new items to each textarea. Repeat clicks pass the current pools so the model skips duplicates; a hard dedup runs server-side as a safety net. The list name overrides genre when they disagree (e.g. "Books like Harry Potter" + "YA fantasy" produces Harry-Potter-likes, not generic YA fantasy). System prompt + genre notes live in `lib/booktok-prompt.ts` and use ephemeral prompt caching so repeat calls are cheap.

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
