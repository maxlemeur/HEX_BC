import { z } from "zod";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import { buildPurchaseOrderReference } from "@/lib/reference";
import {
  badRequest,
  conflict,
  internalError,
  mapSupabaseError,
  unauthorized,
} from "@/lib/estimates/errors";
import {
  getEstimateSupplierComparisons,
  listEstimateItems,
  type EstimateSupplierComparisonAlternative,
  type EstimateSupplierComparisonCoverageStatus,
  type EstimateSupplierComparisonRiskFlag,
} from "@/lib/estimates/server";
import { computeTotalsFromInputs, type LineInput } from "@/lib/order-calculations";
import type {
  estimatePurchaseOrderDraftsCreateSchema,
  estimatePurchaseOrderDraftGroupSchema,
} from "@/lib/estimates/schemas";
import { isValidDateOnly } from "@/lib/date-only";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";

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
  | "non_integer_quantity"
  | "missing_unit_price";

export type EstimatePurchaseOrderDraftLine = {
  item_id: string;
  item_title: string;
  quantity: number;
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
    supplier_groups: number;
    selection_missing_lines: number;
    stale_lines: number;
    ambiguous_lines: number;
    no_price_lines: number;
    missing_quantity_lines: number;
    non_integer_quantity_lines: number;
    missing_unit_price_lines: number;
  };
  groups: EstimatePurchaseOrderDraftGroup[];
  blocked_lines: EstimatePurchaseOrderDraftBlockedLine[];
};

export type EstimatePurchaseOrderDraftCreateGroupInput = z.infer<
  typeof estimatePurchaseOrderDraftGroupSchema
>;

export type EstimatePurchaseOrderDraftsCreateInput = z.infer<
  typeof estimatePurchaseOrderDraftsCreateSchema
>;

export type EstimatePurchaseOrderDraftCreationResult = {
  source_version_id: string;
  summary: {
    draft_orders_created: number;
    draft_lines_created: number;
  };
  orders: Array<{
    purchase_order_id: string;
    reference: string;
    supplier_id: string;
    supplier_name: string;
    delivery_site_id: string;
    item_count: number;
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    ordered_source_item_ids: string[];
  }>;
};

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

  if (!Number.isInteger(quantity)) {
    return "non_integer_quantity";
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

function parseExpectedDeliveryDate(value: string | null) {
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.toUpperCase() === "TBD") {
    return "TBD";
  }

  if (!isValidDateOnly(trimmed)) {
    throw badRequest("Date de livraison invalide (YYYY-MM-DD attendu).", {
      expected_delivery_date: value,
    });
  }

  return trimmed;
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

function normalizeStringIds(rows: unknown[] | null | undefined, key: string) {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") {
      return [];
    }

    const value = (row as Record<string, unknown>)[key];
    return typeof value === "string" ? [value] : [];
  });
}

async function getDraftOrderContext() {
  const { supabase, user, error: userError } = await readAuthenticatedUser();

  if (userError || !user) {
    throw unauthorized();
  }

  const { membership, error } = await readActiveTenantMembership(supabase, user.id);

  if (error) {
    throw mapSupabaseError(error, "Impossible de resoudre le tenant utilisateur.");
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

async function listDraftedEstimateItemIds(
  versionId: string,
  itemIds: string[],
  context?: Awaited<ReturnType<typeof getDraftOrderContext>>
) {
  if (itemIds.length === 0) {
    return new Set<string>();
  }

  const resolvedContext = context ?? (await getDraftOrderContext());
  const { data: orders, error: ordersError } = await resolvedContext.supabase
    .from("purchase_orders")
    .select("id")
    .eq("tenant_id", resolvedContext.tenantId)
    .eq("source_estimate_version_id", versionId)
    .eq("status", "draft");

  if (ordersError) {
    throw mapSupabaseError(
      ordersError,
      "Impossible de vérifier les brouillons de commande existants."
    );
  }

  const orderIds = normalizeStringIds(orders, "id");
  if (orderIds.length === 0) {
    return new Set<string>();
  }

  const { data: draftedItems, error: draftedItemsError } = await resolvedContext.supabase
    .from("purchase_order_items")
    .select("source_estimate_item_id")
    .eq("tenant_id", resolvedContext.tenantId)
    .in("purchase_order_id", orderIds)
    .in("source_estimate_item_id", itemIds);

  if (draftedItemsError) {
    throw mapSupabaseError(
      draftedItemsError,
      "Impossible de vérifier les lignes déjà rattachées à un brouillon."
    );
  }

  return new Set(normalizeStringIds(draftedItems, "source_estimate_item_id"));
}

export async function getEstimatePurchaseOrderDraftPreparation(
  versionId: string
): Promise<EstimatePurchaseOrderDraftPreparation> {
  const { items } = await listEstimateItems(versionId);
  const scopedLines = items.filter(isSupplierScopedLine);
  const scopedLineIds = scopedLines.map((item) => item.id);
  const draftedItemIds =
    scopedLineIds.length > 0
      ? await listDraftedEstimateItemIds(versionId, scopedLineIds)
      : new Set<string>();
  const supplierLines = scopedLines.filter((item) => !draftedItemIds.has(item.id));
  const supplierLineIds = supplierLines.map((item) => item.id);
  const { stale_price_days, comparisons } =
    supplierLineIds.length > 0
      ? await loadSupplierComparisonMap(versionId, supplierLineIds)
      : { stale_price_days: 0, comparisons: new Map<string, SupplierComparisonRecord>() };

  const groupsBySupplierId = new Map<string, EstimatePurchaseOrderDraftGroup>();
  const blocked_lines: EstimatePurchaseOrderDraftBlockedLine[] = [];
  const reasonCounts: Record<EstimatePurchaseOrderDraftBlockedReason, number> = {
    selection_missing: 0,
    stale: 0,
    ambiguous: 0,
    no_price: 0,
    missing_quantity: 0,
    non_integer_quantity: 0,
    missing_unit_price: 0,
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

    const isDraftable =
      typeof quantity === "number" &&
      Number.isFinite(quantity) &&
      quantity > 0 &&
      Number.isInteger(quantity) &&
      typeof unitPriceHtCents === "number" &&
      Number.isFinite(unitPriceHtCents) &&
      unitPriceHtCents >= 0 &&
      typeof taxRateBp === "number" &&
      Number.isFinite(taxRateBp) &&
      selectedSupplierPriceId !== null &&
      comparison !== null &&
      comparison.coverage_status === "covered" &&
      selectedAlternative !== null;

    if (!isDraftable) {
      const reason = resolveBlockedReason({
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
        coverage_status: coverageStatus,
        risk_flags: riskFlags,
        selected_alternative: selectedAlternative,
        alternatives,
      });
      return;
    }

    const lineInput: LineInput = {
      quantity,
      unitPriceHtCents,
      taxRateBp,
    };
    const { lineTotals } = computeTotalsFromInputs([lineInput]);
    const [totals] = lineTotals;
    const supplierId = selectedAlternative.supplier_id;
    const existingGroup = groupsBySupplierId.get(supplierId);
    const draftLine: EstimatePurchaseOrderDraftLine = {
      item_id: line.id,
      item_title: line.title,
      quantity,
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
      total_supplier_lines: supplierLines.length,
      draftable_lines: groups.reduce((sum, group) => sum + group.line_count, 0),
      blocked_lines: blocked_lines.length,
      supplier_groups: groups.length,
      selection_missing_lines: reasonCounts.selection_missing,
      stale_lines: reasonCounts.stale,
      ambiguous_lines: reasonCounts.ambiguous,
      no_price_lines: reasonCounts.no_price,
      missing_quantity_lines: reasonCounts.missing_quantity,
      non_integer_quantity_lines: reasonCounts.non_integer_quantity,
      missing_unit_price_lines: reasonCounts.missing_unit_price,
    },
    groups,
    blocked_lines,
  };
}

async function assertDeliverySitesAccessible(
  deliverySiteIds: string[],
  input: Awaited<ReturnType<typeof getDraftOrderContext>>
) {
  const { data, error } = await input.supabase
    .from("delivery_sites")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .in("id", deliverySiteIds);

  if (error) {
    throw mapSupabaseError(error, "Impossible de vérifier les sites de livraison.");
  }

  const knownIds = new Set((data ?? []).map((row) => row.id));
  const missingIds = deliverySiteIds.filter((siteId) => !knownIds.has(siteId));

  if (missingIds.length > 0) {
    throw badRequest("delivery_site_id doit correspondre a un site accessible.", {
      delivery_site_ids: missingIds,
    });
  }
}

async function rollbackCreatedDraftOrders(
  orderIds: string[],
  context: Awaited<ReturnType<typeof getDraftOrderContext>>
) {
  for (const orderId of Array.from(new Set(orderIds))) {
    const { error } = await context.supabase
      .from("purchase_orders")
      .delete()
      .eq("id", orderId);

    if (error) {
      return error;
    }
  }

  return null;
}

export async function createEstimatePurchaseOrderDrafts(
  versionId: string,
  input: EstimatePurchaseOrderDraftsCreateInput
): Promise<EstimatePurchaseOrderDraftCreationResult> {
  const preparation = await getEstimatePurchaseOrderDraftPreparation(versionId);
  const groupsBySupplierId = new Map(preparation.groups.map((group) => [group.supplier_id, group]));
  const requestedItemIds = new Set<string>();

  input.groups.forEach((group) => {
    const preparedGroup = groupsBySupplierId.get(group.supplier_id);
    if (!preparedGroup) {
      throw conflict("Le groupe fournisseur n'est plus preparable dans cet etat.", {
        supplier_id: group.supplier_id,
      }, "ORDER_DRAFT_PREPARATION_STALE");
    }

    const preparedIds = new Set(preparedGroup.lines.map((line) => line.item_id));
    const missingIds = group.item_ids.filter((itemId) => !preparedIds.has(itemId));
    if (missingIds.length > 0) {
      throw conflict("Certaines lignes ne sont plus preparables pour ce fournisseur.", {
        supplier_id: group.supplier_id,
        item_ids: missingIds,
      }, "ORDER_DRAFT_PREPARATION_STALE");
    }

    group.item_ids.forEach((itemId) => {
      if (requestedItemIds.has(itemId)) {
        throw badRequest("Une ligne ne peut etre commandee qu'une seule fois par requete.", {
          item_id: itemId,
        });
      }
      requestedItemIds.add(itemId);
    });
  });

  const context = await getDraftOrderContext();
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const alreadyDraftedItemIds = await listDraftedEstimateItemIds(
    versionId,
    Array.from(requestedItemIds),
    context
  );
  if (alreadyDraftedItemIds.size > 0) {
    throw conflict(
      "Certaines lignes sont déjà rattachées à un brouillon de commande.",
      {
        item_ids: Array.from(alreadyDraftedItemIds).sort(),
      },
      "ORDER_DRAFT_ALREADY_EXISTS"
    );
  }

  await assertDeliverySitesAccessible(
    Array.from(new Set(input.groups.map((group) => group.delivery_site_id))),
    context
  );

  const createdOrders: EstimatePurchaseOrderDraftCreationResult["orders"] = [];
  const createdOrderIds: string[] = [];

  try {
    for (const group of input.groups) {
      const preparedGroup = groupsBySupplierId.get(group.supplier_id);
      if (!preparedGroup) {
        throw conflict("Le groupe fournisseur n'est plus preparable dans cet etat.", {
          supplier_id: group.supplier_id,
        }, "ORDER_DRAFT_PREPARATION_STALE");
      }

      const lines = preparedGroup.lines.filter((line) => group.item_ids.includes(line.item_id));
      if (lines.length === 0) {
        throw badRequest("Chaque groupe doit contenir au moins une ligne draftable.", {
          supplier_id: group.supplier_id,
        });
      }

      const orderDate = new Date();
      const { orderTotals } = computeTotalsFromInputs(
        lines.map((line) => ({
          quantity: line.quantity,
          unitPriceHtCents: line.unit_price_ht_cents,
          taxRateBp: line.tax_rate_bp,
        }))
      );

      const { data: insertedOrder, error: insertError } = await context.supabase
        .from("purchase_orders")
        .insert({
          reference: `TEMP-${Date.now()}-${group.supplier_id}`,
          user_id: context.userId,
          supplier_id: group.supplier_id,
          delivery_site_id: group.delivery_site_id,
          status: "draft",
          expected_delivery_date: parseExpectedDeliveryDate(group.expected_delivery_date),
          notes: group.notes,
          total_ht_cents: orderTotals.totalHtCents,
          total_tax_cents: orderTotals.totalTaxCents,
          total_ttc_cents: orderTotals.totalTtcCents,
          currency: "EUR",
          source_estimate_version_id: versionId,
        })
        .select("id, order_number")
        .single();

      if (insertError || !insertedOrder) {
        throw mapSupabaseError(insertError, "Impossible de créer le brouillon de commande.");
      }

      createdOrderIds.push(insertedOrder.id);

      const reference = buildPurchaseOrderReference(
        insertedOrder.order_number as number,
        orderDate
      );

      const { error: updateError } = await context.supabase
        .from("purchase_orders")
        .update({
          reference,
        })
        .eq("id", insertedOrder.id);

      if (updateError) {
        throw mapSupabaseError(updateError, "Impossible de finaliser la reference commande.");
      }

      const { error: itemsError } = await context.supabase
        .from("purchase_order_items")
        .insert(lines.map((line, index) => ({
          purchase_order_id: insertedOrder.id,
          position: index + 1,
          product_id: null,
          reference: line.supplier_reference,
          designation: line.item_title,
          unit_price_ht_cents: line.unit_price_ht_cents,
          tax_rate_bp: line.tax_rate_bp,
          quantity: line.quantity,
          line_total_ht_cents: line.line_total_ht_cents,
          line_tax_cents: line.line_tax_cents,
          line_total_ttc_cents: line.line_total_ttc_cents,
          source_estimate_item_id: line.item_id,
          source_selected_supplier_price_id: line.selected_supplier_price_id,
        })));

      if (itemsError) {
        throw mapSupabaseError(itemsError, "Impossible d'enregistrer les lignes de commande.");
      }

      createdOrders.push({
        purchase_order_id: insertedOrder.id,
        reference,
        supplier_id: group.supplier_id,
        supplier_name: preparedGroup.supplier_name,
        delivery_site_id: group.delivery_site_id,
        item_count: lines.length,
        total_ht_cents: orderTotals.totalHtCents,
        total_tax_cents: orderTotals.totalTaxCents,
        total_ttc_cents: orderTotals.totalTtcCents,
        ordered_source_item_ids: lines.map((line) => line.item_id),
      });
    }
  } catch (error) {
    if (createdOrderIds.length > 0) {
      const rollbackError = await rollbackCreatedDraftOrders(createdOrderIds, context);

      if (rollbackError) {
        throw internalError(
          "Echec de la creation des brouillons et du rollback automatique.",
          {
            create_error: error instanceof Error ? error.message : "Erreur inconnue.",
            rollback_error: rollbackError,
            purchase_order_ids: createdOrderIds,
          },
          "ORDER_DRAFT_ROLLBACK_FAILED"
        );
      }
    }

    throw error;
  }

  return {
    source_version_id: versionId,
    summary: {
      draft_orders_created: createdOrders.length,
      draft_lines_created: createdOrders.reduce((sum, order) => sum + order.item_count, 0),
    },
    orders: createdOrders,
  };
}
