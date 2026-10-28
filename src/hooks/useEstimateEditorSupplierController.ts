"use client";

import type { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { useEstimateEditorItemsOperation } from "@/hooks/useEstimateEditorItemsOperation";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import { bulkUpdateEstimateItems, type EstimateVersionToken } from "@/lib/estimates/client";
import { resolveEditorEngineContext } from "@/lib/estimates/editor-engine";
import { commitEstimateV3Operations } from "@/lib/estimates/v3-editor-writer";
import {
  buildEstimateItemUpdatePayload,
  type EditorEstimateItem,
  type EstimateItem,
  type EstimateItemUpdatePayload,
  type EstimateVersionRow,
  type EstimateVersionTotalsPatch,
} from "@/lib/estimates/editor-items";
import { isRecord, toFiniteNumber, toNonEmptyString } from "@/lib/estimates/editor-values";
import type {
  EstimateSupplierComparisonAlternativeContract,
  EstimateSupplierComparisonAlternativeKind,
  EstimateSupplierComparisonCoverageStatus,
  EstimateSupplierPreselectionException,
  EstimateSupplierPreselectionExceptionReason,
  EstimateSupplierPreselectionProposal,
  EstimateSupplierPreselectionReview,
  EstimateSupplierPreselectionSummary,
} from "@/lib/estimates/supplier-preselection";

const ALTERNATIVE_KINDS = [
  "best_price",
  "most_recent",
  "preferred_supplier",
  "selected_current",
] as const satisfies EstimateSupplierComparisonAlternativeKind[];

const EXCEPTION_REASONS = [
  "divergence",
  "stale",
  "ambiguous",
  "no_price",
  "currency_mismatch",
] as const satisfies EstimateSupplierPreselectionExceptionReason[];

const COVERAGE_STATUSES = [
  "covered",
  "ambiguous",
  "no_price",
  "stale",
] as const satisfies EstimateSupplierComparisonCoverageStatus[];

const RISK_FLAGS = new Set<
  EstimateSupplierPreselectionException["risk_flags"][number]
>([
  "multiple_alternatives",
  "selection_missing",
  "selected_stale",
  "selected_not_best_price",
]);

const EMPTY_REVIEW: EstimateSupplierPreselectionReview = {
  summary: {
    total_items: 0,
    proposed_items: 0,
    exception_items: 0,
    already_selected_items: 0,
    divergence_items: 0,
    stale_items: 0,
    ambiguous_items: 0,
    no_price_items: 0,
    currency_mismatch_items: 0,
  },
  proposals: [],
  exceptions: [],
};

type SupplierDialogState = {
  isOpen: boolean;
  review: EstimateSupplierPreselectionReview;
  selectedItemIds: string[];
  error: string | null;
  isLoading: boolean;
  isApplying: boolean;
};

type ScopedSupplierDialogState = {
  routeVersionId: string;
  dialog: SupplierDialogState;
};

/**
 * Lot 2, sous-lot 2.6 (F26-17, choix du doc 2.6) : sur une v3, la présélection passe par l'écrivain
 * de lot de 2.5, comme une saisie de PR FO dans la grille : seuls le PR FO et l'offre retenue partent,
 * le serveur recalcule PU, nets, TVA et totaux et les vérifie (D12) dans la même transaction.
 */
function writeEstimateV3SupplierPreselection(
  versionId: string,
  updatedAt: string,
  updates: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>
): Promise<EstimateVersionToken> {
  return commitEstimateV3Operations(
    versionId,
    updatedAt,
    updates.map((entry) => ({ op: "update" as const, id: entry.id, data: entry.updates })),
    "La présélection fournisseurs n'a pas été enregistrée."
  );
}

const EMPTY_DIALOG_STATE: SupplierDialogState = {
  isOpen: false,
  review: EMPTY_REVIEW,
  selectedItemIds: [],
  error: null,
  isLoading: false,
  isApplying: false,
};

function normalizeAlternative(
  value: unknown
): EstimateSupplierComparisonAlternativeContract | null {
  if (!isRecord(value)) return null;
  const supplierPriceId = toNonEmptyString(value.supplier_price_id);
  const supplierId = toNonEmptyString(value.supplier_id);
  const supplierName = toNonEmptyString(value.supplier_name);
  const productDesignation = toNonEmptyString(value.product_designation);
  const rawKind = toNonEmptyString(value.kind);
  if (
    !supplierPriceId ||
    !supplierId ||
    !supplierName ||
    !productDesignation ||
    !rawKind ||
    !ALTERNATIVE_KINDS.includes(rawKind as EstimateSupplierComparisonAlternativeKind)
  ) {
    return null;
  }

  return {
    kind: rawKind as EstimateSupplierComparisonAlternativeKind,
    supplier_price_id: supplierPriceId,
    supplier_id: supplierId,
    supplier_name: supplierName,
    adjusted_unit_price_cents: toFiniteNumber(value.adjusted_unit_price_cents, 0),
    adjusted_purchase_unit_price_cents: typeof value.adjusted_purchase_unit_price_cents === "number" &&
      Number.isFinite(value.adjusted_purchase_unit_price_cents) ? value.adjusted_purchase_unit_price_cents : null,
    currency: toNonEmptyString(value.currency),
    unit: toNonEmptyString(value.unit),
    min_quantity: typeof value.min_quantity === "number" ? value.min_quantity : undefined,
    valid_from: toNonEmptyString(value.valid_from),
    valid_to: toNonEmptyString(value.valid_to),
    is_active: typeof value.is_active === "boolean" ? value.is_active : undefined,
    // Raw price and A7 marking, needed by the eligibility check and the "Inclus"/"Gratuit" labels.
    unit_price_cents: typeof value.unit_price_cents === "number" && Number.isFinite(value.unit_price_cents)
      ? value.unit_price_cents : null,
    zero_price_kind: toNonEmptyString(value.zero_price_kind),
    estimate_unit_code: toNonEmptyString(value.estimate_unit_code),
    estimate_units_per_purchase_unit: typeof value.estimate_units_per_purchase_unit === "number" ||
      typeof value.estimate_units_per_purchase_unit === "string" ? value.estimate_units_per_purchase_unit : null,
    purchase_rounding: toNonEmptyString(value.purchase_rounding),
    supplier_reference: toNonEmptyString(value.supplier_reference),
    catalogue_url: toNonEmptyString(value.catalogue_url),
    updated_at: toNonEmptyString(value.updated_at),
    is_stale: value.is_stale === true,
    product_designation: productDesignation,
    is_selected: value.is_selected === true,
  };
}

function normalizeSummary(value: unknown): EstimateSupplierPreselectionSummary {
  const record = isRecord(value) ? value : {};
  const count = (key: string) =>
    Math.max(0, Math.floor(toFiniteNumber(record[key], 0)));
  return {
    total_items: count("total_items"),
    proposed_items: count("proposed_items"),
    exception_items: count("exception_items"),
    already_selected_items: count("already_selected_items"),
    divergence_items: count("divergence_items"),
    stale_items: count("stale_items"),
    ambiguous_items: count("ambiguous_items"),
    no_price_items: count("no_price_items"),
    currency_mismatch_items: count("currency_mismatch_items"),
  };
}

function normalizeProposal(
  value: unknown
): EstimateSupplierPreselectionProposal | null {
  if (!isRecord(value)) return null;
  const itemId = toNonEmptyString(value.item_id);
  const itemTitle = toNonEmptyString(value.item_title);
  const proposedAlternative = normalizeAlternative(value.proposed_alternative);
  const currentAlternative = normalizeAlternative(value.current_alternative);
  const patch = isRecord(value.patch) ? value.patch : null;
  const selectedSupplierPriceId = patch
    ? toNonEmptyString(patch.selected_supplier_price_id)
    : null;
  const explanation = toNonEmptyString(value.explanation);
  if (
    !itemId ||
    !itemTitle ||
    !proposedAlternative ||
    !patch ||
    !selectedSupplierPriceId ||
    value.reason !== "single_clear_option" ||
    !explanation
  ) {
    return null;
  }

  return {
    item_id: itemId,
    item_title: itemTitle,
    item_unit: toNonEmptyString(value.item_unit),
    current_alternative: currentAlternative,
    proposed_alternative: proposedAlternative,
    patch: {
      unit_price_ht_cents: Math.max(
        0,
        Math.floor(toFiniteNumber(patch.unit_price_ht_cents, 0))
      ),
      selected_supplier_price_id: selectedSupplierPriceId,
    },
    reason: "single_clear_option",
    explanation,
    is_reversible: true,
  };
}

function normalizeException(
  value: unknown
): EstimateSupplierPreselectionException | null {
  if (!isRecord(value)) return null;
  const itemId = toNonEmptyString(value.item_id);
  const itemTitle = toNonEmptyString(value.item_title);
  const rawReason = toNonEmptyString(value.reason);
  const rawCoverageStatus = toNonEmptyString(value.coverage_status);
  if (
    !itemId ||
    !itemTitle ||
    !rawReason ||
    !rawCoverageStatus ||
    !EXCEPTION_REASONS.includes(rawReason as EstimateSupplierPreselectionExceptionReason) ||
    !COVERAGE_STATUSES.includes(
      rawCoverageStatus as EstimateSupplierComparisonCoverageStatus
    )
  ) {
    return null;
  }

  const riskFlags = Array.isArray(value.risk_flags)
    ? value.risk_flags
        .map((entry) => toNonEmptyString(entry))
        .filter(
          (entry): entry is EstimateSupplierPreselectionException["risk_flags"][number] =>
            entry !== null &&
            RISK_FLAGS.has(
              entry as EstimateSupplierPreselectionException["risk_flags"][number]
            )
        )
    : [];
  const alternatives = Array.isArray(value.alternatives)
    ? value.alternatives
        .map(normalizeAlternative)
        .filter(
          (
            entry
          ): entry is EstimateSupplierComparisonAlternativeContract => entry !== null
        )
    : [];

  return {
    item_id: itemId,
    item_title: itemTitle,
    item_unit: toNonEmptyString(value.item_unit),
    reason: rawReason as EstimateSupplierPreselectionExceptionReason,
    coverage_status: rawCoverageStatus as EstimateSupplierComparisonCoverageStatus,
    risk_flags: riskFlags,
    selected_alternative: normalizeAlternative(value.selected_alternative),
    alternatives,
  };
}

export function normalizeSupplierPreselectionReview(
  payload: unknown
): EstimateSupplierPreselectionReview {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
  const container =
    data && isRecord(data.bulk_preselection)
      ? data.bulk_preselection
      : isRecord(payload) && isRecord(payload.bulk_preselection)
        ? payload.bulk_preselection
        : null;
  if (!container) return EMPTY_REVIEW;

  return {
    summary: normalizeSummary(container.summary),
    proposals: Array.isArray(container.proposals)
      ? container.proposals
          .map(normalizeProposal)
          .filter(
            (entry): entry is EstimateSupplierPreselectionProposal => entry !== null
          )
      : [],
    exceptions: Array.isArray(container.exceptions)
      ? container.exceptions
          .map(normalizeException)
          .filter(
            (entry): entry is EstimateSupplierPreselectionException => entry !== null
          )
      : [],
  };
}

type EstimateEditorSupplierControllerInput = {
  document?: EstimateEditorDocument;
  routeVersionId: string;
  items: EditorEstimateItem[];
  isMutationBlocked: boolean;
  mutationBlockedMessage: string;
  getItemsSnapshot: () => EditorEstimateItem[];
  getVersionSnapshot: () => EstimateVersionRow | null;
  normalizeLine: (item: EditorEstimateItem) => EditorEstimateItem;
  setItems: Dispatch<SetStateAction<EditorEstimateItem[]>>;
  setTotalsOutOfSync: (value: boolean) => void;
  reportError: (message: string | null) => void;
  resolveErrorMessage: (message: string) => string;
  /** Version totals of these rows, from the editor's persisted-totals calculation. */
  computeVersionTotalsPatch: (
    items: EditorEstimateItem[]
  ) => EstimateVersionTotalsPatch | undefined;
  /** `contentRevision` : rendue par l'écrivain v3 seulement (lot 2, sous-lot 2.6). */
  applyVersionToken: (
    updatedAt: string,
    totals?: EstimateVersionTotalsPatch,
    contentRevision?: number
  ) => void;
  markItemsSynced: (
    entries: ReadonlyArray<{ id: string; updates: EstimateItemUpdatePayload }>
  ) => void;
  ensureGroupedActionCanProceed: (actionLabel: string) => Promise<boolean>;
  handleVersionConflict: (
    error: unknown,
    options?: { persistDraft?: boolean }
  ) => boolean;
};

export function useEstimateEditorSupplierController({
  document,
  routeVersionId,
  items,
  isMutationBlocked,
  mutationBlockedMessage,
  getItemsSnapshot,
  getVersionSnapshot,
  normalizeLine,
  setItems,
  setTotalsOutOfSync,
  reportError,
  resolveErrorMessage,
  computeVersionTotalsPatch,
  applyVersionToken,
  markItemsSynced,
  ensureGroupedActionCanProceed,
  handleVersionConflict,
}: EstimateEditorSupplierControllerInput) {
  const { beginItemsOperation, isItemsOperationCurrent, isItemsDocumentCurrent, rollbackItems, acceptItemsReceipt } = useEstimateEditorItemsOperation({
    document, getItemsSnapshot, setItems, applyVersionToken, markItemsSynced,
  });
  const [scopedDialogState, setScopedDialogState] =
    useState<ScopedSupplierDialogState>(() => ({
      routeVersionId,
      dialog: EMPTY_DIALOG_STATE,
    }));
  const activeRouteRef = useRef(routeVersionId);
  const requestGenerationRef = useRef(0);
  const applyingRef = useRef(false);

  useLayoutEffect(() => {
    activeRouteRef.current = routeVersionId;
    requestGenerationRef.current += 1;
    applyingRef.current = false;
  }, [routeVersionId]);

  const dialogState =
    scopedDialogState.routeVersionId === routeVersionId
      ? scopedDialogState.dialog
      : EMPTY_DIALOG_STATE;
  const { isOpen, review, selectedItemIds, error, isLoading, isApplying } =
    dialogState;

  const isCurrentRoute = useCallback(
    (versionId: string) => activeRouteRef.current === versionId,
    []
  );

  const selectableItemIds = useMemo(
    () => new Set(review.proposals.map((proposal) => proposal.item_id)),
    [review.proposals]
  );
  const visibleSelectedItemIds = useMemo(
    () => selectedItemIds.filter((itemId) => selectableItemIds.has(itemId)),
    [selectableItemIds, selectedItemIds]
  );
  const selectedProposals = useMemo(() => {
    const selected = new Set(visibleSelectedItemIds);
    return review.proposals.filter((proposal) => selected.has(proposal.item_id));
  }, [review.proposals, visibleSelectedItemIds]);

  const open = useCallback(async () => {
    if (!isCurrentRoute(routeVersionId) || applyingRef.current) return;
    if (isMutationBlocked) {
      reportError(mutationBlockedMessage);
      return;
    }
    const versionSnapshot = getVersionSnapshot();
    if (!versionSnapshot || versionSnapshot.id !== routeVersionId) {
      reportError("Version introuvable.");
      return;
    }
    if (!getItemsSnapshot().some((item) => item.item_type === "line")) {
      reportError("Aucune ligne de devis disponible.");
      return;
    }

    const targetVersionId = versionSnapshot.id;
    const generation = ++requestGenerationRef.current;
    reportError(null);
    setScopedDialogState({
      routeVersionId: targetVersionId,
      dialog: {
        ...EMPTY_DIALOG_STATE,
        isOpen: true,
        isLoading: true,
      },
    });
    try {
      const response = await fetch(
        `/api/estimates/${targetVersionId}/supplier-comparisons`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ all_items: true }),
        }
      );
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const apiMessage =
          isRecord(payload) && isRecord(payload.error)
            ? toNonEmptyString(payload.error.message)
            : null;
        throw new Error(
          apiMessage ?? "Impossible de charger la preselection fournisseurs."
        );
      }
      if (
        !isCurrentRoute(targetVersionId) ||
        requestGenerationRef.current !== generation
      ) {
        return;
      }
      const nextReview = normalizeSupplierPreselectionReview(payload);
      setScopedDialogState((previous) =>
        previous.routeVersionId === targetVersionId
          ? {
              ...previous,
              dialog: {
                ...previous.dialog,
                review: nextReview,
                selectedItemIds: nextReview.proposals.map(
                  (proposal) => proposal.item_id
                ),
              },
            }
          : previous
      );
    } catch (caught) {
      if (
        !isCurrentRoute(targetVersionId) ||
        requestGenerationRef.current !== generation
      ) {
        return;
      }
      const nextError = resolveErrorMessage(
        caught instanceof Error
          ? caught.message
          : "Impossible de charger la preselection fournisseurs."
      );
      setScopedDialogState((previous) =>
        previous.routeVersionId === targetVersionId
          ? {
              ...previous,
              dialog: { ...previous.dialog, error: nextError },
            }
          : previous
      );
    } finally {
      if (
        isCurrentRoute(targetVersionId) &&
        requestGenerationRef.current === generation
      ) {
        setScopedDialogState((previous) =>
          previous.routeVersionId === targetVersionId
            ? {
                ...previous,
                dialog: { ...previous.dialog, isLoading: false },
              }
            : previous
        );
      }
    }
  }, [
    getItemsSnapshot,
    getVersionSnapshot,
    isCurrentRoute,
    isMutationBlocked,
    mutationBlockedMessage,
    reportError,
    resolveErrorMessage,
    routeVersionId,
  ]);

  const close = useCallback(() => {
    if (!isCurrentRoute(routeVersionId) || applyingRef.current) return;
    requestGenerationRef.current += 1;
    setScopedDialogState((previous) => {
      const currentDialog =
        previous.routeVersionId === routeVersionId
          ? previous.dialog
          : EMPTY_DIALOG_STATE;
      return {
        routeVersionId,
        dialog: {
          ...currentDialog,
          isOpen: false,
          error: null,
          isLoading: false,
        },
      };
    });
  }, [isCurrentRoute, routeVersionId]);

  const toggleItem = useCallback(
    (itemId: string, checked: boolean) => {
      if (!isCurrentRoute(routeVersionId)) return;
      setScopedDialogState((previous) => {
        const currentDialog =
          previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE;
        const currentIds = currentDialog.selectedItemIds;
        const nextIds = checked
          ? currentIds.includes(itemId)
            ? currentIds
            : [...currentIds, itemId]
          : currentIds.includes(itemId)
            ? currentIds.filter((candidate) => candidate !== itemId)
            : currentIds;
        return {
          routeVersionId,
          dialog: { ...currentDialog, selectedItemIds: nextIds },
        };
      });
    },
    [isCurrentRoute, routeVersionId]
  );

  const toggleAll = useCallback(
    (checked: boolean) => {
      if (!isCurrentRoute(routeVersionId)) return;
      setScopedDialogState((previous) => {
        const currentDialog =
          previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE;
        return {
          routeVersionId,
          dialog: {
            ...currentDialog,
            selectedItemIds: checked
              ? currentDialog.review.proposals.map(
                  (proposal) => proposal.item_id
                )
              : [],
          },
        };
      });
    },
    [isCurrentRoute, routeVersionId]
  );

  const apply = useCallback(async () => {
    if (!isItemsDocumentCurrent()) return;
    if (!isCurrentRoute(routeVersionId) || applyingRef.current) return;
    const scope = document?.captureScope();
    if (isMutationBlocked) {
      setScopedDialogState((previous) => ({
        routeVersionId,
        dialog: {
          ...(previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE),
          error: mutationBlockedMessage,
        },
      }));
      return;
    }
    if (!(await ensureGroupedActionCanProceed("appliquer la preselection fournisseurs"))) {
      return;
    }
    if ((document && scope && !document.isCurrent(scope)) || !isCurrentRoute(routeVersionId)) return;

    const versionSnapshot = getVersionSnapshot();
    if (!versionSnapshot || versionSnapshot.id !== routeVersionId) {
      setScopedDialogState((previous) => ({
        routeVersionId,
        dialog: {
          ...(previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE),
          error: "Version introuvable.",
        },
      }));
      return;
    }
    const targetVersionId = versionSnapshot.id;
    const selectedByItemId = new Map(
      selectedProposals.map((proposal) => [proposal.item_id, proposal])
    );
    if (selectedByItemId.size === 0) {
      setScopedDialogState((previous) => ({
        routeVersionId,
        dialog: {
          ...(previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE),
          error: "Sélectionnez au moins une preselection fournisseur.",
        },
      }));
      return;
    }
    const snapshot = getItemsSnapshot();
    const selectedLines = snapshot.filter(
      (item): item is EstimateItem =>
        item.item_type === "line" && selectedByItemId.has(item.id)
    );
    if (selectedLines.length === 0) {
      setScopedDialogState((previous) => ({
        routeVersionId,
        dialog: {
          ...(previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE),
          error: "Aucune ligne eligible sélectionnée.",
        },
      }));
      return;
    }
    const updatedLines = selectedLines.map((item) => {
      const proposal = selectedByItemId.get(item.id);
      return proposal
        ? (normalizeLine({ ...item, ...proposal.patch }) as EstimateItem)
        : item;
    });
    const updatedById = new Map(updatedLines.map((item) => [item.id, item]));
    const isV3 = resolveEditorEngineContext(versionSnapshot).isV3;
    // The lines and the version totals they imply are written by one RPC: the
    // stored totals feed the affaires list, approvals and documents. A v3
    // sends no client total: its writer recalculates and checks them (D12).
    const versionTotalsPatch = isV3
      ? undefined
      : computeVersionTotalsPatch(
          snapshot.map((item) => updatedById.get(item.id) ?? item)
        );
    if (!isV3 && !versionTotalsPatch) {
      setScopedDialogState((previous) => ({
        routeVersionId,
        dialog: {
          ...(previous.routeVersionId === routeVersionId
            ? previous.dialog
            : EMPTY_DIALOG_STATE),
          error: "Impossible de calculer les totaux du devis.",
        },
      }));
      return;
    }

    applyingRef.current = true;
    const generation = ++requestGenerationRef.current;
    setScopedDialogState((previous) => ({
      routeVersionId: targetVersionId,
      dialog: {
        ...(previous.routeVersionId === targetVersionId
          ? previous.dialog
          : EMPTY_DIALOG_STATE),
        error: null,
        isApplying: true,
      },
    }));
    const operation = beginItemsOperation((previous) =>
      previous.map((item) => updatedById.get(item.id) ?? item)
    );
    if (!isItemsOperationCurrent(operation)) return;
    const updates = updatedLines.map((item) => ({
      id: item.id,
      updates: isV3
        ? { unit_price_ht_cents: item.unit_price_ht_cents, selected_supplier_price_id: item.selected_supplier_price_id }
        : buildEstimateItemUpdatePayload(item),
    }));
    try {
      const result = isV3
        ? {
            versionToken: await writeEstimateV3SupplierPreselection(
              targetVersionId,
              versionSnapshot.updated_at,
              updates
            ),
            totals: undefined,
          }
        : await bulkUpdateEstimateItems(
            targetVersionId,
            versionSnapshot.updated_at,
            updates,
            versionTotalsPatch
          );
      if (
        !isCurrentRoute(targetVersionId) ||
        requestGenerationRef.current !== generation || !isItemsOperationCurrent(operation)
      ) {
        return;
      }
      if (!acceptItemsReceipt(operation, {
        version: result.versionToken,
        totals: result.totals ?? versionTotalsPatch,
        updates,
      })) return;
      setTotalsOutOfSync(false);
      setScopedDialogState((previous) =>
        previous.routeVersionId === targetVersionId
          ? {
              ...previous,
              dialog: {
                ...previous.dialog,
                isOpen: false,
                selectedItemIds: [],
                error: null,
              },
            }
          : previous
      );
    } catch (caught) {
      if (
        !isCurrentRoute(targetVersionId) ||
        requestGenerationRef.current !== generation || !isItemsOperationCurrent(operation)
      ) {
        return;
      }
      rollbackItems(operation);
      const isConflict = handleVersionConflict(caught, {
        persistDraft: true,
      });
      const nextError = isConflict
        ? null
        : resolveErrorMessage(
            caught instanceof Error
              ? caught.message
              : "Impossible d'appliquer la preselection fournisseurs."
          );
      setScopedDialogState((previous) =>
        previous.routeVersionId === targetVersionId
          ? {
              ...previous,
              dialog: {
                ...previous.dialog,
                isOpen: isConflict ? false : previous.dialog.isOpen,
                error: nextError,
              },
            }
          : previous
      );
    } finally {
      if (
        isCurrentRoute(targetVersionId) &&
        requestGenerationRef.current === generation
      ) {
        applyingRef.current = false;
        setScopedDialogState((previous) =>
          previous.routeVersionId === targetVersionId
            ? {
                ...previous,
                dialog: { ...previous.dialog, isApplying: false },
              }
            : previous
        );
      }
    }
  }, [
    isItemsDocumentCurrent,
    acceptItemsReceipt,
    document,
    beginItemsOperation,
    isItemsOperationCurrent,
    rollbackItems,
    computeVersionTotalsPatch,
    ensureGroupedActionCanProceed,
    getItemsSnapshot,
    getVersionSnapshot,
    handleVersionConflict,
    isCurrentRoute,
    isMutationBlocked,
    mutationBlockedMessage,
    normalizeLine,
    resolveErrorMessage,
    routeVersionId,
    selectedProposals,
    setTotalsOutOfSync,
  ]);

  const eligibleCount = useMemo(
    () => items.filter((item) => item.item_type === "line").length,
    [items]
  );
  const state = useMemo(
    () => ({
      isOpen,
      review,
      selectedItemIds: visibleSelectedItemIds,
      error,
      isLoading,
      isApplying,
    }),
    [error, isApplying, isLoading, isOpen, review, visibleSelectedItemIds]
  );
  const actions = useMemo(
    () => ({ open, close, toggleItem, toggleAll, apply }),
    [apply, close, open, toggleAll, toggleItem]
  );
  const meta = useMemo(() => ({ eligibleCount }), [eligibleCount]);

  return { state, actions, meta };
}
