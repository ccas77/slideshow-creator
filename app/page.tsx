"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TikTokAccount {
  id: number;
  username: string;
}

interface GeneratedSlideshow {
  image: string | null;
  texts: string[];
}

interface SavedItem {
  name: string;
  value: string;
}

interface TimeWindow {
  start: string;
  end: string;
}

interface AutomationConfig {
  enabled: boolean;
  windowStart: string; // UTC HH:MM (legacy)
  windowEnd: string; // UTC HH:MM (legacy)
  windowStart2?: string;
  windowEnd2?: string;
  postsPerDay?: number;
  intervals?: TimeWindow[];
  bookId?: string;
  slideshowIds?: string[];
  selections?: Array<{ bookId: string; slideshowId: string }>;
  pointer?: number;
  promptPointer?: number;
}

interface NamedItem {
  id: string;
  name: string;
  value: string;
}

interface Slideshow {
  id: string;
  name: string;
  slideTexts: string;
  imagePromptIds: string[];
  captionIds: string[];
}

interface Book {
  id: string;
  name: string;
  coverImage?: string;
  imagePrompts: NamedItem[];
  captions: NamedItem[];
  slideshows: Slideshow[];
}

interface ScheduledPost {
  slideshowName: string;
  bookName: string;
  promptSnippet: string;
  scheduledAt: string;
  postId: string;
  timestamp: string;
}

interface AccountData {
  config: AutomationConfig;
  prompts: SavedItem[];
  texts: SavedItem[];
  captions: SavedItem[];
  lastRun?: string;
  lastStatus?: string;
  recentPosts?: ScheduledPost[];
}

const LS = {
  accountId: "sg.accountId",
  // legacy localStorage keys for migration
  savedPrompts: (id: number) => `sg.savedPrompts.${id}`,
  savedTexts: (id: number) => `sg.savedTexts.${id}`,
  savedCaptions: (id: number) => `sg.savedCaptions.${id}`,
  draft: (id: number) => `sg.draft.${id}`,
  migrated: (id: number) => `sg.migrated.${id}`,
};

const DEFAULT_CONFIG: AutomationConfig = {
  enabled: false,
  windowStart: "17:00",
  windowEnd: "19:00",
};

// Convert UTC "HH:MM" to local "HH:MM" for display
function utcToLocal(utc: string): string {
  const [h, m] = utc.split(":").map(Number);
  const d = new Date();
  d.setUTCHours(h, m, 0, 0);
  return `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

// Convert local "HH:MM" to UTC "HH:MM"
function localToUtc(local: string): string {
  const [h, m] = local.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes()
  ).padStart(2, "0")}`;
}

// TikTok resolution: 1080x1920 (9:16)
const SLIDE_W = 1080;
const SLIDE_H = 1920;

function renderSlideToCanvas(
  imageSrc: string | null,
  text: string,
  textStyle?: number
): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    canvas.width = SLIDE_W;
    canvas.height = SLIDE_H;
    const ctx = canvas.getContext("2d")!;

    function drawTextAndResolve() {
      const grad = ctx.createLinearGradient(0, SLIDE_H, 0, 0);
      grad.addColorStop(0, "rgba(0,0,0,0.85)");
      grad.addColorStop(0.5, "rgba(0,0,0,0.2)");
      grad.addColorStop(1, "rgba(0,0,0,0.4)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const fontSize = 72;
      ctx.font = `bold ${fontSize}px system-ui, -apple-system, sans-serif`;
      const maxWidth = SLIDE_W - 160;
      const words = text.split(" ");
      const lines: string[] = [];
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(testLine).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      const lineHeight = fontSize * 1.35;
      const totalHeight = lines.length * lineHeight;
      const startY = (SLIDE_H - totalHeight) / 2 + lineHeight / 2;

      // Pick text style (use provided or random)
      const resolvedStyle = textStyle ?? Math.floor(Math.random() * 3);
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;

      if (resolvedStyle === 0) {
        // Style 1: White text with black outline
        ctx.strokeStyle = "black";
        ctx.lineWidth = Math.round(fontSize * 0.18);
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 12;
        for (let i = 0; i < lines.length; i++) {
          ctx.strokeText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        ctx.shadowBlur = 0;
        ctx.fillStyle = "white";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
      } else if (resolvedStyle === 1) {
        // Style 2: White text with 50% opacity background shadow
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 20;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        ctx.fillStyle = "white";
        // Double-draw for stronger shadow
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      } else {
        // Style 3: Black text with solid white shadow
        ctx.shadowColor = "white";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.fillStyle = "black";
        for (let i = 0; i < lines.length; i++) {
          ctx.fillText(lines[i], SLIDE_W / 2, startY + i * lineHeight);
        }
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      }

      resolve(canvas);
    }

    if (imageSrc) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const scale = Math.max(SLIDE_W / img.width, SLIDE_H / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SLIDE_W - w) / 2, (SLIDE_H - h) / 2, w, h);
        drawTextAndResolve();
      };
      img.onerror = () => {
        ctx.fillStyle = "#18181b";
        ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
        drawTextAndResolve();
      };
      img.src = imageSrc;
    } else {
      ctx.fillStyle = "#18181b";
      ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
      drawTextAndResolve();
    }
  });
}

type Tab = "automation" | "post-now";

export default function Home() {
  const [hydrated, setHydrated] = useState(false);

  // Accounts
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);

  // Step 2 form
  const [imagePrompt, setImagePrompt] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [caption, setCaption] = useState("");

  // Saved per account
  const [savedPrompts, setSavedPrompts] = useState<SavedItem[]>([]);
  const [savedTexts, setSavedTexts] = useState<SavedItem[]>([]);
  const [savedCaptions, setSavedCaptions] = useState<SavedItem[]>([]);
  const [config, setConfig] = useState<AutomationConfig>(DEFAULT_CONFIG);
  const [lastRun, setLastRun] = useState<string | undefined>();
  const [lastStatus, setLastStatus] = useState<string | undefined>();
  const [recentPosts, setRecentPosts] = useState<ScheduledPost[]>([]);
  const [loadingAccount, setLoadingAccount] = useState(false);
  // Books (global)
  const [books, setBooks] = useState<Book[]>([]);
  const [expandedBooks, setExpandedBooks] = useState<string[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  const fetchBooks = useCallback(async () => {
    try {
      const res = await fetch(`/api/books`);
      if (res.ok) {
        const data = await res.json();
        setBooks(data.books || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  async function saveBooks(next: Book[]) {
    setBooks(next);
    try {
      // Strip coverImage from payload to avoid 413 errors.
      const lightweight = next.map(({ coverImage: _coverImage, ...rest }) => rest);
      await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ books: lightweight }),
      });
    } catch {}
  }

  function loadSlideshowIntoEditor(s: Slideshow, book?: Book) {
    // Prefer a prompt/caption the slideshow is explicitly linked to; otherwise
    // fall back to the book's first one so legacy imported slideshows
    // (which were saved with empty id arrays) still populate the editor.
    const firstPrompt =
      book?.imagePrompts.find((p) => s.imagePromptIds.includes(p.id)) ||
      book?.imagePrompts[0];
    const firstCaption =
      book?.captions.find((c) => s.captionIds.includes(c.id)) ||
      book?.captions[0];
    setImagePrompt(firstPrompt?.value || "");
    setBulkText(s.slideTexts);
    setCaption(firstCaption?.value || "");
    setSelectedBookId(book?.id || null);
  }

  async function saveDraftToBook() {
    if (!imagePrompt.trim() || !bulkText.trim()) {
      window.alert("Need at least an image prompt and slide texts.");
      return;
    }
    const uid = () =>
      Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    // Re-fetch latest books from KV to avoid overwriting changes made on other pages
    const freshRes = await fetch("/api/books");
    let workingBooks: Book[] = freshRes.ok ? (await freshRes.json()).books || [] : books;
    let targetBookId: string;
    if (books.length === 0) {
      const bookName = window.prompt("No books yet. Name a new book:");
      if (!bookName?.trim()) return;
      targetBookId = uid();
      workingBooks = [
        ...workingBooks,
        {
          id: targetBookId,
          name: bookName.trim(),
          imagePrompts: [],
          captions: [],
          slideshows: [],
        },
      ];
    } else {
      const choice = window.prompt(
        `Save to which book? Enter a number:\n${books
          .map((b, i) => `${i + 1}. ${b.name}`)
          .join("\n")}\n\nOr type a new book name.`
      );
      if (!choice?.trim()) return;
      const asNum = Number(choice);
      if (!isNaN(asNum) && asNum >= 1 && asNum <= books.length) {
        targetBookId = books[asNum - 1].id;
      } else {
        targetBookId = uid();
        workingBooks = [
          ...workingBooks,
          {
            id: targetBookId,
            name: choice.trim(),
            imagePrompts: [],
            captions: [],
            slideshows: [],
          },
        ];
      }
    }
    const slideshowName = window.prompt("Name this slideshow:");
    if (!slideshowName?.trim()) return;

    const promptItem: NamedItem = {
      id: uid(),
      name: `${slideshowName.trim()} prompt`,
      value: imagePrompt,
    };
    const captionItem: NamedItem | null = caption.trim()
      ? { id: uid(), name: `${slideshowName.trim()} caption`, value: caption }
      : null;
    const newSlideshow: Slideshow = {
      id: uid(),
      name: slideshowName.trim(),
      slideTexts: bulkText,
      imagePromptIds: [promptItem.id],
      captionIds: captionItem ? [captionItem.id] : [],
    };
    const next = workingBooks.map((b) =>
      b.id === targetBookId
        ? {
            ...b,
            imagePrompts: [...b.imagePrompts, promptItem],
            captions: captionItem ? [...b.captions, captionItem] : b.captions,
            slideshows: [...b.slideshows, newSlideshow],
          }
        : b
    );
    await saveBooks(next);
    window.alert(`Saved "${newSlideshow.name}" to book.`);
  }

  // Flow
  const [tab, setTab] = useState<Tab>("automation");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slideshow, setSlideshow] = useState<GeneratedSlideshow | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Post state
  const [posting, setPosting] = useState(false);
  const [postStatus, setPostStatus] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // Hydrate accountId on mount
  useEffect(() => {
    try {
      const aid = localStorage.getItem(LS.accountId);
      if (aid) setAccountId(Number(aid));
    } catch {}
    setHydrated(true);
  }, []);

  // Fetch accounts on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/post-tiktok`);
        if (!res.ok) return;
        const data = await res.json();
        setAccounts(data.accounts || []);
      } catch {}
    })();
  }, []);

  // Load per-account data from KV (with one-time localStorage migration)
  useEffect(() => {
    if (!hydrated || accountId == null) return;
    localStorage.setItem(LS.accountId, String(accountId));
    setLoadingAccount(true);
    (async () => {
      try {
        const res = await fetch(`/api/account-data?accountId=${accountId}`);
        if (!res.ok) throw new Error("Failed to load");
        const { data } = (await res.json()) as { data: AccountData };

        // Migrate legacy localStorage → KV once if KV is empty
        const alreadyMigrated = localStorage.getItem(LS.migrated(accountId));
        const kvEmpty =
          !data.prompts.length && !data.texts.length && !data.captions.length;
        if (!alreadyMigrated && kvEmpty) {
          try {
            const sp = localStorage.getItem(LS.savedPrompts(accountId));
            const st = localStorage.getItem(LS.savedTexts(accountId));
            const sc = localStorage.getItem(LS.savedCaptions(accountId));
            const migrated: AccountData = {
              config: data.config || DEFAULT_CONFIG,
              prompts: sp ? JSON.parse(sp) : [],
              texts: st ? JSON.parse(st) : [],
              captions: sc ? JSON.parse(sc) : [],
            };
            if (
              migrated.prompts.length ||
              migrated.texts.length ||
              migrated.captions.length
            ) {
              await fetch("/api/account-data", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  accountId,
                  data: migrated,
                }),
              });
              data.prompts = migrated.prompts;
              data.texts = migrated.texts;
              data.captions = migrated.captions;
            }
          } catch {}
          localStorage.setItem(LS.migrated(accountId), "1");
        }

        setSavedPrompts(data.prompts || []);
        setSavedTexts(data.texts || []);
        setSavedCaptions(data.captions || []);
        setConfig(data.config || DEFAULT_CONFIG);
        setLastRun(data.lastRun);
        setLastStatus(data.lastStatus);
        setRecentPosts(data.recentPosts || []);
        // Initialize expanded books from existing selections
        const existingSels = data.config?.selections || [];
        setExpandedBooks([...new Set(existingSels.map((s: { bookId: string }) => s.bookId))]);

        // Draft stays in localStorage (per-device, per-account)
        const draft = localStorage.getItem(LS.draft(accountId));
        if (draft) {
          const d = JSON.parse(draft);
          setImagePrompt(d.imagePrompt || "");
          setBulkText(d.bulkText || "");
          setCaption(d.caption || "");
        } else {
          setImagePrompt("");
          setBulkText("");
          setCaption("");
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingAccount(false);
      }
    })();
  }, [accountId, hydrated]);

  // Persist draft per account (local only)
  useEffect(() => {
    if (!hydrated || accountId == null) return;
    localStorage.setItem(
      LS.draft(accountId),
      JSON.stringify({ imagePrompt, bulkText, caption })
    );
  }, [imagePrompt, bulkText, caption, accountId, hydrated]);

  // Debounced KV save whenever saved items or config change
  useEffect(() => {
    if (!hydrated || accountId == null || loadingAccount) return;
    const t = setTimeout(() => {
      // Strip pointer/promptPointer — these are managed by the cron, not the UI.
      // Saving stale values here would overwrite the cron's updated pointers.
      const { pointer: _p, promptPointer: _pp, ...configWithoutPointers } = config;
      fetch("/api/account-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          data: {
            config: configWithoutPointers,
            prompts: savedPrompts,
            texts: savedTexts,
            captions: savedCaptions,
            lastRun,
            lastStatus,
          },
        }),
      }).then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          console.error("Config save failed:", res.status, text);
          window.alert(`Save failed: ${res.status} ${text}`);
        }
      }).catch((e) => {
        console.error("Config save error:", e);
        window.alert("Save failed — check console for details.");
      });
    }, 400);
    return () => clearTimeout(t);
  }, [
    savedPrompts,
    savedTexts,
    savedCaptions,
    config,
    accountId,
    hydrated,
    loadingAccount,
    lastRun,
    lastStatus,
  ]);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === accountId) || null,
    [accounts, accountId]
  );

  const slideCount = bulkText.split("\n").filter((t) => t.trim()).length;

  async function generate() {
    const validTexts = bulkText.split("\n").filter((t) => t.trim());
    if (validTexts.length === 0 || !imagePrompt.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePrompt, texts: validTexts }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Generation failed");
      }

      const data = await res.json();
      setSlideshow(data);
      setCurrentSlide(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  const postToTikTok = useCallback(async () => {
    if (!slideshow || accountId == null) return;
    if (slideshow.texts.length < 2) {
      setPostStatus("TikTok carousels need at least 2 slides");
      return;
    }
    setPosting(true);
    setPostStatus(null);
    try {
      const mediaIds: string[] = [];
      const coverImage = selectedBookId
        ? books.find((b) => b.id === selectedBookId)?.coverImage
        : undefined;
      // If book has cover, drop the last text slide (book tag) since cover replaces it
      const textSlides = coverImage && slideshow.texts.length > 2
        ? slideshow.texts.slice(0, -1)
        : slideshow.texts;
      const totalSlides = textSlides.length + (coverImage ? 1 : 0);

      const slideStyle = Math.floor(Math.random() * 3);
      for (let i = 0; i < textSlides.length; i++) {
        setPostStatus(`Uploading slide ${i + 1} of ${totalSlides}...`);
        const canvas = await renderSlideToCanvas(slideshow.image, textSlides[i], slideStyle);
        const dataUrl = canvas.toDataURL("image/png");

        const res = await fetch("/api/post-tiktok?action=upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, index: i }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Upload ${i + 1} failed`);
        mediaIds.push(data.media_id);
      }

      // Upload book cover as final slide
      if (coverImage) {
        setPostStatus(`Uploading cover slide ${totalSlides} of ${totalSlides}...`);
        const res = await fetch("/api/post-tiktok?action=upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: coverImage, index: textSlides.length }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Cover upload failed");
        mediaIds.push(data.media_id);
      }

      setPostStatus("Publishing...");
      const pubRes = await fetch("/api/post-tiktok?action=publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          mediaIds,
          accountIds: [accountId],
        }),
      });
      const pubData = await pubRes.json();
      if (!pubRes.ok) throw new Error(pubData.error || "Publish failed");

      setPostStatus(`Posted to @${selectedAccount?.username}!`);
    } catch (err) {
      setPostStatus(err instanceof Error ? err.message : "Posting failed");
    } finally {
      setPosting(false);
    }
  }, [slideshow, caption, accountId, selectedAccount, selectedBookId, books]);

  const downloadAll = useCallback(async () => {
    if (!slideshow) return;
    setDownloading(true);
    const slideStyle = Math.floor(Math.random() * 3);
    for (let i = 0; i < slideshow.texts.length; i++) {
      const canvas = await renderSlideToCanvas(slideshow.image, slideshow.texts[i], slideStyle);
      const link = document.createElement("a");
      link.download = `slide-${i + 1}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      await new Promise((r) => setTimeout(r, 300));
    }
    setDownloading(false);
  }, [slideshow]);

  // ============ SHELL ============
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-3xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Dashboard</strong> — manage your TikTok accounts and automate slideshow posting.</p>
          <p>Select a book and slideshow, pick which accounts to post to, and set time windows for automated daily posting. Each post gets a fresh AI-generated image.</p>
          <p>Use the automation toggle to enable/disable scheduled posting. Time windows are in UTC — one post is scheduled at a random time within each window.</p>
        </HowItWorks>
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 rounded-xl bg-gray-100 border border-gray-200/60 mb-8">
          {([["automation", "Automation"], ["post-now", "Post Now"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ============ TAB: Automation ============ */}
        {tab === "automation" && (
          <section className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-8">
              <h2 className="text-lg font-semibold mb-1 text-gray-900">Automation</h2>
              <p className="text-sm text-gray-500 mb-6">
                Set up scheduled daily posting for your TikTok accounts.
              </p>

              {accounts.length === 0 ? (
                <p className="text-sm text-gray-500">Loading accounts…</p>
              ) : (
                <>
                  <label className="block text-sm font-medium text-gray-500 mb-2">
                    Account
                  </label>
                  <select
                    value={accountId ?? ""}
                    onChange={(e) =>
                      setAccountId(e.target.value ? Number(e.target.value) : null)
                    }
                    className="w-full rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 mb-6"
                  >
                    <option value="">Select an account…</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.username}
                      </option>
                    ))}
                  </select>

                  {accountId != null && !loadingAccount && (
                    <div className="rounded-xl border border-gray-200/60 bg-gray-50 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            Automate daily posts
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            Picks a random slideshow from your selected books and
                            generates a fresh image each time.
                          </div>
                        </div>
                        <button
                          onClick={() =>
                            setConfig({ ...config, enabled: !config.enabled })
                          }
                          className={`relative w-11 h-6 rounded-full transition-colors ${
                            config.enabled ? "bg-green-500" : "bg-gray-300"
                          }`}
                          aria-label="Toggle automation"
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${
                              config.enabled ? "translate-x-5" : ""
                            }`}
                          />
                        </button>
                      </div>

                      {config.enabled && (
                        <>
                          <div className="mb-1">
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs text-gray-500">
                                Posting intervals (1 post per interval)
                              </label>
                              <button
                                onClick={() => {
                                  const intervals = [
                                    ...(config.intervals || []),
                                    { start: "18:00", end: "20:00" },
                                  ];
                                  setConfig({ ...config, intervals });
                                }}
                                className="text-xs text-gray-400 hover:text-blue-500 transition-colors"
                              >
                                + Add interval
                              </button>
                            </div>
                            {(config.intervals && config.intervals.length > 0
                              ? config.intervals
                              : [{ start: config.windowStart || "18:00", end: config.windowEnd || "20:00" }]
                            ).map((win, idx) => (
                              <div
                                key={idx}
                                className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2 items-end"
                              >
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">
                                    From
                                  </label>
                                  <input
                                    type="time"
                                    value={utcToLocal(win.start)}
                                    onChange={(e) => {
                                      const intervals = [
                                        ...(config.intervals || [{ start: config.windowStart || "18:00", end: config.windowEnd || "20:00" }]),
                                      ];
                                      intervals[idx] = {
                                        ...intervals[idx],
                                        start: localToUtc(e.target.value),
                                      };
                                      setConfig({ ...config, intervals });
                                    }}
                                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                                  />
                                </div>
                                <div>
                                  <label className="block text-xs text-gray-500 mb-1">
                                    To
                                  </label>
                                  <input
                                    type="time"
                                    value={utcToLocal(win.end)}
                                    onChange={(e) => {
                                      const intervals = [
                                        ...(config.intervals || [{ start: config.windowStart || "18:00", end: config.windowEnd || "20:00" }]),
                                      ];
                                      intervals[idx] = {
                                        ...intervals[idx],
                                        end: localToUtc(e.target.value),
                                      };
                                      setConfig({ ...config, intervals });
                                    }}
                                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                                  />
                                </div>
                                <button
                                  onClick={() => {
                                    const intervals = [
                                      ...(config.intervals || [{ start: config.windowStart || "18:00", end: config.windowEnd || "20:00" }]),
                                    ];
                                    if (intervals.length <= 1) return;
                                    intervals.splice(idx, 1);
                                    setConfig({ ...config, intervals });
                                  }}
                                  className="pb-2 text-gray-400 hover:text-red-500 transition-colors text-sm"
                                  title="Remove interval"
                                >
                                  ✕
                                </button>
                              </div>
                            ))}
                            <p className="text-xs text-gray-400 mt-1">
                              Each interval schedules 1 post at a random time within it.
                            </p>
                          </div>
                          {lastRun && (
                            <p className="text-xs text-gray-400 mt-2">
                              Last run: {new Date(lastRun).toLocaleString()} —{" "}
                              {lastStatus}
                            </p>
                          )}
                          {recentPosts.length > 0 && (
                            <div className="mt-4">
                              <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Recent Scheduled Posts</div>
                              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                                {recentPosts.map((p, i) => (
                                  <div key={i} className="text-xs bg-white rounded-lg border border-gray-200 px-3 py-2">
                                    <div className="flex justify-between">
                                      <span className="font-medium text-gray-800">{p.bookName} / {p.slideshowName}</span>
                                      <span className="text-gray-400">{new Date(p.scheduledAt).toLocaleString()}</span>
                                    </div>
                                    <div className="text-gray-400 mt-0.5 truncate">Prompt: {p.promptSnippet}…</div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {accountId != null && config.enabled && (
                    <div className="mt-6 rounded-xl border border-gray-200/60 bg-gray-50 p-5">
                      <div className="text-sm font-medium text-gray-900 mb-3">
                        Source book & slideshows
                      </div>
                      {books.length === 0 ? (
                        <p className="text-xs text-gray-500">
                          No books yet. Create one on the{" "}
                          <a href="/books" className="underline hover:text-gray-900">
                            Books
                          </a>{" "}
                          page first.
                        </p>
                      ) : (() => {
                        const sels = config.selections || [];
                        const selectedBooks = books.filter((b) =>
                          expandedBooks.includes(b.id)
                        );
                        return (
                          <>
                            <label className="text-xs text-gray-500 mb-1 block">
                              Books
                            </label>
                            <div className="space-y-1 max-h-40 overflow-y-auto mb-4">
                              {books.map((b) => {
                                const bookSelected = expandedBooks.includes(b.id);
                                return (
                                  <label
                                    key={b.id}
                                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={bookSelected}
                                      onChange={() => {
                                        if (bookSelected) {
                                          setConfig({
                                            ...config,
                                            selections: sels.filter(
                                              (s) => s.bookId !== b.id
                                            ),
                                          });
                                          setExpandedBooks((prev) =>
                                            prev.filter((id) => id !== b.id)
                                          );
                                        } else {
                                          setExpandedBooks((prev) => [...prev, b.id]);
                                        }
                                      }}
                                      className="accent-blue-500"
                                    />
                                    <span className="text-sm text-gray-700">
                                      {b.name}
                                    </span>
                                    <span className="text-xs text-gray-400 ml-auto">
                                      {b.slideshows.length} slideshows
                                    </span>
                                  </label>
                                );
                              })}
                            </div>

                            {selectedBooks.length > 0 && (
                              <>
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-xs text-gray-500">
                                    Slideshows
                                  </label>
                                  <div className="flex gap-3 text-xs">
                                    <button
                                      onClick={() => {
                                        const all: Array<{
                                          bookId: string;
                                          slideshowId: string;
                                        }> = [];
                                        selectedBooks.forEach((b) =>
                                          b.slideshows.forEach((s) =>
                                            all.push({
                                              bookId: b.id,
                                              slideshowId: s.id,
                                            })
                                          )
                                        );
                                        setConfig({
                                          ...config,
                                          selections: all,
                                        });
                                      }}
                                      className="text-gray-500 hover:text-blue-500 transition-colors"
                                    >
                                      All
                                    </button>
                                    <button
                                      onClick={() => {
                                        setConfig({
                                          ...config,
                                          selections: [],
                                        });
                                      }}
                                      className="text-gray-500 hover:text-blue-500 transition-colors"
                                    >
                                      None
                                    </button>
                                  </div>
                                </div>
                                <div className="space-y-1 max-h-48 overflow-y-auto">
                                  {selectedBooks.map((b) => (
                                    <div key={b.id}>
                                      <div className="text-xs font-medium text-gray-400 px-2 pt-2 pb-1">
                                        {b.name}
                                      </div>
                                      {b.slideshows.map((s) => {
                                        const checked = sels.some(
                                          (sel) =>
                                            sel.bookId === b.id &&
                                            sel.slideshowId === s.id
                                        );
                                        return (
                                          <label
                                            key={s.id}
                                            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer"
                                          >
                                            <input
                                              type="checkbox"
                                              checked={checked}
                                              onChange={() => {
                                                setConfig({
                                                  ...config,
                                                  selections: checked
                                                    ? sels.filter(
                                                        (sel) =>
                                                          !(
                                                            sel.bookId === b.id &&
                                                            sel.slideshowId ===
                                                              s.id
                                                          )
                                                      )
                                                    : [
                                                        ...sels,
                                                        {
                                                          bookId: b.id,
                                                          slideshowId: s.id,
                                                        },
                                                      ],
                                                });
                                              }}
                                              className="accent-blue-500"
                                            />
                                            <span className="text-sm text-gray-700">
                                              {s.name}
                                            </span>
                                            <span className="text-xs text-gray-400 ml-auto">
                                              {
                                                s.slideTexts
                                                  .split("\n")
                                                  .filter((t) => t.trim()).length
                                              }{" "}
                                              slides
                                            </span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  ))}
                                </div>
                              </>
                            )}
                            <p className="text-xs text-gray-400 mt-2">
                              Pick books first, then choose which slideshows to
                              include. Cron picks randomly across all selected.
                            </p>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        )}

        {/* ============ TAB: Post Now ============ */}
        {tab === "post-now" && (
          <section className="space-y-6">
            {/* Account selector for posting */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
              <label className="block text-sm font-medium text-gray-500 mb-2">
                Post to account
              </label>
              {accounts.length === 0 ? (
                <p className="text-sm text-gray-500">Loading accounts…</p>
              ) : (
                <select
                  value={accountId ?? ""}
                  onChange={(e) =>
                    setAccountId(e.target.value ? Number(e.target.value) : null)
                  }
                  className="w-full rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                >
                  <option value="">Select an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      @{a.username}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Library actions */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-5 flex flex-wrap items-center gap-3">
              <div className="text-sm text-gray-400 mr-auto">
                Library:
              </div>
              <select
                value=""
                onChange={(e) => {
                  const [bookId, slideshowId] = e.target.value.split("::");
                  const b = books.find((x) => x.id === bookId);
                  const s = b?.slideshows.find((x) => x.id === slideshowId);
                  if (s && b) loadSlideshowIntoEditor(s, b);
                }}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                <option value="">Load from book…</option>
                {books.map((b) => (
                  <optgroup key={b.id} label={b.name}>
                    {b.slideshows.map((s) => (
                      <option key={s.id} value={`${b.id}::${s.id}`}>
                        {s.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                onClick={saveDraftToBook}
                className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm font-medium"
              >
                Save to book
              </button>
            </div>

            {/* Image prompt */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Background image prompt
              </label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Describe the background image for all slides..."
                rows={3}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
              />
            </div>

            {/* Slide texts */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Slide texts
              </label>
              <p className="text-xs text-gray-500 mb-3">
                One slide per line. Empty lines are ignored.
              </p>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={"First slide text\nSecond slide text\nThird slide text"}
                rows={8}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
              <p className="text-xs text-gray-400 mt-2">
                {slideCount} slide{slideCount !== 1 ? "s" : ""}
              </p>
            </div>

            {/* Caption */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                TikTok caption
              </label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="Caption that appears on the TikTok post..."
                rows={3}
                className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 resize-none"
              />
            </div>

            {error && (
              <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-500 text-sm">
                {error}
              </div>
            )}

            {/* Generate button */}
            <button
              onClick={generate}
              disabled={loading || !imagePrompt.trim() || slideCount === 0}
              className="w-full px-6 py-3 rounded-lg bg-blue-500 text-white font-semibold hover:bg-blue-600 shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span
                    className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                    style={{ animation: "spin 0.6s linear infinite" }}
                  />
                  Generating…
                </>
              ) : (
                "Generate slideshow"
              )}
            </button>

            {/* Preview + Post (appears after generation) */}
            {slideshow && (() => {
              const previewCover = selectedBookId
                ? books.find((b) => b.id === selectedBookId)?.coverImage
                : undefined;
              const previewTexts = previewCover && slideshow.texts.length > 2
                ? slideshow.texts.slice(0, -1)
                : slideshow.texts;
              const totalPreviewSlides = previewTexts.length + (previewCover ? 1 : 0);
              const isCoverSlide = previewCover && currentSlide === totalPreviewSlides - 1;

              return (
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm p-6 sm:p-8">
                  <div className="flex flex-col items-center">
                    {/* Slide frame */}
                    <div
                      className="relative rounded-2xl overflow-hidden shadow-2xl bg-gray-50"
                      style={{
                        width: "min(100%, 320px)",
                        aspectRatio: "9 / 16",
                        maxHeight: "60vh",
                      }}
                    >
                      {isCoverSlide ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={previewCover}
                          alt="Book cover"
                          style={{
                            position: "absolute",
                            inset: 0,
                            width: "100%",
                            height: "100%",
                            objectFit: "contain",
                            background: "#000",
                          }}
                        />
                      ) : (
                        <>
                          {slideshow.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={slideshow.image}
                              alt={imagePrompt}
                              style={{
                                position: "absolute",
                                inset: 0,
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                position: "absolute",
                                inset: 0,
                                background: "linear-gradient(to bottom, #27272a, #18181b)",
                              }}
                            />
                          )}
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              background:
                                "linear-gradient(to top, rgba(0,0,0,0.85) 15%, rgba(0,0,0,0.2) 50%, rgba(0,0,0,0.4) 100%)",
                            }}
                          />
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "1.5rem",
                            }}
                          >
                            <p
                              style={{
                                fontSize: "1.4rem",
                                fontWeight: 700,
                                lineHeight: 1.3,
                                color: "white",
                                textShadow: "0 2px 8px rgba(0,0,0,0.5)",
                                textAlign: "center",
                              }}
                            >
                              {previewTexts[currentSlide]}
                            </p>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Prev / counter / Next */}
                    <div className="flex items-center gap-4 mt-5">
                      <button
                        onClick={() => setCurrentSlide((i) => Math.max(0, i - 1))}
                        disabled={currentSlide === 0}
                        className="w-10 h-10 rounded-full border border-gray-300 text-gray-900 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-200 transition-colors"
                      >
                        ‹
                      </button>
                      <div className="text-sm text-gray-400 tabular-nums">
                        {currentSlide + 1} / {totalPreviewSlides}
                      </div>
                      <button
                        onClick={() =>
                          setCurrentSlide((i) =>
                            Math.min(totalPreviewSlides - 1, i + 1)
                          )
                        }
                        disabled={currentSlide === totalPreviewSlides - 1}
                        className="w-10 h-10 rounded-full border border-gray-300 text-gray-900 disabled:text-gray-300 disabled:border-gray-200 hover:bg-gray-200 transition-colors"
                      >
                        ›
                      </button>
                    </div>

                    {/* Dots */}
                    <div className="flex gap-2 mt-4 flex-wrap justify-center">
                      {Array.from({ length: totalPreviewSlides }).map((_, i) => (
                        <button
                          key={i}
                          onClick={() => setCurrentSlide(i)}
                          style={{
                            width: i === currentSlide ? 24 : 8,
                            height: 8,
                            borderRadius: 4,
                            border: "none",
                            background:
                              i === currentSlide ? "#3b82f6" : "rgba(0,0,0,0.15)",
                            cursor: "pointer",
                            transition: "all 0.3s",
                          }}
                        />
                      ))}
                    </div>

                    {postStatus && (
                      <div
                        className={`mt-5 text-sm ${
                          postStatus.includes("Posted") ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {postStatus}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-6 flex flex-wrap justify-center gap-3 w-full">
                      <button
                        onClick={() => {
                          setSlideshow(null);
                          setPostStatus(null);
                          setCurrentSlide(0);
                        }}
                        className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm font-medium"
                      >
                        Clear preview
                      </button>
                      <button
                        onClick={downloadAll}
                        disabled={downloading}
                        className="px-5 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm font-medium disabled:opacity-50"
                      >
                        {downloading ? "Downloading…" : "Download all"}
                      </button>
                      <button
                        onClick={postToTikTok}
                        disabled={posting || accountId == null}
                        className="px-5 py-2.5 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
                        style={{
                          background: "linear-gradient(135deg, #ff0050, #00f2ea)",
                        }}
                      >
                        {posting
                          ? "Posting…"
                          : accountId == null
                          ? "Select account to post"
                          : `Post to @${selectedAccount?.username ?? ""}`}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}
          </section>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
