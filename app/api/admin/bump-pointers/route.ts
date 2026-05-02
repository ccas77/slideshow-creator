import { NextRequest, NextResponse } from "next/server";
import { getAccountData, setAccountData, getAppSettings } from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { listTikTokAccounts } from "@/lib/post-bridge";

export async function POST(req: NextRequest) {
  const bearerToken = req.headers.get("authorization")?.replace("Bearer ", "");
  const cronSecret = process.env.CRON_SECRET;
  const cronMatch = bearerToken && cronSecret && bearerToken === cronSecret;
  if (!cronMatch) {
    const { error } = await requireAdmin(req);
    if (error) return error;
  }

  try {
    const [allAccounts, users] = await Promise.all([
      listTikTokAccounts(),
      listUsers(),
    ]);

    const details: Array<{ userId: string; accountId: number; username: string; before: number; after: number }> = [];

    for (const user of users) {
      const settings = await getAppSettings(user.id);
      const allowedIds = settings.allowedAccountIds;
      const isAdmin = user.role === "admin";
      const userAccounts = isAdmin
        ? allAccounts
        : allowedIds && allowedIds.length > 0
          ? allAccounts.filter((a) => allowedIds.includes(a.id))
          : [];

      for (const acc of userAccounts) {
        try {
          const data = await getAccountData(user.id, acc.id);
          const before = data.config.pointer;
          data.config.pointer = before + 1;
          data.config.promptPointer = (data.config.promptPointer || 0) + 1;
          await setAccountData(user.id, acc.id, data);
          details.push({
            userId: user.id,
            accountId: acc.id,
            username: acc.username,
            before,
            after: data.config.pointer,
          });
        } catch {}
      }
    }

    return NextResponse.json({ ok: true, bumped: details.length, details });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
