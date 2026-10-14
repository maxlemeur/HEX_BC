import { notFound, redirect } from "next/navigation";

import { CommercialEstimateDocument } from "@/components/estimate-document/CommercialEstimateDocument";
import { PortalActions } from "@/components/portal/PortalActions";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { lookupPortalCapability, loadPortalOffer } from "@/lib/estimates/portal-offer";
import { canUseDevelopmentEstimateTerms } from "@/lib/estimates/pdf-terms-server";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { ESTIMATE_DOCUMENTS_BUCKET } from "@/lib/storage/buckets";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { PortalTokenStatus } from "@/types/portal";

type PortalPageProps = { params?: Promise<{ token: string }> };

export default async function PortalPage({ params }: PortalPageProps) {
  if (!params) notFound();
  const { token } = await params;
  const supabase = createServiceRoleClient();
  const capability = await lookupPortalCapability({ supabase, token });
  if (!capability) notFound();
  if (capability.status === "expired" || capability.expired) {
    redirect(`/portal/${token}/expired`);
  }
  const offer = await loadPortalOffer({ supabase, token, capability }).catch(() => null);
  if (!offer) notFound();
  const captured = offer.proof.clientContractSnapshot;
  const projectName = captured?.project.name ?? "Devis émis";
  const reference = captured?.project.estimateReference ?? null;
  const versionNumber = captured?.version.number ?? offer.version.version_number;
  const currency = normalizeEstimateCurrency(captured?.version.currency ?? offer.version.currency) ?? "EUR";
  const totalHtCents = captured?.totals.saleHtCents ?? offer.version.total_ht_cents;
  const totalTtcCents = captured?.totals.payableTtcCents ?? offer.version.total_ttc_cents;
  const vatReverseCharge = (captured?.version.contractorRole ?? offer.version.contractor_role) === "subcontractor";
  const status = capability.status as PortalTokenStatus;
  const { data: download, error } = await supabase.storage.from(ESTIMATE_DOCUMENTS_BUCKET)
    .createSignedUrl(offer.proof.filePath, 300);
  if (error || !download?.signedUrl) notFound();
  return (
    <div className="space-y-6">
      <PortalHeader projectName={projectName} projectReference={reference} versionNumber={versionNumber}
        totalHtCents={totalHtCents} totalTtcCents={totalTtcCents} vatReverseCharge={vatReverseCharge}
        currency={currency} expiresAt={capability.expires_at} status={status} />
      <p>
        <a href={download.signedUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-blue underline">
          Télécharger le PDF original du devis
        </a>
      </p>
      {captured ? (
        <div role="region" aria-label="Document du devis" tabIndex={0}
          className="relative overflow-x-auto rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring print:overflow-visible print:py-0">
          <CommercialEstimateDocument contract={captured} layout={offer.proof.layoutOptions}
            terms={offer.proof.termsSnapshot} allowDevelopmentTerms={canUseDevelopmentEstimateTerms()} />
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface p-6">
          <p>Cette ancienne offre est conservée dans son PDF original. Consultez ce document et ses conditions avant de répondre.</p>
        </div>
      )}
      <PortalActions token={token} status={status} totalTtcFormatted={formatCurrency(totalTtcCents, currency)} projectReference={reference} />
    </div>
  );
}
