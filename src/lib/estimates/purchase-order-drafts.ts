import { z } from "zod";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import {
  badRequest,
  conflict,
  internalError,
  mapSupabaseError,
  unauthorized,
  type SupabaseErrorLike,
} from "@/lib/estimates/errors";
import {
  getEstimateSupplierComparisons,
  listEstimateItems,
  type EstimateSupplierComparisonAlternative,
  type EstimateSupplierComparisonCoverageStatus,
  type EstimateSupplierComparisonRiskFlag,
} from "@/lib/estimates/server";
import { computeTotalsFromInputs, MAX_ORDER_AMOUNT_CENTS, type LineTotals } from "@/lib/order-calculations";
import type {
  estimatePurchaseOrderDraftsCreateSchema,
  estimatePurchaseOrderDraftGroupSchema,
} from "@/lib/estimates/schemas";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import { supplierOfferIneligibility } from "@/lib/estimates/supplier-offer-eligibility";
import { isPriceStale } from "@/lib/catalogue/stale-prices";
import { purchaseReceiptSchema, purchaseReviewSchema, purchaseTransferSchema } from "@/lib/estimates/purchase-preparation-contracts";
import { isValidOrderQuantity } from "@/lib/purchase-orders/quantities";
import type { Database } from "@/types/database";

type SupplierComparisonRecord = Awaited<
  ReturnType<typeof getEstimateSupplierComparisons>
>["comparisons"][number];

type EstimateLineRecord = Awaited<ReturnType<typeof listEstimateItems>>["items"][number];

const SUPPLIER_COMPARISON_BATCH_SIZE = 200;

export type EstimatePurchaseOrderDraftBlockedReason =
  | "selection_missing"
  | "stale"
  | "ambiguous"
  | "no_price"
  | "missing_quantity"
  | "invalid_quantity"
  | "amount_out_of_range"
  | "missing_unit_price"
  | "supplier_offer_ineligible";

export type EstimatePurchaseOrderDraftLine = {
  item_id: string;
  item_title: string;
  quantity: number;
  unit: string;
  review_fingerprint: string;
  unit_price_ht_cents: number;
  tax_rate_bp: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
  selected_supplier_price_id: string;
  supplier_reference: string | null;
  product_designation: string;
};

export type EstimatePurchaseOrderDraftGroup = {
  group_key: string;
  supplier_id: string;
  supplier_name: string;
  line_count: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
  lines: EstimatePurchaseOrderDraftLine[];
};

export type EstimatePurchaseOrderDraftBlockedLine = {
  item_id: string;
  item_title: string;
  quantity: number | null;
  unit_price_ht_cents: number | null;
  tax_rate_bp: number | null;
  selected_supplier_price_id: string | null;
  reason: EstimatePurchaseOrderDraftBlockedReason;
  reason_detail?: string | null;
  coverage_status: EstimateSupplierComparisonCoverageStatus | null;
  risk_flags: EstimateSupplierComparisonRiskFlag[];
  selected_alternative: EstimateSupplierComparisonAlternative | null;
  alternatives: EstimateSupplierComparisonAlternative[];
};

export type EstimatePurchaseOrderDraftPreparation = {
  version_id: string;
  stale_price_days: number;
  summary: {
    total_supplier_lines: number;
    draftable_lines: number;
    blocked_lines: number;
    transferred_lines: number;
    supplier_groups: number;
    selection_missing_lines: number;
    stale_lines: number;
    ambiguous_lines: number;
    no_price_lines: number;
    missing_quantity_lines: number;
    invalid_quantity_lines: number;
    missing_unit_price_lines: number;
  };
  groups: EstimatePurchaseOrderDraftGroup[];
  blocked_lines: EstimatePurchaseOrderDraftBlockedLine[];
  transferred_lines: z.infer<typeof purchaseTransferSchema>[];
};

export type EstimatePurchaseOrderDraftCreateGroupInput = z.infer<
  typeof estimatePurchaseOrderDraftGroupSchema
>;

export type EstimatePurchaseOrderDraftsCreateInput = z.infer<
  typeof estimatePurchaseOrderDraftsCreateSchema
>;

export type EstimatePurchaseOrderDraftCreationResult = z.infer<typeof purchaseReceiptSchema>;

function isSupplierScopedLine(item: EstimateLineRecord) {
  return (
    item.item_type === "line" &&
    (item.supply_type_id !== null || item.selected_supplier_price_id !== null)
  );
}

function resolveBlockedReason(input: {
  line: EstimateLineRecord;
  comparison: SupplierComparisonRecord | null;
}): EstimatePurchaseOrderDraftBlockedReason {
  const quantity = input.line.quantity;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0) {
    return "missing_quantity";
  }

  if (!isValidOrderQuantity(quantity)) {
    return "invalid_quantity";
  }

  const unitPriceHtCents = input.line.unit_price_ht_cents;
  if (
    typeof unitPriceHtCents !== "number" ||
    !Number.isFinite(unitPriceHtCents) ||
    unitPriceHtCents < 0
  ) {
    return "missing_unit_price";
  }

  const comparison = input.comparison;
  if (!comparison) {
    return "no_price";
  }

  if (input.line.selected_supplier_price_id === null) {
    if (comparison.coverage_status === "covered") {
      return "selection_missing";
    }
    return comparison.coverage_status;
  }

  if (comparison.coverage_status !== "covered") {
    return comparison.coverage_status;
  }

  return "selection_missing";
}

async function loadSupplierComparisonMap(versionId: string, itemIds: string[]) {
  const comparisons = new Map<string, SupplierComparisonRecord>();
  let stalePriceDays = 0;

  for (let startIndex = 0; startIndex < itemIds.length; startIndex += SUPPLIER_COMPARISON_BATCH_SIZE) {
    const batchItemIds = itemIds.slice(startIndex, startIndex + SUPPLIER_COMPARISON_BATCH_SIZE);
    const batch = await getEstimateSupplierComparisons(versionId, batchItemIds);
    stalePriceDays = batch.stale_price_days;
    batch.comparisons.forEach((comparison) => {
      comparisons.set(comparison.item_id, comparison);
    });
  }

  return {
    stale_price_days: stalePriceDays,
    comparisons,
  };
}

async function getDraftOrderContext() {
  const { supabase, user, error: userError } = await readAuthenticatedUser();

  if (userError || !user) {
    throw unauthorized();
  }

  const { membership, error } = await readActiveTenantMembership(supabase, user.id);

  if (error) {
    throw mapSupabaseError(error, "Impossible de résoudre l'organisation de l'utilisateur.");
  }

  if (!membership?.tenant_id) {
    throw unauthorized("Tenant introuvable.");
  }

  return {
    supabase,
    tenantId: membership.tenant_id,
    tenantRole: membership.role,
    userId: user.id,
  };
}

type CurrentSupplierOffer = Pick<Database["public"]["Tables"]["supplier_pricebook"]["Row"],
  "id" | "supplier_id" | "unit" | "min_quantity" | "currency" | "is_active" |
  "valid_from" | "valid_to" | "updated_at" | "created_at"
>;

async function readCurrentOfferEligibility(
  versionId: string,
  lines: EstimateLineRecord[],
  context: Awaited<ReturnType<typeof getDraftOrderContext>>,
) {
  const offers = new Map<string, CurrentSupplierOffer>();
  const activeSupplierIds = new Set<string>();
  const priceIds = Array.from(new Set(lines.flatMap((line) =>
    line.selected_supplier_price_id ? [line.selected_supplier_price_id] : []
  )));
  if (priceIds.length === 0) return { currency: "EUR", offers, activeSupplierIds };

  // listEstimateItems already checked access to this version. Keep the tenant
  // fence here too; absent data must never turn into permissive conditions.
  const { data: version, error: versionError } = await context.supabase
    .from("estimate_versions").select("currency")
    .eq("id", versionId).eq("tenant_id", context.tenantId).single();
  if (versionError) throw mapSupabaseError(versionError, "Impossible de vérifier la devise du devis.");
  if (!version) throw conflict("La version n'est plus accessible.", undefined, "ORDER_DRAFT_PREPARATION_STALE");

  for (let start = 0; start < priceIds.length; start += SUPPLIER_COMPARISON_BATCH_SIZE) {
    const { data, error } = await context.supabase.from("supplier_pricebook")
      .select("id, supplier_id, unit, min_quantity, currency, is_active, valid_from, valid_to, updated_at, created_at")
      .eq("tenant_id", context.tenantId)
      .in("id", priceIds.slice(start, start + SUPPLIER_COMPARISON_BATCH_SIZE));
    if (error) throw mapSupabaseError(error, "Impossible de vérifier les conditions fournisseurs.");
    for (const row of data ?? []) offers.set(row.id, row);
  }

  const supplierIds = Array.from(new Set(Array.from(offers.values(), (offer) => offer.supplier_id)));
  for (let start = 0; start < supplierIds.length; start += SUPPLIER_COMPARISON_BATCH_SIZE) {
    const { data, error } = await context.supabase.from("suppliers")
      .select("id, is_active").eq("tenant_id", context.tenantId)
      .in("id", supplierIds.slice(start, start + SUPPLIER_COMPARISON_BATCH_SIZE));
    if (error) throw mapSupabaseError(error, "Impossible de vérifier les fournisseurs.");
    for (const supplier of data ?? []) {
      if (supplier.is_active) activeSupplierIds.add(supplier.id);
    }
  }
  return { currency: version.currency, offers, activeSupplierIds };
}

function currentOfferIneligibility(
  line: EstimateLineRecord,
  eligibility: Awaited<ReturnType<typeof readCurrentOfferEligibility>>,
  stalePriceDays: number,
): string | null {
  if (!line.selected_supplier_price_id) return null;
  const offer = eligibility.offers.get(line.selected_supplier_price_id);
  if (!offer) return "Offre retenue introuvable ou inaccessible";
  if (!eligibility.activeSupplierIds.has(offer.supplier_id)) return "Fournisseur archivé ou inaccessible";
  // Purchase orders and their UI are EUR-only today. Never reinterpret the
  // negotiated estimate cost as EUR when the estimate uses another currency.
  if (eligibility.currency?.trim().toUpperCase() !== "EUR") return "Conversion vers EUR requise avant commande";
  if (!line.description?.trim()) return "Unité du devis à préciser";
  if (!offer.unit?.trim()) return "Unité de l'offre à préciser";
  if (!offer.currency?.trim()) return "Devise de l'offre à préciser";
  const ineligibility = supplierOfferIneligibility(offer, {
    currency: eligibility.currency, quantity: line.quantity, unit: line.description,
  });
  if (ineligibility) return ineligibility;
  if (!offer.valid_from || !offer.valid_to) return "Validité de l'offre à préciser";
  if (isPriceStale({ updatedAt: offer.updated_at, createdAt: offer.created_at }, stalePriceDays)) return "Prix à revalider";
  return null;
}

function mapPurchasePreparationError(error: SupabaseErrorLike) {
  const messages: Record<string, string> = {
    ORDER_DRAFT_PREPARATION_STALE: "La préparation a changé. Rechargez et relisez les lignes et conditions fournisseurs.",
    ORDER_DRAFT_ALREADY_EXISTS: "Certaines lignes sont déjà rattachées à une commande. Consultez les transferts existants.",
    ORDER_DRAFT_IDEMPOTENCY_CONFLICT: "Cette validation a déjà été utilisée avec un contenu différent.",
  };
  if (["23505", "40001"].includes(error.code) && messages[error.message]) {
    return conflict(messages[error.message], undefined, error.message);
  }
  if (error.code === "22023" && error.message === "ORDER_DRAFT_INPUT_INVALID") {
    return badRequest("La sélection et sa revue sont invalides.");
  }
  return mapSupabaseError(error, "Impossible de traiter la préparation des commandes.");
}

function parseProjection<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    // An invalid server projection is never interpreted as an empty result.
    throw internalError("La réponse de préparation est incomplète. Réessayez avec la même validation.");
  }
  return parsed.data;
}

export async function getEstimatePurchaseOrderDraftPreparation(
  versionId: string
): Promise<EstimatePurchaseOrderDraftPreparation> {
  const { items } = await listEstimateItems(versionId);
  const context = await getDraftOrderContext();
  const scopedLines = items.filter(isSupplierScopedLine);
  const { data: transferData, error: transferError } = await context.supabase.rpc(
    "get_estimate_purchase_order_transfers", { p_version_id: versionId }
  );
  if (transferError) throw mapPurchasePreparationError(transferError);
  const transferred_lines = parseProjection(z.object({ lines: z.array(purchaseTransferSchema) }), transferData).lines;
  const transferredIds = new Set(transferred_lines.map((line) => line.item_id));
  const supplierLines = scopedLines.filter((item) => !transferredIds.has(item.id));
  const supplierLineIds = supplierLines.map((item) => item.id);
  const { stale_price_days, comparisons } =
    supplierLineIds.length > 0
      ? await loadSupplierComparisonMap(versionId, supplierLineIds)
      : { stale_price_days: 0, comparisons: new Map<string, SupplierComparisonRecord>() };
  const eligibility = await readCurrentOfferEligibility(versionId, supplierLines, context);

  const groupsBySupplierId = new Map<string, EstimatePurchaseOrderDraftGroup>();
  const blocked_lines: EstimatePurchaseOrderDraftBlockedLine[] = [];
  const reasonCounts: Record<EstimatePurchaseOrderDraftBlockedReason, number> = {
    selection_missing: 0,
    stale: 0,
    ambiguous: 0,
    no_price: 0,
    missing_quantity: 0,
    invalid_quantity: 0,
    amount_out_of_range: 0,
    missing_unit_price: 0,
    supplier_offer_ineligible: 0,
  };

  supplierLines.forEach((line) => {
    const comparison = comparisons.get(line.id) ?? null;
    const quantity = line.quantity;
    const unitPriceHtCents = line.unit_price_ht_cents;
    const taxRateBp = line.tax_rate_bp;
    const selectedAlternative = comparison?.selected_alternative ?? null;
    const alternatives = comparison?.alternatives ?? [];
    const riskFlags = comparison?.risk_flags ?? [];
    const coverageStatus = comparison?.coverage_status ?? null;
    const selectedSupplierPriceId = line.selected_supplier_price_id ?? null;
    const offerIneligibility = currentOfferIneligibility(line, eligibility, stale_price_days);

    let totals: LineTotals | null = null;
    let invalidAmount = false;
    if (typeof quantity === "number" && isValidOrderQuantity(quantity) &&
        typeof unitPriceHtCents === "number" && typeof taxRateBp === "number") {
      try {
        [totals] = computeTotalsFromInputs([{ quantity, unitPriceHtCents, taxRateBp }]).lineTotals;
      } catch { invalidAmount = true; }
    }
    const isDraftable =
      typeof quantity === "number" &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      isValidOrderQuantity(quantity) &&
      typeof unitPriceHtCents === "number" &&
      Number.isFinite(unitPriceHtCents) &&
      unitPriceHtCents >= 0 &&
      typeof taxRateBp === "number" &&
      Number.isFinite(taxRateBp) &&
      selectedSupplierPriceId !== null &&
      comparison !== null &&
      comparison.coverage_status === "covered" &&
      selectedAlternative !== null &&
      offerIneligibility === null && totals !== null;

    if (!isDraftable || !totals) {
      const reason = invalidAmount ? "amount_out_of_range" : offerIneligibility ? "supplier_offer_ineligible" : resolveBlockedReason({
        line,
        comparison,
      });
      reasonCounts[reason] += 1;
      blocked_lines.push({
        item_id: line.id,
        item_title: line.title,
        quantity: typeof quantity === "number" ? quantity : null,
        unit_price_ht_cents:
          typeof unitPriceHtCents === "number" ? unitPriceHtCents : null,
        tax_rate_bp: typeof taxRateBp === "number" ? taxRateBp : null,
        selected_supplier_price_id: selectedSupplierPriceId,
        reason,
        reason_detail: invalidAmount ? "Le montant dépasse la capacité de la commande ou le prix/TVA est invalide." : offerIneligibility,
        coverage_status: coverageStatus,
        risk_flags: riskFlags,
        selected_alternative: selectedAlternative,
        alternatives,
      });
      return;
    }

    const supplierId = selectedAlternative.supplier_id;
    const existingGroup = groupsBySupplierId.get(supplierId);
    const draftLine: EstimatePurchaseOrderDraftLine = {
      item_id: line.id,
      item_title: line.title,
      quantity,
      unit: line.description?.trim() ?? "",
      review_fingerprint: "",
      unit_price_ht_cents: unitPriceHtCents,
      tax_rate_bp: taxRateBp,
      line_total_ht_cents: totals.lineTotalHtCents,
      line_tax_cents: totals.lineTaxCents,
      line_total_ttc_cents: totals.lineTotalTtcCents,
      selected_supplier_price_id: selectedSupplierPriceId,
      supplier_reference: selectedAlternative.supplier_reference,
      product_designation: selectedAlternative.product_designation,
    };

    if (existingGroup) {
      existingGroup.lines.push(draftLine);
      existingGroup.line_count += 1;
      existingGroup.total_ht_cents += totals.lineTotalHtCents;
      existingGroup.total_tax_cents += totals.lineTaxCents;
      existingGroup.total_ttc_cents += totals.lineTotalTtcCents;
      return;
    }

    groupsBySupplierId.set(supplierId, {
      group_key: `supplier:${supplierId}`,
      supplier_id: supplierId,
      supplier_name: selectedAlternative.supplier_name,
      line_count: 1,
      total_ht_cents: totals.lineTotalHtCents,
      total_tax_cents: totals.lineTaxCents,
      total_ttc_cents: totals.lineTotalTtcCents,
      lines: [draftLine],
    });
  });

  for (const [supplierId, group] of groupsBySupplierId) {
    if ([group.total_ht_cents, group.total_tax_cents, group.total_ttc_cents].some((amount) => amount > MAX_ORDER_AMOUNT_CENTS)) {
      groupsBySupplierId.delete(supplierId);
      for (const line of group.lines) {
        reasonCounts.amount_out_of_range += 1;
        blocked_lines.push({
          item_id: line.item_id, item_title: line.item_title, quantity: line.quantity,
          unit_price_ht_cents: line.unit_price_ht_cents, tax_rate_bp: line.tax_rate_bp,
          selected_supplier_price_id: line.selected_supplier_price_id,
          reason: "amount_out_of_range", reason_detail: "Le total fournisseur dépasse la capacité d'une commande.",
          coverage_status: "covered", risk_flags: [], selected_alternative: null, alternatives: [],
        });
      }
    }
  }

  const preparedLines = Array.from(groupsBySupplierId.values()).flatMap((group) => group.lines);
  // Never attach a fresh SQL fingerprint to values obtained by older reads.
  // A mutation after this review is caught again inside the create transaction.
  for (let start = 0; start < preparedLines.length; start += SUPPLIER_COMPARISON_BATCH_SIZE) {
    const batch = preparedLines.slice(start, start + SUPPLIER_COMPARISON_BATCH_SIZE);
    const { data, error } = await context.supabase.rpc("get_estimate_purchase_order_review", {
      p_version_id: versionId, p_item_ids: batch.map((line) => line.item_id),
    });
    if (error) throw mapPurchasePreparationError(error);
    const canonical = parseProjection(purchaseReviewSchema, data).lines;
    const reviews = new Map(canonical.map((line) => [line.item_id, line]));
    for (const line of batch) {
      const review = reviews.get(line.item_id);
      const group = review ? groupsBySupplierId.get(review.supplier_id) : undefined;
      if (!review || !group?.lines.includes(line) ||
          review.item_title !== line.item_title || review.quantity !== line.quantity ||
          review.unit_price_ht_cents !== line.unit_price_ht_cents || review.tax_rate_bp !== line.tax_rate_bp ||
          review.unit !== line.unit || review.selected_supplier_price_id !== line.selected_supplier_price_id ||
          review.supplier_name !== group.supplier_name || review.supplier_reference !== line.supplier_reference) {
        throw conflict("La préparation a changé pendant sa lecture. Rechargez-la.", undefined, "ORDER_DRAFT_PREPARATION_STALE");
      }
      line.review_fingerprint = review.review_fingerprint;
    }
  }

  const groups = Array.from(groupsBySupplierId.values()).sort((left, right) =>
    left.supplier_name.localeCompare(right.supplier_name, "fr-FR")
  );

  groups.forEach((group) => {
    group.lines.sort((left, right) => left.item_title.localeCompare(right.item_title, "fr-FR"));
  });

  blocked_lines.sort((left, right) => left.item_title.localeCompare(right.item_title, "fr-FR"));

  return {
    version_id: versionId,
    stale_price_days,
    summary: {
      total_supplier_lines: supplierLines.length + transferred_lines.length,
      draftable_lines: groups.reduce((sum, group) => sum + group.line_count, 0),
      blocked_lines: blocked_lines.length,
      transferred_lines: transferred_lines.length,
      supplier_groups: groups.length,
      selection_missing_lines: reasonCounts.selection_missing,
      stale_lines: reasonCounts.stale,
      ambiguous_lines: reasonCounts.ambiguous,
      no_price_lines: reasonCounts.no_price,
      missing_quantity_lines: reasonCounts.missing_quantity,
      invalid_quantity_lines: reasonCounts.invalid_quantity,
      missing_unit_price_lines: reasonCounts.missing_unit_price,
    },
    groups,
    blocked_lines,
    transferred_lines,
  };
}

export async function getEstimatePurchaseOrderReceipt(
  versionId: string,
  idempotencyKey: string,
): Promise<EstimatePurchaseOrderDraftCreationResult | null> {
  const { supabase } = await getDraftOrderContext();
  const { data, error } = await supabase.rpc("get_estimate_purchase_order_receipt", {
    p_version_id: versionId, p_idempotency_key: idempotencyKey,
  });
  if (error) throw mapPurchasePreparationError(error);
  if (data === null) return null;
  const receipt = parseProjection(purchaseReceiptSchema, data);
  if (receipt.source_version_id !== versionId.toLowerCase() || receipt.idempotency_key !== idempotencyKey.toLowerCase()) {
    throw internalError("Le reçu ne correspond pas à cette validation.");
  }
  return receipt;
}

export async function createEstimatePurchaseOrderDrafts(
  versionId: string,
  input: EstimatePurchaseOrderDraftsCreateInput
): Promise<EstimatePurchaseOrderDraftCreationResult> {
  const context = await getDraftOrderContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  // Authorization, replay, review, reservations and all supplier groups share
  // one database transaction. No compensating deletion can leave a partial set.
  const { data, error } = await context.supabase.rpc("create_estimate_purchase_order_drafts", {
    p_version_id: versionId,
    p_idempotency_key: input.idempotency_key,
    p_reviewed_lines: input.reviewed_lines,
    p_groups: input.groups,
  });
  if (error) throw mapPurchasePreparationError(error);
  const receipt = parseProjection(purchaseReceiptSchema, data);
  if (receipt.source_version_id !== versionId.toLowerCase() || receipt.idempotency_key !== input.idempotency_key.toLowerCase()) {
    throw internalError("Le reçu ne correspond pas à cette validation.");
  }
  return receipt;
}
