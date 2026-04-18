import { Redis } from "@upstash/redis";

// Auto-detects KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN
export const redis = Redis.fromEnv();

export interface SavedItem {
  name: string;
  value: string;
}

export interface TimeWindow {
  start: string; // UTC "HH:MM"
  end: string;   // UTC "HH:MM"
}

export interface AutomationConfig {
  enabled: boolean;
  // Legacy fields (kept for migration)
  windowStart: string;
  windowEnd: string;
  windowStart2?: string;
  windowEnd2?: string;
  postsPerDay?: number;
  // New: array of posting intervals
  intervals?: TimeWindow[];
  bookId?: string;
  slideshowIds?: string[];
  selections?: Array<{ bookId: string; slideshowId: string }>;
}

export interface NamedItem {
  id: string;
  name: string;
  value: string;
}

export interface Slideshow {
  id: string;
  name: string;
  slideTexts: string; // newline-separated
  imagePromptIds: string[];
  captionIds: string[];
}

export interface Book {
  id: string;
  name: string;
  imagePrompts: NamedItem[];
  captions: NamedItem[];
  slideshows: Slideshow[];
}

// Migrate legacy book shape (slideshows had imagePrompt/caption inline)
// to the new pooled shape.
export function migrateBook(raw: unknown): Book {
  const b = raw as {
    id: string;
    name: string;
    imagePrompts?: NamedItem[];
    captions?: NamedItem[];
    slideshows?: Array<{
      id: string;
      name: string;
      slideTexts: string;
      imagePrompt?: string;
      caption?: string;
      imagePromptIds?: string[];
      captionIds?: string[];
    }>;
  };
  if (b.imagePrompts && b.captions) {
    return {
      id: b.id,
      name: b.name,
      imagePrompts: b.imagePrompts,
      captions: b.captions,
      slideshows: (b.slideshows || []).map((s) => ({
        id: s.id,
        name: s.name,
        slideTexts: s.slideTexts || "",
        imagePromptIds: s.imagePromptIds || [],
        captionIds: s.captionIds || [],
      })),
    };
  }
  const imagePrompts: NamedItem[] = [];
  const captions: NamedItem[] = [];
  const slideshows: Slideshow[] = [];
  const uid = () =>
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  for (const s of b.slideshows || []) {
    const ipIds: string[] = [];
    const capIds: string[] = [];
    if (s.imagePrompt && s.imagePrompt.trim()) {
      const existing = imagePrompts.find((p) => p.value === s.imagePrompt);
      if (existing) ipIds.push(existing.id);
      else {
        const item: NamedItem = {
          id: uid(),
          name: s.name + " prompt",
          value: s.imagePrompt,
        };
        imagePrompts.push(item);
        ipIds.push(item.id);
      }
    }
    if (s.caption && s.caption.trim()) {
      const existing = captions.find((p) => p.value === s.caption);
      if (existing) capIds.push(existing.id);
      else {
        const item: NamedItem = {
          id: uid(),
          name: s.name + " caption",
          value: s.caption,
        };
        captions.push(item);
        capIds.push(item.id);
      }
    }
    slideshows.push({
      id: s.id,
      name: s.name,
      slideTexts: s.slideTexts || "",
      imagePromptIds: ipIds,
      captionIds: capIds,
    });
  }
  return { id: b.id, name: b.name, imagePrompts, captions, slideshows };
}

export interface AccountData {
  config: AutomationConfig;
  prompts: SavedItem[];
  texts: SavedItem[];
  captions: SavedItem[];
  lastRun?: string;
  lastStatus?: string;
}

const defaultData = (): AccountData => ({
  config: { enabled: false, windowStart: "18:00", windowEnd: "20:00" },
  prompts: [],
  texts: [],
  captions: [],
});

// ── Per-user namespacing ──
// All keys are scoped to a userId so each user's data is isolated.

const accountKey = (userId: string, accountId: number) =>
  `u:${userId}:account:${accountId}`;

export async function getAccountData(
  userId: string,
  accountId: number
): Promise<AccountData> {
  const data = await redis.get<AccountData>(accountKey(userId, accountId));
  return data ?? defaultData();
}

export async function setAccountData(
  userId: string,
  accountId: number,
  data: AccountData
): Promise<void> {
  await redis.set(accountKey(userId, accountId), data);
}

const booksKey = (userId: string) => `u:${userId}:books`;

export async function getBooks(userId: string): Promise<Book[]> {
  const data = await redis.get<unknown[]>(booksKey(userId));
  if (!data) return [];
  return data.map((b) => migrateBook(b));
}

export async function setBooks(userId: string, books: Book[]): Promise<void> {
  await redis.set(booksKey(userId), books);
}

// ── Top Books (per-user) ──

export interface TopBook {
  id: string;
  title: string;
  author: string;
  genre: string;
  coverData: string; // base64 data URL
  pinned: boolean;
}

export interface TopNAutomation {
  enabled: boolean;
  accountIds: number[];
  intervals: TimeWindow[]; // one post scheduled per interval per day
}

export interface TopNList {
  id: string;
  name: string;
  titleTexts: string[];
  count: number;
  bookIds: string[];
  captions: string[];
  backgroundPrompts?: string[];
  automation?: TopNAutomation;
}

const topBooksIndexKey = (userId: string) => `u:${userId}:top-books-index`;
const topNListsKey = (userId: string) => `u:${userId}:top-n-lists`;
const topBookKey = (userId: string, id: string) =>
  `u:${userId}:top-book:${id}`;

export async function getTopBooks(userId: string): Promise<TopBook[]> {
  const ids = await redis.get<string[]>(topBooksIndexKey(userId));
  if (!ids || ids.length === 0) return [];
  const books: TopBook[] = [];
  for (const id of ids) {
    const book = await redis.get<TopBook>(topBookKey(userId, id));
    if (book) books.push(book);
  }
  return books;
}

export async function getTopBook(
  userId: string,
  id: string
): Promise<TopBook | null> {
  return await redis.get<TopBook>(topBookKey(userId, id));
}

export async function setTopBook(
  userId: string,
  book: TopBook
): Promise<void> {
  await redis.set(topBookKey(userId, book.id), book);
  const ids = (await redis.get<string[]>(topBooksIndexKey(userId))) || [];
  if (!ids.includes(book.id)) {
    ids.push(book.id);
    await redis.set(topBooksIndexKey(userId), ids);
  }
}

export async function deleteTopBook(
  userId: string,
  id: string
): Promise<void> {
  await redis.del(topBookKey(userId, id));
  const ids = (await redis.get<string[]>(topBooksIndexKey(userId))) || [];
  await redis.set(
    topBooksIndexKey(userId),
    ids.filter((i) => i !== id)
  );
}

export async function setTopBooks(
  userId: string,
  books: TopBook[]
): Promise<void> {
  for (const book of books) {
    await redis.set(topBookKey(userId, book.id), book);
  }
  await redis.set(
    topBooksIndexKey(userId),
    books.map((b) => b.id)
  );
}

export async function getTopNLists(userId: string): Promise<TopNList[]> {
  const data = await redis.get<TopNList[]>(topNListsKey(userId));
  return data ?? [];
}

export async function setTopNLists(
  userId: string,
  lists: TopNList[]
): Promise<void> {
  await redis.set(topNListsKey(userId), lists);
}

// ── Instagram Slideshows (per-user) ──

export interface InstagramAutomation {
  enabled: boolean;
  igAccountIds: number[];       // Instagram accounts to post carousel to
  tiktokAccountIds: number[];   // TikTok accounts to post video to
  intervals: TimeWindow[];
}

export interface InstagramSlideshow {
  id: string;
  name: string;
  sourceBookId?: string;        // which book it was imported from
  sourceSlideshowId?: string;   // which TikTok slideshow it was chopped from
  slideTexts: string;           // newline-separated (max 10)
  imagePromptIds: string[];
  captionIds: string[];
  imagePrompts: NamedItem[];    // local copy of prompts
  captions: NamedItem[];        // local copy of captions
  automation?: InstagramAutomation;
}

const igSlideshowsKey = (userId: string) => `u:${userId}:ig-slideshows`;

export async function getIgSlideshows(userId: string): Promise<InstagramSlideshow[]> {
  const data = await redis.get<InstagramSlideshow[]>(igSlideshowsKey(userId));
  return data ?? [];
}

export async function setIgSlideshows(
  userId: string,
  slideshows: InstagramSlideshow[]
): Promise<void> {
  await redis.set(igSlideshowsKey(userId), slideshows);
}

// ── Settings (per-user) ──

const settingsKey = (userId: string) => `u:${userId}:app-settings`;

export interface AppSettings {
  allowedAccountIds?: number[]; // empty or missing = show all
}

export async function getAppSettings(userId: string): Promise<AppSettings> {
  const data = await redis.get<AppSettings>(settingsKey(userId));
  return data ?? {};
}

export async function setAppSettings(
  userId: string,
  settings: AppSettings
): Promise<void> {
  await redis.set(settingsKey(userId), settings);
}

export async function listAutomatedAccounts(
  userId: string,
  accountIds: number[]
): Promise<{ id: number; data: AccountData }[]> {
  const result: { id: number; data: AccountData }[] = [];
  for (const id of accountIds) {
    const data = await getAccountData(userId, id);
    if (data.config.enabled) result.push({ id, data });
  }
  return result;
}
