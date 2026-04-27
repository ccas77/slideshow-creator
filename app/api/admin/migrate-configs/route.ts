import { NextRequest, NextResponse } from "next/server";
import { getAccountData, setAccountData, getAppSettings } from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { listTikTokAccounts } from "@/lib/post-bridge";

export async function POST(req: NextRequest) {
  // Allow session-based admin auth, ADMIN_PASSWORD, or CRON_SECRET
  const url = new URL(req.url);
  const pw = url.searchParams.get("password") || req.headers.get("x-password");
  const bearerToken = req.headers.get("authorization")?.replace("Bearer ", "");
  const adminPw = process.env.ADMIN_PASSWORD;
  const cronSecret = process.env.CRON_SECRET;
  const passwordMatch = pw && adminPw && pw === adminPw;
  const cronMatch = bearerToken && cronSecret && bearerToken === cronSecret;
  if (!passwordMatch && !cronMatch) {
    const { error } = await requireAdmin(req);
    if (error) return error;
  }

  try {
    const [allAccounts, users] = await Promise.all([
      listTikTokAccounts(),
      listUsers(),
    ]);

    let migrated = 0;
    let alreadyClean = 0;
    const details: Array<{ userId: string; accountId: number; username: string; status: string }> = [];

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
          // getAccountData now pipes through migrateAutomationConfig — reading
          // and writing back produces a canonical config with legacy fields stripped.
          const data = await getAccountData(user.id, acc.id);
          await setAccountData(user.id, acc.id, data);
          migrated++;
          details.push({
            userId: user.id,
            accountId: acc.id,
            username: acc.username,
            status: "migrated",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          details.push({
            userId: user.id,
            accountId: acc.id,
            username: acc.username,
            status: `error: ${msg}`,
          });
        }
      }
    }

    return NextResponse.json({
      ok: true,
      migrated,
      alreadyClean,
      total: migrated + alreadyClean,
      details,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
