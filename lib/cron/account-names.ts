import { listTikTokAccounts } from "@/lib/post-bridge";

/**
 * Resolve Post Bridge account IDs to usernames for post-log rows.
 *
 * The TikTok phase already has `acc.username` in hand from its own
 * listTikTokAccounts() call, but the TopN and Instagram phases iterate config
 * keyed by account ID and never fetch the account list — so they logged the raw
 * numeric ID as the account name. That made post-log rows (and the
 * `unconfirmed` detail in /api/status) show targets like "63186" instead of a
 * username, which is unreadable when triaging a failed post.
 *
 * Falls back to the raw ID string when the account isn't in the map, which is
 * the case for Instagram accounts (this only lists TikTok) and keeps the
 * previous behaviour rather than logging something misleading.
 */
export async function fetchAccountNameMap(): Promise<Map<number, string>> {
  try {
    const accounts = await listTikTokAccounts();
    return new Map(accounts.map((a) => [a.id, a.username]));
  } catch {
    // Never let a name lookup break a publish run — the caller falls back to
    // the numeric ID, which is exactly the pre-fix behaviour.
    return new Map();
  }
}

export function resolveAccountName(
  names: Map<number, string>,
  accIdStr: string,
): string {
  return names.get(Number(accIdStr)) || accIdStr;
}
