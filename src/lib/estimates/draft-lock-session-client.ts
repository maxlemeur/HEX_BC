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

function appendTabEstimateDraftLockSessionHistory(
  versionId: string,
  sessionId: string
) {
  try {
    const history = readTabEstimateDraftLockSessionHistory(versionId).filter(
      (value) => value !== sessionId
    );
    history.push(sessionId);
    globalThis.sessionStorage?.setItem(
      `${ESTIMATE_DRAFT_LOCK_SESSION_HISTORY_PREFIX}${versionId}`,
      JSON.stringify(history.slice(-MAX_TAB_SESSION_HISTORY))
    );
  } catch {
    // Without this history the tab only loses the handover of
    // isOrphanedTabEstimateDraftLockSession, which then answers no.
  }
}

// Identités retirées par ce document (voir retireEstimateDraftLockSessionId) :
// elles ne sont plus réécrites comme identité courante de l'onglet.
const retiredSessionIds = new Set<string>();

function persistEstimateDraftLockSessionId(
  versionId: string,
  sessionId: string
) {
  if (retiredSessionIds.has(sessionId)) return;
  const key = `${ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX}${versionId}`;
  let previousSessionId: string | null = null;
  try {
    previousSessionId = normalizeEstimateDraftLockSessionId(
      globalThis.sessionStorage?.getItem(key)
    );
    globalThis.sessionStorage?.setItem(key, sessionId);
  } catch {
    // Private browsing and hardened policies can deny session storage. The
    // in-memory identity still keeps the current document internally stable.
    return;
  }
  // L'identité qu'un document précédent de cet onglet a utilisée reste
  // connue de l'onglet : seul un document suivant peut libérer un bail qu'elle
  // aurait laissé (voir isOrphanedTabEstimateDraftLockSession).
  if (previousSessionId && previousSessionId !== sessionId) {
    appendTabEstimateDraftLockSessionHistory(versionId, previousSessionId);
  }
}

const livenessHeldSessionIds = new Set<string>();

/**
 * Un document qui demande un bail garde un Web Lock au nom de son identité
 * jusqu'à sa destruction : le navigateur le relâche lui-même quand le document
 * disparaît (navigation complète, fermeture, plantage), y compris quand aucun
 * script ne peut plus s'exécuter. Chromium et Firefox excluent alors la page du
 * cache de navigation ; WebKit relâche le verrou en l'y plaçant, et la page le
 * redemande à sa demande de bail suivante.
 */
export function holdEstimateDraftLockSessionLiveness(sessionId: string) {
  if (livenessHeldSessionIds.has(sessionId)) return;
  livenessHeldSessionIds.add(sessionId);
  try {
    const request = globalThis.navigator?.locks?.request(
      `${ESTIMATE_DRAFT_LOCK_SESSION_LIVENESS_PREFIX}${sessionId}`,
      () => new Promise<never>(() => undefined)
    );
    void request?.catch(() => {
      livenessHeldSessionIds.delete(sessionId);
    });
  } catch {
    livenessHeldSessionIds.delete(sessionId);
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
    return existingSessionId;
  }

  const sessionId =
    getReloadedEstimateDraftLockSessionId(versionId) ??
    createEstimateDraftLockSessionId();
  store.set(versionId, sessionId);
  persistEstimateDraftLockSessionId(versionId, sessionId);
  return sessionId;
}

/**
 * Le document qui disparaît en libérant un bail obtenu pendant son départ
 * retire son identité de l'onglet : un rechargement en crée alors une nouvelle,
 * qu'une libération en retard de l'ancienne ne peut pas atteindre (NAV04b).
 * Un bail de l'ancienne identité qui subsisterait reste libérable par le
 * document suivant, puisqu'elle passe dans l'historique de l'onglet.
 */
export function retireEstimateDraftLockSessionId(versionId: string) {
  const scope = globalThis as EstimateDraftLockSessionGlobal;
  const sessionId = scope[ESTIMATE_DRAFT_LOCK_SESSION_STORE_KEY]?.get(versionId);
  if (!sessionId) return;
  retiredSessionIds.add(sessionId);
  try {
    const key = `${ESTIMATE_DRAFT_LOCK_SESSION_STORAGE_PREFIX}${versionId}`;
    if (normalizeEstimateDraftLockSessionId(globalThis.sessionStorage?.getItem(key)) !== sessionId) return;
    appendTabEstimateDraftLockSessionHistory(versionId, sessionId);
    globalThis.sessionStorage?.removeItem(key);
  } catch {
    // The reload then keeps this identity, as before this release.
  }
}

/**
 * Vrai seulement pour un bail laissé par un document mort de ce même onglet
 * (CORE-06, TI-665) : un document qui part pendant son chargement peut encore
 * envoyer sa demande de bail, que le serveur conserve sans que personne ne la
 * libère ; une libération envoyée au départ peut aussi se perdre. Le document
 * suivant de l'onglet a une autre identité de page.
 *
 * L'identité doit être l'une de celles que cet onglet a utilisées pour cette
 * version, ce qui exclut les autres appareils, navigateurs et profils. Une copie
 * d'onglet (popup, onglet dupliqué) hérite de cet historique : elle ne peut
 * libérer qu'un bail dont aucun document vivant ne détient l'identité, et reste
 * en lecture seule tant que sa source vit. Sans stockage de session ou sans
 * Web Locks, la réponse est non, comme avant ce contrôle.
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
