"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { AffaireConfirmDialog } from "./AffaireConfirmDialog";
import { AffaireApprovalBadge, AffaireStatusBadges } from "./AffaireStatusBadges";
import { AffaireRowActions, getAffaireListItemState } from "./AffaireRowActions";
import { useDeleteAffaire } from "./useDeleteAffaire";
import {
  fetchAffaireDenseExpandData,
  type AffaireDenseExpandData,
} from "@/app/dashboard/affaires/_actions/dense-table-expand";
import type {
  AffaireListItem,
  AffaireManagerQueueFilter,
  AffaireManagerQueueSummary,
} from "./types";
import { ChevronRightIcon, EyeIcon, FolderIcon, HouseIcon, PlusIcon, PrinterIcon, SearchIcon, SquarePenIcon } from "lucide-react";

const AFFAIRE_DATE_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const TABLE_COLUMN_COUNT = 11;
const INTERACTIVE_ROW_TARGET = "a, button, input, label, select, textarea, [role='menuitem']";

type AffairesEmptyVariant = "no-data" | "filtered";
type BadgeVariant = NonNullable<BadgeProps["variant"]>;

type Props = {
  items: AffaireListItem[];
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
  onToggleFavorite: (projectId: string, nextIsFavorite: boolean) => void;
  favoritePendingIds: string[];
  managerFilter: AffaireManagerQueueFilter;
  onManagerFilterChange: (nextFilter: AffaireManagerQueueFilter) => void;
  managerQueueSummary: AffaireManagerQueueSummary | null;
  managerQueueSummaryState:
    | "idle"
    | "loading"
    | "ready"
    | "error"
    | "unavailable";
  selectedProjectIds?: ReadonlySet<string>;
  onToggleProjectSelection?: (projectId: string) => void;
};

const EMPTY_SELECTED_PROJECT_IDS: ReadonlySet<string> = new Set();

function formatDate(iso: string): string {
  return AFFAIRE_DATE_FORMATTER.format(new Date(iso));
}

function formatManagerQueueCount(count: number, label: string): string {
  return `${count} affaire${count > 1 ? "s" : ""} ${label}`;
}

const MANAGER_CHIP_BASE =
  "inline-flex min-h-11 items-center rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-0";

const MANAGER_CHIP_TONE: Record<
  AffaireManagerQueueFilter,
  { active: string; idle: string }
> = {
  all: {
    active: "border-foreground bg-foreground text-surface",
    idle: "border-border bg-surface text-foreground-secondary hover:border-border-strong",
  },
  follow_up: {
    active: "border-danger bg-danger text-danger-foreground",
    idle: "border-danger-border bg-danger-subtle text-danger hover:bg-danger-light",
  },
  reservations: {
    active: "border-warning bg-warning text-warning-foreground",
    idle: "border-warning-border bg-warning-subtle text-warning hover:bg-warning-light",
  },
  revalidation: {
    active: "border-primary bg-primary text-primary-foreground",
    idle: "border-info-border bg-info-subtle text-primary hover:bg-info-light",
  },
};

function AffairesEmptyState({
  emptyVariant,
  onCreateAffaire,
}: {
  emptyVariant: AffairesEmptyVariant;
  onCreateAffaire?: () => void;
}) {
  return emptyVariant === "no-data" ? (
    <EmptyTableRow
      colSpan={TABLE_COLUMN_COUNT}
      icon={<FolderIcon aria-hidden="true" />}
      title="Créez votre première affaire"
      description="Démarrez un nouveau projet pour lancer votre premier chiffrage."
      action={
        onCreateAffaire ? (
          <Button size="lg" leftIcon={<PlusIcon aria-hidden="true" />} onClick={onCreateAffaire}>
            Nouvelle affaire
          </Button>
        ) : undefined
      }
    />
  ) : (
    <EmptyTableRow
      colSpan={TABLE_COLUMN_COUNT}
      icon={<SearchIcon aria-hidden="true" />}
      title="Aucune affaire trouvée"
      description="Modifiez vos filtres ou votre recherche pour afficher des résultats."
    />
  );
}

function versionStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Brouillon";
    case "sent":
      return "Envoyé";
    case "accepted":
      return "Accepté";
    case "archived":
      return "Archivé";
    default:
      return status;
  }
}

function importStatusBadge(status: string): { label: string; variant: BadgeVariant } {
  switch (status) {
    case "done":
      return { label: "Importé", variant: "success" };
    case "running":
      return { label: "En cours", variant: "info" };
    case "failed":
      return { label: "Échec", variant: "danger" };
    default:
      return { label: status, variant: "neutral" };
  }
}

function mappingStatusBadge(status: string | null): { label: string; variant: BadgeVariant } | null {
  if (!status) return null;
  switch (status) {
    case "mapped":
      return { label: "Mappé", variant: "success" };
    case "partial":
      return { label: "Partiel", variant: "warning" };
    case "unmapped":
      return { label: "Non mappé", variant: "neutral" };
    default:
      return { label: status, variant: "neutral" };
  }
}

export function AffairesDenseTable({
  items,
  emptyVariant,
  onCreateAffaire,
  onToggleFavorite,
  favoritePendingIds,
  managerFilter,
  onManagerFilterChange,
  managerQueueSummary,
  managerQueueSummaryState,
  selectedProjectIds = EMPTY_SELECTED_PROJECT_IDS,
  onToggleProjectSelection,
}: Readonly<Props>) {
  const router = useRouter();
  const { requestDelete, modalProps } = useDeleteAffaire();
  const favoritePendingIdSet = useMemo(
    () => new Set(favoritePendingIds),
    [favoritePendingIds]
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandCache, setExpandCache] = useState<
    Record<string, AffaireDenseExpandData | "loading" | "error">
  >({});
  const expandCacheRef = useRef(expandCache);

  useEffect(() => {
    expandCacheRef.current = expandCache;
  }, [expandCache]);

  const ensureExpandData = useCallback((projectId: string) => {
    const cached = expandCacheRef.current[projectId];
    if (cached && cached !== "error") {
      return;
    }

    setExpandCache((current) => {
      if (current[projectId] && current[projectId] !== "error") {
        return current;
      }

      return { ...current, [projectId]: "loading" };
    });

    fetchAffaireDenseExpandData(projectId)
      .then((data) =>
        setExpandCache((current) => ({ ...current, [projectId]: data }))
      )
      .catch(() =>
        setExpandCache((current) => ({ ...current, [projectId]: "error" }))
      );
  }, []);

  // Only consider expanded IDs that are in the current items (auto-reset on pagination/filter)
  const currentItemIds = useMemo(() => new Set(items.map((i) => i.projectId)), [items]);
  const isExpanded = useCallback(
    (id: string) => expandedIds.has(id) && currentItemIds.has(id),
    [expandedIds, currentItemIds]
  );

  const handleToggleExpand = useCallback(
    (projectId: string) => {
      const shouldLoadExpandData = !expandedIds.has(projectId);

      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(projectId)) {
          next.delete(projectId);
        } else {
          next.add(projectId);
        }
        return next;
      });

      if (shouldLoadExpandData) {
        ensureExpandData(projectId);
      }
    },
    [ensureExpandData, expandedIds]
  );

  // Mouse shortcut only: the project name link is the keyboard and screen-reader path.
  const handleRowClick = useCallback(
    (event: MouseEvent<HTMLTableRowElement>, href: string) => {
      if (event.defaultPrevented || event.button !== 0) return;
      // React bubbles clicks from portalled popups (row actions menu, tooltips) to the row:
      // only clicks that start inside the row's own DOM navigate.
      if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
      const target = event.target as HTMLElement;
      if (target.closest(INTERACTIVE_ROW_TARGET)) return;
      if (window.getSelection?.()?.toString()) return;
      router.push(href);
    },
    [router]
  );

  const managerCounts = managerQueueSummary?.counts ?? {
    followUp: 0,
    reservations: 0,
    revalidation: 0,
  };
  const managerQualificationIncomplete = (managerQueueSummary?.incompleteCount ?? 0) > 0;
  const managerFilterDisabled =
    managerQueueSummaryState !== "ready" || managerQualificationIncomplete;
  const managerChips: Array<{ filter: AffaireManagerQueueFilter; label: string }> = [
    { filter: "all", label: "Toutes" },
    { filter: "follow_up", label: `À relancer en priorité (${managerCounts.followUp})` },
    { filter: "reservations", label: `À revoir sous réserves (${managerCounts.reservations})` },
    { filter: "revalidation", label: `À rouvrir en revalidation (${managerCounts.revalidation})` },
  ];

  return (
    <Card className="overflow-hidden">
      <AffaireConfirmDialog {...modalProps} />
      <div className="border-b border-border bg-surface-subtle/70 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              Relances manager
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Repère les affaires visibles à relancer en priorité, à revoir sous réserves ou à rouvrir en revalidation.
            </p>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par relance manager">
            {managerChips.map(({ filter, label }) => {
              const isActive = managerFilter === filter;
              const tone = MANAGER_CHIP_TONE[filter];
              return (
                <button
                  key={filter}
                  type="button"
                  className={cn(MANAGER_CHIP_BASE, isActive ? tone.active : tone.idle)}
                  aria-pressed={isActive}
                  disabled={filter !== "all" && managerFilterDisabled}
                  onClick={() => onManagerFilterChange(filter)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {managerQueueSummaryState === "loading" || managerQueueSummaryState === "idle"
            ? "Qualification manager en cours sur le portefeuille."
            : managerQueueSummaryState === "unavailable"
              ? "Qualification indisponible pour ce volume, affinez les filtres."
            : managerQueueSummaryState === "error"
              ? "Qualification manager indisponible pour ce portefeuille. Affinez les filtres ou rechargez la page pour réessayer."
              : managerQualificationIncomplete
                ? `Qualification manager incomplète sur ${managerQueueSummary?.incompleteCount ?? 0} affaire${(managerQueueSummary?.incompleteCount ?? 0) > 1 ? "s" : ""} du portefeuille.`
            : managerFilter === "all"
              ? `${formatManagerQueueCount(managerCounts.followUp, "à relancer en priorité")}, ${formatManagerQueueCount(managerCounts.reservations, "à revoir sous réserves")} et ${formatManagerQueueCount(managerCounts.revalidation, "à rouvrir en revalidation")} dans le portefeuille.`
            : managerFilter === "reservations"
              ? `${formatManagerQueueCount(managerCounts.reservations, "à revoir sous réserves")} dans le portefeuille.`
              : managerFilter === "revalidation"
                ? `${formatManagerQueueCount(managerCounts.revalidation, "à rouvrir en revalidation")} dans le portefeuille.`
                : `${formatManagerQueueCount(managerCounts.followUp, "à relancer en priorité")} dans le portefeuille.`}
        </p>
      </div>
      <div
        className="relative overflow-x-auto"
        role="region"
        aria-label="Liste des affaires"
        tabIndex={0}
      >
        <table className="w-full text-sm">
          <caption className="sr-only">
            Liste des affaires et de leur dernière version de chiffrage
          </caption>
          <thead>
            <tr className="border-b border-border bg-surface-subtle">
              <th scope="col" className="w-10">
                <span className="sr-only">Détails</span>
              </th>
              <th scope="col" className="w-10">
                <span className="sr-only">Sélection</span>
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Nom affaire
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Client
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Réf.
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Statut courant
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Version acceptée
              </th>
              <th scope="col" className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Approbation
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Total HT
              </th>
              <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Date MAJ
              </th>
              <th scope="col" className="w-28">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <AffairesEmptyState
                emptyVariant={emptyVariant}
                onCreateAffaire={onCreateAffaire}
              />
            ) : (
              items.map((item) => {
                const { hasCurrentVersion, isDraftOnly } = getAffaireListItemState(item);
                const primaryHref = `/dashboard/affaires/${item.projectId}`;
                const expanded = isExpanded(item.projectId);
                const cached = expandCache[item.projectId];
                const detailsId = `affaire-${item.projectId}-details`;

                return (
                  <Fragment key={item.projectId}>
                  <tr
                    className="cursor-pointer border-b border-border-subtle transition-colors hover:bg-surface-subtle [content-visibility:auto] [contain-intrinsic-size:auto_52px]"
                    onClick={(event) => handleRowClick(event, primaryHref)}
                  >
                    <td>
                      <button
                        type="button"
                        className={`expand-button ${expanded ? "expanded" : ""}`}
                        onClick={() => handleToggleExpand(item.projectId)}
                        aria-controls={detailsId}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? "Replier" : "Déplier"} les détails de l’affaire ${item.projectName}`}
                      >
                        <ChevronRightIcon aria-hidden="true" size={16} />
                      </button>
                    </td>
                    <td
                      className="px-2 py-3 text-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {isDraftOnly && onToggleProjectSelection ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border-strong text-primary"
                          checked={selectedProjectIds.has(item.projectId)}
                          aria-label={`Sélectionner l'affaire ${item.projectName}`}
                          onChange={() =>
                            onToggleProjectSelection(item.projectId)
                          }
                        />
                      ) : null}
                    </td>
                    <td className="max-w-[200px] px-4 py-3">
                      <Link
                        href={primaryHref}
                        prefetch={false}
                        className="block truncate rounded-sm font-medium text-foreground hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        {item.projectName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-foreground-secondary max-w-[160px] truncate">
                      {item.projectClient ?? "-"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[120px] truncate">
                      {item.projectReference ?? "-"}
                    </td>
                    <td className="px-4 py-3">
                      {hasCurrentVersion ? (
                        <AffaireStatusBadges
                          currentVersionNumber={item.currentVersionNumber!}
                          currentStatus={item.currentStatus!}
                          acceptedVersionNumber={null}
                        />
                      ) : (
                        <span className="text-xs font-medium text-muted-foreground">
                          Aucun chiffrage
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.acceptedVersionNumber !== null ? (
                        <AffaireStatusBadges
                          currentVersionNumber={item.acceptedVersionNumber}
                          currentStatus="accepted"
                          acceptedVersionNumber={null}
                        />
                      ) : (
                        <span className="text-xs text-subtle-foreground">
                          -
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <AffaireApprovalBadge approvalStatus={item.currentApprovalStatus} />
                      {!item.currentApprovalStatus ? (
                        <span className="text-xs text-subtle-foreground">-</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-foreground-secondary whitespace-nowrap">
                      {item.currentTotalHtCents !== null
                        ? formatEUR(item.currentTotalHtCents)
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {formatDate(item.currentUpdatedAt)}
                    </td>
                    <td className="px-2 py-3 text-center">
                      <AffaireRowActions
                        item={item}
                        isFavoritePending={favoritePendingIdSet.has(item.projectId)}
                        onToggleFavorite={() =>
                          onToggleFavorite(item.projectId, !item.isFavorite)
                        }
                        onRequestDelete={() =>
                          requestDelete(item.projectId, item.projectName)
                        }
                      />
                    </td>
                  </tr>

                  {expanded ? (
                    <tr id={detailsId} className="expanded-content-row">
                      <td colSpan={TABLE_COLUMN_COUNT}>
                        <div
                          className="expanded-content animate-expand-down"
                          aria-busy={cached === "loading"}
                          aria-live="polite"
                        >
                          {cached === "loading" ? (
                            <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4">
                              <Spinner aria-hidden="true" className="text-primary" />
                              <span className="text-sm text-muted-foreground">Chargement…</span>
                            </div>
                          ) : cached === "error" ? (
                            <Alert variant="danger">
                              <AlertDescription className="text-danger">
                                Erreur lors du chargement. Repliez puis dépliez la ligne pour réessayer.
                              </AlertDescription>
                            </Alert>
                          ) : cached ? (
                            <ExpandedContent
                              data={cached}
                              projectId={item.projectId}
                              versionCount={item.versionCount}
                            />
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded content — 3 column grid                                   */
/* ------------------------------------------------------------------ */

const QUICK_LINK_CLASS =
  "flex min-h-9 items-center gap-2 rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function ExpandedContent({
  data,
  projectId,
  versionCount,
}: {
  data: AffaireDenseExpandData;
  projectId: string;
  versionCount: number;
}) {
  const { summary, dpgfSource } = data;
  const cv = summary.currentVersion;
  const av = summary.acceptedVersion;
  const importBadge = dpgfSource ? importStatusBadge(dpgfSource.importStatus) : null;
  const mappingBadge = dpgfSource ? mappingStatusBadge(dpgfSource.mappingStatus) : null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {/* Column 1 — Résumé financier */}
      <div className="space-y-1.5 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Résumé financier
        </h3>
        <p>
          <span className="text-muted-foreground">Nombre de versions : </span>
          <span>{versionCount}</span>
        </p>
        {cv ? (
          <>
            <p>
              <span className="text-muted-foreground">Total HT : </span>
              <span className="font-semibold text-foreground">
                {formatEUR(cv.totalHtCents)}
              </span>
            </p>
            <p>
              <span className="text-muted-foreground">Marge : </span>
              <span className="font-medium">{cv.marginPercent.toFixed(1)} %</span>
            </p>
            <p>
              <span className="text-muted-foreground">Nb lignes : </span>
              <span>{summary.lineCount}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Version courante : </span>
              <span>
                V{cv.versionNumber} — {versionStatusLabel(cv.status)}
              </span>
            </p>
            {av && (
              <p>
                <span className="text-muted-foreground">Version acceptée : </span>
                <span className="text-success font-medium">
                  V{av.versionNumber} — {formatEUR(av.totalHtCents)}
                </span>
              </p>
            )}
          </>
        ) : (
          <p className="text-muted-foreground italic">Aucun chiffrage en cours</p>
        )}
      </div>

      {/* Column 2 — Source DPGF */}
      <div className="space-y-1.5 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Source DPGF
        </h3>
        {dpgfSource ? (
          <>
            <p>
              <span className="text-muted-foreground">Fichier : </span>
              <span className="font-medium truncate">{dpgfSource.filename}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Format : </span>
              <span>{dpgfSource.sourceFormat}</span>
            </p>
            <p>
              <span className="text-muted-foreground">Lignes source : </span>
              <span>{dpgfSource.rowCount}</span>
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">Import :</span>
              {importBadge ? (
                <Badge variant={importBadge.variant} size="sm">{importBadge.label}</Badge>
              ) : null}
              {mappingBadge ? (
                <>
                  <span className="text-muted-foreground">Mapping :</span>
                  <Badge variant={mappingBadge.variant} size="sm">{mappingBadge.label}</Badge>
                </>
              ) : null}
            </div>
            <p>
              <span className="text-muted-foreground">Importé le : </span>
              <span>{formatDate(dpgfSource.importedAt)}</span>
            </p>
          </>
        ) : (
          <p className="text-muted-foreground italic border border-dashed border-border rounded px-3 py-2">
            Aucune DPGF importée
          </p>
        )}
      </div>

      {/* Column 3 — Actions rapides */}
      <div className="space-y-1 text-sm">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Actions rapides
        </h3>
        <Link href={`/dashboard/affaires/${projectId}`} className={QUICK_LINK_CLASS}>
          <HouseIcon aria-hidden="true" size={14} />
          Ouvrir l’affaire
        </Link>
        {cv && cv.status !== "draft" && (
          <Link href={`/dashboard/estimates/${cv.id}`} className={QUICK_LINK_CLASS}>
            <EyeIcon aria-hidden="true" size={14} />
            Voir le chiffrage
          </Link>
        )}
        {cv && cv.status === "draft" && (
          <Link href={`/dashboard/estimates/${cv.id}/edit`} className={QUICK_LINK_CLASS}>
            <SquarePenIcon aria-hidden="true" size={14} />
            Éditer le chiffrage
          </Link>
        )}
        {cv && (
          <Link href={`/dashboard/estimates/${cv.id}/print`} className={QUICK_LINK_CLASS}>
            <PrinterIcon aria-hidden="true" size={14} />
            Exporter
          </Link>
        )}
      </div>
    </div>
  );
}
