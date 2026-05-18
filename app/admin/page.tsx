"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";
import HowItWorks from "@/components/HowItWorks";

interface PublicUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  allowedAccountIds: number[];
}

interface SocialAccount {
  id: number;
  username: string;
  platform: string;
}

interface TimeWindow { start: string; end: string }

interface UserAutomation {
  userId: string;
  email: string;
  topn: { accounts: Record<string, { enabled: boolean; intervals: TimeWindow[]; listIds: string[]; pointer: number; frequencyDays: number; lastPostDate?: string; platform: string }> };
  ig: { accounts: Record<string, { enabled: boolean; intervals: TimeWindow[]; bookIds: string[]; slideshowIds: string[]; pointer: number }> };
}

export default function AdminPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoData, setAutoData] = useState<UserAutomation[]>([]);
  const [autoLoading, setAutoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [busy, setBusy] = useState(false);

  // Per-user account editor state
  const [editAccessId, setEditAccessId] = useState<string | null>(null);
  const [editAccessIds, setEditAccessIds] = useState<number[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [uRes, aRes] = await Promise.all([
        fetch("/api/admin/users"),
        fetch("/api/settings/all-accounts"),
      ]);
      if (!uRes.ok) {
        const data = await uRes.json().catch(() => ({}));
        throw new Error(data.error || `Failed: ${uRes.status}`);
      }
      const data = await uRes.json();
      setUsers(data.users || []);
      if (aRes.ok) {
        const accData = await aRes.json();
        setAccounts(accData.accounts || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadAutomations() {
    setAutoLoading(true);
    try {
      const res = await fetch("/api/admin/automations");
      if (res.ok) {
        const d = await res.json();
        setAutoData(d.users || []);
      }
    } catch { /* ignore */ }
    setAutoLoading(false);
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNewEmail("");
      setNewRole("user");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function deleteUser(id: string, email: string) {
    if (!confirm(`Delete user ${email}? Their data will be orphaned.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRole(u: PublicUser) {
    const next: "admin" | "user" = u.role === "admin" ? "user" : "admin";
    if (!confirm(`Change ${u.email} role to ${next}?`)) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: u.id, role: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  function openAccess(u: PublicUser) {
    setEditAccessId(u.id);
    setEditAccessIds(u.allowedAccountIds || []);
  }

  function toggleAccess(accountId: number) {
    setEditAccessIds((prev) =>
      prev.includes(accountId)
        ? prev.filter((x) => x !== accountId)
        : [...prev, accountId]
    );
  }

  async function saveAccess() {
    if (!editAccessId) return;
    setSavingAccess(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editAccessId,
          allowedAccountIds: editAccessIds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
      setEditAccessId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSavingAccess(false);
    }
  }

  const editingUser = users.find((u) => u.id === editAccessId);

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-gray-900">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <AppHeader />
        <HowItWorks>
          <p><strong>Admin</strong> — manage users and their account access.</p>
          <p>Create new users with Google email addresses and assign them roles. Control which TikTok accounts each user can access for posting and automation.</p>
        </HowItWorks>

        <h1 className="text-2xl font-bold mb-6">Admin · Users</h1>

        <section className="bg-white border border-gray-200/60 rounded-2xl shadow-sm p-5 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900">Invite user</h2>
          <form onSubmit={addUser} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="email"
              placeholder="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 placeholder-gray-400"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed px-5 py-2.5"
            >
              Invite
            </button>
          </form>
          <p className="text-[11px] text-gray-400 mt-3">
            Invited users can sign in with Google. They have no TikTok account access until you grant it below.
          </p>
        </section>

        {error && <div className="text-sm text-red-500 mb-4">{error}</div>}

        <section className="bg-white border border-gray-200/60 rounded-2xl shadow-sm">
          {loading ? (
            <div className="p-5 text-gray-500 text-sm">Loading...</div>
          ) : users.length === 0 ? (
            <div className="p-5 text-gray-500 text-sm">No users yet.</div>
          ) : (
            <ul className="divide-y divide-gray-200/60">
              {users.map((u) => {
                const allowedAccounts = u.allowedAccountIds
                  .map((id) => accounts.find((a) => a.id === id))
                  .filter(Boolean) as SocialAccount[];
                const allowedUsernames = allowedAccounts.map((a) => a.username);
                return (
                  <li key={u.id} className="px-5 py-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-gray-900 truncate">{u.email}</div>
                        <div className="text-xs text-gray-500">
                          {u.role} · created {new Date(u.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-400 mt-1">
                          Accounts:{" "}
                          {u.allowedAccountIds.length === 0 ? (
                            <span className="text-red-500">none</span>
                          ) : (
                            <span>
                              {allowedUsernames.length > 0
                                ? allowedUsernames.map((n) => "@" + n).join(", ")
                                : `${u.allowedAccountIds.length} account(s)`}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2 shrink-0 flex-wrap">
                        <button
                          onClick={() => openAccess(u)}
                          disabled={busy}
                          className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2.5 py-1 rounded-lg disabled:opacity-40 shadow-sm"
                        >
                          Accounts
                        </button>
                        <button
                          onClick={() => toggleRole(u)}
                          disabled={busy}
                          className="text-xs text-gray-500 hover:text-gray-900 px-2 py-1 disabled:opacity-40"
                        >
                          {u.role === "admin" ? "Demote" : "Promote"}
                        </button>
                        <button
                          onClick={() => deleteUser(u.id, u.email)}
                          disabled={busy}
                          className="text-xs text-red-500 hover:text-red-600 px-2 py-1 disabled:opacity-40"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* AUTOMATIONS SECTION */}
        <section className="bg-white border border-gray-200/60 rounded-2xl shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">All Automations</h2>
            <button
              onClick={loadAutomations}
              disabled={autoLoading}
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40 shadow-sm"
            >
              {autoLoading ? "Loading..." : autoData.length > 0 ? "Refresh" : "Load"}
            </button>
          </div>
          {autoData.length > 0 ? (
            <div className="space-y-5">
              {autoData.map((u) => {
                const topnEntries = Object.entries(u.topn.accounts || {});
                const igEntries = Object.entries(u.ig.accounts || {});
                if (topnEntries.length === 0 && igEntries.length === 0) return null;
                return (
                  <div key={u.userId} className="border border-gray-200 rounded-xl p-4">
                    <div className="text-sm font-semibold text-gray-900 mb-3">{u.email}</div>
                    {topnEntries.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-2">Top N</div>
                        <div className="space-y-2">
                          {topnEntries.map(([accId, cfg]) => (
                            <div key={accId} className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono text-gray-500">Acct {accId}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.enabled ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                                  {cfg.enabled ? "ON" : "OFF"}
                                </span>
                                <span className="text-gray-400">ptr:{cfg.pointer}</span>
                                <span className="text-gray-400">{cfg.platform}</span>
                              </div>
                              <div className="text-xs text-gray-500">
                                Windows: {cfg.intervals.map((w, i) => <span key={i}>{w.start}-{w.end}{i < cfg.intervals.length - 1 ? ", " : ""}</span>)}
                                {cfg.intervals.length === 0 && "none"}
                                {" | "}Every {cfg.frequencyDays}d
                                {cfg.lastPostDate && ` | Last: ${cfg.lastPostDate}`}
                                {" | "}Lists: {cfg.listIds.length === 0 ? "all" : cfg.listIds.length}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {igEntries.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-blue-600 mb-2">IG/Carousel</div>
                        <div className="space-y-2">
                          {igEntries.map(([accId, cfg]) => (
                            <div key={accId} className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="font-mono text-gray-500">Acct {accId}</span>
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.enabled ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-500"}`}>
                                  {cfg.enabled ? "ON" : "OFF"}
                                </span>
                                <span className="text-gray-400">ptr:{cfg.pointer}</span>
                              </div>
                              <div className="text-xs text-gray-500">
                                Windows: {cfg.intervals.map((w, i) => <span key={i}>{w.start}-{w.end}{i < cfg.intervals.length - 1 ? ", " : ""}</span>)}
                                {cfg.intervals.length === 0 && "none"}
                                {" | "}Books: {cfg.bookIds.length === 0 ? "all" : cfg.bookIds.length}
                                {" | "}Slideshows: {cfg.slideshowIds.length === 0 ? "all" : cfg.slideshowIds.length}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-gray-400">Click Load to view all user automations.</p>
          )}
        </section>

        {/* ACCOUNT ACCESS MODAL */}
        {editAccessId && editingUser && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditAccessId(null);
            }}
          >
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-gray-900">
                  Account access · {editingUser.email}
                </h2>
                <button
                  onClick={() => setEditAccessId(null)}
                  className="text-gray-400 hover:text-gray-900 text-xl"
                >
                  &times;
                </button>
              </div>
              <p className="text-sm text-gray-500 mb-4">
                Check every account this user is allowed to access.
                Unchecked accounts are hidden from them entirely.
              </p>
              {accounts.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No accounts returned by PostBridge.
                </p>
              ) : (
                <div className="space-y-4 mb-4">
                  {["tiktok", "instagram", "facebook"]
                    .filter((p) => accounts.some((a) => a.platform === p))
                    .map((platform) => (
                    <div key={platform}>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                        {platform}
                      </h3>
                      <div className="space-y-2">
                        {accounts
                          .filter((a) => a.platform === platform)
                          .map((a) => {
                            const checked = editAccessIds.includes(a.id);
                            return (
                              <label
                                key={a.id}
                                className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                                  checked
                                    ? "border-blue-500/50 bg-blue-50"
                                    : "border-gray-200 bg-gray-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAccess(a.id)}
                                  className="accent-blue-500 rounded"
                                />
                                <span className="text-sm text-gray-900">@{a.username}</span>
                                <span className="text-[10px] text-gray-400 ml-auto">
                                  ID: {a.id}
                                </span>
                              </label>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={saveAccess}
                disabled={savingAccess}
                className="w-full rounded-xl bg-blue-500 text-white py-2.5 text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-40 shadow-sm"
              >
                {savingAccess ? "Saving..." : "Save access"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
