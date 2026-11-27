import {
  COSTING_WORKBOOK_SUGGESTIONS_MAX_BODY_BYTES,
  costingWorkbookSuggestionProvidersResponseSchema,
  costingWorkbookSuggestionsRequestSchema,
  WORKBOOK_AI_SESSION_HEADER,
  workbookAiSessionSchema,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import { readWorkbookSuggestionProviders, suggestForWorkbook } from "@/lib/catalogue/costing-workbook-suggestions-server";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { readJsonBody } from "@/lib/http/json-body";

// An arbiter answers several bounded requests one after the other; it starts none after about 105 s.
export const maxDuration = 120;

/** The member's default source and available model options. No inference is run. */
export async function GET() {
  try {
    return ok(costingWorkbookSuggestionProvidersResponseSchema.parse(await readWorkbookSuggestionProviders()));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** Proposals for one kind of correction of the workbook import. Nothing is written. */
export async function POST(request: Request) {
  try {
    const body = await readJsonBody(request, {
      maxBytes: COSTING_WORKBOOK_SUGGESTIONS_MAX_BODY_BYTES,
      tooLargeMessage: "Cette demande de propositions est trop volumineuse (512 Ko au plus). Envoyez moins d’éléments à la fois.",
    });
    const session = request.headers.get(WORKBOOK_AI_SESSION_HEADER);
    if (!session) return ok(await suggestForWorkbook(costingWorkbookSuggestionsRequestSchema.parse(body)));
    let raw: unknown;
    try { raw = JSON.parse(session); } catch { throw badRequest("La session de l’analyse du classeur a changé."); }
    const parsed = workbookAiSessionSchema.safeParse(raw);
    if (!parsed.success) throw badRequest("La session de l’analyse du classeur a changé.");
    return ok(await suggestForWorkbook(costingWorkbookSuggestionsRequestSchema.parse(body), parsed.data));
  } catch (error) {
    return toErrorResponse(error);
  }
}
