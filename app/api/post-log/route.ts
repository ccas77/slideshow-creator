import { NextRequest, NextResponse } from "next/server";
import { getPostLog, appendPostLog, PostLogEntry } from "@/lib/kv";
import { requireSession } from "@/lib/session";
import { listTikTokAccounts, pbFetch } from "@/lib/post-bridge";

export async function GET(req: NextRequest) {
  const { error } = await requireSession(req);
  if (error) return error;

  const date = new URL(req.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param required (YYYY-MM-DD)" }, { status: 400 });
  }

  const entries = await getPostLog(date);
  return NextResponse.json({ entries });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const { date } = await req.json();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }

  const accounts = await listTikTokAccounts();
  const existing = await getPostLog(date);
  const existingIds = new Set(existing.map((e) => e.postBridgeId));

  let added = 0;
  for (const acc of accounts) {
    try {
      const resp = await pbFetch(`/v1/posts?social_account_id=${acc.id}&limit=50`);
      const posts = resp.data || [];
      for (const p of posts) {
        const sched = p.scheduled_at || p.created_at || "";
        if (sched.slice(0, 10) !== date) continue;
        const postId = String(p.id || "");
        if (existingIds.has(postId)) continue;

        const entry: PostLogEntry = {
          date,
          time: sched.slice(11, 16),
          accountId: acc.id,
          accountName: acc.username,
          bookName: "",
          slideshowId: "",
          slideshowName: "",
          imagePromptId: "",
          imagePromptText: "",
          captionId: "",
          captionText: (p.caption || "").slice(0, 100),
          postBridgeId: postId,
          postBridgeUrl: p.url || "",
          source: "postbridge-sync",
          userId: session.userId,
          timestamp: new Date().toISOString(),
        };
        await appendPostLog(entry);
        existingIds.add(postId);
        added++;
      }
    } catch {}
  }

  const entries = await getPostLog(date);
  return NextResponse.json({ entries, added });
}
