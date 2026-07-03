"use client";

import { useEffect, useRef } from "react";

/**
 * Subtle Matrix-style digital rain rendered on a full-screen canvas that sits
 * behind all content. Kept low-contrast and low-density on purpose so it reads
 * as atmosphere, not noise. Skipped entirely when the user prefers reduced
 * motion.
 */
export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;

    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const GLYPHS = "アイウエオカキクケコサシスセソ0123456789<>[]{}=/*-+".split("");
    const FONT = 15;
    let columns = 0;
    let drops: number[] = [];

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      columns = Math.floor(canvas!.width / FONT);
      drops = Array.from({ length: columns }, () =>
        Math.floor((Math.random() * canvas!.height) / FONT)
      );
    }
    resize();
    window.addEventListener("resize", resize);

    let frame = 0;
    let raf = 0;

    function draw() {
      // Fade the previous frame to leave green trails.
      ctx!.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx!.fillRect(0, 0, canvas!.width, canvas!.height);

      ctx!.font = `${FONT}px monospace`;
      for (let i = 0; i < drops.length; i++) {
        const char = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
        const x = i * FONT;
        const y = drops[i] * FONT;

        // Occasionally brighten the leading glyph for a shimmer.
        ctx!.fillStyle =
          Math.random() > 0.975 ? "rgba(180, 255, 200, 0.9)" : "rgba(0, 255, 65, 0.55)";
        ctx!.fillText(char, x, y);

        if (y > canvas!.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    }

    function loop() {
      // Throttle to ~15fps so the rain stays calm and cheap.
      if (frame++ % 4 === 0) draw();
      raf = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={ref} className="matrix-rain" aria-hidden="true" />;
}
