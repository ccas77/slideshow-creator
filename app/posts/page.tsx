"use client";

import { useEffect, useState, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface TikTokAccount {
  id: number;
  username: string;
}

interface Post {
  id: string;
  caption: string;
  status: string;
  scheduled_at: string | null;
  social_accounts: number[];
  slide_count: number;
  videoUrl?: string | null;
}

export default function PostsPage() {
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterAccount, setFilterAccount] = useState<number | "all">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "scheduled" | "posted">(
    "all"
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [accRes, postsRes] = await Promise.all([
        fetch(`/api/post-tiktok`),
        fetch(`/api/post-tiktok?action=posts`),
      ]);
      if (accRes.ok) setAccounts((await accRes.json()).accounts || []);
      if (postsRes.ok) setPosts((await postsRes.json()).posts || []);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function cancelPost(id: string) {
    if (!window.confirm("Cancel this scheduled post?")) return;
    try {
      const res = await fetch(
        `/api/post-tiktok?postId=${id}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== id));
      } else {
        const d = await res.json();
        window.alert(d.error || "Failed");
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Failed");
    }
  }

  const accountUsername = (id: number) =>
    accounts.find((a) => a.id === id)?.username || `#${id}`;

  const filtered = posts.filter((p) => {
    if (filterAccount !== "all" && !p.social_accounts.includes(filterAccount))
      return false;
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-10">
        <AppHeader />
        <HowItWorks>
          <p><strong>Posts</strong> — view all your scheduled and published posts.</p>
          <p>Filter by account to see what's been posted or what's coming up. Each entry shows the caption, slide count, and when it was scheduled or posted.</p>
        </HowItWorks>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Posts</h1>
          <button
            onClick={load}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="flex flex-wrap gap-3 mb-6">
          <select
            value={filterAccount}
            onChange={(e) =>
              setFilterAccount(
                e.target.value === "all" ? "all" : Number(e.target.value)
              )
            }
            className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as "all" | "scheduled" | "posted")
            }
            className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
          >
            <option value="all">All statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="posted">Posted</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-10 text-center text-gray-500">
            No posts match your filters.
          </div>
        ) : (
          <ul className="space-y-3">
            {filtered.map((p) => {
              const isScheduled = p.status === "scheduled";
              return (
                <li
                  key={p.id}
                  className="bg-white rounded-2xl border border-gray-200/60 shadow-sm p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span
                          className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                            isScheduled
                              ? "bg-blue-50 text-blue-600"
                              : p.status === "posted"
                              ? "bg-green-50 text-green-600"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {p.status}
                        </span>
                        <span className="text-xs text-gray-500">
                          {p.slide_count} slides
                        </span>
                        {p.scheduled_at && (
                          <span className="text-xs text-gray-500">
                            {new Date(p.scheduled_at).toLocaleString()}
                          </span>
                        )}
                        <span className="text-xs text-gray-400">
                          {p.social_accounts
                            .map((id) => `@${accountUsername(id)}`)
                            .join(", ")}
                        </span>
                      </div>
                      <p className="text-sm text-gray-700 line-clamp-3 whitespace-pre-wrap">
                        {p.caption || "(no caption)"}
                      </p>
                      {p.videoUrl && (
                        <a
                          href={p.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-xs text-blue-500 hover:text-blue-600 transition-colors"
                        >
                          View profile on TikTok &rarr;
                        </a>
                      )}
                    </div>
                    {isScheduled && (
                      <button
                        onClick={() => cancelPost(p.id)}
                        className="text-xs text-red-500 hover:text-red-600 transition-colors shrink-0"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
