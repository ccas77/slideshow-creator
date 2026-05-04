"use client";

import { useEffect, useState, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TopBook {
  id: string;
  title: string;
  author: string;
  genre: string;
  coverData: string;
  pinned: boolean;
}

interface TimeWindow {
  start: string;
  end: string;
}

interface TopNAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  listIds: string[];
  pointer: number;
  frequencyDays: number;
  lastPostDate?: string;
  platform: "tiktok-carousel" | "tiktok-video" | "fb-video" | "ig-carousel" | "ig-video";
  backgroundPrompts?: string[];
}

interface TopNGlobalAutomation {
  accounts: Record<string, TopNAccountConfig>;
}

interface TopNList {
  id: string;
  name: string;
  titleTexts: string[];
  count: number;
  bookIds: string[];
  captions: string[];
  backgroundPrompts: string[];
  musicTrackIds?: string[];
}

interface MusicTrack {
  id: string;
  name: string;
}

interface TikTokAccount {
  id: number;
  username: string;
}

export default function TopBooksPage() {
  const [books, setBooks] = useState<TopBook[]>([]);
  const [lists, setLists] = useState<TopNList[]>([]);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [igAccounts, setIgAccounts] = useState<TikTokAccount[]>([]);
  const [fbAccounts, setFbAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState(false);

  // Book form
  const [showBookForm, setShowBookForm] = useState(false);
  const [editBookId, setEditBookId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");
  const [bookPinned, setBookPinned] = useState(false);
  const [bookCover, setBookCover] = useState<string | null>(null);
  const [bookCoverPreview, setBookCoverPreview] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [bookGenre, setBookGenre] = useState("");
  const [bookUrl, setBookUrl] = useState("");
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [fetchUrlError, setFetchUrlError] = useState("");
  const [genreFilter, setGenreFilter] = useState<string>("all");

  // List form
  const [showListForm, setShowListForm] = useState(false);
  const [editListId, setEditListId] = useState<string | null>(null);
  const [listName, setListName] = useState("");
  const [listTitles, setListTitles] = useState("");
  const [listCount, setListCount] = useState(10);
  const [listBookIds, setListBookIds] = useState<string[]>([]);
  const [listCaptions, setListCaptions] = useState("");
  const [listBgPrompts, setListBgPrompts] = useState("");
  const [listMusicTrackIds, setListMusicTrackIds] = useState<string[]>([]);

  // Publish
  const [publishListId, setPublishListId] = useState<string | null>(null);
  const [publishAccounts, setPublishAccounts] = useState<number[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");

  // Automation (per-account)
  const [topnAutoConfig, setTopnAutoConfig] = useState<TopNGlobalAutomation>({ accounts: {} });
  const [selectedTopnAccount, setSelectedTopnAccount] = useState<string>("");
  const [savingAuto, setSavingAuto] = useState(false);
  const [describingImage, setDescribingImage] = useState(false);
  const [bgImageUrl, setBgImageUrl] = useState("");
  const [bgPromptsText, setBgPromptsText] = useState("");
  useEffect(() => {
    const cfg = selectedTopnAccount ? topnAutoConfig.accounts[selectedTopnAccount] : null;
    setBgPromptsText((cfg?.backgroundPrompts || []).join("\n"));
  }, [selectedTopnAccount, topnAutoConfig]);

  // Music
  const [musicTracks, setMusicTracks] = useState<MusicTrack[]>([]);
  const [uploadingMusic, setUploadingMusic] = useState(false);

  // Preview
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [generatingVideoForList, setGeneratingVideoForList] = useState<string | null>(null);

  // Active tab
  const [tab, setTab] = useState<"books" | "lists" | "music" | "automation">("books");

  const headers = useCallback(() => {
    return { "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, lRes, aRes, igRes, fbRes, autoRes, musicRes] = await Promise.all([
        fetch(`/api/top-books`),
        fetch(`/api/top-n-lists`),
        fetch(`/api/post-tiktok?platform=tiktok`),
        fetch(`/api/post-tiktok?platform=instagram`),
        fetch(`/api/post-tiktok?platform=facebook`),
        fetch(`/api/topn-automation`),
        fetch(`/api/music-tracks`),
      ]);
      if (bRes.ok) setBooks((await bRes.json()).books || []);
      if (lRes.ok) setLists((await lRes.json()).lists || []);
      if (aRes.ok) setAccounts((await aRes.json()).accounts || []);
      if (igRes.ok) setIgAccounts((await igRes.json()).accounts || []);
      if (fbRes.ok) setFbAccounts((await fbRes.json()).accounts || []);
      if (autoRes.ok) {
        const autoData = await autoRes.json();
        setTopnAutoConfig(autoData.config || { accounts: {} });
      }
      if (musicRes.ok) setMusicTracks((await musicRes.json()).tracks || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Book CRUD ──

  function openBookForm(book?: TopBook) {
    if (book) {
      setEditBookId(book.id);
      setBookTitle(book.title);
      setBookAuthor(book.author);
      setBookGenre(book.genre || "");
      setBookPinned(book.pinned);
      setBookCover(null);
      setBookCoverPreview(book.coverData);
    } else {
      setEditBookId(null);
      setBookTitle("");
      setBookAuthor("");
      setBookGenre("");
      setBookPinned(false);
      setBookCover(null);
      setBookCoverPreview(null);
    }
    setBookUrl("");
    setShowBookForm(true);
  }

  async function fetchBookUrl() {
    if (!bookUrl.trim()) return;
    setFetchingUrl(true);
    setFetchUrlError("");
    try {
      // Fetch the image via our proxy endpoint
      const res = await fetch("/api/fetch-image-url", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ url: bookUrl.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.coverData) {
        setBookCover(data.coverData);
        setBookCoverPreview(data.coverData);
        // Auto-recognize title and author from the cover
        if (!bookTitle && !bookAuthor) {
          setRecognizing(true);
          try {
            const recRes = await fetch("/api/recognize-cover", {
              method: "POST",
              headers: headers(),
              body: JSON.stringify({ imageData: data.coverData }),
            });
            if (recRes.ok) {
              const recData = await recRes.json();
              if (recData.title) setBookTitle(recData.title);
              if (recData.author) setBookAuthor(recData.author);
            }
          } catch {}
          setRecognizing(false);
        }
      } else {
        setFetchUrlError(data.error || "Failed to fetch image");
      }
    } catch (e) {
      setFetchUrlError(e instanceof Error ? e.message : "Failed to fetch");
    }
    setFetchingUrl(false);
  }

  function handleCoverFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      setBookCover(dataUrl);
      setBookCoverPreview(dataUrl);
      // Auto-recognize title and author if fields are empty
      if (!bookTitle && !bookAuthor) {
        setRecognizing(true);
        try {
          const res = await fetch("/api/recognize-cover", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ imageData: dataUrl }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.title) setBookTitle(data.title);
            if (data.author) setBookAuthor(data.author);
          }
        } catch {}
        setRecognizing(false);
      }
    };
    reader.readAsDataURL(file);
  }

  async function saveBook() {
    if (!bookTitle.trim()) return;
    if (!editBookId && !bookCover) return;
    setLoading(true);
    try {
      if (editBookId) {
        await fetch(`/api/top-books`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify({
            id: editBookId,
            title: bookTitle,
            author: bookAuthor,
            genre: bookGenre,
            pinned: bookPinned,
            ...(bookCover ? { coverData: bookCover } : {}),
          }),
        });
      } else {
        await fetch(`/api/top-books`, {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({
            title: bookTitle,
            author: bookAuthor,
            genre: bookGenre,
            pinned: bookPinned,
            coverData: bookCover,
          }),
        });
      }
      setShowBookForm(false);
      await load();
    } catch {}
    setLoading(false);
  }

  async function deleteBook(id: string) {
    if (!window.confirm("Delete this book?")) return;
    await fetch(`/api/top-books?id=${id}`, {
      method: "DELETE",
    });
    await load();
  }

  async function togglePinned(book: TopBook) {
    await fetch(`/api/top-books`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ id: book.id, pinned: !book.pinned }),
    });
    await load();
  }

  // ── List CRUD ──

  function openListForm(list?: TopNList) {
    if (list) {
      setEditListId(list.id);
      setListName(list.name);
      setListTitles((list.titleTexts || []).join("\n"));
      setListCount(list.count);
      setListBookIds(list.bookIds);
      setListCaptions((list.captions || []).join("\n\n"));
      setListBgPrompts((list.backgroundPrompts || []).join("\n"));
      setListMusicTrackIds(list.musicTrackIds || []);
    } else {
      setEditListId(null);
      setListName("");
      setListTitles("");
      setListCount(10);
      setListBookIds([]);
      setListCaptions("");
      setListBgPrompts("");
      setListMusicTrackIds([]);
    }
    setShowListForm(true);
  }

  async function saveList() {
    const parsedTitles = listTitles.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!listName.trim() || parsedTitles.length === 0) return;
    const parsedCaptions = listCaptions.split("\n\n").map((s) => s.trim()).filter(Boolean);
    const parsedBgPrompts = listBgPrompts.split("\n").map((s) => s.trim()).filter(Boolean);
    const allLists = await (await fetch(`/api/top-n-lists`)).json();
    let updated = allLists.lists || [];
    if (editListId) {
      updated = updated.map((l: TopNList) =>
        l.id === editListId
          ? { ...l, name: listName, titleTexts: parsedTitles, count: listCount, bookIds: listBookIds, captions: parsedCaptions, backgroundPrompts: parsedBgPrompts, musicTrackIds: listMusicTrackIds }
          : l
      );
    } else {
      updated.push({
        id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
        name: listName,
        titleTexts: parsedTitles,
        count: listCount,
        bookIds: listBookIds,
        captions: parsedCaptions,
        backgroundPrompts: parsedBgPrompts,
        musicTrackIds: listMusicTrackIds,
      });
    }
    await fetch(`/api/top-n-lists`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ lists: updated }),
    });
    setShowListForm(false);
    await load();
  }

  async function deleteList(id: string) {
    if (!window.confirm("Delete this list?")) return;
    await fetch(`/api/top-n-lists?id=${id}`, {
      method: "DELETE",
    });
    await load();
  }

  function toggleBookInList(bookId: string) {
    setListBookIds((prev) =>
      prev.includes(bookId) ? prev.filter((id) => id !== bookId) : [...prev, bookId]
    );
  }

  // ── Music ──

  async function handleMusicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingMusic(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
      }
      const base64 = btoa(binary);
      const mimeType = file.type || "audio/mpeg";
      const audioData = `data:${mimeType};base64,${base64}`;

      const name = file.name.replace(/\.[^.]+$/, "");
      const CHUNK_SIZE = 3_000_000;

      if (audioData.length <= CHUNK_SIZE) {
        await fetch("/api/music-tracks", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ name, audioData }),
        });
      } else {
        const totalChunks = Math.ceil(audioData.length / CHUNK_SIZE);
        const firstChunk = audioData.slice(0, CHUNK_SIZE);
        const res = await fetch("/api/music-tracks", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ name, audioData: firstChunk, chunked: true, chunkIndex: 0, totalChunks }),
        });
        const { id } = await res.json();

        for (let i = 1; i < totalChunks; i++) {
          const chunk = audioData.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          await fetch("/api/music-tracks", {
            method: "POST",
            headers: headers(),
            body: JSON.stringify({ id, audioData: chunk, chunked: true, chunkIndex: i, totalChunks }),
          });
        }
      }
      await load();
    } catch (err) {
      alert("Upload failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
    setUploadingMusic(false);
    e.target.value = "";
  }

  async function deleteMusic(id: string) {
    if (!window.confirm("Delete this track?")) return;
    await fetch("/api/music-tracks", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ action: "delete", id }),
    });
    await load();
  }

  function toggleMusicInList(trackId: string) {
    setListMusicTrackIds((prev) =>
      prev.includes(trackId) ? prev.filter((id) => id !== trackId) : [...prev, trackId]
    );
  }

  // ── Video Preview ──

  async function generateVideoPreview(listId: string, accountId?: string) {
    setGeneratingVideoForList(listId);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoPreviewUrl(null);
    try {
      const accKey = accountId || selectedTopnAccount;
      const accBgPrompts = accKey ? topnAutoConfig.accounts[accKey]?.backgroundPrompts : undefined;
      const bgParam = accBgPrompts && accBgPrompts.length > 0 ? `&backgroundPrompts=${encodeURIComponent(accBgPrompts.join("|"))}` : "";
      const res = await fetch(`/api/top-n-preview?listId=${listId}${bgParam}`, {
        signal: AbortSignal.timeout(300000),
      });
      const contentType = res.headers.get("content-type") || "";
      if (!res.ok || !contentType.includes("video")) {
        const text = await res.text();
        let errMsg = `${res.status} ${res.statusText}`;
        try {
          const data = JSON.parse(text);
          errMsg = data.error || errMsg;
        } catch {
          if (text.length < 500) errMsg = text || errMsg;
        }
        alert("Preview failed: " + errMsg);
        setGeneratingVideoForList(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setVideoPreviewUrl(url);
    } catch (err) {
      alert("Preview failed: " + (err instanceof Error ? err.message : "Unknown error"));
    }
    setGeneratingVideoForList(null);
  }

  // ── Publish ──

  async function publishList() {
    if (!publishListId || publishAccounts.length === 0) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      // Look up account-level background prompts for the first selected account
      const firstAccKey = String(publishAccounts[0]);
      const accBgPrompts = topnAutoConfig.accounts[firstAccKey]?.backgroundPrompts;
      const res = await fetch("/api/top-n-generate", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          listId: publishListId,
          accountIds: publishAccounts,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
          ...(accBgPrompts && accBgPrompts.length > 0 ? { backgroundPrompts: accBgPrompts } : {}),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setPublishResult(`Posted ${data.slides} slides: ${data.books?.join(", ")}`);
      } else {
        setPublishResult(`Error: ${data.error}`);
      }
    } catch (e) {
      setPublishResult(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    }
    setPublishing(false);
  }

  function togglePublishAccount(id: number) {
    setPublishAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  // ── Automation (per-account) ──

  // All accounts combined for the dropdown
  const allAutoAccounts = [
    ...accounts.map((a) => ({ id: String(a.id), username: a.username, source: "accounts" as const })),
    ...igAccounts.map((a) => ({ id: String(a.id), username: a.username, source: "igAccounts" as const })),
    ...fbAccounts.map((a) => ({ id: String(a.id), username: a.username, source: "fbAccounts" as const })),
  ];

  function detectPlatform(source: "accounts" | "igAccounts" | "fbAccounts"): TopNAccountConfig["platform"] {
    if (source === "accounts") return "tiktok-carousel";
    if (source === "igAccounts") return "ig-carousel";
    return "fb-video";
  }

  function platformLabel(p: TopNAccountConfig["platform"]): string {
    switch (p) {
      case "tiktok-carousel": return "TikTok Carousel";
      case "tiktok-video": return "TikTok Video";
      case "fb-video": return "Facebook Video";
      case "ig-carousel": return "Instagram Carousel";
      case "ig-video": return "Instagram Video";
    }
  }

  function getSelectedConfig(): TopNAccountConfig | null {
    if (!selectedTopnAccount) return null;
    return topnAutoConfig.accounts[selectedTopnAccount] || null;
  }

  function updateSelectedConfig(patch: Partial<TopNAccountConfig>) {
    if (!selectedTopnAccount) return;
    setTopnAutoConfig((prev) => {
      const existing = prev.accounts[selectedTopnAccount];
      const source = allAutoAccounts.find((a) => a.id === selectedTopnAccount)?.source || "accounts";
      const base: TopNAccountConfig = existing || {
        enabled: false,
        intervals: [{ start: "18:00", end: "20:00" }],
        listIds: [],
        pointer: 0,
        frequencyDays: 1,
        platform: detectPlatform(source),
      };
      return {
        ...prev,
        accounts: {
          ...prev.accounts,
          [selectedTopnAccount]: { ...base, ...patch },
        },
      };
    });
  }

  const configuredCount = Object.values(topnAutoConfig.accounts).filter((c) => c.enabled).length;

  async function saveTopnAutomation() {
    setSavingAuto(true);
    try {
      await fetch(`/api/topn-automation`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ config: topnAutoConfig }),
      });
      await load();
    } catch {}
    setSavingAuto(false);
  }

  function parseGenres(g: string): string[] {
    return g ? g.split(",").map((s) => s.trim()).filter(Boolean) : [];
  }
  const genres = Array.from(new Set(books.flatMap((b) => parseGenres(b.genre) || ["Uncategorized"]))).sort();
  const filteredBooks = genreFilter === "all" ? books : books.filter((b) => {
    const bg = parseGenres(b.genre);
    return bg.length === 0 ? genreFilter === "Uncategorized" : bg.includes(genreFilter);
  });

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Top Books</strong> — create curated &quot;Top N&quot; book lists and automate posting them.</p>
          <p>Add books with cover images (upload or paste a URL). The AI can recognize title and author from the cover. Pin books to guarantee they appear in every generated list.</p>
          <p>Create a <strong>list</strong> with a name, title text variations, caption pool, and background prompt pool. When published, it picks N books (pinned ones always included), shuffles the order, and generates a slideshow.</p>
          <p>The <strong>automation</strong> tab lets you configure per-account auto-posting with frequency, list selection, and time windows.</p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Top Books</h1>
          <button onClick={load} className="text-sm text-gray-500 hover:text-gray-900 transition-colors">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
          {(["books", "lists", "music", "automation"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                tab === t ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
              }`}
            >
              {t === "books" ? `Books (${books.length})` : t === "lists" ? `Lists (${lists.length})` : t === "music" ? `Music (${musicTracks.length})` : `Automation (${configuredCount})`}
            </button>
          ))}
        </div>

        {/* BOOKS TAB */}
        {tab === "books" && (
          <>
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <button
                onClick={() => openBookForm()}
                className="rounded-xl bg-blue-500 text-white px-4 py-2 text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
              >
                + Add Book
              </button>
              {genres.length > 1 && (
                <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
                  <button
                    onClick={() => setGenreFilter("all")}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      genreFilter === "all" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
                    }`}
                  >
                    All ({books.length})
                  </button>
                  {genres.map((g) => {
                    const count = books.filter((b) => {
                      const bg = parseGenres(b.genre);
                      return bg.length === 0 ? g === "Uncategorized" : bg.includes(g);
                    }).length;
                    return (
                      <button
                        key={g}
                        onClick={() => setGenreFilter(g)}
                        className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                          genreFilter === g ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-900"
                        }`}
                      >
                        {g} ({count})
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {filteredBooks.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filteredBooks.map((b) => (
                  <BookCard key={b.id} book={b} onEdit={() => openBookForm(b)} onDelete={() => deleteBook(b.id)} onTogglePin={() => togglePinned(b)} />
                ))}
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center text-gray-500">
                No books yet. Add some to get started.
              </div>
            )}
          </>
        )}

        {/* LISTS TAB */}
        {tab === "lists" && (
          <>
            <button
              onClick={() => openListForm()}
              className="mb-6 rounded-xl bg-blue-500 text-white px-4 py-2 text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm"
            >
              + New List
            </button>

            {lists.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center text-gray-500">
                No lists yet. Create one to build a Top N slideshow.
              </div>
            ) : (
              <div className="space-y-3">
                {lists.map((l) => {
                  const listBooks = l.bookIds.map((id) => books.find((b) => b.id === id)).filter(Boolean) as TopBook[];
                  return (
                    <div key={l.id} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{l.name}</span>
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {(l.titleTexts || []).length} title{(l.titleTexts || []).length !== 1 ? "s" : ""} &middot; {l.count} books from {listBooks.length} in pool
                          </div>
                          {listBooks.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {listBooks.slice(0, 8).map((b) => (
                                <img key={b.id} src={b.coverData} alt={b.title} className="w-8 h-12 rounded object-cover" />
                              ))}
                              {listBooks.length > 8 && (
                                <span className="text-xs text-gray-500 self-center ml-1">+{listBooks.length - 8}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => generateVideoPreview(l.id)}
                            disabled={generatingVideoForList !== null}
                            className="text-xs text-purple-500 hover:text-purple-600 transition-colors disabled:text-gray-400"
                          >
                            {generatingVideoForList === l.id ? "Generating..." : "Preview Video"}
                          </button>
                          <button
                            onClick={() => { setPublishListId(l.id); setPublishAccounts([]); setPublishResult(null); setScheduledAt(""); }}
                            className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors shadow-sm"
                          >
                            Publish
                          </button>
                          <button onClick={() => openListForm(l)} className="text-xs text-gray-500 hover:text-gray-900 transition-colors">
                            Edit
                          </button>
                          <button onClick={() => deleteList(l.id)} className="text-xs text-red-500 hover:text-red-600 transition-colors">
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* MUSIC TAB */}
        {tab === "music" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Music Tracks</h2>
              <label className={`px-4 py-2 rounded-xl text-sm font-medium cursor-pointer transition-colors shadow-sm ${uploadingMusic ? "bg-gray-200 text-gray-400" : "bg-blue-500 text-white hover:bg-blue-600"}`}>
                {uploadingMusic ? "Uploading..." : "+ Upload Track"}
                <input type="file" accept="audio/*" onChange={handleMusicUpload} className="hidden" disabled={uploadingMusic} />
              </label>
            </div>
            <p className="text-xs text-gray-500">Upload MP3 or M4A files. Assign them to lists in the list editor. A random track is picked for each video post.</p>
            {musicTracks.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">No music tracks yet. Upload one to get started.</p>
            ) : (
              <div className="space-y-3">
                {musicTracks.map((t) => {
                  const usedIn = lists.filter((l) => l.musicTrackIds?.includes(t.id)).map((l) => l.name);
                  const audioUrl = `/api/music-tracks?id=${t.id}`;
                  return (
                    <div key={t.id} className="bg-white rounded-2xl px-4 py-3 border border-gray-200/60 shadow-sm space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-gray-900 text-sm">{t.name}</span>
                          {usedIn.length > 0 && (
                            <span className="text-xs text-purple-500 ml-2">Used in: {usedIn.join(", ")}</span>
                          )}
                        </div>
                        <button onClick={() => deleteMusic(t.id)} className="text-xs text-red-500 hover:text-red-600 transition-colors">Delete</button>
                      </div>
                      <audio controls preload="none" src={audioUrl} className="w-full h-8" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* AUTOMATION TAB */}
        {tab === "automation" && (() => {
          const selConfig = getSelectedConfig();
          const selSource = allAutoAccounts.find((a) => a.id === selectedTopnAccount)?.source || "accounts";
          return (
            <>
              <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 mb-4">
                <p className="text-sm text-gray-500 mb-4">
                  {configuredCount} account{configuredCount !== 1 ? "s" : ""} configured for auto-posting
                </p>

                <div>
                  <label className="text-xs text-gray-500 block mb-1">Select account</label>
                  <select
                    value={selectedTopnAccount}
                    onChange={(e) => setSelectedTopnAccount(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                  >
                    <option value="">Choose an account...</option>
                    {accounts.length > 0 && (
                      <optgroup label="TikTok">
                        {accounts.map((a) => (
                          <option key={`tk-${a.id}`} value={String(a.id)}>@{a.username}</option>
                        ))}
                      </optgroup>
                    )}
                    {igAccounts.length > 0 && (
                      <optgroup label="Instagram">
                        {igAccounts.map((a) => (
                          <option key={`ig-${a.id}`} value={String(a.id)}>@{a.username}</option>
                        ))}
                      </optgroup>
                    )}
                    {fbAccounts.length > 0 && (
                      <optgroup label="Facebook">
                        {fbAccounts.map((a) => (
                          <option key={`fb-${a.id}`} value={String(a.id)}>@{a.username}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>

              {selectedTopnAccount && (() => {
                const config = selConfig || {
                  enabled: false,
                  intervals: [{ start: "18:00", end: "20:00" }],
                  listIds: [],
                  pointer: 0,
                  frequencyDays: 1,
                  platform: detectPlatform(selSource),
                };
                return (
                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-medium text-gray-900">
                          @{allAutoAccounts.find((a) => a.id === selectedTopnAccount)?.username}
                        </span>
                        <span className="text-xs text-gray-400 ml-2">{platformLabel(config.platform)}</span>
                      </div>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={(e) => updateSelectedConfig({ enabled: e.target.checked })}
                          className="accent-blue-500 rounded"
                        />
                        Enabled
                      </label>
                    </div>

                    {/* Platform */}
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Platform type</label>
                      <select
                        value={config.platform}
                        onChange={(e) => updateSelectedConfig({ platform: e.target.value as TopNAccountConfig["platform"] })}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                      >
                        <option value="tiktok-carousel">TikTok Carousel</option>
                        <option value="tiktok-video">TikTok Video</option>
                        <option value="ig-carousel">Instagram Carousel</option>
                        <option value="ig-video">Instagram Video</option>
                        <option value="fb-video">Facebook Video</option>
                      </select>
                    </div>

                    {/* Frequency */}
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Post frequency</label>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700">Post every</span>
                        <input
                          type="number"
                          min={1}
                          value={config.frequencyDays}
                          onChange={(e) => updateSelectedConfig({ frequencyDays: Math.max(1, Number(e.target.value)) })}
                          className="w-20 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                        />
                        <span className="text-sm text-gray-700">day{config.frequencyDays !== 1 ? "s" : ""}</span>
                      </div>
                    </div>

                    {/* List selection */}
                    <div>
                      <label className="text-xs text-gray-500 block mb-2">
                        Lists to include ({config.listIds.length === 0 ? "all" : config.listIds.length + " selected"})
                      </label>
                      <p className="text-[11px] text-gray-400 mb-2">Leave all unchecked to include all lists</p>
                      <div className="space-y-2 max-h-40 overflow-y-auto">
                        {lists.map((l) => (
                          <label key={l.id} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={config.listIds.includes(l.id)}
                              onChange={() => {
                                const newIds = config.listIds.includes(l.id)
                                  ? config.listIds.filter((id) => id !== l.id)
                                  : [...config.listIds, l.id];
                                updateSelectedConfig({ listIds: newIds });
                              }}
                              className="accent-blue-500 rounded"
                            />
                            {l.name}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Background prompts (account-level) */}
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Background prompts (one per line)</label>
                      <p className="text-[11px] text-gray-400 mb-2">Overrides list-level background prompts. Leave empty to use each list&apos;s own prompts.</p>
                      <textarea
                        value={bgPromptsText}
                        onChange={(e) => setBgPromptsText(e.target.value)}
                        onBlur={() => {
                          const lines = bgPromptsText.split("\n").filter((l) => l.trim());
                          updateSelectedConfig({ backgroundPrompts: lines.length > 0 ? lines : undefined });
                        }}
                        rows={3}
                        placeholder="e.g. A dark moody bookshelf with candlelight"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <div className="mt-2 space-y-2">
                        <p className="text-[11px] text-gray-400">Generate a prompt from an image:</p>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={bgImageUrl}
                            onChange={(e) => setBgImageUrl(e.target.value)}
                            placeholder="Paste image URL"
                            className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                          />
                          <button
                            disabled={describingImage || !bgImageUrl.trim()}
                            onClick={async () => {
                              setDescribingImage(true);
                              try {
                                const res = await fetch("/api/describe-image", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ imageUrl: bgImageUrl.trim() }),
                                });
                                const json = await res.json();
                                if (json.prompt) {
                                  const newText = bgPromptsText ? bgPromptsText + "\n" + json.prompt : json.prompt;
                                  setBgPromptsText(newText);
                                  const lines = newText.split("\n").filter((l: string) => l.trim());
                                  updateSelectedConfig({ backgroundPrompts: lines });
                                  setBgImageUrl("");
                                } else {
                                  alert(json.error || "Failed to describe image");
                                }
                              } catch (e) { alert(String(e)); }
                              finally { setDescribingImage(false); }
                            }}
                            className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300 disabled:opacity-50"
                          >
                            {describingImage ? "..." : "Get prompt"}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <label className="rounded-lg bg-gray-200 px-3 py-1.5 text-xs hover:bg-gray-300 cursor-pointer text-center">
                            Upload image
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                setDescribingImage(true);
                                try {
                                  const reader = new FileReader();
                                  const base64 = await new Promise<string>((resolve) => {
                                    reader.onload = () => resolve(reader.result as string);
                                    reader.readAsDataURL(file);
                                  });
                                  const res = await fetch("/api/describe-image", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ imageBase64: base64 }),
                                  });
                                  const json = await res.json();
                                  if (json.prompt) {
                                    const newText = bgPromptsText ? bgPromptsText + "\n" + json.prompt : json.prompt;
                                    setBgPromptsText(newText);
                                    const lines = newText.split("\n").filter((l: string) => l.trim());
                                    updateSelectedConfig({ backgroundPrompts: lines });
                                  } else {
                                    alert(json.error || "Failed to describe image");
                                  }
                                } catch (err) { alert(String(err)); }
                                finally { setDescribingImage(false); e.target.value = ""; }
                              }}
                            />
                          </label>
                          {describingImage && <span className="text-xs text-gray-400">Analyzing image...</span>}
                        </div>
                      </div>
                    </div>

                    {/* Time windows */}
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs text-gray-500">Daily time windows (UTC)</label>
                        <button
                          onClick={() => updateSelectedConfig({ intervals: [...config.intervals, { start: "12:00", end: "14:00" }] })}
                          className="text-xs text-blue-500 hover:text-blue-600"
                        >
                          + Add window
                        </button>
                      </div>
                      <p className="text-[11px] text-gray-400 mb-2">
                        One post is scheduled per window per day, at a random time inside the window.
                      </p>
                      <div className="space-y-2">
                        {config.intervals.map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={w.start}
                              onChange={(e) => {
                                const newIntervals = config.intervals.map((ww, idx) =>
                                  idx === i ? { ...ww, start: e.target.value } : ww
                                );
                                updateSelectedConfig({ intervals: newIntervals });
                              }}
                              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                            />
                            <span className="text-gray-400 text-sm">&rarr;</span>
                            <input
                              type="time"
                              value={w.end}
                              onChange={(e) => {
                                const newIntervals = config.intervals.map((ww, idx) =>
                                  idx === i ? { ...ww, end: e.target.value } : ww
                                );
                                updateSelectedConfig({ intervals: newIntervals });
                              }}
                              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                            />
                            {config.intervals.length > 1 && (
                              <button
                                onClick={() => {
                                  const newIntervals = config.intervals.filter((_, idx) => idx !== i);
                                  updateSelectedConfig({ intervals: newIntervals });
                                }}
                                className="text-xs text-red-500 hover:text-red-600 ml-auto"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    {config.lastPostDate && (
                      <p className="text-[11px] text-gray-400">Last posted: {config.lastPostDate}</p>
                    )}

                    <button
                      onClick={saveTopnAutomation}
                      disabled={savingAuto}
                      className="w-full rounded-xl bg-blue-500 text-white py-2.5 text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 shadow-sm"
                    >
                      {savingAuto ? "Saving..." : "Save"}
                    </button>
                  </div>
                );
              })()}

              {!selectedTopnAccount && allAutoAccounts.length === 0 && (
                <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center text-gray-500">
                  No accounts connected. Connect TikTok, Instagram, or Facebook accounts first.
                </div>
              )}
            </>
          );
        })()}

        {/* BOOK FORM MODAL */}
        {showBookForm && (
          <Modal onClose={() => setShowBookForm(false)} title={editBookId ? "Edit Book" : "Add Book"}>
            <div className="space-y-4">
              {!editBookId && (
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Cover Image URL {fetchingUrl && <span className="text-blue-500 ml-1">Fetching...</span>}</label>
                  <div className="flex gap-2">
                    <input
                      value={bookUrl}
                      onChange={(e) => setBookUrl(e.target.value)}
                      placeholder="Paste image URL (right-click cover → Copy Image Address)"
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchBookUrl(); } }}
                    />
                    <button
                      onClick={fetchBookUrl}
                      disabled={fetchingUrl || !bookUrl.trim()}
                      className="rounded-xl bg-gray-100 hover:bg-gray-200 px-3 py-2 text-sm text-gray-700 transition-colors disabled:opacity-40 shrink-0"
                    >
                      Fetch
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Fetches cover and auto-detects title &amp; author</p>
                  {fetchUrlError && <p className="text-[11px] text-red-500 mt-1">{fetchUrlError}</p>}
                </div>
              )}
              <div>
                <label className="text-xs text-gray-500 block mb-1">Title * {recognizing && <span className="text-blue-500 ml-1">Recognizing...</span>}</label>
                <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Author</label>
                <input value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Genre</label>
                <input value={bookGenre} onChange={(e) => setBookGenre(e.target.value)} placeholder="e.g. Dark Romance, Thriller, Fantasy" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[11px] text-gray-400 mt-1">Separate multiple genres with commas</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Cover Image {!editBookId && "*"}</label>
                <input type="file" accept="image/*" onChange={handleCoverFile} className="text-sm text-gray-500" />
                {bookCoverPreview && (
                  <img src={bookCoverPreview} alt="Cover" className="mt-2 w-24 h-36 rounded object-cover" />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={bookPinned} onChange={(e) => setBookPinned(e.target.checked)} className="accent-blue-500 rounded" />
                Always recommended (pinned)
              </label>
              <button onClick={saveBook} disabled={loading} className="w-full rounded-xl bg-blue-500 text-white py-2.5 text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 shadow-sm">
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          </Modal>
        )}

        {/* LIST FORM MODAL */}
        {showListForm && (
          <Modal onClose={() => setShowListForm(false)} title={editListId ? "Edit List" : "New List"}>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-500 block mb-1">List Name *</label>
                <input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Dark Romance" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Title Slide Texts * (one per line, random pick each publish)</label>
                <textarea value={listTitles} onChange={(e) => setListTitles(e.target.value)} rows={3} placeholder={"Top 10 Dark Romance Books\nDark Romance Must-Reads\nBooks That Will Ruin You"} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Number of books to include</label>
                <input type="number" min={1} value={listCount} onChange={(e) => setListCount(Number(e.target.value))} className="w-24 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Captions (separate each caption with a blank line)</label>
                <textarea value={listCaptions} onChange={(e) => setListCaptions(e.target.value)} rows={5} placeholder={"First caption here with #hashtags\n\nSecond caption variation\n\nThird caption option"} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Background image prompts (one per line, random pick each publish)</label>
                <textarea value={listBgPrompts} onChange={(e) => setListBgPrompts(e.target.value)} rows={3} placeholder={"Dark moody roses and shadows\nMystery bookshelf with candlelight\nGothic castle at night"} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
                <p className="text-[11px] text-gray-400 mt-1">Leave empty for plain dark background</p>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-2">
                  Music tracks for video posts ({listMusicTrackIds.length} selected)
                </label>
                {musicTracks.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {musicTracks.map((t) => {
                      const selected = listMusicTrackIds.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => toggleMusicInList(t.id)}
                          className={`px-3 py-1 rounded-full text-xs transition-colors ${
                            selected
                              ? "bg-purple-50 border-purple-500 text-purple-600 border"
                              : "border border-gray-200 text-gray-500 hover:border-gray-300"
                          }`}
                        >
                          {t.name}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-400 mb-2">No music tracks uploaded yet. Upload tracks in the Music tab.</p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-2">
                  Select books ({listBookIds.length} selected, {books.filter((b) => b.pinned).length} pinned)
                </label>
                <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                  {books.map((b) => {
                    const selected = listBookIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => toggleBookInList(b.id)}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-left text-xs transition-colors ${
                          selected
                            ? "border-blue-500 bg-blue-50 text-gray-900"
                            : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300"
                        }`}
                      >
                        <img src={b.coverData} alt="" className="w-6 h-9 rounded object-cover shrink-0" />
                        <span className="truncate">
                          {b.pinned && "* "}{b.title}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={saveList} className="w-full rounded-xl bg-blue-500 text-white py-2.5 text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm">
                Save
              </button>
            </div>
          </Modal>
        )}

        {/* PUBLISH MODAL */}
        {/* VIDEO GENERATING OVERLAY */}
        {generatingVideoForList && !videoPreviewUrl && (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="animate-spin w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full mb-4" />
            <p className="text-gray-900 text-sm font-medium">Generating video preview...</p>
            <p className="text-gray-500 text-xs mt-1">This can take up to a minute</p>
          </div>
        )}

        {/* VIDEO PREVIEW MODAL */}
        {videoPreviewUrl && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => { URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }}>
            <div className="relative w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
              <video
                src={videoPreviewUrl}
                controls
                autoPlay
                className="w-full rounded-2xl shadow-2xl"
              />
              <button
                onClick={() => { URL.revokeObjectURL(videoPreviewUrl); setVideoPreviewUrl(null); }}
                className="w-full text-xs text-gray-500 hover:text-gray-900 transition-colors py-2 mt-2"
              >
                Close
              </button>
            </div>
          </div>
        )}

        {publishListId && (
          <Modal onClose={() => setPublishListId(null)} title="Publish Top N">
            <div className="space-y-4">
              <div className="space-y-4">
                {accounts.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-2">TikTok accounts</label>
                    <div className="space-y-2">
                      {accounts.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={publishAccounts.includes(a.id)}
                            onChange={() => togglePublishAccount(a.id)}
                            className="accent-blue-500 rounded"
                          />
                          @{a.username}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {igAccounts.length > 0 && (
                  <div>
                    <label className="text-xs text-gray-500 block mb-2">Instagram accounts</label>
                    <div className="space-y-2">
                      {igAccounts.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 text-sm text-gray-700">
                          <input
                            type="checkbox"
                            checked={publishAccounts.includes(a.id)}
                            onChange={() => togglePublishAccount(a.id)}
                            className="accent-blue-500 rounded"
                          />
                          @{a.username}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Schedule (optional)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
                <p className="text-[11px] text-gray-400 mt-1">Leave empty to publish immediately</p>
              </div>
              <button
                onClick={publishList}
                disabled={publishing || publishAccounts.length === 0}
                className="w-full rounded-xl bg-blue-500 hover:bg-blue-600 text-white py-2.5 text-sm font-medium transition-colors disabled:opacity-40 shadow-sm"
              >
                {publishing ? "Publishing..." : scheduledAt ? "Schedule" : "Publish Now"}
              </button>
              {publishResult && (
                <div className={`text-sm p-3 rounded-xl ${publishResult.startsWith("Error") ? "bg-red-50 text-red-600" : "bg-green-50 text-green-600"}`}>
                  {publishResult}
                </div>
              )}
            </div>
          </Modal>
        )}

      </div>
    </div>
  );
}

function BookCard({
  book,
  onEdit,
  onDelete,
  onTogglePin,
}: {
  book: TopBook;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-3 group">
      <img src={book.coverData} alt={book.title} className="w-full aspect-[2/3] rounded-xl object-cover mb-2" />
      <div className="text-sm font-medium truncate text-gray-900">{book.title}</div>
      {book.author && <div className="text-xs text-gray-500 truncate">{book.author}</div>}
      {book.genre && <div className="text-[10px] text-gray-400 truncate">{book.genre}</div>}
      <div className="flex items-center gap-2 mt-2">
        <button onClick={onTogglePin} className={`text-[10px] px-1.5 py-0.5 rounded ${book.pinned ? "bg-amber-50 text-amber-600" : "bg-gray-100 text-gray-500"}`}>
          {book.pinned ? "Pinned" : "Pin"}
        </button>
        <button onClick={onEdit} className="text-[10px] text-gray-500 hover:text-gray-900">Edit</button>
        <button onClick={onDelete} className="text-[10px] text-red-500 hover:text-red-600">Delete</button>
      </div>
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900 text-xl">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
