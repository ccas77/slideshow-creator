"use client";

import { useEffect, useState, useCallback } from "react";
import AppHeader from "@/components/AppHeader";

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

interface TopNAutomation {
  enabled: boolean;
  accountIds: number[];
  intervals: TimeWindow[];
}

interface TopNList {
  id: string;
  name: string;
  titleTexts: string[];
  count: number;
  bookIds: string[];
  captions: string[];
  backgroundPrompts: string[];
  automation?: TopNAutomation;
}

interface TikTokAccount {
  id: number;
  username: string;
}

export default function TopBooksPage() {
  const [books, setBooks] = useState<TopBook[]>([]);
  const [lists, setLists] = useState<TopNList[]>([]);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
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

  // Publish
  const [publishListId, setPublishListId] = useState<string | null>(null);
  const [publishAccounts, setPublishAccounts] = useState<number[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");

  // Automation
  const [autoListId, setAutoListId] = useState<string | null>(null);
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoAccounts, setAutoAccounts] = useState<number[]>([]);
  const [autoIntervals, setAutoIntervals] = useState<TimeWindow[]>([
    { start: "18:00", end: "20:00" },
  ]);
  const [savingAuto, setSavingAuto] = useState(false);

  // Active tab
  const [tab, setTab] = useState<"books" | "lists">("books");

  const headers = useCallback(() => {
    return { "Content-Type": "application/json" };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [bRes, lRes, aRes] = await Promise.all([
        fetch(`/api/top-books`),
        fetch(`/api/top-n-lists`),
        fetch(`/api/post-tiktok`),
      ]);
      if (bRes.ok) setBooks((await bRes.json()).books || []);
      if (lRes.ok) setLists((await lRes.json()).lists || []);
      if (aRes.ok) setAccounts((await aRes.json()).accounts || []);
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
    } else {
      setEditListId(null);
      setListName("");
      setListTitles("");
      setListCount(10);
      setListBookIds([]);
      setListCaptions("");
      setListBgPrompts("");
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
          ? { ...l, name: listName, titleTexts: parsedTitles, count: listCount, bookIds: listBookIds, captions: parsedCaptions, backgroundPrompts: parsedBgPrompts }
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

  // ── Publish ──

  async function publishList() {
    if (!publishListId || publishAccounts.length === 0) return;
    setPublishing(true);
    setPublishResult(null);
    try {
      const res = await fetch("/api/top-n-generate", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          listId: publishListId,
          accountIds: publishAccounts,
          ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
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

  // ── Automation ──

  function openAutomation(list: TopNList) {
    setAutoListId(list.id);
    const a = list.automation;
    setAutoEnabled(!!a?.enabled);
    setAutoAccounts(a?.accountIds || []);
    setAutoIntervals(
      a?.intervals && a.intervals.length > 0
        ? a.intervals
        : [{ start: "18:00", end: "20:00" }]
    );
  }

  function toggleAutoAccount(id: number) {
    setAutoAccounts((prev) =>
      prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]
    );
  }

  function updateAutoInterval(i: number, key: "start" | "end", value: string) {
    setAutoIntervals((prev) =>
      prev.map((w, idx) => (idx === i ? { ...w, [key]: value } : w))
    );
  }

  function addAutoInterval() {
    setAutoIntervals((prev) => [...prev, { start: "12:00", end: "14:00" }]);
  }

  function removeAutoInterval(i: number) {
    setAutoIntervals((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function saveAutomation() {
    if (!autoListId) return;
    setSavingAuto(true);
    try {
      const updated = lists.map((l) =>
        l.id === autoListId
          ? {
              ...l,
              automation: {
                enabled: autoEnabled,
                accountIds: autoAccounts,
                intervals: autoIntervals,
              },
            }
          : l
      );
      await fetch(`/api/top-n-lists`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ lists: updated }),
      });
      setAutoListId(null);
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
    <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-white">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Top Books</h1>
          <button onClick={load} className="text-sm text-zinc-500 hover:text-white transition-colors">
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-zinc-900 rounded-lg p-1 w-fit">
          {(["books", "lists"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-md text-sm transition-colors ${
                tab === t ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
              }`}
            >
              {t === "books" ? `Books (${books.length})` : `Lists (${lists.length})`}
            </button>
          ))}
        </div>

        {/* ═══ BOOKS TAB ═══ */}
        {tab === "books" && (
          <>
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              <button
                onClick={() => openBookForm()}
                className="rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-200 transition-colors"
              >
                + Add Book
              </button>
              {genres.length > 1 && (
                <div className="flex gap-1 bg-zinc-900 rounded-lg p-1 flex-wrap">
                  <button
                    onClick={() => setGenreFilter("all")}
                    className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                      genreFilter === "all" ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
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
                        className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                          genreFilter === g ? "bg-zinc-700 text-white" : "text-zinc-400 hover:text-white"
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
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-zinc-500">
                No books yet. Add some to get started.
              </div>
            )}
          </>
        )}

        {/* ═══ LISTS TAB ═══ */}
        {tab === "lists" && (
          <>
            <button
              onClick={() => openListForm()}
              className="mb-6 rounded-lg bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-200 transition-colors"
            >
              + New List
            </button>

            {lists.length === 0 ? (
              <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-10 text-center text-zinc-500">
                No lists yet. Create one to build a Top N slideshow.
              </div>
            ) : (
              <div className="space-y-3">
                {lists.map((l) => {
                  const listBooks = l.bookIds.map((id) => books.find((b) => b.id === id)).filter(Boolean) as TopBook[];
                  const auto = l.automation;
                  const autoOn = !!auto?.enabled && !!auto?.intervals?.length && !!auto?.accountIds?.length;
                  return (
                    <div key={l.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{l.name}</span>
                            {autoOn && (
                              <span className="text-[10px] uppercase tracking-wide bg-green-500/15 text-green-300 px-1.5 py-0.5 rounded">
                                Auto · {auto!.intervals.length}/day · {auto!.accountIds.length} acct
                              </span>
                            )}
                          </div>
                          <div className="text-sm text-zinc-400 mt-1">
                            {(l.titleTexts || []).length} title{(l.titleTexts || []).length !== 1 ? "s" : ""} &middot; {l.count} books from {listBooks.length} in pool
                          </div>
                          {listBooks.length > 0 && (
                            <div className="flex gap-1 mt-2 flex-wrap">
                              {listBooks.slice(0, 8).map((b) => (
                                <img key={b.id} src={b.coverData} alt={b.title} className="w-8 h-12 rounded object-cover" />
                              ))}
                              {listBooks.length > 8 && (
                                <span className="text-xs text-zinc-500 self-center ml-1">+{listBooks.length - 8}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => openAutomation(l)}
                            className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${
                              autoOn
                                ? "bg-green-600 hover:bg-green-500 text-white"
                                : "bg-zinc-700 hover:bg-zinc-600 text-white"
                            }`}
                          >
                            {autoOn ? "Auto on" : "Automate"}
                          </button>
                          <button
                            onClick={() => { setPublishListId(l.id); setPublishAccounts([]); setPublishResult(null); setScheduledAt(""); }}
                            className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg transition-colors"
                          >
                            Publish
                          </button>
                          <button onClick={() => openListForm(l)} className="text-xs text-zinc-400 hover:text-white transition-colors">
                            Edit
                          </button>
                          <button onClick={() => deleteList(l.id)} className="text-xs text-red-400 hover:text-red-300 transition-colors">
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

        {/* ═══ BOOK FORM MODAL ═══ */}
        {showBookForm && (
          <Modal onClose={() => setShowBookForm(false)} title={editBookId ? "Edit Book" : "Add Book"}>
            <div className="space-y-4">
              {!editBookId && (
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Cover Image URL {fetchingUrl && <span className="text-blue-400 ml-1">Fetching...</span>}</label>
                  <div className="flex gap-2">
                    <input
                      value={bookUrl}
                      onChange={(e) => setBookUrl(e.target.value)}
                      placeholder="Paste image URL (right-click cover → Copy Image Address)"
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchBookUrl(); } }}
                    />
                    <button
                      onClick={fetchBookUrl}
                      disabled={fetchingUrl || !bookUrl.trim()}
                      className="rounded-lg bg-zinc-700 hover:bg-zinc-600 px-3 py-2 text-sm text-white transition-colors disabled:opacity-50 shrink-0"
                    >
                      Fetch
                    </button>
                  </div>
                  <p className="text-[11px] text-zinc-600 mt-1">Fetches cover and auto-detects title &amp; author</p>
                  {fetchUrlError && <p className="text-[11px] text-red-400 mt-1">{fetchUrlError}</p>}
                </div>
              )}
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Title * {recognizing && <span className="text-blue-400 ml-1">Recognizing...</span>}</label>
                <input value={bookTitle} onChange={(e) => setBookTitle(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Author</label>
                <input value={bookAuthor} onChange={(e) => setBookAuthor(e.target.value)} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Genre</label>
                <input value={bookGenre} onChange={(e) => setBookGenre(e.target.value)} placeholder="e.g. Dark Romance, Thriller, Fantasy" className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
                <p className="text-[11px] text-zinc-600 mt-1">Separate multiple genres with commas</p>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Cover Image {!editBookId && "*"}</label>
                <input type="file" accept="image/*" onChange={handleCoverFile} className="text-sm text-zinc-400" />
                {bookCoverPreview && (
                  <img src={bookCoverPreview} alt="Cover" className="mt-2 w-24 h-36 rounded object-cover" />
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={bookPinned} onChange={(e) => setBookPinned(e.target.checked)} className="rounded" />
                Always recommended (pinned)
              </label>
              <button onClick={saveBook} disabled={loading} className="w-full rounded-lg bg-white text-black py-2 text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50">
                {loading ? "Saving..." : "Save"}
              </button>
            </div>
          </Modal>
        )}

        {/* ═══ LIST FORM MODAL ═══ */}
        {showListForm && (
          <Modal onClose={() => setShowListForm(false)} title={editListId ? "Edit List" : "New List"}>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">List Name *</label>
                <input value={listName} onChange={(e) => setListName(e.target.value)} placeholder="e.g. Dark Romance" className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Title Slide Texts * (one per line, random pick each publish)</label>
                <textarea value={listTitles} onChange={(e) => setListTitles(e.target.value)} rows={3} placeholder={"Top 10 Dark Romance Books\nDark Romance Must-Reads\nBooks That Will Ruin You"} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Number of books to include</label>
                <input type="number" min={1} value={listCount} onChange={(e) => setListCount(Number(e.target.value))} className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Captions (separate each caption with a blank line)</label>
                <textarea value={listCaptions} onChange={(e) => setListCaptions(e.target.value)} rows={5} placeholder={"First caption here with #hashtags\n\nSecond caption variation\n\nThird caption option"} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Background image prompts (one per line, random pick each publish)</label>
                <textarea value={listBgPrompts} onChange={(e) => setListBgPrompts(e.target.value)} rows={3} placeholder={"Dark moody roses and shadows\nMystery bookshelf with candlelight\nGothic castle at night"} className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20" />
                <p className="text-[11px] text-zinc-600 mt-1">Leave empty for plain dark background</p>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-2">
                  Select books ({listBookIds.length} selected, {books.filter((b) => b.pinned).length} pinned)
                </label>
                <div className="grid grid-cols-3 gap-2 max-h-60 overflow-y-auto">
                  {books.map((b) => {
                    const selected = listBookIds.includes(b.id);
                    return (
                      <button
                        key={b.id}
                        onClick={() => toggleBookInList(b.id)}
                        className={`flex items-center gap-2 p-2 rounded-lg border text-left text-xs transition-colors ${
                          selected
                            ? "border-blue-500 bg-blue-500/10 text-white"
                            : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600"
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
              <button onClick={saveList} className="w-full rounded-lg bg-white text-black py-2 text-sm font-medium hover:bg-zinc-200 transition-colors">
                Save
              </button>
            </div>
          </Modal>
        )}

        {/* ═══ PUBLISH MODAL ═══ */}
        {publishListId && (
          <Modal onClose={() => setPublishListId(null)} title="Publish to TikTok">
            <div className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-2">Select accounts</label>
                <div className="space-y-2">
                  {accounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={publishAccounts.includes(a.id)}
                        onChange={() => togglePublishAccount(a.id)}
                        className="rounded"
                      />
                      @{a.username}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Schedule (optional)</label>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                />
                <p className="text-[11px] text-zinc-600 mt-1">Leave empty to publish immediately</p>
              </div>
              <button
                onClick={publishList}
                disabled={publishing || publishAccounts.length === 0}
                className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white py-2 text-sm font-medium transition-colors disabled:opacity-50"
              >
                {publishing ? "Publishing..." : scheduledAt ? "Schedule" : "Publish Now"}
              </button>
              {publishResult && (
                <div className={`text-sm p-3 rounded-lg ${publishResult.startsWith("Error") ? "bg-red-500/10 text-red-300" : "bg-green-500/10 text-green-300"}`}>
                  {publishResult}
                </div>
              )}
            </div>
          </Modal>
        )}

        {/* ═══ AUTOMATION MODAL ═══ */}
        {autoListId && (
          <Modal onClose={() => setAutoListId(null)} title="Automate this list">
            <div className="space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoEnabled}
                  onChange={(e) => setAutoEnabled(e.target.checked)}
                  className="rounded"
                />
                Enable auto-posting
              </label>

              <div>
                <label className="text-xs text-zinc-400 block mb-2">Post to accounts</label>
                <div className="space-y-2">
                  {accounts.length === 0 && (
                    <p className="text-xs text-zinc-500">No accounts available. Configure them in Settings.</p>
                  )}
                  {accounts.map((a) => (
                    <label key={a.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={autoAccounts.includes(a.id)}
                        onChange={() => toggleAutoAccount(a.id)}
                        className="rounded"
                      />
                      @{a.username}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-zinc-400">Daily time windows (UTC)</label>
                  <button
                    onClick={addAutoInterval}
                    className="text-xs text-blue-400 hover:text-blue-300"
                  >
                    + Add window
                  </button>
                </div>
                <p className="text-[11px] text-zinc-600 mb-2">
                  One post is scheduled per window per day, at a random time inside the window.
                </p>
                <div className="space-y-2">
                  {autoIntervals.map((w, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={w.start}
                        onChange={(e) => updateAutoInterval(i, "start", e.target.value)}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                      />
                      <span className="text-zinc-500 text-sm">→</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={(e) => updateAutoInterval(i, "end", e.target.value)}
                        className="rounded-lg border border-zinc-700 bg-zinc-800 px-2 py-1.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                      />
                      {autoIntervals.length > 1 && (
                        <button
                          onClick={() => removeAutoInterval(i)}
                          className="text-xs text-red-400 hover:text-red-300 ml-auto"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <button
                onClick={saveAutomation}
                disabled={savingAuto}
                className="w-full rounded-lg bg-white text-black py-2 text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {savingAuto ? "Saving..." : "Save automation"}
              </button>
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
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 group">
      <img src={book.coverData} alt={book.title} className="w-full aspect-[2/3] rounded-lg object-cover mb-2" />
      <div className="text-sm font-medium truncate">{book.title}</div>
      {book.author && <div className="text-xs text-zinc-500 truncate">{book.author}</div>}
      {book.genre && <div className="text-[10px] text-zinc-600 truncate">{book.genre}</div>}
      <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onTogglePin} className={`text-[10px] px-1.5 py-0.5 rounded ${book.pinned ? "bg-amber-500/20 text-amber-300" : "bg-zinc-700 text-zinc-400"}`}>
          {book.pinned ? "Pinned" : "Pin"}
        </button>
        <button onClick={onEdit} className="text-[10px] text-zinc-400 hover:text-white">Edit</button>
        <button onClick={onDelete} className="text-[10px] text-red-400 hover:text-red-300">Delete</button>
      </div>
    </div>
  );
}

function Modal({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl">&times;</button>
        </div>
        {children}
      </div>
    </div>
  );
}
