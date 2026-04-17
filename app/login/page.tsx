"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed");
        setLoading(false);
        return;
      }
      const next = params.get("next") || "/";
      router.push(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-xl p-6 shadow-xl"
    >
      <h1 className="text-2xl font-bold text-white mb-1">Sign in</h1>
      <p className="text-sm text-zinc-500 mb-6">Slideshow Creator</p>

      <label className="block text-sm text-zinc-400 mb-2">Email</label>
      <input
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500"
      />

      <label className="block text-sm text-zinc-400 mb-2">Password</label>
      <input
        type="password"
        autoComplete="current-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-zinc-500"
      />

      {error && <div className="text-sm text-red-400 mb-4">{error}</div>}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-white text-zinc-900 font-medium rounded-lg py-2 text-sm hover:bg-zinc-200 transition-colors disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
