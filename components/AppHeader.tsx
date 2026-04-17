"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface Me {
  id: string;
  email: string;
  role: "admin" | "user";
}

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setMe(data.user || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {}
    router.push("/login");
    router.refresh();
  }

  const link = (href: string, label: string) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        className={`text-sm transition-colors ${
          active ? "text-white font-medium" : "text-zinc-500 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="flex items-center justify-between gap-4 mb-8 flex-wrap">
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="text-lg font-bold text-white shrink-0">Slideshow Creator</div>
        <nav className="flex items-center gap-4 flex-wrap">
          {link("/", "Home")}
          {link("/create", "Create")}
          {link("/books", "Books")}
          {link("/top-books", "Top Books")}
          {link("/posts", "Posts")}
          {me?.role === "admin" && (
            <Link
              href="/admin"
              className={`text-sm transition-colors px-2 py-0.5 rounded ${
                pathname === "/admin"
                  ? "bg-amber-500/20 text-amber-300 font-medium"
                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {me && (
          <span className="text-xs text-zinc-500 hidden md:inline">
            {me.email}
          </span>
        )}
        <button
          onClick={logout}
          className="text-sm text-zinc-500 hover:text-white transition-colors"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
