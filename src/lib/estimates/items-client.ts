import type { EstimateVersionToken, BulkUpdateEstimateVersionPatch } from "@/lib/estimates/client-version";
import { jsonRequest } from "@/lib/estimates/client-http";
import { requestJson } from "@/lib/estimates/client-requests";
import type { EstimateItem } from "@/lib/estimates/editor-read-client";
import { parseEstimateItemWriteResponse, parseBulkUpdateEstimateItemsResponse } from "@/lib/estimates/write-response-contracts";
import { parseEstimateItemDeleteResponse, parseEstimateItemsMoveResponse, parseEstimateItemsReorderResponse } from "@/lib/estimates/item-structure-contracts";
import type { MoveEstimateItemInput } from "@/lib/estimates/schemas";
import type { Database } from "@/types/database";

type EstimateMutationVersionTokenOptions = {
  onVersionToken?: (versionToken: EstimateVersionToken) => void;
  /** The caller confirms the returned row and token together in its document. */
  documentOwnsReceipt?: boolean;
};

export type BulkUpdateEstimateItemsResult = {
  updatedCount: number;
  versionToken: EstimateVersionToken;
  totals?: BulkUpdateEstimateVersionPatch;
};

export async function bulkUpdateEstimateItems(
  versionId: string,
  updatedAtToken: string,
  updates: Array<{
    id: string;
    updates: Database["public"]["Tables"]["estimate_items"]["Update"];
  }>,
  versionPatch?: BulkUpdateEstimateVersionPatch
): Promise<BulkUpdateEstimateItemsResult> {
  if (updates.length === 0 && !versionPatch) {
    return {
      updatedCount: 0,
      versionToken: {
        id: versionId,
        updated_at: updatedAtToken,
      },
    };
  }

  const payload = await requestJson(
    `/api/estimates/${versionId}/items/bulk`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": updatedAtToken,
      },
      body: JSON.stringify({
        updated_at: updatedAtToken,
        updates: updates.map((entry) => ({
          id: entry.id,
          ...entry.updates,
        })),
        ...(versionPatch ? { version_patch: versionPatch } : {}),
      }),
    },
    "Impossible de mettre à jour les lignes.",
    value => parseBulkUpdateEstimateItemsResponse(value, versionId),
    { mutation: { versionId: versionId, structural: false } }
  );

  return { updatedCount: payload.updated_count, versionToken: payload.version, ...(payload.totals ? { totals: payload.totals } : {}) };
}

// Lot 2, sous-lot 2.6 (revue) : colonnes de saisie d'une ligne v3 (D4, D9), transmises à la création.
const V3_CREATE_INPUT_KEYS = ["unit_code", "pricing_status", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit"] as const;

export function toCreateEstimateItemBody(
  item: Database["public"]["Tables"]["estimate_items"]["Insert"]
) {
  const itemWithSource = item as typeof item & {
    h_mo_majoration?: number | null;
    supply_type_id?: string | null;
    product_id?: string | null;
    selected_supplier_price_id?: string | null;
    source_provider?: string | null;
    source_job_id?: string | null;
    source_file_name?: string | null;
    source_page?: number | null;
  };

  return item.item_type === "section"
    ? {
        item_type: "section" as const,
        parent_id: item.parent_id ?? null,
        position: item.position,
        title: item.title,
        aid: item.aid ?? null,
        source_provider: itemWithSource.source_provider ?? null,
        source_job_id: itemWithSource.source_job_id ?? null,
        source_file_name: itemWithSource.source_file_name ?? null,
        source_page: itemWithSource.source_page ?? null,
      }
    : {
        item_type: "line" as const,
        line_nature: item.line_nature ?? undefined,
        parent_id: item.parent_id ?? null,
        position: item.position,
        title: item.title,
        aid: item.aid ?? null,
        description: item.description ?? null,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        ...(typeof item.k_fo_manual === "boolean" ? { k_fo_manual: item.k_fo_manual } : {}),
        ...(item.fo_price_origin !== undefined ? { fo_price_origin: item.fo_price_origin } : {}),
        h_mo: item.h_mo,
        h_mo_majoration: itemWithSource.h_mo_majoration ?? undefined,
        h_mo_atelier: item.h_mo_atelier,
        k_mo_atelier: item.k_mo_atelier,
        labor_role_atelier_id: item.labor_role_atelier_id,
        h_mo_chantier: item.h_mo_chantier,
        k_mo_chantier: item.k_mo_chantier,
        labor_role_chantier_id: item.labor_role_chantier_id,
        k_mo: item.k_mo,
        labor_role_id: item.labor_role_id ?? null,
        category_id: item.category_id ?? null,
        supply_type_id: itemWithSource.supply_type_id ?? null,
        ...(itemWithSource.product_id
          ? { product_id: itemWithSource.product_id }
          : {}),
        selected_supplier_price_id: itemWithSource.selected_supplier_price_id ?? null,
        source_provider: itemWithSource.source_provider ?? null,
        source_job_id: itemWithSource.source_job_id ?? null,
        source_file_name: itemWithSource.source_file_name ?? null,
        source_page: itemWithSource.source_page ?? null,
        // Lot 2, sous-lot 2.6 (revue) : saisies d'une ligne v3, seulement quand la charge les porte (recréation
        // d'une ligne v3) ; une charge v1/v2 n'en porte aucune et reste identique.
        ...Object.fromEntries(V3_CREATE_INPUT_KEYS.flatMap((key) => (item[key] === undefined ? [] : [[key, item[key]]]))),
      };
}

export async function createEstimateItem(
  versionId: string,
  item: Database["public"]["Tables"]["estimate_items"]["Insert"],
  options: EstimateMutationVersionTokenOptions = {}
): Promise<EstimateItem> {
  const body = toCreateEstimateItemBody(item);
  let acknowledgedVersion: EstimateVersionToken | undefined;
  const documentOwnsReceipt = options.documentOwnsReceipt === true && Boolean(options.onVersionToken);

  const payload = await requestJson(
    `/api/estimates/${versionId}/items`,
    jsonRequest("POST", body),
    "Impossible d'ajouter la ligne.",
    value => parseEstimateItemWriteResponse(value, versionId),
    { mutation: { versionId: versionId, structural: true },
      ...(documentOwnsReceipt ? {
      deferVersionPublication: true,
      onAcknowledgedVersion: (version) => { acknowledgedVersion = version; },
    } : undefined)
    }
  );

  if (options.onVersionToken) {
    const versionToken = acknowledgedVersion ?? payload.version;
    options.onVersionToken(versionToken);
  }

  return payload.item;
}

export async function updateEstimateItem(
  versionId: string,
  itemId: string,
  updates: Database["public"]["Tables"]["estimate_items"]["Update"]
): Promise<void> {
  await requestJson(
    `/api/estimates/${versionId}/items`,
    jsonRequest("PATCH", {
      id: itemId,
      ...updates,
    }),
    "Impossible de mettre à jour la ligne.",
    value => parseEstimateItemWriteResponse(value, versionId, itemId),
    { mutation: { versionId: versionId, structural: true } }
  );
}

export async function deleteEstimateItem(
  versionId: string,
  itemId: string
): Promise<{ versionToken: EstimateVersionToken; deletedIds: string[] }> {
  const receipt = await requestJson(
    `/api/estimates/${versionId}/items`,
    jsonRequest("DELETE", {
      id: itemId,
    }),
    "Impossible de supprimer la ligne.",
    (data) => parseEstimateItemDeleteResponse(data, versionId, itemId),
    { mutation: { versionId: versionId, structural: true } }
  );
  return { versionToken: receipt.version, deletedIds: receipt.deleted_ids };
}

export async function reorderEstimateItems(
  versionId: string,
  parentId: string | null,
  orderedIds: string[]
): Promise<{ versionToken: EstimateVersionToken }> {
  const receipt = await requestJson(
    `/api/estimates/${versionId}/items/reorder`,
    jsonRequest("POST", {
      parent_id: parentId,
      ordered_ids: orderedIds,
    }),
    "Impossible de reordonner les lignes.",
    (data) => parseEstimateItemsReorderResponse(data, { versionId, parentId, orderedIds }),
    { mutation: { versionId: versionId, structural: true } }
  );
  return { versionToken: receipt.version };
}

export async function moveEstimateItem(
  versionId: string,
  payload: MoveEstimateItemInput
): Promise<{ versionToken: EstimateVersionToken }> {
  const receipt = await requestJson(
    `/api/estimates/${versionId}/items/move`,
    jsonRequest("POST", payload),
    "Impossible de déplacer l'élément.",
    (data) => parseEstimateItemsMoveResponse(data, versionId, payload),
    { mutation: { versionId: versionId, structural: true } }
  );
  return { versionToken: receipt.version };
}
