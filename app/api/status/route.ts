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

async function computeYesterday(now: Date): Promise<{
  date: string;
  planned: number | null;
  attempted: number;
  confirmed: number;
  attemptGap: number | null;
  confirmGap: number;
  error: string | null;
}> {
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayStart = utcMidnight.getTime() - DAY_MS;
  const yDate = new Date(yesterdayStart).toISOString().slice(0, 10);
  const out: {
    date: string;
    planned: number | null;
    attempted: number;
    confirmed: number;
    attemptGap: number | null;
    confirmGap: number;
    error: string | null;
  } = {
    date: yDate,
    planned: null,
    attempted: 0,
    confirmed: 0,
    attemptGap: null,
    confirmGap: 0,
    error: null,
  };
  let planned: number | null = null;
  let attempted = 0;
  const attemptedPostBridgeIds: string[] = [];

  try {
    const c = client();
    // Planned: cron-scheduled:{yesterday} is a set the cron populates during
    // the day, but the app expires it at midnight UTC + 1h. So by the time
    // we query for yesterday, the key is gone. Try to read it in case it
    // hasn't expired yet, otherwise report null so the manager shows "—".
    try {
      const members = await c.smembers(`cron-scheduled:${yDate}`);
      if (Array.isArray(members) && members.length > 0) planned = members.length;
    } catch {
      // ignore
    }

    // Attempted: post-log:{yesterday} lists posts the app tried to make.
    const postLog =
      (await safeGet<PostLogEntry[]>(c, `post-log:${yDate}`)) ?? [];
    attempted = postLog.length;
    for (const e of postLog) {
      if (e.postBridgeId) attemptedPostBridgeIds.push(e.postBridgeId);
    }
  } catch (e) {
    out.error = (e as Error).message;
    return out;
  }

  out.planned = planned as number;
  out.attempted = attempted;

  // Confirmed: verify each attempted post_id with Post Bridge (success=true).
  if (attemptedPostBridgeIds.length === 0) {
    out.attemptGap = planned === null ? null : Math.max(0, planned - attempted);
    return out;
  }
  if (!(process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY)) {
    out.error = "no PB key on this app";
    return out;
  }
  try {
    const uniq = [...new Set(attemptedPostBridgeIds)];
    const chunks: string[][] = [];
    for (let i = 0; i < uniq.length; i += PB_CHUNK) chunks.push(uniq.slice(i, i + PB_CHUNK));
    const successById = new Set<string>();
    for (const chunk of chunks) {
      const qs = new URLSearchParams({ limit: "100" });
      for (const id of chunk) qs.append("post_id", id);
      const r = await pbGet<{ data?: PBPostResult[] }>(`/v1/post-results?${qs}`);
      for (const row of r.data || []) {
        if (row.post_id && row.success === true) successById.add(row.post_id);
      }
    }
    // Confirmed = attempted rows whose postBridgeId shows success in PB.
    let confirmed = 0;
    for (const id of attemptedPostBridgeIds) {
      if (successById.has(id)) confirmed += 1;
    }
    out.confirmed = confirmed;
  } catch (e) {
    out.error = (e as Error).message;
  }

  out.attemptGap = out.planned === null ? null : Math.max(0, out.planned - out.attempted);
  out.confirmGap = Math.max(0, out.attempted - out.confirmed);
  return out;
}

const PB_BASE = "https://api.post-bridge.com";
const PB_CHUNK = 20;

type PBPostResult = {
  id?: string;
  post_id?: string;
  social_account_id?: number;
  success?: boolean;
  error?: unknown;
  platform_data?: unknown;
};

type PBPost = {
  id?: string;
  status?: "scheduled" | "processing" | "posted" | string;
  scheduled_at?: string | null;
  created_at?: string;
};

class PBError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PBError";
  }
}

async function pbGet<T>(path: string): Promise<T> {
  const key = process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY;
  if (!key) throw new Error("no PB key");
  const res = await fetch(`${PB_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) {
    // 500 on /v1/posts/{id} means "not found" in Post Bridge's semantics.
    const body = await res.text();
    throw new PBError(res.status, `PB ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

async function selfCrossCheckAgainstPB(
  postLog: PostLogEntry[],
  windowStartMs: number,
): Promise<{
  claimed24h: number;
  confirmed24h: number;
  queuedAtPB24h: number;
  rejectedByPB24h: number;
  missingFromPB24h: number;
  rejectedDetail: Array<{ id: string; postedAt: string; target: string | null; error: string }>;
  missingDetail: Array<{ id: string; postedAt: string; target: string | null }>;
  error: string | null;
}> {
  const out = {
    claimed24h: 0,
    confirmed24h: 0,
    queuedAtPB24h: 0,
    rejectedByPB24h: 0,
    missingFromPB24h: 0,
    rejectedDetail: [] as Array<{ id: string; postedAt: string; target: string | null; error: string }>,
    missingDetail: [] as Array<{ id: string; postedAt: string; target: string | null }>,
    error: null as string | null,
  };
  const inWindowEntries = postLog.filter(
    (e) => e.postBridgeId && Date.parse(e.timestamp) >= windowStartMs,
  );
  out.claimed24h = inWindowEntries.length;
  if (inWindowEntries.length === 0) return out;
  if (!(process.env.POSTBRIDGE_API_KEY || process.env.POST_BRIDGE_API_KEY)) {
    out.error = "no PB key on this app";
    return out;
  }

  const ids = [...new Set(inWindowEntries.map((e) => e.postBridgeId))];
  const resultsByPostId = new Map<string, PBPostResult[]>();
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += PB_CHUNK) chunks.push(ids.slice(i, i + PB_CHUNK));
  try {
    for (const chunk of chunks) {
      const qs = new URLSearchParams({ limit: "100" });
      for (const id of chunk) qs.append("post_id", id);
      const r = await pbGet<{ data?: PBPostResult[] }>(`/v1/post-results?${qs}`);
      for (const row of r.data || []) {
        const pid = row.post_id;
        if (!pid) continue;
        if (!resultsByPostId.has(pid)) resultsByPostId.set(pid, []);
        resultsByPostId.get(pid)!.push(row);
      }
    }
  } catch (e) {
    out.error = (e as Error).message;
    return out;
  }

  // For each id with no post-results, check if the parent post exists in PB
  // (queued) or truly doesn't (silent failure). One /v1/posts/{id} call per
  // id, throttled by the app's own network stack. 500 = truly missing.
  const parentStatus = new Map<string, "queued" | "missing" | "unknown">();
  const idsNeedingParentCheck = ids.filter((id) => !(resultsByPostId.get(id) || []).length);
  for (const id of idsNeedingParentCheck) {
    try {
      const post = await pbGet<PBPost>(`/v1/posts/${encodeURIComponent(id)}`);
      const st = post?.status;
      if (st === "scheduled" || st === "processing") parentStatus.set(id, "queued");
      else parentStatus.set(id, "unknown");
    } catch (e) {
      const status = e instanceof PBError ? e.status : 0;
      if (status === 500 || status === 404) parentStatus.set(id, "missing");
      else parentStatus.set(id, "unknown");
    }
  }

  for (const e of inWindowEntries) {
    const rows = resultsByPostId.get(e.postBridgeId) || [];
    const target = e.accountName || null;
    if (rows.some((r) => r.success === true)) {
      out.confirmed24h += 1;
      continue;
    }
    if (rows.length === 0) {
      const p = parentStatus.get(e.postBridgeId);
      if (p === "queued") out.queuedAtPB24h += 1;
      else if (p === "missing") {
        out.missingFromPB24h += 1;
        if (out.missingDetail.length < 10) {
          out.missingDetail.push({ id: e.postBridgeId, postedAt: e.timestamp, target });
        }
      }
      continue;
    }
    if (rows.every((r) => r.success === false)) {
      out.rejectedByPB24h += 1;
      if (out.rejectedDetail.length < 10) {
        const firstErr = rows.find((r) => r.error);
        out.rejectedDetail.push({
          id: e.postBridgeId,
          postedAt: e.timestamp,
          target,
          error: firstErr?.error ? JSON.stringify(firstErr.error).slice(0, 200) : "unknown",
        });
      }
    }
  }
  return out;
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
  const yesterdayKey = dateKey(new Date(nowMs - DAY_MS));

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
      safeGet<string[]>(c, `retry-log:${yesterdayKey}`),
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

  // "Yesterday" = previous full UTC day. Closed data, unlike today which is
  // still in progress. Compute planned / attempted / confirmed for that day.
  const yesterday = await computeYesterday(now);

  // Legacy crossCheck kept for backwards compat during migration.
  const crossCheck = await selfCrossCheckAgainstPB(postLogRecent, nowMinusDay);

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
    crossCheck,
    yesterday,
    generatedAt: new Date().toISOString(),
  });
}
