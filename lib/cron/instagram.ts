import {
  getIgAutomation,
  getIgSlideshows,
  setIgAutomation,
  getAppSettings,
  appendPostLog,
} from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { generateImageWithInfo } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled } from "./scheduled-today";
import type { IgResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runInstagramPhase(
  scheduledToday: Set<string>,
  opts?: { forceHour?: number }
): Promise<{ igAutoResults: IgResult[] }> {
  const forceHour = opts?.forceHour;
  const igAutoResults: IgResult[] = [];
  const users = await listUsers();

  // Pre-collect all IG schedule keys across all users and mark upfront
  const igSchedKeysToMark: string[] = [];
  const igUserData: Array<{
    user: typeof users[0];
    igAuto: Awaited<ReturnType<typeof getIgAutomation>>;
    igSlideshows: Awaited<ReturnType<typeof getIgSlideshows>>;
    allowedIds: number[] | undefined;
  }> = [];

  for (const user of users) {
    try {
      const igAuto = await getIgAutomation(user.id);
      if (!igAuto.accounts || Object.keys(igAuto.accounts).length === 0) continue;
      const igSlideshows = await getIgSlideshows(user.id);
      if (igSlideshows.length === 0) continue;
      const settings = await getAppSettings(user.id);
      const allowedIds = settings.allowedAccountIds;
      igUserData.push({ user, igAuto, igSlideshows, allowedIds });

      for (const [accIdStr, accConfig] of Object.entries(igAuto.accounts)) {
        if (!accConfig.enabled || accConfig.intervals.length === 0) continue;
        const accId = Number(accIdStr);
        if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(accId)) continue;
        for (const win of accConfig.intervals) {
          const igSchedKey = `ig:${user.id}:${accIdStr}:${win.start}`;
          if (shouldProcessWindow(win.start, forceHour) && !scheduledToday.has(igSchedKey)) {
            igSchedKeysToMark.push(igSchedKey);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      igAutoResults.push({ userId: user.id, status: `IG automation error: ${msg}` });
    }
  }

  if (igSchedKeysToMark.length > 0) {
    await markScheduled(igSchedKeysToMark);
  }

  // Now do heavy work for IG
  for (const { user, igAuto, igSlideshows, allowedIds } of igUserData) {
    try {
      let updated = false;
      const updatedAccounts = { ...igAuto.accounts };

      for (const [accIdStr, accConfig] of Object.entries(igAuto.accounts)) {
        if (!accConfig.enabled || accConfig.intervals.length === 0) continue;
        const accId = Number(accIdStr);
        if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(accId)) continue;

        let pool = igSlideshows;
        if (accConfig.bookIds.length > 0) {
          pool = pool.filter((s) => s.sourceBookId && accConfig.bookIds.includes(s.sourceBookId));
        }
        if (accConfig.slideshowIds.length > 0) {
          pool = pool.filter((s) => accConfig.slideshowIds.includes(s.id));
        }
        if (pool.length === 0) continue;

        let pointer = accConfig.pointer;

        for (const win of accConfig.intervals) {
          const igSchedKey = `ig:${user.id}:${accIdStr}:${win.start}`;
          if (!shouldProcessWindow(win.start, forceHour) || scheduledToday.has(igSchedKey)) continue;
          const ss = pool[pointer % pool.length];
          const prompt = pickRandom(ss.imagePrompts);
          const caption = pickRandom(ss.captions);
          if (!prompt) continue;

          const texts = ss.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);
          if (texts.length < 2) continue;

          try {
            const imgResult = await generateImageWithInfo(prompt.value);
            if (!imgResult.data) {
              igAutoResults.push({ userId: user.id, status: `skip: image gen failed for ${ss.name} (${accIdStr}) — ${imgResult.error || "unknown"}` });
              continue;
            }
            const image = imgResult.data;
            const slideBufs: Buffer[] = [];

            for (const text of texts) {
              slideBufs.push(await renderSlide(image, text));
            }
            const mediaIds: string[] = [];
            for (let j = 0; j < slideBufs.length; j++) {
              mediaIds.push(await uploadPng(slideBufs[j], `ig-auto-${accIdStr}-${j + 1}.png`));
            }

            const isIg = igAuto.igAccountIds?.includes(accId) || !igAuto.tiktokAccountIds?.includes(accId);
            const platformCfg = isIg
              ? { instagram: {} }
              : { tiktok: { draft: false, is_aigc: false } };

            const scheduledAt = randomTimeInWindow(win.start, win.end);
            const postResp = await pbFetch("/v1/posts", {
              method: "POST",
              body: JSON.stringify({
                caption: caption?.value || "",
                media: mediaIds,
                social_accounts: [accId],
                scheduled_at: scheduledAt.toISOString(),
                platform_configurations: platformCfg,
              }),
            });
            const postId = postResp.id || postResp.data?.id || "unknown";
            const postUrl = postResp.url || postResp.data?.url || "";
            igAutoResults.push({
              userId: user.id,
              status: `${ss.name} → ${accIdStr} at ${scheduledAt.toISOString()} [post:${postId}]`,
            });

            const igNow = new Date();
            await appendPostLog({
              date: igNow.toISOString().slice(0, 10),
              time: igNow.toISOString().slice(11, 16),
              accountId: accId,
              accountName: accIdStr,
              bookName: "",
              slideshowId: ss.id,
              slideshowName: ss.name,
              imagePromptId: prompt?.id || "",
              imagePromptText: (prompt?.value || "").slice(0, 100),
              captionId: caption?.id || "",
              captionText: (caption?.value || "").slice(0, 100),
              postBridgeId: String(postId),
              postBridgeUrl: String(postUrl),
              source: "cron-ig",
              userId: user.id,
              timestamp: igNow.toISOString(),
            }).catch(() => {});
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            igAutoResults.push({ userId: user.id, status: `error (${accIdStr}): ${msg}` });
          }

          pointer++;
        }

        updatedAccounts[accIdStr] = { ...accConfig, pointer };
        updated = true;
      }

      if (updated) {
        await setIgAutomation(user.id, { ...igAuto, accounts: updatedAccounts });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      igAutoResults.push({ userId: user.id, status: `IG automation error: ${msg}` });
    }
  }

  return { igAutoResults };
}
