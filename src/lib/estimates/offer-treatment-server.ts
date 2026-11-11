import { resolveEstimateEngineVersion } from "@/lib/estimates/calc-engine-version";
import { usesPerUnitLabor } from "@/lib/estimates/engine/capabilities";
import {
  ApiError, badRequest, conflict, forbidden, internalError, mapSupabaseError, notFound, type SupabaseErrorLike,
} from "@/lib/estimates/errors";
import { OFFER_TREATMENT_KEY, readOfferTreatment, type OfferTreatment } from "@/lib/estimates/offer-treatment";
import {
  OFFER_TREATMENT_REFUSAL_MESSAGES, describeOfferReserveBases, planOfferTreatments,
  type OfferTreatmentPlanLine, type SetOfferTreatmentsInput, type SetOfferTreatmentsResult,
} from "@/lib/estimates/offer-treatment-plan";
import {
  assertDraftLockOwnedByCurrentUser, assertDraftStatus, getAuthenticatedContext, getVersionAccessOrThrow,
} from "@/lib/estimates/server-context";
import { assertCanWriteEstimateWorkflows } from "@/lib/estimates/write-access";
import type { Json } from "@/types/database";

/**
 * TI-682 (D12): saves the internal reasons of exclusions and the reserves written in the offer of an engine 3 draft.
 * The route checks what every estimate write checks (role, tenant and owner access, draft, lock of this session,
 * the revision the editor read), plans the save (offer-treatment-plan.ts) and hands it to the single writer,
 * public.set_estimate_line_offer_treatments, which holds the same guarantees for any other caller.
 */
const LINE_COLUMNS = "id, item_type, title, pricing_status, source_metadata";
const IN_FILTER_CHUNK = 100;

const STALE_MESSAGE = "Le devis a changé depuis son ouverture. Rechargez-le avant d’enregistrer motifs et réserves.";

const RPC_ERRORS: Record<string, () => ApiError> = {
  ESTIMATE_OFFER_TREATMENT_INVALID: () => badRequest("Demande invalide : rien n’a été enregistré.", undefined, "OFFER_TREATMENT_INVALID"),
  ESTIMATE_OFFER_RESERVE_NOT_WRITTEN: () => conflict(
    "La réserve n’a pas pu être écrite dans le texte de l’offre. Rechargez le devis et réessayez.", undefined, "OFFER_RESERVE_NOT_WRITTEN"),
  ESTIMATE_OFFER_TREATMENT_LINE_MISMATCH: () => conflict(
    OFFER_TREATMENT_REFUSAL_MESSAGES.OFFER_TREATMENT_STATUS_MISMATCH, undefined, "OFFER_TREATMENT_STATUS_MISMATCH"),
  ESTIMATE_OFFER_TREATMENT_STALE: () => conflict(STALE_MESSAGE, undefined, "VERSION_CONFLICT"),
  ESTIMATE_OFFER_TREATMENT_NOT_FOUND: () => notFound("Version de chiffrage introuvable."),
  ESTIMATE_OFFER_TREATMENT_READ_ONLY: () => forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY"),
  ESTIMATE_OFFER_TREATMENT_ENGINE_NOT_SUPPORTED: () => badRequest(
    "Motifs et réserves ne valent que pour un devis du moteur 3.", undefined, "OFFER_TREATMENT_ENGINE_NOT_SUPPORTED"),
  ESTIMATE_OFFER_TREATMENT_FORBIDDEN: () => forbidden("Cette modification du devis n’est pas autorisée."),
  ESTIMATE_VERSION_READ_ONLY: () => forbidden("Cette version est en lecture seule.", undefined, "READ_ONLY"),
};

function rpcError(error: SupabaseErrorLike): ApiError {
  const known = RPC_ERRORS[error.message ?? ""];
  if (known) return known();
  if (["40001", "40P01", "55P03"].includes(error.code ?? "")) return conflict(STALE_MESSAGE, undefined, "VERSION_CONFLICT");
  return mapSupabaseError(error, "Impossible d’enregistrer motifs et réserves.");
}

export async function setEstimateLineOfferTreatments(
  versionId: string,
  input: SetOfferTreatmentsInput,
): Promise<SetOfferTreatmentsResult> {
  const context = await getAuthenticatedContext();
  const { supabase, tenantId, userId } = context;
  assertCanWriteEstimateWorkflows(context.tenantRole);
  const { version } = await getVersionAccessOrThrow(supabase, versionId, context);
  assertDraftStatus(version.status);
  if (!usesPerUnitLabor(resolveEstimateEngineVersion(version))) throw RPC_ERRORS.ESTIMATE_OFFER_TREATMENT_ENGINE_NOT_SUPPORTED();
  await assertDraftLockOwnedByCurrentUser({ supabase, tenantId, versionId, userId });
  if (version.content_revision !== input.expected_content_revision) throw conflict(STALE_MESSAGE, undefined, "VERSION_CONFLICT");

  // The lines the request names, and every other line already carrying a decision: the reserves of a version rest
  // on one basis, and a sentence another reserve still uses stays in the offer text.
  const requestedIds = input.decisions.map((entry) => entry.item_id);
  const lines = new Map<string, OfferTreatmentPlanLine>();
  const scoped = () => supabase.from("estimate_items").select(LINE_COLUMNS).eq("tenant_id", tenantId).eq("version_id", versionId);
  const reads = [scoped().not(`source_metadata->${OFFER_TREATMENT_KEY}`, "is", null).limit(5000)];
  for (let start = 0; start < requestedIds.length; start += IN_FILTER_CHUNK) {
    reads.push(scoped().in("id", requestedIds.slice(start, start + IN_FILTER_CHUNK)));
  }
  const [limits, ...pages] = await Promise.all([
    supabase.from("estimate_versions").select("exclusions").eq("tenant_id", tenantId).eq("id", versionId).maybeSingle(),
    ...reads,
  ]);
  if (limits.error) throw mapSupabaseError(limits.error, "Impossible de lire le texte de l’offre de cette version.");
  if (!limits.data) throw RPC_ERRORS.ESTIMATE_OFFER_TREATMENT_NOT_FOUND();
  for (const page of pages) {
    if (page.error) throw mapSupabaseError(page.error, "Impossible de lire les lignes du devis.");
    for (const line of page.data ?? []) lines.set(line.id, line);
  }

  const plan = planOfferTreatments({ decisions: input.decisions, lines: [...lines.values()], exclusions: limits.data.exclusions });
  if (!plan.ok) {
    const { refusal } = plan;
    const message = refusal.code === "OFFER_RESERVE_BASIS_CONFLICT"
      ? `${OFFER_TREATMENT_REFUSAL_MESSAGES[refusal.code]} Ce devis porterait ${describeOfferReserveBases(refusal.bases)}.`
      : OFFER_TREATMENT_REFUSAL_MESSAGES[refusal.code];
    throw refusal.code === "OFFER_LIMITS_TEXT_TOO_LONG" || refusal.code === "OFFER_RESERVE_BASIS_CONFLICT"
      ? badRequest(message, refusal, refusal.code) : conflict(message, refusal, refusal.code);
  }

  const { data, error } = await supabase.rpc("set_estimate_line_offer_treatments", {
    p_version_id: versionId,
    p_expected_content_revision: input.expected_content_revision,
    p_treatments: plan.treatments as Json,
    // The generated argument type is non-null; the writer stores an empty offer text as null.
    p_exclusions: plan.exclusions ?? "",
  });
  if (error) throw rpcError(error);
  const written = data as { version_id?: unknown; content_revision?: unknown; updated_at?: unknown; exclusions?: unknown } | null;
  if (!written || written.version_id !== versionId || typeof written.content_revision !== "number"
    || typeof written.updated_at !== "string" || (written.exclusions !== null && typeof written.exclusions !== "string")) {
    throw internalError("Motifs et réserves enregistrés, mais leur confirmation est illisible. Rechargez le devis.");
  }

  const after = await scoped().in("id", requestedIds.slice(0, IN_FILTER_CHUNK));
  const stored = new Map<string, OfferTreatment | null>();
  for (const line of after.data ?? []) {
    const read = readOfferTreatment(line.source_metadata);
    stored.set(line.id, read.state === "read" ? read.treatment : null);
  }
  return {
    version: { id: versionId, content_revision: written.content_revision, updated_at: written.updated_at,
      exclusions: written.exclusions as string | null },
    // Beyond the first hundred lines the editor reloads the estimate: the answer names what it read back.
    items: requestedIds.filter((id) => stored.has(id)).map((id) => ({ id, offer_treatment: stored.get(id) ?? null })),
  };
}
