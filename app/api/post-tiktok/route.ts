import { NextRequest, NextResponse } from "next/server";
import { getAppSettings } from "@/lib/kv";
import { requireSession } from "@/lib/session";

const PB_BASE = "https://api.post-bridge.com";

async function pbFetch(path: string, init: RequestInit = {}) {
  const res = await fetch(`${PB_BASE}${path}`, {
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

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.split(",")[1];
  const buf = Buffer.from(base64, "base64");
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

// GET: list TikTok accounts (filtered by per-user settings),
// or scheduled posts (also filtered by the user's allowed accounts).
export async function GET(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const settings = await getAppSettings(session.userId);
    const allowedIds = settings.allowedAccountIds;
    const isAdmin = session.role === "admin";
    // For the *account list*, admins see everything; regular users are
    // filtered by their admin-granted allow-list.
    const filterAccounts =
      !isAdmin && !!(allowedIds && allowedIds.length > 0);
    // For *posts*, everyone is filtered by their allowed accounts (or by
    // the explicit accountId param). Admins still get scoped to whichever
    // account they're viewing — showing every account's posts is noisy.
    const filterPosts = !!(allowedIds && allowedIds.length > 0);

    if (action === "posts") {
      const accountId = url.searchParams.get("accountId");
      const [postsResp, resultsResp] = await Promise.all([
        pbFetch("/v1/posts?limit=50"),
        pbFetch("/v1/post-results").catch(() => ({ data: [] })),
      ]);

      const videoUrls = new Map<string, string>();
      for (const r of (resultsResp.data || []) as Array<{
        post_id: string;
        platform_data?: { url?: string; username?: string };
      }>) {
        const pd = r.platform_data;
        if (pd?.username) {
          videoUrls.set(r.post_id, `https://www.tiktok.com/@${pd.username}`);
        }
      }

      const all = (postsResp.data || []) as Array<{
        id: string;
        caption: string;
        status: string;
        scheduled_at: string | null;
        social_accounts: number[];
        media: string[];
      }>;
      // Scope posts: if accountId param is given use that, otherwise
      // fall back to the user's allow-list. Admins without an allow-list
      // AND no accountId param see nothing rather than every post.
      let visible = all;
      if (accountId) {
        visible = all.filter((p) =>
          p.social_accounts.includes(Number(accountId))
        );
      } else if (filterPosts) {
        visible = all.filter((p) =>
          p.social_accounts.some((id) => allowedIds!.includes(id))
        );
      } else {
        // No accountId selected and no allow-list → return empty
        visible = [];
      }
      const posts = visible.map((p) => ({
        id: p.id,
        caption: p.caption,
        status: p.status,
        scheduled_at: p.scheduled_at,
        social_accounts: p.social_accounts,
        slide_count: p.media?.length || 0,
        videoUrl: videoUrls.get(p.id) || null,
      }));
      return NextResponse.json({ posts });
    }

    const accountsResp = await pbFetch(
      "/v1/social-accounts?platform=tiktok&limit=100"
    );
    const all = (accountsResp.data || []).map(
      (a: { id: number; username: string }) => ({
        id: a.id,
        username: a.username,
      })
    );
    const accounts = filterAccounts
      ? all.filter((a: { id: number }) => allowedIds!.includes(a.id))
      : all;
    return NextResponse.json({ accounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: cancel a scheduled post
export async function DELETE(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;
  try {
    const url = new URL(req.url);
    const postId = url.searchParams.get("postId");
    if (!postId) {
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    }
    const res = await fetch(`${PB_BASE}/v1/posts/${postId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.POSTBRIDGE_API_KEY}`,
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`post-bridge DELETE ${res.status}: ${body}`);
    }
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  try {
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const body = await req.json();

    // Upload a single image (browser sends PNG as base64 data URL)
    if (action === "upload") {
      const { image, index } = body as { image: string; index: number };
      const ab = dataUrlToArrayBuffer(image);

      const upload = await pbFetch("/v1/media/create-upload-url", {
        method: "POST",
        body: JSON.stringify({
          name: `slide-${index + 1}.png`,
          mime_type: "image/png",
          size_bytes: ab.byteLength,
        }),
      });

      const putRes = await fetch(upload.upload_url, {
        method: "PUT",
        headers: { "Content-Type": "image/png" },
        body: ab,
      });
      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`S3 upload failed: ${putRes.status} ${t}`);
      }

      return NextResponse.json({ media_id: upload.media_id });
    }

    // Publish the post to selected accounts (must be within user's allowed set)
    if (action === "publish") {
      const { caption, mediaIds, accountIds } = body as {
        caption: string;
        mediaIds: string[];
        accountIds: number[];
      };

      if (!accountIds || accountIds.length === 0) {
        return NextResponse.json(
          { error: "Select at least one TikTok account" },
          { status: 400 }
        );
      }
      if (!mediaIds || mediaIds.length < 2) {
        return NextResponse.json(
          { error: "Need at least 2 slides for a TikTok carousel" },
          { status: 400 }
        );
      }

      // Enforce that the user can only post to accounts they're allowed to see.
      // Admins bypass this check.
      const settings = await getAppSettings(session.userId);
      const allowedIds = settings.allowedAccountIds;
      if (session.role !== "admin" && allowedIds && allowedIds.length > 0) {
        const disallowed = accountIds.filter(
          (id) => !allowedIds.includes(id)
        );
        if (disallowed.length > 0) {
          return NextResponse.json(
            { error: `Not allowed to post to accounts: ${disallowed.join(", ")}` },
            { status: 403 }
          );
        }
      }

      const post = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: caption || "",
          media: mediaIds,
          social_accounts: accountIds,
          platform_configurations: {
            tiktok: { draft: false, is_aigc: true },
          },
        }),
      });

      return NextResponse.json({ success: true, post });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Post failed";
    console.error("post-bridge error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
