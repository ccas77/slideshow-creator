import { NextRequest, NextResponse } from "next/server";
import { redis, getAccountData, getPostLog, appendPostLog, PostLogEntry } from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { listTikTokAccounts, pbFetch } from "@/lib/post-bridge";
import { requireSession } from "@/lib/session";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const { session, error } = await requireSession(req);
  if (error) return error;

  const accounts = await listTikTokAccounts();
  const users = await listUsers();

  const stats = { accounts: 0, entriesAdded: 0, datesFound: new Set<string>() };

  for (const user of users) {
    for (const acc of accounts) {
      const data = await getAccountData(user.id, acc.id);
      if (!data.recentPosts || data.recentPosts.length === 0) continue;

      stats.accounts++;

      // Get pointer audit log for this account
      const auditKey = `u:${user.id}:pointer-audit:${acc.id}`;
      const auditEntries = (await redis.get<string[]>(auditKey)) || [];

      // Build a map of PostBridge post ID -> URL by querying PostBridge
      const pbUrlMap = new Map<string, string>();
      try {
        const resp = await pbFetch(`/v1/posts?social_account_id=${acc.id}&limit=50`);
        const posts = resp.data || [];
        for (const p of posts) {
          if (p.id && p.url) {
            pbUrlMap.set(String(p.id), String(p.url));
          }
        }
      } catch {}

      for (const post of data.recentPosts) {
        const schedDate = post.scheduledAt?.slice(0, 10);
        if (!schedDate) continue;

        stats.datesFound.add(schedDate);

        // Check if already in log
        const existing = await getPostLog(schedDate);
        if (existing.some((e) => e.postBridgeId === post.postId)) continue;

        // Try to find the prompt pointer info from audit log around that timestamp
        let imagePromptText = post.promptSnippet || "";

        const entry: PostLogEntry = {
          date: schedDate,
          time: post.scheduledAt?.slice(11, 16) || "",
          accountId: acc.id,
          accountName: acc.username,
          bookName: post.bookName || "",
          slideshowId: "",
          slideshowName: post.slideshowName || "",
          imagePromptId: "",
          imagePromptText,
          captionId: "",
          captionText: "",
          postBridgeId: post.postId || "",
          postBridgeUrl: pbUrlMap.get(post.postId) || "",
          source: "backfill",
          userId: user.id,
          timestamp: post.timestamp || post.scheduledAt || "",
        };
        await appendPostLog(entry);
        stats.entriesAdded++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    accountsWithData: stats.accounts,
    entriesAdded: stats.entriesAdded,
    datesFound: [...stats.datesFound].sort(),
  });
}
