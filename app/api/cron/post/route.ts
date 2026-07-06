import { NextRequest, NextResponse } from "next/server";
import { acquireLock, releaseLock } from "@/lib/cron/lock";
import { getScheduledToday } from "@/lib/cron/scheduled-today";
import { runTikTokPhase } from "@/lib/cron/tiktok";
import { runTopNPhase } from "@/lib/cron/topn";
import { runInstagramPhase } from "@/lib/cron/instagram";
import { checkStuckRotations } from "@/lib/cron/stuck-detector";
import { notify, processPendingAlerts } from "@/lib/notify";

export const maxDuration = 800; // Pro max

async function runPhase<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n\n${err.stack || ""}` : String(err);
    await notify({
      subject: `BookPulls Creator: cron phase "${name}" crashed`,
      body: `Phase ${name} threw an unhandled error during the cron run.\n\n${msg}`,
      dedupeKey: `phase-crash:${name}`,
      cooldownSec: 3600,
    });
    return { error: msg };
  }
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
      // Stuck-rotation detector runs first, off the previous two days of
      // post-log. Failure to detect is non-fatal; never let it kill the cron.
      checkStuckRotations().catch((err) => {
        console.error("stuck-detector failed", err);
      });

      // Drain the deferred-alert queue. Each per-account alert waits 30 min
      // and only fires if the account still shows no posts today at PB.
      processPendingAlerts()
        .then((s) => console.log(`[cron] processPendingAlerts ${JSON.stringify(s)}`))
        .catch((err) => console.error("[cron] processPendingAlerts failed", err));

      const scheduledToday = await getScheduledToday();

      const tikTok = await runPhase("tiktok", () => runTikTokPhase(scheduledToday, { dryRun, forceHour }));

      if (dryRun) {
        const tikTokResults = "error" in tikTok ? [] : tikTok.results;
        const debugLog = "error" in tikTok ? [`tiktok phase crashed: ${tikTok.error}`] : tikTok.debugLog;
        return NextResponse.json({ ok: true, dryRun: true, results: tikTokResults, debugLog });
      }

      const topN = await runPhase("topn", () => runTopNPhase(scheduledToday, { forceHour }));
      const ig = await runPhase("instagram", () => runInstagramPhase(scheduledToday, { forceHour }));

      const tikTokResults = "error" in tikTok ? [] : tikTok.results;
      const debugLog = "error" in tikTok ? [`tiktok phase crashed: ${tikTok.error}`] : tikTok.debugLog;
      const topNResults = "error" in topN ? [] : topN.topNResults;
      const igAutoResults = "error" in ig ? [] : ig.igAutoResults;

      cronResult = NextResponse.json({
        ok: true,
        results: tikTokResults,
        topNResults,
        igAutoResults,
        debugLog,
      });
    } finally {
      await releaseLock();
    }

    return cronResult;
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n\n${err.stack || ""}` : String(err);
    await notify({
      subject: "BookPulls Creator: cron run crashed",
      body: `The cron run threw before completing.\n\n${msg}`,
      dedupeKey: "cron-crash",
      cooldownSec: 1800,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
