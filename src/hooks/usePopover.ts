"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Simple popover state hook. Returns isOpen state and toggle/close callbacks.
 * Supports both click (toggle) and hover (with configurable delay).
 */
export function usePopover({ hoverDelay = 200 }: { hoverDelay?: number } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);
  const open = useCallback(() => setIsOpen(true), []);

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
  }, []);

  const handleMouseEnter = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setIsOpen(true), hoverDelay);
  }, [hoverDelay]);

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => setIsOpen(false), 150);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !containerEl) return;
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (containerEl.contains(target)) return;
      setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, containerEl]);

  return { isOpen, toggle, close, open, setContainerRef, handleMouseEnter, handleMouseLeave };
}
