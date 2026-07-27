import {
  normalizeEstimatePdfLayoutOptions,
  type EstimatePdfLayoutOptions,
} from "@/lib/estimates/pdf-layout";
import {
  canUseEstimateTermsSnapshot,
  parseEstimateTermsSnapshot,
  type EstimateTermsSnapshot,
} from "@/lib/estimates/pdf-terms";
import type { Json } from "@/types/database";

export type StoredPortalDocumentContract = {
  status?: string | null;
  layout_options?: unknown;
  terms_snapshot?: unknown;
  generated_by?: string | null;
};

export type PortalDocumentContract =
  | {
      ok: true;
      layout: EstimatePdfLayoutOptions;
      terms: EstimateTermsSnapshot | null;
      issuerUserId: string | null;
    }
  | {
      ok: false;
      reason:
        | "document_not_ready"
        | "required_terms_snapshot_missing_or_invalid";
    };

/**
 * Resolves the immutable contract shown and accepted through the portal.
 *
 * A legacy portal without a stored document can still show the historical
 * no-CGV layout. Once a stored layout declares that CGV are included, however,
 * the exact usable snapshot is mandatory: silently falling back to a document
 * without those terms would make the acceptance checkbox misleading.
 */
export function resolvePortalDocumentContract(
  document: StoredPortalDocumentContract | null,
  nodeEnv = process.env.NODE_ENV
): PortalDocumentContract {
  const layout = normalizeEstimatePdfLayoutOptions(
    document?.layout_options ?? undefined
  );
  const parsedTerms = parseEstimateTermsSnapshot(
    (document?.terms_snapshot ?? null) as Json | null
  );
  const terms =
    parsedTerms && canUseEstimateTermsSnapshot(parsedTerms, nodeEnv)
      ? parsedTerms
      : null;

  if (document && document.status && document.status !== "ready") {
    return { ok: false, reason: "document_not_ready" };
  }

  if (layout.includeTerms && !terms) {
    return {
      ok: false,
      reason: "required_terms_snapshot_missing_or_invalid",
    };
  }

  return {
    ok: true,
    layout,
    terms: layout.includeTerms ? terms : null,
    issuerUserId: document?.generated_by ?? null,
  };
}
