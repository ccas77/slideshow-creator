"use client";

import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState, useCallback } from "react";

export interface BackgroundGradientAnimationProps {
  gradientBackgroundStart?: string;
  gradientBackgroundEnd?: string;
  firstColor?: string;
  secondColor?: string;
  thirdColor?: string;
  fourthColor?: string;
  fifthColor?: string;
  pointerColor?: string;
  size?: string;
  blendingValue?: string;
  interactive?: boolean;
  children?: React.ReactNode;
  className?: string;
  containerClassName?: string;
}

export function BackgroundGradientAnimation({
  gradientBackgroundStart = "rgb(108, 0, 162)",
  gradientBackgroundEnd = "rgb(0, 17, 82)",
  firstColor = "18, 113, 255",
  secondColor = "221, 74, 255",
  thirdColor = "100, 220, 255",
  fourthColor = "200, 50, 50",
  fifthColor = "180, 180, 50",
  pointerColor = "140, 100, 255",
  size = "80%",
  blendingValue = "hard-light",
  interactive = true,
  children,
  className,
  containerClassName,
}: BackgroundGradientAnimationProps) {
  const interactiveRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [curX, setCurX] = useState(0);
  const [curY, setCurY] = useState(0);
  const [tgX, setTgX] = useState(0);
  const [tgY, setTgY] = useState(0);
  const [isSafari, setIsSafari] = useState(false);

  useEffect(() => {
    setIsSafari(/^((?!chrome|android).)*safari/i.test(navigator.userAgent));
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    container.style.setProperty("--gradient-background-start", gradientBackgroundStart);
    container.style.setProperty("--gradient-background-end", gradientBackgroundEnd);
    container.style.setProperty("--first-color", firstColor);
    container.style.setProperty("--second-color", secondColor);
    container.style.setProperty("--third-color", thirdColor);
    container.style.setProperty("--fourth-color", fourthColor);
    container.style.setProperty("--fifth-color", fifthColor);
    container.style.setProperty("--pointer-color", pointerColor);
    container.style.setProperty("--size", size);
    container.style.setProperty("--blending-value", blendingValue);
  }, [
    gradientBackgroundStart,
    gradientBackgroundEnd,
    firstColor,
    secondColor,
    thirdColor,
    fourthColor,
    fifthColor,
    pointerColor,
    size,
    blendingValue,
  ]);

  useEffect(() => {
    let animationFrameId: number;

    function move() {
      if (!interactiveRef.current) {
        animationFrameId = requestAnimationFrame(move);
        return;
      }
      setCurX((prev) => prev + (tgX - prev) / 20);
      setCurY((prev) => prev + (tgY - prev) / 20);
      interactiveRef.current.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`;
      animationFrameId = requestAnimationFrame(move);
    }

    animationFrameId = requestAnimationFrame(move);
    return () => cancelAnimationFrame(animationFrameId);
  }, [curX, curY, tgX, tgY]);

  const handleMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (interactive) {
        setTgX(event.clientX);
        setTgY(event.clientY);
      }
    },
    [interactive]
  );

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={cn(
        "relative h-screen w-full overflow-hidden bg-[linear-gradient(40deg,var(--gradient-background-start),var(--gradient-background-end))]",
        containerClassName
      )}
    >
      <svg className="hidden">
        <defs>
          <filter id="blurMe">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
      <div className={cn("", className)}>{children}</div>
      <div
        className={cn(
          "gradients-container absolute inset-0 h-full w-full blur-lg",
          isSafari ? "blur-2xl" : "[filter:url(#blurMe)_blur(40px)]"
        )}
      >
        <div
          className={cn(
            "absolute [background:radial-gradient(circle_at_center,_rgba(var(--first-color),_0.8)_0,_rgba(var(--first-color),_0)_50%)_no-repeat]",
            "left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)]",
            "mix-blend-[var(--blending-value)]",
            "animate-first opacity-100"
          )}
        />
        <div
          className={cn(
            "absolute [background:radial-gradient(circle_at_center,_rgba(var(--second-color),_0.8)_0,_rgba(var(--second-color),_0)_50%)_no-repeat]",
            "left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)]",
            "mix-blend-[var(--blending-value)]",
            "animate-second opacity-100"
          )}
        />
        <div
          className={cn(
            "absolute [background:radial-gradient(circle_at_center,_rgba(var(--third-color),_0.8)_0,_rgba(var(--third-color),_0)_50%)_no-repeat]",
            "left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)]",
            "mix-blend-[var(--blending-value)]",
            "animate-third opacity-100"
          )}
        />
        <div
          className={cn(
            "absolute [background:radial-gradient(circle_at_center,_rgba(var(--fourth-color),_0.8)_0,_rgba(var(--fourth-color),_0)_50%)_no-repeat]",
            "left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)]",
            "mix-blend-[var(--blending-value)]",
            "animate-fourth opacity-100"
          )}
        />
        <div
          className={cn(
            "absolute [background:radial-gradient(circle_at_center,_rgba(var(--fifth-color),_0.8)_0,_rgba(var(--fifth-color),_0)_50%)_no-repeat]",
            "left-[calc(50%-var(--size)/2)] top-[calc(50%-var(--size)/2)] h-[var(--size)] w-[var(--size)]",
            "mix-blend-[var(--blending-value)]",
            "animate-fifth opacity-100"
          )}
        />
        {interactive && (
          <div
            ref={interactiveRef}
            className={cn(
              "absolute [background:radial-gradient(circle_at_center,_rgba(var(--pointer-color),_0.8)_0,_rgba(var(--pointer-color),_0)_50%)_no-repeat]",
              "-left-1/2 -top-1/2 h-full w-full",
              "mix-blend-[var(--blending-value)]",
              "opacity-70"
            )}
          />
        )}
      </div>
    </div>
  );
}
