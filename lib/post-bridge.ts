const PB_BASE = "https://api.post-bridge.com";

const MAX_RETRIES = 3;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  const method = (init.method || "GET").toUpperCase();
  const path = url.replace(PB_BASE, "");
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 429) {
        if (method !== "GET") {
          console.log(`[post-bridge] 429 on ${method} ${path} — NOT retrying to avoid duplicate posts.`);
          return res;
        }
        if (attempt < retries) {
          const wait = Math.pow(2, attempt) * 1000;
          console.log(`[post-bridge] 429 on GET ${path}, retry ${attempt + 1} in ${wait}ms...`);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
      }
      return res;
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        const wait = Math.pow(2, attempt) * 1000;
        console.log(`[post-bridge] network error on ${method} ${path}: ${msg}, retry ${attempt + 1} in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        console.error(`[post-bridge] network error on ${method} ${path}: ${msg}, no retries left`);
      }
    }
  }
  throw lastError;
}

export async function pbFetch(path: string, init: RequestInit = {}) {
  const res = await fetchWithRetry(`${PB_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`post-bridge ${path} ${res.status}: ${body}`);
  }
  return res.json();
}

async function s3PutWithRetry(
  uploadUrl: string,
  contentType: string,
  buffer: Buffer,
  retries = MAX_RETRIES
): Promise<void> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: new Uint8Array(buffer),
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`S3 upload failed: ${putRes.status} ${t}`);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        const wait = Math.pow(2, attempt) * 1000;
        console.log(`[post-bridge] S3 PUT error: ${msg}, retry ${attempt + 1} in ${wait}ms...`);
        await new Promise((r) => setTimeout(r, wait));
      } else {
        throw err;
      }
    }
  }
}

export async function uploadPng(
  buffer: Buffer,
  name: string
): Promise<string> {
  const upload = await pbFetch("/v1/media/create-upload-url", {
    method: "POST",
    body: JSON.stringify({
      name,
      mime_type: "image/png",
      size_bytes: buffer.length,
    }),
  });
  await s3PutWithRetry(upload.upload_url, "image/png", buffer);
  return upload.media_id;
}

export async function uploadVideo(
  buffer: Buffer,
  name: string
): Promise<string> {
  const upload = await pbFetch("/v1/media/create-upload-url", {
    method: "POST",
    body: JSON.stringify({
      name,
      mime_type: "video/mp4",
      size_bytes: buffer.length,
    }),
  });
  await s3PutWithRetry(upload.upload_url, "video/mp4", buffer);
  return upload.media_id;
}

/**
 * Returns ALL TikTok accounts from PostBridge (unfiltered).
 * Callers are responsible for filtering by per-user allowedAccountIds.
 */
export async function listTikTokAccounts(): Promise<
  { id: number; username: string }[]
> {
  const r = await pbFetch("/v1/social-accounts?platform=tiktok&limit=100");
  return (r.data || []).map((a: { id: number; username: string }) => ({
    id: a.id,
    username: a.username,
  }));
}
