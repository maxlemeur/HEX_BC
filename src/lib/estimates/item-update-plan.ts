import { computeEstimateLineValues, hasActiveLaborSplitPayload } from "@/lib/estimate-calculations";
import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";
import type { EstimateItemUpdate } from "@/lib/estimates/item-write-types";
import { resolvePromotedEstimateLineNature } from "@/lib/estimates/line-nature";
import { normalizeEstimateItemAid } from "@/lib/estimates/schemas";
import type { EstimateItemRow } from "@/lib/estimates/version-read-server";
import { badRequest } from "@/lib/estimates/errors";
import {
  DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN,
  type UpdateEstimateItemInput,
} from "@/lib/estimates/schemas";

export function assertEstimateItemAidFormat(input: {
  aid: string | null;
  aidRegex: RegExp;
}) {
  if (!input.aid) return;
  const regex = new RegExp(input.aidRegex.source, input.aidRegex.flags);
  if (regex.test(input.aid)) return;

  throw badRequest(
    `AID invalide. Format attendu: ${DEFAULT_ESTIMATE_ITEM_AID_REGEX_PATTERN}.`
  );
}

export const SECTION_ONLY_FORBIDDEN_FIELDS: (keyof UpdateEstimateItemInput)[] = [
  "line_nature",
  "description",
  "quantity",
  "unit_price_ht_cents",
  "tax_rate_bp",
  "k_fo",
  "h_mo",
  "h_mo_majoration",
  "k_mo",
  "h_mo_atelier",
  "k_mo_atelier",
  "labor_role_atelier_id",
  "h_mo_chantier",
  "k_mo_chantier",
  "labor_role_chantier_id",
  "pu_ht_cents",
  "line_total_ht_cents",
  "line_tax_cents",
  "line_total_ttc_cents",
  "labor_role_id",
  "category_id",
  "supply_type_id",
  "product_id",
  "selected_supplier_price_id",
];

/** Build the structural patch; conversion deliberately preserves provenance. */
export function prepareEstimateSectionUpdate({ input, aidRegex, convertingLineToSection }: {
  input: UpdateEstimateItemInput;
  aidRegex: RegExp;
  convertingLineToSection: boolean;
}): EstimateItemUpdate {
  const containsLineFields = SECTION_ONLY_FORBIDDEN_FIELDS.some((fieldName) => {
    return fieldName in input;
  });

  if (containsLineFields) {
    throw badRequest("Les champs de ligne ne sont pas autorises pour une section.");
  }

  const payload: EstimateItemUpdate = {};

  if ("title" in input) {
    payload.title = input.title;
  }

  if ("parent_id" in input) {
    payload.parent_id = input.parent_id ?? null;
  }

  if ("position" in input) {
    payload.position = input.position;
  }

  if ("aid" in input) {
    const nextAid = normalizeEstimateItemAid(input.aid);
    assertEstimateItemAidFormat({
      aid: nextAid,
      aidRegex,
    });
    payload.aid = nextAid;
  }

  if (convertingLineToSection) {
    Object.assign(
      payload,
      {
        item_type: "section",
        line_nature: null,
        description: null,
        quantity: null,
        unit_price_ht_cents: null,
        tax_rate_bp: null,
        k_fo: null,
        h_mo: null,
        h_mo_majoration: null,
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
        product_id: null,
        selected_supplier_price_id: null,
        line_total_ht_cents: null,
        line_tax_cents: null,
        line_total_ttc_cents: null,
      } as unknown as EstimateItemUpdate
    );
  }

  return payload;
}

/** Merge a patch without confusing an absent field, explicit null, or zero. */
export function prepareEstimateLineUpdate({ input, currentItem, versionTaxRateBp, aidRegex }: {
  input: UpdateEstimateItemInput;
  currentItem: EstimateItemRow;
  versionTaxRateBp: number | null;
  aidRegex: RegExp;
}) {
  const nextParentId = "parent_id" in input ? input.parent_id ?? null : currentItem.parent_id;
  const nextAid =
    "aid" in input
      ? normalizeEstimateItemAid(input.aid)
      : (normalizeEstimateItemAid((currentItem as EstimateItemRow).aid) ?? null);
  if ("aid" in input) {
    assertEstimateItemAidFormat({
      aid: nextAid,
      aidRegex,
    });
  }

  const currentLineDefaults =
    currentItem.item_type === "line"
      ? currentItem
      : ({
          line_nature: "supply_only",
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: versionTaxRateBp ?? DEFAULT_TAX_RATE_BP,
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
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          product_id: null,
          selected_supplier_price_id: null,
          description: null,
          pu_ht_cents: 0,
        } satisfies Partial<EstimateItemRow>);

  const nextTitle =
    ("title" in input ? input.title : currentItem.title) ?? currentItem.title;
  const nextDescription =
    ("description" in input
      ? toNullableText(input.description)
      : (currentLineDefaults.description ?? null)) ?? null;
  const nextQuantity =
    ("quantity" in input
      ? input.quantity
      : (currentLineDefaults.quantity ?? 1)) ?? 1;
  const nextUnitPriceHtCents =
    ("unit_price_ht_cents" in input
      ? input.unit_price_ht_cents
      : (currentLineDefaults.unit_price_ht_cents ?? 0)) ?? 0;
  const nextTaxRateBp =
    ("tax_rate_bp" in input
      ? input.tax_rate_bp
      : (currentLineDefaults.tax_rate_bp ?? null)) ??
    versionTaxRateBp ??
    DEFAULT_TAX_RATE_BP;
  const nextKFo = ("k_fo" in input ? input.k_fo : (currentLineDefaults.k_fo ?? 1)) ?? 1;
  const nextHMo = ("h_mo" in input ? input.h_mo : (currentLineDefaults.h_mo ?? 0)) ?? 0;
  const nextHMoMajoration =
    ("h_mo_majoration" in input
      ? input.h_mo_majoration
      : (currentLineDefaults.h_mo_majoration ?? 1)) ?? 1;
  const nextKMo = ("k_mo" in input ? input.k_mo : (currentLineDefaults.k_mo ?? 1)) ?? 1;
  const nextHMoAtelier =
    "h_mo_atelier" in input
      ? input.h_mo_atelier ?? null
      : (currentLineDefaults.h_mo_atelier ?? null);
  const nextKMoAtelier =
    "k_mo_atelier" in input
      ? input.k_mo_atelier ?? null
      : (currentLineDefaults.k_mo_atelier ?? null);
  const nextLaborRoleAtelierId =
    "labor_role_atelier_id" in input
      ? input.labor_role_atelier_id ?? null
      : (currentLineDefaults.labor_role_atelier_id ?? null);
  const nextHMoChantier =
    "h_mo_chantier" in input
      ? input.h_mo_chantier ?? null
      : (currentLineDefaults.h_mo_chantier ?? null);
  const nextKMoChantier =
    "k_mo_chantier" in input
      ? input.k_mo_chantier ?? null
      : (currentLineDefaults.k_mo_chantier ?? null);
  const nextLaborRoleChantierId =
    "labor_role_chantier_id" in input
      ? input.labor_role_chantier_id ?? null
      : (currentLineDefaults.labor_role_chantier_id ?? null);
  const nextLaborRoleId =
    "labor_role_id" in input
      ? (input.labor_role_id ?? null)
      : (currentLineDefaults.labor_role_id ?? null);
  const nextCategoryId =
    "category_id" in input
      ? (input.category_id ?? null)
      : (currentLineDefaults.category_id ?? null);
  const nextSupplyTypeId =
    "supply_type_id" in input
      ? (input.supply_type_id ?? null)
      : (currentLineDefaults.supply_type_id ?? null);
  const nextProductId =
    "product_id" in input
      ? (input.product_id ?? null)
      : (currentLineDefaults.product_id ?? null);
  const nextSelectedSupplierPriceId =
    "selected_supplier_price_id" in input
      ? (input.selected_supplier_price_id ?? null)
      : (currentLineDefaults.selected_supplier_price_id ?? null);
  const nextLineNature =
    "line_nature" in input
      ? input.line_nature
      : resolvePromotedEstimateLineNature(currentLineDefaults, input);
  const nextPosition =
    ("position" in input ? input.position : currentItem.position) ??
    currentItem.position;

  const fields = {
    item_type: "line" as const,
    line_nature: nextLineNature,
    parent_id: nextParentId,
    position: nextPosition,
    title: nextTitle,
    aid: nextAid,
    description: nextDescription,
    quantity: nextQuantity,
    unit_price_ht_cents: nextUnitPriceHtCents,
    tax_rate_bp: nextTaxRateBp,
    k_fo: nextKFo,
    h_mo: nextHMo,
    h_mo_majoration: nextHMoMajoration,
    k_mo: nextKMo,
    h_mo_atelier: nextHMoAtelier,
    k_mo_atelier: nextKMoAtelier,
    labor_role_atelier_id: nextLaborRoleAtelierId,
    h_mo_chantier: nextHMoChantier,
    k_mo_chantier: nextKMoChantier,
    labor_role_chantier_id: nextLaborRoleChantierId,
    labor_role_id: nextLaborRoleId,
    category_id: nextCategoryId,
    supply_type_id: nextSupplyTypeId,
    product_id: nextProductId,
    selected_supplier_price_id: nextSelectedSupplierPriceId,
  };

  return { fields, previousUnitPriceHtCents: currentLineDefaults.pu_ht_cents ?? 0 };
}

/** Calculate historical line amounts from the prepared input and resolved rates. */
export function calculateEstimateLineUpdate({ preparedLine, marginMultiplier,
  laborRateLegacyCents, laborRateAtelierCents, laborRateChantierCents }: {
  preparedLine: ReturnType<typeof prepareEstimateLineUpdate>;
  marginMultiplier: number;
  laborRateLegacyCents: number;
  laborRateAtelierCents: number;
  laborRateChantierCents: number;
}): EstimateItemUpdate {
  const { fields } = preparedLine;
  const isLaborSplitEnabled = hasActiveLaborSplitPayload(fields);
  const lineValues = computeEstimateLineValues(
    {
      quantity: fields.quantity,
      unit_price_ht_cents: fields.unit_price_ht_cents,
      tax_rate_bp: fields.tax_rate_bp,
      k_fo: fields.k_fo,
      h_mo: fields.h_mo,
      h_mo_majoration: fields.h_mo_majoration,
      k_mo: fields.k_mo,
      h_mo_atelier: fields.h_mo_atelier,
      k_mo_atelier: fields.k_mo_atelier,
      labor_role_atelier_id: fields.labor_role_atelier_id,
      h_mo_chantier: fields.h_mo_chantier,
      k_mo_chantier: fields.k_mo_chantier,
      labor_role_chantier_id: fields.labor_role_chantier_id,
      pu_ht_cents: preparedLine.previousUnitPriceHtCents,
      labor_role_hourly_rate_cents: laborRateLegacyCents,
    },
    {
      marginMultiplier,
      taxRateBp: fields.tax_rate_bp,
      isLaborSplitEnabled,
      laborRateAtelierCents,
      laborRateChantierCents,
    }
  );

  return {
    ...fields,
    pu_ht_cents: lineValues.puHtCents,
    line_total_ht_cents: lineValues.saleLineCents,
    line_tax_cents: lineValues.taxLineCents,
    line_total_ttc_cents: lineValues.ttcLineCents,
  };
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
