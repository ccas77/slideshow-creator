"use client";

import { useState } from "react";

export default function HowItWorks({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>&#9654;</span>
        How this works
      </button>
      {open && (
        <div className="mt-2 text-xs text-gray-500 leading-relaxed bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}
