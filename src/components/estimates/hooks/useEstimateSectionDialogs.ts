"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

type SectionContextMenuState = {
  sectionId: string;
  right: number;
  y: number;
};

type EstimateSectionDuplicateTarget = {
  versionId: string;
  label: string;
};

type UseEstimateSectionDialogsParams = {
  isReadOnly: boolean;
  itemById: Map<string, EstimateItem>;
  itemsByParent: Map<string, EstimateItem[]>;
  availableSectionDuplicateTargets: EstimateSectionDuplicateTarget[];
  onDuplicateSection?: (sectionId: string) => Promise<void>;
  onDuplicateSectionToVersion?: (input: {
    sectionId: string;
    targetVersionId: string;
  }) => Promise<void>;
};

function collectLineDescendants(
  itemsByParent: Map<string, EstimateItem[]>,
  parentId: string
): EstimateItem[] {
  const children = itemsByParent.get(parentId) ?? [];
  const lines: EstimateItem[] = [];
  children.forEach((child) => {
    if (child.item_type === "line") {
      lines.push(child);
      return;
    }

    if (child.item_type === "section") {
      lines.push(...collectLineDescendants(itemsByParent, child.id));
    }
  });
  return lines;
}

export function useEstimateSectionDialogs({
  isReadOnly,
  itemById,
  itemsByParent,
  availableSectionDuplicateTargets,
  onDuplicateSection,
  onDuplicateSectionToVersion,
}: UseEstimateSectionDialogsParams) {
  const [sectionContextMenu, setSectionContextMenu] =
    useState<SectionContextMenuState | null>(null);
  const [duplicateSectionDialogSectionId, setDuplicateSectionDialogSectionId] =
    useState<string | null>(null);
  const [duplicateSectionTargetVersionId, setDuplicateSectionTargetVersionId] =
    useState("");
  const [isDuplicateSectionPending, setIsDuplicateSectionPending] = useState(false);
  const [saveAsAssemblyDialogSectionId, setSaveAsAssemblyDialogSectionId] =
    useState<string | null>(null);
  const [saveAsAssemblyName, setSaveAsAssemblyName] = useState("");
  const [isSaveAsAssemblyPending, setIsSaveAsAssemblyPending] = useState(false);
  const saveAsAssemblyNameInputRef = useRef<HTMLInputElement | null>(null);

  const closeSectionContextMenu = useCallback(() => {
    setSectionContextMenu(null);
  }, []);

  const handleOpenSectionContextMenu = useCallback(
    (sectionId: string, position: { x: number; y: number }) => {
      if (isReadOnly) return;

      const item = itemById.get(sectionId);
      if (!item || item.item_type !== "section") return;

      const menuHeight = 280;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      // position.x is the right edge of the trigger (button right edge or clientX)
      // Align menu right edge to position.x, clamped so it stays within the viewport
      const right = Math.max(8, vw - position.x);
      const y = Math.max(8, Math.min(position.y, vh - menuHeight - 8));

      setSectionContextMenu({
        sectionId,
        right,
        y,
      });
    },
    [isReadOnly, itemById]
  );

  const handleDuplicateSectionInPlace = useCallback(async () => {
    if (!sectionContextMenu || !onDuplicateSection) return;

    const targetSectionId = sectionContextMenu.sectionId;
    closeSectionContextMenu();
    await onDuplicateSection(targetSectionId);
  }, [closeSectionContextMenu, onDuplicateSection, sectionContextMenu]);

  const handleOpenDuplicateSectionDialog = useCallback(() => {
    if (!sectionContextMenu) return;

    const firstTargetVersionId = availableSectionDuplicateTargets[0]?.versionId ?? "";
    setDuplicateSectionDialogSectionId(sectionContextMenu.sectionId);
    setDuplicateSectionTargetVersionId(firstTargetVersionId);
    closeSectionContextMenu();
  }, [availableSectionDuplicateTargets, closeSectionContextMenu, sectionContextMenu]);

  const closeDuplicateSectionDialog = useCallback(() => {
    if (isDuplicateSectionPending) return;

    setDuplicateSectionDialogSectionId(null);
    setDuplicateSectionTargetVersionId("");
  }, [isDuplicateSectionPending]);

  const handleConfirmDuplicateSectionToVersion = useCallback(async () => {
    if (!duplicateSectionDialogSectionId) return;
    if (!duplicateSectionTargetVersionId) return;
    if (!onDuplicateSectionToVersion) return;

    setIsDuplicateSectionPending(true);
    try {
      await onDuplicateSectionToVersion({
        sectionId: duplicateSectionDialogSectionId,
        targetVersionId: duplicateSectionTargetVersionId,
      });
      setDuplicateSectionDialogSectionId(null);
      setDuplicateSectionTargetVersionId("");
    } finally {
      setIsDuplicateSectionPending(false);
    }
  }, [
    duplicateSectionDialogSectionId,
    duplicateSectionTargetVersionId,
    onDuplicateSectionToVersion,
  ]);

  const handleOpenSaveAsAssemblyDialog = useCallback(() => {
    if (!sectionContextMenu) return;
    const section = itemById.get(sectionContextMenu.sectionId);
    setSaveAsAssemblyName(section?.title ?? "");
    setSaveAsAssemblyDialogSectionId(sectionContextMenu.sectionId);
    closeSectionContextMenu();
  }, [closeSectionContextMenu, itemById, sectionContextMenu]);

  const closeSaveAsAssemblyDialog = useCallback(() => {
    if (isSaveAsAssemblyPending) return;
    setSaveAsAssemblyDialogSectionId(null);
    setSaveAsAssemblyName("");
  }, [isSaveAsAssemblyPending]);

  const handleConfirmSaveAsAssembly = useCallback(async () => {
    if (!saveAsAssemblyDialogSectionId || !saveAsAssemblyName.trim()) return;

    const lines = collectLineDescendants(itemsByParent, saveAsAssemblyDialogSectionId);
    if (lines.length === 0) {
      setSaveAsAssemblyDialogSectionId(null);
      setSaveAsAssemblyName("");
      return;
    }

    setIsSaveAsAssemblyPending(true);
    try {
      const assemblyItems = lines.map((line, index) => ({
        title: line.title ?? "Ligne",
        unit: line.description ?? undefined,
        k_fo: line.k_fo ?? undefined,
        k_mo: line.k_mo ?? undefined,
        labor_role_id: line.labor_role_id ?? undefined,
        default_quantity: line.quantity ?? undefined,
        position: index + 1,
      }));

      const response = await fetch("/api/estimates/assemblies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: saveAsAssemblyName.trim(),
          items: assemblyItems,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        console.error(
          "Save as assembly failed:",
          data && typeof data === "object" ? data : "Unknown error"
        );
      }

      setSaveAsAssemblyDialogSectionId(null);
      setSaveAsAssemblyName("");
    } catch (error) {
      console.error("Save as assembly error:", error);
    } finally {
      setIsSaveAsAssemblyPending(false);
    }
  }, [itemsByParent, saveAsAssemblyDialogSectionId, saveAsAssemblyName]);

  useEffect(() => {
    if (!sectionContextMenu) return;

    const closeMenu = () => setSectionContextMenu(null);
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest(".estimate-section-context-menu")
      ) {
        return;
      }
      closeMenu();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
    };

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [sectionContextMenu]);

  useEffect(() => {
    if (!sectionContextMenu) return;
    const item = itemById.get(sectionContextMenu.sectionId);
    if (!item || item.item_type !== "section") {
      setSectionContextMenu(null);
    }
  }, [itemById, sectionContextMenu]);

  useEffect(() => {
    if (!duplicateSectionDialogSectionId) return;
    const item = itemById.get(duplicateSectionDialogSectionId);
    if (!item || item.item_type !== "section") {
      setDuplicateSectionDialogSectionId(null);
      setDuplicateSectionTargetVersionId("");
    }
  }, [duplicateSectionDialogSectionId, itemById]);

  useEffect(() => {
    if (!saveAsAssemblyDialogSectionId) return;
    saveAsAssemblyNameInputRef.current?.focus();
  }, [saveAsAssemblyDialogSectionId]);

  return {
    sectionContextMenu,
    closeSectionContextMenu,
    handleOpenSectionContextMenu,
    handleDuplicateSectionInPlace,
    handleOpenDuplicateSectionDialog,
    closeDuplicateSectionDialog,
    handleConfirmDuplicateSectionToVersion,
    duplicateSectionDialogSectionId,
    duplicateSectionTargetVersionId,
    setDuplicateSectionTargetVersionId,
    isDuplicateSectionPending,
    handleOpenSaveAsAssemblyDialog,
    closeSaveAsAssemblyDialog,
    handleConfirmSaveAsAssembly,
    saveAsAssemblyDialogSectionId,
    saveAsAssemblyName,
    setSaveAsAssemblyName,
    saveAsAssemblyNameInputRef,
    isSaveAsAssemblyPending,
  };
}

export type UseEstimateSectionDialogsResult = ReturnType<
  typeof useEstimateSectionDialogs
>;
