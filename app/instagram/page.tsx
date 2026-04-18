"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

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

interface IgGlobalAutomation {
  enabled: boolean;
  igAccountIds: number[];
  tiktokAccountIds: number[];
  intervals: TimeWindow[];
  igPointer: number;
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
    igAccountIds: [],
    tiktokAccountIds: [],
    intervals: [{ start: "18:00", end: "20:00" }],
    igPointer: 0,
  });
  const [autoSaved, setAutoSaved] = useState(false);

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

  async function importSlideshow() {
    const book = books.find((b) => b.id === importBookId);
    const slideshow = book?.slideshows.find((s) => s.id === importSlideshowId);
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

    setTab("slideshows");
    setEditingId(newIg.id);
    setEditDraft(newIg);
    setImportBookId("");
    setImportSlideshowId("");
  }

  // ── Editor ──

  function startEditing(s: InstagramSlideshow) {
    setEditingId(s.id);
    setEditDraft({ ...s });
    setAnalyzeUrl("");
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
              <div className="space-y-3">
                {igSlideshows.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center">
                    <p className="text-gray-400 mb-2">No Instagram slideshows yet.</p>
                    <p className="text-xs text-gray-400 mb-4">
                      Import a TikTok slideshow to get started.
                    </p>
                    <button
                      onClick={() => setTab("import")}
                      className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
                    >
                      Go to Import
                    </button>
                  </div>
                ) : (
                  igSlideshows.map((s) => {
                    const isEditing = editingId === s.id && editDraft;
                    const slideCount = s.slideTexts.split("\n").filter((l) => l.trim()).length;
                    const sourceBook = books.find((b) => b.id === s.sourceBookId);

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
                              {sourceBook && <span> · from {sourceBook.name}</span>}
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
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
                  })
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
              <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">Import from TikTok</h3>
                <p className="text-xs text-gray-500 mb-6">
                  Pick a book and slideshow. If it has more than 10 slides, Claude will select the best ones for Instagram.
                </p>

                <label className="block text-xs font-medium text-gray-500 mb-1">Book</label>
                <select
                  value={importBookId}
                  onChange={(e) => {
                    setImportBookId(e.target.value);
                    setImportSlideshowId("");
                  }}
                  className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                >
                  <option value="">Select a book…</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.slideshows.length} slideshows)
                    </option>
                  ))}
                </select>

                {importBook && (
                  <>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Slideshow</label>
                    <select
                      value={importSlideshowId}
                      onChange={(e) => setImportSlideshowId(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                    >
                      <option value="">Select a slideshow…</option>
                      {importBook.slideshows.map((s) => {
                        const count = s.slideTexts.split("\n").filter((l) => l.trim()).length;
                        return (
                          <option key={s.id} value={s.id}>
                            {s.name} ({count} slides{count > 10 ? " → will be truncated" : ""})
                          </option>
                        );
                      })}
                    </select>
                  </>
                )}

                {truncating && (
                  <p className="text-sm text-blue-500 mb-4">Claude is selecting the best slides…</p>
                )}

                <button
                  onClick={importSlideshow}
                  disabled={!importBookId || !importSlideshowId || truncating}
                  className="px-5 py-2.5 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm disabled:opacity-40"
                >
                  Import
                </button>
              </div>
            )}

            {/* ═══ Automation Tab ═══ */}
            {tab === "automation" && (
              <div className="space-y-4">
                {/* Enable toggle */}
                <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoConfig.enabled}
                      onChange={(e) => setAutoConfig({ ...autoConfig, enabled: e.target.checked })}
                      className="accent-blue-500 w-4 h-4"
                    />
                    <span className="text-sm font-medium text-gray-900">Enable daily automation</span>
                  </label>
                  <p className="text-xs text-gray-500 mt-2">
                    Round-robins through all slideshows. IG gets one carousel per day.
                    Each TikTok account gets a different slideshow as video, no duplicates.
                  </p>
                </div>

                {/* Queue preview */}
                <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Slideshow Queue ({igSlideshows.length})</h3>
                  {igSlideshows.length === 0 ? (
                    <p className="text-xs text-gray-400">No slideshows. Import some first.</p>
                  ) : (
                    <div className="space-y-1">
                      {igSlideshows.map((s, i) => (
                        <div key={s.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-50">
                          <span className={`text-xs w-5 text-center font-mono ${i === autoConfig.igPointer % igSlideshows.length ? "text-green-500 font-bold" : "text-gray-400"}`}>
                            {i === autoConfig.igPointer % igSlideshows.length ? "→" : (i + 1)}
                          </span>
                          <span className="text-sm text-gray-700 truncate flex-1">{s.name}</span>
                          <span className="text-[10px] text-gray-400">{s.imagePrompts.length} prompts · {s.captions.length} captions</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Accounts */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Instagram Accounts</h3>
                    {igAccounts.length === 0 ? (
                      <p className="text-xs text-gray-400">No IG accounts connected in PostBridge.</p>
                    ) : (
                      <div className="space-y-1">
                        {igAccounts.map((a) => (
                          <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoConfig.igAccountIds.includes(a.id)}
                              onChange={() =>
                                setAutoConfig({
                                  ...autoConfig,
                                  igAccountIds: autoConfig.igAccountIds.includes(a.id)
                                    ? autoConfig.igAccountIds.filter((x) => x !== a.id)
                                    : [...autoConfig.igAccountIds, a.id],
                                })
                              }
                              className="accent-blue-500"
                            />
                            <span className="text-sm text-gray-700">@{a.username}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">TikTok Accounts</h3>
                    <p className="text-[11px] text-gray-400 mb-3">Each gets a different slideshow as video</p>
                    {accounts.length === 0 ? (
                      <p className="text-xs text-gray-400">No TikTok accounts available.</p>
                    ) : (
                      <div className="space-y-1">
                        {accounts.map((a) => (
                          <label key={a.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={autoConfig.tiktokAccountIds.includes(a.id)}
                              onChange={() =>
                                setAutoConfig({
                                  ...autoConfig,
                                  tiktokAccountIds: autoConfig.tiktokAccountIds.includes(a.id)
                                    ? autoConfig.tiktokAccountIds.filter((x) => x !== a.id)
                                    : [...autoConfig.tiktokAccountIds, a.id],
                                })
                              }
                              className="accent-blue-500"
                            />
                            <span className="text-sm text-gray-700">@{a.username}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Time windows */}
                <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-gray-900 mb-3">Posting Windows (UTC)</h3>
                  <div className="space-y-2 mb-3">
                    {autoConfig.intervals.map((w, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="time"
                          value={w.start}
                          onChange={(e) =>
                            setAutoConfig({
                              ...autoConfig,
                              intervals: autoConfig.intervals.map((x, j) =>
                                j === i ? { ...x, start: e.target.value } : x
                              ),
                            })
                          }
                          className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                        <span className="text-xs text-gray-400">→</span>
                        <input
                          type="time"
                          value={w.end}
                          onChange={(e) =>
                            setAutoConfig({
                              ...autoConfig,
                              intervals: autoConfig.intervals.map((x, j) =>
                                j === i ? { ...x, end: e.target.value } : x
                              ),
                            })
                          }
                          className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                        />
                        {autoConfig.intervals.length > 1 && (
                          <button
                            onClick={() =>
                              setAutoConfig({
                                ...autoConfig,
                                intervals: autoConfig.intervals.filter((_, j) => j !== i),
                              })
                            }
                            className="text-xs text-red-500 hover:text-red-600"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() =>
                      setAutoConfig({
                        ...autoConfig,
                        intervals: [...autoConfig.intervals, { start: "12:00", end: "14:00" }],
                      })
                    }
                    className="text-xs text-blue-500 hover:text-blue-600"
                  >
                    + Add window
                  </button>
                  <p className="text-[11px] text-gray-400 mt-2">
                    One post per window per day. IG round-robins through slideshows.
                    Each TikTok account gets a different random slideshow per window.
                  </p>
                </div>

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
            )}
          </>
        )}
      </div>
    </div>
  );
}
