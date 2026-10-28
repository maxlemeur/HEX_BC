import "server-only";
import { render } from "@react-email/components";
import type { getAuthenticatedTenantContext } from "@/lib/auth/tenant-context";
import { EstimateEmailTemplate } from "@/lib/email/templates/estimate";
import type { EstimateEmailDispatch } from "@/lib/email/estimate-email-dispatch-contracts";
import { canonicalJsonHash } from "@/lib/email/estimate-email-hash";
import { conflict, internalError } from "@/lib/estimates/errors";
import { generateEstimatePdfNow } from "@/lib/estimates/pdf-generator";
import { loadVerifiedOfferDocument, type VerifiedOfferDocument } from "@/lib/estimates/offer-document";
import { sanitizeEstimateFilename } from "@/lib/estimates/reference";
import { formatCurrency, normalizeEstimateCurrency } from "@/lib/money";
import { ESTIMATE_DOCUMENTS_BUCKET } from "@/lib/storage/buckets";

export async function loadPdfBuffer(
  dispatch: Pick<EstimateEmailDispatch, "document_path">,
  supabase: Awaited<ReturnType<typeof getAuthenticatedTenantContext>>["supabase"]
) {
  if (!dispatch.document_path) {
    throw internalError("Chemin du PDF fige manquant.");
  }

  const { data, error } = await supabase.storage
    .from(ESTIMATE_DOCUMENTS_BUCKET)
    .download(dispatch.document_path);

  if (error || !data) {
    throw internalError(
      "Impossible de récupérer le PDF du devis pour l'email.",
      error
    );
  }

  return Buffer.from(await data.arrayBuffer());
}

async function renderFrozenEmail(input: {
  projectName: string;
  versionNumber: number;
  totalTtcFormatted: string;
  portalUrl: string;
  message: string;
  companyName: string;
  historicalCopy?: boolean;
}) {
  const template = EstimateEmailTemplate({
    ...input,
  });
  const [htmlBody, textBody] = await Promise.all([
    render(template),
    render(template, { plainText: true }),
  ]);
  return { htmlBody, textBody };
}

export async function preparePdfForDispatch(input: {
  versionId: string;
  versionStatus: string;
  dispatchId: string;
  supabase: Awaited<ReturnType<typeof getAuthenticatedTenantContext>>["supabase"];
  tenantId: string;
}) {
  const preparingNew = ["draft", "sending"].includes(input.versionStatus);
  if (preparingNew) {
    await generateEstimatePdfNow(input.versionId, {
      force: true,
      triggeredBy: "send",
      dispatchId: input.dispatchId,
    });
  }
  return loadVerifiedOfferDocument({ supabase: input.supabase, tenantId: input.tenantId,
    versionId: input.versionId, requireSealed: !preparingNew });
}

export async function renderEstimateDispatchDocument(dispatch: EstimateEmailDispatch, preparedPdf: VerifiedOfferDocument) {
  const captured = preparedPdf.proof.clientContractSnapshot;
  const projectName = captured?.project.name ?? "Devis émis";
  const currency = normalizeEstimateCurrency(captured?.version.currency ?? preparedPdf.version.currency) ?? "EUR";
  const totalTtcFormatted = formatCurrency(
    captured?.totals.payableTtcCents ?? preparedPdf.version.total_ttc_cents,
    currency
  );
  const portalUrl = dispatch.portal_url;
  if (dispatch.request_contract_version !== 2 || !portalUrl) {
    throw conflict("Cette ancienne préparation nécessite une reprise contrôlée.", undefined, "ESTIMATE_EMAIL_LEGACY_PREPARATION_REQUIRES_RECOVERY");
  }
  const { htmlBody, textBody } = await renderFrozenEmail({
    projectName,
    versionNumber: captured?.version.number ?? preparedPdf.version.version_number,
    totalTtcFormatted,
    portalUrl,
    message: dispatch.body ?? "",
    companyName: captured?.company.name ?? "Votre interlocuteur",
    historicalCopy: captured === null,
  });
  // Client1 stores the complete reference, including Vn exactly once.
  const attachmentFilename = `${sanitizeEstimateFilename(captured?.project.estimateReference ?? projectName) || "devis"}.pdf`;
  const providerPayloadHash = canonicalJsonHash({
    contract: "resend-estimate-email-v1",
    from: dispatch.from_address,
    to: dispatch.recipient,
    cc: dispatch.cc ?? [],
    subject: dispatch.subject,
    htmlBody,
    textBody,
    attachmentFilename,
    documentSha256: preparedPdf.proof.sha256Hash,
  });

  return { htmlBody, textBody, attachmentFilename, providerPayloadHash };
}
