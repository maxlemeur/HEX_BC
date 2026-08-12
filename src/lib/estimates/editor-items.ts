import type { DiscountMode, EstimateTotals } from "@/lib/estimate-calculations";
import {
  toFiniteNumber,
  toNullableFiniteNumber,
  toNonEmptyString,
} from "@/lib/estimates/editor-values";
import type { Database } from "@/types/database";

export type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
export type EstimateItem =
  Database["public"]["Tables"]["estimate_items"]["Row"];
export type EditorEstimateItem = EstimateItem & {
  _optimistic?: boolean;
  _pendingCreate?: boolean;
  _tempId?: string;
};
export type LaborRole =
  Database["public"]["Tables"]["labor_roles"]["Row"];

export type LaborSplitItemFields = {
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

export type EstimateItemUpdatePayload =
  Database["public"]["Tables"]["estimate_items"]["Update"] &
    LaborSplitItemFields;
export type EstimateItemInsertPayload =
  Database["public"]["Tables"]["estimate_items"]["Insert"] &
    LaborSplitItemFields;
export type EstimateVersionTotalsPatch = Pick<
  EstimateVersionRow,
  "total_ht_cents" | "total_tax_cents" | "total_ttc_cents"
>;

export type EstimateItemMovePayload = {
  itemId: string;
  fromParentId: string | null;
  toParentId: string | null;
  orderedSourceIds: string[];
  orderedTargetIds: string[];
};

export const LABOR_SPLIT_FIELD_KEYS = [
  "h_mo_atelier",
  "k_mo_atelier",
  "labor_role_atelier_id",
  "h_mo_chantier",
  "k_mo_chantier",
  "labor_role_chantier_id",
] as const;

export function createTempEstimateItemId(): string {
  return `tmp:${crypto.randomUUID()}`;
}

export function isTempEstimateItemId(itemId: string): boolean {
  return itemId.startsWith("tmp:");
}

export function isPendingCreateEstimateItem(item: EditorEstimateItem): boolean {
  return item._pendingCreate === true;
}

export function readLaborSplitFields(
  source: EstimateItem | Record<string, unknown>
): Required<LaborSplitItemFields> {
  const record = source as Record<string, unknown>;
  const hMoAtelier = toNullableFiniteNumber(record.h_mo_atelier);
  const kMoAtelier = toNullableFiniteNumber(record.k_mo_atelier);
  const laborRoleAtelierId = toNonEmptyString(record.labor_role_atelier_id);
  const hMoChantier = toNullableFiniteNumber(record.h_mo_chantier);
  const kMoChantier = toNullableFiniteNumber(record.k_mo_chantier);
  const laborRoleChantierId = toNonEmptyString(record.labor_role_chantier_id);
  const hasAtelierPayload =
    (hMoAtelier ?? 0) > 0 ||
    laborRoleAtelierId !== null ||
    (kMoAtelier ?? 1) !== 1;
  const hasChantierPayload =
    (hMoChantier ?? 0) > 0 ||
    laborRoleChantierId !== null ||
    (kMoChantier ?? 1) !== 1;
  return {
    h_mo_atelier: hasAtelierPayload ? (hMoAtelier ?? 0) : null,
    k_mo_atelier: hasAtelierPayload ? (kMoAtelier ?? 1) : 1,
    labor_role_atelier_id: laborRoleAtelierId,
    h_mo_chantier: hasChantierPayload ? (hMoChantier ?? 0) : null,
    k_mo_chantier: hasChantierPayload ? (kMoChantier ?? 1) : 1,
    labor_role_chantier_id: laborRoleChantierId,
  };
}

export function hasLaborSplitFields(
  source: EstimateItem | Record<string, unknown>
): boolean {
  const record = source as Record<string, unknown>;
  return LABOR_SPLIT_FIELD_KEYS.some((key) => key in record);
}

/**
 * Recopie les colonnes de main-d'oeuvre eclatee de `source` vers `target`,
 * uniquement pour les cles REELLEMENT presentes sur la source.
 *
 * La garde `key in sourceRecord` est essentielle : sans elle, un patch partiel
 * (ex. « changer la quantite ») ecraserait la ventilation en base avec des
 * `null`. Avec elle, un patch qui ne mentionne pas ces colonnes les laisse
 * intactes.
 */
function appendLaborSplitFields(
  source: EstimateItem | Record<string, unknown>,
  target: EstimateItemUpdatePayload | Record<string, unknown>
) {
  const sourceRecord = source as Record<string, unknown>;
  const targetRecord = target as Record<string, unknown>;

  LABOR_SPLIT_FIELD_KEYS.forEach((key) => {
    if (!(key in sourceRecord)) return;
    targetRecord[key] = sourceRecord[key] ?? null;
  });
}

export function resolveLaborRoleHourlyRate(
  role: LaborRole | Record<string, unknown>,
  scope: "default" | "atelier" | "chantier"
): number {
  const record = role as Record<string, unknown>;
  const fallbackRate = toFiniteNumber(record.hourly_rate_cents, 0);
  if (scope === "atelier") {
    return toFiniteNumber(record.hourly_rate_atelier_cents, fallbackRate);
  }
  if (scope === "chantier") {
    return toFiniteNumber(record.hourly_rate_chantier_cents, fallbackRate);
  }
  return fallbackRate;
}

/**
 * Grandeurs de remise / coefficient a persister pour une version.
 *
 * EST-E26 etape 16. La persistance ecrivait
 * `global_coefficient: discountMode === "cascade" ? coefficient : 1`, alors que
 * le moteur applique le coefficient INCONDITIONNELLEMENT au sous-total
 * (`saleSubtotalBeforeCoefficientCents * safeGlobalCoefficient`, avant tout
 * branchement sur le mode de remise).
 *
 * La version stockee etait donc auto-contradictoire : `total_ht_cents` incluait
 * le coefficient, `global_coefficient` valait 1. Scenario reel — le champ
 * « Coefficient global » force `discount_mode: "cascade"` a la saisie, mais le
 * bouton « Simple » ne reinitialise pas le coefficient : poser 1,15 puis
 * repasser en Simple et sauvegarder faisait disparaitre le coefficient au
 * rechargement, et le total chutait de 15 %.
 *
 * Le coefficient est une grandeur INDEPENDANTE du mode de remise : il est
 * persiste tel qu'il est affiche. Les paliers de cascade, eux, restent propres
 * au mode cascade.
 */
export function buildVersionDiscountPatch(input: {
  discountMode: DiscountMode;
  globalCoefficient: number | null | undefined;
  cascadeDiscountSteps: number[];
}): {
  discount_mode: DiscountMode;
  discount_steps: number[];
  global_coefficient: number;
} {
  return {
    discount_mode: input.discountMode,
    discount_steps:
      input.discountMode === "cascade" ? input.cascadeDiscountSteps : [],
    global_coefficient: Math.max(input.globalCoefficient ?? 1, 0),
  };
}

export function buildVersionTotalsPatch(
  totals: EstimateTotals | null
): EstimateVersionTotalsPatch | undefined {
  if (!totals) return undefined;
  return {
    total_ht_cents: totals.saleTotalCents,
    total_tax_cents: totals.adjustedTaxCents,
    total_ttc_cents: totals.roundedTtcCents,
  };
}

export function buildEstimateItemUpdatePayload(
  item: EstimateItem
): EstimateItemUpdatePayload {
  if (item.item_type === "line") {
    const payload: EstimateItemUpdatePayload = {
      title: item.title,
      aid: item.aid ?? null,
      description: item.description ?? null,
      quantity: item.quantity,
      unit_price_ht_cents: item.unit_price_ht_cents,
      tax_rate_bp: item.tax_rate_bp,
      k_fo: item.k_fo,
      h_mo: item.h_mo,
      h_mo_majoration: item.h_mo_majoration,
      k_mo: item.k_mo,
      pu_ht_cents: item.pu_ht_cents,
      labor_role_id: item.labor_role_id,
      category_id: item.category_id,
      supply_type_id: item.supply_type_id,
      selected_supplier_price_id: item.selected_supplier_price_id,
      line_total_ht_cents: item.line_total_ht_cents,
      line_tax_cents: item.line_tax_cents,
      line_total_ttc_cents: item.line_total_ttc_cents,
    };

    appendLaborSplitFields(item, payload);
    return payload;
  }

  return {
    title: item.title,
    aid: item.aid ?? null,
  };
}

export function buildEstimateItemInsertPayload(
  versionId: string,
  item: EstimateItem,
  overrides?: {
    parentId?: string | null;
    position?: number;
    title?: string;
  }
): EstimateItemInsertPayload {
  const parentId =
    overrides?.parentId !== undefined
      ? overrides.parentId
      : (item.parent_id ?? null);
  const position = overrides?.position ?? item.position;
  const title = overrides?.title ?? item.title;

  if (item.item_type === "section") {
    return {
      version_id: versionId,
      parent_id: parentId,
      item_type: "section",
      position,
      title,
      aid: item.aid ?? null,
    };
  }

  const payload: EstimateItemInsertPayload = {
    version_id: versionId,
    parent_id: parentId,
    item_type: "line",
    position,
    title,
    aid: item.aid ?? null,
    description: item.description ?? null,
    quantity: item.quantity,
    unit_price_ht_cents: item.unit_price_ht_cents,
    tax_rate_bp: item.tax_rate_bp,
    k_fo: item.k_fo,
    h_mo: item.h_mo,
    h_mo_majoration: item.h_mo_majoration,
    k_mo: item.k_mo,
    pu_ht_cents: item.pu_ht_cents,
    labor_role_id: item.labor_role_id,
    category_id: item.category_id,
    supply_type_id: item.supply_type_id,
    selected_supplier_price_id: item.selected_supplier_price_id,
    line_total_ht_cents: item.line_total_ht_cents,
    line_tax_cents: item.line_tax_cents,
    line_total_ttc_cents: item.line_total_ttc_cents,
  };

  appendLaborSplitFields(item, payload);
  return payload;
}

export function createOptimisticSectionItem(input: {
  tempId: string;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  position: number;
  title: string;
}): EditorEstimateItem {
  const timestamp = new Date().toISOString();
  return {
    id: input.tempId,
    created_at: timestamp,
    updated_at: timestamp,
    tenant_id: input.tenantId,
    version_id: input.versionId,
    parent_id: input.parentId,
    item_type: "section",
    position: input.position,
    title: input.title,
    aid: null,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    h_mo_majoration: 1,
    k_mo: null,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    snapshot_pu_ht_cents: null,
    snapshot_fo_ht_cents: null,
    snapshot_mo_ht_cents: null,
    snapshot_mo_atelier_ht_cents: null,
    snapshot_mo_chantier_ht_cents: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    _optimistic: true,
    _pendingCreate: true,
    _tempId: input.tempId,
  };
}

export function createOptimisticLineItem(input: {
  tempId: string;
  tenantId: string;
  versionId: string;
  parentId: string | null;
  position: number;
  title: string;
  quantity: number;
  taxRateBp: number;
  puHtCents: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
  isLaborSplitEnabled: boolean;
}): EditorEstimateItem {
  const timestamp = new Date().toISOString();
  return {
    id: input.tempId,
    created_at: timestamp,
    updated_at: timestamp,
    tenant_id: input.tenantId,
    version_id: input.versionId,
    parent_id: input.parentId,
    item_type: "line",
    position: input.position,
    title: input.title,
    aid: null,
    description: null,
    quantity: input.quantity,
    unit_price_ht_cents: 0,
    tax_rate_bp: input.taxRateBp,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: input.puHtCents,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    snapshot_pu_ht_cents: null,
    snapshot_fo_ht_cents: null,
    snapshot_mo_ht_cents: null,
    snapshot_mo_atelier_ht_cents: null,
    snapshot_mo_chantier_ht_cents: null,
    line_total_ht_cents: input.lineTotalHtCents,
    line_tax_cents: input.lineTaxCents,
    line_total_ttc_cents: input.lineTotalTtcCents,
    _optimistic: true,
    _pendingCreate: true,
    _tempId: input.tempId,
  };
}

export function applyInterParentMoveOptimistically(
  sourceItems: EstimateItem[],
  move: EstimateItemMovePayload
): EstimateItem[] {
  const sourcePositionById = new Map(
    move.orderedSourceIds.map((itemId, index) => [itemId, index + 1])
  );
  const targetPositionById = new Map(
    move.orderedTargetIds.map((itemId, index) => [itemId, index + 1])
  );

  return sourceItems.map((item) => {
    if (item.id === move.itemId) {
      const nextPosition = targetPositionById.get(item.id);
      if (nextPosition === undefined) return item;
      return {
        ...item,
        parent_id: move.toParentId,
        position: nextPosition,
      };
    }

    if ((item.parent_id ?? null) === move.fromParentId) {
      const nextPosition = sourcePositionById.get(item.id);
      if (nextPosition !== undefined) {
        return {
          ...item,
          position: nextPosition,
        };
      }
    }

    if ((item.parent_id ?? null) === move.toParentId) {
      const nextPosition = targetPositionById.get(item.id);
      if (nextPosition !== undefined) {
        return {
          ...item,
          position: nextPosition,
        };
      }
    }

    return item;
  });
}
