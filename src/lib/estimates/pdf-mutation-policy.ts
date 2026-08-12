import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";
import type { EstimatePdfGenerationClaim } from "@/lib/estimates/pdf-publication";

export type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

import { forbidden } from "./errors";

export type PdfGenerateOptions = {
  force?: boolean;
  triggeredBy?: "manual" | "send";
  layout?: EstimatePdfLayoutOptions;
  dispatchId?: string;
  publicationClaim?: EstimatePdfGenerationClaim;
};

export function assertEstimatePdfMutationAllowed(
  status: string,
  triggeredBy: PdfGenerateOptions["triggeredBy"]
) {
  if (
    status === "draft" ||
    (status === "sending" && triggeredBy === "send")
  ) {
    return;
  }

  throw forbidden(
    "Le PDF contractuel d'un devis transmis ne peut plus etre remplace.",
    { status },
    "ESTIMATE_PDF_CONTRACT_IMMUTABLE"
  );
}
