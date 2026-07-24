import { notFound, redirect } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PortalActions } from "@/components/portal/PortalActions";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { computeEstimateTotals } from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import { loadMarginTiersForTotals } from "@/lib/estimates/margin-tiers-loader";
import { formatEstimateReference } from "@/lib/estimates/reference";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { Database } from "@/types/database";
import type { PortalTokenStatus } from "@/types/portal";

type EstimateProject =
  Database["public"]["Tables"]["estimate_projects"]["Row"];
type EstimateVersion =
  Database["public"]["Tables"]["estimate_versions"]["Row"] & {
    estimate_projects:
      | Pick<EstimateProject, "name" | "reference" | "estimate_reference" | "client_name">
      | Pick<EstimateProject, "name" | "reference" | "estimate_reference" | "client_name">[]
      | null;
  };
type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type LaborRoleRate = Pick<
  Database["public"]["Tables"]["labor_roles"]["Row"],
  "id" | "hourly_rate_cents"
>;

type PortalPageProps = {
  params?: Promise<{ token: string }>;
};

function resolveProject(value: EstimateVersion["estimate_projects"]) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function PortalPage({ params }: PortalPageProps) {
  if (!params) notFound();
  const { token } = await params;

  const supabase = createServiceRoleClient();

  // 1. Lookup portal token
  const { data: portalToken, error: tokenError } = await supabase
    .from("portal_tokens")
    .select("id, tenant_id, version_id, status, expires_at, email")
    .eq("token", token)
    .single();

  if (tokenError || !portalToken) {
    notFound();
  }

  // 2. Determine effective status (check expiry)
  const isExpired = new Date(portalToken.expires_at) < new Date();
  if (portalToken.status === "expired" || isExpired) {
    if (isExpired && portalToken.status === "pending") {
      await supabase
        .from("portal_tokens")
        .update({ status: "expired" })
        .eq("id", portalToken.id);
    }

    redirect(`/portal/${token}/expired`);
  }

  const effectiveStatus = portalToken.status as PortalTokenStatus;

  // 3. Load estimate version + items
  const versionId = portalToken.version_id;

  const [versionResult, itemsResult] = await Promise.all([
    supabase
      .from("estimate_versions")
      .select(
        "project_id, tenant_id, version_number, status, date_devis, validite_jours, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, total_ht_cents, total_tax_cents, total_ttc_cents, currency, estimate_projects ( name, reference, estimate_reference, client_name )"
      )
      .eq("id", versionId)
      .eq("tenant_id", portalToken.tenant_id)
      .single(),
    supabase
      .from("estimate_items")
      .select("*")
      .eq("version_id", versionId)
      .eq("tenant_id", portalToken.tenant_id)
      .order("position", { ascending: true }),
  ]);

  if (
    versionResult.error ||
    !versionResult.data ||
    itemsResult.error ||
    !itemsResult.data
  ) {
    notFound();
  }

  const version = versionResult.data as EstimateVersion;
  const items = itemsResult.data as EstimateItem[];
  const selectedCurrency = normalizeEstimateCurrency(version.currency) ?? "EUR";
  const project = resolveProject(version.estimate_projects);

  // 4. Resolve labor rates
  const isLaborSplitEnabled = await isFeatureEnabled(
    version.tenant_id,
    "EST_031_LABOR_SPLIT",
    { supabase }
  );

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

  if (laborRoleIds.length > 0) {
    const laborRolesResult = await supabase
      .from("labor_roles")
      .select("id, hourly_rate_cents")
      .in("id", laborRoleIds);

    if (!laborRolesResult.error) {
      ((laborRolesResult.data ?? []) as LaborRoleRate[]).forEach((role) => {
        laborRateById[role.id] = role.hourly_rate_cents ?? 0;
      });
    }
  }

  // 5. Compute totals (same logic as print page)
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
  const marginTiers =
    version.margin_mode === "tiered"
      ? await loadMarginTiersForTotals({ supabase, tenantId: version.tenant_id })
      : [];

  const baseTotals = computeEstimateTotals({
    lineItems: lineItemsForTotals,
    marginMultiplier: version.margin_multiplier,
    marginMode: version.margin_mode,
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
    baseTotals.saleSubtotalCents > 0
      ? Math.round(
          (baseTotals.saleSubtotalCents * version.discount_bp) / 10000
        )
      : 0;

  const computedTotals = computeEstimateTotals({
    lineItems: lineItemsForTotals,
    marginMultiplier: version.margin_multiplier,
    marginMode: version.margin_mode,
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

  const totalTtcFormatted = formatCurrency(totalTtcCents, selectedCurrency);
  const estimateReference = formatEstimateReference(
    project?.estimate_reference,
    version.version_number
  );

  return (
    <div className="space-y-6">
      <PortalHeader
        projectName={project?.name ?? "Devis"}
        projectReference={estimateReference}
        versionNumber={version.version_number}
        totalTtcCents={totalTtcCents}
        currency={selectedCurrency}
        expiresAt={portalToken.expires_at}
        status={effectiveStatus}
      />

      <div className="print:py-0">
        <EstimateDocument
          calcEngineVersion={resolveCalcEngineVersion(version)}
          projectName={project?.name ?? "Devis"}
          projectClient={project?.client_name}
          projectReference={project?.reference}
          estimateReference={project?.estimate_reference}
          versionNumber={version.version_number}
          dateDevis={version.date_devis}
          validiteJours={version.validite_jours}
          marginMultiplier={appliedMarginMultiplier}
          discountCents={discountCents}
          taxRateBp={version.tax_rate_bp}
          currency={selectedCurrency}
          isLaborSplitEnabled={isLaborSplitEnabled}
          laborRateById={laborRateById}
          totalHtCents={totalHtCents}
          totalTaxCents={totalTaxCents}
          totalTtcCents={totalTtcCents}
          items={items}
        />
      </div>

      <PortalActions
        token={token}
        status={effectiveStatus}
        totalTtcFormatted={totalTtcFormatted}
        projectReference={estimateReference}
      />
    </div>
  );
}
