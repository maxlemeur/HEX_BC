import Link from "next/link";
import { notFound } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { DuplicateEstimateButton } from "@/components/estimates/DuplicateEstimateButton";
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
      "version_number, status, title, date_devis, validite_jours, margin_multiplier, discount_bp, tax_rate_bp, total_ht_cents, total_tax_cents, total_ttc_cents, estimate_projects ( name, reference, client_name )"
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
  const saleSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);
  const discountCents = Math.round(
    (saleSubtotalCents * version.discount_bp) / 10000
  );

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
          <Link className="btn btn-secondary btn-sm" href="/dashboard/estimates">
            Retour
          </Link>
          <Link
            className="btn btn-secondary btn-sm"
            href={`/dashboard/estimates/${versionId}/edit`}
          >
            Editer
          </Link>
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
          marginMultiplier={version.margin_multiplier}
          discountCents={discountCents}
          taxRateBp={version.tax_rate_bp}
          totalHtCents={version.total_ht_cents}
          totalTaxCents={version.total_tax_cents}
          totalTtcCents={version.total_ttc_cents}
          items={items}
        />
      </div>
    </div>
  );
}
