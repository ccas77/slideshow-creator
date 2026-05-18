"use client";

import { useEffect, useState } from "react";

interface TikTokAccount {
  id: number;
  username: string;
  platform?: string;
}

interface Book {
  id: string;
  name: string;
  slideshows: { id: string; name: string }[];
}

interface AccountSummary {
  accountId: number;
  username: string;
  platform: string;
  enabled: boolean;
  intervals: { start: string; end: string }[];
  selectionCount: number;
  bookNames: string[];
  pointer: number;
}

interface OverviewTabProps {
  accounts: TikTokAccount[];
  books: Book[];
}

export default function OverviewTab({ accounts, books }: OverviewTabProps) {
  const [summaries, setSummaries] = useState<AccountSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (accounts.length === 0) { setLoading(false); return; }
    let cancelled = false;
    async function fetchAll() {
      try {
        const res = await fetch("/api/admin/all-account-configs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountIds: accounts.map((a) => a.id) }),
        });
        if (!res.ok) return;
        const { configs } = await res.json();
        const results: AccountSummary[] = [];
        for (const [idStr, cfg] of Object.entries(configs) as [string, { enabled: boolean; intervals: { start: string; end: string }[]; selections: { bookId: string; slideshowId: string }[]; pointer: number }][]) {
          const acc = accounts.find((a) => a.id === Number(idStr));
          if (!acc) continue;
          const bookIds = [...new Set(cfg.selections.map((s) => s.bookId))] as string[];
          const bookNames = bookIds.map((bid) => books.find((b) => b.id === bid)?.name || bid);
          results.push({
            accountId: acc.id,
            username: acc.username,
            platform: (acc as { platform?: string }).platform || "tiktok",
            enabled: cfg.enabled,
            intervals: cfg.intervals,
            selectionCount: cfg.selections.length,
            bookNames,
            pointer: cfg.pointer,
          });
        }
        if (!cancelled) setSummaries(results.sort((a, b) => a.username.localeCompare(b.username)));
      } catch { /* skip */ }
      if (!cancelled) setLoading(false);
    }
    fetchAll();
    return () => { cancelled = true; };
  }, [accounts, books]);

  if (loading) {
    return <div className="text-sm text-gray-400 text-center py-10">Loading all account configs...</div>;
  }

  const active = summaries.filter((s) => s.enabled);
  const inactive = summaries.filter((s) => !s.enabled && s.selectionCount > 0);

  return (
    <section className="space-y-6">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6">
        <h2 className="text-lg font-semibold mb-1">Slide Automation Overview</h2>
        <p className="text-sm text-gray-500 mb-6">
          {active.length} active account{active.length !== 1 ? "s" : ""} · {accounts.length} total
        </p>

        {active.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-4">No accounts have automation enabled.</p>
        ) : (
          <div className="space-y-2">
            {active.map((s) => (
              <div key={s.accountId} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">@{s.username}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{s.platform}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">ON</span>
                </div>
                <div className="text-xs text-gray-500">
                  {s.intervals.map((w) => `${w.start}–${w.end}`).join(", ") || "no windows"} · {s.bookNames.join(", ") || "no books"} · {s.selectionCount} slideshow{s.selectionCount !== 1 ? "s" : ""} · ptr {s.pointer}
                </div>
              </div>
            ))}
          </div>
        )}

        {inactive.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mt-6 mb-3">Disabled (have selections)</h3>
            <div className="space-y-2">
              {inactive.map((s) => (
                <div key={s.accountId} className="rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3 opacity-60">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-gray-500">@{s.username}</span>
                    <span className="text-[10px] uppercase tracking-wide text-gray-400">{s.platform}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-200 text-gray-500 font-medium">OFF</span>
                  </div>
                  <div className="text-xs text-gray-400">
                    {s.bookNames.join(", ") || "no books"} · {s.selectionCount} slideshow{s.selectionCount !== 1 ? "s" : ""}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
