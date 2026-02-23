"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Simple popover state hook. Returns isOpen state and toggle/close callbacks.
 * The consumer must wrap trigger + panel in a single container div and pass
 * `onMouseDown` to catch outside clicks via the returned `getContainerProps`.
 */
export function usePopover() {
  const [isOpen, setIsOpen] = useState(false);
  const [containerEl, setContainerEl] = useState<HTMLElement | null>(null);

  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);
  const close = useCallback(() => setIsOpen(false), []);

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    setContainerEl(node);
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

  return { isOpen, toggle, close, setContainerRef };
}
