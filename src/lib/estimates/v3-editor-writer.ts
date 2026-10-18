/**
 * Lot 2, sous-lot 2.6 (revue du 18/10/2026) - écritures de la grille v3 hors saisie d'une cellule.
 *
 * Une v3 porte ses montants stockés sous D12 : toute écriture de ses lignes passe par l'écrivain de lot de 2.5
 * (`POST /api/estimates/{id}/batch`), qui recalcule chaque ligne et les totaux de version et les vérifie dans la
 * même transaction. Les routes directes (`DELETE /items`, `POST /items/bulk`, `PATCH /items`) ne recalculent rien et
 * refusent une v3 par le message générique du moteur 3. Ce module donne aux contrôleurs saturés de l'éditeur
 * (éléments, actions en lot, suggestions) les écritures v3 qu'ils délèguent : suppression, mise à jour de lignes,
 * recréation et recalcul après un changement de taux horaire. Contrat : docs/testing/estimate-engine-v3-2.6.md §11.
 */
import { createEstimateBatchAttempt } from "@/lib/estimates/batch-intentions";
import {
  batchEstimateOperations,
  type EstimateBatchOperation,
  type EstimateVersionToken,
} from "@/lib/estimates/client";
import type { EstimateItem, EstimateItemInsertPayload, EstimateItemUpdatePayload } from "@/lib/estimates/editor-items";
import {
  buildEstimateV3ItemInsertPayload,
  buildEstimateV3ItemUpdatePayload,
  toEstimateV3ItemWrite,
} from "@/lib/estimates/v3-editor";

/** Refus nommé du collage tant que son contrat v3 (unité du référentiel, heures par unité) n'est pas fixé. */
export const ESTIMATE_V3_PASTE_UNAVAILABLE_MESSAGE =
  "Le collage de lignes n’est pas encore disponible pour un devis au moteur de calcul 3 : saisissez les lignes dans la grille (unité du référentiel, heures par unité).";

/** Un lot v3 validé : jeton de version acquitté (avec sa révision de contenu) ; sinon, l'erreur nommée du lot. */
export async function commitEstimateV3Operations(
  versionId: string,
  updatedAt: string,
  operations: EstimateBatchOperation[],
  failureMessage: string
): Promise<EstimateVersionToken> {
  const result = await batchEstimateOperations(versionId, updatedAt, operations, { attempt: createEstimateBatchAttempt() });
  if (!result.committed) {
    const failed = result.results.find((entry) => entry.status === "error");
    throw new Error(failed?.status === "error" ? failed.message : failureMessage);
  }
  return result.currentVersionToken?.updated_at === result.versionToken.updated_at
    ? result.currentVersionToken
    : result.versionToken;
}

/** Suppression de lignes ou de sections (une section emporte ses enfants) en un seul lot, atomique. */
export function deleteEstimateV3Items(versionId: string, updatedAt: string, itemIds: readonly string[]) {
  return commitEstimateV3Operations(versionId, updatedAt, itemIds.map((id) => ({ op: "delete" as const, id })),
    itemIds.length > 1 ? "Impossible de supprimer les lignes sélectionnées." : "Impossible de supprimer la ligne.");
}

/** Mises à jour de lignes en un seul lot : saisies seulement, jamais d'heures totales ni de projection (D4, D12). */
export function writeEstimateV3ItemUpdates(
  versionId: string,
  updatedAt: string,
  updates: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>
) {
  return commitEstimateV3Operations(versionId, updatedAt,
    updates.map((entry) => ({ op: "update" as const, id: entry.id, data: toEstimateV3ItemWrite(entry.updates) })),
    "Impossible d'enregistrer les lignes.");
}

/**
 * Après l'enregistrement du taux horaire d'un rôle (F26-23) : un lot v3 sur une ligne qui porte ce rôle, sans rien
 * changer à ses saisies, fait recalculer et stocker toutes les lignes et les totaux au nouveau taux (le lot v3
 * projette toujours toutes les lignes). Sans ligne concernée, rien n'est écrit (rend `null`).
 */
export function recomputeEstimateV3AfterLaborRate(
  versionId: string,
  updatedAt: string,
  items: readonly EstimateItem[],
  roleId: string
): Promise<EstimateVersionToken> | null {
  const line = items.find((item) => item.item_type === "line" && !item.id.startsWith("tmp:") &&
    [item.labor_role_id, item.labor_role_atelier_id, item.labor_role_chantier_id].includes(roleId));
  if (!line) return null;
  return commitEstimateV3Operations(versionId, updatedAt,
    [{ op: "update", id: line.id, data: { labor_role_id: line.labor_role_id ?? null } }],
    "Les montants du devis n'ont pas été recalculés au nouveau taux horaire.");
}

/** Écritures déléguées par les contrôleurs de l'éditeur quand la version est au moteur 3. */
export type EstimateV3EditorWriter = {
  deleteItems: (versionId: string, updatedAt: string, itemIds: readonly string[]) => Promise<EstimateVersionToken>;
  updateItems: (
    versionId: string,
    updatedAt: string,
    updates: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>
  ) => Promise<EstimateVersionToken>;
  buildInsertPayload: (
    versionId: string,
    item: EstimateItem,
    overrides?: { parentId?: string | null; position?: number; title?: string }
  ) => EstimateItemInsertPayload;
  buildUpdatePayload: (item: EstimateItem) => EstimateItemUpdatePayload;
};

export const ESTIMATE_V3_EDITOR_WRITER: EstimateV3EditorWriter = {
  deleteItems: deleteEstimateV3Items,
  updateItems: writeEstimateV3ItemUpdates,
  buildInsertPayload: buildEstimateV3ItemInsertPayload,
  buildUpdatePayload: buildEstimateV3ItemUpdatePayload,
};
