import { createHash } from "node:crypto";

import type { ServerSupabaseClient } from "@/lib/auth/tenant-context";
import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { isUnifiedEngine, requireHistoricalEngine, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { internalError, mapSupabaseError } from "@/lib/estimates/errors";
import { assertEstimateVersionUnchanged, readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { canUseDevelopmentEstimateTerms } from "@/lib/estimates/pdf-terms-server";
import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
  ENGINE_V3_ESTIMATE_SEAL_PAYLOAD_VERSION,
  type EstimateSealVersionFields,
} from "@/lib/estimates/estimate-seal";
import {
  computeOfferSealHash,
  parseOfferDocumentProof,
  type ClientContract1,
  type DocumentProof1,
} from "@/lib/estimates/offer-contract";
import { computeOfferSealHashV2, type ClientContract2 } from "@/lib/estimates/offer-contract-v2";
import { ESTIMATE_DOCUMENTS_BUCKET } from "@/lib/storage/buckets";
import type { Database } from "@/types/database";

type Version = EstimateSealVersionFields & {
  content_revision: number;
  seal_payload_version: number | null;
  status: string;
  updated_at: string;
};
type StoredDocument = Database["public"]["Tables"]["estimate_documents"]["Row"] & {
  client_contract_version: number | null;
  client_contract_snapshot: unknown;
};

export type VerifiedOfferDocument = {
  proof: DocumentProof1;
  buffer: Buffer;
  sealHash: string;
  sealPayloadVersion: 1 | 2 | 3 | 4 | 5;
  /**
   * Charge de calcul réellement hachée : 4 (contrat 1) ou 6 (contrat 2, moteur 3) sous le
   * marqueur 5, sinon la charge historique retrouvée (1 à 4).
   */
  calculationPayloadVersion: 1 | 2 | 3 | 4 | 6;
  version: Version;
};

/** Copie au contrat 1 contre la version stockée (moteurs 1 et 2) : inchangé. */
function contract1MatchesVersion(captured: ClientContract1, version: Version): boolean {
  return !(captured.version.number !== version.version_number || captured.version.dateDevis !== version.date_devis
    || captured.version.validiteJours !== version.validite_jours || captured.version.currency !== version.currency
    || captured.version.calcEngineVersion !== version.calc_engine_version
    || captured.version.contractorRole !== version.contractor_role || captured.version.taxRateBp !== version.tax_rate_bp
    || captured.exclusions !== version.exclusions || captured.totals.saleHtCents !== version.total_ht_cents
    || captured.totals.payableTtcCents !== version.total_ttc_cents
    || captured.totals.roundingAdjustmentCents !== version.rounding_adjustment_cents
    || captured.totals.taxCents !== version.total_tax_cents - version.rounding_adjustment_cents);
}

type FrozenTaxRow = { rate_bp?: unknown; base_cents?: unknown; tax_cents?: unknown };

/**
 * Lot 2, sous-lot 2.7 (D14) : copie au contrat 2 contre la v3 stockée. Le moteur de la version
 * est 3, le pied est celui du gel (brut, remise et arrondi appliqués, HT net, TVA, TTC, ajustement
 * nul), le récapitulatif par taux est celui du contexte figé et l'intention de remise celle de la
 * version (jamais dérivée). La correspondance ligne à ligne est prouvée en SQL à la publication.
 */
function contract2MatchesVersion(captured: ClientContract2, version: Version): boolean {
  const totals = captured.totals;
  const context = version.calc_snapshot_context as { tax_breakdown?: unknown } | null;
  const frozenRates = Array.isArray(context?.tax_breakdown) ? (context.tax_breakdown as FrozenTaxRow[]) : null;
  const intent = version.discount_amount_cents !== null && version.discount_amount_cents !== undefined
    ? "amount" : version.discount_bp > 0 ? "rate" : "none";
  return captured.version.calcEngineVersion === version.calc_engine_version
    && captured.version.number === version.version_number && captured.version.dateDevis === version.date_devis
    && captured.version.validiteJours === version.validite_jours && captured.version.currency === version.currency
    && captured.version.contractorRole === version.contractor_role && captured.version.taxRateBp === version.tax_rate_bp
    && captured.exclusions === version.exclusions
    && totals.grossHtCents === version.gross_ht_cents && totals.commercialDiscountCents === version.discount_applied_cents
    && totals.commercialRoundingCents === version.commercial_rounding_cents && totals.netHtCents === version.total_ht_cents
    && totals.taxCents === version.total_tax_cents && totals.payableTtcCents === version.total_ttc_cents
    && version.rounding_adjustment_cents === 0
    && totals.discountIntent.kind === intent
    && (totals.discountIntent.kind !== "rate" || totals.discountIntent.rateBp === version.discount_bp)
    && frozenRates !== null && frozenRates.length === totals.taxByRate.length
    && totals.taxByRate.every((rate, index) => frozenRates[index]?.rate_bp === rate.rateBp
      && frozenRates[index]?.base_cents === rate.baseHtCents && frozenRates[index]?.tax_cents === rate.taxCents);
}

function unavailable(): never {
  throw internalError(
    "La copie du devis émis ne peut pas être vérifiée.",
    undefined,
    "OFFER_DOCUMENT_CONTRACT_INVALID",
  );
}

/** No project/profile/company lookup: the displayed identity is the stored copy. */
export async function loadVerifiedOfferDocument(input: {
  supabase: ServerSupabaseClient;
  tenantId: string;
  versionId: string;
  /** Only preparation of a new Doc1 may compute its seal before publication. */
  requireSealed?: boolean;
}): Promise<VerifiedOfferDocument> {
  const [versionResult, items, documentResult] = await Promise.all([
    input.supabase.from("estimate_versions").select("*")
      .eq("tenant_id", input.tenantId).eq("id", input.versionId).single(),
    readAllEstimateItems(input),
    input.supabase.from("estimate_documents").select("*")
      .eq("tenant_id", input.tenantId).eq("version_id", input.versionId).single(),
  ]);
  const lookupError = versionResult.error ?? documentResult.error;
  if (lookupError) throw mapSupabaseError(lookupError, "Impossible de charger la copie du devis.");
  if (!versionResult.data || !documentResult.data) unavailable();
  const version = versionResult.data as Version;
  const document = documentResult.data as StoredDocument;
  const allowDevelopmentTerms = canUseDevelopmentEstimateTerms();
  // Missing migration/projection fields must never be interpreted as legacy.
  if (!Object.hasOwn(version, "seal_payload_version") || !Object.hasOwn(document, "client_contract_version")
    || !Object.hasOwn(document, "client_contract_snapshot")) unavailable();
  const proof = parseOfferDocumentProof({
    proofVersion: 1,
    documentId: document.id,
    tenantId: document.tenant_id,
    versionId: document.version_id,
    projectId: version.project_id,
    status: document.status,
    filePath: document.file_path,
    sha256Hash: document.sha256_hash,
    fileSizeBytes: document.file_size_bytes,
    generatedAt: document.generated_at,
    generatedBy: document.generated_by,
    publishedGenerationToken: document.published_generation_token,
    publishedPurpose: document.published_purpose,
    publishedDispatchId: document.published_dispatch_id,
    publishedContentRevision: document.published_content_revision,
    clientContractVersion: document.client_contract_version,
    clientContractSnapshot: document.client_contract_snapshot,
    layoutOptions: document.layout_options,
    termsSnapshot: document.terms_snapshot,
  }, { allowDevelopmentTerms });
  if (proof.tenantId !== input.tenantId || proof.versionId !== input.versionId
    || proof.publishedContentRevision !== version.content_revision) unavailable();

  const source = { version, items };
  const storedHash = version.seal_hash?.trim().toLowerCase() ?? null;
  let sealHash: string;
  let sealPayloadVersion: VerifiedOfferDocument["sealPayloadVersion"];
  let calculationPayloadVersion: VerifiedOfferDocument["calculationPayloadVersion"];
  // Lot 2, sous-lot 2.7 (D14, F2) : le marqueur 5 lie la charge de calcul du moteur à son contrat,
  // charge 4 et contrat 1 en v1/v2, charge 6 et contrat 2 en v3 ; aucun appariement croisé.
  if (proof.clientContractVersion === 1 || proof.clientContractVersion === 2) {
    if (proof.clientContractVersion === 1) {
      if (!contract1MatchesVersion(proof.clientContractSnapshot, version)) unavailable();
      sealHash = computeOfferSealHash({
        calculationHash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, { payloadVersion: 4 })),
        snapshot: proof.clientContractSnapshot,
        documentProof: proof,
      }, { allowDevelopmentTerms });
      calculationPayloadVersion = 4;
    } else {
      if (!usesSaleCoefficients(resolveEstimateEngineVersion(version))
        || !contract2MatchesVersion(proof.clientContractSnapshot, version)) unavailable();
      sealHash = computeOfferSealHashV2({
        calculationHash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(source,
          { payloadVersion: ENGINE_V3_ESTIMATE_SEAL_PAYLOAD_VERSION })),
        snapshot: proof.clientContractSnapshot,
        documentProof: proof,
      }, { allowDevelopmentTerms });
      calculationPayloadVersion = ENGINE_V3_ESTIMATE_SEAL_PAYLOAD_VERSION;
    }
    sealPayloadVersion = 5;
    const preparingNew = input.requireSealed === false && ["draft", "sending"].includes(version.status)
      && version.seal_payload_version === null && storedHash === null;
    if (!preparingNew && (version.seal_payload_version !== 5 || storedHash !== sealHash)) unavailable();
  } else {
    // Historical copies are admissible only after a real historical seal; no
    // live identity is reconstructed and no new draft can enter this path.
    if (!["sent", "accepted", "archived"].includes(version.status) || version.seal_payload_version === 5 || !storedHash) unavailable();
    // Lot 2, sous-lot 2.7 (D14) : les candidats historiques se limitent à la v1/v2 ; une v3
    // n'est scellée que sous le marqueur 5, avec le contrat 2.
    const engine = resolveEstimateEngineVersion(version);
    if (usesSaleCoefficients(engine)) unavailable();
    const candidates = isUnifiedEngine(requireHistoricalEngine(engine))
      ? [4, 3, 2].map((payloadVersion) => ({ payloadVersion, hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, { payloadVersion })) }))
      : [
        { payloadVersion: 2, hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, { payloadVersion: 2 })) },
        { payloadVersion: 1, hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, { payloadVersion: 1, includeCalcEngineVersion: false })) },
        { payloadVersion: 1, hash: computeEstimateSealHash(buildCanonicalEstimateSealPayload(source, { payloadVersion: 1, includeCalcEngineVersion: false, includeLaborSplit: false })) },
      ];
    const matched = candidates.find((candidate) => candidate.hash === storedHash
      && (version.seal_payload_version === null || version.seal_payload_version === candidate.payloadVersion));
    if (!matched) unavailable();
    sealHash = matched.hash;
    sealPayloadVersion = matched.payloadVersion as 1 | 2 | 3 | 4;
    calculationPayloadVersion = sealPayloadVersion;
  }
  const { data: blob, error: downloadError } = await input.supabase.storage.from(ESTIMATE_DOCUMENTS_BUCKET).download(proof.filePath);
  if (downloadError || !blob) unavailable();
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (createHash("sha256").update(buffer).digest("hex") !== proof.sha256Hash
    || (proof.fileSizeBytes !== null && proof.fileSizeBytes !== buffer.byteLength)) unavailable();
  await assertEstimateVersionUnchanged({ supabase: input.supabase, version: versionResult.data });
  return { proof, buffer, sealHash, sealPayloadVersion, calculationPayloadVersion, version };
}
