import Link from "next/link";
import { notFound } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PrintButton } from "@/components/PrintButton";
import { PrintTitle } from "@/components/PrintTitle";
import {
  SealIntegrityBadge,
  type SealIntegrityState,
} from "@/components/estimates/SealIntegrityBadge";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { computeEstimateTotals } from "@/lib/estimate-calculations";
import { verifyEstimateSeal } from "@/lib/estimates/server";
import { normalizeEstimateCurrency } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

import { PrintCurrencySelect } from "./PrintCurrencySelect";

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
type PrintPageProps = {
  params?: Promise<{ versionId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

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
  const supabase = await createSupabaseServerClient();

  const versionPromise = supabase
    .from("estimate_versions")
    .select(
      "tenant_id, version_number, status, seal_hash, date_devis, validite_jours, margin_multiplier, margin_mode, discount_bp, discount_mode, discount_steps, global_coefficient, tax_rate_bp, rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents, currency, estimate_projects ( name, reference, client_name )"
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
  const query = (searchParams ? await searchParams : {}) ?? {};
  const queryCurrencyRaw = query.currency;
  const queryCurrencyValue = Array.isArray(queryCurrencyRaw)
    ? queryCurrencyRaw[0]
    : queryCurrencyRaw;
  const selectedCurrency =
    normalizeEstimateCurrency(queryCurrencyValue) ??
    normalizeEstimateCurrency(version.currency) ??
    "EUR";
  const project = resolveProject(version.estimate_projects);
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
      console.error("Failed to verify estimate seal for print", {
        versionId,
        error,
      });
      sealState = "error";
    }
  }

  const rawTitle = [
    project?.name ?? "devis",
    `V${version.version_number}`,
    formatPrintDate(version.date_devis),
  ]
    .filter(Boolean)
    .join("_");
  const printTitle = sanitizeFilename(rawTitle);
  const estimatePortalUrl = resolveEstimatePortalUrl(versionId);

  return (
    <div className="min-h-screen bg-[var(--slate-100)] print:bg-white">
      <PrintTitle title={printTitle} />
      <div className="no-print sticky top-0 z-10 border-b border-[var(--slate-200)] bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-4">
            <Link
              className="btn btn-ghost btn-sm"
              href={`/dashboard/estimates/${versionId}`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="m15 18-6-6 6-6" />
              </svg>
              Retour
            </Link>
            <div className="hidden h-6 w-px bg-[var(--slate-200)] sm:block" />
            <span className="hidden text-sm font-semibold text-[var(--slate-700)] sm:block">
              Apercu avant impression
            </span>
            <span className="hidden rounded-lg bg-[var(--brand-orange)]/10 px-2.5 py-1 font-mono text-sm font-bold text-[var(--brand-orange)] sm:inline-block">
              {project?.reference ?? `V${version.version_number}`}
            </span>
            <SealIntegrityBadge state={sealState} hashPrefix={sealHashPrefix} />
          </div>
          <div className="flex items-center gap-3">
            <PrintCurrencySelect currency={selectedCurrency} />
            <PrintButton />
          </div>
        </div>
      </div>

      <div className="py-8 print:py-0">
        <EstimateDocument
          projectName={project?.name ?? "Projet"}
          projectClient={project?.client_name}
          projectReference={project?.reference}
          portalUrl={estimatePortalUrl}
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
          supplyTypeLabelsById={supplyTypeLabelsById}
          items={items}
        />
      </div>
      <div className="print-page-footer" aria-hidden>
        <span className="print-page-counter" />
      </div>
    </div>
  );
}
