import { DEFAULT_MAX_SECTION_DEPTH, clampMaxSectionDepth } from "@/lib/estimates/hierarchy";
import type { PatchEstimateVersionInput } from "@/lib/estimates/schemas";
import { normalizeEstimateCurrencyOrThrow, toNullableText } from "@/lib/estimates/version-write-normalization";
import type { Database } from "@/types/database";

type EstimateVersionUpdate = Database["public"]["Tables"]["estimate_versions"]["Update"];

/** Only settings accepted by the atomic writer; client totals and OCC metadata are excluded. */
export function prepareEstimateVersionSettingsPatch(input: PatchEstimateVersionInput): EstimateVersionUpdate {
  const payload: EstimateVersionUpdate = {};

  if ("title" in input) {
    payload.title = toNullableText(input.title);
  }
  if ("exclusions" in input) {
    payload.exclusions = toNullableText(input.exclusions);
  }
  if ("date_devis" in input) {
    payload.date_devis = input.date_devis;
  }
  if ("validite_jours" in input) {
    payload.validite_jours = input.validite_jours;
  }
  if ("margin_multiplier" in input) {
    payload.margin_multiplier = input.margin_multiplier;
  }
  if ("margin_mode" in input) {
    payload.margin_mode = input.margin_mode;
  }
  if ("currency" in input && typeof input.currency === "string") {
    payload.currency = normalizeEstimateCurrencyOrThrow(input.currency);
  }
  if ("margin_bp" in input) {
    payload.margin_bp = input.margin_bp;
  }
  if ("discount_bp" in input) {
    payload.discount_bp = input.discount_bp;
  }
  if ("discount_amount_cents" in input) {
    payload.discount_amount_cents = input.discount_amount_cents;
  }
  if ("discount_mode" in input) {
    payload.discount_mode = input.discount_mode;
  }
  if ("discount_steps" in input) {
    payload.discount_steps = input.discount_steps;
  }
  if ("global_coefficient" in input) {
    payload.global_coefficient = input.global_coefficient;
  }
  if ("tax_rate_bp" in input) {
    payload.tax_rate_bp = input.tax_rate_bp;
  }
  if ("contractor_role" in input) {
    payload.contractor_role = input.contractor_role;
  }
  if ("rounding_mode" in input) {
    payload.rounding_mode = input.rounding_mode;
  }
  if ("rounding_step_cents" in input) {
    payload.rounding_step_cents = input.rounding_step_cents;
  }
  if ("max_section_depth" in input) {
    payload.max_section_depth = clampMaxSectionDepth(
      input.max_section_depth,
      DEFAULT_MAX_SECTION_DEPTH
    );
  }
  // Lot 2, sous-lot 2.5 (D5, D8) : réglages v3, refusés par leur nom sur une v1/v2.
  if ("sale_coefficient_fo" in input) payload.sale_coefficient_fo = input.sale_coefficient_fo;
  if ("sale_coefficient_mo" in input) payload.sale_coefficient_mo = input.sale_coefficient_mo;
  return payload;
}
