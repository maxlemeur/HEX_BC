export { isOlderEstimateVersionToken } from "@/lib/estimates/version-token";

import type { EstimateBatchIdentity } from "@/lib/estimates/batch-intentions";
import type { EstimateVersionTotalsPatch } from "@/lib/estimates/editor-items";

export type EditorMutationToken = {
  id: string;
  updated_at: string;
  content_revision?: number;
};

type MutationResult<T> = {
  value: T;
  version: EditorMutationToken;
  deletedIds?: string[];
  structural?: boolean;
  needsReload?: boolean;
  totals?: EstimateVersionTotalsPatch;
};

type MutationCommit = Omit<MutationResult<unknown>, "value">;
type ReadRecovery = { error: Error; read: () => Promise<MutationCommit> };
type MutationReadScope = {
  requireRead: (read: ReadRecovery["read"], message?: string) => Error;
  isActive: () => boolean;
  getRevision: (token: string | undefined) => number | undefined;
};

class EditorReadRequiredError extends Error {
  readonly code = "ESTIMATE_EDITOR_READ_REQUIRED";
  constructor(message = "La préparation du PDF est lancée, mais la lecture du devis a échoué. Vérifiez le résultat avant d’enregistrer ; vos saisies sont conservées.") {
    super(message);
  }
}

type MutationObserver = {
  getToken: () => string | null;
  getRevision?: () => number | undefined;
  getIdentity?: () => EstimateBatchIdentity | null;
  onCommit: (result: Omit<MutationResult<unknown>, "value">) => void;
  onPendingChange: (pending: boolean) => void;
  onReadRequiredChange?: (message: string | null) => void;
};

type MutationSession = {
  observer: MutationObserver;
  active: boolean;
  pending: number;
  tail: Promise<void>;
  tokens: Set<string>;
  revisions: Map<string, number>;
  latest: string | null;
  conflict: unknown;
  readRequired: ReadRecovery | null;
  readRecoveryInFlight: Promise<boolean> | null;
};

// One editor/account lifetime. Nothing is shared with another browser document
// or persisted across a reload: foreign version conflicts must still fail.
const sessions = new Map<string, MutationSession>();

function validContentRevision(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value : undefined;
}

function rememberAcknowledgedVersion(session: MutationSession, version: EditorMutationToken) {
  session.latest = version.updated_at;
  session.tokens.add(version.updated_at);
  const revision = validContentRevision(version.content_revision);
  if (revision === undefined) {
    session.revisions.delete(version.updated_at);
  } else {
    session.revisions.set(version.updated_at, revision);
  }
}

export function registerEstimateEditorMutations(
  versionId: string,
  observer: MutationObserver
): () => void {
  const previous = sessions.get(versionId);
  if (previous) previous.active = false;
  const session: MutationSession = {
    observer,
    active: true,
    pending: 0,
    tail: Promise.resolve(),
    tokens: new Set(),
    revisions: new Map(),
    latest: null,
    conflict: null,
    readRequired: null,
    readRecoveryInFlight: null,
  };
  sessions.set(versionId, session);
  return () => {
    session.active = false;
    if (sessions.get(versionId) === session) sessions.delete(versionId);
  };
}

export async function waitForEstimateEditorMutations(versionId: string) {
  const session = sessions.get(versionId);
  if (!session) return;
  while (session.active) {
    const tail = session.tail;
    await tail;
    if (tail === session.tail) break;
  }
}

export function hasEstimateEditorMutations(versionId: string) {
  return (sessions.get(versionId)?.pending ?? 0) > 0;
}

export function hasEstimateEditorMutationSession(versionId: string) {
  return sessions.has(versionId);
}

export function getEstimateEditorMutationIdentity(versionId: string): EstimateBatchIdentity | null {
  const identity = sessions.get(versionId)?.observer.getIdentity?.();
  if (!identity || identity.versionId !== versionId) return null;
  return {
    actorId: identity.actorId.toLowerCase(),
    tenantId: identity.tenantId.toLowerCase(),
    versionId: identity.versionId.toLowerCase(),
  };
}

export async function runEstimateEditorMutation<T>(
  versionId: string,
  requestedToken: string | undefined,
  operation: (token: string | undefined, scope: MutationReadScope) => Promise<MutationResult<T>>
): Promise<T> {
  const session = sessions.get(versionId);
  if (!session) return (await operation(requestedToken, {
    requireRead: (_read, message) => new EditorReadRequiredError(message),
    isActive: () => true,
    getRevision: () => undefined,
  })).value;
  const submittedToken = requestedToken ?? session.observer.getToken() ?? undefined;
  session.pending += 1;
  session.observer.onPendingChange(true);

  const result = session.tail.then(async () => {
    if (!session.active) throw new Error("L'éditeur a changé. Action annulée.");
    if (session.readRequired) throw session.readRequired.error;
    const observed = session.observer.getToken();
    const observedRevision = validContentRevision(session.observer.getRevision?.());
    if (observed && (!session.tokens.has(observed) ||
      (observedRevision !== undefined && session.revisions.has(observed) &&
        observedRevision !== session.revisions.get(observed)))) {
      // A server reload starts a new baseline; never rebase an old draft onto it.
      session.tokens.clear();
      session.revisions.clear();
      session.tokens.add(observed);
      if (observedRevision !== undefined) session.revisions.set(observed, observedRevision);
      session.latest = observed;
      session.conflict = null;
    }
    if (session.conflict) throw session.conflict;
    const token = submittedToken === undefined || session.tokens.has(submittedToken)
      ? session.latest ?? submittedToken
      : submittedToken;
    let committed: MutationResult<T>;
    try {
      committed = await operation(token, { requireRead: (read, message) => {
        const error = new EditorReadRequiredError(message);
        if (session.active) {
          session.readRequired = { error, read };
          session.observer.onReadRequiredChange?.(error.message);
        }
        return error;
      }, isActive: () => session.active,
      getRevision: (value) => value ? session.revisions.get(value) : undefined });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error &&
        ["VERSION_CONFLICT", "ESTIMATE_BATCH_STALE", "ESTIMATE_BATCH_CONTEXT_CHANGED"].includes(String(error.code))) {
        session.conflict = error;
      }
      throw error;
    }
    if (!session.active) return committed.value;
    if (committed.version.id !== versionId) {
      throw new Error("Le jeton reçu appartient à une autre version.");
    }
    if (token) session.tokens.add(token);
    rememberAcknowledgedVersion(session, committed.version);
    session.observer.onCommit(committed);
    return committed.value;
  });
  session.tail = result.then(() => undefined, () => undefined).finally(() => {
    session.pending -= 1;
    if (session.active) session.observer.onPendingChange(session.pending > 0);
  });
  return result;
}

/** Complete the acknowledged operation by reading, never repeating its write. */
export async function recoverEstimateEditorRead(versionId: string): Promise<boolean> {
  const session = sessions.get(versionId);
  const recovery = session?.readRequired;
  if (!session?.active || !recovery) return false;
  if (session.readRecoveryInFlight) return session.readRecoveryInFlight;
  session.pending += 1;
  session.observer.onPendingChange(true);
  const result = session.tail.then(async () => {
    if (!session.active || session.readRequired !== recovery) return false;
    const committed = await recovery.read();
    if (!session.active || session.readRequired !== recovery) return false;
    if (committed.version.id !== versionId || typeof committed.version.updated_at !== "string" || !committed.version.updated_at) {
      throw new Error("La lecture reçue appartient à une autre version ou est incomplète.");
    }
    // Explicit recovery adopts a new baseline; old intentions keep their CAS.
    session.tokens.clear();
    session.revisions.clear();
    rememberAcknowledgedVersion(session, committed.version);
    session.observer.onCommit(committed);
    session.readRequired = null;
    session.observer.onReadRequiredChange?.(null);
    return true;
  });
  session.tail = result.then(() => undefined, () => undefined).finally(() => {
    session.pending -= 1;
    if (session.active) session.observer.onPendingChange(session.pending > 0);
  });
  session.readRecoveryInFlight = result;
  void result.finally(() => {
    if (session.readRecoveryInFlight === result) session.readRecoveryInFlight = null;
  }).catch(() => undefined);
  return result;
}
