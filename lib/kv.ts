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

// Legacy config shape — used only by migration and diagnostic routes
export interface LegacyAutomationConfig {
  enabled?: boolean;
  windowStart?: string;
  windowEnd?: string;
  windowStart2?: string;
  windowEnd2?: string;
  postsPerDay?: number;
  intervals?: TimeWindow[];
  bookId?: string;
  slideshowIds?: string[];
  selections?: Array<{ bookId: string; slideshowId: string }>;
  pointer?: number;
}

// Canonical config shape — all consumers receive this
export interface AutomationConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  selections: Array<{ bookId: string; slideshowId: string }>;
  pointer: number;
}

// Normalize any stored config to canonical shape.
// - Prefers intervals over legacy windowStart/windowEnd
// - Prefers selections over legacy bookId/slideshowIds
// - Strips all legacy fields from output
//
// Example inputs → outputs:
//   { enabled: true, windowStart: "18:00", windowEnd: "20:00", bookId: "b1", slideshowIds: ["s1"] }
//     → { enabled: true, intervals: [{ start: "18:00", end: "20:00" }], selections: [{ bookId: "b1", slideshowId: "s1" }], pointer: 0 }
//
//   { enabled: true, intervals: [{ start: "11:00", end: "13:00" }], windowStart: "18:00", windowEnd: "20:00", selections: [{ bookId: "b1", slideshowId: "s1" }] }
//     → { enabled: true, intervals: [{ start: "11:00", end: "13:00" }], selections: [{ bookId: "b1", slideshowId: "s1" }], pointer: 0 }
//
//   { enabled: false }
//     → { enabled: false, intervals: [{ start: "17:00", end: "19:00" }], selections: [], pointer: 0 }
export function migrateAutomationConfig(raw: unknown): AutomationConfig {
  const r = (raw || {}) as LegacyAutomationConfig;

  // Intervals: prefer new field, fall back to building from legacy windows
  let intervals: TimeWindow[];
  if (r.intervals && r.intervals.length > 0) {
    intervals = r.intervals;
  } else if (r.windowStart && r.windowEnd) {
    intervals = [{ start: r.windowStart, end: r.windowEnd }];
    if (r.windowStart2 && r.windowEnd2) {
      intervals.push({ start: r.windowStart2, end: r.windowEnd2 });
    }
  } else {
    intervals = [{ start: "17:00", end: "19:00" }];
  }

  // Selections: prefer new field, fall back to building from legacy bookId/slideshowIds
  let selections: Array<{ bookId: string; slideshowId: string }>;
  if (r.selections && r.selections.length > 0) {
    selections = r.selections;
  } else if (r.bookId && r.slideshowIds && r.slideshowIds.length > 0) {
    selections = r.slideshowIds.map((sid) => ({ bookId: r.bookId!, slideshowId: sid }));
  } else {
    selections = [];
  }

  return {
    enabled: !!r.enabled,
    intervals,
    selections,
    pointer: r.pointer ?? 0,
  };
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
  coverImage?: string; // base64 data URL for book cover
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
    coverImage?: string;
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
      coverImage: b.coverImage,
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
  return { id: b.id, name: b.name, coverImage: b.coverImage, imagePrompts, captions, slideshows };
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
  config: { enabled: false, intervals: [{ start: "17:00", end: "19:00" }], selections: [], pointer: 0 },
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
  if (!data) return defaultData();
  return { ...data, config: migrateAutomationConfig(data.config) };
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

// ── Book Covers (stored individually to avoid payload size limits) ──

const bookCoverKey = (userId: string, bookId: string) =>
  `u:${userId}:book-cover:${bookId}`;

export async function getBookCover(
  userId: string,
  bookId: string
): Promise<string | null> {
  return await redis.get<string>(bookCoverKey(userId, bookId));
}

export async function setBookCover(
  userId: string,
  bookId: string,
  coverImage: string
): Promise<void> {
  await redis.set(bookCoverKey(userId, bookId), coverImage);
}

export async function deleteBookCover(
  userId: string,
  bookId: string
): Promise<void> {
  await redis.del(bookCoverKey(userId, bookId));
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
  accountIds: number[]; // TikTok carousel accounts
  videoAccountIds?: number[]; // TikTok video accounts
  fbAccountIds?: number[]; // Facebook video accounts
  igCarouselAccountIds?: number[]; // Instagram carousel accounts
  igVideoAccountIds?: number[]; // Instagram video accounts
  intervals: TimeWindow[]; // one post scheduled per interval per day
}

export interface TopNList {
  id: string;
  name: string;
  titleTexts: string[];
  count: number;
  bookIds: string[];
  genres?: string[]; // Auto-select books matching these genres (merged with bookIds)
  captions: string[];
  backgroundPrompts?: string[];
  musicTrackIds?: string[]; // Pool of music tracks for video posts (random pick)
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

// ── Top N Per-Account Automation (per-user) ──

export interface TopNAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  listIds: string[];       // which lists to rotate through (empty = all)
  pointer: number;         // round-robin index
  frequencyDays: number;   // post every N days (1 = daily)
  lastPostDate?: string;   // YYYY-MM-DD of last successful post
  platform: "tiktok-carousel" | "tiktok-video" | "fb-video" | "ig-carousel" | "ig-video";
}

export interface TopNGlobalAutomation {
  accounts: Record<string, TopNAccountConfig>;
}

const topnAutomationKey = (userId: string) => `u:${userId}:topn-automation`;

export async function getTopNAutomation(userId: string): Promise<TopNGlobalAutomation> {
  const data = await redis.get<TopNGlobalAutomation>(topnAutomationKey(userId));
  return data ?? { accounts: {} };
}

export async function setTopNAutomation(userId: string, config: TopNGlobalAutomation): Promise<void> {
  await redis.set(topnAutomationKey(userId), config);
}

// ── Instagram Slideshows (per-user) ──

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
}

export interface IgAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];        // which books to pull from (empty = all)
  slideshowIds: string[];   // specific slideshows (empty = all from selected books)
  pointer: number;          // round-robin index for this account
}

export interface IgGlobalAutomation {
  enabled: boolean;
  accounts: Record<string, IgAccountConfig>; // accountId → config
  // Legacy fields (kept for backwards compat)
  igAccountIds?: number[];
  tiktokAccountIds?: number[];
  intervals?: TimeWindow[];
  igPointer?: number;
  accountBookIds?: Record<string, string[]>;
}

const igSlideshowsKey = (userId: string) => `u:${userId}:ig-slideshows`;
const igAutomationKey = (userId: string) => `u:${userId}:ig-automation`;

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

export async function getIgAutomation(userId: string): Promise<IgGlobalAutomation> {
  const data = await redis.get<IgGlobalAutomation>(igAutomationKey(userId));
  return data ?? { enabled: false, accounts: {} };
}

export async function setIgAutomation(userId: string, config: IgGlobalAutomation): Promise<void> {
  await redis.set(igAutomationKey(userId), config);
}

// ── Music Tracks (per-user) ──

export interface MusicTrack {
  id: string;
  name: string;
  audioData: string; // base64 data URL (audio/mpeg or audio/mp4)
}

const musicIndexKey = (userId: string) => `u:${userId}:music-tracks-index`;
const musicTrackKey = (userId: string, id: string) =>
  `u:${userId}:music-track:${id}`;

export async function getMusicTracks(userId: string): Promise<MusicTrack[]> {
  const ids = await redis.get<string[]>(musicIndexKey(userId));
  if (!ids || ids.length === 0) return [];
  const tracks: MusicTrack[] = [];
  for (const id of ids) {
    const track = await redis.get<MusicTrack>(musicTrackKey(userId, id));
    if (track) tracks.push(track);
  }
  return tracks;
}

export async function getMusicTrack(userId: string, id: string): Promise<MusicTrack | null> {
  return await redis.get<MusicTrack>(musicTrackKey(userId, id));
}

export async function setMusicTrack(userId: string, track: MusicTrack): Promise<void> {
  await redis.set(musicTrackKey(userId, track.id), track);
  const ids = (await redis.get<string[]>(musicIndexKey(userId))) || [];
  if (!ids.includes(track.id)) {
    ids.push(track.id);
    await redis.set(musicIndexKey(userId), ids);
  }
}

export async function deleteMusicTrack(userId: string, id: string): Promise<void> {
  await redis.del(musicTrackKey(userId, id));
  const ids = (await redis.get<string[]>(musicIndexKey(userId))) || [];
  await redis.set(musicIndexKey(userId), ids.filter((i) => i !== id));
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
