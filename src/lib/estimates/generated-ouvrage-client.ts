import {
  abandonGeneratedOuvrageApplication, getGeneratedOuvrageApplicationReceipt, insertGeneratedOuvrages,
} from "@/app/dashboard/affaires/_actions/generated-ouvrages";
import type { GeneratedOuvrageApplicationOutcome, InsertGeneratedOuvragesResult } from "@/lib/estimates/generated-ouvrages";
import { getEstimateDraftLockSessionId } from "@/lib/estimates/client";
import {
  assertNoPendingEstimateBatch, clearEstimateBatchIntention, EstimateBatchPendingError,
  readEstimateBatchIntention, retainEstimateBatchIntention, setEstimateBatchSending,
  type EstimateBatchIdentity, type EstimateBatchIntention,
} from "@/lib/estimates/batch-intentions";
import {
  getEstimateEditorMutationIdentity, isOlderEstimateVersionToken, runEstimateEditorMutation,
} from "@/lib/estimates/editor-mutations";
import {
  canonicalGeneratedOuvrageCandidates, readGeneratedOuvrageRequest, type GeneratedOuvrageRequest,
} from "@/lib/estimates/generated-ouvrage-request";

const UNKNOWN = "L'application des ouvrages reste à vérifier. Vérifiez son résultat avant de reprendre.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const sameToken = (left: string, right: string) =>
  !isOlderEstimateVersionToken(left, right) && !isOlderEstimateVersionToken(right, left);

export class GeneratedOuvrageOutcomeUnknownError extends Error {
  readonly code = "GENERATED_OUVRAGE_OUTCOME_UNKNOWN";
  readonly status = 503;
  constructor() { super(UNKNOWN); }
}
function unknownOutcome(): never { throw new GeneratedOuvrageOutcomeUnknownError(); }
function requireIdentity(versionId: string) {
  const identity = getEstimateEditorMutationIdentity(versionId);
  if (!identity) throw new EstimateBatchPendingError("Le compte de l'éditeur n'est pas prêt. Rechargez le devis.");
  return identity;
}
function requireCurrentIdentity(expected: EstimateBatchIdentity) {
  const current = requireIdentity(expected.versionId);
  if (current.actorId !== expected.actorId || current.tenantId !== expected.tenantId || current.versionId !== expected.versionId) {
    throw new EstimateBatchPendingError("Le compte ou l'affaire a changé. La demande précédente n'a pas été renvoyée.");
  }
}
function version(value: unknown, expectedId: string) {
  if (!record(value) || value.id !== expectedId || !timestamp(value.updatedAt)) return unknownOutcome();
  return { id: expectedId, updatedAt: value.updatedAt };
}

function parseResult(payload: unknown, request: GeneratedOuvrageRequest, identity: EstimateBatchIdentity): InsertGeneratedOuvragesResult {
  if (!record(payload) || payload.ok !== true || payload.versionId !== request.versionId ||
    typeof payload.projectId !== "string" || !UUID.test(payload.projectId) ||
    payload.insertedCount !== request.acceptedCandidates.length ||
    !["partially_applied", "applied"].includes(String(payload.draftStatus)) ||
    typeof payload.replayed !== "boolean" || !record(payload.receipt) ||
    payload.receipt.operationKey !== request.operationKey || payload.receipt.actorId !== identity.actorId ||
    payload.receipt.versionId !== request.versionId || payload.receipt.draftId !== request.draftId ||
    !timestamp(payload.receipt.expectedUpdatedAt) || !sameToken(payload.receipt.expectedUpdatedAt, request.expectedUpdatedAt) ||
    !timestamp(payload.receipt.committedAt) || !Array.isArray(payload.applications) ||
    payload.applications.length !== request.acceptedCandidates.length || !record(payload.totals)) return unknownOutcome();
  try {
    if (JSON.stringify(canonicalGeneratedOuvrageCandidates(payload.receipt.acceptedCandidates)) !==
      JSON.stringify(request.acceptedCandidates)) return unknownOutcome();
  } catch { return unknownOutcome(); }
  const historical = version(payload.version, request.versionId);
  const current = version(payload.currentVersion, request.versionId);
  if (!record(payload.currentVersion) || !["draft", "sending", "sent", "accepted", "archived"].includes(String(payload.currentVersion.status)) ||
    isOlderEstimateVersionToken(historical.updatedAt, request.expectedUpdatedAt) ||
    isOlderEstimateVersionToken(current.updatedAt, historical.updatedAt) ||
    (!payload.replayed && !sameToken(current.updatedAt, historical.updatedAt))) return unknownOutcome();
  const identities = ["subdetailId", "assemblyId", "estimateItemId", "applicationId", "snapshotId"];
  for (const [index, application] of payload.applications.entries()) {
    if (!record(application) || application.candidateId !== request.acceptedCandidates[index].candidateId ||
      identities.some((key) => typeof application[key] !== "string" || !UUID.test(application[key] as string))) return unknownOutcome();
  }
  for (const key of identities) {
    if (new Set(payload.applications.map((entry) => (entry as Record<string, unknown>)[key])).size !== payload.applications.length) return unknownOutcome();
  }
  const { totalHtCents: ht, totalTaxCents: tax, totalTtcCents: ttc } = payload.totals;
  if (![ht, tax, ttc].every((value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0) ||
    (ht as number) + (tax as number) !== ttc) return unknownOutcome();
  return payload as unknown as InsertGeneratedOuvragesResult;
}

function parseOutcome(payload: unknown, request: GeneratedOuvrageRequest, identity: EstimateBatchIdentity): GeneratedOuvrageApplicationOutcome {
  if (!record(payload) || payload.outcome !== "abandoned") return parseResult(payload, request, identity);
  if (payload.ok !== true || !record(payload.receipt) ||
    payload.receipt.operationKey !== request.operationKey || payload.receipt.actorId !== identity.actorId ||
    payload.receipt.versionId !== request.versionId || payload.receipt.draftId !== request.draftId ||
    !timestamp(payload.receipt.expectedUpdatedAt) || !sameToken(payload.receipt.expectedUpdatedAt, request.expectedUpdatedAt) ||
    !timestamp(payload.receipt.abandonedAt)) return unknownOutcome();
  try {
    if (JSON.stringify(canonicalGeneratedOuvrageCandidates(payload.receipt.acceptedCandidates)) !==
      JSON.stringify(request.acceptedCandidates)) return unknownOutcome();
  } catch { return unknownOutcome(); }
  const current = version(payload.currentVersion, request.versionId);
  if (!record(payload.currentVersion) || !["draft", "sending", "sent", "accepted", "archived"].includes(String(payload.currentVersion.status)) ||
    isOlderEstimateVersionToken(current.updatedAt, request.expectedUpdatedAt)) return unknownOutcome();
  return payload as unknown as GeneratedOuvrageApplicationOutcome;
}

function readIntention(identity: EstimateBatchIdentity) {
  const pending = readEstimateBatchIntention(identity);
  if (pending && pending.workflow !== "generated-ouvrage") {
    throw new EstimateBatchPendingError("Une autre opération attend une vérification.");
  }
  return pending;
}

async function submit(intention: EstimateBatchIntention, recovering: boolean) {
  requireCurrentIdentity(intention);
  const request = readGeneratedOuvrageRequest(JSON.parse(intention.body));
  const draftLockSessionId = getEstimateDraftLockSessionId(intention.versionId);
  if (!draftLockSessionId) throw new EstimateBatchPendingError("Acquérez le verrou du devis avant de reprendre l'application.");
  retainEstimateBatchIntention(intention);
  setEstimateBatchSending(intention, true);
  try {
    let response: unknown;
    try { response = await insertGeneratedOuvrages({ ...request, draftLockSessionId }); }
    catch { return unknownOutcome(); }
    if (record(response) && response.ok === false && record(response.error) &&
      typeof response.error.status === "number" && [400, 401, 403, 404, 409, 413, 422].includes(response.error.status) &&
      typeof response.error.code === "string" && response.error.code !== "GENERATED_OUVRAGE_OUTCOME_UNKNOWN" &&
      typeof response.error.message === "string") {
      if (!recovering) clearEstimateBatchIntention(intention, intention.operationKey);
      throw Object.assign(new Error(response.error.message), { status: response.error.status, code: response.error.code });
    }
    const result = parseOutcome(response, request, intention);
    if (!recovering && !("outcome" in result) && !result.replayed) clearEstimateBatchIntention(intention, intention.operationKey);
    return result;
  } finally { setEstimateBatchSending(intention, false); }
}

export async function applyGeneratedOuvrages(input: {
  versionId: string; draftId: string; acceptedCandidates: unknown;
}) {
  const identity = requireIdentity(input.versionId);
  const acceptedCandidates = canonicalGeneratedOuvrageCandidates(input.acceptedCandidates);
  return runEstimateEditorMutation(input.versionId, undefined, async (expectedUpdatedAt) => {
    requireCurrentIdentity(identity);
    assertNoPendingEstimateBatch(identity);
    if (!expectedUpdatedAt) throw new EstimateBatchPendingError("Le devis doit être rechargé avant d'appliquer les ouvrages.");
    const request = readGeneratedOuvrageRequest({ ...input, acceptedCandidates, expectedUpdatedAt, operationKey: crypto.randomUUID() });
    const intention: EstimateBatchIntention = { ...identity, schemaVersion: 1, workflow: "generated-ouvrage",
      operationKey: request.operationKey, expectedUpdatedAt, body: JSON.stringify(request), createdAt: new Date().toISOString() };
    const result = await submit(intention, false);
    const applied = !("outcome" in result);
    return { value: result, version: { id: result.currentVersion.id, updated_at: result.currentVersion.updatedAt },
      structural: applied, totals: !applied || result.replayed ? undefined : {
        total_ht_cents: result.totals.totalHtCents, total_tax_cents: result.totals.totalTaxCents, total_ttc_cents: result.totals.totalTtcCents,
      } };
  });
}

export async function inspectGeneratedOuvrageReceipt(identity: EstimateBatchIdentity) {
  requireCurrentIdentity(identity);
  const intention = readIntention(identity);
  if (!intention) return null;
  let response: unknown;
  try { response = await getGeneratedOuvrageApplicationReceipt({ versionId: identity.versionId, operationKey: intention.operationKey }); }
  catch { return unknownOutcome(); }
  if (!record(response) || response.ok !== true) return unknownOutcome();
  return response.data === null ? null : parseOutcome(response.data, readGeneratedOuvrageRequest(JSON.parse(intention.body)), identity);
}

export async function resumeGeneratedOuvrageApplication(identity: EstimateBatchIdentity) {
  requireCurrentIdentity(identity);
  const intention = readIntention(identity);
  if (!intention) throw new EstimateBatchPendingError("Aucune opération à reprendre.");
  return runEstimateEditorMutation(identity.versionId, intention.expectedUpdatedAt, async () => {
    const result = await submit(intention, true);
    return { value: result, version: { id: result.currentVersion.id, updated_at: result.currentVersion.updatedAt }, structural: !("outcome" in result) };
  });
}

export async function abandonPendingGeneratedOuvrageApplication(identity: EstimateBatchIdentity) {
  requireCurrentIdentity(identity);
  const intention = readIntention(identity);
  if (!intention) throw new EstimateBatchPendingError("Aucune demande à abandonner.");
  const request = readGeneratedOuvrageRequest(JSON.parse(intention.body));
  let response: unknown;
  try { response = await abandonGeneratedOuvrageApplication(request); }
  catch { return unknownOutcome(); }
  if (!record(response) || response.ok !== true) return unknownOutcome();
  return parseOutcome(response.data, request, identity);
}
