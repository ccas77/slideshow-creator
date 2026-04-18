"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";

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

  // Import modal
  const [showImport, setShowImport] = useState(false);
  const [importBookId, setImportBookId] = useState("");
  const [importSlideshowId, setImportSlideshowId] = useState("");
  const [truncating, setTruncating] = useState(false);

  // Editor modal
  const [editing, setEditing] = useState<InstagramSlideshow | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeUrl, setAnalyzeUrl] = useState("");

  // Global automation
  const [showAutoModal, setShowAutoModal] = useState(false);
  const [autoConfig, setAutoConfig] = useState<IgGlobalAutomation>({
    enabled: false,
    igAccountIds: [],
    tiktokAccountIds: [],
    intervals: [{ start: "18:00", end: "20:00" }],
    igPointer: 0,
  });

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

  function analyzeUpload() {
    if (!editing) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !editing) return;
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
        setEditing({
          ...editing,
          imagePrompts: [...editing.imagePrompts, newItem],
          imagePromptIds: [...editing.imagePromptIds, newItem.id],
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
    if (!analyzeUrl.trim() || !editing) return;
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
      setEditing({
        ...editing,
        imagePrompts: [...editing.imagePrompts, newItem],
        imagePromptIds: [...editing.imagePromptIds, newItem.id],
      });
      setAnalyzeUrl("");
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to analyze");
    } finally {
      setAnalyzing(false);
    }
  }

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
          body: JSON.stringify({
            action: "truncate",
            slides: slideshow.slideTexts,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed");
        truncatedText = data.text;
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "Failed to truncate"
        );
        setTruncating(false);
        return;
      }
      setTruncating(false);
    }

    // Collect the prompts and captions from the source book
    const prompts = book.imagePrompts.filter((p) =>
      slideshow.imagePromptIds.includes(p.id)
    );
    const captions = book.captions.filter((c) =>
      slideshow.captionIds.includes(c.id)
    );
    // If slideshow had no specific prompts/captions, use the full book pool
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

    setShowImport(false);
    setEditing(newIg);
  }

  function saveEditing() {
    if (!editing) return;
    if (!editing.name.trim()) {
      window.alert("Name required");
      return;
    }
    const lines = editing.slideTexts.split("\n").filter((l) => l.trim());
    if (lines.length > 10) {
      window.alert(`Too many slides (${lines.length}). Maximum is 10.`);
      return;
    }
    const exists = igSlideshows.some((s) => s.id === editing.id);
    const next = exists
      ? igSlideshows.map((s) => (s.id === editing.id ? editing : s))
      : [...igSlideshows, editing];
    persist(next);
    setEditing(null);
  }

  function deleteSlideshow(id: string) {
    if (!window.confirm("Delete this Instagram slideshow?")) return;
    persist(igSlideshows.filter((s) => s.id !== id));
  }

  async function saveAutomation() {
    setSaving(true);
    try {
      await fetch("/api/ig-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: autoConfig }),
      });
    } catch {}
    setSaving(false);
    setShowAutoModal(false);
  }

  const importBook = books.find((b) => b.id === importBookId);

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Instagram</h1>
            <p className="text-sm text-gray-500">
              Short carousels for Instagram + video for TikTok
            </p>
          </div>
          <div className="flex items-center gap-3">
            {saving && (
              <span className="text-xs text-gray-500">Saving…</span>
            )}
            <button
              onClick={() => setShowAutoModal(true)}
              className={`px-4 py-2 rounded-xl font-semibold transition-colors text-sm shadow-sm ${
                autoConfig.enabled
                  ? "bg-green-500 text-white hover:bg-green-600"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {autoConfig.enabled ? "Auto On" : "Automation"}
            </button>
            <button
              onClick={() => {
                setImportBookId("");
                setImportSlideshowId("");
                setShowImport(true);
              }}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
            >
              + Import from TikTok
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : igSlideshows.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center">
            <p className="text-gray-400 mb-2">No Instagram slideshows yet.</p>
            <p className="text-xs text-gray-400">
              Import a TikTok slideshow to get started. Claude will
              automatically select the best slides for Instagram.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {igSlideshows.map((s) => {
              const slideCount = s.slideTexts
                .split("\n")
                .filter((l) => l.trim()).length;
              const sourceBook = books.find((b) => b.id === s.sourceBookId);
              return (
                <div
                  key={s.id}
                  className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-gray-900">
                        {s.name}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {slideCount} slides · {s.imagePrompts.length} prompts ·{" "}
                        {s.captions.length} captions
                        {sourceBook && (
                          <span> · from {sourceBook.name}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0 flex-wrap">
                      <button
                        onClick={() => setEditing({ ...s })}
                        className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
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
          </div>
        )}
      </div>

      {/* Import modal */}
      {showImport && (
        <Modal onClose={() => setShowImport(false)}>
          <h3 className="text-lg font-semibold mb-2 text-gray-900">
            Import from TikTok slideshow
          </h3>
          <p className="text-xs text-gray-500 mb-5">
            Pick a book and slideshow. If it has more than 10 slides, Claude
            will select the best ones for Instagram.
          </p>

          <label className="block text-xs font-medium text-gray-500 mb-1">
            Book
          </label>
          <select
            value={importBookId}
            onChange={(e) => {
              setImportBookId(e.target.value);
              setImportSlideshowId("");
            }}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
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
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Slideshow
              </label>
              <select
                value={importSlideshowId}
                onChange={(e) => setImportSlideshowId(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              >
                <option value="">Select a slideshow…</option>
                {importBook.slideshows.map((s) => {
                  const count = s.slideTexts
                    .split("\n")
                    .filter((l) => l.trim()).length;
                  return (
                    <option key={s.id} value={s.id}>
                      {s.name} ({count} slides
                      {count > 10 ? " → will be truncated" : ""})
                    </option>
                  );
                })}
              </select>
            </>
          )}

          {truncating && (
            <p className="text-sm text-blue-500 mb-3">
              Claude is selecting the best slides…
            </p>
          )}

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowImport(false)}
              className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={importSlideshow}
              disabled={!importBookId || !importSlideshowId || truncating}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm disabled:opacity-40"
            >
              Import
            </button>
          </div>
        </Modal>
      )}

      {/* Editor modal */}
      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <h3 className="text-lg font-semibold mb-4 text-gray-900">
            {igSlideshows.some((s) => s.id === editing.id)
              ? "Edit"
              : "Review"}{" "}
            Instagram slideshow
          </h3>

          <label className="block text-xs font-medium text-gray-500 mb-1">
            Name
          </label>
          <input
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />

          <label className="block text-xs font-medium text-gray-500 mb-1">
            Slides (one per line, max 10)
          </label>
          <textarea
            value={editing.slideTexts}
            onChange={(e) =>
              setEditing({ ...editing, slideTexts: e.target.value })
            }
            rows={12}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-1 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <p className="text-[11px] text-gray-400 mb-4">
            {editing.slideTexts.split("\n").filter((l) => l.trim()).length}{" "}
            / 10 slides
          </p>

          {/* Image prompts */}
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Image prompts ({editing.imagePrompts.length})
          </label>
          <div className="space-y-1 max-h-36 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 mb-2">
            {editing.imagePrompts.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5"
              >
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="truncate font-medium">{p.name}</span>
                  <button
                    onClick={() =>
                      setEditing({
                        ...editing,
                        imagePrompts: editing.imagePrompts.filter(
                          (x) => x.id !== p.id
                        ),
                        imagePromptIds: editing.imagePromptIds.filter(
                          (x) => x !== p.id
                        ),
                      })
                    }
                    className="text-xs text-red-500 hover:text-red-600 ml-auto shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  value={p.value}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      imagePrompts: editing.imagePrompts.map((x) =>
                        x.id === p.id ? { ...x, value: e.target.value } : x
                      ),
                    })
                  }
                  rows={2}
                  className="w-full mt-1 rounded bg-gray-50 border border-gray-200 px-2 py-1 text-xs text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                />
              </div>
            ))}
            {editing.imagePrompts.length === 0 && (
              <p className="text-xs text-gray-400 px-2 py-1">
                No image prompts.
              </p>
            )}
          </div>
          <div className="flex gap-2 mb-2">
            {(() => {
              const sourceBook = books.find((b) => b.id === editing.sourceBookId);
              const available = sourceBook?.imagePrompts.filter(
                (p) => !editing.imagePromptIds.includes(p.id)
              );
              if (available && available.length > 0) {
                return (
                  <select
                    value=""
                    onChange={(e) => {
                      const item = available.find((p) => p.id === e.target.value);
                      if (!item) return;
                      setEditing({
                        ...editing,
                        imagePrompts: [...editing.imagePrompts, item],
                        imagePromptIds: [...editing.imagePromptIds, item.id],
                      });
                    }}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 focus:outline-none"
                  >
                    <option value="">+ Add from book pool…</option>
                    {available.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                );
              }
              return null;
            })()}
            <button
              onClick={() => {
                const newItem = { id: uid(), name: `Prompt ${editing.imagePrompts.length + 1}`, value: "" };
                setEditing({
                  ...editing,
                  imagePrompts: [...editing.imagePrompts, newItem],
                  imagePromptIds: [...editing.imagePromptIds, newItem.id],
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
          <div className="flex gap-2 mb-4">
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
            Captions ({editing.captions.length})
          </label>
          <div className="space-y-1 max-h-36 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 mb-2">
            {editing.captions.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5"
              >
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <span className="truncate font-medium">{c.name}</span>
                  <button
                    onClick={() =>
                      setEditing({
                        ...editing,
                        captions: editing.captions.filter(
                          (x) => x.id !== c.id
                        ),
                        captionIds: editing.captionIds.filter(
                          (x) => x !== c.id
                        ),
                      })
                    }
                    className="text-xs text-red-500 hover:text-red-600 ml-auto shrink-0"
                  >
                    Remove
                  </button>
                </div>
                <textarea
                  value={c.value}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      captions: editing.captions.map((x) =>
                        x.id === c.id ? { ...x, value: e.target.value } : x
                      ),
                    })
                  }
                  rows={2}
                  className="w-full mt-1 rounded bg-gray-50 border border-gray-200 px-2 py-1 text-xs text-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30 resize-none"
                />
              </div>
            ))}
            {editing.captions.length === 0 && (
              <p className="text-xs text-gray-400 px-2 py-1">No captions.</p>
            )}
          </div>
          <div className="flex gap-2 mb-5">
            {(() => {
              const sourceBook = books.find((b) => b.id === editing.sourceBookId);
              const available = sourceBook?.captions.filter(
                (c) => !editing.captionIds.includes(c.id)
              );
              if (available && available.length > 0) {
                return (
                  <select
                    value=""
                    onChange={(e) => {
                      const item = available.find((c) => c.id === e.target.value);
                      if (!item) return;
                      setEditing({
                        ...editing,
                        captions: [...editing.captions, item],
                        captionIds: [...editing.captionIds, item.id],
                      });
                    }}
                    className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-500 focus:outline-none"
                  >
                    <option value="">+ Add from book pool…</option>
                    {available.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                );
              }
              return null;
            })()}
            <button
              onClick={() => {
                const newItem = { id: uid(), name: `Caption ${editing.captions.length + 1}`, value: "" };
                setEditing({
                  ...editing,
                  captions: [...editing.captions, newItem],
                  captionIds: [...editing.captionIds, newItem.id],
                });
              }}
              className="text-xs text-blue-500 hover:text-blue-600"
            >
              + New caption
            </button>
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setEditing(null)}
              className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={saveEditing}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
            >
              Save
            </button>
          </div>
        </Modal>
      )}

      {/* Global automation modal */}
      {showAutoModal && (
        <Modal onClose={() => setShowAutoModal(false)}>
          <h3 className="text-lg font-semibold mb-2 text-gray-900">
            Instagram Automation
          </h3>
          <p className="text-xs text-gray-500 mb-5">
            Round-robins through all slideshows. IG gets one carousel per day.
            Each TikTok account gets a different slideshow as video, no duplicates.
          </p>

          <label className="flex items-center gap-3 mb-5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoConfig.enabled}
              onChange={(e) => setAutoConfig({ ...autoConfig, enabled: e.target.checked })}
              className="accent-blue-500 w-4 h-4"
            />
            <span className="text-sm text-gray-900 font-medium">
              Enable daily automation
            </span>
          </label>

          {/* Queue preview */}
          <label className="block text-xs font-medium text-gray-500 mb-2">
            Slideshow queue ({igSlideshows.length})
          </label>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-2 mb-4 max-h-28 overflow-y-auto">
            {igSlideshows.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-1">No slideshows. Import some first.</p>
            ) : (
              igSlideshows.map((s, i) => (
                <div key={s.id} className="flex items-center gap-2 px-2 py-1 text-sm text-gray-700">
                  <span className={`text-[10px] w-4 text-center ${i === autoConfig.igPointer % igSlideshows.length ? "text-green-500 font-bold" : "text-gray-400"}`}>
                    {i === autoConfig.igPointer % igSlideshows.length ? "→" : (i + 1)}
                  </span>
                  <span className="truncate">{s.name}</span>
                  <span className="text-[10px] text-gray-400 ml-auto">{s.imagePrompts.length}p · {s.captions.length}c</span>
                </div>
              ))
            )}
          </div>

          {/* Instagram accounts */}
          <label className="block text-xs font-medium text-gray-500 mb-2">
            Instagram accounts (carousel)
          </label>
          {igAccounts.length === 0 ? (
            <p className="text-xs text-gray-400 mb-4">
              No Instagram accounts connected in PostBridge.
            </p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 mb-4">
              {igAccounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
                >
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
                  <span className="text-[10px] text-gray-400 ml-auto">IG</span>
                </label>
              ))}
            </div>
          )}

          {/* TikTok accounts */}
          <label className="block text-xs font-medium text-gray-500 mb-2">
            TikTok accounts (video — each gets a different slideshow)
          </label>
          {accounts.length === 0 ? (
            <p className="text-xs text-gray-400 mb-4">
              No TikTok accounts available.
            </p>
          ) : (
            <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 mb-4">
              {accounts.map((a) => (
                <label
                  key={a.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
                >
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
                  <span className="text-[10px] text-gray-400 ml-auto">TT</span>
                </label>
              ))}
            </div>
          )}

          {/* Time windows */}
          <label className="block text-xs font-medium text-gray-500 mb-2">
            Posting windows (UTC)
          </label>
          <div className="space-y-2 mb-2">
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
            className="text-xs text-blue-500 hover:text-blue-600 mb-1"
          >
            + Add window
          </button>
          <p className="text-[11px] text-gray-400 mb-5">
            One post per window per day. IG round-robins through slideshows.
            Each TikTok account gets a different random slideshow per window (no duplicates across accounts).
          </p>

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => setShowAutoModal(false)}
              className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={saveAutomation}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
            >
              Save
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-6 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
