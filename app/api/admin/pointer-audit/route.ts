import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/kv";
import { requireAdmin } from "@/lib/session";
import { listUsers } from "@/lib/auth";
import { listTikTokAccounts } from "@/lib/post-bridge";
import { getAppSettings, getAccountData } from "@/lib/kv";

export async function GET(req: NextRequest) {
  const { error } = await requireAdmin(req);
  if (error) return error;

  const url = new URL(req.url);
  const filterAccountId = url.searchParams.get("accountId");

  const [users, allAccounts] = await Promise.all([
    listUsers(),
    listTikTokAccounts(),
  ]);

  const result: Record<
    string,
    {
      username: string;
      currentPointer: number;
      currentPromptPointer: number;
      log: string[];
    }
  > = {};

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
      if (filterAccountId && acc.id !== Number(filterAccountId)) continue;
      const logKey = `u:${user.id}:pointer-audit:${acc.id}`;
      const entries = (await redis.get<string[]>(logKey)) || [];
      const data = await getAccountData(user.id, acc.id);
      result[`${user.id}:${acc.id} (${acc.username})`] = {
        username: acc.username,
        currentPointer: data.config.pointer,
        currentPromptPointer: data.config.promptPointer,
        log: entries,
      };
    }
  }

  return NextResponse.json(result);
}
