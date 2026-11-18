"use client";

import { useEffect, useRef } from "react";

import { deferEffectStateUpdate } from "@/hooks/useEstimateEditorAutoSave";

/**
 * Highlights the line the editor is opened on (`focusItemId`: the landing after « Envoyer au tableau de chiffrage », a
 * line named elsewhere) once, as soon as its version is shown (`versionShown`). Asked before, the editor's highlighting
 * ignores the request (its route scope is not current until the version is loaded), and the line arrived unmarked.
 */
export function useFocusItemHighlight(focusItemId: string | null, versionShown: boolean,
  highlight: (itemIds: readonly string[]) => void) {
  const highlighted = useRef<string | null>(null);
  useEffect(() => {
    if (!focusItemId || !versionShown || highlighted.current === focusItemId) return;
    return deferEffectStateUpdate(() => {
      highlighted.current = focusItemId;
      highlight([focusItemId]);
    });
  }, [focusItemId, highlight, versionShown]);
}
