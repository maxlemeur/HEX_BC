import {
  costingWorkbookSuggestionProvidersResponseSchema,
  costingWorkbookSuggestionsResponseSchema,
  type CostingWorkbookSuggestionProvidersResponse,
  type CostingWorkbookSuggestionsRequest,
  type CostingWorkbookSuggestionsResponseOf,
  type CostingWorkbookSuggestionTask,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import { requestJsonUncoordinated } from "@/lib/estimates/client-http";

/** Browser-side calls of the import screen's proposals (TI-711). Nothing is written: a proposal is confirmed in the screen. */

const PATH = "/api/catalogue/workbook-import/suggestions";
const UNREADABLE = "Les propositions n’ont pas pu être lues. Réessayez dans un instant.";

export type SuggestionProviders = CostingWorkbookSuggestionProvidersResponse["providers"];
export type SuggestionProvider = keyof SuggestionProviders;

/** Which AI sources this member can ask here; no provider is called. */
export async function fetchSuggestionProviders(signal?: AbortSignal): Promise<SuggestionProviders> {
  const answer = await requestJsonUncoordinated<unknown>(PATH, { method: "GET", cache: "no-store", signal }, UNREADABLE);
  const parsed = costingWorkbookSuggestionProvidersResponseSchema.safeParse(answer);
  if (!parsed.success) throw new Error(UNREADABLE);
  return parsed.data.providers;
}

/** The proposals of one task: from the deterministic pass alone without `provider`, arbitrated by it otherwise. */
export async function requestWorkbookSuggestions<Task extends CostingWorkbookSuggestionTask>(
  request: Extract<CostingWorkbookSuggestionsRequest, { task: Task }>,
  signal?: AbortSignal,
): Promise<CostingWorkbookSuggestionsResponseOf<Task>> {
  const answer = await requestJsonUncoordinated<unknown>(
    PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request), signal }, UNREADABLE,
  );
  const parsed = costingWorkbookSuggestionsResponseSchema.safeParse(answer);
  if (!parsed.success || parsed.data.task !== request.task) throw new Error(UNREADABLE);
  return parsed.data as CostingWorkbookSuggestionsResponseOf<Task>;
}
