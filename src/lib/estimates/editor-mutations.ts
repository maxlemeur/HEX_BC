export type EditorMutationToken = { id: string; updated_at: string };

type MutationResult<T> = {
  value: T;
  version: EditorMutationToken;
  deletedIds?: string[];
  structural?: boolean;
};

type MutationObserver = {
  getToken: () => string | null;
  onCommit: (result: Omit<MutationResult<unknown>, "value">) => void;
  onPendingChange: (pending: boolean) => void;
};

type MutationSession = {
  observer: MutationObserver;
  active: boolean;
  pending: number;
  tail: Promise<void>;
  tokens: Set<string>;
  latest: string | null;
  conflict: unknown;
};

// One editor/account lifetime. Nothing is shared with another browser document
// or persisted across a reload: foreign version conflicts must still fail.
const sessions = new Map<string, MutationSession>();

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
    latest: null,
    conflict: null,
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

// Preserve PostgreSQL's microseconds when comparing tokens from responses.
export function isOlderEstimateVersionToken(candidate: string, current: string) {
  const timestamp = (value: string) => {
    const milliseconds = Date.parse(value);
    const fraction = value.match(/\.(\d+)(?:Z|[+-]\d\d:?\d\d)$/)?.[1] ?? "";
    return milliseconds * 1000 + Number(fraction.padEnd(6, "0").slice(3, 6));
  };
  return timestamp(candidate) < timestamp(current);
}

export function hasEstimateEditorMutations(versionId: string) {
  return (sessions.get(versionId)?.pending ?? 0) > 0;
}

export function hasEstimateEditorMutationSession(versionId: string) {
  return sessions.has(versionId);
}

export async function runEstimateEditorMutation<T>(
  versionId: string,
  requestedToken: string | undefined,
  operation: (token: string | undefined) => Promise<MutationResult<T>>
): Promise<T> {
  const session = sessions.get(versionId);
  if (!session) return (await operation(requestedToken)).value;
  const submittedToken = requestedToken ?? session.observer.getToken() ?? undefined;
  session.pending += 1;
  session.observer.onPendingChange(true);

  const result = session.tail.then(async () => {
    if (!session.active) throw new Error("L'éditeur a changé. Action annulée.");
    const observed = session.observer.getToken();
    if (observed && !session.tokens.has(observed)) {
      // A server reload starts a new baseline; never rebase an old draft onto it.
      session.tokens.clear();
      session.tokens.add(observed);
      session.latest = observed;
      session.conflict = null;
    }
    if (session.conflict) throw session.conflict;
    const token = submittedToken === undefined || session.tokens.has(submittedToken)
      ? session.latest ?? submittedToken
      : submittedToken;
    let committed: MutationResult<T>;
    try {
      committed = await operation(token);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "VERSION_CONFLICT") {
        session.conflict = error;
      }
      throw error;
    }
    if (!session.active) return committed.value;
    if (committed.version.id !== versionId) {
      throw new Error("Le jeton reçu appartient à une autre version.");
    }
    if (token) session.tokens.add(token);
    session.latest = committed.version.updated_at;
    session.tokens.add(session.latest);
    session.observer.onCommit(committed);
    return committed.value;
  });
  session.tail = result.then(() => undefined, () => undefined).finally(() => {
    session.pending -= 1;
    if (session.active) session.observer.onPendingChange(session.pending > 0);
  });
  return result;
}
