import { NextRequest, NextResponse } from "next/server";
import {
  getAccountData,
  setAccountData,
  getBooks,
  getAppSettings,
  getTopNLists,
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
            let imagePrompt = "";
            let slideTexts: string[] = [];
            let captionText = "";
            let source = "";

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
              captionText = pickedCaption?.value || "";
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
        for (const text of job.slideTexts) {
          const buf = await renderSlide(image, text);
          slideBufs.push(buf);
        }

        const mediaIds: string[] = [];
        for (let j = 0; j < slideBufs.length; j++) {
          const mediaId = await uploadPng(slideBufs[j], `slide-${j + 1}.png`);
          mediaIds.push(mediaId);
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

    // Phase 5: Top N list automation (sequential per user/list — sharp Pango)
    const topNResults: Array<{
      userId: string;
      listName: string;
      status: string;
    }> = [];

    for (const user of users) {
      try {
        const [lists, settings] = await Promise.all([
          getTopNLists(user.id),
          getAppSettings(user.id),
        ]);
        const allowedIds = settings.allowedAccountIds;

        for (const list of lists) {
          const auto = list.automation;
          if (!auto || !auto.enabled) continue;
          if (!auto.accountIds || auto.accountIds.length === 0) continue;
          if (!auto.intervals || auto.intervals.length === 0) continue;

          // Filter automation accounts by user's currently allowed accounts
          const targetAccountIds =
            allowedIds && allowedIds.length > 0
              ? auto.accountIds.filter((id) => allowedIds.includes(id))
              : auto.accountIds;
          if (targetAccountIds.length === 0) continue;

          for (const win of auto.intervals) {
            try {
              const scheduledAt = randomTimeInWindow(win.start, win.end);
              const r = await publishTopN({
                userId: user.id,
                listId: list.id,
                accountIds: targetAccountIds,
                scheduledAt: scheduledAt.toISOString(),
              });
              topNResults.push({
                userId: user.id,
                listName: list.name,
                status: `scheduled ${r.slides} slides for ${scheduledAt.toISOString()} [post:${r.postId}]`,
              });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              topNResults.push({
                userId: user.id,
                listName: list.name,
                status: `error: ${msg}`,
              });
            }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        topNResults.push({
          userId: user.id,
          listName: "(list fetch)",
          status: `error: ${msg}`,
        });
      }
    }

    return NextResponse.json({ ok: true, results, topNResults });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
