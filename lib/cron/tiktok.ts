import {
  getAccountData,
  setAccountData,
  getBooks,
  getBookCover,
  getAppSettings,
} from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { generateImageWithInfo } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { listTikTokAccounts, pbFetch, uploadPng } from "@/lib/post-bridge";
import { shouldProcessWindow, randomTimeInWindow } from "./window";
import { markScheduled, unmarkScheduled, getScheduledToday } from "./scheduled-today";
import type { Job, CronAccountResult } from "./types";

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function runTikTokPhase(
  scheduledToday: Set<string>,
  opts?: { dryRun?: boolean; forceHour?: number }
): Promise<{ results: CronAccountResult[]; debugLog: string[] }> {
  const dryRun = opts?.dryRun ?? false;
  const forceHour = opts?.forceHour;
  const results: CronAccountResult[] = [];
  const debugLog: string[] = [];

  const [allAccounts, users] = await Promise.all([
    listTikTokAccounts(),
    listUsers(),
  ]);

  const nowUtc = new Date();
  debugLog.push(`Running at ${nowUtc.toISOString()}, ${users.length} users, ${allAccounts.length} PB accounts`);

  // Phase 1: build jobs across all users, respecting each user's allowedAccountIds
  const jobs: Job[] = [];
  const pointerUpdates = new Map<string, number>();
  const promptPointerUpdates = new Map<string, number>();
  const accountDataMap = new Map<
    string,
    Awaited<ReturnType<typeof getAccountData>>
  >();

  const accountOwner = new Map<number, { user: typeof users[0]; data: Awaited<ReturnType<typeof getAccountData>>; books: Awaited<ReturnType<typeof getBooks>> }>();

  for (const user of users) {
    const settings = await getAppSettings(user.id);
    const allowedIds = settings.allowedAccountIds;
    const isAdmin = user.role === "admin";
    const userAccounts = isAdmin
      ? allAccounts
      : allowedIds && allowedIds.length > 0
        ? allAccounts.filter((a) => allowedIds.includes(a.id))
        : [];

    debugLog.push(`User ${user.id} (${user.role}): ${userAccounts.length} accounts (allowedIds: ${JSON.stringify(allowedIds)})`);

    const rawBooks = await getBooks(user.id);
    const books = await Promise.all(
      rawBooks.map(async (b) => {
        if (b.coverImage) return b;
        const cover = await getBookCover(user.id, b.id);
        return cover ? { ...b, coverImage: cover } : b;
      })
    );
    debugLog.push(`User ${user.id}: ${books.length} books`);

    for (const acc of userAccounts) {
      try {
        const data = await getAccountData(user.id, acc.id);
        accountDataMap.set(`${user.id}:${acc.id}`, data);

        if (isAdmin) {
          debugLog.push(`ADMIN-CFG ${acc.username} (${acc.id}): enabled=${data.config.enabled} intervals=${JSON.stringify(data.config.intervals || 'none')} selections=${data.config.selections?.length ?? 0}`);
        }

        if (!data.config.enabled) {
          debugLog.push(`Account ${acc.username} (${acc.id}) [u:${user.id}]: disabled`);
          continue;
        }

        const existing = accountOwner.get(acc.id);
        if (!existing) {
          accountOwner.set(acc.id, { user, data, books });
        } else if (!isAdmin && existing.user.role === "admin") {
          accountOwner.set(acc.id, { user, data, books });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ userId: user.id, accountId: acc.id, username: acc.username, status: `error: ${msg}` });
      }
    }
  }

  for (const acc of allAccounts) {
    const owner = accountOwner.get(acc.id);
    if (!owner) continue;
    const { user, data, books } = owner;

    try {
        if (!data.config.enabled) {
          debugLog.push(`Account ${acc.username} (${acc.id}): disabled`);
          continue;
        }

        const windows = data.config.intervals;

        debugLog.push(`Account ${acc.username} (${acc.id}) [owner:${user.id} ${user.role}]: enabled, windows: ${JSON.stringify(windows)}`);

        for (const win of windows) {
          const willProcess = shouldProcessWindow(win.start, forceHour);
          const schedKey = `${user.id}:${acc.id}:${win.start}`;
          const alreadyScheduled = scheduledToday.has(schedKey);
          debugLog.push(`Window ${win.start}-${win.end}: shouldProcess=${willProcess}, alreadyScheduled=${alreadyScheduled}`);
          if (!willProcess || alreadyScheduled) continue;
          let imagePrompt = "";
          let slideTexts: string[] = [];
          let captionText = "";
          let source = "";
          let coverImage: string | undefined;
          let slideshowName = "";
          let bookName = "";

          const candidates: Array<{
            book: (typeof books)[0];
            slideshow: (typeof books)[0]["slideshows"][0];
          }> = [];

          debugLog.push(`  Config: selections=${data.config.selections.length}`);

          for (const sel of data.config.selections) {
            const book = books.find((b) => b.id === sel.bookId);
            const slideshow = book?.slideshows.find(
              (s) => s.id === sel.slideshowId
            );
            if (book && slideshow) {
              candidates.push({ book, slideshow });
            } else {
              debugLog.push(`  Selection miss: bookId=${sel.bookId} found=${!!book}, slideshowId=${sel.slideshowId} found=${!!slideshow}`);
            }
          }

          debugLog.push(`  Candidates: ${candidates.length}`);

          if (candidates.length > 0) {
            const ownerKey = `${user.id}:${acc.id}`;
            const currentPointer = pointerUpdates.get(ownerKey) ?? (data.config.pointer || 0);
            const pickedIdx = currentPointer % candidates.length;
            const picked = candidates[pickedIdx];
            pointerUpdates.set(ownerKey, currentPointer + 1);

            if (!picked || !picked.slideshow.slideTexts.trim()) {
              debugLog.push(`  Skip: picked slideshow has no text`);
              continue;
            }
            const { book, slideshow: pickedSlideshow } = picked;
            const linkedPrompts = (book.imagePrompts || []).filter((p) =>
              pickedSlideshow.imagePromptIds.includes(p.id)
            );
            const linkedCaptions = (book.captions || []).filter((c) =>
              pickedSlideshow.captionIds.includes(c.id)
            );
            const allowedPrompts =
              linkedPrompts.length > 0 ? linkedPrompts : book.imagePrompts || [];
            const allowedCaptions =
              linkedCaptions.length > 0 ? linkedCaptions : book.captions || [];
            const currentPromptPointer = promptPointerUpdates.get(ownerKey) ?? (data.config.promptPointer || 0);
            const pickedPrompt = allowedPrompts.length > 0 ? allowedPrompts[currentPromptPointer % allowedPrompts.length] : null;
            promptPointerUpdates.set(ownerKey, currentPromptPointer + 1);
            const pickedCaption = pickRandom(allowedCaptions);
            if (!pickedPrompt) {
              debugLog.push(`  Skip: no image prompts (linked=${linkedPrompts.length}, book=${(book.imagePrompts||[]).length})`);
              continue;
            }
            imagePrompt = pickedPrompt.value;
            slideTexts = pickedSlideshow.slideTexts
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean);
            if (book.coverImage && slideTexts.length > 2) {
              slideTexts = slideTexts.slice(0, -1);
            }
            captionText = pickedCaption?.value || "";
            coverImage = book.coverImage;
            bookName = book.name;
            slideshowName = pickedSlideshow.name;
            source = `book:${book.name}/${pickedSlideshow.name}`;
            debugLog.push(`  Picked [${pickedIdx}/${candidates.length}]: ${source}, ${slideTexts.length} slides, prompt="${imagePrompt.slice(0,40)}..."`);
          } else {
            const prompt = pickRandom(data.prompts);
            const textSet = pickRandom(data.texts);
            const captionItem = pickRandom(data.captions);
            if (!prompt || !textSet) {
              debugLog.push(`  Skip: no legacy prompts/texts (prompts=${data.prompts.length}, texts=${data.texts.length})`);
              continue;
            }
            imagePrompt = prompt.value;
            slideTexts = textSet.value
              .split("\n")
              .map((t) => t.trim())
              .filter(Boolean);
            captionText = captionItem?.value || "";
            source = "legacy-saved";
          }

          if (slideTexts.length < 2) continue;

          jobs.push({
            userId: user.id,
            acc,
            win,
            imagePrompt,
            slideTexts,
            captionText,
            source,
            coverImage,
            schedKey,
            slideshowName,
            bookName,
          });
        }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ userId: user.id, accountId: acc.id, username: acc.username, status: `error: ${msg}` });
    }
  }

  jobs.sort((a, b) => {
    const [ah, am] = a.win.start.split(":").map(Number);
    const [bh, bm] = b.win.start.split(":").map(Number);
    return (ah * 60 + am) - (bh * 60 + bm);
  });

  debugLog.push(`Jobs built: ${jobs.length}${dryRun ? ' (DRY RUN — stopping here)' : ''}`);
  for (const j of jobs) {
    debugLog.push(`  Job: ${j.acc.username} (${j.acc.id}), win=${j.win.start}-${j.win.end}, src=${j.source}, slides=${j.slideTexts.length}, prompt="${j.imagePrompt.slice(0,50)}..."`);
  }

  if (dryRun) {
    return { results, debugLog };
  }

  const allSchedKeys = jobs.map((j) => j.schedKey);
  if (allSchedKeys.length > 0) {
    await markScheduled(allSchedKeys);
  }

  // Save pointers NOW — before heavy work.
  for (const [k, rawPointer] of pointerUpdates) {
    const [userId, accIdStr] = k.split(":");
    const accId = Number(accIdStr);
    const data = accountDataMap.get(k);
    if (!data) continue;
    const rawPromptPointer = promptPointerUpdates.get(k);
    const newPointer = rawPointer + 1;
    const newPromptPointer = rawPromptPointer !== undefined ? rawPromptPointer + 1 : data.config.promptPointer;
    try {
      await setAccountData(userId, accId, {
        ...data,
        config: { ...data.config, pointer: newPointer, promptPointer: newPromptPointer },
      }, "cron-pointer-early");
      debugLog.push(`Early pointer save ${k}: pointer=${newPointer}, promptPointer=${newPromptPointer}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`Early pointer save FAILED ${k}: ${msg}`);
    }
  }

  // Phase 2+3: Generate image, render slides, and post
  const postResults: Array<{ job: Job; status: string; scheduledAt?: string; postId?: string }> = [];

  for (const job of jobs) {
    try {
      const imgResult = await generateImageWithInfo(job.imagePrompt);
      if (!imgResult.data) {
        debugLog.push(`${job.acc.username} (${job.acc.id}) ${job.win.start}: image gen failed — ${imgResult.error || "unknown"}`);
        postResults.push({ job, status: `skipped: image generation failed — ${imgResult.error || "unknown"}` });
        continue;
      }

      const slideBufs: Buffer[] = [];
      for (const text of job.slideTexts) {
        slideBufs.push(await renderSlide(imgResult.data, text));
      }

      const mediaIds: string[] = [];
      for (let j = 0; j < slideBufs.length; j++) {
        mediaIds.push(await uploadPng(slideBufs[j], `slide-${j + 1}.png`));
      }

      if (job.coverImage) {
        const base64 = job.coverImage.replace(/^data:[^;]+;base64,/, "");
        const coverBuf = Buffer.from(base64, "base64");
        mediaIds.push(await uploadPng(coverBuf, `slide-${slideBufs.length + 1}-cover.png`));
      }

      const scheduledAt = randomTimeInWindow(job.win.start, job.win.end);

      const postResp = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: job.captionText,
          media: mediaIds,
          social_accounts: [job.acc.id],
          scheduled_at: scheduledAt.toISOString(),
          platform_configurations: { tiktok: { draft: false, is_aigc: false } },
        }),
      });

      const postId = postResp.id || postResp.data?.id || "unknown";
      postResults.push({
        job,
        status: `scheduled ${job.slideTexts.length} slides for ${scheduledAt.toISOString()} (${job.source}) [post:${postId}]`,
        scheduledAt: scheduledAt.toISOString(),
        postId: String(postId),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`${job.acc.username} (${job.acc.id}) ${job.win.start}: job error — ${msg}`);
      postResults.push({ job, status: `error: ${msg}` });
    }
  }

  // Un-mark failed keys
  const failedSchedKeys = postResults
    .filter((r) => r.status.startsWith("skipped:") || r.status.startsWith("error:"))
    .map((r) => r.job.schedKey);
  if (failedSchedKeys.length > 0) {
    debugLog.push(`Un-marking ${failedSchedKeys.length} failed schedule keys: ${JSON.stringify(failedSchedKeys)}`);
    await unmarkScheduled(failedSchedKeys);
  }

  // Phase 4: aggregate results and save status + history
  const keyStatuses = new Map<string, string[]>();
  const keyNewPosts = new Map<string, Array<{ slideshowName: string; bookName: string; promptSnippet: string; scheduledAt: string; postId: string; timestamp: string }>>();
  for (const r of postResults) {
    const k = `${r.job.userId}:${r.job.acc.id}`;
    if (!keyStatuses.has(k)) keyStatuses.set(k, []);
    keyStatuses.get(k)!.push(r.status);
    if (r.scheduledAt && r.postId) {
      if (!keyNewPosts.has(k)) keyNewPosts.set(k, []);
      keyNewPosts.get(k)!.push({
        slideshowName: r.job.slideshowName || "unknown",
        bookName: r.job.bookName || "unknown",
        promptSnippet: r.job.imagePrompt.slice(0, 60),
        scheduledAt: r.scheduledAt,
        postId: r.postId,
        timestamp: new Date().toISOString(),
      });
    }
  }

  for (const [k, statuses] of keyStatuses) {
    const [userId, accIdStr] = k.split(":");
    const accId = Number(accIdStr);
    const acc = jobs.find((j) => j.userId === userId && j.acc.id === accId)?.acc;
    const status = statuses.join(" | ");
    results.push({ userId, accountId: accId, username: acc?.username || "unknown", status });
    try {
      const freshData = await getAccountData(userId, accId);
      const existingHistory = freshData.recentPosts || [];
      const newHistory = [...(keyNewPosts.get(k) || []), ...existingHistory].slice(0, 20);
      await setAccountData(userId, accId, {
        ...freshData,
        lastRun: new Date().toISOString(),
        lastStatus: status,
        recentPosts: newHistory,
      }, "cron-status");
    } catch (saveErr) {
      const msg = saveErr instanceof Error ? saveErr.message : String(saveErr);
      debugLog.push(`Save error for ${k}: ${msg}`);
    }
  }

  // Fallback: if ALL windows passed and no successful post, try once more now
  const currentScheduled = await getScheduledToday();
  const successfulAccounts = new Set(
    postResults
      .filter((r) => !r.status.startsWith("skipped:") && !r.status.startsWith("error:"))
      .map((r) => `${r.job.userId}:${r.job.acc.id}`)
  );

  for (const acc of allAccounts) {
    const owner = accountOwner.get(acc.id);
    if (!owner) continue;
    const { user, data, books } = owner;
    if (!data.config.enabled || data.config.intervals.length === 0) continue;
    const ownerKey = `${user.id}:${acc.id}`;
    if (successfulAccounts.has(ownerKey)) continue;
    const anyWindowLeft = data.config.intervals.some((w) => shouldProcessWindow(w.start, forceHour));
    if (anyWindowLeft) continue;
    const hasSuccessKey = data.config.intervals.some((w) =>
      currentScheduled.has(`${user.id}:${acc.id}:${w.start}`)
    );
    if (hasSuccessKey) continue;

    debugLog.push(`${acc.username} (${acc.id}) [u:${user.id}]: fallback — all windows passed with no successful post`);
    const candidates: Array<{ book: (typeof books)[0]; slideshow: (typeof books)[0]["slideshows"][0] }> = [];
    for (const sel of data.config.selections) {
      const book = books.find((b) => b.id === sel.bookId);
      const slideshow = book?.slideshows.find((s) => s.id === sel.slideshowId);
      if (book && slideshow) candidates.push({ book, slideshow });
    }
    if (candidates.length === 0) continue;

    const ptr = pointerUpdates.get(ownerKey) ?? (data.config.pointer || 0);
    const picked = candidates[ptr % candidates.length];
    if (!picked || !picked.slideshow.slideTexts.trim()) continue;

    const { book, slideshow: pickedSlideshow } = picked;
    const linkedPrompts = (book.imagePrompts || []).filter((p) => pickedSlideshow.imagePromptIds.includes(p.id));
    const allowedPrompts = linkedPrompts.length > 0 ? linkedPrompts : book.imagePrompts || [];
    const pPtr = promptPointerUpdates.get(ownerKey) ?? (data.config.promptPointer || 0);
    const pickedPrompt = allowedPrompts.length > 0 ? allowedPrompts[pPtr % allowedPrompts.length] : null;
    if (!pickedPrompt) continue;

    const slideTexts = pickedSlideshow.slideTexts.split("\n").map((t) => t.trim()).filter(Boolean);
    if (slideTexts.length < 2) continue;
    const finalTexts = book.coverImage && slideTexts.length > 2 ? slideTexts.slice(0, -1) : slideTexts;

    const linkedCaptions = (book.captions || []).filter((c) => pickedSlideshow.captionIds.includes(c.id));
    const allowedCaptions = linkedCaptions.length > 0 ? linkedCaptions : book.captions || [];
    const captionText = pickRandom(allowedCaptions)?.value || "";

    try {
      const imgResult = await generateImageWithInfo(pickedPrompt.value);
      if (!imgResult.data) {
        debugLog.push(`${acc.username} (${acc.id}) fallback: image gen failed — ${imgResult.error || "unknown"}`);
        results.push({ userId: user.id, accountId: acc.id, username: acc.username, status: `fallback failed: ${imgResult.error || "image gen failed"}` });
        continue;
      }

      const slideBufs: Buffer[] = [];
      for (const text of finalTexts) {
        slideBufs.push(await renderSlide(imgResult.data, text));
      }
      const mediaIds: string[] = [];
      for (let j = 0; j < slideBufs.length; j++) {
        mediaIds.push(await uploadPng(slideBufs[j], `slide-${j + 1}.png`));
      }
      if (book.coverImage) {
        const b64 = book.coverImage.replace(/^data:[^;]+;base64,/, "");
        mediaIds.push(await uploadPng(Buffer.from(b64, "base64"), `slide-cover.png`));
      }

      const scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      const postResp = await pbFetch("/v1/posts", {
        method: "POST",
        body: JSON.stringify({
          caption: captionText,
          media: mediaIds,
          social_accounts: [acc.id],
          scheduled_at: scheduledAt.toISOString(),
          platform_configurations: { tiktok: { draft: false, is_aigc: false } },
        }),
      });
      const postId = postResp.id || postResp.data?.id || "unknown";
      const status = `fallback: scheduled ${finalTexts.length} slides for ${scheduledAt.toISOString()} (book:${book.name}/${pickedSlideshow.name}) [post:${postId}]`;
      results.push({ userId: user.id, accountId: acc.id, username: acc.username, status });

      await markScheduled([`${user.id}:${acc.id}:fallback`]);
      const newPointer = ptr + 1;
      const newPromptPointer = pPtr + 1;
      await setAccountData(user.id, acc.id, {
        ...data,
        config: { ...data.config, pointer: newPointer, promptPointer: newPromptPointer },
        lastRun: new Date().toISOString(),
        lastStatus: status,
      }, "cron-fallback");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog.push(`${acc.username} (${acc.id}) fallback error: ${msg}`);
      results.push({ userId: user.id, accountId: acc.id, username: acc.username, status: `fallback error: ${msg}` });
    }
  }

  return { results, debugLog };
}
