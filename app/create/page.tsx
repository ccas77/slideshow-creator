"use client";

import { useState, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface Book {
  id: string;
  name: string;
  coverImage?: string;
  imagePrompts: { id: string; name: string; value: string }[];
  captions: { id: string; name: string; value: string }[];
  slideshows: {
    id: string;
    name: string;
    slideTexts: string;
    imagePromptIds: string[];
    captionIds: string[];
  }[];
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export default function CreatePage() {
  const [passage, setPassage] = useState("");
  const [bookTag, setBookTag] = useState("");
  const [hook, setHook] = useState("");
  const [twist, setTwist] = useState("");
  const [keywords, setKeywords] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [tightening, setTightening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [books, setBooks] = useState<Book[]>([]);
  const [exportBookId, setExportBookId] = useState<string>("");
  const [exportName, setExportName] = useState("");
  const [exporting, setExporting] = useState(false);
  const [selectedPromptIds, setSelectedPromptIds] = useState<string[]>([]);
  const [selectedCaptionIds, setSelectedCaptionIds] = useState<string[]>([]);
  const [newPrompt, setNewPrompt] = useState("");
  const [newCaption, setNewCaption] = useState("");

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch(`/api/books`);
      if (res.ok) setBooks((await res.json()).books || []);
    } catch {}
  }, []);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);

  const generate = async () => {
    if (!passage.trim() || !bookTag.trim() || !hook.trim() || !twist.trim())
      return;
    setLoading(true);
    setError(null);
    setOutput("");
    setCopied(false);

    try {
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passage, bookTag, hook, twist, keywords }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setOutput(data.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed.");
    } finally {
      setLoading(false);
    }
  };

  const tighten = async () => {
    if (!output.trim()) return;
    setTightening(true);
    setError(null);
    setCopied(false);

    try {
      const res = await fetch("/api/generate-slides", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "tighten", slides: output }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setOutput(data.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tighten failed.");
    } finally {
      setTightening(false);
    }
  };

  const copyAll = async () => {
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const exportToBook = async () => {
    if (!output.trim() || !exportBookId || !exportName.trim()) {
      window.alert("Select a book and enter a slideshow name.");
      return;
    }
    setExporting(true);
    try {
      const book = books.find((b) => b.id === exportBookId);
      if (!book) return;

      const promptIds = [...selectedPromptIds];
      const captionIds = [...selectedCaptionIds];
      let updatedBook = { ...book };

      // Add new prompt if provided
      if (newPrompt.trim()) {
        const item = { id: uid(), name: exportName.trim() + " prompt", value: newPrompt.trim() };
        updatedBook = { ...updatedBook, imagePrompts: [...updatedBook.imagePrompts, item] };
        promptIds.push(item.id);
      }
      // Add new caption if provided
      if (newCaption.trim()) {
        const item = { id: uid(), name: exportName.trim() + " caption", value: newCaption.trim() };
        updatedBook = { ...updatedBook, captions: [...updatedBook.captions, item] };
        captionIds.push(item.id);
      }

      const newSlideshow = {
        id: uid(),
        name: exportName.trim(),
        slideTexts: output,
        imagePromptIds: promptIds,
        captionIds,
      };
      updatedBook = { ...updatedBook, slideshows: [...updatedBook.slideshows, newSlideshow] };

      const updated = books.map((b) => (b.id === exportBookId ? updatedBook : b));
      await fetch("/api/books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ books: updated }),
      });
      setBooks(updated);
      const name = exportName.trim();
      window.alert(`Exported "${name}" to ${book.name}.`);
      setExportName("");
      setNewPrompt("");
      setNewCaption("");
      setSelectedPromptIds([]);
      setSelectedCaptionIds([]);
    } catch {
      window.alert("Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const slideCount = output
    ? output.split("\n").filter((l) => l.trim()).length
    : 0;

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-3xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Create</strong> — generate slideshow content from book passages using AI.</p>
          <p>Paste a passage from a book, add a hook (opening line), twist (surprising angle), and keywords. The AI turns it into a set of short, punchy slides optimized for TikTok.</p>
          <p>You can <strong>tighten</strong> the output to make slides shorter, then <strong>save</strong> the result to a book as a new slideshow.</p>
        </HowItWorks>

        <h1 className="text-2xl font-bold mb-1">Create Slideshow</h1>
        <p className="text-sm text-gray-500 mb-8">
          Paste a passage. Get slides. Export to a book.
        </p>

        <div className="space-y-5">
          <Field label="Book tag">
            <input
              value={bookTag}
              onChange={(e) => setBookTag(e.target.value)}
              placeholder='e.g. 📚 Book Title by Author Name'
              className="input-field"
            />
          </Field>

          <Field label="Passage">
            <textarea
              value={passage}
              onChange={(e) => setPassage(e.target.value)}
              placeholder="Paste your book passage here..."
              rows={8}
              className="input-field"
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Field label="Hook guidance">
              <input
                value={hook}
                onChange={(e) => setHook(e.target.value)}
                placeholder="e.g. she discovers a hidden letter"
                className="input-field"
              />
            </Field>
            <Field label="Twist guidance">
              <input
                value={twist}
                onChange={(e) => setTwist(e.target.value)}
                placeholder="e.g. the letter is from someone she thought was dead"
                className="input-field"
              />
            </Field>
          </div>

          <Field label="Backloading keywords">
            <input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. mystery, betrayal, secret identity"
              className="input-field"
            />
          </Field>

          <button
            onClick={generate}
            disabled={
              loading ||
              !passage.trim() ||
              !bookTag.trim() ||
              !hook.trim() ||
              !twist.trim()
            }
            className="w-full px-6 py-3 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-sm shadow-sm"
          >
            {loading ? "Generating..." : "Generate Slides"}
          </button>
        </div>

        {loading && (
          <p className="text-center text-gray-500 italic py-8 text-sm">
            Building your slideshow...
          </p>
        )}
        {tightening && (
          <p className="text-center text-gray-500 italic py-4 text-sm">
            Cutting the fat...
          </p>
        )}
        {error && (
          <p className="text-center text-red-500 py-4 text-sm">{error}</p>
        )}

        {output && (
          <div className="mt-8">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-gray-400">
                {slideCount} slides
              </span>
              <div className="flex gap-2">
                <button
                  onClick={tighten}
                  disabled={tightening}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-xs disabled:opacity-40"
                >
                  {tightening ? "Tightening..." : "Tighten"}
                </button>
                <button
                  onClick={copyAll}
                  className="px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors text-xs"
                >
                  {copied ? "Copied" : "Copy All"}
                </button>
              </div>
            </div>

            <textarea
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              rows={Math.min(slideCount + 2, 26)}
              className="input-field font-mono text-sm leading-relaxed"
            />

            {/* Export to Book */}
            <div className="mt-6 bg-white rounded-2xl border border-gray-200/60 shadow-sm p-5 space-y-4">
              <h3 className="text-sm font-semibold text-gray-900">Export to Book</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={exportBookId}
                  onChange={(e) => {
                    setExportBookId(e.target.value);
                    setSelectedPromptIds([]);
                    setSelectedCaptionIds([]);
                  }}
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                >
                  <option value="">Select a book...</option>
                  {books.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
                <input
                  value={exportName}
                  onChange={(e) => setExportName(e.target.value)}
                  placeholder="Slideshow name"
                  className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
                />
              </div>

              {exportBookId && (() => {
                const book = books.find((b) => b.id === exportBookId);
                if (!book) return null;
                return (
                  <div className="space-y-4">
                    {/* Image prompts */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">
                        Image prompts
                      </label>
                      {book.imagePrompts.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 mb-2">
                          {book.imagePrompts.map((p) => (
                            <label
                              key={p.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedPromptIds.includes(p.id)}
                                onChange={() =>
                                  setSelectedPromptIds((prev) =>
                                    prev.includes(p.id)
                                      ? prev.filter((x) => x !== p.id)
                                      : [...prev, p.id]
                                  )
                                }
                                className="accent-blue-500"
                              />
                              <span className="text-sm text-gray-700 truncate">
                                {p.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={newPrompt}
                        onChange={(e) => setNewPrompt(e.target.value)}
                        placeholder="Or write a new image prompt..."
                        rows={2}
                        className="input-field text-sm"
                      />
                    </div>

                    {/* Captions */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-2">
                        Captions
                      </label>
                      {book.captions.length > 0 && (
                        <div className="space-y-1 max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2 mb-2">
                          {book.captions.map((c) => (
                            <label
                              key={c.id}
                              className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-100 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={selectedCaptionIds.includes(c.id)}
                                onChange={() =>
                                  setSelectedCaptionIds((prev) =>
                                    prev.includes(c.id)
                                      ? prev.filter((x) => x !== c.id)
                                      : [...prev, c.id]
                                  )
                                }
                                className="accent-blue-500"
                              />
                              <span className="text-sm text-gray-700 truncate">
                                {c.name}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                      <textarea
                        value={newCaption}
                        onChange={(e) => setNewCaption(e.target.value)}
                        placeholder="Or write a new caption..."
                        rows={2}
                        className="input-field text-sm"
                      />
                    </div>
                  </div>
                );
              })()}

              <button
                onClick={exportToBook}
                disabled={exporting || !exportBookId || !exportName.trim()}
                className="w-full px-5 py-3 rounded-xl bg-blue-500 text-white font-semibold hover:bg-blue-600 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
              >
                {exporting ? "Exporting..." : "Export to Book"}
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        .input-field {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid #e5e7eb;
          background: #f9fafb;
          padding: 0.625rem 1rem;
          color: #111827;
          font-size: 0.875rem;
          outline: none;
          transition: box-shadow 0.15s, border-color 0.15s;
        }
        .input-field:focus {
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
          border-color: #3b82f6;
        }
        .input-field::placeholder {
          color: #9ca3af;
        }
        textarea.input-field {
          resize: vertical;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
