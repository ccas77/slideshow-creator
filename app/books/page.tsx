"use client";

import { useEffect, useState, useCallback } from "react";
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

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function BooksPage() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [tab, setTab] = useState<"prompts" | "captions" | "slideshows">(
    "slideshows"
  );
  const [editingSlideshow, setEditingSlideshow] = useState<Slideshow | null>(
    null
  );
  const [editingItem, setEditingItem] = useState<{
    kind: "prompts" | "captions";
    item: NamedItem;
  } | null>(null);
  const [bookSearch, setBookSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importName, setImportName] = useState("");
  const [importText, setImportText] = useState("");
  const [analyzingSlide, setAnalyzingSlide] = useState(false);
  const [showAnalyzeModal, setShowAnalyzeModal] = useState(false);
  const [analyzeUrl, setAnalyzeUrl] = useState("");

  const loadBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/books`);
      if (res.ok) {
        setBooks((await res.json()).books || []);
      } else {
        console.error("Books API error:", res.status, await res.text());
      }
    } catch (e) {
      console.error("Books fetch error:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const persist = useCallback(
    async (next: Book[]) => {
      setSaving(true);
      setBooks(next);
      try {
        await fetch("/api/books", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ books: next }),
        });
      } catch {}
      setSaving(false);
    },
    []
  );

  function updateBook(id: string, updater: (b: Book) => Book) {
    persist(books.map((b) => (b.id === id ? updater(b) : b)));
  }

  function createBook() {
    const name = window.prompt("Book name:");
    if (!name?.trim()) return;
    const book: Book = {
      id: uid(),
      name: name.trim(),
      imagePrompts: [],
      captions: [],
      slideshows: [],
    };
    persist([...books, book]);
    setActiveBookId(book.id);
  }

  function renameBook(id: string) {
    const b = books.find((x) => x.id === id);
    if (!b) return;
    const name = window.prompt("Book name:", b.name);
    if (!name?.trim()) return;
    updateBook(id, (bk) => ({ ...bk, name: name.trim() }));
  }

  function deleteBook(id: string) {
    if (!window.confirm("Delete this book and everything in it?")) return;
    persist(books.filter((x) => x.id !== id));
    if (activeBookId === id) setActiveBookId(null);
  }

  function analyzeSlideUpload() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file || !activeBookId) return;
      setShowAnalyzeModal(false);
      setAnalyzingSlide(true);
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
        const newItem: NamedItem = {
          id: uid(),
          name: file.name.replace(/\.[^.]+$/, ""),
          value: data.prompt,
        };
        setEditingItem({ kind: "prompts", item: newItem });
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : "Failed to analyze slide"
        );
      } finally {
        setAnalyzingSlide(false);
      }
    };
    input.click();
  }

  async function analyzeSlideUrl() {
    if (!analyzeUrl.trim() || !activeBookId) return;
    setShowAnalyzeModal(false);
    setAnalyzingSlide(true);
    try {
      const res = await fetch("/api/analyze-slide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: analyzeUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      const newItem: NamedItem = {
        id: uid(),
        name: "From URL",
        value: data.prompt,
      };
      setEditingItem({ kind: "prompts", item: newItem });
      setAnalyzeUrl("");
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to analyze slide"
      );
    } finally {
      setAnalyzingSlide(false);
    }
  }

  const activeBook = books.find((b) => b.id === activeBookId);

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-5xl px-6 sm:px-10 py-10">
        <AppHeader />

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Books</h1>
          <div className="flex items-center gap-4">
            {saving && <span className="text-xs text-gray-500">Saving…</span>}
            <button
              onClick={createBook}
              className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
            >
              + New book
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading…</p>
        ) : books.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center">
            <p className="text-gray-400 mb-4">No books yet.</p>
            <button
              onClick={createBook}
              className="px-5 py-2 rounded-xl bg-blue-500 text-white font-semibold text-sm shadow-sm"
            >
              Create your first book
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-6">
            {/* Sidebar */}
            <aside className="space-y-2">
              <input
                type="text"
                value={bookSearch}
                onChange={(e) => setBookSearch(e.target.value)}
                placeholder="Search books..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-1 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 placeholder:text-gray-400"
              />
              {books.filter((b) => b.name.toLowerCase().includes(bookSearch.toLowerCase())).map((b) => (
                <button
                  key={b.id}
                  onClick={() => setActiveBookId(b.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                    activeBookId === b.id
                      ? "border-blue-500 bg-white text-gray-900 shadow-sm"
                      : "border-gray-200/60 bg-white text-gray-700 hover:border-gray-300"
                  }`}
                >
                  <div className="font-medium text-sm truncate">{b.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {b.slideshows.length} slideshow
                    {b.slideshows.length === 1 ? "" : "s"} ·{" "}
                    {b.imagePrompts.length} prompts · {b.captions.length}{" "}
                    captions
                  </div>
                </button>
              ))}
            </aside>

            {/* Main panel */}
            <main className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-6">
              {!activeBook ? (
                <p className="text-gray-500 text-sm">
                  Select a book to manage its contents.
                </p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <div>
                      <h2 className="text-xl font-semibold text-gray-900">
                        {activeBook.name}
                      </h2>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => renameBook(activeBook.id)}
                        className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                      >
                        Rename
                      </button>
                      <button
                        onClick={() => deleteBook(activeBook.id)}
                        className="text-xs text-red-500 hover:text-red-600 transition-colors"
                      >
                        Delete book
                      </button>
                    </div>
                  </div>

                  {/* Tabs */}
                  <div className="flex gap-1 mb-5 border-b border-gray-200">
                    {(
                      [
                        ["slideshows", "Slideshows"],
                        ["prompts", "Image prompts"],
                        ["captions", "Captions"],
                      ] as const
                    ).map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => setTab(key)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                          tab === key
                            ? "border-blue-500 text-blue-500"
                            : "border-transparent text-gray-500 hover:text-gray-900"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {tab === "prompts" && (
                    <>
                      {analyzingSlide && (
                        <div className="text-sm text-blue-500 mb-3">Analyzing slide…</div>
                      )}
                      <PoolTab
                        kind="prompts"
                        items={activeBook.imagePrompts}
                        onAdd={() =>
                          setEditingItem({
                            kind: "prompts",
                            item: { id: uid(), name: "", value: "" },
                          })
                        }
                        onEdit={(item) =>
                          setEditingItem({ kind: "prompts", item })
                        }
                        onDelete={(id) => {
                          if (!window.confirm("Delete this image prompt?"))
                            return;
                          updateBook(activeBook.id, (b) => ({
                            ...b,
                            imagePrompts: b.imagePrompts.filter(
                              (x) => x.id !== id
                            ),
                            slideshows: b.slideshows.map((s) => ({
                              ...s,
                              imagePromptIds: s.imagePromptIds.filter(
                                (x) => x !== id
                              ),
                            })),
                          }));
                        }}
                        onAnalyzeSlide={() => { setAnalyzeUrl(""); setShowAnalyzeModal(true); }}
                      />
                    </>
                  )}

                  {tab === "captions" && (
                    <PoolTab
                      kind="captions"
                      items={activeBook.captions}
                      onAdd={() =>
                        setEditingItem({
                          kind: "captions",
                          item: { id: uid(), name: "", value: "" },
                        })
                      }
                      onEdit={(item) =>
                        setEditingItem({ kind: "captions", item })
                      }
                      onDelete={(id) => {
                        if (!window.confirm("Delete this caption?")) return;
                        updateBook(activeBook.id, (b) => ({
                          ...b,
                          captions: b.captions.filter((x) => x.id !== id),
                          slideshows: b.slideshows.map((s) => ({
                            ...s,
                            captionIds: s.captionIds.filter((x) => x !== id),
                          })),
                        }));
                      }}
                    />
                  )}

                  {tab === "slideshows" && (
                    <div>
                      <div className="space-y-3 mb-4">
                        {activeBook.slideshows.map((s) => (
                          <div
                            key={s.id}
                            className="rounded-xl border border-gray-200/60 bg-gray-50 p-4"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm mb-1 text-gray-900">
                                  {s.name || "(unnamed)"}
                                </div>
                                <p className="text-xs text-gray-400">
                                  {
                                    s.slideTexts
                                      .split("\n")
                                      .filter((t) => t.trim()).length
                                  }{" "}
                                  slides · {s.imagePromptIds.length} prompts ·{" "}
                                  {s.captionIds.length} captions
                                </p>
                              </div>
                              <div className="flex gap-2 shrink-0">
                                <button
                                  onClick={() => setEditingSlideshow(s)}
                                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => {
                                    if (!window.confirm("Delete this slideshow?"))
                                      return;
                                    updateBook(activeBook.id, (b) => ({
                                      ...b,
                                      slideshows: b.slideshows.filter(
                                        (x) => x.id !== s.id
                                      ),
                                    }));
                                  }}
                                  className="text-xs text-red-500 hover:text-red-600 transition-colors"
                                >
                                  Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() =>
                            setEditingSlideshow({
                              id: uid(),
                              name: "",
                              slideTexts: "",
                              imagePromptIds: [],
                              captionIds: [],
                            })
                          }
                          className="flex-1 px-5 py-3 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400 transition-colors text-sm font-medium"
                        >
                          + Add slideshow
                        </button>
                        <button
                          onClick={() => {
                            setImportName("");
                            setImportText("");
                            setShowImport(true);
                          }}
                          className="flex-1 px-5 py-3 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400 transition-colors text-sm font-medium"
                        >
                          Import slide texts
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </main>
          </div>
        )}
      </div>

      {/* Item editor (image prompt or caption) */}
      {editingItem && activeBook && (
        <Modal onClose={() => setEditingItem(null)}>
          <h3 className="text-lg font-semibold mb-4 text-gray-900">
            {activeBook[
              editingItem.kind === "prompts" ? "imagePrompts" : "captions"
            ].some((x) => x.id === editingItem.item.id)
              ? "Edit"
              : "New"}{" "}
            {editingItem.kind === "prompts" ? "image prompt" : "caption"}
          </h3>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Name
          </label>
          <input
            value={editingItem.item.name}
            onChange={(e) =>
              setEditingItem({
                ...editingItem,
                item: { ...editingItem.item, name: e.target.value },
              })
            }
            placeholder="Short label"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <label className="block text-xs font-medium text-gray-500 mb-1">
            {editingItem.kind === "prompts" ? "Image prompt" : "Caption"}
          </label>
          <textarea
            value={editingItem.item.value}
            onChange={(e) =>
              setEditingItem({
                ...editingItem,
                item: { ...editingItem.item, value: e.target.value },
              })
            }
            rows={editingItem.kind === "prompts" ? 4 : 5}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <ModalButtons
            onCancel={() => setEditingItem(null)}
            onSave={() => {
              if (!editingItem.item.name.trim()) {
                window.alert("Name required");
                return;
              }
              const field =
                editingItem.kind === "prompts" ? "imagePrompts" : "captions";
              updateBook(activeBook.id, (b) => {
                const list = b[field];
                const exists = list.some((x) => x.id === editingItem.item.id);
                return {
                  ...b,
                  [field]: exists
                    ? list.map((x) =>
                        x.id === editingItem.item.id ? editingItem.item : x
                      )
                    : [...list, editingItem.item],
                };
              });
              setEditingItem(null);
            }}
          />
        </Modal>
      )}

      {/* Slideshow editor */}
      {editingSlideshow && activeBook && (
        <Modal onClose={() => setEditingSlideshow(null)}>
          <h3 className="text-lg font-semibold mb-4 text-gray-900">
            {activeBook.slideshows.some((s) => s.id === editingSlideshow.id)
              ? "Edit slideshow"
              : "New slideshow"}
          </h3>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Name
          </label>
          <input
            value={editingSlideshow.name}
            onChange={(e) =>
              setEditingSlideshow({ ...editingSlideshow, name: e.target.value })
            }
            placeholder="e.g. Chapter 1 teaser"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Slide texts (one per line)
          </label>
          <textarea
            value={editingSlideshow.slideTexts}
            onChange={(e) =>
              setEditingSlideshow({
                ...editingSlideshow,
                slideTexts: e.target.value,
              })
            }
            rows={6}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />

          <PickerList
            label="Image prompts to rotate through"
            emptyHint="Add image prompts in the Image prompts tab first."
            items={activeBook.imagePrompts}
            selected={editingSlideshow.imagePromptIds}
            onChange={(ids) =>
              setEditingSlideshow({ ...editingSlideshow, imagePromptIds: ids })
            }
          />

          <PickerList
            label="Captions to rotate through"
            emptyHint="Add captions in the Captions tab first."
            items={activeBook.captions}
            selected={editingSlideshow.captionIds}
            onChange={(ids) =>
              setEditingSlideshow({ ...editingSlideshow, captionIds: ids })
            }
          />

          <ModalButtons
            onCancel={() => setEditingSlideshow(null)}
            onSave={() => {
              if (!editingSlideshow.name.trim()) {
                window.alert("Name required");
                return;
              }
              updateBook(activeBook.id, (b) => {
                const exists = b.slideshows.some(
                  (s) => s.id === editingSlideshow.id
                );
                return {
                  ...b,
                  slideshows: exists
                    ? b.slideshows.map((s) =>
                        s.id === editingSlideshow.id ? editingSlideshow : s
                      )
                    : [...b.slideshows, editingSlideshow],
                };
              });
              setEditingSlideshow(null);
            }}
          />
        </Modal>
      )}

      {/* Analyze slide modal */}
      {showAnalyzeModal && activeBook && (
        <Modal onClose={() => setShowAnalyzeModal(false)}>
          <h3 className="text-lg font-semibold mb-2 text-gray-900">Analyze a slide</h3>
          <p className="text-xs text-gray-500 mb-5">
            Upload an image or paste a URL. The visual style will be extracted as an image prompt, ignoring any text.
          </p>
          <button
            onClick={analyzeSlideUpload}
            className="w-full px-5 py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors text-sm shadow-sm mb-3"
          >
            Upload image
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-xs text-gray-400">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={analyzeUrl}
              onChange={(e) => setAnalyzeUrl(e.target.value)}
              placeholder="Paste image URL"
              className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 placeholder-gray-400"
              onKeyDown={(e) => { if (e.key === "Enter") analyzeSlideUrl(); }}
            />
            <button
              onClick={analyzeSlideUrl}
              disabled={!analyzeUrl.trim()}
              className="px-4 py-2.5 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-40"
            >
              Analyze
            </button>
          </div>
        </Modal>
      )}

      {/* Import slide texts modal */}
      {showImport && activeBook && (
        <Modal onClose={() => setShowImport(false)}>
          <h3 className="text-lg font-semibold mb-4 text-gray-900">Import slide texts</h3>
          <p className="text-xs text-gray-500 mb-4">
            Paste your slide texts below. Each slideshow is separated by a blank
            line. The first line of each group becomes the slideshow name.
          </p>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Slideshow name (optional, for single import)
          </label>
          <input
            value={importName}
            onChange={(e) => setImportName(e.target.value)}
            placeholder="Leave blank to use first line of each group"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Slide texts
          </label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            rows={12}
            placeholder={`Slide 1 text\nSlide 2 text\nSlide 3 text\n\nAnother slideshow name\nSlide 1 text\nSlide 2 text`}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm mb-5 font-mono focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          />
          <ModalButtons
            onCancel={() => setShowImport(false)}
            onSave={() => {
              if (!importText.trim()) {
                window.alert("Paste some slide texts first.");
                return;
              }
              // Split by blank lines into groups
              const groups = importText
                .split(/\n\s*\n/)
                .map((g) => g.trim())
                .filter(Boolean);
              const newSlideshows: Slideshow[] = groups.map((group, i) => {
                const lines = group.split("\n").map((l) => l.trim()).filter(Boolean);
                let name: string;
                let slideTexts: string;
                if (importName.trim() && groups.length === 1) {
                  name = importName.trim();
                  slideTexts = lines.join("\n");
                } else {
                  name = lines[0] || `Import ${i + 1}`;
                  slideTexts = lines.length > 1 ? lines.slice(1).join("\n") : lines.join("\n");
                }
                return {
                  id: uid(),
                  name,
                  slideTexts,
                  // Inherit the book's current prompt/caption pool so imports
                  // are immediately usable — user can trim per-slideshow later.
                  imagePromptIds: activeBook.imagePrompts.map((p) => p.id),
                  captionIds: activeBook.captions.map((c) => c.id),
                };
              });
              updateBook(activeBook.id, (b) => ({
                ...b,
                slideshows: [...b.slideshows, ...newSlideshows],
              }));
              setShowImport(false);
              window.alert(
                `Imported ${newSlideshows.length} slideshow${newSlideshows.length === 1 ? "" : "s"}.`
              );
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function PoolTab({
  kind,
  items,
  onAdd,
  onEdit,
  onDelete,
  onAnalyzeSlide,
}: {
  kind: "prompts" | "captions";
  items: NamedItem[];
  onAdd: () => void;
  onEdit: (item: NamedItem) => void;
  onDelete: (id: string) => void;
  onAnalyzeSlide?: () => void;
}) {
  return (
    <div>
      <div className="space-y-2 mb-4">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-xl border border-gray-200/60 bg-gray-50 p-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm mb-0.5 text-gray-900">{item.name}</div>
                <p className="text-xs text-gray-500 whitespace-pre-wrap break-words line-clamp-3">{item.value}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => onEdit(item)}
                  className="text-xs text-gray-500 hover:text-gray-900 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => onDelete(item.id)}
                  className="text-xs text-red-500 hover:text-red-600 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button
          onClick={onAdd}
          className="flex-1 px-5 py-3 rounded-xl border border-dashed border-gray-300 text-gray-500 hover:text-gray-900 hover:border-gray-400 transition-colors text-sm font-medium"
        >
          + Add {kind === "prompts" ? "image prompt" : "caption"}
        </button>
        {onAnalyzeSlide && (
          <button
            onClick={onAnalyzeSlide}
            className="flex-1 px-5 py-3 rounded-xl border border-dashed border-blue-300 text-blue-500 hover:text-blue-600 hover:border-blue-400 transition-colors text-sm font-medium"
          >
            Analyze a slide
          </button>
        )}
      </div>
    </div>
  );
}

function PickerList({
  label,
  emptyHint,
  items,
  selected,
  onChange,
}: {
  label: string;
  emptyHint: string;
  items: NamedItem[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-500">{label}</label>
        {items.length > 0 && (
          <div className="flex gap-3 text-xs">
            <button
              onClick={() => onChange(items.map((i) => i.id))}
              className="text-gray-500 hover:text-gray-900 transition-colors"
            >
              All
            </button>
            <button
              onClick={() => onChange([])}
              className="text-gray-500 hover:text-gray-900 transition-colors"
            >
              None
            </button>
          </div>
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400">{emptyHint}</p>
      ) : (
        <div className="space-y-1 max-h-40 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
          {items.map((item) => {
            const checked = selected.includes(item.id);
            return (
              <label
                key={item.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((x) => x !== item.id)
                        : [...selected, item.id]
                    )
                  }
                  className="accent-blue-500"
                />
                <span className="text-sm text-gray-700 truncate">
                  {item.name}
                </span>
              </label>
            );
          })}
        </div>
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

function ModalButtons({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <div className="flex gap-3 justify-end">
      <button
        onClick={onCancel}
        className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-sm"
      >
        Cancel
      </button>
      <button
        onClick={onSave}
        className="px-4 py-2 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm shadow-sm"
      >
        Save
      </button>
    </div>
  );
}
