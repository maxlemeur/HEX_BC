import { isRecord, getRootPayload, pickRecord, toStringValue, toBooleanValue, extractBoolean } from "@/lib/estimates/client-json";
import { isEstimateApiError } from "@/lib/estimates/client-errors";
import { requestJsonUncoordinated as requestJson } from "@/lib/estimates/client-http";
import { ESTIMATE_DRAFT_LOCK_SESSION_HEADER, normalizeEstimateDraftLockSessionId } from "@/lib/estimates/lock-session";
import { getEstimateDraftLockSessionId, holdEstimateDraftLockSessionLiveness, retireEstimateDraftLockSessionId } from "@/lib/estimates/draft-lock-session-client";

export type EstimateDraftLock = {
  versionId: string;
  userId: string | null;
  holderName: string | null;
  lockedAt: string | null;
  expiresAt: string | null;
  isOwnedByCurrentUser: boolean | null;
  isOwnedByCurrentSession: boolean | null;
  /** Identité de page du détenteur, telle que le serveur l'expose (`session_id`). */
  sessionId?: string | null;
};

export type AcquireEstimateDraftLockResult = {
  acquired: boolean;
  lock: EstimateDraftLock | null;
};

export type RenewEstimateDraftLockResult = {
  renewed: boolean;
  lock: EstimateDraftLock | null;
};

export type ReleaseEstimateDraftLockOptions = {
  force?: boolean;
  keepalive?: boolean;
  /**
   * Libère le bail d'une autre identité de page que celle de ce document :
   * réservé au bail laissé par un document mort de cet onglet (TI-665).
   */
  sessionId?: string;
};

export type ReleaseEstimateDraftLockResult = {
  released: boolean;
};

export function parseEstimateDraftLock(
  payload: unknown,
  fallbackVersionId?: string
): EstimateDraftLock | null {
  const root = getRootPayload(payload);
  if (!isRecord(root)) return null;

  const lockEntity =
    pickRecord(root, ["lock", "draft_lock", "draftLock"]) ??
    pickRecord(root, ["data"]) ??
    root;

  const holderEntity = pickRecord(lockEntity, [
    "holder",
    "owner",
    "profile",
    "profiles",
    "locked_by",
  ]);

  const versionId =
    toStringValue(lockEntity.version_id) ??
    toStringValue(lockEntity.versionId) ??
    toStringValue(root.version_id) ??
    toStringValue(root.versionId) ??
    fallbackVersionId ??
    null;

  if (!versionId) return null;

  const userId =
    toStringValue(lockEntity.user_id) ??
    toStringValue(lockEntity.userId) ??
    toStringValue(lockEntity.locked_by_user_id) ??
    (holderEntity
      ? toStringValue(holderEntity.user_id) ?? toStringValue(holderEntity.id)
      : null) ??
    null;

  const holderName =
    toStringValue(lockEntity.holder_name) ??
    toStringValue(lockEntity.holderName) ??
    toStringValue(lockEntity.locked_by_name) ??
    toStringValue(lockEntity.lockedByName) ??
    (holderEntity
      ? toStringValue(holderEntity.full_name) ??
        toStringValue(holderEntity.fullName) ??
        toStringValue(holderEntity.name)
      : null) ??
    null;

  const lockedAt =
    toStringValue(lockEntity.locked_at) ??
    toStringValue(lockEntity.lockedAt) ??
    null;

  const expiresAt =
    toStringValue(lockEntity.expires_at) ??
    toStringValue(lockEntity.expiresAt) ??
    null;

  const isOwnedByCurrentUser =
    toBooleanValue(lockEntity.is_current_user) ??
    toBooleanValue(lockEntity.isCurrentUser) ??
    toBooleanValue(lockEntity.is_owner) ??
    toBooleanValue(lockEntity.isOwnedByCurrentUser) ??
    toBooleanValue(lockEntity.owned_by_current_user) ??
    toBooleanValue(lockEntity.ownedByCurrentUser) ??
    toBooleanValue(root.is_owner) ??
    toBooleanValue(root.isOwnedByCurrentUser) ??
    toBooleanValue(root.owned_by_current_user) ??
    toBooleanValue(root.ownedByCurrentUser) ??
    null;

  const isOwnedByCurrentSession =
    toBooleanValue(lockEntity.is_current_session) ??
    toBooleanValue(lockEntity.isCurrentSession) ??
    toBooleanValue(lockEntity.is_owned_by_current_session) ??
    toBooleanValue(lockEntity.isOwnedByCurrentSession) ??
    toBooleanValue(root.is_current_session) ??
    toBooleanValue(root.isOwnedByCurrentSession) ??
    null;

  const sessionId = normalizeEstimateDraftLockSessionId(
    toStringValue(lockEntity.session_id) ?? toStringValue(lockEntity.sessionId)
  );

  return {
    versionId,
    userId,
    holderName,
    lockedAt,
    expiresAt,
    isOwnedByCurrentUser,
    isOwnedByCurrentSession,
    sessionId,
  };
}

export function buildEstimateDraftLockPath(
  versionId: string,
  options?: { force?: boolean }
) {
  const query = new URLSearchParams();
  if (options?.force) {
    query.set("force", "1");
  }

  const basePath = `/api/estimates/${versionId}/lock`;
  const queryString = query.toString();
  if (!queryString) return basePath;
  return `${basePath}?${queryString}`;
}

const draftLeaseRequestsInFlight = new Map<string, number>();

const draftLeasesGrantedWhileLeaving = new Set<string>();

let hasDocumentStartedLeaving = false;

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    hasDocumentStartedLeaving = true;
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) hasDocumentStartedLeaving = false;
  });
  window.addEventListener("pagehide", (event) => {
    // A page kept in the back/forward cache may come back and still uses its lease.
    if (event.persisted) return;
    const released = [...new Set([...draftLeasesGrantedWhileLeaving, ...draftLeaseRequestsInFlight.keys()])];
    for (const versionId of released) {
      void releaseEstimateDraftLock(versionId, { keepalive: true }).catch(() => undefined);
    }
    // After the release is sent, so that a reload cannot reuse this identity: a delayed DELETE
    // (scoped by version, user and session) would otherwise delete the reloaded document's lease.
    // A request still in flight may land after its DELETE; the next document of the tab hands
    // that rest over from the retired identity (useDraftLock).
    released.forEach(retireEstimateDraftLockSessionId);
  });
}

async function requestDraftLease<T extends { acquired: boolean }>(
  versionId: string,
  request: () => Promise<T>
) {
  holdEstimateDraftLockSessionLiveness(getEstimateDraftLockSessionId(versionId));
  draftLeaseRequestsInFlight.set(versionId, (draftLeaseRequestsInFlight.get(versionId) ?? 0) + 1);
  // null: unknown outcome (lost reply, server error), counted as granted.
  let granted: boolean | null = null;
  try {
    const result = await request();
    granted = result.acquired;
    return result;
  } catch (error) {
    if (isEstimateApiError(error) && error.status < 500) granted = false;
    throw error;
  } finally {
    const remaining = (draftLeaseRequestsInFlight.get(versionId) ?? 1) - 1;
    if (remaining > 0) draftLeaseRequestsInFlight.set(versionId, remaining);
    else draftLeaseRequestsInFlight.delete(versionId);
    if (granted === false) draftLeasesGrantedWhileLeaving.delete(versionId);
    else if (hasDocumentStartedLeaving) draftLeasesGrantedWhileLeaving.add(versionId);
  }
}

export function acquireEstimateDraftLock(
  versionId: string
): Promise<AcquireEstimateDraftLockResult> {
  return requestDraftLease(versionId, () => requestEstimateDraftLockAcquisition(versionId));
}

export function takeoverEstimateDraftLock(
  versionId: string
): Promise<AcquireEstimateDraftLockResult> {
  return requestDraftLease(versionId, () => requestEstimateDraftLockTakeover(versionId));
}

export function renewEstimateDraftLock(
  versionId: string
): Promise<RenewEstimateDraftLockResult> {
  holdEstimateDraftLockSessionLiveness(getEstimateDraftLockSessionId(versionId));
  return requestEstimateDraftLockRenewal(versionId);
}

export async function releaseEstimateDraftLock(
  versionId: string,
  options: ReleaseEstimateDraftLockOptions = {}
): Promise<ReleaseEstimateDraftLockResult> {
  if (!options.sessionId) draftLeasesGrantedWhileLeaving.delete(versionId);
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId, { force: options.force }),
      {
        method: "DELETE",
        keepalive: options.keepalive,
        ...(options.sessionId
          ? { headers: { [ESTIMATE_DRAFT_LOCK_SESSION_HEADER]: options.sessionId } }
          : {}),
      },
      options.force
        ? "Impossible de forcer le déverrouillage."
        : "Impossible de libérer le verrou de brouillon."
    );

    const released =
      extractBoolean(payload, ["released", "ok", "success"]) ?? true;

    return {
      released,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 404) {
      return {
        released: true,
      };
    }
    throw error;
  }
}

export async function requestEstimateDraftLockAcquisition(
  versionId: string
): Promise<AcquireEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId),
      {
        method: "POST",
      },
      "Impossible d'acquérir le verrou de brouillon."
    );

    const lock = parseEstimateDraftLock(payload, versionId);
    const acquired =
      extractBoolean(payload, ["acquired", "is_acquired"]) ??
      lock?.isOwnedByCurrentSession ??
      true;

    return {
      acquired,
      lock,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 409) {
      return {
        acquired: false,
        lock: parseEstimateDraftLock(error.details, versionId),
      };
    }
    throw error;
  }
}

export async function requestEstimateDraftLockRenewal(
  versionId: string
): Promise<RenewEstimateDraftLockResult> {
  try {
    const payload = await requestJson<unknown>(
      buildEstimateDraftLockPath(versionId),
      {
        method: "PATCH",
      },
      "Impossible de renouveler le verrou de brouillon."
    );

    const lock = parseEstimateDraftLock(payload, versionId);
    const renewed =
      extractBoolean(payload, ["renewed", "is_renewed"]) ??
      lock?.isOwnedByCurrentSession ??
      true;

    return {
      renewed,
      lock,
    };
  } catch (error) {
    if (isEstimateApiError(error) && error.status === 409) {
      return {
        renewed: false,
        lock: parseEstimateDraftLock(error.details, versionId),
      };
    }
    throw error;
  }
}

export async function requestEstimateDraftLockTakeover(
  versionId: string
): Promise<AcquireEstimateDraftLockResult> {
  const payload = await requestJson<unknown>(
    buildEstimateDraftLockPath(versionId, { force: true }),
    {
      method: "PATCH",
    },
    "Impossible de reprendre le verrou de brouillon."
  );

  const lock = parseEstimateDraftLock(payload, versionId);
  return {
    acquired: lock?.isOwnedByCurrentSession ?? true,
    lock,
  };
}
