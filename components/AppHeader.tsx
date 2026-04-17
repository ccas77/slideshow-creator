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
          active ? "text-blue-500 font-medium" : "text-gray-500 hover:text-gray-900"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="flex items-center justify-between gap-4 mb-8 flex-wrap bg-white/80 backdrop-blur-xl border-b border-gray-200/60 -mx-6 sm:-mx-10 px-6 sm:px-10 py-4 -mt-10 mb-8 sticky top-0 z-40">
      <div className="flex items-center gap-4 flex-wrap min-w-0">
        <div className="text-lg font-bold text-gray-900 shrink-0">Slideshow Creator</div>
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
                  ? "bg-blue-50 text-blue-600 font-medium"
                  : "bg-blue-50 text-blue-600 hover:bg-blue-100"
              }`}
            >
              Admin
            </Link>
          )}
        </nav>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {me && (
          <span className="text-xs text-gray-500 hidden md:inline">
            {me.email}
          </span>
        )}
        <button
          onClick={logout}
          className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
