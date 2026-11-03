import { normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";

const ESTIMATE_DRAFT_LOCK_SESSION_STORE_KEY =
  "__miaouffrageEstimateDraftLockSessions";
const ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX =
  "__miaouffrageEstimateDraftLockSession:";
const ESTIMATE_DRAFT_LOCK_SESSION_HISTORY_PREFIX =
  "__miaouffrageEstimateDraftLockSessionHistory:";
const ESTIMATE_DRAFT_LOCK_SESSION_LIVENESS_PREFIX =
  "miaouffrage-estimate-draft-lock-session:";
const MAX_TAB_SESSION_HISTORY = 8;

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

function readTabEstimateDraftLockSessionHistory(versionId: string) {
  try {
    const raw = globalThis.sessionStorage?.getItem(
      `${ESTIMATE_DRAFT_LOCK_SESSION_HISTORY_PREFIX}${versionId}`
    );
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      const sessionId = normalizeEstimateDraftLockSessionId(
        typeof value === "string" ? value : null
      );
      return sessionId ? [sessionId] : [];
    });
  } catch {
    return [];
  }
}

function persistEstimateDraftLockSessionId(
  versionId: string,
  sessionId: string
) {
  try {
    const key = `${ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX}${versionId}`;
    // L'identité qu'un document précédent de cet onglet a utilisée reste
    // connue de l'onglet : seul son successeur peut libérer un bail qu'elle
    // aurait laissé (voir isOrphanedTabEstimateDraftLockSession).
    const previousSessionId = normalizeEstimateDraftLockSessionId(
      globalThis.sessionStorage?.getItem(key)
    );
    if (previousSessionId && previousSessionId !== sessionId) {
      const history = readTabEstimateDraftLockSessionHistory(versionId).filter(
        (value) => value !== previousSessionId
      );
      history.push(previousSessionId);
      globalThis.sessionStorage?.setItem(
        `${ESTIMATE_DRAFT_LOCK_SESSION_HISTORY_PREFIX}${versionId}`,
        JSON.stringify(history.slice(-MAX_TAB_SESSION_HISTORY))
      );
    }
    globalThis.sessionStorage?.setItem(key, sessionId);
  } catch {
    // Private browsing and hardened policies can deny session storage. The
    // in-memory identity still keeps the current document internally stable.
  }
}

const livenessHeldSessionIds = new Set<string>();

/**
 * Le document garde un Web Lock au nom de son identité jusqu'à sa destruction :
 * le navigateur le relâche lui-même quand le document disparaît (navigation
 * complète, fermeture, plantage), y compris quand aucun script ne peut plus
 * s'exécuter. Un document gelé en cache de navigation le conserve.
 */
function holdEstimateDraftLockSessionLiveness(sessionId: string) {
  if (livenessHeldSessionIds.has(sessionId)) return;
  livenessHeldSessionIds.add(sessionId);
  try {
    void globalThis.navigator?.locks
      ?.request(
        `${ESTIMATE_DRAFT_LOCK_SESSION_LIVENESS_PREFIX}${sessionId}`,
        () => new Promise<never>(() => undefined)
      )
      .catch(() => undefined);
  } catch {
    // Without Web Locks no other document can prove this one dead: see
    // isEstimateDraftLockSessionAlive, which then answers alive.
  }
}

async function isEstimateDraftLockSessionAlive(sessionId: string) {
  try {
    const locks = globalThis.navigator?.locks;
    if (!locks) return true;
    const name = `${ESTIMATE_DRAFT_LOCK_SESSION_LIVENESS_PREFIX}${sessionId}`;
    const snapshot = await locks.query();
    return [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].some(
      (lock) => lock.name === name
    );
  } catch {
    return true;
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
    holdEstimateDraftLockSessionLiveness(existingSessionId);
    return existingSessionId;
  }

  const sessionId =
    getReloadedEstimateDraftLockSessionId(versionId) ??
    createEstimateDraftLockSessionId();
  store.set(versionId, sessionId);
  persistEstimateDraftLockSessionId(versionId, sessionId);
  holdEstimateDraftLockSessionLiveness(sessionId);
  return sessionId;
}

/**
 * Vrai seulement pour un bail laissé par un document mort de ce même onglet
 * (CORE-06, TI-665) : un document qui part pendant son chargement peut encore
 * envoyer sa demande de bail, que le serveur conserve sans que personne ne la
 * libère. Son successeur dans l'onglet a une autre identité de page.
 *
 * L'identité doit être l'une de celles que cet onglet a utilisées pour cette
 * version, ce qui exclut les autres appareils, navigateurs et profils. Aucun
 * document vivant ne doit la détenir : une copie d'onglet (popup, onglet
 * dupliqué) dont la source vit reste en lecture seule. Sans stockage de session
 * ou sans Web Locks, la réponse est non, comme avant ce contrôle.
 */
export async function isOrphanedTabEstimateDraftLockSession(
  versionId: string,
  holderSessionId: string | null | undefined
) {
  const sessionId = normalizeEstimateDraftLockSessionId(holderSessionId);
  if (!sessionId || sessionId === getEstimateDraftLockSessionId(versionId)) {
    return false;
  }
  if (!readTabEstimateDraftLockSessionHistory(versionId).includes(sessionId)) {
    return false;
  }
  return !(await isEstimateDraftLockSessionAlive(sessionId));
}
