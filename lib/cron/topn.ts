import {
  getTopNLists,
  getTopNAutomation,
  setTopNAutomation,
  appendPostLog,
} from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { publishTopN } from "@/lib/topn-publisher";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled } from "./scheduled-today";
import { notify } from "@/lib/notify";
import { notifyPostFailure } from "@/lib/post-failure";
import { withJobTimeout, JOB_TIMEOUT_MS } from "./with-timeout";
import type { TopNResult } from "./types";

// Cap concurrent TopN publishes; each takes 30-90s and serial processing at
// 13+ accounts was blowing past Vercel's request timeout and killing the
// function mid-loop. See 2026-07-05 incident-log entry.
const TOPN_BATCH_SIZE = 3;

export async function runTopNPhase(
  scheduledToday: Set<string>,
  opts?: { forceHour?: number }
): Promise<{ topNResults: TopNResult[] }> {
  const forceHour = opts?.forceHour;
  const topNResults: TopNResult[] = [];
  const users = await listUsers();

  // Pre-collect TopN jobs across all users, mark schedule keys upfront
  interface TopNJob {
    user: typeof users[0];
    accIdStr: string;
    accConfig: Awaited<ReturnType<typeof getTopNAutomation>>["accounts"][string];
    selectedList: Awaited<ReturnType<typeof getTopNLists>>[0];
    activeWindows: { start: string; end: string }[];
    schedKeys: string[];
    _finalPointer: number;
  }
  const topNJobs: TopNJob[] = [];
  const excessSchedKeys: string[] = [];
  const topNAutoByUser = new Map<string, { auto: Awaited<ReturnType<typeof getTopNAutomation>>; updated: Record<string, typeof topNJobs[0]["accConfig"]> }>();

  for (const user of users) {
    try {
      const [topNLists, topNAuto] = await Promise.all([
        getTopNLists(user.id),
        getTopNAutomation(user.id),
      ]);
      const today = new Date().toISOString().slice(0, 10);
      const updatedTopNAccounts = { ...topNAuto.accounts };
      topNAutoByUser.set(user.id, { auto: topNAuto, updated: updatedTopNAccounts });

      for (const [accIdStr, accConfig] of Object.entries(topNAuto.accounts)) {
        if (!accConfig.enabled || accConfig.intervals.length === 0) continue;

        // Frequency check
        if (accConfig.lastPostDate) {
          const lastDate = new Date(accConfig.lastPostDate + "T00:00:00Z");
          const todayDate = new Date(today + "T00:00:00Z");
          const daysSince = Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000);
          if (daysSince < accConfig.frequencyDays) continue;
        }

        // Build eligible list pool
        let pool = topNLists.filter((l) => l.bookIds.length > 0 || (l.genres && l.genres.length > 0));
        if (accConfig.listIds.length > 0) {
          pool = pool.filter((l) => accConfig.listIds.includes(l.id));
        }
        if (pool.length === 0) continue;

        const activeWindows = accConfig.intervals.filter((w) => {
          const sk = `topn:${user.id}:${accIdStr}:${w.start}`;
          return shouldProcessWindow(w.start, forceHour) && !scheduledToday.has(sk);
        });
        if (activeWindows.length === 0) continue;

        const schedKeys = activeWindows.map((w) => `topn:${user.id}:${accIdStr}:${w.start}`);

        // Cap windows to pool size so we never post the same list twice.
        // Mark ALL window keys (including excess) so skipped windows don't fire on later cron runs.
        let currentPointer = accConfig.pointer;
        const windowsToProcess = activeWindows.slice(0, pool.length);
        const excessKeys = activeWindows.slice(pool.length).map((w) => `topn:${user.id}:${accIdStr}:${w.start}`);
        if (excessKeys.length > 0) {
          excessSchedKeys.push(...excessKeys);
        }
        for (const win of windowsToProcess) {
          const listIndex = currentPointer % pool.length;
          const selectedList = pool[listIndex];
          currentPointer++;
          topNJobs.push({ user, accIdStr, accConfig, selectedList, activeWindows: [win], schedKeys: [schedKeys[activeWindows.indexOf(win)]], _finalPointer: currentPointer });
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      topNResults.push({ userId: user.id, listName: "(topn-auto)", status: `error: ${msg}` });
      await notify({
        subject: `[CONFIRMED] TopN build failed for user ${user.id}`,
        body: `Confirmed failure - this is config/data, not a transient blip.\n\nUser: ${user.id}\nStep: TopN job build (before publishing)\n\n${msg}`,
        dedupeKey: `topn-build-fail:${user.id}:${new Date().toISOString().slice(0, 13)}`,
        cooldownSec: 3600,
      });
    }
  }

  // Mark ALL TopN schedule keys NOW before heavy work (including excess windows)
  const allTopNSchedKeys = [...topNJobs.flatMap((j) => j.schedKeys), ...excessSchedKeys];
  if (allTopNSchedKeys.length > 0) {
    await markScheduled(allTopNSchedKeys);
  }

  // EARLY SAVE (2026-07-05 revision): advance pointer BEFORE heavy work so
  // pointer rotation is guaranteed even if the cron times out (2026-06-02
  // stuck-rotation fix). +1 bump prevents cycling on windows == pool size
  // (2026-05-07 incident). Use a map so multi-window accounts only get +1
  // once, not per window.
  //
  // We NO LONGER set lastPostDate=today in this early save. The old code
  // set lastPostDate for every account before publishTopN ran, so a Vercel
  // timeout mid-loop marked unprocessed accounts as posted and locked them
  // out via the frequency check on the next cron. lastPostDate is now saved
  // per-account after publishTopN succeeds, in phase 3 below.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const finalPointerByAccount = new Map<string, number>();
  for (const topNJob of topNJobs) {
    const key = `${topNJob.user.id}:${topNJob.accIdStr}`;
    const current = finalPointerByAccount.get(key) ?? -Infinity;
    if (topNJob._finalPointer > current) {
      finalPointerByAccount.set(key, topNJob._finalPointer);
    }
  }
  for (const topNJob of topNJobs) {
    const entry = topNAutoByUser.get(topNJob.user.id);
    if (!entry) continue;
    const key = `${topNJob.user.id}:${topNJob.accIdStr}`;
    const finalPointer = finalPointerByAccount.get(key) ?? topNJob._finalPointer;
    entry.updated[topNJob.accIdStr] = {
      ...topNJob.accConfig,
      pointer: finalPointer + 1,
    };
  }
  for (const [userId, { updated }] of topNAutoByUser) {
    try {
      await setTopNAutomation(userId, { accounts: updated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await notify({
        subject: `BookPulls Creator: TopN early pointer save failed for user ${userId}`,
        body: `setTopNAutomation threw during the early save for user ${userId}. Pointer may not advance for today; tomorrow's cron may repeat today's lists for this user's accounts.\n\n${msg}`,
        dedupeKey: `topn-early-save-fail:${userId}`,
        cooldownSec: 3600,
      });
    }
  }

  // Heavy work — batched via Promise.allSettled so N accounts at 30-90s
  // each don't blow past Vercel's request timeout.
  const failedTopNKeys: string[] = [];
  const successfulByUser = new Map<string, Set<string>>();

  async function runJob(topNJob: TopNJob): Promise<void> {
    for (const win of topNJob.activeWindows) {
      let scheduledAt: Date | undefined;
      try {
        scheduledAt = randomTimeInWindow(win.start, win.end);
        const r = await withJobTimeout(
          publishTopN({
            userId: topNJob.user.id,
            listId: topNJob.selectedList.id,
            accountIds: [Number(topNJob.accIdStr)],
            scheduledAt: scheduledAt.toISOString(),
            platform: topNJob.accConfig.platform,
            backgroundPrompts: topNJob.accConfig.backgroundPrompts,
          }),
          JOB_TIMEOUT_MS,
          `topn user=${topNJob.user.id} acc=${topNJob.accIdStr} list=${topNJob.selectedList.id}`,
        );
        topNResults.push({
          userId: topNJob.user.id,
          listName: topNJob.selectedList.name,
          status: `${topNJob.accIdStr}: scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
        });

        const now = new Date();
        await appendPostLog({
          date: now.toISOString().slice(0, 10),
          time: now.toISOString().slice(11, 16),
          accountId: Number(topNJob.accIdStr),
          accountName: topNJob.accIdStr,
          bookName: "",
          slideshowId: "",
          slideshowName: topNJob.selectedList.name,
          imagePromptId: "",
          imagePromptText: "",
          captionId: "",
          captionText: "",
          postBridgeId: String(r.postId),
          postBridgeUrl: String(r.postUrl || ""),
          source: "cron-topn",
          userId: topNJob.user.id,
          timestamp: now.toISOString(),
        }).catch(() => {});

        if (!successfulByUser.has(topNJob.user.id)) {
          successfulByUser.set(topNJob.user.id, new Set());
        }
        successfulByUser.get(topNJob.user.id)!.add(topNJob.accIdStr);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const result = await notifyPostFailure({
          subject: `[CONFIRMED] TopN post failed for account ${topNJob.accIdStr}`,
          body: `Confirmed failure after retries.\n\nUser: ${topNJob.user.id}\nAccount: ${topNJob.accIdStr}\nStep: TopN post pipeline\nList: ${topNJob.selectedList.name}\nWindow: ${win.start}-${win.end}\n\n${msg}`,
          error: err,
          accountId: Number(topNJob.accIdStr),
          scheduledAt,
          dedupeKey: `topn-fail:${topNJob.user.id}:${topNJob.accIdStr}:${new Date().toISOString().slice(0, 13)}`,
          cooldownSec: 3600,
        });
        if (result.verified) {
          topNResults.push({
            userId: topNJob.user.id,
            listName: topNJob.selectedList.name,
            status: `${topNJob.accIdStr}: verified-after-error`,
          });
          // Verified means PB has the post, so this account did publish.
          if (!successfulByUser.has(topNJob.user.id)) {
            successfulByUser.set(topNJob.user.id, new Set());
          }
          successfulByUser.get(topNJob.user.id)!.add(topNJob.accIdStr);
        } else {
          topNResults.push({
            userId: topNJob.user.id,
            listName: topNJob.selectedList.name,
            status: `error (${topNJob.accIdStr}): ${msg}`,
          });
          failedTopNKeys.push(`topn:${topNJob.user.id}:${topNJob.accIdStr}:${win.start}`);
        }
      }
    }
  }

  for (let i = 0; i < topNJobs.length; i += TOPN_BATCH_SIZE) {
    const batch = topNJobs.slice(i, i + TOPN_BATCH_SIZE);
    await Promise.allSettled(batch.map(runJob));
  }

  if (failedTopNKeys.length > 0) {
    await unmarkScheduled(failedTopNKeys);
  }

  // Phase 3: save lastPostDate=today per user for accounts that actually
  // published. Re-read config fresh per user to avoid stomping any
  // concurrent changes.
  for (const [userId, accIdSet] of successfulByUser) {
    if (accIdSet.size === 0) continue;
    try {
      const currentAuto = await getTopNAutomation(userId);
      const finalUpdated = { ...currentAuto.accounts };
      for (const accIdStr of accIdSet) {
        if (finalUpdated[accIdStr]) {
          finalUpdated[accIdStr] = {
            ...finalUpdated[accIdStr],
            lastPostDate: todayUtc,
          };
        }
      }
      await setTopNAutomation(userId, { accounts: finalUpdated });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await notify({
        subject: `BookPulls Creator: TopN lastPostDate save failed for user ${userId}`,
        body: `Post-publish lastPostDate save threw for user ${userId}. Accounts that published today may retry tomorrow if the pointer save already committed; harmless but noisy.\n\n${msg}`,
        dedupeKey: `topn-lastpost-save-fail:${userId}`,
        cooldownSec: 3600,
      });
    }
  }

  return { topNResults };
}
