"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";
import SlidePreview from "@/components/SlidePreview";

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

interface TimeWindow {
  start: string;
  end: string;
}

interface InstagramSlideshow {
  id: string;
  name: string;
  sourceBookId?: string;
  sourceSlideshowId?: string;
  slideTexts: string;
  imagePromptIds: string[];
  captionIds: string[];
  imagePrompts: NamedItem[];
  captions: NamedItem[];
}

interface IgAccountConfig {
  enabled: boolean;
  intervals: TimeWindow[];
  bookIds: string[];
  slideshowIds: string[];
  pointer: number;
}

interface IgGlobalAutomation {
  enabled: boolean;
  accounts: Record<string, IgAccountConfig>;
  igAccountIds?: number[];
  tiktokAccountIds?: number[];
  intervals?: TimeWindow[];
  igPointer?: number;
  accountBookIds?: Record<string, string[]>;
}

interface TikTokAccount {
  id: number;
  username: string;
  platform?: string;
}

type Tab = "slideshows" | "import" | "automation";

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function InstagramPage() {
  const [igSlideshows, setIgSlideshows] = useState<InstagramSlideshow[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [igAccounts, setIgAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>("slideshows");

  // Import
  const [importBookId, setImportBookId] = useState("");
  const [importSlideshowId, setImportSlideshowId] = useState("");
  const [truncating, setTruncating] = useState(false);

  // Editor (inline on slideshows tab)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<InstagramSlideshow | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeUrl, setAnalyzeUrl] = useState("");

  // Automation
  const [autoConfig, setAutoConfig] = useState<IgGlobalAutomation>({
    enabled: false,
    accounts: {},
  });
  const [selectedAutoAccount, setSelectedAutoAccount] = useState<string>("");
  const [autoSaved, setAutoSaved] = useState(false);
  const [previewSlideshow, setPreviewSlideshow] = useState<InstagramSlideshow | null>(null);
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(new Set());

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [igRes, booksRes, ttRes, igAccRes, autoRes] = await Promise.all([
        fetch("/api/ig-slideshows"),
        fetch("/api/books"),
        fetch("/api/post-tiktok"),
        fetch("/api/post-tiktok?platform=instagram"),
        fetch("/api/ig-automation"),
      ]);
      if (igRes.ok) setIgSlideshows((await igRes.json()).slideshows || []);
      if (booksRes.ok) setBooks((await booksRes.json()).books || []);
      if (ttRes.ok) setAccounts((await ttRes.json()).accounts || []);
      if (igAccRes.ok) setIgAccounts((await igAccRes.json()).accounts || []);
      if (autoRes.ok) setAutoConfig((await autoRes.json()).config);
    } catch (e) {
      console.error("Load error:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const persist = useCallback(async (next: InstagramSlideshow[]) => {
    setSaving(true);
    setIgSlideshows(next);
    try {
      await fetch("/api/ig-slideshows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slideshows: next }),
      });
    } catch {}
    setSaving(false);
  }, []);

  // ── Import ──

  async function importSlideshow(bookIdOverride?: string, slideshowIdOverride?: string, bulk?: boolean): Promise<InstagramSlideshow | undefined> {
    const bId = bookIdOverride || importBookId;
    const sId = slideshowIdOverride || importSlideshowId;
    const book = books.find((b) => b.id === bId);
    const slideshow = book?.slideshows.find((s) => s.id === sId);
    if (!book || !slideshow) return;

    const lines = slideshow.slideTexts.split("\n").filter((l) => l.trim());
    let truncatedText: string;

    if (lines.length <= 10) {
      truncatedText = slideshow.slideTexts;
    } else {
      setTruncating(true);
      try {
        const res = await fetch("/api/generate-slides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "truncate", slides: slideshow.slideTexts }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        truncatedText = data.text;
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Failed to truncate");
        setTruncating(false);
        return;
      }
      setTruncating(false);
    }

    const prompts = book.imagePrompts.filter((p) => slideshow.imagePromptIds.includes(p.id));
    const captions = book.captions.filter((c) => slideshow.captionIds.includes(c.id));
    const finalPrompts = prompts.length > 0 ? prompts : book.imagePrompts;
    const finalCaptions = captions.length > 0 ? captions : book.captions;

    const newIg: InstagramSlideshow = {
      id: uid(),
      name: `${slideshow.name} (IG)`,
      sourceBookId: book.id,
      sourceSlideshowId: slideshow.id,
      slideTexts: truncatedText,
      imagePromptIds: finalPrompts.map((p) => p.id),
      captionIds: finalCaptions.map((c) => c.id),
      imagePrompts: finalPrompts,
      captions: finalCaptions,
    };

    if (bulk) {
      // In bulk mode, return the new slideshow for the caller to accumulate
      return newIg;
    } else {
      setTab("slideshows");
      setEditingId(newIg.id);
      setEditDraft(newIg);
    }
    setImportBookId("");
    setImportSlideshowId("");
  }

  // ── Editor ──

  function startEditing(s: InstagramSlideshow) {
    setEditingId(s.id);
    setEditDraft({ ...s });
    setAnalyzeUrl("");
    if (s.sourceBookId) {
      setExpandedBooks((prev) => new Set(prev).add(s.sourceBookId!));
    }
  }

  function cancelEditing() {
    setEditingId(null);
    setEditDraft(null);
  }

  function saveEditing() {
    if (!editDraft) return;
    if (!editDraft.name.trim()) {
      window.alert("Name required");
      return;
    }
    const lines = editDraft.slideTexts.split("\n").filter((l) => l.trim());
    if (lines.length > 10) {
      window.alert(`Too many slides (${lines.length}). Maximum is 10.`);
      return;
    }
    const exists = igSlideshows.some((s) => s.id === editDraft.id);
    const next = exists
      ? igSlideshows.map((s) => (s.id === editDraft.id ? editDraft : s))
      : [...igSlideshows, editDraft];
    persist(next);
    setEditingId(null);
    setEditDraft(null);
  }

  function deleteSlideshow(id: string) {
    if (!window.confirm("Delete this Instagram slideshow?")) return;
    if (editingId === id) cancelEditing();
    persist(igSlideshows.filter((s) => s.id !== id));
  }

  function analyzeUpload() {
    if (!editDraft) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !editDraft) return;
      setAnalyzing(true);
      try {
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        const res = await fetch("/api/analyze-slide", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageData: dataUrl }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        const newItem = { id: uid(), name: file.name.replace(/\.[^.]+$/, ""), value: data.prompt };
        setEditDraft({
          ...editDraft,
          imagePrompts: [...editDraft.imagePrompts, newItem],
          imagePromptIds: [...editDraft.imagePromptIds, newItem.id],
        });
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Failed to analyze");
      } finally {
        setAnalyzing(false);
      }
    };
    input.click();
  }

  async function analyzeFromUrl() {
    if (!analyzeUrl.trim() || !editDraft) return;
    setAnalyzing(true);
    try {
      const res = await fetch("/api/analyze-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: analyzeUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const newItem = { id: uid(), name: "From URL", value: data.prompt };
      setEditDraft({
        ...editDraft,
        imagePrompts: [...editDraft.imagePrompts, newItem],
        imagePromptIds: [...editDraft.imagePromptIds, newItem.id],
      });
      setAnalyzeUrl("");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setAnalyzing(false);
    }
  }

  // ── Automation ──

  async function saveAutomation() {
    setSaving(true);
    try {
      await fetch("/api/ig-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: autoConfig }),
      });
      setAutoSaved(true);
      setTimeout(() => setAutoSaved(false), 2000);
    } catch {}
    setSaving(false);
  }

  const importBook = books.find((b) => b.id === importBookId);

  const tabs: { key: Tab; label: string }[] = [
    { key: "slideshows", label: `Slideshows (${igSlideshows.length})` },
    { key: "import", label: "Import" },
    { key: "automation", label: autoConfig.enabled ? "Automation (On)" : "Automation" },
  ];

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Instagram</strong> — manage Instagram carousels adapted from your TikTok slideshows.</p>
          <p>The <strong>Slideshows</strong> tab shows your IG slideshows. Each has its own slide texts, image prompts, and captions. Click Edit to modify inline.</p>
          <p>The <strong>Import</strong> tab lets you pull slideshows from your books and adapt them for Instagram (max 10 slides).</p>
          <p>The <strong>Automation</strong> tab sets up daily posting — IG gets one carousel per day (round-robin through your slideshows), and each selected TikTok account gets a different slideshow as a video. Every post gets a fresh AI-generated image.</p>
        </HowItWorks>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">Instagram</h1>
          <p className="text-sm text-gray-500">
            Short carousels for Instagram + video for TikTok
          </p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-6 border-b border-gray-200">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                tab === t.key
                  ? "text-gray-900"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              {t.label}
              {tab === t.key && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-full" />
              )}
            </button>
          ))}
          {saving && (
            <span className="ml-auto text-xs text-gray-400 self-center">Saving…</span>
          )}
        </div>

        {loading ? (
          <p className="text-gray-400">Loading…</p>
        ) : (
          <>
            {/* ═══ Slideshows Tab ═══ */}
            {tab === "slideshows" && (
              <div className="space-y-6">
                {igSlideshows.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center">
                    <p className="text-gray-400 mb-2">No Instagram slideshows yet.</p>
                    <p className="text-xs text-gray-400 mb-4">
                      Import slideshows from your books to get started.
                    </p>
                    <button
                      onClick={() => setTab("import")}
                      className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
                    >
                      Go to Import
                    </button>
                  </div>
                ) : (
                  (() => {
                    // Group slideshows by sourceBookId
                    const groups = new Map<string, InstagramSlideshow[]>();
                    for (const s of igSlideshows) {
                      const key = s.sourceBookId || "__none__";
                      if (!groups.has(key)) groups.set(key, []);
                      groups.get(key)!.push(s);
                    }
                    // Sort: books with names first, then unlinked
                    const sortedKeys = [...groups.keys()].sort((a, b) => {
                      if (a === "__none__") return 1;
                      if (b === "__none__") return -1;
                      const nameA = books.find((bk) => bk.id === a)?.name || "";
                      const nameB = books.find((bk) => bk.id === b)?.name || "";
                      return nameA.localeCompare(nameB);
                    });
                    return sortedKeys.map((bookId) => {
                      const group = groups.get(bookId)!;
                      const sourceBook = bookId !== "__none__" ? books.find((b) => b.id === bookId) : null;
                      const isExpanded = expandedBooks.has(bookId);
                      return (
                        <div key={bookId} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
                          <button
                            onClick={() => {
                              setExpandedBooks((prev) => {
                                const next = new Set(prev);
                                if (next.has(bookId)) next.delete(bookId);
                                else next.add(bookId);
                                return next;
                              });
                            }}
                            className="w-full flex items-center gap-2 px-5 py-3.5 text-left hover:bg-gray-50 transition-colors"
                          >
                            <span className="text-xs text-gray-400 transition-transform" style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
                            <h3 className="text-sm font-semibold text-gray-900 flex-1">
                              {sourceBook ? sourceBook.name : "Other"}
                            </h3>
                            <span className="text-xs text-gray-400">{group.length} slideshow{group.length !== 1 ? "s" : ""}</span>
                          </button>
                          {isExpanded && <div className="space-y-3 px-5 pb-5">
                  {group.map((s) => {
                    const isEditing = editingId === s.id && editDraft;
                    const slideCount = s.slideTexts.split("\n").filter((l) => l.trim()).length;

                    if (isEditing && editDraft) {
                      return (
                        <div key={s.id} className="bg-white rounded-2xl border border-blue-200 shadow-sm p-6">
                          <div className="flex items-center justify-between mb-4">
                            <h3 className="text-sm font-semibold text-gray-900">Editing slideshow</h3>
                            <div className="flex gap-2">
                              <button onClick={cancelEditing} className="text-xs text-gray-400 hover:text-gray-700">Cancel</button>
                              <button onClick={saveEditing} className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg font-semibold hover:bg-blue-600 shadow-sm">Save</button>
                            </div>
                          </div>

                          <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                          <input
                            value={editDraft.name}
                            onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                          />

                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Slides (one per line, max 10)
                          </label>
                          <textarea
                            value={editDraft.slideTexts}
                            onChange={(e) => setEditDraft({ ...editDraft, slideTexts: e.target.value })}
                            rows={10}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm mb-1 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                          />
                          <p className="text-[11px] text-gray-400 mb-5">
                            {editDraft.slideTexts.split("\n").filter((l) => l.trim()).length} / 10 slides
                          </p>

                          {/* Image prompts */}
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Image prompts ({editDraft.imagePrompts.length})
                          </label>
                          <div className="space-y-2 mb-2">
                            {editDraft.imagePrompts.map((p) => (
                              <div key={p.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                                <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                                  <span className="truncate font-medium">{p.name}</span>
                                  <button
                                    onClick={() => setEditDraft({
                                      ...editDraft,
                                      imagePrompts: editDraft.imagePrompts.filter((x) => x.id !== p.id),
                                      imagePromptIds: editDraft.imagePromptIds.filter((x) => x !== p.id),
                                    })}
                                    className="text-xs text-red-500 hover:text-red-600 ml-auto shrink-0"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <textarea
                                  value={p.value}
                                  onChange={(e) => setEditDraft({
                                    ...editDraft,
                                    imagePrompts: editDraft.imagePrompts.map((x) =>
                                      x.id === p.id ? { ...x, value: e.target.value } : x
                                    ),
                                  })}
                                  rows={3}
                                  className="w-full rounded-lg bg-white border border-gray-200 px-2 py-1.5 text-xs text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                                />
                              </div>
                            ))}
                            {editDraft.imagePrompts.length === 0 && (
                              <p className="text-xs text-gray-400">No image prompts.</p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2 mb-2">
                            {(() => {
                              const srcBook = books.find((b) => b.id === editDraft.sourceBookId);
                              const available = srcBook?.imagePrompts.filter((p) => !editDraft.imagePromptIds.includes(p.id));
                              if (available && available.length > 0) {
                                return (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const item = available.find((p) => p.id === e.target.value);
                                      if (!item) return;
                                      setEditDraft({
                                        ...editDraft,
                                        imagePrompts: [...editDraft.imagePrompts, item],
                                        imagePromptIds: [...editDraft.imagePromptIds, item.id],
                                      });
                                    }}
                                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 focus:outline-none"
                                  >
                                    <option value="">+ Add from book pool…</option>
                                    {available.map((p) => (
                                      <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                  </select>
                                );
                              }
                              return null;
                            })()}
                            <button
                              onClick={() => {
                                const newItem = { id: uid(), name: `Prompt ${editDraft.imagePrompts.length + 1}`, value: "" };
                                setEditDraft({
                                  ...editDraft,
                                  imagePrompts: [...editDraft.imagePrompts, newItem],
                                  imagePromptIds: [...editDraft.imagePromptIds, newItem.id],
                                });
                              }}
                              className="text-xs text-blue-500 hover:text-blue-600"
                            >
                              + New prompt
                            </button>
                            <button
                              onClick={analyzeUpload}
                              disabled={analyzing}
                              className="text-xs text-purple-500 hover:text-purple-600 disabled:opacity-40"
                            >
                              {analyzing ? "Analyzing…" : "Analyze image"}
                            </button>
                          </div>
                          <div className="flex gap-2 mb-5">
                            <input
                              value={analyzeUrl}
                              onChange={(e) => setAnalyzeUrl(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") analyzeFromUrl(); }}
                              placeholder="Paste image URL and press Enter…"
                              className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                            />
                            <button
                              onClick={analyzeFromUrl}
                              disabled={!analyzeUrl.trim() || analyzing}
                              className="text-xs text-purple-500 hover:text-purple-600 disabled:opacity-40 shrink-0"
                            >
                              Extract
                            </button>
                          </div>

                          {/* Captions */}
                          <label className="block text-xs font-medium text-gray-500 mb-1">
                            Captions ({editDraft.captions.length})
                          </label>
                          <div className="space-y-2 mb-2">
                            {editDraft.captions.map((c) => (
                              <div key={c.id} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
                                <div className="flex items-center gap-2 text-sm text-gray-700 mb-1">
                                  <span className="truncate font-medium">{c.name}</span>
                                  <button
                                    onClick={() => setEditDraft({
                                      ...editDraft,
                                      captions: editDraft.captions.filter((x) => x.id !== c.id),
                                      captionIds: editDraft.captionIds.filter((x) => x !== c.id),
                                    })}
                                    className="text-xs text-red-500 hover:text-red-600 ml-auto shrink-0"
                                  >
                                    Remove
                                  </button>
                                </div>
                                <textarea
                                  value={c.value}
                                  onChange={(e) => setEditDraft({
                                    ...editDraft,
                                    captions: editDraft.captions.map((x) =>
                                      x.id === c.id ? { ...x, value: e.target.value } : x
                                    ),
                                  })}
                                  rows={3}
                                  className="w-full rounded-lg bg-white border border-gray-200 px-2 py-1.5 text-xs text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                                />
                              </div>
                            ))}
                            {editDraft.captions.length === 0 && (
                              <p className="text-xs text-gray-400">No captions.</p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {(() => {
                              const srcBook = books.find((b) => b.id === editDraft.sourceBookId);
                              const available = srcBook?.captions.filter((c) => !editDraft.captionIds.includes(c.id));
                              if (available && available.length > 0) {
                                return (
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const item = available.find((c) => c.id === e.target.value);
                                      if (!item) return;
                                      setEditDraft({
                                        ...editDraft,
                                        captions: [...editDraft.captions, item],
                                        captionIds: [...editDraft.captionIds, item.id],
                                      });
                                    }}
                                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 focus:outline-none"
                                  >
                                    <option value="">+ Add from book pool…</option>
                                    {available.map((c) => (
                                      <option key={c.id} value={c.id}>{c.name}</option>
                                    ))}
                                  </select>
                                );
                              }
                              return null;
                            })()}
                            <button
                              onClick={() => {
                                const newItem = { id: uid(), name: `Caption ${editDraft.captions.length + 1}`, value: "" };
                                setEditDraft({
                                  ...editDraft,
                                  captions: [...editDraft.captions, newItem],
                                  captionIds: [...editDraft.captionIds, newItem.id],
                                });
                              }}
                              className="text-xs text-blue-500 hover:text-blue-600"
                            >
                              + New caption
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div key={s.id} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm text-gray-900">{s.name}</div>
                            <div className="text-xs text-gray-500 mt-0.5">
                              {slideCount} slides · {s.imagePrompts.length} prompts · {s.captions.length} captions
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button
                              onClick={() => setPreviewSlideshow(s)}
                              className="text-xs text-blue-500 hover:text-blue-600 transition-colors"
                            >
                              Preview
                            </button>
                            <button
                              onClick={() => startEditing(s)}
                              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteSlideshow(s.id)}
                              className="text-xs text-red-500 hover:text-red-600 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                          </div>}
                        </div>
                      );
                    });
                  })()
                )}

                {/* New slideshow being reviewed (from import) */}
                {editingId && editDraft && !igSlideshows.some((s) => s.id === editingId) && (
                  <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-semibold text-gray-900">Review imported slideshow</h3>
                      <div className="flex gap-2">
                        <button onClick={cancelEditing} className="text-xs text-gray-400 hover:text-gray-700">Discard</button>
                        <button onClick={saveEditing} className="text-xs bg-blue-500 text-white px-3 py-1 rounded-lg font-semibold hover:bg-blue-600 shadow-sm">Save</button>
                      </div>
                    </div>

                    <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                    <input
                      value={editDraft.name}
                      onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />

                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Slides (one per line, max 10)
                    </label>
                    <textarea
                      value={editDraft.slideTexts}
                      onChange={(e) => setEditDraft({ ...editDraft, slideTexts: e.target.value })}
                      rows={10}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-gray-900 text-sm mb-1 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    />
                    <p className="text-[11px] text-gray-400 mb-4">
                      {editDraft.slideTexts.split("\n").filter((l) => l.trim()).length} / 10 slides
                    </p>

                    <p className="text-xs text-gray-500">
                      {editDraft.imagePrompts.length} image prompts · {editDraft.captions.length} captions imported from book
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ═══ Import Tab ═══ */}
            {tab === "import" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-500">
                  Import slideshows from your books. Slideshows with more than 10 slides will be truncated by Claude. Already-imported slideshows are grayed out.
                </p>

                {truncating && (
                  <div className="bg-blue-50 rounded-2xl border border-blue-200 p-4 text-sm text-blue-600">
                    Claude is selecting the best slides for Instagram…
                  </div>
                )}

                {books.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center text-gray-400">
                    No books yet. Create a book first.
                  </div>
                ) : (
                  books.map((book) => {
                    const importedSlideshowIds = new Set(
                      igSlideshows
                        .filter((s) => s.sourceBookId === book.id && s.sourceSlideshowId)
                        .map((s) => s.sourceSlideshowId!)
                    );
                    const newSlideshows = book.slideshows.filter((s) => !importedSlideshowIds.has(s.id));
                    const importExpanded = expandedBooks.has(`import:${book.id}`);

                    return (
                      <div key={book.id} className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
                        <div className="flex items-center gap-2 px-5 py-3.5">
                          <button
                            onClick={() => {
                              setExpandedBooks((prev) => {
                                const next = new Set(prev);
                                const key = `import:${book.id}`;
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              });
                            }}
                            className="flex items-center gap-2 flex-1 text-left"
                          >
                            <span className="text-xs text-gray-400 transition-transform" style={{ transform: importExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>&#9654;</span>
                            <h3 className="text-sm font-semibold text-gray-900">{book.name}</h3>
                            <span className="text-xs text-gray-400">
                              {book.slideshows.length} slideshow{book.slideshows.length !== 1 ? "s" : ""} · {importedSlideshowIds.size} imported · {newSlideshows.length} new
                            </span>
                          </button>
                          {newSlideshows.length > 0 && (
                            <button
                              onClick={async () => {
                                const imported: InstagramSlideshow[] = [];
                                for (const ss of newSlideshows) {
                                  const result = await importSlideshow(book.id, ss.id, true);
                                  if (result) imported.push(result);
                                }
                                if (imported.length > 0) {
                                  await persist([...igSlideshows, ...imported]);
                                }
                              }}
                              disabled={truncating}
                              className="text-xs bg-blue-500 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-40 shrink-0"
                            >
                              Import all new ({newSlideshows.length})
                            </button>
                          )}
                        </div>
                        {importExpanded && <div className="space-y-1 px-5 pb-4">
                          {book.slideshows.map((ss) => {
                            const alreadyImported = importedSlideshowIds.has(ss.id);
                            const slideCount = ss.slideTexts.split("\n").filter((l) => l.trim()).length;
                            return (
                              <div
                                key={ss.id}
                                className={`flex items-center justify-between px-3 py-2 rounded-xl ${
                                  alreadyImported ? "bg-gray-50 text-gray-400" : "bg-gray-50 text-gray-700"
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  {alreadyImported && (
                                    <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded shrink-0">imported</span>
                                  )}
                                  <span className="text-sm truncate">{ss.name}</span>
                                  <span className="text-[10px] text-gray-400 shrink-0">
                                    {slideCount} slides{slideCount > 10 ? " → truncate" : ""}
                                  </span>
                                </div>
                                {!alreadyImported && (
                                  <button
                                    onClick={() => importSlideshow(book.id, ss.id)}
                                    disabled={truncating}
                                    className="text-xs text-blue-500 hover:text-blue-600 shrink-0 ml-2 disabled:opacity-40"
                                  >
                                    Import
                                  </button>
                                )}
                              </div>
                            );
                          })}
                        </div>}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* ═══ Automation Tab ═══ */}
            {tab === "automation" && (() => {
              const allAccs = [...igAccounts.map((a) => ({ ...a, platform: "instagram" as const })), ...accounts.map((a) => ({ ...a, platform: "tiktok" as const }))];
              const selConfig = selectedAutoAccount ? autoConfig.accounts[selectedAutoAccount] : null;
              const updateAccConfig = (patch: Partial<IgAccountConfig>) => {
                if (!selectedAutoAccount) return;
                const current = autoConfig.accounts[selectedAutoAccount] || { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], bookIds: [], slideshowIds: [], pointer: 0 };
                setAutoConfig({
                  ...autoConfig,
                  accounts: { ...autoConfig.accounts, [selectedAutoAccount]: { ...current, ...patch } },
                });
              };
              const currentConfig = selConfig || { enabled: false, intervals: [{ start: "18:00", end: "20:00" }], bookIds: [], slideshowIds: [], pointer: 0 };
              const configuredCount = Object.values(autoConfig.accounts).filter((c) => c.enabled).length;

              return (
              <div className="space-y-4">
                {/* Master toggle */}
                <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoConfig.enabled}
                      onChange={(e) => setAutoConfig({ ...autoConfig, enabled: e.target.checked })}
                      className="accent-blue-500 w-4 h-4"
                    />
                    <span className="text-sm font-medium text-gray-900">Enable IG automation</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    {configuredCount} account{configuredCount !== 1 ? "s" : ""} configured. Each account round-robins through its assigned slideshows.
                  </p>
                </div>

                {/* Account selector */}
                <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Configure Account</h3>
                  {allAccs.length === 0 ? (
                    <p className="text-xs text-gray-400">No accounts connected in PostBridge.</p>
                  ) : (
                    <select
                      value={selectedAutoAccount}
                      onChange={(e) => setSelectedAutoAccount(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                    >
                      <option value="">Select an account…</option>
                      {allAccs.map((a) => {
                        const cfg = autoConfig.accounts[String(a.id)];
                        return (
                          <option key={a.id} value={String(a.id)}>
                            @{a.username} ({a.platform}){cfg?.enabled ? " ✓" : ""}
                          </option>
                        );
                      })}
                    </select>
                  )}
                </div>

                {/* Per-account config */}
                {selectedAutoAccount && (
                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6 space-y-5">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={currentConfig.enabled}
                        onChange={(e) => updateAccConfig({ enabled: e.target.checked })}
                        className="accent-blue-500 w-4 h-4"
                      />
                      <span className="text-sm font-medium text-gray-900">Enable for this account</span>
                    </label>

                    {/* Books */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Books</h4>
                      <p className="text-[11px] text-gray-400 mb-2">
                        {currentConfig.bookIds.length === 0 ? "All books (none selected = all)" : `${currentConfig.bookIds.length} selected`}
                      </p>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {books.map((b) => (
                          <label key={b.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={currentConfig.bookIds.includes(b.id)}
                              onChange={() => {
                                const next = currentConfig.bookIds.includes(b.id)
                                  ? currentConfig.bookIds.filter((x) => x !== b.id)
                                  : [...currentConfig.bookIds, b.id];
                                updateAccConfig({ bookIds: next, slideshowIds: [] });
                              }}
                              className="accent-blue-500 w-3.5 h-3.5"
                            />
                            <span className="text-sm text-gray-700">{b.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Slideshows */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Slideshows</h4>
                      {(() => {
                        const pool = currentConfig.bookIds.length > 0
                          ? igSlideshows.filter((s) => s.sourceBookId && currentConfig.bookIds.includes(s.sourceBookId))
                          : igSlideshows;
                        return pool.length === 0 ? (
                          <p className="text-xs text-gray-400">No slideshows available for selected books.</p>
                        ) : (
                          <>
                            <p className="text-[11px] text-gray-400 mb-2">
                              {currentConfig.slideshowIds.length === 0 ? `All ${pool.length} slideshows` : `${currentConfig.slideshowIds.length} of ${pool.length} selected`}
                            </p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                              {pool.map((s) => (
                                <label key={s.id} className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-gray-50 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={currentConfig.slideshowIds.includes(s.id)}
                                    onChange={() => {
                                      const next = currentConfig.slideshowIds.includes(s.id)
                                        ? currentConfig.slideshowIds.filter((x) => x !== s.id)
                                        : [...currentConfig.slideshowIds, s.id];
                                      updateAccConfig({ slideshowIds: next });
                                    }}
                                    className="accent-blue-500 w-3.5 h-3.5"
                                  />
                                  <span className="text-sm text-gray-700 truncate">{s.name}</span>
                                </label>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>

                    {/* Time windows */}
                    <div>
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Posting Windows (UTC)</h4>
                      <div className="space-y-2 mb-3">
                        {currentConfig.intervals.map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="time"
                              value={w.start}
                              onChange={(e) => updateAccConfig({ intervals: currentConfig.intervals.map((x, j) => j === i ? { ...x, start: e.target.value } : x) })}
                              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                            <span className="text-xs text-gray-400">→</span>
                            <input
                              type="time"
                              value={w.end}
                              onChange={(e) => updateAccConfig({ intervals: currentConfig.intervals.map((x, j) => j === i ? { ...x, end: e.target.value } : x) })}
                              className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                            {currentConfig.intervals.length > 1 && (
                              <button
                                onClick={() => updateAccConfig({ intervals: currentConfig.intervals.filter((_, j) => j !== i) })}
                                className="text-xs text-red-500 hover:text-red-600"
                              >
                                Remove
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => updateAccConfig({ intervals: [...currentConfig.intervals, { start: "12:00", end: "14:00" }] })}
                        className="text-xs text-blue-500 hover:text-blue-600"
                      >
                        + Add window
                      </button>
                    </div>
                  </div>
                )}

                {/* Save */}
                <div className="flex items-center gap-3">
                  <button
                    onClick={saveAutomation}
                    className="px-5 py-2.5 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
                  >
                    Save Automation
                  </button>
                  {autoSaved && <span className="text-xs text-green-500">Saved</span>}
                </div>
              </div>
              );
            })()}
          </>
        )}
        {/* Slide Preview Modal */}
        {previewSlideshow && (() => {
          const sourceBook = books.find((b) => b.id === previewSlideshow.sourceBookId);
          const previewSlides = previewSlideshow.slideTexts.split("\n").filter((l) => l.trim());
          const coverImage = sourceBook?.coverImage;
          // Drop last text slide when cover replaces it
          const displaySlides = coverImage && previewSlides.length > 2
            ? previewSlides.slice(0, -1)
            : previewSlides;
          const caption = previewSlideshow.captions[0]?.value;
          return (
            <SlidePreview
              slides={displaySlides}
              caption={caption}
              coverImage={coverImage}
              onClose={() => setPreviewSlideshow(null)}
            />
          );
        })()}
      </div>
    </div>
  );
}
