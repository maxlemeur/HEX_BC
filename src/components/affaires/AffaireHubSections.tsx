"use client";

import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon, FileIcon, FileTextIcon, PlusIcon } from "lucide-react";

import type {
  AffaireHubDpgfSourceResult,
  AffaireHubSummaryResult,
  AffaireHubTimelineResult,
} from "@/lib/affaires/server";
import { formatEUR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/layout/empty-state";
import { PageSection } from "@/components/layout/page-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";

const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function fmtHubDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : DATE_FMT.format(d);
}

export function getEstimateMarginSettingsHref(versionId: string) {
  return `/dashboard/estimates/${versionId}/edit?openSettings=margin`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  accepted: "Accepté",
  archived: "Archivé",
};

// `.status-badge` stays: it is the shared status pill hook used across screens and e2e.
const STATUS_CSS: Record<string, string> = {
  draft: "status-badge status-draft",
  sent: "status-badge status-sent",
  accepted: "status-badge status-accepted",
  archived: "status-badge status-archived",
};

/* ------------------------------------------------------------------ */
/*  Financial summary                                                  */
/* ------------------------------------------------------------------ */

function KpiLabel({ dotClass, children }: { dotClass: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-muted-foreground">
      <span aria-hidden="true" className={cn("inline-block size-1.5 rounded-full", dotClass)} />
      {children}
    </p>
  );
}

export function FinancialSummaryCard({
  summary,
  canEditMargin,
}: {
  summary: AffaireHubSummaryResult;
  canEditMargin: boolean;
}) {
  const { currentVersion, acceptedVersion, lineCount } = summary;

  if (currentVersion === null) return null;

  const hasAccepted = !!acceptedVersion;

  // Lot 2, sous-lot 2.5 : marge `null` = indisponible (v3 sans gel frais), jamais lue comme 0 %.
  const marginPct = currentVersion.marginPercent;
  const marginColorClass =
    marginPct === null
      ? "text-muted-foreground"
      : marginPct >= 25
        ? "text-success"
        : marginPct >= 15
          ? "text-foreground"
          : lineCount > 0
            ? "text-danger"
            : "text-muted-foreground";
  const isEmptyEstimate = currentVersion.totalHtCents === 0 && lineCount === 0;

  return (
    <div id="financial" className="animate-fade-in stagger-3 scroll-mt-24">
      <PageSection title="Résumé financier">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <KpiLabel dotClass="bg-primary">HT version courante</KpiLabel>
            <p className={cn("mt-1 font-bold", isEmptyEstimate ? "text-lg text-muted-foreground" : "text-2xl text-foreground")}>
              {formatEUR(currentVersion.totalHtCents)}
            </p>
          </div>

          <div className={hasAccepted ? "-m-2 rounded-lg bg-success-subtle p-2" : ""}>
            <KpiLabel dotClass="bg-success">HT dernière acceptée</KpiLabel>
            {acceptedVersion ? (
              <>
                <p className="mt-1 text-2xl font-bold text-success">
                  {formatEUR(acceptedVersion.totalHtCents)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  V{acceptedVersion.versionNumber}
                </p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">-</p>
            )}
          </div>

          <div>
            <KpiLabel dotClass="bg-brand-orange">Marge appliquée</KpiLabel>
            <p className={cn("mt-1 font-bold", isEmptyEstimate || marginPct === null ? "text-lg" : "text-2xl", marginColorClass)}>
              {marginPct === null ? "Indisponible" : `${marginPct.toFixed(1)} %`}
            </p>
            {currentVersion.marginMultiplier === null ? null : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Coeff. {currentVersion.marginMultiplier.toFixed(3)}
              </p>
            )}
            {canEditMargin && currentVersion.marginMultiplier !== null ? (
              <Link
                href={getEstimateMarginSettingsHref(currentVersion.id)}
                className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "mt-2 min-h-9 text-primary hover:text-primary")}
              >
                Modifier la marge
              </Link>
            ) : null}
          </div>

          <div>
            <KpiLabel dotClass="bg-subtle-foreground">Nombre de lignes</KpiLabel>
            <p className={cn("mt-1 font-bold", lineCount === 0 ? "text-lg text-muted-foreground" : "text-2xl text-foreground")}>
              {lineCount}
            </p>
          </div>
        </div>
      </PageSection>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Version timeline                                                   */
/* ------------------------------------------------------------------ */

export function VersionTimelineCard({
  timeline,
  projectId,
  currentVersionId,
  acceptedVersionId,
  isReadOnlyReview,
  errorMessage,
}: {
  timeline: AffaireHubTimelineResult | null;
  projectId: string;
  currentVersionId: string | null;
  acceptedVersionId: string | null;
  isReadOnlyReview?: boolean;
  errorMessage?: string;
}) {
  if (timeline === null) {
    return (
      <PageSection title="Versions">
        <Alert variant="warning">
          <AlertDescription>
            {errorMessage ?? "Impossible de charger la chronologie des versions."}
          </AlertDescription>
        </Alert>
      </PageSection>
    );
  }

  const { items, pagination } = timeline;

  return (
    <PageSection
      title="Versions"
      actions={
        <Badge variant="neutral">
          {pagination.total_count} version{pagination.total_count !== 1 ? "s" : ""}
        </Badge>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          variant="plain"
          icon={<FileTextIcon aria-hidden="true" />}
          title="Aucune version encore"
          description="Créez une première version pour démarrer le chiffrage."
          action={
            <Link
              href={`/dashboard/estimates/new?projectId=${projectId}`}
              className={buttonVariants({ variant: "primary", size: "md" })}
            >
              <PlusIcon aria-hidden="true" />
              Démarrer
            </Link>
          }
        />
      ) : (
        <div className="relative">
          <div
            aria-hidden="true"
            className="absolute bottom-1 left-[11px] top-1 w-px bg-border"
          />

          <ul className="space-y-3">
            {items.map((version) => {
              const isCurrent = version.id === currentVersionId;
              const isAccepted =
                version.id === acceptedVersionId &&
                version.status === "accepted";

              return (
                <li key={version.id} className="relative pl-8">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-0 top-5 size-3 rounded-full border-2",
                      isCurrent
                        ? "border-primary bg-primary"
                        : isAccepted
                          ? "border-success bg-success"
                          : "border-border-strong bg-surface"
                    )}
                  />

                  <Link
                    href={
                      isReadOnlyReview
                        ? `/dashboard/estimates/${version.id}`
                        : `/dashboard/estimates/${version.id}/edit`
                    }
                    className={cn(
                      "block rounded-lg border px-3 py-3 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:px-4",
                      isCurrent
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-surface-subtle"
                    )}
                  >
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-foreground">
                            Version {version.version_number}
                          </p>
                          {isCurrent && (
                            <span className="status-badge status-confirmed">
                              Courante
                            </span>
                          )}
                          {isAccepted && (
                            <span className="status-badge status-accepted">
                              Dernière acceptée
                            </span>
                          )}
                        </div>
                        {version.title && (
                          <p className="mt-0.5 truncate text-sm text-muted-foreground">
                            {version.title}
                          </p>
                        )}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className={STATUS_CSS[version.status] ?? "status-badge status-draft"}>
                            {STATUS_LABEL[version.status] ?? version.status}
                          </span>
                          <span>{fmtHubDate(version.created_at)}</span>
                          {version.author_name && (
                            <span>Par {version.author_name}</span>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0 text-left sm:text-right">
                        <p className="text-xs text-muted-foreground">Total HT</p>
                        <p className="text-sm font-semibold text-foreground">
                          {formatEUR(version.total_ht_cents)}
                        </p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {pagination.total_pages > 1 && (
        <nav
          aria-label="Pagination des versions"
          className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4 text-xs text-muted-foreground"
        >
          <span>
            Page {pagination.page}/{pagination.total_pages}
          </span>
          <div className="flex gap-2">
            {pagination.has_prev ? (
              <Link
                href={`/dashboard/affaires/${projectId}?timelinePage=${pagination.page - 1}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                <ChevronLeftIcon aria-hidden="true" />
                Précédente
              </Link>
            ) : (
              <Button variant="outline" size="sm" disabled leftIcon={<ChevronLeftIcon aria-hidden="true" />}>
                Précédente
              </Button>
            )}
            {pagination.has_next ? (
              <Link
                href={`/dashboard/affaires/${projectId}?timelinePage=${pagination.page + 1}`}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Suivante
                <ChevronRightIcon aria-hidden="true" />
              </Link>
            ) : (
              <Button variant="outline" size="sm" disabled rightIcon={<ChevronRightIcon aria-hidden="true" />}>
                Suivante
              </Button>
            )}
          </div>
        </nav>
      )}
    </PageSection>
  );
}

/* ------------------------------------------------------------------ */
/*  DPGF source                                                        */
/* ------------------------------------------------------------------ */

const IMPORT_STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  parsing: "En cours",
  completed: "Terminé",
  failed: "Erreur",
};

const MAPPING_STATUS_LABEL: Record<string, string> = {
  draft: "Brouillon",
  validated: "Validé",
  applied: "Appliqué",
  archived: "Archivé",
};

export function DpgfSourceCard({
  dpgfSource,
  errorMessage,
  onStartImport,
}: {
  dpgfSource: AffaireHubDpgfSourceResult;
  errorMessage?: string;
  onStartImport?: () => void;
}) {
  return (
    <div id="dpgf" className="scroll-mt-24">
      <PageSection title="Source DPGF">
        {errorMessage ? (
          <Alert variant="warning">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : dpgfSource === null ? (
          <div className="py-4 text-center">
            <FileIcon aria-hidden="true" strokeWidth="1.5" className="mx-auto mb-2 text-subtle-foreground" size={32} />
            <p className="text-sm text-muted-foreground">
              Importez le bordereau de prix (DPGF) comme base pour pré-remplir la structure du devis.
            </p>
            {onStartImport ? (
              <Button className="mt-3" onClick={onStartImport}>
                Importer la DPGF
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground" title={dpgfSource.filename}>
                {dpgfSource.filename}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {dpgfSource.sourceFormat.toUpperCase()} &middot;{" "}
                {dpgfSource.rowCount} lignes &middot; Importé le{" "}
                {fmtHubDate(dpgfSource.importedAt)}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant={dpgfSource.importStatus === "completed" ? "success" : "neutral"}>
                Import : {IMPORT_STATUS_LABEL[dpgfSource.importStatus] ?? dpgfSource.importStatus}
              </Badge>
              {dpgfSource.mappingStatus !== null && (
                <Badge variant={dpgfSource.mappingStatus === "validated" ? "success" : "neutral"}>
                  Mapping : {MAPPING_STATUS_LABEL[dpgfSource.mappingStatus] ?? dpgfSource.mappingStatus}
                </Badge>
              )}
            </div>
            {onStartImport ? (
              <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-muted-foreground">
                  Relancez le mapping depuis l&apos;Excel. Le devis reste inchangé
                  jusqu&apos;à la confirmation.
                </p>
                <Button variant="outline" className="shrink-0" onClick={onStartImport}>
                  Reprendre l&apos;import
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </PageSection>
    </div>
  );
}
