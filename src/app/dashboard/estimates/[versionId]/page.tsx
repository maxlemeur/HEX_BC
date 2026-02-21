import Link from "next/link";
import { notFound } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { DuplicateEstimateButton } from "@/components/estimates/DuplicateEstimateButton";
import { SaveAsTemplateButton } from "@/components/estimates/SaveAsTemplateButton";
import {
  SealIntegrityBadge,
  type SealIntegrityState,
} from "@/components/estimates/SealIntegrityBadge";
import { computeEstimateTotals } from "@/lib/estimate-calculations";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { verifyEstimateSeal } from "@/lib/estimates/server";
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

function resolveProject(
  value: EstimateVersion["estimate_projects"]
) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function EstimateDetailPage({
  params,
}: Readonly<{ params: Promise<{ versionId: string }> }>) {
  const { versionId } = await params;
  const supabase = await createSupabaseServerClient();

  const versionPromise = supabase
    .from("estimate_versions")
    .select(
      "tenant_id, version_number, status, seal_hash, title, date_devis, validite_jours, margin_multiplier, margin_mode, discount_bp, tax_rate_bp, rounding_mode, rounding_step_cents, total_ht_cents, total_tax_cents, total_ttc_cents, estimate_projects ( name, reference, client_name )"
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

  const saleSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);
  const discountCents = Math.round(
    (saleSubtotalCents * version.discount_bp) / 10000
  );
  const lineItems = items
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
  const appliedMarginMultiplier = computeEstimateTotals({
    lineItems,
    marginMultiplier: version.margin_multiplier,
    marginMode: version.margin_mode,
    discountCents,
    taxRateBp: version.tax_rate_bp,
    roundingMode: version.rounding_mode,
    roundingStepCents: version.rounding_step_cents,
  }).appliedMarginMultiplier;

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
          <SaveAsTemplateButton versionId={versionId} />
          <DuplicateEstimateButton versionId={versionId} />
          <Link
            className="btn btn-primary btn-sm"
            href={`/dashboard/estimates/${versionId}/print`}
          >
            Imprimer
          </Link>
        </div>
      </div>

      <div className="py-8">
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
          totalHtCents={version.total_ht_cents}
          totalTaxCents={version.total_tax_cents}
          totalTtcCents={version.total_ttc_cents}
          supplyTypeLabelsById={supplyTypeLabelsById}
          items={items}
        />
      </div>
    </div>
  );
}
