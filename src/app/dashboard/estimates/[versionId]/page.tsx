import Link from "next/link";
import { notFound } from "next/navigation";
import { GitCompareArrowsIcon, PencilIcon, PrinterIcon } from "lucide-react";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EstimateDetailActionsMenu } from "@/components/estimates/EstimateDetailActionsMenu";
import { EstimateApprovalActions } from "@/components/estimates/EstimateApprovalActions";
import { EstimateApprovalDecisionJournalCard } from "@/components/estimates/EstimateApprovalDecisionJournalCard";
import { EstimateApprovalSummaryCard } from "@/components/estimates/EstimateApprovalSummaryCard";
import { EstimateTimeline } from "@/components/estimates/EstimateTimeline";
import { EstimateStatusActions } from "@/components/estimates/EstimateStatusActions";
import { VariantComparisonTable } from "@/components/estimates/VariantComparisonTable";
import { fetchAffaireHubPlansSummary } from "@/lib/affaires/server";
import { fetchAffaireRegisterSummary } from "@/lib/affaires/register-server";
import {
  SealIntegrityBadge,
  type SealIntegrityState,
} from "@/components/estimates/SealIntegrityBadge";
import { getUserContext } from "@/lib/auth/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import {
  buildStoredEstimateBreakdown,
  computeEstimateTotals,
  computeReadOnlyTotals,
  computeStoredDiscountCents,
} from "@/lib/estimate-calculations";
import { EstimateEngineUnavailableNotice } from "@/components/estimates/EstimateEngineUnavailableNotice";
import { EstimateV3DraftSummary } from "@/components/estimates/v3/EstimateV3DraftSummary";
import {
  resolveEstimateEngineVersionForDisplay,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";
import { isLegacyEngine, requireHistoricalEngine, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { readStoredEstimateV3DraftSummary } from "@/lib/estimates/v3-editor";
import {
  loadMarginTiersForTotals,
  resolveRenderMarginMode,
} from "@/lib/estimates/margin-tiers-loader";
import {
  APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM,
  APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM,
  parseApprovalDecisionJournalAuthorSearchParam,
  parseApprovalDecisionJournalStatusSearchParam,
} from "@/lib/estimates/approval-decision-journal";
import {
  getEstimateApprovalSummary,
  listEstimateApprovalDecisionJournal,
} from "@/lib/estimates/rules-engine";
import { toSafeEstimateErrorLogDetails } from "@/lib/estimates/logging";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import {
  listEstimateProjectVersions,
  listEstimateVersionVariants,
  verifyEstimateSeal,
} from "@/lib/estimates/server";
import { formatEUR, normalizeEstimateCurrency } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type EstimateProject =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersion =
  Database["public"]["Tables"]["estimate_versions"]["Row"] & {
    estimate_projects:
      | Pick<EstimateProject, "name" | "reference" | "estimate_reference" | "site_address" | "client_name">
      | Pick<EstimateProject, "name" | "reference" | "estimate_reference" | "site_address" | "client_name">[]
      | null;
  };
type LaborRoleRate = Pick<
  Database["public"]["Tables"]["labor_roles"]["Row"],
  "id" | "hourly_rate_cents"
>;
type EstimateDetailPageSearchParams = Record<
  string,
  string | string[] | undefined
>;

const VERSION_TIMELINE_PAGE_SIZE = 20;

const STATUS_BADGES: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  draft: { variant: "neutral", label: "Brouillon" },
  sending: { variant: "warning", label: "Envoi en cours" },
  sent: { variant: "info", label: "Envoyé" },
  accepted: { variant: "success", label: "Accepté" },
  archived: { variant: "outline", label: "Archivé" },
};

function computeExpiryInfo(dateDevis: string | null, validiteJours: number | null) {
  if (!dateDevis || !validiteJours || validiteJours <= 0) return null;
  const start = new Date(`${dateDevis}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) return null;
  const expiryDate = new Date(start.getTime() + validiteJours * 86400000);
  const now = new Date();
  const expired = now > expiryDate;
  return {
    expiryDate: expiryDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }),
    expired,
  };
}

function resolveProject(
  value: EstimateVersion["estimate_projects"]
) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function parseHistoryPage(
  value: string | string[] | undefined
): number | undefined {
  if (value === undefined) return undefined;
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return undefined;
  const parsed = Number.parseInt(candidate, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return parsed;
}

/**
 * Lot 2, sous-lot 2.6 : fiche d'un brouillon v3, en lecture. Totaux stockés (vérifiés à chaque
 * sauvegarde, D12), TVA par taux, lignes ; ni statut d'émission ni document client avant 2.7.
 */
async function renderEstimateV3Detail(input: {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  version: EstimateVersion;
  versionId: string;
  items: Awaited<ReturnType<typeof readAllEstimateItems>>;
  timelinePage: number | undefined;
  approvalSummary: Awaited<ReturnType<typeof getEstimateApprovalSummary>> | null;
  approvalJournal: Awaited<ReturnType<typeof listEstimateApprovalDecisionJournal>> | null;
  canEditVersion: boolean;
}) {
  const { version, versionId, items } = input;
  const project = resolveProject(version.estimate_projects);
  const [versionTimeline, plansSummary, registerSummary] = await Promise.all([
    listEstimateProjectVersions({
      projectId: version.project_id,
      page: input.timelinePage,
      pageSize: VERSION_TIMELINE_PAGE_SIZE,
      anchorVersionId: versionId,
    }),
    fetchAffaireHubPlansSummary(version.project_id).catch(() => null),
    fetchAffaireRegisterSummary({ projectId: version.project_id, versionId }).catch(() => null),
  ]);
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version });
  const summary = readStoredEstimateV3DraftSummary(version, items);
  const currency = normalizeEstimateCurrency(version.currency) ?? "EUR";
  const expiry = computeExpiryInfo(version.date_devis, version.validite_jours);
  const statusBadge = STATUS_BADGES[version.status] ?? STATUS_BADGES.draft;
  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Affaires", href: "/dashboard/affaires" },
          ...(version.project_id && project?.name
            ? [{ label: project.name, href: `/dashboard/affaires/${version.project_id}` }]
            : []),
          { label: `V${version.version_number}` },
        ]}
        title={`Chiffrage V${version.version_number}`}
        description={project?.name ? [project.name, project.client_name].filter(Boolean).join(" — ") : undefined}
        meta={<SealIntegrityBadge state="unsealed" hashPrefix={null} />}
        actions={
          <>
            <Link className={buttonVariants({ variant: "outline", size: "md" })} href={`/dashboard/estimates/${versionId}/print`}>
              <PrinterIcon aria-hidden="true" />
              Imprimer
            </Link>
            <EstimateDetailActionsMenu versionId={versionId} versionStatus={version.status} canEditVersion={input.canEditVersion} closedEngineV3Actions />
            {input.canEditVersion ? (
              <Link className={buttonVariants({ variant: "primary", size: "md" })} href={`/dashboard/estimates/${versionId}/edit`}>
                <PencilIcon aria-hidden="true" />
                Éditer
              </Link>
            ) : null}
          </>
        }
      />
      <Card className="mb-6 p-4 sm:p-6">
        <dl className="grid grid-cols-1 gap-6 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Projet</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-foreground">{project?.name ?? "—"}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Statut</dt>
            <dd className="mt-1">
              <Badge variant={statusBadge.variant} dot>{statusBadge.label}</Badge>
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total HT</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatEUR(summary.totalHtCents)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total TTC</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatEUR(summary.payableTtcCents)}</dd>
            {expiry ? (
              <dd className={`mt-1 text-xs ${expiry.expired ? "text-danger" : "text-muted-foreground"}`}>
                {expiry.expired ? "Expiré le" : "Valide jusqu’au"} {expiry.expiryDate}
              </dd>
            ) : null}
          </div>
        </dl>
      </Card>
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {input.approvalSummary ? (
            <EstimateApprovalSummaryCard summary={input.approvalSummary}>
              <EstimateApprovalActions
                versionId={versionId}
                projectId={version.project_id}
                summary={input.approvalSummary}
                isEmpty={items.filter((item) => item.item_type === "line").length === 0}
                submissionOverview={{
                  coveragePercent: plansSummary?.coveragePercent ?? null,
                  exceptionCount: plansSummary?.exceptionCount ?? null,
                  openQuestionsCount: plansSummary?.openQuestionsCount ?? null,
                  openAssumptionCount: registerSummary?.openAssumptionCount ?? null,
                  openMissingPieceCount: registerSummary?.openMissingPieceCount ?? null,
                  clarifyWithClientCount: registerSummary?.clarifyWithClientCount ?? null,
                  // Marque v3 : calculée et figée côté serveur (D5), jamais un multiplicateur v2.
                  marginPercent: null,
                }}
              />
            </EstimateApprovalSummaryCard>
          ) : null}
          {input.approvalJournal ? (
            <EstimateApprovalDecisionJournalCard versionId={versionId} initialJournal={input.approvalJournal} />
          ) : null}
          <EstimateTimeline currentVersionId={versionId} versions={versionTimeline.items} pagination={versionTimeline.pagination} />
        </div>
        <div className="min-w-0">
          <EstimateV3DraftSummary summary={summary} items={items} currency={currency} />
        </div>
      </div>
    </div>
  );
}

export default async function EstimateDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ versionId: string }>;
  searchParams?: Promise<EstimateDetailPageSearchParams>;
}>) {
  const { versionId } = await params;
  const resolvedSearchParams = searchParams
    ? await searchParams
    : ({} as EstimateDetailPageSearchParams);
  const timelinePage = parseHistoryPage(resolvedSearchParams.historyPage);
  const approvalJournalAuthor = parseApprovalDecisionJournalAuthorSearchParam(
    resolvedSearchParams[APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM]
  );
  const approvalJournalDecision = parseApprovalDecisionJournalStatusSearchParam(
    resolvedSearchParams[APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM]
  );
  const supabase = await createSupabaseServerClient();
  const userContextPromise = getUserContext();
  const approvalSummaryPromise = getEstimateApprovalSummary(versionId).catch(() => null);
  const approvalJournalPromise = listEstimateApprovalDecisionJournal({
    versionId,
    actorUserId: approvalJournalAuthor,
    decision: approvalJournalDecision,
  }).catch(() => null);

  // The approval projection may persist metadata and advance updated_at.
  // Read the displayed version afterwards so its actions share that exact token.
  const versionPromise = approvalSummaryPromise.then(() => supabase
    .from("estimate_versions")
    .select(
      "id, project_id, tenant_id, version_number, status, updated_at, seal_hash, seal_payload_version, title, exclusions, date_devis, validite_jours, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, content_revision, calc_snapshot_content_revision, calc_snapshot_context, contractor_role, currency, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents, estimate_projects ( name, reference, estimate_reference, site_address, client_name )"
    )
    .eq("id", versionId)
    .single());

  const [versionResult, userContext, approvalSummary, approvalJournal] = await Promise.all([
    versionPromise,
    userContextPromise,
    approvalSummaryPromise,
    approvalJournalPromise,
  ]);

  if (versionResult.error || !versionResult.data) {
    notFound();
  }

  const version = versionResult.data as EstimateVersion;
  if (!userContext.tenantId || userContext.tenantId !== version.tenant_id) {
    notFound();
  }
  // Lot 2, sous-lots 2.1 puis 2.6 : une v3 n'est jamais relue en moteur 1. Un brouillon v3 se lit sur
  // ses montants stockés (TVA par taux), sans calcul ni émission ; seul un moteur inconnu garde le
  // bandeau du moteur.
  const estimateEngine = resolveEstimateEngineVersionForDisplay(version);
  if (estimateEngine === null) {
    return (
      <EstimateEngineUnavailableNotice
        versionNumber={version.version_number}
        projectId={version.project_id}
        projectName={resolveProject(version.estimate_projects)?.name}
      />
    );
  }
  const items = await readAllEstimateItems({
    supabase,
    tenantId: version.tenant_id,
    versionId,
  });
  if (usesSaleCoefficients(estimateEngine)) {
    const tenantRoleV3 = userContext.profile?.tenant_role ?? null;
    return renderEstimateV3Detail({
      supabase, version, versionId, items, timelinePage, approvalSummary, approvalJournal,
      canEditVersion: tenantRoleV3 === "admin" || tenantRoleV3 === "engineer",
    });
  }
  const calcEngineVersion = requireHistoricalEngine(estimateEngine);
  const preserveStoredSnapshot =
    isLegacyEngine(calcEngineVersion)
      ? version.status !== "draft"
      : shouldPreserveStoredEstimateV2Snapshot(version);
  const project = resolveProject(version.estimate_projects);
  const tenantRole = userContext.profile?.tenant_role ?? null;
  const canEditVersion = tenantRole === "admin" || tenantRole === "engineer";
  const [versionTimeline, variantComparison, isLaborSplitEnabled] = await Promise.all([
    listEstimateProjectVersions({
      projectId: version.project_id,
      page: timelinePage,
      pageSize: VERSION_TIMELINE_PAGE_SIZE,
      anchorVersionId: versionId,
    }),
    listEstimateVersionVariants(versionId),
    preserveStoredSnapshot
      ? Promise.resolve(true)
      : isFeatureEnabled(version.tenant_id, "EST_031_LABOR_SPLIT", {
          supabase,
        }),
  ]);
  const [plansSummary, registerSummary, emailDispatchProblem] = await Promise.all([
    fetchAffaireHubPlansSummary(version.project_id).catch(() => null),
    fetchAffaireRegisterSummary({
      projectId: version.project_id,
      versionId,
    }).catch(() => null),
    Promise.resolve(
      supabase
        .from("estimate_emails")
        .select("id, status, last_error_message")
        .eq("version_id", versionId)
        .eq("tenant_id", version.tenant_id)
        .eq("type", "initial")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    )
      .then((result) => {
        const row = result.data as
          | { id: string; status: string; last_error_message: string | null }
          | null;
        if (row?.status === "unknown" || row?.status === "failed") {
          return {
            id: row.id,
            status: row.status as "unknown" | "failed",
            lastErrorMessage: row.last_error_message,
          };
        }
        return null;
      })
      .catch(() => null),
  ]);
  const laborRoleIds = preserveStoredSnapshot ? [] : Array.from(
    new Set(
      items
        .flatMap((item) => [
          item.labor_role_id,
          item.labor_role_atelier_id,
          item.labor_role_chantier_id,
        ])
        .filter((value): value is string => Boolean(value))
    )
  );
  const laborRateById: Record<string, number> = {};

  if (laborRoleIds.length > 0) {
    const laborRolesResult = await supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .in("id", laborRoleIds);

    if (laborRolesResult.error) {
      notFound();
    }

    ((laborRolesResult.data ?? []) as LaborRoleRate[]).forEach((role) => {
      laborRateById[role.id] = role.hourly_rate_cents ?? 0;
    });
  }

  const lineItemsForTotals = items
    .filter((item) => item.item_type === "line")
    .map((item) => ({
      ...item,
      labor_role_hourly_rate_cents: item.labor_role_id
        ? (laborRateById[item.labor_role_id] ?? 0)
        : 0,
      labor_role_atelier_hourly_rate_cents: item.labor_role_atelier_id
        ? (laborRateById[item.labor_role_atelier_id] ?? 0)
        : 0,
      labor_role_chantier_hourly_rate_cents: item.labor_role_chantier_id
        ? (laborRateById[item.labor_role_chantier_id] ?? 0)
        : 0,
    }));
  // EST-E26 (T6, étape 6) : injecter le barème du tenant (marginTiers requis).
  // Hors brouillon, le mode est figé sur "fixed" : un devis transmis affiche
  // la marge qu'il a persistée, pas le barème du jour (cf. resolveRenderMarginMode).
  const renderMarginMode = resolveRenderMarginMode(
    version.status,
    version.margin_mode
  );
  const marginTiers =
    !preserveStoredSnapshot && renderMarginMode === "tiered"
      ? await loadMarginTiersForTotals({ supabase, tenantId: version.tenant_id })
      : [];
  const computedTotals = preserveStoredSnapshot
    ? isLegacyEngine(calcEngineVersion)
      ? computeReadOnlyTotals({
          items,
          version,
          discountCents: computeStoredDiscountCents(version, items),
          laborRateById: new Map(),
          isLaborSplitEnabled: false,
          marginTiers: [],
          roundingMode: version.rounding_mode,
          roundingStepCents: version.rounding_step_cents,
          calcEngineVersion,
        })
      : buildStoredEstimateBreakdown({ items, version }).totals
    : (() => {
        const baseTotals = computeEstimateTotals({
          lineItems: lineItemsForTotals,
          marginMultiplier: version.margin_multiplier,
          marginMode: renderMarginMode,
          marginTiers,
          isLaborSplitEnabled,
          discountCents: 0,
          discountMode: version.discount_mode,
          discountStepsBp: version.discount_steps,
          globalCoefficient: version.global_coefficient,
          taxRateBp: version.tax_rate_bp,
          roundingMode: version.rounding_mode,
          roundingStepCents: version.rounding_step_cents,
        });
        const fallbackDiscountCents =
          version.discount_amount_cents ??
          (baseTotals.saleSubtotalCents > 0
            ? Math.round(
                (baseTotals.saleSubtotalCents * version.discount_bp) / 10000
              )
            : 0);
        return computeEstimateTotals({
          lineItems: lineItemsForTotals,
          marginMultiplier: version.margin_multiplier,
          marginMode: renderMarginMode,
          marginTiers,
          isLaborSplitEnabled,
          discountCents: fallbackDiscountCents,
          discountMode: version.discount_mode,
          discountStepsBp: version.discount_steps,
          globalCoefficient: version.global_coefficient,
          taxRateBp: version.tax_rate_bp,
          roundingMode: version.rounding_mode,
          roundingStepCents: version.rounding_step_cents,
        });
      })();
  const discountCents = computedTotals.discountCents;
  const appliedMarginMultiplier = computedTotals.appliedMarginMultiplier;
  const totalHtCents = computedTotals.saleTotalCents;
  const totalTaxCents = computedTotals.taxCents;
  const totalTtcCents = computedTotals.roundedTtcCents;
  const roundingAdjustmentCents = computedTotals.roundingAdjustmentCents;

  let sealState: SealIntegrityState = "unsealed";
  let sealHashPrefix = version.seal_hash?.slice(0, 8) ?? null;

  if (version.status !== "draft" && version.seal_hash) {
    try {
      const verification = await verifyEstimateSeal(versionId);
      sealState = verification.valid ? "valid" : "invalid";
      if (verification.stored_hash) {
        sealHashPrefix = verification.stored_hash.slice(0, 8);
      }
    } catch (error) {
      console.error("Failed to verify estimate seal", {
        versionId,
        ...toSafeEstimateErrorLogDetails(error),
      });
      sealState = "error";
    }
  }

  await assertEstimateVersionUnchanged({ supabase, version });

  const expiry = computeExpiryInfo(version.date_devis, version.validite_jours);
  const statusBadge = STATUS_BADGES[version.status] ?? STATUS_BADGES.draft;
  const breadcrumbs = [
    { label: "Affaires", href: "/dashboard/affaires" },
    ...(version.project_id && project?.name
      ? [{ label: project.name, href: `/dashboard/affaires/${version.project_id}` }]
      : []),
    { label: `V${version.version_number}` },
  ];

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={breadcrumbs}
        title={`Chiffrage V${version.version_number}`}
        description={
          project?.name
            ? [project.name, project.client_name].filter(Boolean).join(" — ")
            : undefined
        }
        meta={<SealIntegrityBadge state={sealState} hashPrefix={sealHashPrefix} />}
        actions={
          <>
            <Link
              className={buttonVariants({ variant: "outline", size: "md" })}
              href={`/dashboard/estimates/${versionId}/source-review`}
              prefetch={false}
            >
              Référence CCTP
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", size: "md" })}
              href={`/dashboard/estimates/${versionId}/diff`}
            >
              <GitCompareArrowsIcon aria-hidden="true" />
              Comparer
            </Link>
            <Link
              className={buttonVariants({ variant: "outline", size: "md" })}
              href={`/dashboard/estimates/${versionId}/print`}
            >
              <PrinterIcon aria-hidden="true" />
              Imprimer
            </Link>
            <EstimateDetailActionsMenu versionId={versionId} versionStatus={version.status} canEditVersion={canEditVersion} />
            {canEditVersion ? (
              <Link
                className={buttonVariants({ variant: "primary", size: "md" })}
                href={`/dashboard/estimates/${versionId}/edit`}
              >
                <PencilIcon aria-hidden="true" />
                Éditer
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="mb-6 p-4 sm:p-6">
        <dl className="grid grid-cols-1 gap-6 min-[420px]:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Projet</dt>
            <dd className="mt-1 break-words text-sm font-semibold text-foreground">{project?.name ?? "—"}</dd>
            {project?.client_name ? (
              <dd className="text-xs text-muted-foreground">{project.client_name}</dd>
            ) : null}
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Statut</dt>
            <dd className="mt-1">
              <Badge variant={statusBadge.variant} dot>
                {statusBadge.label}
              </Badge>
              {canEditVersion ? (
                <EstimateStatusActions
                  versionId={versionId}
                  currentStatus={version.status}
                  updatedAt={version.updated_at}
                  projectName={project?.name ?? undefined}
                  emailDispatchProblem={emailDispatchProblem}
                />
              ) : null}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total HT</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatEUR(totalHtCents ?? 0)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total TTC</dt>
            <dd className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatEUR(totalTtcCents ?? 0)}</dd>
            {expiry ? (
              <dd className={`mt-1 text-xs ${expiry.expired ? "text-danger" : "text-muted-foreground"}`}>
                {expiry.expired ? "Expiré le" : "Valide jusqu’au"} {expiry.expiryDate}
              </dd>
            ) : null}
          </div>
        </dl>
      </Card>

      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-6">
          {approvalSummary ? (
            <EstimateApprovalSummaryCard summary={approvalSummary}>
              <EstimateApprovalActions
                versionId={versionId}
                projectId={version.project_id}
                summary={approvalSummary}
                isEmpty={items.filter((i) => i.item_type === "line").length === 0}
                submissionOverview={{
                  coveragePercent: plansSummary?.coveragePercent ?? null,
                  exceptionCount: plansSummary?.exceptionCount ?? null,
                  openQuestionsCount: plansSummary?.openQuestionsCount ?? null,
                  openAssumptionCount: registerSummary?.openAssumptionCount ?? null,
                  openMissingPieceCount: registerSummary?.openMissingPieceCount ?? null,
                  clarifyWithClientCount: registerSummary?.clarifyWithClientCount ?? null,
                  marginPercent:
                    Number.isFinite(appliedMarginMultiplier) && appliedMarginMultiplier > 0
                      ? (appliedMarginMultiplier - 1) * 100
                      : 0,
                }}
              />
            </EstimateApprovalSummaryCard>
          ) : null}
          {approvalJournal ? (
            <EstimateApprovalDecisionJournalCard
              versionId={versionId}
              initialJournal={approvalJournal}
            />
          ) : null}
          <EstimateTimeline
            currentVersionId={versionId}
            versions={versionTimeline.items}
            pagination={versionTimeline.pagination}
          />
        </div>
        <div className="min-w-0">
          <EstimateDocument
            calculationVersion={version}
            calcEngineVersion={calcEngineVersion}
            preserveStoredSnapshot={preserveStoredSnapshot}
            vatReverseCharge={version.contractor_role === "subcontractor"}
            projectName={project?.name ?? "Projet"}
            projectSiteAddress={project?.site_address}
            projectClient={project?.client_name}
            projectReference={project?.reference}
            estimateReference={project?.estimate_reference}
            versionNumber={version.version_number}
            dateDevis={version.date_devis}
            validiteJours={version.validite_jours}
            marginMultiplier={appliedMarginMultiplier}
            globalCoefficient={version.global_coefficient}
            discountCents={discountCents}
            taxRateBp={version.tax_rate_bp}
            isLaborSplitEnabled={isLaborSplitEnabled}
            laborRateById={laborRateById}
            totalHtCents={totalHtCents}
            totalTaxCents={totalTaxCents}
            totalTtcCents={totalTtcCents}
            roundingAdjustmentCents={roundingAdjustmentCents}
            items={items}
          />
        </div>
      </div>
      <div className="mt-6">
        <VariantComparisonTable
          currentVersionId={versionId}
          baseVersionId={variantComparison.base_version_id}
          items={variantComparison.items}
        />
      </div>
    </div>
  );
}
