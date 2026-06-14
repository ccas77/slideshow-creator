import { getPostLog, type PostLogEntry } from "@/lib/kv";
import { notify } from "@/lib/notify";

// Looks back at the last two complete days of post-log. For each (userId, accountId)
// pair, if the same slideshow/list ID was posted on both days, flag as stuck.
// Yesterday's data is read because today's data is mid-flight when the cron
// runs and incomplete entries would produce false positives.
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

  const stuckRows: string[] = [];
  for (const [key, yEntries] of yByKey) {
    const dEntries = dByKey.get(key);
    if (!dEntries) continue;
    const ySlideshowIds = new Set(yEntries.map((e) => e.slideshowId).filter(Boolean));
    const dSlideshowIds = new Set(dEntries.map((e) => e.slideshowId).filter(Boolean));
    const shared = [...ySlideshowIds].filter((id) => dSlideshowIds.has(id));
    if (shared.length === 0) {
      // Slideshow ID can be empty for TopN lists; fall back to slideshowName.
      const yNames = new Set(yEntries.map((e) => e.slideshowName).filter(Boolean));
      const dNames = new Set(dEntries.map((e) => e.slideshowName).filter(Boolean));
      const sharedNames = [...yNames].filter((n) => dNames.has(n));
      if (sharedNames.length === 0) continue;
      const sample = yEntries.find((e) => sharedNames.includes(e.slideshowName));
      stuckRows.push(
        `user=${sample?.userId || key.split(":")[0]} acct=${sample?.accountName || key.split(":")[1]}: posted "${sharedNames[0]}" on both ${dayBefore} and ${yesterday}`
      );
      continue;
    }

    const sample = yEntries.find((e) => shared.includes(e.slideshowId));
    const name = sample?.slideshowName || sample?.bookName || shared[0];
    stuckRows.push(
      `user=${sample?.userId || key.split(":")[0]} acct=${sample?.accountName || key.split(":")[1]}: posted "${name}" on both ${dayBefore} and ${yesterday}`
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
