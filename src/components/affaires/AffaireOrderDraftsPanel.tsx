"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PurchaseOrderDraftLinesTable } from "@/components/affaires/PurchaseOrderDraftLinesTable";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui-legacy/Toast";
import {
  createEstimatePurchaseOrderDrafts,
  fetchEstimatePurchaseOrderDraftPreparation,
  fetchEstimatePurchaseOrderDraftReceipt,
  isEstimateApiError,
  type CreateEstimatePurchaseOrderDraftsInput,
  type EstimatePurchaseOrderDraftBlockedLine,
  type EstimatePurchaseOrderDraftBlockedReason,
  type EstimatePurchaseOrderDraftCreationResult,
  type EstimatePurchaseOrderDraftPreparation,
  type EstimatePurchaseOrderStatus,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  buildPurchaseOrderReadiness,
  formatPurchaseOrderReadinessSummary,
  type PurchaseOrderReadiness,
} from "@/lib/estimates/purchase-order-readiness";

type AffaireOrderDraftsPanelProps = {
  projectId: string;
  currentVersion: {
    id: string;
    status: string;
    versionNumber: number;
  } | null;
  refreshSignal?: PurchaseOrderReadiness | null;
  onPreparationReadiness?: (
    versionId: string,
    readiness: PurchaseOrderReadiness,
  ) => void;
};

type DeliverySiteOption = {
  id: string;
  name: string;
  projectCode: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  contactName: string | null;
  contactPhone: string | null;
  updatedAt: string;
};

const MAX_BLOCKED_LINES = 6;
const INTENT_STORAGE_PREFIX = "estimate-purchase-intent:v1:";
const CHECKING_READINESS = {
  status: "checking",
  counts: null,
  errorMessage: "Vérification des lignes…",
} satisfies PurchaseOrderReadiness;
const UNAVAILABLE_READINESS = {
  status: "unavailable",
  counts: null,
  errorMessage: "Préparation indisponible. Rechargez pour vérifier les lignes.",
} satisfies PurchaseOrderReadiness;

function readStoredIntent(versionId: string) {
  const stored = window.localStorage.getItem(
    `${INTENT_STORAGE_PREFIX}${versionId}`,
  );
  if (!stored) return null;
  const parsed: unknown = JSON.parse(stored);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("versionId" in parsed) ||
    !("idempotencyKey" in parsed) ||
    parsed.versionId !== versionId ||
    typeof parsed.idempotencyKey !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      parsed.idempotencyKey,
    )
  ) {
    return null;
  }
  return parsed.idempotencyKey;
}

function storeIntent(versionId: string, idempotencyKey: string) {
  window.localStorage.setItem(
    `${INTENT_STORAGE_PREFIX}${versionId}`,
    JSON.stringify({ versionId, idempotencyKey }),
  );
  if (readStoredIntent(versionId) !== idempotencyKey)
    throw new Error("Intention non conservée.");
}

function clearStoredIntent(versionId: string) {
  try {
    window.localStorage.removeItem(`${INTENT_STORAGE_PREFIX}${versionId}`);
  } catch {
    // A remaining key can only trigger a read on the next visit, never a creation.
  }
}

function orderStatusLabel(status: EstimatePurchaseOrderStatus) {
  const labels: Record<EstimatePurchaseOrderStatus, string> = {
    draft: "Brouillon",
    sent: "Envoyée",
    confirmed: "Confirmée",
    received: "Reçue",
    canceled: "Annulée",
    deleted: "Supprimée",
  };
  return labels[status];
}

function buildEstimateVersionHref(
  currentVersion: AffaireOrderDraftsPanelProps["currentVersion"],
) {
  if (!currentVersion) {
    return null;
  }

  return currentVersion.status === "draft"
    ? `/dashboard/estimates/${currentVersion.id}/edit`
    : `/dashboard/estimates/${currentVersion.id}`;
}

function getReadyBadgeVariant(
  status: PurchaseOrderReadiness["status"],
) {
  switch (status) {
    case "ready":
    case "prepared":
      return "success";
    case "warning":
      return "warning";
    case "blocked":
      return "danger";
    case "waiting":
    case "checking":
    case "unavailable":
      return "neutral";
  }
}

function getReadyBadgeLabel(
  status: PurchaseOrderReadiness["status"],
) {
  switch (status) {
    case "ready":
      return "Prêt";
    case "prepared":
      return "Déjà préparé";
    case "warning":
      return "Partiellement prêt";
    case "blocked":
      return "À fiabiliser";
    case "waiting":
      return "En attente";
    case "checking":
      return "Vérification";
    case "unavailable":
      return "Indisponible";
  }
}

function formatReasonLabel(reason: EstimatePurchaseOrderDraftBlockedReason) {
  switch (reason) {
    case "selection_missing":
      return "Choix fournisseur à confirmer";
    case "stale":
      return "Prix à revalider";
    case "ambiguous":
      return "Arbitrage fournisseur nécessaire";
    case "no_price":
      return "Aucun prix fournisseur exploitable";
    case "missing_quantity":
      return "Quantité à compléter";
    case "invalid_quantity":
      return "Quantité invalide (trois décimales maximum)";
    case "amount_out_of_range":
      return "Montant hors limites";
    case "missing_unit_price":
      return "Prix de ligne incomplet";
    case "supplier_offer_ineligible":
      return "Conditions fournisseur à revalider";
  }
}

function formatReasonSummary(
  reason: EstimatePurchaseOrderDraftBlockedReason,
  count: number,
) {
  const label = formatReasonLabel(reason);
  return `${count} ${label.toLowerCase()}`;
}

function buildBlockedReasonCounts(
  blockedLines: EstimatePurchaseOrderDraftBlockedLine[],
) {
  const counts = new Map<EstimatePurchaseOrderDraftBlockedReason, number>();
  blockedLines.forEach((line) => {
    counts.set(line.reason, (counts.get(line.reason) ?? 0) + 1);
  });
  return Array.from(counts.entries());
}

function formatSiteLabel(site: DeliverySiteOption) {
  return site.projectCode ? `${site.projectCode} - ${site.name}` : site.name;
}

function normalizeNullableText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSafeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

async function fetchDeliverySites(): Promise<DeliverySiteOption[]> {
  const supabase = createSupabaseBrowserClient();
  const { data, error } = await supabase
    .from("delivery_sites")
    .select(
      "id, name, project_code, address, postal_code, city, contact_name, contact_phone, updated_at",
    )
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((site) => ({
    id: site.id,
    name: site.name,
    projectCode: site.project_code ?? null,
    address: site.address ?? null,
    postalCode: site.postal_code ?? null,
    city: site.city ?? null,
    contactName: site.contact_name ?? null,
    contactPhone: site.contact_phone ?? null,
    updatedAt: site.updated_at,
  }));
}

export function AffaireOrderDraftsPanel({
  projectId,
  currentVersion,
  refreshSignal,
  onPreparationReadiness,
}: Readonly<AffaireOrderDraftsPanelProps>) {
  const router = useRouter();
  const toast = useToast();
  const versionId = currentVersion?.id ?? null;
  const activeVersionRef = useRef(versionId);
  const viewEpochRef = useRef(0);
  const preparationRequestRef = useRef(0);
  const mutationBusyRef = useRef(false);
  const [preparation, setPreparation] =
    useState<EstimatePurchaseOrderDraftPreparation | null>(null);
  const [sites, setSites] = useState<DeliverySiteOption[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<string[]>([]);
  const [deliverySiteId, setDeliverySiteId] = useState("");
  const [expectedDeliveryDate, setExpectedDeliveryDate] = useState("");
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creationResult, setCreationResult] =
    useState<EstimatePurchaseOrderDraftCreationResult | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [isCheckingReceipt, setIsCheckingReceipt] = useState(false);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [pendingRequest, setPendingRequest] =
    useState<CreateEstimatePurchaseOrderDraftsInput | null>(null);
  const readiness = isLoading
    ? CHECKING_READINESS
    : loadError || requiresRefresh
      ? UNAVAILABLE_READINESS
      : preparation?.versionId === versionId
        ? buildPurchaseOrderReadiness({
            totalSupplierLines: preparation.summary.totalSupplierLines,
            draftableLines: preparation.summary.draftableLines,
            transferredLines: preparation.summary.transferredLines,
            blockedLines: preparation.summary.blockedLines,
          })
        : CHECKING_READINESS;
  const reportReadiness = useCallback(
    (nextReadiness: PurchaseOrderReadiness) => {
      if (versionId) onPreparationReadiness?.(versionId, nextReadiness);
    },
    [onPreparationReadiness, versionId],
  );

  const refreshPreparation = useCallback(async () => {
    if (!versionId) {
      setPreparation(null);
      setSites([]);
      setSelectedGroupKeys([]);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    reportReadiness(CHECKING_READINESS);
    setLoadError(null);
    setReviewConfirmed(false);
    const requestNumber = ++preparationRequestRef.current;
    const viewEpoch = viewEpochRef.current;

    try {
      const [preparationResult, siteOptions] = await Promise.all([
        fetchEstimatePurchaseOrderDraftPreparation(versionId),
        fetchDeliverySites(),
      ]);

      if (
        activeVersionRef.current !== versionId ||
        viewEpochRef.current !== viewEpoch ||
        requestNumber !== preparationRequestRef.current
      )
        return;
      const nextReadiness = buildPurchaseOrderReadiness({
        totalSupplierLines: preparationResult.summary.totalSupplierLines,
        draftableLines: preparationResult.summary.draftableLines,
        transferredLines: preparationResult.summary.transferredLines,
        blockedLines: preparationResult.summary.blockedLines,
      });
      if (
        nextReadiness.counts === null ||
        preparationResult.versionId !== versionId ||
        preparationResult.summary.draftableLines !==
          preparationResult.groups.reduce((count, group) => count + group.lines.length, 0) ||
        preparationResult.summary.blockedLines !== preparationResult.blockedLines.length ||
        preparationResult.summary.transferredLines !== preparationResult.transferredLines.length ||
        preparationResult.groups.some((group) => group.lineCount !== group.lines.length)
      ) {
        throw new Error(UNAVAILABLE_READINESS.errorMessage);
      }
      setPreparation(preparationResult);
      setSites(siteOptions);
      setSelectedGroupKeys(
        preparationResult.groups.map((group) => group.groupKey),
      );
      setCreateError(null);
      setRequiresRefresh(false);
      reportReadiness(nextReadiness);
    } catch (error) {
      if (
        activeVersionRef.current !== versionId ||
        viewEpochRef.current !== viewEpoch ||
        requestNumber !== preparationRequestRef.current
      )
        return;
      setPreparation(null);
      setSelectedGroupKeys([]);
      reportReadiness(UNAVAILABLE_READINESS);
      setLoadError(
        toSafeErrorMessage(
          error,
          "Impossible de préparer les brouillons de commandes.",
        ),
      );
    } finally {
      if (
        activeVersionRef.current === versionId &&
        viewEpochRef.current === viewEpoch &&
        requestNumber === preparationRequestRef.current
      ) {
        setIsLoading(false);
      }
    }
  }, [versionId, reportReadiness]);

  useEffect(() => {
    viewEpochRef.current += 1;
    activeVersionRef.current = versionId;
    mutationBusyRef.current = false;
    let canceled = false;
    setPreparation(null);
    setSites([]);
    setCreationResult(null);
    setCreateError(null);
    setDeliverySiteId("");
    setExpectedDeliveryDate("");
    setNotes("");
    setReviewConfirmed(false);
    setRequiresRefresh(false);
    setPendingRequest(null);
    setRecoveryKey(null);
    setRecoveryNotice(null);
    setIsCreating(false);
    setIsCheckingReceipt(Boolean(versionId));

    if (versionId) {
      void (async () => {
        try {
          const key = readStoredIntent(versionId);
          if (!key) return;
          setRecoveryKey(key);
          const receipt = await fetchEstimatePurchaseOrderDraftReceipt(
            versionId,
            key,
          );
          if (canceled) return;
          if (receipt) {
            setCreationResult({ ...receipt, replayed: true });
            await refreshPreparation();
          } else {
            clearStoredIntent(versionId);
            setRecoveryNotice(
              "Aucune préparation enregistrée pour cette tentative. Relisez les lignes avant de confirmer une nouvelle préparation.",
            );
          }
          if (canceled) return;
          setRecoveryKey(null);
        } catch (error) {
          if (!canceled)
            setRecoveryNotice(
              toSafeErrorMessage(
                error,
                "Impossible de vérifier la préparation précédente.",
              ),
            );
        } finally {
          if (!canceled) setIsCheckingReceipt(false);
        }
      })();
    }
    return () => {
      canceled = true;
      viewEpochRef.current += 1;
    };
  }, [versionId, refreshPreparation]);

  useEffect(() => {
    void refreshPreparation();
    // The original server object triggers a re-read; its counts never override this GET.
  }, [refreshPreparation, refreshSignal]);

  useEffect(() => {
    if (!deliverySiteId) {
      return;
    }

    const siteStillAvailable = sites.some((site) => site.id === deliverySiteId);
    if (!siteStillAvailable) {
      setDeliverySiteId("");
    }
  }, [deliverySiteId, sites]);

  const selectedGroups = useMemo(() => {
    if (!preparation || preparation.versionId !== versionId) {
      return [];
    }

    const selectedKeys = new Set(selectedGroupKeys);
    return preparation.groups.filter((group) =>
      selectedKeys.has(group.groupKey),
    );
  }, [preparation, selectedGroupKeys, versionId]);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === deliverySiteId) ?? null,
    [deliverySiteId, sites],
  );

  const blockedReasonCounts = useMemo(
    () => buildBlockedReasonCounts(preparation?.blockedLines ?? []),
    [preparation],
  );

  const blockedLinesPreview = (preparation?.blockedLines ?? []).slice(
    0,
    MAX_BLOCKED_LINES,
  );

  const versionHref = buildEstimateVersionHref(currentVersion);
  const formLocked = isCreating || isCheckingReceipt || recoveryKey !== null;
  const canCreateDrafts =
    selectedGroups.length > 0 &&
    selectedSite !== null &&
    reviewConfirmed &&
    !formLocked &&
    !isLoading &&
    !loadError &&
    readiness.counts !== null &&
    !requiresRefresh;
  const selectedTotals = selectedGroups.reduce(
    (totals, group) => ({
      ht: totals.ht + group.totalHtCents,
      tax: totals.tax + group.totalTaxCents,
      ttc: totals.ttc + group.totalTtcCents,
    }),
    { ht: 0, tax: 0, ttc: 0 },
  );

  const handleToggleGroup = useCallback((groupKey: string) => {
    setReviewConfirmed(false);
    setSelectedGroupKeys((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey],
    );
  }, []);

  const submitRequest = useCallback(
    async (input: CreateEstimatePurchaseOrderDraftsInput) => {
      if (!versionId) return;
      const viewEpoch = viewEpochRef.current;
      setIsCreating(true);
      setCreateError(null);
      try {
        const result = await createEstimatePurchaseOrderDrafts(
          versionId,
          input,
        );
        if (
          activeVersionRef.current !== versionId ||
          viewEpochRef.current !== viewEpoch
        )
          return;
        setCreationResult(result);
        setPendingRequest(null);
        setRecoveryKey(null);
        setRecoveryNotice(null);
        setReviewConfirmed(false);
        toast.success({
          title: result.replayed
            ? "Préparation déjà enregistrée"
            : "Brouillons créés",
          description:
            result.summary.draftOrdersCreated > 1
              ? `${result.summary.draftOrdersCreated} brouillons commandes sont prêts.`
              : "Le brouillon commande est prêt.",
        });
        router.refresh();
        await refreshPreparation();
      } catch (error) {
        if (
          activeVersionRef.current !== versionId ||
          viewEpochRef.current !== viewEpoch
        )
          return;
        preparationRequestRef.current += 1;
        setIsLoading(false);
        reportReadiness(UNAVAILABLE_READINESS);
        if (
          isEstimateApiError(error) &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 429
        ) {
          clearStoredIntent(versionId);
          setPendingRequest(null);
          setRecoveryKey(null);
          setRequiresRefresh(true);
          setReviewConfirmed(false);
          setCreateError(
            error.code === "ORDER_DRAFT_PREPARATION_STALE"
              ? "Les regroupements ont changé. Rechargez la préparation avant de créer les brouillons."
              : `${toSafeErrorMessage(error, "La préparation a été refusée.")} Rechargez puis relisez la préparation.`,
          );
        } else {
          setRequiresRefresh(true);
          setRecoveryKey(input.idempotencyKey);
          setRecoveryNotice(
            "Le résultat de la préparation reste à vérifier. Reprenez cette même demande avant d’en préparer une autre.",
          );
        }
      } finally {
        if (
          activeVersionRef.current === versionId &&
          viewEpochRef.current === viewEpoch
        )
          setIsCreating(false);
      }
    },
    [versionId, refreshPreparation, reportReadiness, router, toast],
  );

  const handleCreateDrafts = async () => {
    if (
      !versionId ||
      !canCreateDrafts ||
      !selectedSite ||
      mutationBusyRef.current
    )
      return;
    mutationBusyRef.current = true;
    const viewEpoch = viewEpochRef.current;
    try {
      const idempotencyKey = crypto.randomUUID();
      try {
        storeIntent(versionId, idempotencyKey);
      } catch {
        setCreateError(
          "La reprise ne peut pas être conservée dans ce navigateur. Autorisez le stockage local, puis réessayez. Aucun brouillon n’a été demandé.",
        );
        return;
      }
      const input: CreateEstimatePurchaseOrderDraftsInput = {
        idempotencyKey,
        reviewedLines: selectedGroups.flatMap((group) =>
          group.lines.map((line) => ({
            itemId: line.itemId,
            reviewFingerprint: line.reviewFingerprint,
          })),
        ),
        groups: selectedGroups.map((group) => ({
          supplierId: group.supplierId,
          deliverySiteId,
          deliverySiteUpdatedAt: selectedSite.updatedAt,
          itemIds: group.lines.map((line) => line.itemId),
          expectedDeliveryDate: normalizeNullableText(expectedDeliveryDate),
          notes: normalizeNullableText(notes),
        })),
      };
      setPendingRequest(input);
      await submitRequest(input);
    } finally {
      if (
        activeVersionRef.current === versionId &&
        viewEpochRef.current === viewEpoch
      )
        mutationBusyRef.current = false;
    }
  };

  const handleRecover = async () => {
    if (!versionId || !recoveryKey || mutationBusyRef.current) return;
    mutationBusyRef.current = true;
    const viewEpoch = viewEpochRef.current;
    setIsCheckingReceipt(true);
    try {
      const receipt = await fetchEstimatePurchaseOrderDraftReceipt(
        versionId,
        recoveryKey,
      );
      if (
        activeVersionRef.current !== versionId ||
        viewEpochRef.current !== viewEpoch
      )
        return;
      if (receipt) {
        setCreationResult({ ...receipt, replayed: true });
        setRecoveryKey(null);
        setPendingRequest(null);
        setRecoveryNotice(null);
        setReviewConfirmed(false);
        router.refresh();
        await refreshPreparation();
      } else if (pendingRequest) {
        await submitRequest(pendingRequest);
      } else {
        clearStoredIntent(versionId);
        setRecoveryKey(null);
        setReviewConfirmed(false);
        setRecoveryNotice(
          "Aucune préparation enregistrée pour cette tentative. Relisez les lignes avant de confirmer une nouvelle préparation.",
        );
        await refreshPreparation();
      }
    } catch (error) {
      if (
        activeVersionRef.current === versionId &&
        viewEpochRef.current === viewEpoch
      ) {
        setRecoveryNotice(
          toSafeErrorMessage(
            error,
            "Impossible de vérifier le résultat de la préparation.",
          ),
        );
      }
    } finally {
      if (
        activeVersionRef.current === versionId &&
        viewEpochRef.current === viewEpoch
      ) {
        mutationBusyRef.current = false;
        setIsCheckingReceipt(false);
      }
    }
  };

  if (!currentVersion) {
    return null;
  }

  return (
    <div
      id="finish-line-orders"
      className="mt-4 rounded-2xl border border-border bg-surface p-4 scroll-mt-24"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Préparation des achats
          </p>
          <h3 className="mt-2 text-sm font-semibold text-foreground">
            Brouillons par fournisseur, sans ressaisie
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Relisez les lignes et les montants issus des choix fournisseur
            retenus, puis confirmez la préparation des brouillons.
          </p>
        </div>
        <Badge
          variant={getReadyBadgeVariant(readiness.status)}
          dot
          className="self-start"
        >
          {getReadyBadgeLabel(readiness.status)}
        </Badge>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
        <p>{formatPurchaseOrderReadinessSummary(readiness)}</p>
        {readiness.status === "prepared" ? (
          <p className="mt-2">
            Toutes les lignes fournisseur ont déjà été transférées. Consultez les commandes existantes.
          </p>
        ) : null}
      </div>

      {isCheckingReceipt || recoveryKey || recoveryNotice ? (
        <div
          className="mt-4 rounded-xl border border-warning-border bg-warning-subtle/70 px-4 py-4"
          role="status"
        >
          <p className="text-sm font-medium text-foreground">
            {isCheckingReceipt
              ? "Vérification de la préparation précédente…"
              : recoveryNotice}
          </p>
          {recoveryKey ? (
            <button
              type="button"
              className={cn(
                buttonVariants({ variant: "outline", size: "md" }),
                "mt-3",
              )}
              onClick={() => void handleRecover()}
              disabled={isCreating || isCheckingReceipt}
            >
              Vérifier et reprendre la préparation
            </button>
          ) : null}
        </div>
      ) : null}

      {createError ? (
        <p className="mt-4 text-sm font-medium text-danger" role="alert">
          {createError}
        </p>
      ) : null}

      {creationResult &&
      creationResult.sourceVersionId === versionId &&
      creationResult.orders.length > 0 ? (
        <article className="mt-4 rounded-xl border border-success-border bg-success-subtle/70 p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-foreground">
                {creationResult.replayed
                  ? "Préparation déjà enregistrée"
                  : "Brouillons créés"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {creationResult.summary.draftOrdersCreated} brouillon
                {creationResult.summary.draftOrdersCreated > 1 ? "s" : ""} créé
                {creationResult.summary.draftOrdersCreated > 1
                  ? "s"
                  : ""} pour {creationResult.summary.draftLinesCreated} ligne
                {creationResult.summary.draftLinesCreated > 1 ? "s" : ""}. Les
                montants ci-dessous sont ceux enregistrés lors de cette
                préparation.
              </p>
            </div>
            <button
              type="button"
              className={cn(buttonVariants({ variant: "outline", size: "md" }))}
              onClick={() => void refreshPreparation()}
              disabled={isLoading || formLocked}
            >
              Relire la préparation
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {creationResult.orders.map((order) => (
              <div
                key={order.purchaseOrderId}
                className="rounded-xl border border-success-border bg-surface px-4 py-3"
              >
                <p className="text-sm font-semibold text-foreground">
                  {order.supplierName}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {order.reference} · {orderStatusLabel(order.currentStatus)} ·{" "}
                  {order.itemCount} ligne
                  {order.itemCount > 1 ? "s" : ""}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  HT {formatEUR(order.totalHtCents)} · TVA{" "}
                  {formatEUR(order.totalTaxCents)} · TTC{" "}
                  {formatEUR(order.totalTtcCents)}
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {order.canOpen && order.currentStatus !== "deleted" ? (
                    <Link
                      href={`/dashboard/orders/${order.purchaseOrderId}`}
                      className={cn(
                        buttonVariants({ variant: "outline", size: "md" }),
                      )}
                    >
                      {order.currentStatus === "draft"
                        ? "Ouvrir le brouillon"
                        : "Ouvrir la commande"}
                    </Link>
                  ) : null}
                  {order.canOpen && order.currentStatus === "draft" ? (
                    <Link
                      href={`/dashboard/orders/${order.purchaseOrderId}/edit`}
                      className={buttonVariants({
                        variant: "ghost",
                        size: "md",
                      })}
                    >
                      Ajuster si besoin
                    </Link>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </article>
      ) : null}

      {readiness.status === "unavailable" ? (
        <div className="mt-4 rounded-xl border border-danger-border bg-danger-subtle px-4 py-4">
          {loadError && loadError !== readiness.errorMessage ? (
            <p className="text-sm font-medium text-danger">{loadError}</p>
          ) : null}
          <button
            type="button"
            className={cn(
              buttonVariants({ variant: "outline", size: "md" }),
              "mt-3",
            )}
            onClick={() => void refreshPreparation()}
            disabled={isLoading || formLocked}
          >
            Recharger la préparation
          </button>
        </div>
      ) : readiness.status === "checking" ? (
        <div className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-4">
          <p className="text-sm font-medium text-foreground-secondary">
            Préparation des brouillons fournisseurs…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            TIMAX relit les lignes préparables et isole les exceptions avant
            création.
          </p>
        </div>
      ) : preparation && preparation.versionId === versionId ? (
        <>
          {preparation.blockedLines.length > 0 ? (
            <article className="mt-4 rounded-xl border border-warning-border bg-warning-subtle/70 p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    À traiter avant la création
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preparation.summary.blockedLines} ligne
                    {preparation.summary.blockedLines > 1
                      ? "s restent"
                      : " reste"}{" "}
                    hors brouillon pour garder une création fiable.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {blockedReasonCounts.map(([reason, count]) => (
                    <Badge key={reason} variant="warning">
                      {formatReasonSummary(reason, count)}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {blockedLinesPreview.map((line) => (
                  <div
                    key={line.itemId}
                    className="rounded-xl border border-warning-border bg-surface px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {line.itemTitle}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {line.reasonDetail ?? formatReasonLabel(line.reason)}
                        </p>
                      </div>
                      <Badge variant="warning">
                        Quantité : {line.quantity ?? "-"}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              {preparation.blockedLines.length > MAX_BLOCKED_LINES ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {preparation.blockedLines.length - MAX_BLOCKED_LINES} autre
                  {preparation.blockedLines.length - MAX_BLOCKED_LINES > 1
                    ? "s"
                    : ""}{" "}
                  ligne
                  {preparation.blockedLines.length - MAX_BLOCKED_LINES > 1
                    ? "s restent"
                    : " reste"}{" "}
                  a traiter dans la même logique.
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={`/dashboard/affaires/${projectId}/prices`}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "md" }),
                  )}
                >
                  Revoir les fournisseurs
                </Link>
                {versionHref ? (
                  <Link
                    href={versionHref}
                    className={buttonVariants({ variant: "ghost", size: "md" })}
                  >
                    Reprendre le devis
                  </Link>
                ) : null}
              </div>
            </article>
          ) : (
            <article className="mt-4 rounded-xl border border-success-border bg-success-subtle/70 p-4">
              <p className="text-sm font-semibold text-foreground">
                Aucune ligne bloquante
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                La sélection fournisseur actuelle suffit pour préparer les
                brouillons de commandes.
              </p>
            </article>
          )}

          {preparation.transferredLines.length > 0 ? (
            <article className="mt-4 rounded-xl border border-border bg-surface-subtle p-4">
              <h4 className="text-sm font-semibold text-foreground">
                Lignes déjà transférées
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Ces lignes restent rattachées à leur préparation. Une annulation
                ou une suppression ne permet pas de les commander à nouveau ici.
              </p>
              <ul className="mt-3 grid gap-3">
                {preparation.transferredLines.map((line) => (
                  <li
                    key={`${line.purchaseOrderId}:${line.itemId}`}
                    className="rounded-lg border border-border bg-surface px-3 py-3"
                  >
                    <p className="font-medium text-foreground">
                      {line.itemTitle}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Quantité transférée : {line.quantity} · {line.reference} ·{" "}
                      {orderStatusLabel(line.status)}
                    </p>
                    {line.status === "canceled" ? (
                      <p className="mt-1 text-sm text-muted-foreground">
                        Commande annulée, hors engagements actifs.
                      </p>
                    ) : null}
                    {line.canOpen && line.status !== "deleted" ? (
                      <Link
                        href={`/dashboard/orders/${line.purchaseOrderId}`}
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "md" }),
                          "mt-2",
                        )}
                      >
                        Consulter la commande {line.reference}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </article>
          ) : null}

          {preparation.groups.length > 0 ? (
            <article className="mt-4 rounded-xl border border-border bg-surface-subtle/70 p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Brouillons proposés
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preparation.summary.supplierGroups} regroupement
                    {preparation.summary.supplierGroups > 1 ? "s" : ""}{" "}
                    fournisseur
                    {preparation.summary.supplierGroups > 1 ? "s" : ""} sont
                    prêts à être confirmés.
                  </p>
                </div>
                <Badge variant="info">
                  {selectedGroups.length} sélectionné
                  {selectedGroups.length > 1 ? "s" : ""}
                </Badge>
              </div>

              <fieldset disabled={formLocked}>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                    <span className="font-medium">Chantier de livraison</span>
                    <select
                      className="rounded-xl border border-border-strong bg-surface px-3 py-2"
                      value={deliverySiteId}
                      onChange={(event) => {
                        setDeliverySiteId(event.target.value);
                        setReviewConfirmed(false);
                      }}
                    >
                      <option value="">
                        Choisir le chantier repris sur les brouillons
                      </option>
                      {sites.map((site) => (
                        <option key={site.id} value={site.id}>
                          {formatSiteLabel(site)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-col gap-2 text-sm text-foreground-secondary">
                    <span className="font-medium">Livraison cible</span>
                    <div className="rounded-xl border border-border-strong bg-surface px-3 py-3">
                      <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={expectedDeliveryDate === "TBD"}
                          onChange={(event) => {
                            setExpectedDeliveryDate(
                              event.target.checked ? "TBD" : "",
                            );
                            setReviewConfirmed(false);
                          }}
                        />
                        <span>À déterminer</span>
                      </label>
                      {expectedDeliveryDate !== "TBD" ? (
                        <input
                          type="date"
                          aria-label="Livraison cible"
                          className="mt-3 w-full rounded-xl border border-border-strong bg-surface px-3 py-2"
                          value={expectedDeliveryDate}
                          onChange={(event) => {
                            setExpectedDeliveryDate(event.target.value);
                            setReviewConfirmed(false);
                          }}
                        />
                      ) : null}
                    </div>
                  </div>
                </div>

                {selectedSite ? (
                  <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                    <p className="font-medium text-foreground">
                      {formatSiteLabel(selectedSite)}
                    </p>
                    {selectedSite.address ? (
                      <p>{selectedSite.address}</p>
                    ) : null}
                    {selectedSite.postalCode || selectedSite.city ? (
                      <p>
                        {[selectedSite.postalCode, selectedSite.city]
                          .filter((value): value is string => Boolean(value))
                          .join(" ")}
                      </p>
                    ) : null}
                    {selectedSite.contactName ? (
                      <p>
                        Contact: {selectedSite.contactName}
                        {selectedSite.contactPhone
                          ? ` · ${selectedSite.contactPhone}`
                          : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <label className="mt-3 flex flex-col gap-2 text-sm text-foreground-secondary">
                  <span className="font-medium">
                    Note reprise sur chaque brouillon (optionnel)
                  </span>
                  <textarea
                    className="min-h-24 rounded-xl border border-border-strong bg-surface px-3 py-2"
                    value={notes}
                    onChange={(event) => {
                      setNotes(event.target.value);
                      setReviewConfirmed(false);
                    }}
                    placeholder="Exemple: livraison à planifier avec le chef de chantier."
                  />
                </label>

                <div className="mt-4 grid gap-3">
                  {preparation.groups.map((group) => {
                    const isSelected = selectedGroupKeys.includes(
                      group.groupKey,
                    );
                    return (
                      <article
                        key={group.groupKey}
                        className={`rounded-xl border px-4 py-4 ${
                          isSelected
                            ? "border-primary bg-surface"
                            : "border-border bg-surface/70"
                        }`}
                      >
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="flex items-start gap-3">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4"
                              checked={isSelected}
                              aria-label={`Inclure ${group.supplierName}`}
                              onChange={() => handleToggleGroup(group.groupKey)}
                            />
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                {group.supplierName}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {group.lineCount} ligne
                                {group.lineCount > 1 ? "s" : ""} · HT{" "}
                                {formatEUR(group.totalHtCents)} · TVA{" "}
                                {formatEUR(group.totalTaxCents)} · TTC{" "}
                                {formatEUR(group.totalTtcCents)}
                              </p>
                            </div>
                          </div>
                          <Badge variant={isSelected ? "info" : "neutral"}>
                            {isSelected ? "Inclus" : "Hors création"}
                          </Badge>
                        </div>

                        <PurchaseOrderDraftLinesTable supplierName={group.supplierName} lines={group.lines} />
                      </article>
                    );
                  })}
                </div>

                <div
                  className="mt-4 rounded-xl border border-border bg-surface px-4 py-3"
                  aria-label="Montants de la sélection"
                >
                  <p className="font-semibold text-foreground">
                    Total de la sélection
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    HT {formatEUR(selectedTotals.ht)} · TVA{" "}
                    {formatEUR(selectedTotals.tax)} · TTC{" "}
                    {formatEUR(selectedTotals.ttc)}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Les coûts négociés du devis sont conservés. Cette action
                    prépare uniquement des brouillons.
                  </p>
                </div>

                <label className="mt-4 flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={reviewConfirmed}
                    disabled={
                      requiresRefresh || isLoading || Boolean(loadError)
                    }
                    onChange={(event) =>
                      setReviewConfirmed(event.target.checked)
                    }
                  />
                  <span>
                    J’ai vérifié les lignes, les montants et la livraison.
                  </span>
                </label>

                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={buttonVariants({
                      variant: "primary",
                      size: "md",
                    })}
                    onClick={() => void handleCreateDrafts()}
                    disabled={!canCreateDrafts}
                  >
                    {isCreating
                      ? "Création des brouillons…"
                      : selectedGroups.length > 1
                        ? `Créer ${selectedGroups.length} brouillons`
                        : "Créer le brouillon"}
                  </button>
                  <button
                    type="button"
                    className={buttonVariants({ variant: "ghost", size: "md" })}
                    onClick={() => void refreshPreparation()}
                    disabled={isLoading || isCreating}
                  >
                    Relire les regroupements
                  </button>
                </div>
              </fieldset>
            </article>
          ) : (
            <article className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-4">
              <p className="text-sm font-semibold text-foreground">
                Aucun brouillon à créer pour l&apos;instant
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Les lignes déjà transférées et celles à corriger restent
                visibles dans cette préparation.
              </p>
            </article>
          )}
        </>
      ) : null}
    </div>
  );
}
