import { notFound, redirect } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PortalActions } from "@/components/portal/PortalActions";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { computeEstimateTotals } from "@/lib/estimate-calculations";
import { resolveCalcEngineVersion } from "@/lib/estimates/calc-engine-version";
import {
  loadMarginTiersForTotals,
  resolveRenderMarginMode,
} from "@/lib/estimates/margin-tiers-loader";
import { formatEstimateReference } from "@/lib/estimates/reference";
import {
  normalizeEstimatePdfLayoutOptions,
  type EstimatePdfLayoutOptions,
} from "@/lib/estimates/pdf-layout";
import {
  canUseEstimateTermsSnapshot,
  parseEstimateTermsSnapshot,
} from "@/lib/estimates/pdf-terms";
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
      | Pick<EstimateProject, "name" | "reference" | "estimate_reference" | "client_name" | "user_id">
      | Pick<EstimateProject, "name" | "reference" | "estimate_reference" | "client_name" | "user_id">[]
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

  const [versionResult, itemsResult, documentResult] = await Promise.all([
    supabase
      .from("estimate_versions")
      .select(
        "project_id, tenant_id, version_number, status, date_devis, validite_jours, exclusions, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, calc_engine_version, contractor_role, total_ht_cents, total_tax_cents, total_ttc_cents, currency, estimate_projects ( name, reference, estimate_reference, client_name, user_id )"
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
    // UX-D : le portail lit le document STOCKE — la mise en page et les CGV qui
    // ont servi au PDF envoye par email. Le client voit donc exactement ce
    // qu il a recu, et la parite est garantie par construction plutot que par
    // deux chemins a tenir synchronises.
    supabase
      .from("estimate_documents")
      .select("layout_options, terms_snapshot")
      .eq("version_id", versionId)
      .eq("tenant_id", portalToken.tenant_id)
      .maybeSingle(),
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

  // UX-D : mise en page et CGV reprises du document STOCKE, celui qui a servi au
  // PDF envoye par email. Le portail cessait de les transmettre, si bien que le
  // client cochait « J'accepte ce devis et ses conditions » sur une page qui ne
  // les affichait jamais — et pouvait voir une mise en page differente de celle
  // qu'il avait recue.
  const storedLayout = normalizeEstimatePdfLayoutOptions(
    (documentResult.data?.layout_options ?? undefined) as
      | EstimatePdfLayoutOptions
      | undefined
  );
  const storedTerms = parseEstimateTermsSnapshot(
    documentResult.data?.terms_snapshot ?? null
  );
  const portalTerms =
    storedLayout.includeTerms &&
    storedTerms &&
    canUseEstimateTermsSnapshot(storedTerms)
      ? storedTerms
      : null;

  // L'emetteur : le portail n'a pas d'utilisateur connecte, on lit donc le
  // profil du proprietaire de l'affaire — la meme source que le PDF.
  const issuerProfileResult = project?.user_id
    ? await supabase
        .from("profiles")
        .select("full_name, job_title, phone, work_email")
        .eq("id", project.user_id)
        .maybeSingle()
    : null;
  const issuerProfile = issuerProfileResult?.data ?? null;

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
  // Hors brouillon, le mode est figé sur "fixed" : un devis transmis affiche
  // la marge qu'il a persistée, pas le barème du jour (cf. resolveRenderMarginMode).
  const renderMarginMode = resolveRenderMarginMode(
    version.status,
    version.margin_mode
  );
  const marginTiers =
    renderMarginMode === "tiered"
      ? await loadMarginTiersForTotals({ supabase, tenantId: version.tenant_id })
      : [];

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
    baseTotals.saleSubtotalCents > 0
      ? Math.round(
          (baseTotals.saleSubtotalCents * version.discount_bp) / 10000
        )
      : 0;

  const computedTotals = computeEstimateTotals({
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
          vatReverseCharge={version.contractor_role === "subcontractor"}
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
          exclusions={version.exclusions}
          issuerName={issuerProfile?.full_name}
          issuerRole={issuerProfile?.job_title}
          issuerPhone={issuerProfile?.phone}
          issuerEmail={issuerProfile?.work_email}
          layout={storedLayout}
          terms={portalTerms}
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
