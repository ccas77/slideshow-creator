import { NextResponse } from "next/server";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CRON = "0 * * * *";
const DAY_MS = 24 * 60 * 60 * 1000;

type PostLogEntry = {
  date: string;
  time: string;
  accountId: number;
  accountName: string;
  bookName: string;
  slideshowName: string;
  captionText: string;
  postBridgeId: string;
  postBridgeUrl: string;
  source: string;
  timestamp: string;
};

type AttemptLogEntry = {
  timestamp: string;
  path?: string;
  method?: string;
  status?: number;
  outcome?: string;
  error?: string | null;
  accountId?: number;
};

function client(): Redis {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("KV env vars missing");
  return new Redis({ url, token });
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function inWindow(iso: string | undefined, min: number, max: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= min && t <= max;
}

async function safeGet<T>(c: Redis, key: string): Promise<T | null> {
  try {
    return (await c.get<T>(key)) ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const expected = process.env.CRON_SECRET;
  const provided = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nowMs = now.getTime();
  const today = dateKey(now);
  const yesterday = dateKey(new Date(nowMs - DAY_MS));

  let kvReachable = true;
  let kvError: string | null = null;
  const postLogRecent: PostLogEntry[] = [];
  const attemptRecent: AttemptLogEntry[] = [];

  try {
    const c = client();
    // Pull the last 7 days of post-log to cover the 7d count window.
    const dayKeys: string[] = [];
    for (let i = 0; i < 7; i++) {
      dayKeys.push(dateKey(new Date(nowMs - i * DAY_MS)));
    }
    const postLogs = await Promise.all(
      dayKeys.map((d) => safeGet<PostLogEntry[]>(c, `post-log:${d}`)),
    );
    for (const arr of postLogs) {
      if (Array.isArray(arr)) postLogRecent.push(...arr);
    }
    // Recent attempts from last 2 days for failure signal.
    const attemptLogs = await Promise.all([
      safeGet<string[]>(c, `retry-log:${today}`),
      safeGet<string[]>(c, `retry-log:${yesterday}`),
    ]);
    for (const arr of attemptLogs) {
      if (Array.isArray(arr)) {
        for (const raw of arr) {
          try {
            const parsed = typeof raw === "string" ? JSON.parse(raw) : (raw as AttemptLogEntry);
            attemptRecent.push(parsed);
          } catch {
            // ignore malformed
          }
        }
      }
    }
  } catch (e) {
    kvReachable = false;
    kvError = (e as Error).message;
  }

  const nowMinusDay = nowMs - DAY_MS;
  const nowMinus7d = nowMs - 7 * DAY_MS;

  const posts24hEntries = postLogRecent.filter((e) => inWindow(e.timestamp, nowMinusDay, nowMs));
  const posts7dEntries = postLogRecent.filter((e) => inWindow(e.timestamp, nowMinus7d, nowMs));

  const failingAttempts = attemptRecent.filter(
    (a) => a.outcome && a.outcome !== "success" && inWindow(a.timestamp, nowMinusDay, nowMs),
  );

  const recent = postLogRecent
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, 25)
    .map((e) => ({
      id: e.postBridgeId || `${e.accountId}-${e.timestamp}`,
      lastPostedAt: e.timestamp,
      lastPostId: e.postBridgeId,
      lastError: null,
      originHandle: e.accountName,
      targetAccounts: [e.accountId],
      source: e.source,
    }));

  const failing = failingAttempts.slice(0, 25).map((a) => ({
    id: `${a.accountId ?? "?"}-${a.timestamp}`,
    lastPostedAt: a.timestamp,
    lastError: a.error || a.outcome || "attempt failed",
    retryCount: 0,
    targetAccounts: a.accountId ? [a.accountId] : [],
    originHandle: null,
  }));

  const lastPostSuccess = posts7dEntries
    .map((e) => e.timestamp)
    .sort()
    .at(-1) ?? null;

  return NextResponse.json({
    app: {
      name: "slideshow-creator",
      cron: CRON,
      domain: process.env.VERCEL_PROJECT_PRODUCTION_URL ?? null,
      now: now.toISOString(),
    },
    connections: {
      kv: {
        configured: !!(process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL),
        reachable: kvReachable,
        error: kvReachable ? null : kvError,
      },
      postBridge: {
        configured: !!(process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY),
        lastSuccessAt: lastPostSuccess,
        lastFailureAt: failingAttempts[0]?.timestamp ?? null,
        lastErrorMessage: failingAttempts[0]?.error ?? null,
      },
      apify: {
        configured: !!process.env.APIFY_TOKEN,
        lastSuccessAt: null,
      },
    },
    automations: [],
    scheduled: [],
    posts: { recent, failing },
    counts: {
      posts24h: posts24hEntries.length,
      posts7d: posts7dEntries.length,
      totalTracked: postLogRecent.length,
      automationsEnabled: 0,
      automationsTotal: 0,
      failingCount: failing.length,
      silentMissCount: 0,
    },
    healthSummary: {
      anySilentMiss: false,
      anyRecentFailure: failing.length > 0,
      kvOk: kvReachable,
    },
    generatedAt: new Date().toISOString(),
  });
}
