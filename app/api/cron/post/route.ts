import { NextRequest, NextResponse } from "next/server";
import { acquireLock, releaseLock } from "@/lib/cron/lock";
import { getScheduledToday } from "@/lib/cron/scheduled-today";
import { runTikTokPhase } from "@/lib/cron/tiktok";
import { runTopNPhase } from "@/lib/cron/topn";
import { runInstagramPhase } from "@/lib/cron/instagram";

export const maxDuration = 800; // Pro max

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urlParams = new URL(req.url).searchParams;
  const dryRun = urlParams.get("dry") === "1";
  const forceHour = urlParams.get("hour") ? Number(urlParams.get("hour")) : undefined;

  try {
    const lockAcquired = await acquireLock();
    if (!lockAcquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Another cron run in progress" });
    }

    let cronResult;
    try {
      const scheduledToday = await getScheduledToday();

      // Phase 1-4: TikTok slideshow automation
      const { results, debugLog } = await runTikTokPhase(scheduledToday, { dryRun, forceHour });

      if (dryRun) {
        return NextResponse.json({ ok: true, dryRun: true, results, debugLog });
      }

      // Phase 5: Top N list automation
      const { topNResults } = await runTopNPhase(scheduledToday, { forceHour });

      // Phase 6: IG slideshow automation
      const { igAutoResults } = await runInstagramPhase(scheduledToday, { forceHour });

      cronResult = NextResponse.json({ ok: true, results, topNResults, igAutoResults, debugLog });
    } finally {
      await releaseLock();
    }

    return cronResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
