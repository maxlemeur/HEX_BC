import Link from "next/link";
import { notFound } from "next/navigation";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PrintButton } from "@/components/PrintButton";
import { PrintTitle } from "@/components/PrintTitle";
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

function resolveProject(
  value: EstimateVersion["estimate_projects"]
) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

export default async function PrintEstimatePage({
  params,
}: Readonly<{ params: { versionId: string } }>) {
  const { versionId } = params;
  const supabase = await createSupabaseServerClient();

  const versionPromise = supabase
    .from("estimate_versions")
    .select(
      "version_number, date_devis, validite_jours, margin_multiplier, discount_bp, tax_rate_bp, total_ht_cents, total_tax_cents, total_ttc_cents, estimate_projects ( name, reference, client_name )"
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
  const project = resolveProject(version.estimate_projects);

  const saleSubtotalCents = items.reduce((sum, item) => {
    if (item.item_type !== "line") return sum;
    return sum + (item.line_total_ht_cents ?? 0);
  }, 0);
  const discountCents = Math.round(
    (saleSubtotalCents * version.discount_bp) / 10000
  );

  const rawTitle = [
    project?.name ?? "devis",
    `V${version.version_number}`,
    formatPrintDate(version.date_devis),
  ]
    .filter(Boolean)
    .join("_");
  const printTitle = sanitizeFilename(rawTitle);

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
          </div>
          <PrintButton />
        </div>
      </div>

      <div className="py-8 print:py-0">
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
