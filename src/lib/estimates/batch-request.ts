import type { BatchOperationInput } from "@/lib/estimates/schemas";
import { normalizeMeasurementUnit } from "@/lib/units/normalize";

// Browser-safe request identity only. The server still validates with Zod.
// No version-dependent defaults, stored-decimal rounding, or pricing code here.
const SECTION_FIELDS = [
  "item_type", "parent_id", "position", "title", "aid",
  "source_provider", "source_job_id", "source_file_name", "source_page",
] as const;
const LINE_FIELDS = [
  ...SECTION_FIELDS, "line_nature", "description", "quantity", "unit_price_ht_cents",
  "tax_rate_bp", "k_fo", "h_mo", "h_mo_majoration", "k_mo", "labor_role_id",
  "h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id",
  "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id",
  "category_id", "supply_type_id", "product_id", "selected_supplier_price_id",
  // Lot 2, sous-lot 2.5 : colonnes de saisie v3 (D4, D9), jamais retirées en silence.
  "unit_code", "pricing_status", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit",
] as const;
const UPDATE_FIELDS = [
  "line_nature", "parent_id", "position", "title", "aid", "description",
  "quantity", "unit_price_ht_cents", "tax_rate_bp", "k_fo", "h_mo",
  "h_mo_majoration", "k_mo", "h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id",
  "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id", "pu_ht_cents",
  "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents", "labor_role_id",
  "category_id", "supply_type_id", "product_id", "selected_supplier_price_id",
  "unit_code", "pricing_status", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit",
] as const;
const UUID_FIELDS = new Set([
  "parent_id", "source_job_id", "labor_role_id", "labor_role_atelier_id",
  "labor_role_chantier_id", "category_id", "supply_type_id", "product_id",
  "selected_supplier_price_id",
]);
const NULLABLE_TEXT_FIELDS = new Set([
  "description", "source_provider", "source_file_name",
]);

function canonicalItemData(data: object, fields: readonly string[]) {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const value: unknown = Reflect.get(data, field);
    if (value === undefined) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) throw new TypeError("Nombre de batch invalide.");
      result[field] = Object.is(value, -0) ? 0 : value;
    } else if (typeof value === "string" && UUID_FIELDS.has(field)) {
      result[field] = value.toLowerCase();
    } else if (typeof value === "string" && field === "aid") {
      result[field] = value.trim().toUpperCase() || null;
    } else if (typeof value === "string" && NULLABLE_TEXT_FIELDS.has(field)) {
      result[field] = value.trim() || null;
    } else if (typeof value === "string" && field === "title") {
      result[field] = value.trim();
    } else if (typeof value === "string" && field === "unit_code") {
      // Code du référentiel (« ML » → « ml ») ; une saisie inconnue reste telle quelle et sera
      // refusée par la préparation (ESTIMATE_V3_UNIT_UNKNOWN), jamais remplacée par une unité.
      const trimmed = value.trim();
      result[field] = trimmed ? normalizeMeasurementUnit(trimmed).unitCode ?? trimmed : null;
    } else {
      result[field] = value;
    }
  }
  return result;
}

/** Stable public operations for persistence, POST and receipt comparison. */
export function canonicalizeEstimateBatchOperations(
  operations: readonly BatchOperationInput[]
): BatchOperationInput[] {
  return operations.map((operation): BatchOperationInput => {
    switch (operation.op) {
      case "create":
        return {
          op: "create",
          data: canonicalItemData(operation.data,
            operation.data.item_type === "section" ? SECTION_FIELDS : LINE_FIELDS) as typeof operation.data,
        };
      case "update":
        return {
          op: "update", id: operation.id.toLowerCase(),
          data: canonicalItemData(operation.data, UPDATE_FIELDS) as typeof operation.data,
        };
      case "delete":
        return { op: "delete", id: operation.id.toLowerCase() };
      case "reorder":
        return {
          op: "reorder",
          data: {
            ...(operation.data.parent_id === undefined ? {} : {
              parent_id: operation.data.parent_id?.toLowerCase() ?? null,
            }),
            ordered_ids: operation.data.ordered_ids.map((id) => id.toLowerCase()),
          },
        };
    }
  });
}
