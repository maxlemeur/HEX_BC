import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EditorConflictDraft } from "@/lib/estimates/editor-drafts";
import type { EstimateItem } from "@/lib/estimates/editor-items";

/**
 * Cadence de la sauvegarde automatique de l'editeur de devis : une modification
 * est envoyee au plus tard une minute apres avoir ete saisie, jamais a chaque
 * frappe. `AUTOSAVE_MAX_WAIT_MS` garantit ce plafond meme si l'utilisateur
 * enchaine les modifications sans pause.
 */
export const AUTOSAVE_DEBOUNCE_MS = 60_000;
export const AUTOSAVE_MAX_WAIT_MS = 60_000;
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
