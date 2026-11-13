"use client";

import dynamic from "next/dynamic";
import { resolveActiveLineBreadcrumb } from "@/components/estimates/grid/EstimateGridActiveRow";
import type { EditorEstimateItem } from "@/lib/estimates/editor-items";

const AssemblyPicker = dynamic(() => import("@/components/estimates/AssemblyPicker").then(module => module.AssemblyPicker));
type Props = {
  isReadOnly: boolean; anchorItemId: string | null; items: ReadonlyMap<string, EditorEstimateItem>;
  onClose: () => void; onInsert: (assemblyId: string, afterItemId: string | null) => Promise<void>;
};

/** The captured insertion anchor survives focus changes while the picker is open. */
export function EstimateOuvrageInsertionPicker({ isReadOnly, anchorItemId, items, onClose, onInsert }: Props) {
  const label = anchorItemId
    ? `${resolveActiveLineBreadcrumb(anchorItemId, items, items) ?? "Chiffrage"} — après « ${items.get(anchorItemId)?.title ?? "la ligne sélectionnée"} »`
    : "à la fin du devis";
  return <AssemblyPicker isOpen isReadOnly={isReadOnly} anchorItemId={anchorItemId}
    anchorLabel={label} onClose={onClose} onInsert={id => onInsert(id, anchorItemId)} />;
}
