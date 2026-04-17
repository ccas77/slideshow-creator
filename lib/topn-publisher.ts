import { TopBook, TopNList, getTopBooks, getTopNLists } from "@/lib/kv";
import { generateImage } from "@/lib/gemini";
import { renderTitleSlide, renderBookSlide } from "@/lib/render-topn-slide";
import { uploadPng, pbFetch } from "@/lib/post-bridge";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface PublishTopNOptions {
  userId: string;
  listId: string;
  accountIds: number[];
  scheduledAt?: string; // ISO string
}

export interface PublishTopNResult {
  postId: string;
  slides: number;
  books: string[];
}

/**
 * Generate a Top N slideshow and schedule/publish it via PostBridge.
 * Used by both the one-off publish endpoint and the cron automation.
 */
export async function publishTopN(
  opts: PublishTopNOptions
): Promise<PublishTopNResult> {
  const { userId, listId, accountIds, scheduledAt } = opts;

  const [lists, allBooks] = await Promise.all([
    getTopNLists(userId),
    getTopBooks(userId),
  ]);
  const list = lists.find((l) => l.id === listId);
  if (!list) throw new Error("List not found");

  const poolBooks = list.bookIds
    .map((id) => allBooks.find((b) => b.id === id))
    .filter((b): b is TopBook => !!b);

  // Pinned books are guaranteed to be *included* (never dropped when the pool
  // is larger than list.count), but their *position* is randomized alongside
  // everything else — always putting them first is too obvious on TikTok.
  const pinned = poolBooks.filter((b) => b.pinned);
  const unpinned = shuffle(poolBooks.filter((b) => !b.pinned));

  const selected: TopBook[] = [...pinned];
  for (const b of unpinned) {
    if (selected.length >= list.count) break;
    selected.push(b);
  }
  if (selected.length === 0) throw new Error("No books selected");

  const finalOrder = shuffle(selected);

  let bgImage: string | null = null;
  if (list.backgroundPrompts && list.backgroundPrompts.length > 0) {
    const prompt =
      list.backgroundPrompts[Math.floor(Math.random() * list.backgroundPrompts.length)];
    bgImage = await generateImage(prompt);
  }

  const titleTexts = list.titleTexts && list.titleTexts.length > 0 ? list.titleTexts : [""];
  const titleText = titleTexts[Math.floor(Math.random() * titleTexts.length)];

  const titleBuf = await renderTitleSlide(titleText, bgImage);

  // Sharp Pango text rendering is not parallel-safe; render sequentially.
  const slideBufs: Buffer[] = [titleBuf];
  for (const book of finalOrder) {
    const b64 = book.coverData.includes(",") ? book.coverData.split(",")[1] : book.coverData;
    const coverBuf = Buffer.from(b64, "base64");
    const buf = await renderBookSlide(coverBuf, book.title, book.author, bgImage);
    slideBufs.push(buf);
  }

  const mediaIds: string[] = [];
  for (let j = 0; j < slideBufs.length; j++) {
    const mediaId = await uploadPng(slideBufs[j], `topn-slide-${j}.png`);
    mediaIds.push(mediaId);
  }

  const captions = list.captions && list.captions.length > 0 ? list.captions : [""];
  const caption = captions[Math.floor(Math.random() * captions.length)];

  const postBody: Record<string, unknown> = {
    caption,
    media: mediaIds,
    social_accounts: accountIds,
    platform_configurations: { tiktok: { draft: false, is_aigc: true } },
  };
  if (scheduledAt) postBody.scheduled_at = scheduledAt;

  const postResp = await pbFetch("/v1/posts", {
    method: "POST",
    body: JSON.stringify(postBody),
  });

  return {
    postId: postResp.id || postResp.data?.id || "unknown",
    slides: slideBufs.length,
    books: finalOrder.map((b) => b.title),
  };
}

export type { TopNList };
