import { createHash } from "node:crypto";

import { hasActiveLaborSplitPayload } from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import type { Database, Json } from "@/types/database";

type EstimateVersionRow = Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

export const CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION = 4;
export const UNIFIED_ESTIMATE_SEAL_PAYLOAD_VERSION = 3;
export const PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION = 2;
export const LEGACY_ESTIMATE_SEAL_PAYLOAD_VERSION = 1;

export type EstimateSealVersionFields = Pick<
  EstimateVersionRow,
  | "id"
  | "tenant_id"
  | "project_id"
  | "version_number"
  | "title"
  | "exclusions"
  | "date_devis"
  | "validite_jours"
  | "currency"
  | "total_ht_cents"
  | "total_tax_cents"
  | "total_ttc_cents"
  | "rounding_adjustment_cents"
  | "margin_multiplier"
  | "margin_mode"
  | "discount_bp"
  | "discount_mode"
  | "discount_steps"
  | "global_coefficient"
  | "max_section_depth"
  | "tax_rate_bp"
  | "rounding_mode"
  | "rounding_step_cents"
  | "calc_engine_version"
  | "calc_snapshot_content_revision"
  | "calc_snapshot_context"
  | "contractor_role"
  | "seal_hash"
>;

type EstimateSealCanonicalItem = Pick<
  EstimateItemRow,
  | "id"
  | "position"
  | "item_type"
  | "title"
  | "quantity"
  | "unit_price_ht_cents"
  | "tax_rate_bp"
  | "k_fo"
  | "h_mo"
  | "h_mo_majoration"
  | "k_mo"
  | "supply_type_id"
  | "pu_ht_cents"
  | "line_total_ht_cents"
  | "line_tax_cents"
  | "line_total_ttc_cents"
> & {
  line_nature?: EstimateItemRow["line_nature"];
  parent_id?: string | null;
  description?: string | null;
  labor_role_id?: string | null;
  category_id?: string | null;
  snapshot_pu_ht_cents?: number | null;
  snapshot_fo_ht_cents?: number | null;
  snapshot_mo_ht_cents?: number | null;
  snapshot_mo_atelier_ht_cents?: number | null;
  snapshot_mo_chantier_ht_cents?: number | null;
  h_mo_atelier?: number | null;
  k_mo_atelier?: number | null;
  labor_role_atelier_id?: string | null;
  h_mo_chantier?: number | null;
  k_mo_chantier?: number | null;
  labor_role_chantier_id?: string | null;
};

export type EstimateSealPayload = {
  meta: {
    payload_version: number;
    version_id: string;
    tenant_id: string;
    project_id: string;
  };
  version: {
    version_number: number;
    title?: string | null;
    exclusions?: string | null;
    date_devis: string;
    validite_jours?: number;
    currency?: string;
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    rounding_adjustment_cents?: number;
    margin_multiplier: number;
    margin_mode?: EstimateVersionRow["margin_mode"];
    discount_bp: number;
    discount_mode?: EstimateVersionRow["discount_mode"];
    discount_steps?: number[];
    global_coefficient?: number;
    max_section_depth?: number;
    tax_rate_bp: number;
    rounding_mode: EstimateVersionRow["rounding_mode"];
    rounding_step_cents: number;
    calc_engine_version?: number;
    calc_snapshot_content_revision?: number | null;
    calc_snapshot_context?: Json | null;
    contractor_role?: string;
  };
  items: EstimateSealCanonicalItem[];
};

/**
 * Interface canonique du sceau. Les payloads v1/v2 restent strictement
 * compatibles tandis que v3 couvre tout le contrat calcule et son snapshot.
 */
export function buildCanonicalEstimateSealPayload(
  input: {
    version: EstimateSealVersionFields;
    items: EstimateItemRow[];
  },
  options?: {
    payloadVersion?: number;
    includeLaborSplit?: boolean;
    includeCalcEngineVersion?: boolean;
  }
): EstimateSealPayload {
  const payloadVersion =
    options?.payloadVersion ??
    (resolveCalcEngineVersion(input.version) === 2
      ? CURRENT_ESTIMATE_SEAL_PAYLOAD_VERSION
      : PREVIOUS_ESTIMATE_SEAL_PAYLOAD_VERSION);
  const includeLaborSplit = options?.includeLaborSplit ?? true;
  const includeCalcEngineVersion = options?.includeCalcEngineVersion ?? true;
  const includeUnifiedEngineContract = payloadVersion >= 3;
  const includeExplicitRoundingContract = payloadVersion >= 4;
  const canonicalItems = [...input.items]
    .sort((left, right) =>
      left.position !== right.position
        ? left.position - right.position
        : left.id.localeCompare(right.id)
    )
    .map((item): EstimateSealCanonicalItem => {
      // Les cles MO eclatees ne sont presentes que si la ventilation est
      // reelle, afin de preserver les hashes historiques des lignes par defaut.
      const laborSplit: Partial<
        Pick<
          EstimateSealCanonicalItem,
          | "h_mo_atelier"
          | "k_mo_atelier"
          | "labor_role_atelier_id"
          | "h_mo_chantier"
          | "k_mo_chantier"
          | "labor_role_chantier_id"
        >
      > =
        includeLaborSplit && hasActiveLaborSplitPayload(item)
          ? {
              ...(item.h_mo_atelier != null
                ? { h_mo_atelier: item.h_mo_atelier }
                : {}),
              ...(item.k_mo_atelier != null
                ? { k_mo_atelier: item.k_mo_atelier }
                : {}),
              ...(item.labor_role_atelier_id != null
                ? { labor_role_atelier_id: item.labor_role_atelier_id }
                : {}),
              ...(item.h_mo_chantier != null
                ? { h_mo_chantier: item.h_mo_chantier }
                : {}),
              ...(item.k_mo_chantier != null
                ? { k_mo_chantier: item.k_mo_chantier }
                : {}),
              ...(item.labor_role_chantier_id != null
                ? { labor_role_chantier_id: item.labor_role_chantier_id }
                : {}),
            }
          : {};

      return {
        id: item.id,
        position: item.position,
        item_type: item.item_type,
        title: item.title,
        quantity: item.quantity,
        unit_price_ht_cents: item.unit_price_ht_cents,
        tax_rate_bp: item.tax_rate_bp,
        k_fo: item.k_fo,
        h_mo: item.h_mo,
        h_mo_majoration: item.h_mo_majoration,
        k_mo: item.k_mo,
        ...laborSplit,
        supply_type_id: item.supply_type_id,
        pu_ht_cents: item.pu_ht_cents,
        line_total_ht_cents: item.line_total_ht_cents,
        line_tax_cents: item.line_tax_cents,
        line_total_ttc_cents: item.line_total_ttc_cents,
        ...(includeExplicitRoundingContract
          ? { line_nature: item.line_nature ?? null }
          : {}),
        ...(includeUnifiedEngineContract
          ? {
              parent_id: item.parent_id,
              description: item.description,
              labor_role_id: item.labor_role_id,
              category_id: item.category_id,
              h_mo_atelier: item.h_mo_atelier,
              k_mo_atelier: item.k_mo_atelier,
              labor_role_atelier_id: item.labor_role_atelier_id,
              h_mo_chantier: item.h_mo_chantier,
              k_mo_chantier: item.k_mo_chantier,
              labor_role_chantier_id: item.labor_role_chantier_id,
              snapshot_pu_ht_cents: item.snapshot_pu_ht_cents ?? null,
              snapshot_fo_ht_cents: item.snapshot_fo_ht_cents ?? null,
              snapshot_mo_ht_cents: item.snapshot_mo_ht_cents ?? null,
              snapshot_mo_atelier_ht_cents:
                item.snapshot_mo_atelier_ht_cents ?? null,
              snapshot_mo_chantier_ht_cents:
                item.snapshot_mo_chantier_ht_cents ?? null,
            }
          : {}),
      };
    });

  return {
    meta: {
      payload_version: payloadVersion,
      version_id: input.version.id,
      tenant_id: input.version.tenant_id,
      project_id: input.version.project_id,
    },
    version: {
      version_number: input.version.version_number,
      date_devis: input.version.date_devis,
      total_ht_cents: input.version.total_ht_cents,
      total_tax_cents: input.version.total_tax_cents,
      total_ttc_cents: input.version.total_ttc_cents,
      ...(includeExplicitRoundingContract
        ? {
            rounding_adjustment_cents:
              input.version.rounding_adjustment_cents,
          }
        : {}),
      margin_multiplier: input.version.margin_multiplier,
      ...(includeUnifiedEngineContract
        ? {
            title: input.version.title,
            exclusions: input.version.exclusions,
            margin_mode: input.version.margin_mode,
            discount_mode: input.version.discount_mode,
            discount_steps: input.version.discount_steps,
            global_coefficient: input.version.global_coefficient,
            max_section_depth: input.version.max_section_depth,
            currency: input.version.currency,
            validite_jours: input.version.validite_jours,
            calc_snapshot_content_revision:
              input.version.calc_snapshot_content_revision,
            calc_snapshot_context: input.version.calc_snapshot_context,
          }
        : {}),
      discount_bp: input.version.discount_bp,
      tax_rate_bp: input.version.tax_rate_bp,
      rounding_mode: input.version.rounding_mode,
      rounding_step_cents: input.version.rounding_step_cents,
      ...(includeCalcEngineVersion
        ? { calc_engine_version: input.version.calc_engine_version ?? 1 }
        : {}),
      ...(input.version.contractor_role &&
      input.version.contractor_role !== "principal"
        ? { contractor_role: input.version.contractor_role }
        : {}),
    },
    items: canonicalItems,
  };
}

export function computeEstimateSealHash(payload: EstimateSealPayload) {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex")
    .toLowerCase();
}
