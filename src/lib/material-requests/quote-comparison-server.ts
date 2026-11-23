import "server-only";

import { PDFDocument } from "pdf-lib";

import { isApiKeyError } from "@/lib/ai/access/api-key-errors";
import { ApiError, badRequest, payloadTooLarge } from "@/lib/http/api-response";

import { readMaterialRequestQuoteFile } from "./files-server";
import { prepareMaterialRequestDocumentAnalysis } from "./document-analysis-server";
import {
  buildQuoteComparisonPrompt,
  compareMaterialRequestQuote,
  QUOTE_COMPARISON_API_CEILING_NANO_USD,
  QUOTE_COMPARISON_MAX_BYTES,
  QUOTE_COMPARISON_PROMPT_VERSION,
  quoteComparisonAnswerSchema,
  type MaterialRequestQuoteComparison,
  type QuoteComparisonSettings,
} from "./quote-comparison";
import { MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES } from "./quote-contracts";
import { requireQuote } from "./quotes-server";
import { requireProjectAccess, requireRequest } from "./server-shared";

export async function analyzeMaterialRequestQuote(
  projectId: string,
  requestId: string,
  quoteId: string,
  fileId: string,
  settings: QuoteComparisonSettings,
): Promise<MaterialRequestQuoteComparison> {
  const access = await requireProjectAccess(projectId, "write");
  await requireRequest(access, requestId);
  const quote = await requireQuote(access, requestId, quoteId);
  const analyze = await prepareMaterialRequestDocumentAnalysis(access.context, settings);
  const { body, mimeType: storedType } = await readMaterialRequestQuoteFile(
    access, requestId, quoteId, fileId, QUOTE_COMPARISON_MAX_BYTES,
  );
  if (body.size > QUOTE_COMPARISON_MAX_BYTES) throw payloadTooLarge("Cette pièce est trop volumineuse pour être comparée.");
  const mimeType = MATERIAL_REQUEST_QUOTE_FILE_MIME_TYPES.find((type) => type === storedType);
  if (!mimeType) throw badRequest("Choisissez une pièce du devis au format PDF ou image.");

  const bytes = Buffer.from(await body.arrayBuffer());
  let pages = 1;
  if (mimeType === "application/pdf") {
    try {
      pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
    } catch {
      throw badRequest("Ce PDF ne peut pas être lu. Vérifiez qu’il s’ouvre et qu’il est déverrouillé.");
    }
    if (pages === 0) throw badRequest("Ce PDF ne contient aucune page.");
  }

  try {
    const answer = await analyze({
      prompt: buildQuoteComparisonPrompt(quote.message, pages),
      schema: quoteComparisonAnswerSchema,
      file: { mimeType, data: bytes.toString("base64") },
      promptVersion: QUOTE_COMPARISON_PROMPT_VERSION,
      ceiling: QUOTE_COMPARISON_API_CEILING_NANO_USD,
    });
    return { ...compareMaterialRequestQuote(answer.data, quote.message, pages), file_id: fileId, model: answer.model };
  } catch (error) {
    throw new ApiError({
      code: "MATERIAL_REQUEST_QUOTE_COMPARISON_FAILED",
      status: 503,
      message: isApiKeyError(error)
        ? error.message
        : "La comparaison n’a pas abouti. Vérifiez que la pièce est lisible et relancez l’analyse.",
    });
  }
}
