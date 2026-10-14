import { notFound } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PageHeader } from "@/components/layout/page-header";
import { PrintTitle } from "@/components/PrintTitle";
import {
  SealIntegrityBadge,
  type SealIntegrityState,
} from "@/components/estimates/SealIntegrityBadge";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { getUserContext } from "@/lib/auth/server";
import {
  buildStoredEstimateBreakdown,
  computeEstimateTotals,
  computeReadOnlyTotals,
  computeStoredDiscountCents,
} from "@/lib/estimate-calculations";
import {
  resolveCalcEngineVersion,
  shouldPreserveStoredEstimateV2Snapshot,
} from "@/lib/estimates/calc-engine-version";
import {
  loadMarginTiersForTotals,
  resolveRenderMarginMode,
} from "@/lib/estimates/margin-tiers-loader";
import { toSafeEstimateErrorLogDetails } from "@/lib/estimates/logging";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import {
  isMissingEstimateRoundingAdjustmentSchema,
  resolveEstimatePdfPreviewLayout,
} from "@/lib/estimates/pdf-generator";
import { formatEstimateReference } from "@/lib/estimates/reference";
import {
  describeEstimatePdfLayout,
  parseEstimatePdfLayoutSearchParams,
} from "@/lib/estimates/pdf-layout";
import { verifyEstimateSeal } from "@/lib/estimates/server";
import { normalizeEstimateCurrency } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { EstimatePrintLayoutButton } from "./EstimatePrintLayoutButton";

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
type PrintPageProps = {
  params?: Promise<{ versionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const PRINT_VERSION_SELECT =
  "id, updated_at, project_id, tenant_id, version_number, status, seal_hash, date_devis, validite_jours, exclusions, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, content_revision, calc_snapshot_content_revision, calc_snapshot_context, contractor_role, total_ht_cents, total_tax_cents, total_ttc_cents, rounding_adjustment_cents, currency, estimate_projects ( name, reference, estimate_reference, site_address, client_name )";
const LEGACY_PRINT_VERSION_SELECT =
  "id, updated_at, project_id, tenant_id, version_number, status, seal_hash, date_devis, validite_jours, exclusions, margin_multiplier, margin_mode, discount_bp, discount_amount_cents, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, content_revision, calc_snapshot_content_revision, calc_snapshot_context, contractor_role, total_ht_cents, total_tax_cents, total_ttc_cents, currency, estimate_projects ( name, reference, estimate_reference, site_address, client_name )";

function formatPrintDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().split("T")[0];
}

function sanitizeFilename(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/_{2,}/g, "_")
    .replace(/-+/g, "-")
    .replace(/^[_-]+|[_-]+$/g, "");
}

function resolveEstimatePortalUrl(versionId: string) {
  const portalBaseUrl = process.env.NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL?.trim();
  if (!portalBaseUrl) return null;

  try {
    const normalized = portalBaseUrl.endsWith("/")
      ? portalBaseUrl
      : `${portalBaseUrl}/`;
    return new URL(`estimates/${versionId}`, normalized).toString();
  } catch {
    return null;
  }
}

function resolveProject(
  value: EstimateVersion["estimate_projects"]
) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function PrintEstimatePage({
  params,
  searchParams,
}: PrintPageProps) {
  if (!params) {
    notFound();
  }
  const { versionId } = await params;
  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedLayout = parseEstimatePdfLayoutSearchParams(
    resolvedSearchParams
  );
  const autoPrintRaw = resolvedSearchParams.auto_print;
  const autoPrint = (Array.isArray(autoPrintRaw) ? autoPrintRaw[0] : autoPrintRaw) === "1";
  const supabase = await createSupabaseServerClient();
  const userContextPromise = getUserContext();
  const previewLayoutPromise = resolveEstimatePdfPreviewLayout(
    versionId,
    requestedLayout
  );

  const versionPromise = (async () => {
    const primaryResult = await supabase
      .from("estimate_versions")
      .select(PRINT_VERSION_SELECT)
      .eq("id", versionId)
      .single();

    if (!isMissingEstimateRoundingAdjustmentSchema(primaryResult.error)) {
      return primaryResult;
    }

    const legacyResult = await supabase
      .from("estimate_versions")
      .select(LEGACY_PRINT_VERSION_SELECT)
      .eq("id", versionId)
      .single();

    return {
      ...legacyResult,
      data: legacyResult.data
        ? { ...legacyResult.data, rounding_adjustment_cents: 0 }
        : null,
    };
  })();

  const [versionResult, userContext, previewLayout] = await Promise.all([
    versionPromise,
    userContextPromise,
    previewLayoutPromise,
  ]);

  if (
    versionResult.error ||
    !versionResult.data
  ) {
    notFound();
  }

  const version = versionResult.data as EstimateVersion;
  if (!userContext.tenantId || userContext.tenantId !== version.tenant_id) {
    notFound();
  }
  const items = await readAllEstimateItems({
    supabase,
    tenantId: version.tenant_id,
    versionId,
  });
  const calcEngineVersion = resolveCalcEngineVersion(version);
  const preserveStoredSnapshot =
    calcEngineVersion === 1
      ? version.status !== "draft"
      : shouldPreserveStoredEstimateV2Snapshot(version);
  const selectedCurrency = normalizeEstimateCurrency(version.currency) ?? "EUR";
  const layoutDescription = describeEstimatePdfLayout(previewLayout.layout);
  const project = resolveProject(version.estimate_projects);
  const isLaborSplitEnabled = preserveStoredSnapshot
    ? true
    : await isFeatureEnabled(version.tenant_id, "EST_031_LABOR_SPLIT", {
        supabase,
      });
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
    ? calcEngineVersion === 1
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
      console.error("Failed to verify estimate seal for print", {
        versionId,
        ...toSafeEstimateErrorLogDetails(error),
      });
      sealState = "error";
    }
  }

  await assertEstimateVersionUnchanged({ supabase, version });

  const officialReference = formatEstimateReference(
    project?.estimate_reference,
    version.version_number
  );
  const rawTitle =
    officialReference ??
    [
      project?.name ?? "devis",
      `V${version.version_number}`,
      formatPrintDate(version.date_devis),
    ]
      .filter(Boolean)
      .join("_");
  const printTitle = sanitizeFilename(rawTitle);
  const estimatePortalUrl = resolveEstimatePortalUrl(versionId);

  return (
    <div className="min-h-screen print:bg-surface">
      <PrintTitle title={printTitle} />
      <div className="no-print z-10 -mx-3 md:sticky md:top-0 border-b border-border bg-surface/95 px-3 py-4 backdrop-blur-md sm:-mx-6 sm:px-6">
        <PageHeader
          className="mx-auto mb-0 max-w-5xl sm:mb-0"
          breadcrumbs={[
            { label: "Affaires", href: "/dashboard/affaires" },
            ...(version.project_id && project?.name
              ? [{ label: project.name, href: `/dashboard/affaires/${version.project_id}` }]
              : []),
            { label: `V${version.version_number}`, href: `/dashboard/estimates/${versionId}` },
            { label: "Impression" },
          ]}
          title="Aperçu avant impression"
          meta={
            <>
              <span className="font-medium text-foreground-secondary">
                Devis V{version.version_number}
              </span>
              <SealIntegrityBadge state={sealState} hashPrefix={sealHashPrefix} />
              <span className="text-muted-foreground">
                Configuration : {layoutDescription}
              </span>
            </>
          }
          actions={
            <EstimatePrintLayoutButton
              versionId={versionId}
              initialLayout={previewLayout.layout}
              autoPrint={autoPrint}
            />
          }
        />
      </div>

      <div className="py-8 print:py-0">
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
          portalUrl={estimatePortalUrl}
          versionNumber={version.version_number}
          dateDevis={version.date_devis}
          validiteJours={version.validite_jours}
          marginMultiplier={appliedMarginMultiplier}
          globalCoefficient={version.global_coefficient}
          discountCents={discountCents}
          taxRateBp={version.tax_rate_bp}
          currency={selectedCurrency}
          isLaborSplitEnabled={isLaborSplitEnabled}
          laborRateById={laborRateById}
          totalHtCents={totalHtCents}
          totalTaxCents={totalTaxCents}
          totalTtcCents={totalTtcCents}
          roundingAdjustmentCents={roundingAdjustmentCents}
          items={items}
          exclusions={version.exclusions}
          issuerName={userContext.profile?.full_name}
          issuerRole={userContext.profile?.job_title}
          issuerPhone={userContext.profile?.phone}
          issuerEmail={userContext.profile?.work_email ?? userContext.userEmail}
          layout={previewLayout.layout}
          terms={previewLayout.terms}
        />
      </div>
      <div className="print-page-footer" aria-hidden>
        <span className="print-page-counter" />
      </div>
    </div>
  );
}
