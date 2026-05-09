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
import type { TopNResult } from "./types";

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

        // Build one job per window, each picking a different list via pointer rotation
        // Cap windows to pool size so we never post the same list twice
        let currentPointer = accConfig.pointer;
        const windowsToProcess = activeWindows.slice(0, pool.length);
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
    }
  }

  // Mark ALL TopN schedule keys NOW before heavy work
  const allTopNSchedKeys = topNJobs.flatMap((j) => j.schedKeys);
  if (allTopNSchedKeys.length > 0) {
    await markScheduled(allTopNSchedKeys);
  }

  // Now do heavy work
  const failedTopNKeys: string[] = [];
  const topnSuccessAccounts = new Set<string>(); // userId:accIdStr
  for (const topNJob of topNJobs) {
    for (const win of topNJob.activeWindows) {
      try {
        const scheduledAt = randomTimeInWindow(win.start, win.end);
        const r = await publishTopN({
          userId: topNJob.user.id,
          listId: topNJob.selectedList.id,
          accountIds: [Number(topNJob.accIdStr)],
          scheduledAt: scheduledAt.toISOString(),
          platform: topNJob.accConfig.platform,
          backgroundPrompts: topNJob.accConfig.backgroundPrompts,
        });
        topNResults.push({
          userId: topNJob.user.id,
          listName: topNJob.selectedList.name,
          status: `${topNJob.accIdStr}: scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
        });
        topnSuccessAccounts.add(`${topNJob.user.id}:${topNJob.accIdStr}`);

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        topNResults.push({
          userId: topNJob.user.id,
          listName: topNJob.selectedList.name,
          status: `error (${topNJob.accIdStr}): ${msg}`,
        });
        failedTopNKeys.push(`topn:${topNJob.user.id}:${topNJob.accIdStr}:${win.start}`);
      }
    }
  }
  if (failedTopNKeys.length > 0) {
    await unmarkScheduled(failedTopNKeys);
  }

  // Only advance pointer and lastPostDate for accounts with at least one success
  for (const topNJob of topNJobs) {
    const key = `${topNJob.user.id}:${topNJob.accIdStr}`;
    if (topnSuccessAccounts.has(key)) {
      const userId = topNJob.user.id;
      if (!topNAutoByUser.has(userId)) continue;
      const { updated } = topNAutoByUser.get(userId)!;
      updated[topNJob.accIdStr] = {
        ...topNJob.accConfig,
        pointer: topNJob._finalPointer,
        lastPostDate: new Date().toISOString().slice(0, 10),
      };
    }
  }

  // Save updated pointers
  for (const [userId, { updated }] of topNAutoByUser) {
    try {
      await setTopNAutomation(userId, { accounts: updated });
    } catch {}
  }

  return { topNResults };
}
