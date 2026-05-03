import { NextRequest, NextResponse } from "next/server";
import {
  getAccountData,
  setAccountData,
  getBooks,
  getBookCover,
  getAppSettings,
  getTopNLists,
  getTopNAutomation,
  setTopNAutomation,
  getIgAutomation,
  getIgSlideshows,
  setIgAutomation,
  redis,
} from "@/lib/kv";
import { listUsers } from "@/lib/auth";
import { generateImage } from "@/lib/gemini";
import { renderSlide } from "@/lib/render-slide";
import { listTikTokAccounts, pbFetch, uploadPng } from "@/lib/post-bridge";
import { publishTopN } from "@/lib/topn-publisher";

export const maxDuration = 300; // 5 min for Hobby

function pickRandom<T>(arr: T[]): T | null {
  if (!arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// Check if a window should be scheduled: any window whose start hour is >= current hour
// (i.e., all remaining windows today). Duplicate prevention is handled by the
// scheduled-today tracking below.
function shouldProcessWindow(windowStart: string, forceHour?: number): boolean {
  const [sh] = windowStart.split(":").map(Number);
  const currentHour = forceHour ?? new Date().getUTCHours();
  return sh >= currentHour;
}

// Track which (user, account, window) combos have been scheduled today to avoid duplicates.
// Key: cron-scheduled:YYYY-MM-DD — value: Set of "userId:accountId:windowStart" strings.
// Expires at end of day.
const scheduledTodayKey = () => {
  const d = new Date().toISOString().slice(0, 10);
  return `cron-scheduled:${d}`;
};

async function getScheduledToday(): Promise<Set<string>> {
  const data = await redis.get<string[]>(scheduledTodayKey());
  return new Set(data || []);
}

async function markScheduled(entries: string[]): Promise<void> {
  if (entries.length === 0) return;
  const key = scheduledTodayKey();
  const existing = await redis.get<string[]>(key);
  const merged = [...(existing || []), ...entries];
  // Expire at midnight UTC + 1 hour buffer
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 1, 0, 0));
  const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);
  await redis.set(key, merged, { ex: ttl });
}

function randomTimeInWindow(windowStart: string, windowEnd: string): Date {
  const [sh, sm] = windowStart.split(":").map(Number);
  const [eh, em] = windowEnd.split(":").map(Number);
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  // Midnight wrap: e.g. 22:00→00:30 becomes 1320→1470 (next day)
  if (endMin <= startMin) endMin += 1440;
  const pickMin = startMin + Math.floor(Math.random() * (endMin - startMin));

  const now = new Date();
  const target = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      Math.floor(pickMin / 60),
      pickMin % 60,
      0,
      0
    )
  );
  if (target.getTime() <= now.getTime() + 60_000) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target;
}

interface Job {
  userId: string;
  acc: { id: number; username: string };
  win: { start: string; end: string };
  imagePrompt: string;
  slideTexts: string[];
  captionText: string;
  source: string;
  coverImage?: string;
  schedKey: string; // for duplicate tracking
  slideshowName: string;
  bookName: string;
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

  // Dry-run mode: ?dry=1 skips image generation and posting, only shows what WOULD happen
  // Force hour: ?hour=8 overrides the current UTC hour for window matching
  const urlParams = new URL(req.url).searchParams;
  const dryRun = urlParams.get("dry") === "1";
  const forceHour = urlParams.get("hour") ? Number(urlParams.get("hour")) : undefined;

  const results: Array<{
    userId: string;
    accountId: number;
    username: string;
    status: string;
  }> = [];
  const debugLog: string[] = [];

  try {
    // Acquire a Redis lock to prevent concurrent cron runs from creating duplicates.
    // The non-atomic read-then-write in markScheduled allows overlapping runs to both
    // read the same scheduled set and double-post. A lock ensures only one runs at a time.
    const CRON_LOCK_KEY = "cron-lock";
    const lockAcquired = await redis.set(CRON_LOCK_KEY, Date.now(), { nx: true, ex: 300 });
    if (!lockAcquired) {
      return NextResponse.json({ ok: true, skipped: true, reason: "Another cron run in progress" });
    }

    let cronResult;
    try {

    const [allAccounts, users, scheduledToday] = await Promise.all([
      listTikTokAccounts(),
      listUsers(),
      getScheduledToday(),
    ]);

    const nowUtc = new Date();
    debugLog.push(`Running at ${nowUtc.toISOString()}, ${users.length} users, ${allAccounts.length} PB accounts`);

    // Phase 1: build jobs across all users, respecting each user's allowedAccountIds
    const jobs: Job[] = [];
    const pointerUpdates = new Map<string, number>(); // key = userId:accountId, value = new pointer
    const promptPointerUpdates = new Map<string, number>(); // key = userId:accountId, value = new promptPointer
    const accountDataMap = new Map<
      string,
      Awaited<ReturnType<typeof getAccountData>>
    >(); // key = `${userId}:${accountId}`

    // Build a map: for each account, find which user's config to use.
    // Admin users can configure ANY account, but their allowedAccountIds may
    // not list it.  We resolve conflicts by preferring admin configs when enabled.
    const accountOwner = new Map<number, { user: typeof users[0]; data: Awaited<ReturnType<typeof getAccountData>>; books: Awaited<ReturnType<typeof getBooks>> }>();

    for (const user of users) {
      const settings = await getAppSettings(user.id);
      const allowedIds = settings.allowedAccountIds;
      // Admins can configure any account
      const isAdmin = user.role === "admin";
      const userAccounts = isAdmin
        ? allAccounts
        : allowedIds && allowedIds.length > 0
          ? allAccounts.filter((a) => allowedIds.includes(a.id))
          : [];

      debugLog.push(`User ${user.id} (${user.role}): ${userAccounts.length} accounts (allowedIds: ${JSON.stringify(allowedIds)})`);

      const rawBooks = await getBooks(user.id);
      // Merge covers from individual keys (covers are stored separately to avoid payload limits)
      const books = await Promise.all(
        rawBooks.map(async (b) => {
          if (b.coverImage) return b; // legacy inline cover
          const cover = await getBookCover(user.id, b.id);
          return cover ? { ...b, coverImage: cover } : b;
        })
      );
      debugLog.push(`User ${user.id}: ${books.length} books`);

      for (const acc of userAccounts) {
        try {
          const data = await getAccountData(user.id, acc.id);
          accountDataMap.set(`${user.id}:${acc.id}`, data);

          // Show admin's config for every account
          if (isAdmin) {
            debugLog.push(`ADMIN-CFG ${acc.username} (${acc.id}): enabled=${data.config.enabled} intervals=${JSON.stringify(data.config.intervals || 'none')} selections=${data.config.selections?.length ?? 0}`);
          }

          if (!data.config.enabled) {
            debugLog.push(`Account ${acc.username} (${acc.id}) [u:${user.id}]: disabled`);
            continue;
          }

          // Decide who "owns" this account for cron purposes.
          // Prefer the user who has it in their allowedIds (the intended owner).
          // Admin is fallback only if no regular user has configured it.
          const existing = accountOwner.get(acc.id);
          if (!existing) {
            accountOwner.set(acc.id, { user, data, books });
          } else if (!isAdmin && existing.user.role === "admin") {
            // Regular user with explicit allowedIds takes priority over admin fallback
            accountOwner.set(acc.id, { user, data, books });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            userId: user.id,
            accountId: acc.id,
            username: acc.username,
            status: `error: ${msg}`,
          });
        }
      }
    }

    // Now process each account exactly once using the resolved owner
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
              // Round-robin: use pointer to cycle through candidates
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
              // If the slideshow explicitly links prompts/captions, rotate only
              // through those. Otherwise (e.g. imported slideshows with empty
              // id arrays) fall back to the book's full pool so it still posts.
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
              // If book has a cover image, drop the last text slide (book tag)
              // since the cover replaces it
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
        results.push({
          userId: user.id,
          accountId: acc.id,
          username: acc.username,
          status: `error: ${msg}`,
        });
      }
    }

    // Sort by earliest window first so the most urgent posts are processed first.
    // If the run times out, unprocessed jobs get picked up on the next run (every 10 min).
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
      return NextResponse.json({ ok: true, dryRun: true, jobCount: jobs.length, debugLog });
    }

    // Mark all job keys as scheduled NOW — before heavy work starts.
    // This prevents duplicate scheduling when concurrent cron runs overlap.
    const allSchedKeys = jobs.map((j) => j.schedKey);
    if (allSchedKeys.length > 0) {
      await markScheduled(allSchedKeys);
    }

    // Phase 2: generate all images in parallel
    const images = await Promise.all(
      jobs.map(async (job) => {
        try {
          return await generateImage(job.imagePrompt);
        } catch {
          return null;
        }
      })
    );

    // Phase 3: render + upload + post strictly sequentially (sharp Pango)
    const postResults: Array<{ job: Job; status: string; scheduledAt?: string; postId?: string }> = [];

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const image = images[i];
      if (!image) {
        postResults.push({ job, status: "skipped: image generation failed" });
        continue;
      }
      try {
        const slideBufs: Buffer[] = [];
        for (const text of job.slideTexts) {
          const buf = await renderSlide(image, text);
          slideBufs.push(buf);
        }

        const mediaIds: string[] = [];
        for (let j = 0; j < slideBufs.length; j++) {
          const mediaId = await uploadPng(slideBufs[j], `slide-${j + 1}.png`);
          mediaIds.push(mediaId);
        }

        // Upload book cover as final slide if available
        if (job.coverImage) {
          const base64 = job.coverImage.replace(/^data:[^;]+;base64,/, "");
          const coverBuf = Buffer.from(base64, "base64");
          const coverMediaId = await uploadPng(coverBuf, `slide-${slideBufs.length + 1}-cover.png`);
          mediaIds.push(coverMediaId);
        }

        const scheduledAt = randomTimeInWindow(job.win.start, job.win.end);

        const postResp = await pbFetch("/v1/posts", {
          method: "POST",
          body: JSON.stringify({
            caption: job.captionText,
            media: mediaIds,
            social_accounts: [job.acc.id],
            scheduled_at: scheduledAt.toISOString(),
            platform_configurations: {
              tiktok: { draft: false, is_aigc: true },
            },
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
        postResults.push({ job, status: `error: ${msg}` });
      }
    }

    // Phase 4: aggregate results per (user, account) and save status + history
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
      const acc = jobs.find(
        (j) => j.userId === userId && j.acc.id === accId
      )?.acc;
      const status = statuses.join(" | ");
      results.push({
        userId,
        accountId: accId,
        username: acc?.username || "unknown",
        status,
      });
      try {
        const data = accountDataMap.get(k);
        if (data) {
          const newPointer = pointerUpdates.get(k);
          const newPromptPointer = promptPointerUpdates.get(k);
          const existingHistory = data.recentPosts || [];
          const newHistory = [...(keyNewPosts.get(k) || []), ...existingHistory].slice(0, 20);
          await setAccountData(userId, accId, {
            ...data,
            config: {
              ...data.config,
              ...(newPointer !== undefined ? { pointer: newPointer } : {}),
              ...(newPromptPointer !== undefined ? { promptPointer: newPromptPointer } : {}),
            },
            lastRun: new Date().toISOString(),
            lastStatus: status,
            recentPosts: newHistory,
          });
        }
      } catch {}
    }

    // Phase 5: Top N list automation — per-account round-robin (sequential — sharp Pango)
    const topNResults: Array<{
      userId: string;
      listName: string;
      status: string;
    }> = [];

    // Pre-collect TopN jobs across all users, mark schedule keys upfront
    interface TopNJob {
      user: typeof users[0];
      accIdStr: string;
      accConfig: Awaited<ReturnType<typeof getTopNAutomation>>["accounts"][string];
      selectedList: Awaited<ReturnType<typeof getTopNLists>>[0];
      activeWindows: { start: string; end: string }[];
      schedKeys: string[];
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
          let pool = topNLists.filter((l) => l.bookIds.length > 0);
          if (accConfig.listIds.length > 0) {
            pool = pool.filter((l) => accConfig.listIds.includes(l.id));
          }
          if (pool.length === 0) continue;

          const activeWindows = accConfig.intervals.filter((w) => {
            const sk = `topn:${user.id}:${accIdStr}:${w.start}`;
            return shouldProcessWindow(w.start, forceHour) && !scheduledToday.has(sk);
          });
          if (activeWindows.length === 0) continue;

          const listIndex = accConfig.pointer % pool.length;
          const selectedList = pool[listIndex];
          const schedKeys = activeWindows.map((w) => `topn:${user.id}:${accIdStr}:${w.start}`);

          topNJobs.push({ user, accIdStr, accConfig, selectedList, activeWindows, schedKeys });

          updatedTopNAccounts[accIdStr] = {
            ...accConfig,
            pointer: accConfig.pointer + 1,
            lastPostDate: today,
          };
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
          });
          topNResults.push({
            userId: topNJob.user.id,
            listName: topNJob.selectedList.name,
            status: `${topNJob.accIdStr}: scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          topNResults.push({
            userId: topNJob.user.id,
            listName: topNJob.selectedList.name,
            status: `error (${topNJob.accIdStr}): ${msg}`,
          });
        }
      }
    }

    // Save updated pointers
    for (const [userId, { updated }] of topNAutoByUser) {
      try {
        await setTopNAutomation(userId, { accounts: updated });
      } catch {}
    }

    // Phase 6: IG slideshow automation — per-account config (sequential — sharp Pango)
    const igAutoResults: Array<{ userId: string; status: string }> = [];

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
              const image = await generateImage(prompt.value);
              if (!image) {
                igAutoResults.push({ userId: user.id, status: `skip: image gen failed for ${ss.name} (${accIdStr})` });
                continue;
              }
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
                : { tiktok: { draft: false, is_aigc: true } };

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
              igAutoResults.push({
                userId: user.id,
                status: `${ss.name} → ${accIdStr} at ${scheduledAt.toISOString()} [post:${postId}]`,
              });
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

    cronResult = NextResponse.json({ ok: true, results, topNResults, igAutoResults, debugLog });

    } finally {
      await redis.del(CRON_LOCK_KEY).catch(() => {});
    }

    return cronResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
