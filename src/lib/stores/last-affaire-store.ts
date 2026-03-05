// ---------------------------------------------------------------------------
// External store for the last-visited affaire (project) ID.
// Pattern: useSyncExternalStore (see useIsTablet.ts for precedent).
// Key is profile-scoped to avoid cross-account leaks.
// ---------------------------------------------------------------------------

const KEY_PREFIX = "hex-last-affaire:v1";

function getKey(pid: string | null): string {
  return pid ? `${KEY_PREFIX}:${pid}` : KEY_PREFIX;
}

type StoreState = { projectId: string | null };

let state: StoreState = { projectId: null };
let profileId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function initStore(pid: string | null) {
  profileId = pid;
  try {
    const raw = localStorage.getItem(getKey(profileId));
    if (raw) {
      const parsed = JSON.parse(raw);
      state = { projectId: parsed?.projectId ?? null };
    }
  } catch {
    /* ignore */
  }
  emit();
}

export function setLastAffaire(projectId: string) {
  state = { projectId };
  try {
    localStorage.setItem(
      getKey(profileId),
      JSON.stringify({ projectId, ts: Date.now() })
    );
  } catch {
    /* ignore */
  }
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): string | null {
  return state.projectId;
}

export function getServerSnapshot(): null {
  return null;
}

/** Reset internal state — only for tests. */
export function _resetForTest() {
  state = { projectId: null };
  profileId = null;
  listeners.clear();
}
