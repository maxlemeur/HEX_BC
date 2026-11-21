"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { EstimateSettingsState, SettingsSection } from "@/lib/estimates/editor-settings-state";

/**
 * The editor's settings drawer: opened at a section (once at the section the route names, when the
 * settings are read), which it scrolls into view.
 */
export function useEstimateEditorSettingsDrawer({
  autoOpenSettingsSection,
  isLoading,
  settings,
}: {
  autoOpenSettingsSection: SettingsSection | null;
  isLoading: boolean;
  settings: EstimateSettingsState | null;
}) {
  const [isSettingsDrawerOpen, setIsSettingsDrawerOpen] = useState(false);
  const [drawerScrollTarget, setDrawerScrollTarget] = useState<SettingsSection | null>(null);
  const handleOpenSettingsDrawer = useCallback((section?: SettingsSection) => {
    setIsSettingsDrawerOpen(true);
    setDrawerScrollTarget(section ?? null);
  }, []);

  const autoOpenedSettingsRef = useRef(false);
  useEffect(() => {
    if (
      !autoOpenSettingsSection ||
      autoOpenedSettingsRef.current ||
      isLoading ||
      !settings
    ) {
      return;
    }

    autoOpenedSettingsRef.current = true;
    handleOpenSettingsDrawer(autoOpenSettingsSection);
  }, [
    autoOpenSettingsSection,
    handleOpenSettingsDrawer,
    isLoading,
    settings,
  ]);
  const drawerScrollTargetRef = useRef<SettingsSection | null>(null);
  useEffect(() => {
    drawerScrollTargetRef.current = drawerScrollTarget;
  }, [drawerScrollTarget]);
  useEffect(() => {
    if (!isSettingsDrawerOpen) return;
    const target = drawerScrollTargetRef.current;
    if (!target) return;
    drawerScrollTargetRef.current = null;
    setDrawerScrollTarget(null);
    const sectionIdMap: Record<SettingsSection, string> = {
      margin: "estimate-margin",
      discount: "estimate-discount",
      tax: "estimate-tax",
      rounding: "estimate-rounding",
      exclusions: "estimate-exclusions",
      general: "estimate-project-name",
    };
    const targetId = sectionIdMap[target];
    const scrollToTarget = () => {
      const el = document.getElementById(targetId);
      if (!el) return;
      let scrollable: HTMLElement | null = el.parentElement;
      while (scrollable) {
        const ov = getComputedStyle(scrollable).overflowY;
        if (ov === "auto" || ov === "scroll") break;
        scrollable = scrollable.parentElement;
      }
      if (scrollable) {
        const containerRect = scrollable.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = elRect.top - containerRect.top + scrollable.scrollTop - containerRect.height / 2;
        scrollable.scrollTo({ top: Math.max(0, offset), behavior: "smooth" });
      }
    };
    // Retry at increasing delays to handle drawer animation and async renders
    const delays = [50, 150, 350];
    const timers = delays.map((delay) => setTimeout(scrollToTarget, delay));
    return () => timers.forEach(clearTimeout);
  }, [isSettingsDrawerOpen]);
  const closeSettingsDrawer = useCallback(() => {
    setIsSettingsDrawerOpen(false);
  }, []);

  return {
    isOpen: isSettingsDrawerOpen,
    open: handleOpenSettingsDrawer,
    close: closeSettingsDrawer,
  };
}
