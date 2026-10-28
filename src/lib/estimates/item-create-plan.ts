import type { AtomicEstimateItemInsert } from "@/lib/estimates/atomic-item-creation";
import { DEFAULT_TAX_RATE_BP } from "@/lib/estimates/constants";
import {
  assertLinePlacementAllowed,
  assertSectionPlacementAllowed,
} from "@/lib/estimates/estimate-placement-helpers";
import { getDefaultSectionTitleForLevel } from "@/lib/estimates/hierarchy";
import { resolveEstimateLineNature } from "@/lib/estimates/line-nature";
import type { CreateEstimateItemInput } from "@/lib/estimates/schemas";
import { pickV3ItemInputFields } from "@/lib/estimates/v3-persistence";

/** Prepare a new item without reading references or committing a draft. */
export function prepareEstimateItemCreation({ input, id, parentId, position, aid,
  parentSectionLevel, maxSectionDepth, versionTaxRateBp }: {
  input: CreateEstimateItemInput;
  id: string;
  parentId: string | null;
  position: number;
  aid: string | null;
  parentSectionLevel: number | null;
  maxSectionDepth: number;
  versionTaxRateBp: number | null;
}): AtomicEstimateItemInsert {
  const sourceProvider = toNullableText(input.source_provider) ?? "manual";
  const sourceJobId = input.source_job_id ?? null;
  const sourceFileName = toNullableText(input.source_file_name);
  const sourcePage = input.source_page ?? null;

  if (input.item_type === "section") {
    const nextSectionLevel =
      parentSectionLevel === null ? 1 : parentSectionLevel + 1;
    assertSectionPlacementAllowed({
      maxSectionDepth,
      nextSectionLevel,
    });
    const title =
      input.title ?? getDefaultSectionTitleForLevel(nextSectionLevel);

    return {
      id,
      parent_id: parentId,
      item_type: "section",
      position,
      title,
      aid,
      source_provider: sourceProvider,
      source_job_id: sourceJobId,
      source_file_name: sourceFileName,
      source_page: sourcePage,
    };
  }

  const title = input.title ?? "Nouvelle ligne";
  const description = toNullableText(input.description);
  const quantity = input.quantity ?? 1;
  const unitPriceHtCents = input.unit_price_ht_cents ?? 0;
  const taxRateBp = input.tax_rate_bp ?? versionTaxRateBp ?? DEFAULT_TAX_RATE_BP;
  const kFo = input.k_fo ?? 1;
  const hMo = input.h_mo ?? 0;
  const hMoMajoration = input.h_mo_majoration ?? 1;
  const kMo = input.k_mo ?? 1;
  const hMoAtelier = input.h_mo_atelier ?? null;
  const kMoAtelier = input.k_mo_atelier ?? null;
  const laborRoleAtelierId = input.labor_role_atelier_id ?? null;
  const hMoChantier = input.h_mo_chantier ?? null;
  const kMoChantier = input.k_mo_chantier ?? null;
  const laborRoleChantierId = input.labor_role_chantier_id ?? null;
  const laborRoleId = input.labor_role_id ?? null;
  const categoryId = input.category_id ?? null;
  const supplyTypeId = input.supply_type_id ?? null;
  const productId = input.product_id ?? null;
  const selectedSupplierPriceId = input.selected_supplier_price_id ?? null;
  const lineNature =
    input.line_nature ??
    resolveEstimateLineNature({
      unit_price_ht_cents: unitPriceHtCents,
      supply_type_id: supplyTypeId,
      selected_supplier_price_id: selectedSupplierPriceId,
      h_mo: hMo,
      h_mo_atelier: hMoAtelier,
      h_mo_chantier: hMoChantier,
      labor_role_id: laborRoleId,
      labor_role_atelier_id: laborRoleAtelierId,
      labor_role_chantier_id: laborRoleChantierId,
    });
  assertLinePlacementAllowed({
    maxSectionDepth,
    parentSectionLevel,
  });
  return {
    id,
    parent_id: parentId,
    item_type: "line",
    line_nature: lineNature,
    position,
    title,
    aid,
    description,
    quantity,
    unit_price_ht_cents: unitPriceHtCents,
    tax_rate_bp: taxRateBp,
    k_fo: kFo,
    h_mo: hMo,
    h_mo_majoration: hMoMajoration,
    k_mo: kMo,
    h_mo_atelier: hMoAtelier,
    k_mo_atelier: kMoAtelier,
    labor_role_atelier_id: laborRoleAtelierId,
    h_mo_chantier: hMoChantier,
    k_mo_chantier: kMoChantier,
    labor_role_chantier_id: laborRoleChantierId,
    labor_role_id: laborRoleId,
    category_id: categoryId,
    supply_type_id: supplyTypeId,
    ...(productId ? { product_id: productId } : {}),
    selected_supplier_price_id: selectedSupplierPriceId,
    // Lot 2, sous-lot 2.5 : colonnes v3 transmises telles quelles (refusées hors v3 par l'écrivain).
    ...pickV3ItemInputFields(input),
    source_provider: sourceProvider,
    source_job_id: sourceJobId,
    source_file_name: sourceFileName,
    source_page: sourcePage,
  };
}

function toNullableText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
