import { appendAttemptLog, type AttemptOutcome } from "@/lib/attempt-log";

const PB_BASE = "https://api.post-bridge.com";

// Retry policy per spec (2026-06-18): retry idempotent / safe calls up to 3
// times with a 30s wait between attempts. Retry on 5xx and network errors.
// Do NOT retry on 4xx (real config / auth problems, want to know immediately).
// POST /v1/posts is NOT retryable even on 5xx: re-issuing it can produce a
// duplicate post on TikTok if PostBridge accepted the first request and only
// the response failed (root cause of the 2026-05-08 duplicate-post incident).

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;

export class PostBridgeError extends Error {
  constructor(
    public path: string,
    public method: string,
    public status: number,
    public body: string,
    public attempts: number,
  ) {
    const attemptStr = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
    super(
      `post-bridge ${method} ${path} HTTP ${status} (after ${attemptStr}): ${body.slice(0, 300)}`,
    );
    this.name = "PostBridgeError";
  }
}

export class NetworkError extends Error {
  constructor(
    public path: string,
    public method: string,
    public cause: unknown,
    public attempts: number,
  ) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    const attemptStr = attempts === 1 ? "1 attempt" : `${attempts} attempts`;
    super(
      `network error ${method} ${path} (after ${attemptStr}): ${causeMsg}`,
    );
    this.name = "NetworkError";
  }
}

async function retryFetch(
  label: string,
  method: string,
  doFetch: () => Promise<Response>,
  opts: { retryable: boolean },
): Promise<Response> {
  const max = opts.retryable ? MAX_ATTEMPTS : 1;
  let lastErr: unknown = null;
  let lastStatus: number | null = null;
  let lastBody = "";

  for (let attempt = 1; attempt <= max; attempt++) {
    const ts = new Date().toISOString();
    try {
      const res = await doFetch();

      if (res.status >= 500 && res.status < 600) {
        const body = await res.text();
        const willRetry = attempt < max && opts.retryable;
        const outcome: AttemptOutcome = willRetry
          ? "retry"
          : opts.retryable
            ? "exhausted"
            : "fail-fast";
        await appendAttemptLog({
          timestamp: ts,
          path: label,
          method,
          attempt,
          maxAttempts: max,
          status: res.status,
          outcome,
          errorMessage: body.slice(0, 300),
        });
        lastErr = new PostBridgeError(label, method, res.status, body, attempt);
        lastStatus = res.status;
        lastBody = body;
        if (!willRetry) throw lastErr;
        console.log(
          `[post-bridge] retry ${attempt}/${max} on ${method} ${label} (${res.status}), waiting ${RETRY_DELAY_MS}ms`,
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      await appendAttemptLog({
        timestamp: ts,
        path: label,
        method,
        attempt,
        maxAttempts: max,
        status: res.status,
        outcome: res.ok ? "success" : "fail-fast",
        errorMessage: res.ok ? undefined : `HTTP ${res.status}`,
      });
      return res;
    } catch (err) {
      if (err instanceof PostBridgeError) throw err;

      const willRetry = attempt < max && opts.retryable;
      const outcome: AttemptOutcome = willRetry
        ? "retry"
        : opts.retryable
          ? "exhausted"
          : "fail-fast";
      const msg = err instanceof Error ? err.message : String(err);
      await appendAttemptLog({
        timestamp: ts,
        path: label,
        method,
        attempt,
        maxAttempts: max,
        status: null,
        outcome,
        errorMessage: msg.slice(0, 300),
      });
      if (!willRetry) {
        throw new NetworkError(label, method, err, attempt);
      }
      lastErr = err;
      console.log(
        `[post-bridge] retry ${attempt}/${max} on ${method} ${label} (network: ${msg}), waiting ${RETRY_DELAY_MS}ms`,
      );
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new PostBridgeError(label, method, lastStatus ?? 500, lastBody, max);
}

export async function pbFetch(
  path: string,
  init: RequestInit = {},
  opts: { retryable?: boolean } = {},
) {
  const method = (init.method || "GET").toUpperCase();
  const retryable = opts.retryable ?? false;

  const res = await retryFetch(
    path,
    method,
    () =>
      fetch(`${PB_BASE}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
      }),
    { retryable },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new PostBridgeError(path, method, res.status, body, 1);
  }
  return res.json();
}

async function s3Put(
  uploadUrl: string,
  contentType: string,
  buffer: Buffer,
): Promise<void> {
  await retryFetch(
    "S3 PUT (presigned)",
    "PUT",
    async () =>
      fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(buffer),
      }),
    { retryable: true },
  );
}

export async function uploadPng(buffer: Buffer, name: string): Promise<string> {
  const upload = await pbFetch(
    "/v1/media/create-upload-url",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        mime_type: "image/png",
        size_bytes: buffer.length,
      }),
    },
    { retryable: true },
  );
  await s3Put(upload.upload_url, "image/png", buffer);
  return upload.media_id;
}

export async function uploadImage(
  buffer: Buffer,
  name: string,
  mimeType: "image/png" | "image/jpeg" = "image/png",
): Promise<string> {
  const upload = await pbFetch(
    "/v1/media/create-upload-url",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        mime_type: mimeType,
        size_bytes: buffer.length,
      }),
    },
    { retryable: true },
  );
  await s3Put(upload.upload_url, mimeType, buffer);
  return upload.media_id;
}

export async function uploadVideo(
  buffer: Buffer,
  name: string,
): Promise<string> {
  const upload = await pbFetch(
    "/v1/media/create-upload-url",
    {
      method: "POST",
      body: JSON.stringify({
        name,
        mime_type: "video/mp4",
        size_bytes: buffer.length,
      }),
    },
    { retryable: true },
  );
  await s3Put(upload.upload_url, "video/mp4", buffer);
  return upload.media_id;
}

/**
 * Returns ALL TikTok accounts from PostBridge (unfiltered).
 * Callers are responsible for filtering by per-user allowedAccountIds.
 */
export async function listTikTokAccounts(): Promise<
  { id: number; username: string }[]
> {
  const r = await pbFetch(
    "/v1/social-accounts?platform=tiktok&limit=100",
    {},
    { retryable: true },
  );
  return (r.data || []).map((a: { id: number; username: string }) => ({
    id: a.id,
    username: a.username,
  }));
}

// When POST /v1/posts errors after PostBridge has actually accepted the post
// (5xx from their gateway, network drop on response, etc.), we can't safely
// retry (duplicate-post risk per 2026-05-08). But we CAN check whether the
// post made it through by listing posts for that account and matching on
// scheduled_at + caption.
export interface VerifyParams {
  accountId: number;
  scheduledAtISO: string;
  captionSlice?: string;
  waitMs?: number;
  toleranceMs?: number;
}

export async function verifyPostScheduled(p: VerifyParams): Promise<boolean> {
  await new Promise((r) => setTimeout(r, p.waitMs ?? 8000));
  try {
    const resp = await pbFetch(
      `/v1/posts?social_account_id=${p.accountId}&limit=50`,
      {},
      { retryable: true },
    );
    const posts: Array<{ scheduled_at?: string; caption?: string }> =
      resp.data || resp.posts || [];
    const target = new Date(p.scheduledAtISO).getTime();
    if (!Number.isFinite(target)) return false;
    const tolerance = p.toleranceMs ?? 5 * 60 * 1000;
    const captionMatch = (p.captionSlice || "").slice(0, 40).trim();
    return posts.some((post) => {
      if (!post.scheduled_at) return false;
      const t = new Date(post.scheduled_at).getTime();
      if (!Number.isFinite(t)) return false;
      if (Math.abs(t - target) > tolerance) return false;
      if (captionMatch && post.caption && !post.caption.includes(captionMatch)) return false;
      return true;
    });
  } catch {
    return false;
  }
}

// Broader "has this account got anything scheduled today" check. Used to
// suppress alerts when an earlier window failed but a later one (or the
// fallback) succeeded — so by the time we'd alert, the account is fine.
export async function verifyAccountHasPostsToday(
  accountId: number,
  waitMs = 5000,
): Promise<boolean> {
  await new Promise((r) => setTimeout(r, waitMs));
  try {
    const resp = await pbFetch(
      `/v1/posts?social_account_id=${accountId}&limit=20`,
      {},
      { retryable: true },
    );
    const posts: Array<{ scheduled_at?: string; created_at?: string }> =
      resp.data || resp.posts || [];
    const today = new Date().toISOString().slice(0, 10);
    return posts.some((p) => {
      const d = (p.scheduled_at || p.created_at || "").slice(0, 10);
      return d === today;
    });
  } catch {
    return false;
  }
}

export function isPostsCreateError(err: unknown): boolean {
  if (err instanceof PostBridgeError) {
    return err.method === "POST" && err.path === "/v1/posts";
  }
  if (err instanceof NetworkError) {
    return err.method === "POST" && err.path === "/v1/posts";
  }
  return false;
}
