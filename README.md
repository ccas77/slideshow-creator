# Slideshow Creator

Multi-user SaaS for creating and auto-posting TikTok/Instagram slideshows from book quotes and excerpts. Users manage books, configure automated posting schedules per TikTok account, and generate "Top N" book list videos.

Deployed at: [bookpulls.com](https://www.bookpulls.com)

## Features

- **Manual posting** — Generate slides from text prompts, preview, and post to TikTok/Instagram
- **Automated posting** — Per-account cron scheduler posts slideshows within configured time windows
- **Top-N lists** — Generate ranked book lists as video slideshows with music
- **Instagram support** — Separate Instagram slideshow management and automation
- **Multi-user** — Google OAuth login, invite-only access, per-user data isolation, admin panel

## Tech Stack

- Next.js 14 (App Router) / React 18 / TypeScript
- Tailwind CSS 4 / Framer Motion
- Upstash Redis (sole database)
- Google OAuth 2.0 / JWT sessions (`jose`)
- Google Gemini for image generation, Anthropic Claude for slide text generation
- `@resvg/resvg-js` + `sharp` for image rendering, `ffmpeg-static` for video
- PostBridge API for TikTok/Instagram publishing
- Deployed on Vercel

## Authentication

- **Google OAuth only** — no passwords or local accounts
- **Invite-only** — admins add users; unrecognized emails are rejected
- **Bootstrap admin** — first login matching `ADMIN_EMAIL` env var auto-creates an admin account
- **Sessions** — HS256 JWT in an httpOnly cookie, 30-day TTL

## Getting Started

**Prerequisites:** Node.js 20+

```bash
npm install
cp .env.local.example .env.local   # fill in your values
npm run dev                         # http://localhost:3000
```

### Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `AUTH_SECRET` | Yes | JWT signing key (32+ random bytes, base64-encoded) |
| `ADMIN_EMAIL` | Yes | Google email for bootstrap admin |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth client secret |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth callback URL |
| `CRON_SECRET` | Yes | Bearer token for cron and admin routes |
| `KV_REST_API_URL` | Yes | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | Yes | Upstash Redis REST token |
| `POSTBRIDGE_API_KEY` | Yes | PostBridge API key for TikTok/IG posting |
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `ANTHROPIC_API_KEY` | No | Enables AI slide text generation |

## Project Structure

```
app/                        # Next.js App Router pages and API routes
├── page.tsx                # Home/dashboard
├── login/                  # Google OAuth login
├── admin/                  # Admin panel (user management)
├── books/                  # Book library
├── create/                 # Slideshow editor
├── instagram/              # Instagram automation
├── top-books/              # Top-N book lists
└── api/
    ├── auth/               # OAuth login, callback, logout, me
    ├── admin/              # User CRUD, config diagnostics
    ├── cron/post/          # Automated posting (TikTok, IG, Top-N)
    ├── generate-slides/    # AI slide text generation
    ├── post-tiktok/        # Manual posting + account listing
    └── ...                 # books, settings, top-n, music, etc.

components/                 # React components
lib/                        # Server-side logic
├── kv.ts                   # Redis operations — all keys scoped to u:${userId}:*
├── auth.ts                 # User management, invite system
├── session.ts              # JWT sessions, auth guards
├── post-bridge.ts          # PostBridge API client
├── render-slide.ts         # SVG → PNG rendering
├── render-video.ts         # ffmpeg video assembly
└── topn-publisher.ts       # Top-N video orchestration
```

## Deployment

Hosted on Vercel. Pushes to `main` trigger automatic deployments.

**Cron jobs** (configured in `vercel.json`):
- `/api/cron/post` — every 30 minutes (automated TikTok, IG, Top-N posting)
- `/api/health` — every 5 minutes

The `next.config.mjs` includes `outputFileTracingIncludes` for font files and `ffmpeg-static` binaries — required for serverless functions on Vercel.

## Build

```bash
npm run build               # production build
npm start                   # serve production build locally
```
