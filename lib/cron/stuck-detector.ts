import {
  getPostLog,
  getTopNLists,
  getTopNAutomation,
  type PostLogEntry,
} from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { notify } from "@/lib/notify";

// Looks back at the last two complete days of post-log. For each (userId, accountId)
// pair, if the same slideshow/list ID was posted on both days, flag as stuck.
// Yesterday's data is read because today's data is mid-flight when the cron
// runs and incomplete entries would produce false positives.
//
// Pool-size-1 accounts are intentionally locked to one list (TopN account
// dedicated to a single theme). Those are NOT bugs and get filtered out
// before we email so the detector doesn't cry wolf every day.
export async function checkStuckRotations(): Promise<void> {
  const today = new Date();
  const yesterday = isoDate(daysAgo(today, 1));
  const dayBefore = isoDate(daysAgo(today, 2));

  let yLog: PostLogEntry[] = [];
  let dLog: PostLogEntry[] = [];
  try {
    [yLog, dLog] = await Promise.all([
      getPostLog(yesterday),
      getPostLog(dayBefore),
    ]);
  } catch {
    return;
  }

  if (yLog.length === 0 || dLog.length === 0) return;

  const yByKey = groupByUserAccount(yLog);
  const dByKey = groupByUserAccount(dLog);

  interface Candidate {
    userId: string;
    accountId: number;
    sample: PostLogEntry;
    sharedName: string;
  }
  const candidates: Candidate[] = [];

  for (const [key, yEntries] of yByKey) {
    const dEntries = dByKey.get(key);
    if (!dEntries) continue;
    const ySlideshowIds = new Set(yEntries.map((e) => e.slideshowId).filter(Boolean));
    const dSlideshowIds = new Set(dEntries.map((e) => e.slideshowId).filter(Boolean));
    const shared = [...ySlideshowIds].filter((id) => dSlideshowIds.has(id));
    if (shared.length === 0) {
      // Slideshow ID can be empty for TopN; fall back to slideshowName.
      const yNames = new Set(yEntries.map((e) => e.slideshowName).filter(Boolean));
      const dNames = new Set(dEntries.map((e) => e.slideshowName).filter(Boolean));
      const sharedNames = [...yNames].filter((n) => dNames.has(n));
      if (sharedNames.length === 0) continue;
      const sample = yEntries.find((e) => sharedNames.includes(e.slideshowName));
      if (!sample) continue;
      candidates.push({
        userId: sample.userId || key.split(":")[0],
        accountId: sample.accountId,
        sample,
        sharedName: sharedNames[0],
      });
      continue;
    }

    const sample = yEntries.find((e) => shared.includes(e.slideshowId));
    const name = sample?.slideshowName || sample?.bookName || shared[0];
    if (!sample) continue;
    candidates.push({
      userId: sample.userId || key.split(":")[0],
      accountId: sample.accountId,
      sample,
      sharedName: name,
    });
  }

  if (candidates.length === 0) return;

  // Build per-user TopN config map for pool-size lookups.
  const userIds = [...new Set(candidates.map((c) => c.userId).filter(Boolean))];
  const allUsers = await listUsers().catch(() => [] as Awaited<ReturnType<typeof listUsers>>);
  const userIdSet = new Set(allUsers.map((u) => u.id));

  const topNDataByUser = new Map<
    string,
    {
      lists: Awaited<ReturnType<typeof getTopNLists>>;
      auto: Awaited<ReturnType<typeof getTopNAutomation>>;
    }
  >();
  await Promise.all(
    userIds.map(async (uid) => {
      if (!userIdSet.has(uid)) return;
      try {
        const [lists, auto] = await Promise.all([
          getTopNLists(uid),
          getTopNAutomation(uid),
        ]);
        topNDataByUser.set(uid, { lists, auto });
      } catch {}
    })
  );

  const stuckRows: string[] = [];
  for (const c of candidates) {
    const data = topNDataByUser.get(c.userId);
    if (data && c.sample.source === "cron-topn") {
      const accConfig = data.auto.accounts?.[String(c.accountId)];
      if (accConfig) {
        let pool = data.lists.filter(
          (l) => l.bookIds.length > 0 || (l.genres && l.genres.length > 0)
        );
        if (accConfig.listIds.length > 0) {
          pool = pool.filter((l) => accConfig.listIds.includes(l.id));
        }
        if (pool.length <= 1) continue; // intentional single-list config
      }
    }
    stuckRows.push(
      `user=${c.userId} acct=${c.sample.accountName || String(c.accountId)}: posted "${c.sharedName}" on both ${dayBefore} and ${yesterday}`
    );
  }

  if (stuckRows.length === 0) return;

  await notify({
    subject: `BookPulls Creator: ${stuckRows.length} account${stuckRows.length === 1 ? "" : "s"} stuck on same content`,
    body: [
      `Detected accounts posting the same slideshow/list two days in a row (${dayBefore} and ${yesterday}). This usually means a pointer never advanced or the pool is too small.`,
      "",
      ...stuckRows,
      "",
      "Single-list TopN configs are already filtered out, so these are real candidates.",
      "Check the post log and pointer audit. Past incidents: same class as 2026-05-07 (TikTok) and 2026-06-02 (TopN).",
    ].join("\n"),
    dedupeKey: `stuck-rotation:${yesterday}`,
    cooldownSec: 86400,
  });
}

function groupByUserAccount(entries: PostLogEntry[]): Map<string, PostLogEntry[]> {
  const out = new Map<string, PostLogEntry[]>();
  for (const e of entries) {
    const key = `${e.userId || ""}:${e.accountId}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(e);
  }
  return out;
}

function daysAgo(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() - n);
  return x;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
