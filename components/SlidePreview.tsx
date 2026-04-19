"use client";

import { useState } from "react";

interface SlidePreviewProps {
  slides: string[];
  caption?: string;
  coverImage?: string;
  onClose: () => void;
}

export default function SlidePreview({ slides, caption, coverImage, onClose }: SlidePreviewProps) {
  const totalSlides = slides.length + (coverImage ? 1 : 0);
  const [current, setCurrent] = useState(0);
  if (totalSlides === 0) return null;

  const isCoverSlide = coverImage && current === totalSlides - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-xs mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Phone frame */}
        <div className="relative aspect-[9/16] rounded-2xl overflow-hidden bg-gradient-to-br from-gray-100 via-gray-200 to-gray-100 shadow-2xl border border-gray-200">
          {isCoverSlide ? (
            /* Cover image slide */
            <img src={coverImage} alt="Book cover" className="absolute inset-0 w-full h-full object-contain bg-white" />
          ) : (
            /* Text slide */
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="text-center">
                <p className="text-gray-900 text-sm leading-relaxed font-medium">
                  {slides[current]}
                </p>
                <div className="text-[10px] text-gray-400 uppercase tracking-widest mt-6">
                  Image generated at post time
                </div>
              </div>
            </div>
          )}

          {/* Slide counter */}
          <div className="absolute top-3 right-3 bg-black/30 text-white text-[10px] px-2 py-0.5 rounded-full">
            {current + 1}/{totalSlides}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-center gap-4 mt-3">
          <button
            onClick={() => setCurrent(Math.max(0, current - 1))}
            disabled={current === 0}
            className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30 transition-colors"
          >
            &larr; Prev
          </button>
          <div className="flex gap-1">
            {Array.from({ length: totalSlides }).map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${i === current ? "bg-blue-500" : "bg-gray-300"}`}
              />
            ))}
          </div>
          <button
            onClick={() => setCurrent(Math.min(totalSlides - 1, current + 1))}
            disabled={current === totalSlides - 1}
            className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-30 transition-colors"
          >
            Next &rarr;
          </button>
        </div>

        {/* Caption */}
        {caption && (
          <div className="mt-3 text-xs text-gray-600 bg-white border border-gray-200 rounded-xl p-3 max-h-20 overflow-y-auto shadow-sm">
            <span className="text-gray-400 uppercase text-[10px] tracking-wide block mb-1">Caption</span>
            {caption}
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          className="mt-3 w-full text-xs text-gray-500 hover:text-gray-900 transition-colors py-1"
        >
          Close preview
        </button>
      </div>
    </div>
  );
}
