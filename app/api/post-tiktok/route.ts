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
    // Admins see everything. Non-admins are ALWAYS filtered: if they have
    // an allow-list, show only those accounts; if they have NO allow-list
    // (new user), show nothing — not everything.
    const filterAccounts = !isAdmin;
    const filterPosts = !isAdmin;

    if (action === "posts") {
      const accountId = url.searchParams.get("accountId");
      const [postsResp, resultsResp, analyticsResp] = await Promise.all([
        pbFetch("/v1/posts?limit=50"),
        pbFetch("/v1/post-results?limit=100").catch(() => ({ data: [] })),
        pbFetch("/v1/analytics?limit=100").catch(() => ({ data: [] })),
      ]);
      const resultsAll = resultsResp.data || [];
      const analyticsAll = analyticsResp.data || [];

      // Build analytics lookup: post_result_id → analytics data
      const analyticsMap = new Map<string, {
        view_count: number;
        like_count: number;
        comment_count: number;
        share_count: number;
        cover_image_url: string | null;
        share_url: string | null;
      }>();
      for (const a of analyticsAll as Array<{
        post_result_id: string;
        view_count: number;
        like_count: number;
        comment_count: number;
        share_count: number;
        cover_image_url?: string;
        share_url?: string;
      }>) {
        analyticsMap.set(a.post_result_id, {
          view_count: a.view_count,
          like_count: a.like_count,
          comment_count: a.comment_count,
          share_count: a.share_count,
          cover_image_url: a.cover_image_url || null,
          share_url: a.share_url || null,
        });
      }

      // Build per-post result info with analytics
      const postResults = new Map<string, Array<{
        accountId: number;
        username: string | null;
        profileUrl: string | null;
        postUrl: string | null;
        success: boolean;
        error: string | null;
        analytics: {
          view_count: number;
          like_count: number;
          comment_count: number;
          share_count: number;
          cover_image_url: string | null;
        } | null;
      }>>();
      for (const r of resultsAll as Array<{
        id: string;
        post_id: string;
        success: boolean;
        error: string | null;
        social_account_id: number;
        platform_data?: { url?: string; username?: string; id?: string };
      }>) {
        const pd = r.platform_data;
        const analytics = analyticsMap.get(r.id) || null;
        // Build post URL: prefer analytics share_url, fall back to platform_data
        let postUrl = analytics?.share_url || null;
        if (!postUrl && pd?.id && pd?.username) {
          const match = pd.id.match(/v2\.(\d+)/);
          if (match) {
            postUrl = `https://www.tiktok.com/@${pd.username}/video/${match[1]}`;
          }
        }
        const entry = {
          accountId: r.social_account_id,
          username: pd?.username || null,
          profileUrl: pd?.username ? `https://www.tiktok.com/@${pd.username}` : null,
          postUrl,
          success: r.success,
          error: r.error,
          analytics: analytics ? {
            view_count: analytics.view_count,
            like_count: analytics.like_count,
            comment_count: analytics.comment_count,
            share_count: analytics.share_count,
            cover_image_url: analytics.cover_image_url,
          } : null,
        };
        const existing = postResults.get(r.post_id) || [];
        existing.push(entry);
        postResults.set(r.post_id, existing);
      }

      const all = (postsResp.data || []) as Array<{
        id: string;
        caption: string;
        status: string;
        scheduled_at: string | null;
        created_at: string;
        updated_at: string;
        social_accounts: number[];
        media: string[];
      }>;
      // Non-admins can only see posts for their allowed accounts.
      // Even with an explicit accountId param, enforce the allow-list.
      const safeIds = allowedIds || [];
      let visible = all;
      if (filterPosts) {
        // First restrict to allowed accounts only
        visible = all.filter((p) =>
          p.social_accounts.some((id) => safeIds.includes(id))
        );
        // Then narrow by accountId param if given
        if (accountId) {
          visible = visible.filter((p) =>
            p.social_accounts.includes(Number(accountId))
          );
        }
      } else if (accountId) {
        // Admin with accountId filter
        visible = all.filter((p) =>
          p.social_accounts.includes(Number(accountId))
        );
      }
      const posts = visible.map((p) => {
        const results = postResults.get(p.id) || [];
        return {
          id: p.id,
          caption: p.caption,
          status: p.status,
          scheduled_at: p.scheduled_at,
          posted_at: p.status === "posted" ? (p.updated_at || p.created_at) : null,
          social_accounts: p.social_accounts,
          slide_count: p.media?.length || 0,
          results,
        };
      });
      return NextResponse.json({ posts });
    }

    const platform = url.searchParams.get("platform");
    const accountsResp = await pbFetch(
      platform
        ? `/v1/social-accounts?platform=${platform}&limit=100`
        : `/v1/social-accounts?limit=100`
    );
    const all = (accountsResp.data || []).map(
      (a: { id: number; username: string }) => ({
        id: a.id,
        username: a.username,
      })
    );
    const accounts = filterAccounts
      ? all.filter((a: { id: number }) => (allowedIds || []).includes(a.id))
      : all;
    return NextResponse.json({ accounts });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE: cancel a scheduled post
export async function DELETE(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;
  try {
    const url = new URL(req.url);
    const postId = url.searchParams.get("postId");
    if (!postId) {
      return NextResponse.json({ error: "postId required" }, { status: 400 });
    }

    // Verify the post belongs to one of this user's allowed accounts
    if (session.role !== "admin") {
      const settings = await getAppSettings(session.userId);
      const allowedIds = settings.allowedAccountIds || [];

      // Fetch the post — if it doesn't exist, return 404
      let post;
      try {
        post = await pbFetch(`/v1/posts/${postId}`);
      } catch {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }

      const postAccounts: number[] = post.social_accounts || post.data?.social_accounts || [];
      const owned = postAccounts.some((id) => allowedIds.includes(id));
      if (!owned) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      }
    }

    // Ownership verified (or admin) — now delete
    await pbFetch(`/v1/posts/${postId}`, { method: "DELETE" });
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
      // Admins bypass this check. Non-admins with NO allow-list can't post at all.
      const settings = await getAppSettings(session.userId);
      const allowedIds = settings.allowedAccountIds || [];
      if (session.role !== "admin") {
        if (allowedIds.length === 0) {
          return NextResponse.json(
            { error: "No accounts assigned. Ask an admin to grant access." },
            { status: 403 }
          );
        }
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
