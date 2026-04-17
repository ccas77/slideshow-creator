"use client";

import { BackgroundGradientAnimation } from "@/components/ui/background-gradient-animation";
import { motion } from "framer-motion";

export function HeroSection() {
  return (
    <BackgroundGradientAnimation
      gradientBackgroundStart="rgb(15, 23, 42)"
      gradientBackgroundEnd="rgb(8, 4, 36)"
      firstColor="59, 130, 246"
      secondColor="139, 92, 246"
      thirdColor="236, 72, 153"
      fourthColor="34, 211, 238"
      fifthColor="99, 102, 241"
      pointerColor="168, 85, 247"
      size="80%"
      blendingValue="hard-light"
      interactive={true}
      containerClassName="min-h-screen"
    >
      <div className="absolute inset-0 z-50 flex items-center justify-center">
        <div className="mx-auto max-w-4xl px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="flex flex-col items-center gap-8"
          >
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/70 backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Now available for everyone
              </span>
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              className="text-5xl font-bold leading-[1.1] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-8xl"
            >
              <span className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-transparent">
                Build products
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-400 via-violet-400 to-pink-400 bg-clip-text text-transparent">
                that matter.
              </span>
            </motion.h1>

            {/* Subheadline */}
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="max-w-2xl text-lg font-light leading-relaxed text-white/60 sm:text-xl"
            >
              Engineered for performance. Designed for scale.
              The platform that turns your boldest ideas into
              reality — faster than ever before.
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.7 }}
              className="flex flex-col items-center gap-4 sm:flex-row"
            >
              <button className="group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-full bg-white px-8 text-base font-semibold text-slate-900 transition-all duration-300 hover:scale-105 hover:shadow-[0_0_40px_rgba(255,255,255,0.2)]">
                <span>Get started free</span>
                <svg
                  className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>
              <button className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/15 bg-white/5 px-8 text-base font-medium text-white/80 backdrop-blur-sm transition-all duration-300 hover:border-white/25 hover:bg-white/10">
                See how it works
              </button>
            </motion.div>

            {/* Social proof */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1, delay: 1 }}
              className="flex items-center gap-3 pt-4"
            >
              <div className="flex -space-x-2">
                {[...Array(5)].map((_, i) => (
                  <div
                    key={i}
                    className="h-8 w-8 rounded-full border-2 border-slate-900 bg-gradient-to-br from-violet-400 to-blue-400"
                    style={{ opacity: 1 - i * 0.1 }}
                  />
                ))}
              </div>
              <p className="text-sm text-white/50">
                Trusted by <span className="font-medium text-white/70">2,000+</span> teams
              </p>
            </motion.div>
          </motion.div>
        </div>
      </div>
    </BackgroundGradientAnimation>
  );
}
