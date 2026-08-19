import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EditorConflictDraft } from "@/lib/estimates/editor-drafts";
import type { EstimateItem } from "@/lib/estimates/editor-items";

export const AUTOSAVE_DEBOUNCE_MS = 2000;
export const AUTOSAVE_IMMEDIATE_FLUSH_UPDATES = 100;

export type EstimateEditorConflictState = {
  message: string;
  details: unknown;
};

export type EstimateEditorConflictDraft = EditorConflictDraft<
  EstimateSettingsState,
  EstimateItem
>;

export type RestoredDraftApplication = {
  restoredItems: EstimateItem[];
  skippedItemCount: number;
};
