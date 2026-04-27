import { NextRequest, NextResponse } from "next/server";
import { pbFetch } from "@/lib/post-bridge";

function extractVideoUrl(
  platformData?: { id?: string; url?: string; username?: string }
): string | null {
  if (!platformData) return null;
  const { id, username } = platformData;
  // platform_data.id format: "p_pub_url~v2.7628648007906674710"
  if (id && username) {
    const match = id.match(/v2\.(\d+)/);
    if (match) {
      return `https://www.tiktok.com/@${username}/photo/${match[1]}`;
    }
  }
  return platformData.url || null;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const results = await pbFetch("/v1/post-results");
    const items = (results.data || results || []).map(
      (r: {
        id: string;
        post_id: string;
        success: boolean;
        social_account_id: number;
        error: string | null;
        platform_data?: { id?: string; url?: string; username?: string };
      }) => ({
        id: r.id,
        postId: r.post_id,
        success: r.success,
        accountId: r.social_account_id,
        username: r.platform_data?.username || null,
        videoUrl: extractVideoUrl(r.platform_data),
        error: r.error,
      })
    );

    return NextResponse.json({ ok: true, results: items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
