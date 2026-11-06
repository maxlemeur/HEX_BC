import { isRecord, toNumber, toStringValue, toBooleanValue, getRootPayload, pickRecord, pickArray } from "@/lib/estimates/client-json";

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

export type EstimatePurchaseOrderDraftAlternative = {
  supplierPriceId: string;
  supplierId: string | null;
  supplierName: string | null;
  adjustedUnitPriceCents: number | null;
  supplierReference: string | null;
  productDesignation: string | null;
  isStale: boolean | null;
  isSelected: boolean | null;
};

export type EstimatePurchaseOrderDraftLine = {
  itemId: string;
  itemTitle: string;
  unit: string;
  reviewFingerprint: string;
  quantity: number;
  unitPriceHtCents: number;
  taxRateBp: number;
  lineTotalHtCents: number;
  lineTaxCents: number;
  lineTotalTtcCents: number;
  /** 2.9: what the order carries, in the purchase unit of a converted offer (94 barre at 262,45 €). */
  orderedQuantity: number;
  orderedUnit: string;
  orderedUnitPriceHtCents: number;
  selectedSupplierPriceId: string;
  supplierReference: string | null;
  productDesignation: string;
};

export type EstimatePurchaseOrderDraftGroup = {
  groupKey: string;
  supplierId: string;
  supplierName: string;
  lineCount: number;
  totalHtCents: number;
  totalTaxCents: number;
  totalTtcCents: number;
  lines: EstimatePurchaseOrderDraftLine[];
};

export type EstimatePurchaseOrderDraftBlockedLine = {
  itemId: string;
  itemTitle: string;
  quantity: number | null;
  unitPriceHtCents: number | null;
  taxRateBp: number | null;
  selectedSupplierPriceId: string | null;
  reason: EstimatePurchaseOrderDraftBlockedReason;
  reasonDetail?: string | null;
  coverageStatus: string | null;
  riskFlags: string[];
  selectedAlternative: EstimatePurchaseOrderDraftAlternative | null;
  alternatives: EstimatePurchaseOrderDraftAlternative[];
};

export type EstimatePurchaseOrderDraftPreparation = {
  versionId: string;
  stalePriceDays: number;
  summary: {
    totalSupplierLines: number;
    draftableLines: number;
    blockedLines: number;
    supplierGroups: number;
    selectionMissingLines: number;
    staleLines: number;
    ambiguousLines: number;
    noPriceLines: number;
    missingQuantityLines: number;
    nonIntegerQuantityLines: number;
    missingUnitPriceLines: number;
    transferredLines: number;
  };
  groups: EstimatePurchaseOrderDraftGroup[];
  blockedLines: EstimatePurchaseOrderDraftBlockedLine[];
  transferredLines: EstimatePurchaseOrderTransferredLine[];
};

export type EstimatePurchaseOrderStatus =
  | "draft"
  | "sent"
  | "confirmed"
  | "received"
  | "canceled"
  | "deleted";

export type EstimatePurchaseOrderTransferredLine = {
  itemId: string;
  itemTitle: string;
  purchaseOrderId: string;
  reference: string;
  status: EstimatePurchaseOrderStatus;
  quantity: number;
  canOpen: boolean;
};

export type CreateEstimatePurchaseOrderDraftGroupInput = {
  supplierId: string;
  deliverySiteId: string;
  deliverySiteUpdatedAt: string;
  itemIds: string[];
  expectedDeliveryDate?: string | null;
  notes?: string | null;
};

export type CreateEstimatePurchaseOrderDraftsInput = {
  idempotencyKey: string;
  reviewedLines: Array<{ itemId: string; reviewFingerprint: string }>;
  groups: CreateEstimatePurchaseOrderDraftGroupInput[];
};

export type EstimatePurchaseOrderDraftCreationResult = {
  sourceVersionId: string;
  idempotencyKey: string;
  replayed: boolean;
  summary: {
    draftOrdersCreated: number;
    draftLinesCreated: number;
  };
  orders: Array<{
    purchaseOrderId: string;
    currentStatus: EstimatePurchaseOrderStatus;
    canOpen: boolean;
    reference: string;
    supplierId: string;
    supplierName: string;
    deliverySiteId: string;
    itemCount: number;
    totalHtCents: number;
    totalTaxCents: number;
    totalTtcCents: number;
    orderedSourceItemIds: string[];
  }>;
};

export function isEstimatePurchaseOrderDraftBlockedReason(
  value: string
): value is EstimatePurchaseOrderDraftBlockedReason {
  return (
    value === "selection_missing" ||
    value === "stale" ||
    value === "ambiguous" ||
    value === "no_price" ||
    value === "missing_quantity" ||
    value === "invalid_quantity" ||
    value === "amount_out_of_range" ||
    value === "missing_unit_price" ||
    value === "supplier_offer_ineligible"
  );
}

export function parseEstimatePurchaseOrderDraftAlternative(
  value: unknown
): EstimatePurchaseOrderDraftAlternative | null {
  if (!isRecord(value)) return null;

  const supplierPriceId =
    toStringValue(value.supplier_price_id) ??
    toStringValue(value.supplierPriceId);
  if (!supplierPriceId) {
    return null;
  }

  return {
    supplierPriceId,
    supplierId:
      toStringValue(value.supplier_id) ??
      toStringValue(value.supplierId) ??
      null,
    supplierName:
      toStringValue(value.supplier_name) ??
      toStringValue(value.supplierName) ??
      null,
    adjustedUnitPriceCents:
      toNumber(value.adjusted_unit_price_cents) ??
      toNumber(value.adjustedUnitPriceCents) ??
      null,
    supplierReference:
      toStringValue(value.supplier_reference) ??
      toStringValue(value.supplierReference) ??
      null,
    productDesignation:
      toStringValue(value.product_designation) ??
      toStringValue(value.productDesignation) ??
      null,
    isStale: toBooleanValue(value.is_stale) ?? toBooleanValue(value.isStale) ?? null,
    isSelected:
      toBooleanValue(value.is_selected) ?? toBooleanValue(value.isSelected) ?? null,
  };
}

export function parseEstimatePurchaseOrderDraftLine(
  value: unknown
): EstimatePurchaseOrderDraftLine | null {
  if (!isRecord(value)) return null;

  const itemId = toStringValue(value.item_id) ?? toStringValue(value.itemId);
  const itemTitle = toStringValue(value.item_title) ?? toStringValue(value.itemTitle);
  const unit = toStringValue(value.unit);
  const reviewFingerprint =
    toStringValue(value.review_fingerprint) ?? toStringValue(value.reviewFingerprint);
  const quantity = toNumber(value.quantity);
  const unitPriceHtCents =
    toNumber(value.unit_price_ht_cents) ?? toNumber(value.unitPriceHtCents);
  const taxRateBp = toNumber(value.tax_rate_bp) ?? toNumber(value.taxRateBp);
  const lineTotalHtCents =
    toNumber(value.line_total_ht_cents) ?? toNumber(value.lineTotalHtCents);
  const lineTaxCents =
    toNumber(value.line_tax_cents) ?? toNumber(value.lineTaxCents);
  const lineTotalTtcCents =
    toNumber(value.line_total_ttc_cents) ?? toNumber(value.lineTotalTtcCents);
  const selectedSupplierPriceId =
    toStringValue(value.selected_supplier_price_id) ??
    toStringValue(value.selectedSupplierPriceId);
  const productDesignation =
    toStringValue(value.product_designation) ??
    toStringValue(value.productDesignation);

  if (
    !itemId ||
    !itemTitle ||
    !unit ||
    !reviewFingerprint ||
    !/^[a-f0-9]{64}$/.test(reviewFingerprint) ||
    quantity === null ||
    unitPriceHtCents === null ||
    taxRateBp === null ||
    lineTotalHtCents === null ||
    lineTaxCents === null ||
    lineTotalTtcCents === null ||
    !selectedSupplierPriceId ||
    !productDesignation
  ) {
    return null;
  }

  return {
    itemId,
    itemTitle,
    unit,
    reviewFingerprint,
    quantity,
    unitPriceHtCents,
    taxRateBp,
    lineTotalHtCents,
    lineTaxCents,
    lineTotalTtcCents,
    orderedQuantity:
      toNumber(value.ordered_quantity) ?? toNumber(value.orderedQuantity) ?? quantity,
    orderedUnit:
      toStringValue(value.ordered_unit) ?? toStringValue(value.orderedUnit) ?? unit,
    orderedUnitPriceHtCents:
      toNumber(value.ordered_unit_price_ht_cents) ??
      toNumber(value.orderedUnitPriceHtCents) ??
      unitPriceHtCents,
    selectedSupplierPriceId,
    supplierReference:
      toStringValue(value.supplier_reference) ??
      toStringValue(value.supplierReference) ??
      null,
    productDesignation,
  };
}

export function parseEstimatePurchaseOrderDraftGroup(
  value: unknown
): EstimatePurchaseOrderDraftGroup | null {
  if (!isRecord(value)) return null;

  const groupKey = toStringValue(value.group_key) ?? toStringValue(value.groupKey);
  const supplierId =
    toStringValue(value.supplier_id) ?? toStringValue(value.supplierId);
  const supplierName =
    toStringValue(value.supplier_name) ?? toStringValue(value.supplierName);
  const lineCount = toNumber(value.line_count) ?? toNumber(value.lineCount);
  const totalHtCents =
    toNumber(value.total_ht_cents) ?? toNumber(value.totalHtCents);
  const totalTaxCents =
    toNumber(value.total_tax_cents) ?? toNumber(value.totalTaxCents);
  const totalTtcCents =
    toNumber(value.total_ttc_cents) ?? toNumber(value.totalTtcCents);
  const lines = pickArray(value, ["lines"]).map(parseEstimatePurchaseOrderDraftLine);

  if (
    !groupKey ||
    !supplierId ||
    !supplierName ||
    lineCount === null ||
    totalHtCents === null ||
    totalTaxCents === null ||
    totalTtcCents === null ||
    lines.length !== lineCount ||
    lines.some((line) => line === null)
  ) {
    return null;
  }

  return {
    groupKey,
    supplierId,
    supplierName,
    lineCount,
    totalHtCents,
    totalTaxCents,
    totalTtcCents,
    lines: lines as EstimatePurchaseOrderDraftLine[],
  };
}

export function parseEstimatePurchaseOrderDraftBlockedLine(
  value: unknown
): EstimatePurchaseOrderDraftBlockedLine | null {
  if (!isRecord(value)) return null;

  const itemId = toStringValue(value.item_id) ?? toStringValue(value.itemId);
  const itemTitle = toStringValue(value.item_title) ?? toStringValue(value.itemTitle);
  const reasonRaw = toStringValue(value.reason);

  if (!itemId || !itemTitle || !reasonRaw || !isEstimatePurchaseOrderDraftBlockedReason(reasonRaw)) {
    return null;
  }

  return {
    itemId,
    itemTitle,
    quantity: toNumber(value.quantity),
    unitPriceHtCents:
      toNumber(value.unit_price_ht_cents) ?? toNumber(value.unitPriceHtCents),
    taxRateBp: toNumber(value.tax_rate_bp) ?? toNumber(value.taxRateBp),
    selectedSupplierPriceId:
      toStringValue(value.selected_supplier_price_id) ??
      toStringValue(value.selectedSupplierPriceId) ??
      null,
    reason: reasonRaw,
    reasonDetail: toStringValue(value.reason_detail) ?? toStringValue(value.reasonDetail),
    coverageStatus:
      toStringValue(value.coverage_status) ??
      toStringValue(value.coverageStatus) ??
      null,
    riskFlags: pickArray(value, ["risk_flags", "riskFlags"])
      .map((entry) => toStringValue(entry))
      .filter((entry): entry is string => entry !== null),
    selectedAlternative: parseEstimatePurchaseOrderDraftAlternative(
      value.selected_alternative ?? value.selectedAlternative
    ),
    alternatives: pickArray(value, ["alternatives"])
      .map((entry) => parseEstimatePurchaseOrderDraftAlternative(entry))
      .filter((entry): entry is EstimatePurchaseOrderDraftAlternative => entry !== null),
  };
}

export function parseEstimatePurchaseOrderStatus(value: unknown): EstimatePurchaseOrderStatus | null {
  return value === "draft" || value === "sent" || value === "confirmed" ||
    value === "received" || value === "canceled" || value === "deleted" ? value : null;
}

export function parseEstimatePurchaseOrderTransferredLine(
  value: unknown
): EstimatePurchaseOrderTransferredLine | null {
  if (!isRecord(value)) return null;
  const itemId = toStringValue(value.item_id) ?? toStringValue(value.itemId);
  const itemTitle = toStringValue(value.item_title) ?? toStringValue(value.itemTitle);
  const purchaseOrderId = toStringValue(value.purchase_order_id) ?? toStringValue(value.purchaseOrderId);
  const reference = toStringValue(value.reference);
  const status = parseEstimatePurchaseOrderStatus(value.status);
  const quantity = toNumber(value.quantity);
  const canOpen = toBooleanValue(value.can_open) ?? toBooleanValue(value.canOpen);
  if (!itemId || !itemTitle || !purchaseOrderId || !reference || !status || quantity === null) {
    return null;
  }
  if (canOpen === null) return null;
  return { itemId, itemTitle, purchaseOrderId, reference, status, quantity, canOpen };
}

export function parseEstimatePurchaseOrderDraftPreparation(
  payload: unknown
): EstimatePurchaseOrderDraftPreparation | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const versionId = toStringValue(root.version_id) ?? toStringValue(root.versionId);
  const stalePriceDays =
    toNumber(root.stale_price_days) ?? toNumber(root.stalePriceDays);
  const summary = pickRecord(root, ["summary"]);

  if (!versionId || stalePriceDays === null || !summary) {
    return null;
  }

  const totalSupplierLines =
    toNumber(summary.total_supplier_lines) ?? toNumber(summary.totalSupplierLines);
  const draftableLines =
    toNumber(summary.draftable_lines) ?? toNumber(summary.draftableLines);
  const blockedLines =
    toNumber(summary.blocked_lines) ?? toNumber(summary.blockedLines);
  const supplierGroups =
    toNumber(summary.supplier_groups) ?? toNumber(summary.supplierGroups);
  const selectionMissingLines =
    toNumber(summary.selection_missing_lines) ??
    toNumber(summary.selectionMissingLines);
  const staleLines = toNumber(summary.stale_lines) ?? toNumber(summary.staleLines);
  const ambiguousLines =
    toNumber(summary.ambiguous_lines) ?? toNumber(summary.ambiguousLines);
  const noPriceLines =
    toNumber(summary.no_price_lines) ?? toNumber(summary.noPriceLines);
  const missingQuantityLines =
    toNumber(summary.missing_quantity_lines) ??
    toNumber(summary.missingQuantityLines);
  const nonIntegerQuantityLines =
    toNumber(summary.invalid_quantity_lines) ??
    toNumber(summary.nonIntegerQuantityLines);
  const missingUnitPriceLines =
    toNumber(summary.missing_unit_price_lines) ??
    toNumber(summary.missingUnitPriceLines);
  const transferredLinesCount =
    toNumber(summary.transferred_lines) ?? toNumber(summary.transferredLines);
  const groups = pickArray(root, ["groups"]).map(parseEstimatePurchaseOrderDraftGroup);
  const transferredLines = pickArray(root, ["transferred_lines", "transferredLines"])
    .map(parseEstimatePurchaseOrderTransferredLine);

  if (
    totalSupplierLines === null ||
    draftableLines === null ||
    blockedLines === null ||
    supplierGroups === null ||
    selectionMissingLines === null ||
    staleLines === null ||
    ambiguousLines === null ||
    noPriceLines === null ||
    missingQuantityLines === null ||
    nonIntegerQuantityLines === null ||
    missingUnitPriceLines === null ||
    transferredLinesCount === null ||
    groups.length !== supplierGroups || groups.some((group) => group === null) ||
    transferredLines.length !== transferredLinesCount || transferredLines.some((line) => line === null)
  ) {
    return null;
  }

  return {
    versionId,
    stalePriceDays,
    summary: {
      totalSupplierLines,
      draftableLines,
      blockedLines,
      supplierGroups,
      selectionMissingLines,
      staleLines,
      ambiguousLines,
      noPriceLines,
      missingQuantityLines,
      nonIntegerQuantityLines,
      missingUnitPriceLines,
      transferredLines: transferredLinesCount,
    },
    groups: groups as EstimatePurchaseOrderDraftGroup[],
    transferredLines: transferredLines as EstimatePurchaseOrderTransferredLine[],
    blockedLines: pickArray(root, ["blocked_lines", "blockedLines"])
      .map((entry) => parseEstimatePurchaseOrderDraftBlockedLine(entry))
      .filter((entry): entry is EstimatePurchaseOrderDraftBlockedLine => entry !== null),
  };
}

export function parseEstimatePurchaseOrderDraftCreationResult(
  payload: unknown
): EstimatePurchaseOrderDraftCreationResult | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const sourceVersionId =
    toStringValue(root.source_version_id) ?? toStringValue(root.sourceVersionId);
  const idempotencyKey = toStringValue(root.idempotency_key) ?? toStringValue(root.idempotencyKey);
  const replayed = toBooleanValue(root.replayed);
  const summary = pickRecord(root, ["summary"]);

  if (!sourceVersionId || !summary || !idempotencyKey || replayed === null) {
    return null;
  }

  const draftOrdersCreated =
    toNumber(summary.draft_orders_created) ??
    toNumber(summary.draftOrdersCreated);
  const draftLinesCreated =
    toNumber(summary.draft_lines_created) ??
    toNumber(summary.draftLinesCreated);

  if (draftOrdersCreated === null || draftLinesCreated === null) {
    return null;
  }

  const orders = pickArray(root, ["orders"])
    .map((entry) => {
      if (!isRecord(entry)) return null;

      const purchaseOrderId =
        toStringValue(entry.purchase_order_id) ??
        toStringValue(entry.purchaseOrderId);
      const reference = toStringValue(entry.reference);
      const currentStatus = parseEstimatePurchaseOrderStatus(entry.current_status ?? entry.currentStatus);
      const canOpen = toBooleanValue(entry.can_open) ?? toBooleanValue(entry.canOpen);
      const supplierId =
        toStringValue(entry.supplier_id) ?? toStringValue(entry.supplierId);
      const supplierName =
        toStringValue(entry.supplier_name) ?? toStringValue(entry.supplierName);
      const deliverySiteId =
        toStringValue(entry.delivery_site_id) ??
        toStringValue(entry.deliverySiteId);
      const itemCount = toNumber(entry.item_count) ?? toNumber(entry.itemCount);
      const totalHtCents =
        toNumber(entry.total_ht_cents) ?? toNumber(entry.totalHtCents);
      const totalTaxCents =
        toNumber(entry.total_tax_cents) ?? toNumber(entry.totalTaxCents);
      const totalTtcCents =
        toNumber(entry.total_ttc_cents) ?? toNumber(entry.totalTtcCents);

      if (
        !purchaseOrderId ||
        !currentStatus ||
        canOpen === null ||
        !reference ||
        !supplierId ||
        !supplierName ||
        !deliverySiteId ||
        itemCount === null ||
        totalHtCents === null ||
        totalTaxCents === null ||
        totalTtcCents === null
      ) {
        return null;
      }

      return {
        purchaseOrderId,
        currentStatus,
        canOpen,
        reference,
        supplierId,
        supplierName,
        deliverySiteId,
        itemCount,
        totalHtCents,
        totalTaxCents,
        totalTtcCents,
        orderedSourceItemIds: pickArray(entry, [
          "ordered_source_item_ids",
          "orderedSourceItemIds",
        ])
          .map((itemId) => toStringValue(itemId))
          .filter((itemId): itemId is string => itemId !== null),
      };
    });

  if (orders.length !== draftOrdersCreated || orders.some((order) => order === null)) return null;

  return {
    sourceVersionId,
    idempotencyKey,
    replayed,
    summary: {
      draftOrdersCreated,
      draftLinesCreated,
    },
    orders: orders as EstimatePurchaseOrderDraftCreationResult["orders"],
  };
}
