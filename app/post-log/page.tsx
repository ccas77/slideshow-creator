"use client";

import { useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";

interface PostLogEntry {
  date: string;
  time: string;
  accountId: number;
  accountName: string;
  bookName: string;
  slideshowId: string;
  slideshowName: string;
  imagePromptId: string;
  imagePromptText: string;
  captionId: string;
  captionText: string;
  postBridgeId: string;
  postBridgeUrl: string;
  source: string;
  userId: string;
  timestamp: string;
}

function toLocalTime(utcTime: string, date: string): string {
  try {
    const d = new Date(`${date}T${utcTime}:00Z`);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return utcTime;
  }
}

export default function PostLogPage() {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [entries, setEntries] = useState<PostLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  function loadLog() {
    setLoading(true);
    fetch(`/api/post-log?date=${date}`)
      .then((r) => r.json())
      .then((d) => setEntries(d.entries || []))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadLog();
  }, [date]);

  async function syncFromPostBridge() {
    setSyncing(true);
    setSyncMsg("");
    try {
      const r = await fetch("/api/post-log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date }),
      });
      const d = await r.json();
      setEntries(d.entries || []);
      setSyncMsg(`Synced — ${d.added || 0} new posts pulled from PostBridge`);
    } catch {
      setSyncMsg("Sync failed");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = entries.filter((e) => {
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      e.accountName.toLowerCase().includes(q) ||
      e.bookName.toLowerCase().includes(q) ||
      e.slideshowName.toLowerCase().includes(q) ||
      e.source.toLowerCase().includes(q)
    );
  });

  // Detect duplicates: same account + same slideshowId on the same day
  const dupeKeys = new Set<string>();
  const seen = new Map<string, number>();
  for (const e of filtered) {
    const key = `${e.accountId}:${e.slideshowId || e.slideshowName}`;
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) dupeKeys.add(key);
  }

  const dupeCount = filtered.filter((e) => {
    const key = `${e.accountId}:${e.slideshowId || e.slideshowName}`;
    return dupeKeys.has(key);
  }).length;

  return (
    <main className="min-h-screen bg-gray-50">
      <AppHeader />
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Post Log</h1>

        <div className="flex flex-wrap gap-4 mb-6 items-center">
          <div>
            <label className="text-sm font-medium text-gray-600 mr-2">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <input
              type="text"
              placeholder="Filter by account, book, slideshow..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="border rounded px-3 py-1.5 text-sm w-72"
            />
          </div>
          <button
            onClick={syncFromPostBridge}
            disabled={syncing}
            className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync from PostBridge"}
          </button>
          <div className="text-sm text-gray-500">
            {filtered.length} posts
            {dupeCount > 0 && (
              <span className="ml-2 text-red-600 font-medium">
                ({dupeCount} potential duplicates)
              </span>
            )}
            {syncMsg && <span className="ml-2 text-green-600">{syncMsg}</span>}
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-gray-500">No posts logged for {date}.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border-b font-medium">Time</th>
                  <th className="px-3 py-2 border-b font-medium">Account</th>
                  <th className="px-3 py-2 border-b font-medium">Book</th>
                  <th className="px-3 py-2 border-b font-medium">Slideshow</th>
                  <th className="px-3 py-2 border-b font-medium">Image Prompt</th>
                  <th className="px-3 py-2 border-b font-medium">Caption</th>
                  <th className="px-3 py-2 border-b font-medium">Source</th>
                  <th className="px-3 py-2 border-b font-medium">PostBridge</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const key = `${e.accountId}:${e.slideshowId || e.slideshowName}`;
                  const isDupe = dupeKeys.has(key);
                  return (
                    <tr
                      key={i}
                      className={isDupe ? "bg-red-50" : i % 2 === 0 ? "bg-white" : "bg-gray-50"}
                    >
                      <td className="px-3 py-2 border-b whitespace-nowrap">
                        {toLocalTime(e.time, e.date)}
                      </td>
                      <td className="px-3 py-2 border-b">{e.accountName}</td>
                      <td className="px-3 py-2 border-b">{e.bookName || "—"}</td>
                      <td className="px-3 py-2 border-b">
                        <span title={e.slideshowId}>{e.slideshowName || "—"}</span>
                      </td>
                      <td className="px-3 py-2 border-b max-w-48 truncate" title={e.imagePromptText}>
                        <span title={`ID: ${e.imagePromptId}`}>
                          {e.imagePromptText || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b max-w-48 truncate" title={e.captionText}>
                        <span title={`ID: ${e.captionId}`}>
                          {e.captionText || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          e.source === "cron" ? "bg-blue-100 text-blue-700" :
                          e.source === "cron-topn" ? "bg-purple-100 text-purple-700" :
                          e.source === "cron-ig" ? "bg-pink-100 text-pink-700" :
                          e.source === "cron-fallback" ? "bg-orange-100 text-orange-700" :
                          "bg-gray-100 text-gray-700"
                        }`}>
                          {e.source}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b">
                        {e.postBridgeUrl ? (
                          <a
                            href={e.postBridgeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 underline"
                            title={e.postBridgeId}
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-gray-400" title={e.postBridgeId}>
                            {e.postBridgeId.slice(0, 8)}...
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {dupeCount > 0 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
            Rows highlighted in red indicate potential duplicates — same account and slideshow posted more than once on this date.
          </div>
        )}
      </div>
    </main>
  );
}
