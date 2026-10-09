"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui-legacy/Toast";
import {
  createEstimatePurchaseOrderDrafts,
  fetchEstimatePurchaseOrderDraftPreparation,
  isEstimateApiError,
  type EstimatePurchaseOrderDraftBlockedLine,
  type EstimatePurchaseOrderDraftBlockedReason,
  type EstimatePurchaseOrderDraftCreationResult,
  type EstimatePurchaseOrderDraftPreparation,
} from "@/lib/estimates/client";
import { formatEUR } from "@/lib/money";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AffaireOrderDraftsPanelProps = {
  projectId: string;
  currentVersion: {
    id: string;
    status: string;
    versionNumber: number;
  } | null;
  readyToOrder:
    | {
        status: "ready" | "blocked" | "waiting" | "unavailable";
        orderableLinesCount: number;
        coveredLinesCount: number;
        ambiguousLinesCount: number;
        missingPriceLinesCount: number;
        staleLinesCount: number;
        errorMessage: string | null;
      }
    | undefined
    | null;
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
};

const MAX_BLOCKED_LINES = 6;
const MAX_GROUP_LINES = 5;

function buildEstimateVersionHref(
  currentVersion: AffaireOrderDraftsPanelProps["currentVersion"]
) {
  if (!currentVersion) {
    return null;
  }

  return currentVersion.status === "draft"
    ? `/dashboard/estimates/${currentVersion.id}/edit`
    : `/dashboard/estimates/${currentVersion.id}`;
}

function getReadyBadgeVariant(
  status: NonNullable<AffaireOrderDraftsPanelProps["readyToOrder"]>["status"]
) {
  switch (status) {
    case "ready":
      return "success";
    case "blocked":
      return "danger";
    case "waiting":
    case "unavailable":
      return "neutral";
  }
}

function getReadyBadgeLabel(
  status: NonNullable<AffaireOrderDraftsPanelProps["readyToOrder"]>["status"]
) {
  switch (status) {
    case "ready":
      return "Prêt";
    case "blocked":
      return "À fiabiliser";
    case "waiting":
      return "En attente";
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
    case "non_integer_quantity":
      return "Quantité à ajuster avant commande";
    case "missing_unit_price":
      return "Prix de ligne incomplet";
  }
}

function formatReasonSummary(reason: EstimatePurchaseOrderDraftBlockedReason, count: number) {
  const label = formatReasonLabel(reason);
  return `${count} ${label.toLowerCase()}`;
}

function buildBlockedReasonCounts(
  blockedLines: EstimatePurchaseOrderDraftBlockedLine[]
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
      "id, name, project_code, address, postal_code, city, contact_name, contact_phone"
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
  }));
}

export function AffaireOrderDraftsPanel({
  projectId,
  currentVersion,
  readyToOrder,
}: Readonly<AffaireOrderDraftsPanelProps>) {
  const router = useRouter();
  const toast = useToast();
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

  const refreshPreparation = useCallback(async () => {
    if (!currentVersion) {
      setPreparation(null);
      setSites([]);
      setSelectedGroupKeys([]);
      setLoadError(null);
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    try {
      const [preparationResult, siteOptions] = await Promise.all([
        fetchEstimatePurchaseOrderDraftPreparation(currentVersion.id),
        fetchDeliverySites(),
      ]);

      setPreparation(preparationResult);
      setSites(siteOptions);
      setSelectedGroupKeys(
        preparationResult.groups.map((group) => group.groupKey)
      );
      setCreateError(null);
    } catch (error) {
      setLoadError(
        toSafeErrorMessage(
          error,
          "Impossible de préparer les brouillons de commandes."
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [currentVersion]);

  useEffect(() => {
    setCreationResult(null);
    setCreateError(null);
    setDeliverySiteId("");
    setExpectedDeliveryDate("");
    setNotes("");
  }, [currentVersion?.id]);

  useEffect(() => {
    void refreshPreparation();
  }, [refreshPreparation]);

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
    if (!preparation) {
      return [];
    }

    const selectedKeys = new Set(selectedGroupKeys);
    return preparation.groups.filter((group) => selectedKeys.has(group.groupKey));
  }, [preparation, selectedGroupKeys]);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === deliverySiteId) ?? null,
    [deliverySiteId, sites]
  );

  const blockedReasonCounts = useMemo(
    () => buildBlockedReasonCounts(preparation?.blockedLines ?? []),
    [preparation]
  );

  const blockedLinesPreview = (preparation?.blockedLines ?? []).slice(
    0,
    MAX_BLOCKED_LINES
  );

  const versionHref = buildEstimateVersionHref(currentVersion);
  const canCreateDrafts =
    selectedGroups.length > 0 && selectedSite !== null && !isCreating;

  const handleToggleGroup = useCallback((groupKey: string) => {
    setSelectedGroupKeys((current) =>
      current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
    );
  }, []);

  const handleCreateDrafts = useCallback(async () => {
    if (!currentVersion || !canCreateDrafts) {
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const result = await createEstimatePurchaseOrderDrafts(currentVersion.id, {
        groups: selectedGroups.map((group) => ({
          supplierId: group.supplierId,
          deliverySiteId,
          itemIds: group.lines.map((line) => line.itemId),
          expectedDeliveryDate: normalizeNullableText(expectedDeliveryDate),
          notes: normalizeNullableText(notes),
        })),
      });

      setCreationResult(result);
      toast.success({
        title: "Brouillons créés",
        description:
          result.summary.draftOrdersCreated > 1
            ? `${result.summary.draftOrdersCreated} brouillons commandes sont prêts.`
            : "Le brouillon commande est prêt.",
      });
      router.refresh();
      await refreshPreparation();
    } catch (error) {
      if (
        isEstimateApiError(error) &&
        error.code === "ORDER_DRAFT_PREPARATION_STALE"
      ) {
        setCreateError(
          "Les regroupements ont changé. Rechargez la préparation avant de créer les brouillons."
        );
      } else {
        setCreateError(
          toSafeErrorMessage(
            error,
            "Impossible de créer les brouillons de commandes."
          )
        );
      }
    } finally {
      setIsCreating(false);
    }
  }, [
    canCreateDrafts,
    currentVersion,
    deliverySiteId,
    expectedDeliveryDate,
    notes,
    refreshPreparation,
    router,
    selectedGroups,
    toast,
  ]);

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
            Finish line commandes
          </p>
          <h3 className="mt-2 text-sm font-semibold text-foreground">
            Brouillons par fournisseur, sans ressaisie
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Les exceptions restent en tete, puis vous créez uniquement les
            brouillons utiles depuis les choix fournisseur déjà retenus.
          </p>
        </div>
        <Badge
          variant={getReadyBadgeVariant(readyToOrder?.status ?? "waiting")}
          dot
          className="self-start"
        >
          {getReadyBadgeLabel(readyToOrder?.status ?? "waiting")}
        </Badge>
      </div>

      <div className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-3 text-sm text-muted-foreground">
        {readyToOrder?.status === "ready"
          ? `${readyToOrder.coveredLinesCount} ligne${readyToOrder.coveredLinesCount > 1 ? "s" : ""} sont déjà commandables. Choisissez un chantier puis confirmez les brouillons.`
          : readyToOrder?.status === "blocked"
            ? "Certaines lignes restent à fiabiliser avant la création. Les blocages sont visibles juste en dessous."
            : readyToOrder?.status === "unavailable"
              ? readyToOrder.errorMessage ??
                "La préparation commandes est indisponible pour le moment."
              : "La finish line commandes devient actionnable des qu'une préparation fournisseur existe."}
      </div>

      {loadError && !preparation ? (
        <div className="mt-4 rounded-xl border border-danger-border bg-danger-subtle px-4 py-4">
          <p className="text-sm font-medium text-danger">{loadError}</p>
          <button
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-3")}
            onClick={() => void refreshPreparation()}
          >
            Recharger la préparation
          </button>
        </div>
      ) : isLoading && !preparation ? (
        <div className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-4">
          <p className="text-sm font-medium text-foreground-secondary">
            Préparation des brouillons fournisseurs…
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            TIMAX relit les lignes commandables et isole les exceptions avant création.
          </p>
        </div>
      ) : preparation ? (
        <>
          {loadError ? (
            <div className="mt-4 rounded-xl border border-warning-border bg-warning-subtle/70 px-4 py-4">
              <p className="text-sm font-medium text-warning">{loadError}</p>
              <button
                type="button"
                className={cn(buttonVariants({ variant: "outline", size: "md" }), "mt-3")}
                onClick={() => void refreshPreparation()}
              >
                Recharger la préparation
              </button>
            </div>
          ) : null}

          {preparation.blockedLines.length > 0 ? (
            <article className="mt-4 rounded-xl border border-warning-border bg-warning-subtle/70 p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    À traiter avant la création
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {preparation.summary.blockedLines} ligne
                    {preparation.summary.blockedLines > 1 ? "s restent" : " reste"} hors
                    brouillon pour garder une création fiable.
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
                          {formatReasonLabel(line.reason)}
                        </p>
                      </div>
                      <Badge variant="warning">
                        {line.quantity ?? "-"} u
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              {preparation.blockedLines.length > MAX_BLOCKED_LINES ? (
                <p className="mt-3 text-xs text-muted-foreground">
                  {preparation.blockedLines.length - MAX_BLOCKED_LINES} autre
                  {preparation.blockedLines.length - MAX_BLOCKED_LINES > 1 ? "s" : ""} ligne
                  {preparation.blockedLines.length - MAX_BLOCKED_LINES > 1 ? "s restent" : " reste"} a
                  traiter dans la même logique.
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <Link
                  href={`/dashboard/affaires/${projectId}/prices`}
                  className={cn(buttonVariants({ variant: "outline", size: "md" }))}
                >
                  Revoir les fournisseurs
                </Link>
                {versionHref ? (
                  <Link href={versionHref} className={buttonVariants({ variant: "ghost", size: "md" })}>
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
                La sélection fournisseur actuelle suffit pour préparer les brouillons de commandes.
              </p>
            </article>
          )}

          {creationResult && creationResult.orders.length > 0 ? (
            <article className="mt-4 rounded-xl border border-success-border bg-success-subtle/70 p-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Brouillons créés
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {creationResult.summary.draftOrdersCreated} brouillon
                    {creationResult.summary.draftOrdersCreated > 1 ? "s" : ""} créé
                    {creationResult.summary.draftOrdersCreated > 1 ? "s" : ""} pour{" "}
                    {creationResult.summary.draftLinesCreated} ligne
                    {creationResult.summary.draftLinesCreated > 1 ? "s" : ""}.
                  </p>
                </div>
                <button
                  type="button"
                  className={cn(buttonVariants({ variant: "outline", size: "md" }))}
                  onClick={() => void refreshPreparation()}
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
                      {order.reference} · {order.itemCount} ligne
                      {order.itemCount > 1 ? "s" : ""} · {formatEUR(order.totalHtCents)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Link
                        href={`/dashboard/orders/${order.purchaseOrderId}`}
                        className={cn(buttonVariants({ variant: "outline", size: "md" }))}
                      >
                        Ouvrir le brouillon
                      </Link>
                      <Link
                        href={`/dashboard/orders/${order.purchaseOrderId}/edit`}
                        className={buttonVariants({ variant: "ghost", size: "md" })}
                      >
                        Ajuster si besoin
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
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
                    {preparation.summary.supplierGroups > 1 ? "s" : ""} fournisseur
                    {preparation.summary.supplierGroups > 1 ? "s" : ""} sont prêts à être
                    confirmés.
                  </p>
                </div>
                <Badge variant="info">
                  {selectedGroups.length} sélectionné
                  {selectedGroups.length > 1 ? "s" : ""}
                </Badge>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                  <span className="font-medium">Chantier de livraison</span>
                  <select
                    className="rounded-xl border border-border-strong bg-surface px-3 py-2"
                    value={deliverySiteId}
                    onChange={(event) => setDeliverySiteId(event.target.value)}
                  >
                    <option value="">Choisir le chantier repris sur les brouillons</option>
                    {sites.map((site) => (
                      <option key={site.id} value={site.id}>
                        {formatSiteLabel(site)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm text-foreground-secondary">
                  <span className="font-medium">Livraison cible</span>
                  <div className="rounded-xl border border-border-strong bg-surface px-3 py-3">
                    <label className="flex items-center gap-2 text-sm text-foreground-secondary">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={expectedDeliveryDate === "TBD"}
                        onChange={(event) => {
                          setExpectedDeliveryDate(event.target.checked ? "TBD" : "");
                        }}
                      />
                      <span>À déterminer</span>
                    </label>
                    {expectedDeliveryDate !== "TBD" ? (
                      <input
                        type="date"
                        className="mt-3 w-full rounded-xl border border-border-strong bg-surface px-3 py-2"
                        value={expectedDeliveryDate}
                        onChange={(event) => setExpectedDeliveryDate(event.target.value)}
                      />
                    ) : null}
                  </div>
                </label>
              </div>

              {selectedSite ? (
                <div className="mt-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {formatSiteLabel(selectedSite)}
                  </p>
                  {selectedSite.address ? <p>{selectedSite.address}</p> : null}
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
                      {selectedSite.contactPhone ? ` · ${selectedSite.contactPhone}` : ""}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <label className="mt-3 flex flex-col gap-2 text-sm text-foreground-secondary">
                <span className="font-medium">Note reprise sur chaque brouillon (optionnel)</span>
                <textarea
                  className="min-h-24 rounded-xl border border-border-strong bg-surface px-3 py-2"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Exemple: livraison à planifier avec le chef de chantier."
                />
              </label>

              <div className="mt-4 grid gap-3">
                {preparation.groups.map((group) => {
                  const isSelected = selectedGroupKeys.includes(group.groupKey);
                  return (
                    <label
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
                            onChange={() => handleToggleGroup(group.groupKey)}
                          />
                          <div>
                            <p className="text-sm font-semibold text-foreground">
                              {group.supplierName}
                            </p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {group.lineCount} ligne{group.lineCount > 1 ? "s" : ""} ·{" "}
                              {formatEUR(group.totalHtCents)}
                            </p>
                          </div>
                        </div>
                        <Badge variant={isSelected ? "info" : "neutral"}>
                          {isSelected ? "Inclus" : "Hors création"}
                        </Badge>
                      </div>

                      <div className="mt-3 grid gap-2 text-sm text-muted-foreground lg:grid-cols-2">
                        {group.lines.slice(0, MAX_GROUP_LINES).map((line) => (
                          <div
                            key={line.itemId}
                            className="rounded-lg border border-border bg-surface-subtle px-3 py-2"
                          >
                            <p className="font-medium text-foreground">
                              {line.itemTitle}
                            </p>
                            <p className="mt-1">
                              {line.quantity} u · {formatEUR(line.lineTotalHtCents)}
                              {line.supplierReference
                                ? ` · Ref ${line.supplierReference}`
                                : ""}
                            </p>
                          </div>
                        ))}
                      </div>

                      {group.lines.length > MAX_GROUP_LINES ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {group.lines.length - MAX_GROUP_LINES} autre
                          {group.lines.length - MAX_GROUP_LINES > 1 ? "s" : ""} ligne
                          {group.lines.length - MAX_GROUP_LINES > 1 ? "s sont" : " est"} incluse
                          {group.lines.length - MAX_GROUP_LINES > 1 ? "s" : ""} dans ce brouillon.
                        </p>
                      ) : null}
                    </label>
                  );
                })}
              </div>

              {createError ? (
                <p className="mt-4 text-sm font-medium text-danger" role="alert">
                  {createError}
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  className={buttonVariants({ variant: "primary", size: "md" })}
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
            </article>
          ) : (
            <article className="mt-4 rounded-xl border border-border bg-surface-subtle px-4 py-4">
              <p className="text-sm font-semibold text-foreground">
                Aucun brouillon à créer pour l&apos;instant
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Tant qu&apos;aucun regroupement fournisseur stable n&apos;est propose, la
                finish line commandes reste pilotee par correction.
              </p>
            </article>
          )}
        </>
      ) : null}
    </div>
  );
}
