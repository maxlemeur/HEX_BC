import type { SupabaseClient } from "@supabase/supabase-js";

import { EstimateDocument } from "@/components/EstimateDocument";
import { PageHeader } from "@/components/layout/page-header";
import { PrintTitle } from "@/components/PrintTitle";
import { SealIntegrityBadge, type SealIntegrityState } from "@/components/estimates/SealIntegrityBadge";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { ApiError } from "@/lib/estimates/errors";
import { toSafeEstimateErrorLogDetails } from "@/lib/estimates/logging";
import { describeEstimatePdfLayout, type EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import type { EstimateTermsSnapshot } from "@/lib/estimates/pdf-terms";
import { formatEstimateReference } from "@/lib/estimates/reference";
import { verifyEstimateSeal } from "@/lib/estimates/server";
import { loadEstimateV3DocumentSource, type EstimateV3DocumentSource } from "@/lib/estimates/v3-document-server";
import { normalizeEstimateCurrency } from "@/lib/money";
import type { Database } from "@/types/database";

import { EstimatePrintLayoutButton } from "./EstimatePrintLayoutButton";

/**
 * Lot 2, sous-lot 2.7 - aperçu d'impression du document client d'une v3 (conception D7, D8, D14 ;
 * §14 « 2.7 ») : lignes brutes, unité du référentiel, statut, pied v3 et TVA par taux, lus comme
 * le PDF et le portail (`loadEstimateV3DocumentSource` : gel stocké, ou aperçu du moteur pur pour
 * un brouillon modifié depuis son gel). Un aperçu impossible (rôle de MO manquant…) est dit, pas
 * imprimé avec des montants faux.
 */

type PrintProject = {
  name: string;
  reference: string | null;
  estimate_reference: string | null;
  site_address: string | null;
  client_name: string | null;
};

type EstimateV3PrintPageProps = {
  supabase: SupabaseClient<Database>;
  tenantId: string;
  versionId: string;
  project: PrintProject | null;
  issuer: { name?: string | null; role?: string | null; phone?: string | null; email?: string | null };
  previewLayout: { layout: EstimatePdfLayoutOptions; terms: EstimateTermsSnapshot | null };
  autoPrint: boolean;
  portalUrl: string | null;
};

function printTitleOf(version: EstimateV3DocumentSource["version"], project: PrintProject | null): string {
  const raw = formatEstimateReference(project?.estimate_reference, version.version_number)
    ?? [project?.name ?? "devis", `V${version.version_number}`, version.date_devis].filter(Boolean).join("_");
  return raw.trim().replace(/\s+/g, "_").replace(/[\\/:*?"<>|]+/g, "-").replace(/_{2,}/g, "_")
    .replace(/-+/g, "-").replace(/^[_-]+|[_-]+$/g, "");
}

async function sealStateOf(version: EstimateV3DocumentSource["version"]): Promise<{ state: SealIntegrityState; prefix: string | null }> {
  if (version.status === "draft" || !version.seal_hash) return { state: "unsealed", prefix: version.seal_hash?.slice(0, 8) ?? null };
  try {
    const verification = await verifyEstimateSeal(version.id);
    return { state: verification.valid ? "valid" : "invalid", prefix: verification.stored_hash?.slice(0, 8) ?? version.seal_hash.slice(0, 8) };
  } catch (error) {
    console.error("Failed to verify estimate seal for print", { versionId: version.id, ...toSafeEstimateErrorLogDetails(error) });
    return { state: "error", prefix: version.seal_hash.slice(0, 8) };
  }
}

export async function EstimateV3PrintPage({
  supabase,
  tenantId,
  versionId,
  project,
  issuer,
  previewLayout,
  autoPrint,
  portalUrl,
}: Readonly<EstimateV3PrintPageProps>) {
  let source: EstimateV3DocumentSource | null = null;
  let unavailable: string | null = null;
  try {
    source = await loadEstimateV3DocumentSource({ supabase, tenantId, versionId });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 400) throw error;
    unavailable = error.message;
  }
  if (!source) {
    return (
      <Alert variant="warning" className="mx-auto my-8 max-w-5xl">
        <AlertTitle>Le document client de ce devis ne peut pas être préparé : {unavailable}</AlertTitle>
      </Alert>
    );
  }
  const { version, items } = source;
  const seal = await sealStateOf(version);
  const currency = normalizeEstimateCurrency(version.currency) ?? "EUR";
  return (
    <div className="min-h-screen print:bg-surface">
      <PrintTitle title={printTitleOf(version, project)} />
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
              <span className="font-medium text-foreground-secondary">Devis V{version.version_number}</span>
              <SealIntegrityBadge state={seal.state} hashPrefix={seal.prefix} />
              <span className="text-muted-foreground">Configuration : {describeEstimatePdfLayout(previewLayout.layout)}</span>
            </>
          }
          actions={<EstimatePrintLayoutButton versionId={versionId} initialLayout={previewLayout.layout} autoPrint={autoPrint} />}
        />
      </div>

      <div className="py-8 print:py-0">
        <EstimateDocument
          v3Version={version}
          projectName={project?.name ?? "Projet"}
          projectSiteAddress={project?.site_address}
          projectClient={project?.client_name}
          projectReference={project?.reference}
          estimateReference={project?.estimate_reference}
          portalUrl={portalUrl}
          versionNumber={version.version_number}
          dateDevis={version.date_devis}
          validiteJours={version.validite_jours}
          marginMultiplier={1}
          discountCents={version.discount_applied_cents ?? 0}
          taxRateBp={version.tax_rate_bp}
          currency={currency}
          isLaborSplitEnabled={false}
          laborRateById={{}}
          totalHtCents={version.total_ht_cents}
          totalTaxCents={version.total_tax_cents}
          totalTtcCents={version.total_ttc_cents}
          vatReverseCharge={version.contractor_role === "subcontractor"}
          items={items}
          exclusions={version.exclusions}
          issuerName={issuer.name}
          issuerRole={issuer.role}
          issuerPhone={issuer.phone}
          issuerEmail={issuer.email}
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
