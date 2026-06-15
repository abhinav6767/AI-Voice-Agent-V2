"use client";

import { useEffect, useRef } from "react";

export default function MouseEffect() {
  const glowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let rafId: number;
    let pendingX = 0;
    let pendingY = 0;
    let hasPendingUpdate = false;

    const updatePosition = () => {
      if (glowRef.current) {
        glowRef.current.style.background = `radial-gradient(600px circle at ${pendingX}px ${pendingY}px, rgba(99, 102, 241, 0.08), transparent 40%)`;
      }
      hasPendingUpdate = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingX = e.clientX;
      pendingY = e.clientY;
      if (!hasPendingUpdate) {
        hasPendingUpdate = true;
        rafId = requestAnimationFrame(updatePosition);
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <div
      ref={glowRef}
      className="pointer-events-none fixed inset-0 z-0 transition-opacity duration-300"
      style={{
        background: `radial-gradient(600px circle at -1000px -1000px, rgba(99, 102, 241, 0.08), transparent 40%)`,
      }}
    />
  );
}
