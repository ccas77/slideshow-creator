import { NextRequest, NextResponse } from "next/server";
import {
  getAccountData,
  setAccountData,
  getBooks,
  getAppSettings,
  getTopNLists,
  getTopNAutomation,
  setTopNAutomation,
  getIgAutomation,
  getIgSlideshows,
  setIgAutomation,
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

// Returns true if now is within 1 hour before the window start (UTC).
// This prevents duplicate scheduling when cron runs more than once per day.
function shouldProcessWindow(windowStart: string): boolean {
  const [sh, sm] = windowStart.split(":").map(Number);
  const now = new Date();
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const startMin = sh * 60 + sm;
  // Check if we're in the 60 minutes before the window starts
  const diff = startMin - nowMin;
  // Handle midnight wrap: if diff is very negative, add 24h
  const adjusted = diff < -60 ? diff + 1440 : diff;
  return adjusted >= 0 && adjusted < 60;
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
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    auth !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results: Array<{
    userId: string;
    accountId: number;
    username: string;
    status: string;
  }> = [];

  try {
    const [allAccounts, users] = await Promise.all([
      listTikTokAccounts(),
      listUsers(),
    ]);

    // Phase 1: build jobs across all users, respecting each user's allowedAccountIds
    const jobs: Job[] = [];
    const accountDataMap = new Map<
      string,
      Awaited<ReturnType<typeof getAccountData>>
    >(); // key = `${userId}:${accountId}`

    for (const user of users) {
      const settings = await getAppSettings(user.id);
      const allowedIds = settings.allowedAccountIds;
      const userAccounts =
        allowedIds && allowedIds.length > 0
          ? allAccounts.filter((a) => allowedIds.includes(a.id))
          : allAccounts; // no filter = all accounts (unlikely for multi-user)

      const books = await getBooks(user.id);

      for (const acc of userAccounts) {
        try {
          const data = await getAccountData(user.id, acc.id);
          accountDataMap.set(`${user.id}:${acc.id}`, data);
          if (!data.config.enabled) continue;

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

          for (const win of windows) {
            if (!shouldProcessWindow(win.start)) continue;
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

            if (selections && selections.length > 0) {
              for (const sel of selections) {
                const book = books.find((b) => b.id === sel.bookId);
                const slideshow = book?.slideshows.find(
                  (s) => s.id === sel.slideshowId
                );
                if (book && slideshow) candidates.push({ book, slideshow });
              }
            } else if (bookId && slideshowIds && slideshowIds.length > 0) {
              const book = books.find((b) => b.id === bookId);
              if (book) {
                for (const sid of slideshowIds) {
                  const slideshow = book.slideshows.find((s) => s.id === sid);
                  if (slideshow) candidates.push({ book, slideshow });
                }
              }
            }

            if (candidates.length > 0) {
              const picked = pickRandom(candidates);
              if (!picked || !picked.slideshow.slideTexts.trim()) continue;
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
              if (!pickedPrompt) continue;
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
            } else {
              const prompt = pickRandom(data.prompts);
              const textSet = pickRandom(data.texts);
              const captionItem = pickRandom(data.captions);
              if (!prompt || !textSet) continue;
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
        const textStyle = Math.floor(Math.random() * 3);
        for (const text of job.slideTexts) {
          const buf = await renderSlide(image, text, textStyle);
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
          await setAccountData(userId, accId, {
            ...data,
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

          // Check if any window is active this hour
          const activeWindows = accConfig.intervals.filter((w) => shouldProcessWindow(w.start));
          if (activeWindows.length === 0) continue;

          // Round-robin: pick one list
          const listIndex = accConfig.pointer % pool.length;
          const selectedList = pool[listIndex];

          for (const win of activeWindows) {
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
            if (!shouldProcessWindow(win.start)) continue;
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
              const textStyle = Math.floor(Math.random() * 3);
              for (const text of texts) {
                slideBufs.push(await renderSlide(image, text, textStyle));
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

    return NextResponse.json({ ok: true, results, topNResults, igAutoResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
