const PB_BASE = "https://api.post-bridge.com";

const MAX_RETRIES = 3;

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES
): Promise<Response> {
  const res = await fetch(url, init);
  if (res.status === 429 && retries > 0) {
    const wait = Math.pow(2, MAX_RETRIES - retries) * 1000; // 1s, 2s, 4s
    console.log(`[post-bridge] 429 rate limited, retrying in ${wait}ms...`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchWithRetry(url, init, retries - 1);
  }
  return res;
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
  const putRes = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "image/png" },
    body: new Uint8Array(buffer),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`S3 upload failed: ${putRes.status} ${t}`);
  }
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
  const putRes = await fetch(upload.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4" },
    body: new Uint8Array(buffer),
  });
  if (!putRes.ok) {
    const t = await putRes.text();
    throw new Error(`S3 video upload failed: ${putRes.status} ${t}`);
  }
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
