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
  if (endMin <= startMin) endMin = startMin + 60;
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
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
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
    const [allAccounts, users, scheduledToday] = await Promise.all([
      listTikTokAccounts(),
      listUsers(),
      getScheduledToday(),
    ]);
    const newlyScheduled: string[] = []; // entries to mark after successful scheduling

    const nowUtc = new Date();
    debugLog.push(`Running at ${nowUtc.toISOString()}, ${users.length} users, ${allAccounts.length} PB accounts`);

    // Phase 1: build jobs across all users, respecting each user's allowedAccountIds
    const jobs: Job[] = [];
    const pointerUpdates = new Map<string, number>(); // key = userId:accountId, value = new pointer
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
          accountDataMap.set(`${user.id}:${acc.id}`, data);
          if (!data.config.enabled) {
            debugLog.push(`Account ${acc.username} (${acc.id}): disabled`);
            continue;
          }

          let windows: Array<{ start: string; end: string }> = [];
          if (data.config.intervals && data.config.intervals.length > 0) {
            windows = data.config.intervals;
          } else {
            windows.push({
              start: data.config.windowStart,
              end: data.config.windowEnd,
            });
            if (data.config.windowStart2 && data.config.windowEnd2) {
              windows.push({
                start: data.config.windowStart2,
                end: data.config.windowEnd2,
              });
            }
          }

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

            const { bookId, slideshowIds, selections } = data.config;
            const candidates: Array<{
              book: (typeof books)[0];
              slideshow: (typeof books)[0]["slideshows"][0];
            }> = [];

            debugLog.push(`  Config: selections=${JSON.stringify(selections?.length ?? 'none')}, bookId=${bookId ?? 'none'}, slideshowIds=${JSON.stringify(slideshowIds?.length ?? 'none')}`);

            if (selections && selections.length > 0) {
              for (const sel of selections) {
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
            } else if (bookId && slideshowIds && slideshowIds.length > 0) {
              const book = books.find((b) => b.id === bookId);
              if (book) {
                for (const sid of slideshowIds) {
                  const slideshow = book.slideshows.find((s) => s.id === sid);
                  if (slideshow) candidates.push({ book, slideshow });
                  else debugLog.push(`  Slideshow miss: id=${sid} not in book ${book.name}`);
                }
              } else {
                debugLog.push(`  Book miss: id=${bookId} not found`);
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
              const pickedPrompt = pickRandom(allowedPrompts);
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

    // Cap jobs per run to avoid timeout (5 min limit). Unprocessed jobs will
    // be picked up on the next hourly cron run since they won't be in scheduledToday.
    const MAX_JOBS_PER_RUN = 6;
    if (jobs.length > MAX_JOBS_PER_RUN) {
      debugLog.push(`Capping ${jobs.length} jobs to ${MAX_JOBS_PER_RUN} (remaining will be processed next cron run)`);
      jobs.length = MAX_JOBS_PER_RUN;
    }

    debugLog.push(`Jobs built: ${jobs.length}${dryRun ? ' (DRY RUN — stopping here)' : ''}`);
    for (const j of jobs) {
      debugLog.push(`  Job: ${j.acc.username} (${j.acc.id}), win=${j.win.start}-${j.win.end}, src=${j.source}, slides=${j.slideTexts.length}, prompt="${j.imagePrompt.slice(0,50)}..."`);
    }

    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, jobCount: jobs.length, debugLog });
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
    const postResults: Array<{ job: Job; status: string }> = [];

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
        });
        newlyScheduled.push(job.schedKey);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        postResults.push({ job, status: `error: ${msg}` });
      }
    }

    // Phase 4: aggregate results per (user, account) and save status
    const keyStatuses = new Map<string, string[]>();
    for (const r of postResults) {
      const k = `${r.job.userId}:${r.job.acc.id}`;
      if (!keyStatuses.has(k)) keyStatuses.set(k, []);
      keyStatuses.get(k)!.push(r.status);
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
          await setAccountData(userId, accId, {
            ...data,
            config: {
              ...data.config,
              ...(newPointer !== undefined ? { pointer: newPointer } : {}),
            },
            lastRun: new Date().toISOString(),
            lastStatus: status,
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

    for (const user of users) {
      try {
        const [topNLists, topNAuto] = await Promise.all([
          getTopNLists(user.id),
          getTopNAutomation(user.id),
        ]);
        const today = new Date().toISOString().slice(0, 10);
        let topNUpdated = false;
        const updatedTopNAccounts = { ...topNAuto.accounts };

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

          // Check if any window is eligible (future today + not yet scheduled)
          const activeWindows = accConfig.intervals.filter((w) => {
            const sk = `topn:${user.id}:${accIdStr}:${w.start}`;
            return shouldProcessWindow(w.start, forceHour) && !scheduledToday.has(sk);
          });
          if (activeWindows.length === 0) continue;

          // Round-robin: pick one list
          const listIndex = accConfig.pointer % pool.length;
          const selectedList = pool[listIndex];

          for (const win of activeWindows) {
            const topnSchedKey = `topn:${user.id}:${accIdStr}:${win.start}`;
            try {
              const scheduledAt = randomTimeInWindow(win.start, win.end);
              const r = await publishTopN({
                userId: user.id,
                listId: selectedList.id,
                accountIds: [Number(accIdStr)],
                scheduledAt: scheduledAt.toISOString(),
                platform: accConfig.platform,
              });
              topNResults.push({
                userId: user.id,
                listName: selectedList.name,
                status: `${accIdStr}: scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
              });
              newlyScheduled.push(topnSchedKey);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              topNResults.push({
                userId: user.id,
                listName: selectedList.name,
                status: `error (${accIdStr}): ${msg}`,
              });
            }
          }

          updatedTopNAccounts[accIdStr] = {
            ...accConfig,
            pointer: accConfig.pointer + 1,
            lastPostDate: today,
          };
          topNUpdated = true;
        }

        if (topNUpdated) {
          await setTopNAutomation(user.id, { accounts: updatedTopNAccounts });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        topNResults.push({
          userId: user.id,
          listName: "(topn-auto)",
          status: `error: ${msg}`,
        });
      }
    }

    // Phase 6: IG slideshow automation — per-account config (sequential — sharp Pango)
    const igAutoResults: Array<{ userId: string; status: string }> = [];
    for (const user of users) {
      try {
        const igAuto = await getIgAutomation(user.id);
        if (!igAuto.accounts || Object.keys(igAuto.accounts).length === 0) continue;

        const igSlideshows = await getIgSlideshows(user.id);
        if (igSlideshows.length === 0) continue;

        const settings = await getAppSettings(user.id);
        const allowedIds = settings.allowedAccountIds;
        let updated = false;
        const updatedAccounts = { ...igAuto.accounts };

        for (const [accIdStr, accConfig] of Object.entries(igAuto.accounts)) {
          if (!accConfig.enabled || accConfig.intervals.length === 0) continue;
          const accId = Number(accIdStr);
          if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(accId)) continue;

          // Build pool: filter by books, then by specific slideshows
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

              // Determine platform config based on legacy lists
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
              newlyScheduled.push(igSchedKey);
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

    // Mark all successfully scheduled entries so future cron runs today skip them
    await markScheduled(newlyScheduled);

    return NextResponse.json({ ok: true, results, topNResults, igAutoResults, debugLog });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
