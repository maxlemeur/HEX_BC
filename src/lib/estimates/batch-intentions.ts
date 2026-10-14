/** Exact, account-scoped requests retained until the server outcome is known. */
export type EstimateBatchIdentity = {
  actorId: string;
  tenantId: string;
  versionId: string;
};

export type EstimateBatchIntention = EstimateBatchIdentity & {
  schemaVersion: 1;
  workflow?: "generated-ouvrage";
  operationKey: string;
  expectedUpdatedAt: string;
  body: string;
  createdAt: string;
};

export type EstimateBatchAttempt = {
  readonly operationKey: string;
  intention?: EstimateBatchIntention;
};

const PREFIX = "estimate:batch-pending:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const listeners = new Set<() => void>();
const sending = new Set<string>();

export class EstimateBatchPendingError extends Error {
  readonly code = "ESTIMATE_BATCH_PENDING";
}

export class EstimateBatchStorageError extends Error {
  readonly code = "ESTIMATE_BATCH_STORAGE_UNAVAILABLE";
}

export class EstimateBatchOutcomeUnknownError extends Error {
  readonly code = "BATCH_OUTCOME_UNKNOWN";
  readonly status = 503;
}

function storageKey(identity: EstimateBatchIdentity) {
  if (![identity.actorId, identity.tenantId, identity.versionId].every((value) => UUID.test(value))) {
    throw new EstimateBatchStorageError("Le compte ou l'affaire n'est pas encore disponible. Rechargez le devis.");
  }
  return `${PREFIX}${identity.actorId.toLowerCase()}:${identity.tenantId.toLowerCase()}:${identity.versionId.toLowerCase()}`;
}

function storage() {
  try {
    if (typeof window !== "undefined") return window.sessionStorage;
  } catch {
    // Report the missing durability before issuing a mutation.
  }
  throw new EstimateBatchStorageError(
    "Le stockage de session est indisponible. Autorisez-le avant d'enregistrer les modifications groupées."
  );
}

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeEstimateBatchIntention(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readEstimateBatchIntention(
  identity: EstimateBatchIdentity
): EstimateBatchIntention | null {
  const key = storageKey(identity);
  let raw: string | null;
  try {
    raw = storage().getItem(key);
  } catch (error) {
    if (error instanceof EstimateBatchStorageError) throw error;
    throw new EstimateBatchStorageError("Impossible de lire la demande en attente. Aucune nouvelle modification groupée n'a été envoyée.");
  }
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.schemaVersion !== 1 ||
      value.actorId !== identity.actorId || value.tenantId !== identity.tenantId ||
      value.versionId !== identity.versionId || typeof value.operationKey !== "string" ||
      !UUID.test(value.operationKey) || typeof value.expectedUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.expectedUpdatedAt)) || typeof value.createdAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) || typeof value.body !== "string") {
      throw new Error("Invalid intention");
    }
    const body: unknown = JSON.parse(value.body);
    if (value.workflow === "generated-ouvrage") {
      // The workflow client validates all reviewed values before any request.
      // This shared gate only needs a scoped envelope to block other writes.
      if (!record(body) || body.operationKey !== value.operationKey || body.expectedUpdatedAt !== value.expectedUpdatedAt ||
        body.versionId !== identity.versionId || typeof body.draftId !== "string" || !UUID.test(body.draftId) ||
        !Array.isArray(body.acceptedCandidates) || body.acceptedCandidates.length < 1 || body.acceptedCandidates.length > 12) {
        throw new Error("Invalid ouvrage intention");
      }
    } else if (value.workflow !== undefined || !record(body) || body.operation_key !== value.operationKey ||
      body.concurrency_token !== value.expectedUpdatedAt || body.dry_run === true ||
      !Array.isArray(body.operations) || body.operations.length === 0 || body.operations.length > 1000 ||
      !body.operations.every((operation) => record(operation) &&
        ["create", "update", "delete", "reorder"].includes(String(operation.op)))) {
      throw new Error("Invalid request");
    }
    return value as EstimateBatchIntention;
  } catch {
    throw new EstimateBatchStorageError(
      "La demande conservée est illisible. Vérifiez le devis avant de reprendre ; aucune nouvelle écriture n'a été envoyée."
    );
  }
}

export function retainEstimateBatchIntention(intention: EstimateBatchIntention) {
  const existing = readEstimateBatchIntention(intention);
  if (existing && (existing.operationKey !== intention.operationKey || existing.body !== intention.body)) {
    throw new EstimateBatchPendingError("Une opération attend une vérification. Vérifiez son résultat avant de modifier ce devis.");
  }
  const key = storageKey(intention);
  const raw = JSON.stringify(intention);
  try {
    storage().setItem(key, raw);
    if (storage().getItem(key) !== raw) throw new Error("Storage did not retain request");
  } catch {
    throw new EstimateBatchStorageError(
      "Impossible de conserver la demande pour une reprise. Aucune modification groupée n'a été envoyée."
    );
  }
  notify();
}

export function clearEstimateBatchIntention(identity: EstimateBatchIdentity, operationKey: string) {
  const existing = readEstimateBatchIntention(identity);
  if (!existing) return;
  if (existing.operationKey !== operationKey) {
    throw new EstimateBatchPendingError("Une autre opération attend une vérification.");
  }
  try {
    storage().removeItem(storageKey(identity));
    if (storage().getItem(storageKey(identity)) !== null) throw new Error("Request retained");
  } catch {
    throw new EstimateBatchStorageError(
      "Le résultat est connu, mais la demande locale n'a pas pu être clôturée. Vérifiez le résultat avant de poursuivre."
    );
  }
  notify();
}

export function assertNoPendingEstimateBatch(identity: EstimateBatchIdentity) {
  if (readEstimateBatchIntention(identity)) {
    throw new EstimateBatchPendingError("Une opération attend une vérification. Vérifiez son résultat avant de modifier ce devis.");
  }
}

export function setEstimateBatchSending(identity: EstimateBatchIdentity, value: boolean) {
  const key = storageKey(identity);
  if (value) sending.add(key);
  else sending.delete(key);
  notify();
}

export function isEstimateBatchSending(identity: EstimateBatchIdentity) {
  return sending.has(storageKey(identity));
}

export function createEstimateBatchAttempt(): EstimateBatchAttempt {
  return { operationKey: crypto.randomUUID() };
}
