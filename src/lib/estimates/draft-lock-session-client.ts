import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";

const ESTIMATE_DRAFT_LOCK_SESSION_STORE_KEY =
  "__miaouffrageEstimateDraftLockSessions";
const ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX =
  "__miaouffrageEstimateDraftLockSession:";

type EstimateDraftLockSessionGlobal = typeof globalThis & {
  __miaouffrageEstimateDraftLockSessions?: Map<string, string>;
};

function createEstimateDraftLockSessionId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return randomUuid;

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (digit) =>
    (
      Number(digit) ^
      ((Math.random() * 16) >> (Number(digit) / 4))
    ).toString(16)
  );
}

function getReloadedEstimateDraftLockSessionId(versionId: string) {
  try {
    const navigationEntry = globalThis.performance
      ?.getEntriesByType?.("navigation")
      .at(0) as PerformanceNavigationTiming | undefined;
    if (navigationEntry?.type !== "reload") return null;

    return normalizeEstimateDraftLockSessionId(
      globalThis.sessionStorage?.getItem(
        `${ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX}${versionId}`
      )
    );
  } catch {
    return null;
  }
}

function persistEstimateDraftLockSessionId(
  versionId: string,
  sessionId: string
) {
  try {
    globalThis.sessionStorage?.setItem(
      `${ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX}${versionId}`,
      sessionId
    );
  } catch {
    // Private browsing and hardened policies can deny session storage. The
    // in-memory identity still keeps the current document internally stable.
  }
}

export function getEstimateDraftLockSessionId(versionId: string) {
  const scope = globalThis as EstimateDraftLockSessionGlobal;
  const store =
    scope[ESTIMATE_DRAFT_LOCK_SESSION_STORE_KEY] ??
    new Map<string, string>();
  scope[ESTIMATE_DRAFT_LOCK_SESSION_STORE_KEY] = store;

  const existingSessionId = store.get(versionId);
  if (existingSessionId) {
    persistEstimateDraftLockSessionId(versionId, existingSessionId);
    return existingSessionId;
  }

  const sessionId =
    getReloadedEstimateDraftLockSessionId(versionId) ??
    createEstimateDraftLockSessionId();
  store.set(versionId, sessionId);
  persistEstimateDraftLockSessionId(versionId, sessionId);
  return sessionId;
}
