"use client";

import { useCallback, useEffect, useState } from "react";
import AppHeader from "@/components/AppHeader";

interface PublicUser {
  id: string;
  email: string;
  role: "admin" | "user";
  createdAt: string;
  allowedAccountIds: number[];
}

interface TikTokAccount {
  id: number;
  username: string;
}

export default function AdminPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [accounts, setAccounts] = useState<TikTokAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
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

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newEmail || !newPassword) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newEmail,
          password: newPassword,
          role: newRole,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNewEmail("");
      setNewPassword("");
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

  async function resetPassword(id: string, email: string) {
    const pw = prompt(`New password for ${email}:`);
    if (!pw) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: pw }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed");
      }
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
    <div className="min-h-screen bg-zinc-950 text-white">
      <div className="max-w-4xl mx-auto px-6 py-8">
        <AppHeader />

        <h1 className="text-2xl font-bold mb-6">Admin · Users</h1>

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl p-5 mb-6">
          <h2 className="text-lg font-semibold mb-4">Add user</h2>
          <form onSubmit={addUser} className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="email"
              placeholder="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm"
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <button
              type="submit"
              disabled={busy}
              className="bg-white text-zinc-900 rounded-lg text-sm font-medium disabled:opacity-50"
            >
              Add
            </button>
          </form>
          <p className="text-[11px] text-zinc-600 mt-3">
            New users have no TikTok account access until you grant it below.
          </p>
        </section>

        {error && <div className="text-sm text-red-400 mb-4">{error}</div>}

        <section className="bg-zinc-900 border border-zinc-800 rounded-xl">
          {loading ? (
            <div className="p-5 text-zinc-500 text-sm">Loading…</div>
          ) : users.length === 0 ? (
            <div className="p-5 text-zinc-500 text-sm">No users yet.</div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {users.map((u) => {
                const allowedUsernames = u.allowedAccountIds
                  .map((id) => accounts.find((a) => a.id === id)?.username)
                  .filter(Boolean) as string[];
                return (
                  <li key={u.id} className="px-5 py-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-white truncate">{u.email}</div>
                        <div className="text-xs text-zinc-500">
                          {u.role} · created {new Date(u.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-zinc-400 mt-1">
                          Accounts:{" "}
                          {u.allowedAccountIds.length === 0 ? (
                            <span className="text-red-400">none</span>
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
                          className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 rounded disabled:opacity-50"
                        >
                          Accounts
                        </button>
                        <button
                          onClick={() => toggleRole(u)}
                          disabled={busy}
                          className="text-xs text-zinc-400 hover:text-white px-2 py-1 disabled:opacity-50"
                        >
                          {u.role === "admin" ? "Demote" : "Promote"}
                        </button>
                        <button
                          onClick={() => resetPassword(u.id, u.email)}
                          disabled={busy}
                          className="text-xs text-zinc-400 hover:text-white px-2 py-1 disabled:opacity-50"
                        >
                          Reset pw
                        </button>
                        <button
                          onClick={() => deleteUser(u.id, u.email)}
                          disabled={busy}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 disabled:opacity-50"
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

        {/* ═══ ACCOUNT ACCESS MODAL ═══ */}
        {editAccessId && editingUser && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setEditAccessId(null);
            }}
          >
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold">
                  Account access · {editingUser.email}
                </h2>
                <button
                  onClick={() => setEditAccessId(null)}
                  className="text-zinc-500 hover:text-white text-xl"
                >
                  &times;
                </button>
              </div>
              <p className="text-sm text-zinc-400 mb-4">
                Check every TikTok account this user is allowed to post to.
                Unchecked accounts are hidden from them entirely.
              </p>
              {accounts.length === 0 ? (
                <p className="text-sm text-zinc-500">
                  No TikTok accounts returned by PostBridge.
                </p>
              ) : (
                <div className="space-y-2 mb-4">
                  {accounts.map((a) => {
                    const checked = editAccessIds.includes(a.id);
                    return (
                      <label
                        key={a.id}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          checked
                            ? "border-blue-500/50 bg-blue-500/10"
                            : "border-zinc-800 bg-zinc-900/30"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleAccess(a.id)}
                          className="rounded"
                        />
                        <span className="text-sm">@{a.username}</span>
                        <span className="text-[10px] text-zinc-600 ml-auto">
                          ID: {a.id}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              <button
                onClick={saveAccess}
                disabled={savingAccess}
                className="w-full rounded-lg bg-white text-black py-2 text-sm font-medium hover:bg-zinc-200 transition-colors disabled:opacity-50"
              >
                {savingAccess ? "Saving…" : "Save access"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
