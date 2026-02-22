import Link from "next/link";
import { notFound } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { EstimateTimeline } from "@/components/estimates/EstimateTimeline";
import { EstimatePdfDownloadButton } from "@/components/estimates/EstimatePdfDownloadButton";
import { DuplicateEstimateButton } from "@/components/estimates/DuplicateEstimateButton";
import { VariantComparisonTable } from "@/components/estimates/VariantComparisonTable";
import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";
import {
  SealIntegrityBadge,
  type SealIntegrityState,
} from "@/components/estimates/SealIntegrityBadge";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { computeEstimateTotals } from "@/lib/estimate-calculations";
import {
  listEstimateProjectVersions,
  listEstimateVersionVariants,
  verifyEstimateSeal,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type EstimateProject =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersion =
  Database["public"]["Tables"]["estimate_versions"]["Row"] & {
    estimate_projects:
      | Pick<EstimateProject, "name" | "reference" | "client_name">
      | Pick<EstimateProject, "name" | "reference" | "client_name">[]
      | null;
  };
type EstimateItem =
  Database["public"]["Tables"]["estimate_items"]["Row"];
type LaborRoleRate = Pick<
  Database["public"]["Tables"]["labor_roles"]["Row"],
  "id" | "hourly_rate_cents"
>;
type SupplyTypeLabel = Pick<
  Database["public"]["Tables"]["supply_types"]["Row"],
  "id" | "name"
>;
type EstimateDetailPageSearchParams = Record<
  string,
  string | string[] | undefined
>;

const VERSION_TIMELINE_PAGE_SIZE = 20;

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
  const supabase = await createSupabaseServerClient();

  const versionPromise = supabase
    .from("estimate_versions")
    .select(
      "project_id, tenant_id, version_number, status, seal_hash, title, date_devis, validite_jours, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents, estimate_projects ( name, reference, client_name )"
    )
    .eq("id", versionId)
    .single();

  const itemsPromise = supabase
    .from("estimate_items")
    .select("*")
    .eq("version_id", versionId)
    .order("position", { ascending: true });

  const [versionResult, itemsResult] = await Promise.all([
    versionPromise,
    itemsPromise,
  ]);

  if (versionResult.error || !versionResult.data) {
    notFound();
  }

  if (itemsResult.error) {
    notFound();
  }

  const version = versionResult.data as EstimateVersion;
  const items = (itemsResult.data ?? []) as EstimateItem[];
  const project = resolveProject(version.estimate_projects);
  const [versionTimeline, variantComparison, isLaborSplitEnabled] = await Promise.all([
    listEstimateProjectVersions({
      projectId: version.project_id,
      page: timelinePage,
      pageSize: VERSION_TIMELINE_PAGE_SIZE,
      anchorVersionId: versionId,
    }),
    listEstimateVersionVariants(versionId),
    isFeatureEnabled(
      version.tenant_id,
      "EST_031_LABOR_SPLIT",
      { supabase }
    ),
  ]);
  const laborRoleIds = Array.from(
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
  const supplyTypeLabelsById: Record<string, string> = {};

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

  const supplyTypesResult = await supabase
    .from("supply_types")
    .select("id, name")
    .eq("tenant_id", version.tenant_id)
    .order("name", { ascending: true });

  if (supplyTypesResult.error) {
    notFound();
  }

  ((supplyTypesResult.data ?? []) as SupplyTypeLabel[]).forEach((supplyType) => {
    supplyTypeLabelsById[supplyType.id] = supplyType.name;
  });

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
  const baseTotals = computeEstimateTotals({
    lineItems: lineItemsForTotals,
    marginMultiplier: version.margin_multiplier,
    marginMode: version.margin_mode,
    discountCents: 0,
    discountMode: version.discount_mode,
    discountStepsBp: version.discount_steps,
    globalCoefficient: version.global_coefficient,
    taxRateBp: version.tax_rate_bp,
    roundingMode: version.rounding_mode,
    roundingStepCents: version.rounding_step_cents,
  });
  const fallbackDiscountCents =
    baseTotals.saleSubtotalCents > 0
      ? Math.round((baseTotals.saleSubtotalCents * version.discount_bp) / 10000)
      : 0;
  const computedTotals = computeEstimateTotals({
    lineItems: lineItemsForTotals,
    marginMultiplier: version.margin_multiplier,
    marginMode: version.margin_mode,
    discountCents: fallbackDiscountCents,
    discountMode: version.discount_mode,
    discountStepsBp: version.discount_steps,
    globalCoefficient: version.global_coefficient,
    taxRateBp: version.tax_rate_bp,
    roundingMode: version.rounding_mode,
    roundingStepCents: version.rounding_step_cents,
  });
  const discountCents = computedTotals.discountCents;
  const appliedMarginMultiplier = computedTotals.appliedMarginMultiplier;
  const totalHtCents = Number.isFinite(version.total_ht_cents ?? NaN)
    ? version.total_ht_cents
    : computedTotals.saleTotalCents;
  const totalTaxCents = Number.isFinite(version.total_tax_cents ?? NaN)
    ? version.total_tax_cents
    : computedTotals.adjustedTaxCents;
  const totalTtcCents = Number.isFinite(version.total_ttc_cents ?? NaN)
    ? version.total_ttc_cents
    : computedTotals.roundedTtcCents;

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
        error,
      });
      sealState = "error";
    }
  }

  return (
    <div className="min-h-screen bg-[var(--slate-100)] animate-fade-in">
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Chiffrage</h1>
          <p className="page-description">
            Version <span className="font-mono text-[var(--slate-600)]">{versionId}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SealIntegrityBadge state={sealState} hashPrefix={sealHashPrefix} />
          <Link className="btn btn-secondary btn-sm" href="/dashboard/estimates">
            Retour
          </Link>
          <Link
            className="btn btn-secondary btn-sm"
            href={`/dashboard/estimates/${versionId}/edit`}
          >
            Editer
          </Link>
          <Link
            className="btn btn-secondary btn-sm"
            href={`/dashboard/estimates/${versionId}/diff`}
          >
            Comparer
          </Link>
          <SaveAsTemplateButton versionId={versionId} />
          <DuplicateEstimateButton versionId={versionId} />
          <Link
            className="btn btn-primary btn-sm"
            href={`/dashboard/estimates/${versionId}/print`}
          >
            Imprimer
          </Link>
          <EstimatePdfDownloadButton versionId={versionId} />
        </div>
      </div>

      <div className="py-8">
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <EstimateTimeline
            currentVersionId={versionId}
            versions={versionTimeline.items}
            pagination={versionTimeline.pagination}
          />
          <EstimateDocument
            projectName={project?.name ?? "Projet"}
            projectClient={project?.client_name}
            projectReference={project?.reference}
            versionNumber={version.version_number}
            dateDevis={version.date_devis}
            validiteJours={version.validite_jours}
            marginMultiplier={appliedMarginMultiplier}
            discountCents={discountCents}
            taxRateBp={version.tax_rate_bp}
            isLaborSplitEnabled={isLaborSplitEnabled}
            laborRateById={laborRateById}
            totalHtCents={totalHtCents}
            totalTaxCents={totalTaxCents}
            totalTtcCents={totalTtcCents}
            supplyTypeLabelsById={supplyTypeLabelsById}
            items={items}
          />
        </div>
        <div className="mt-6">
          <VariantComparisonTable
            currentVersionId={versionId}
            baseVersionId={variantComparison.base_version_id}
            items={variantComparison.items}
          />
        </div>
      </div>
    </div>
  );
}
