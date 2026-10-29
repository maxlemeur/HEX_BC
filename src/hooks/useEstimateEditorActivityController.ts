"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { fetchEstimateVersionEvents, type EstimateVersionEvent } from "@/lib/estimates/client";
import { normalizeEstimateEditorIdentity } from "@/lib/estimates/editor-document-state";
import type { Database } from "@/types/database";

const AUDIT_LOG_LIMIT = 25;
const AUDIT_LOAD_ERROR = "Impossible de charger les logs d'audit.";
const TIMELINE_LOAD_ERROR =
  "Impossible de charger la timeline des événements.";

export type EstimateEditorAuditLogEntry = Pick<
  Database["public"]["Tables"]["audit_logs"]["Row"],
  "id" | "created_at" | "action" | "table_name" | "record_id"
>;

type ActivityLoader<T> = (
  versionId: string,
  signal: AbortSignal
) => Promise<T[]>;

type EstimateEditorActivityControllerInput = {
  actorId: string | null;
  tenantId: string | null;
  routeVersionId: string | null;
  isAdmin: boolean;
  loadAuditEntries?: ActivityLoader<EstimateEditorAuditLogEntry>;
  loadTimelineEvents?: ActivityLoader<EstimateVersionEvent>;
};

type ActivityLoadState = {
  error: string | null;
  isLoading: boolean;
};

type AuditActivityState = ActivityLoadState & {
  entries: EstimateEditorAuditLogEntry[];
};

type TimelineActivityState = ActivityLoadState & {
  events: EstimateVersionEvent[];
};

export type EstimateEditorActivityController = {
  state: {
    audit: AuditActivityState;
    timeline: TimelineActivityState;
  };
  actions: {
    refreshAudit: () => Promise<void>;
    refreshTimeline: () => Promise<void>;
    refreshAll: () => Promise<void>;
  };
  meta: {
    isEnabled: boolean;
  };
};

type RequestSlot = {
  controller: AbortController | null;
  generation: number;
};

type ActiveScope = {
  isEnabled: boolean;
  routeVersionId: string | null;
  scopeKey: string | null;
};

type ActivityAccessSession = {
  isEnabled: boolean;
  identityKey: string;
  generation: number;
};

type ScopedAuditActivityState = {
  scopeKey: string;
  value: AuditActivityState;
};

type ScopedTimelineActivityState = {
  scopeKey: string;
  value: TimelineActivityState;
};

const EMPTY_AUDIT_STATE: AuditActivityState = {
  entries: [],
  error: null,
  isLoading: false,
};

const EMPTY_TIMELINE_STATE: TimelineActivityState = {
  events: [],
  error: null,
  isLoading: false,
};

const LOADING_AUDIT_STATE: AuditActivityState = {
  ...EMPTY_AUDIT_STATE,
  isLoading: true,
};

const LOADING_TIMELINE_STATE: TimelineActivityState = {
  ...EMPTY_TIMELINE_STATE,
  isLoading: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNonEmptyString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveActivityErrorMessage(payload: unknown, fallback: string) {
  if (!isRecord(payload)) return fallback;
  const nestedError = isRecord(payload.error) ? payload.error : null;
  return (
    toNonEmptyString(payload.error) ??
    toNonEmptyString(nestedError?.message) ??
    toNonEmptyString(payload.message) ??
    fallback
  );
}

function normalizeAuditEntries(
  payload: unknown
): EstimateEditorAuditLogEntry[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];

  return payload.data
    .map((entry) => {
      if (!isRecord(entry)) return null;

      const id = toNonEmptyString(entry.id);
      const createdAt = toNonEmptyString(entry.created_at);
      const action = toNonEmptyString(entry.action);
      const tableName = toNonEmptyString(entry.table_name);
      const recordId = toNonEmptyString(entry.record_id);

      if (!id || !createdAt || !action || !tableName || !recordId) {
        return null;
      }

      return {
        id,
        created_at: createdAt,
        action,
        table_name: tableName,
        record_id: recordId,
      };
    })
    .filter(
      (entry): entry is EstimateEditorAuditLogEntry => entry !== null
    );
}

async function defaultLoadAuditEntries(
  versionId: string,
  signal: AbortSignal
) {
  const response = await fetch(
    `/api/audit?estimate_version_id=${encodeURIComponent(
      versionId
    )}&limit=${AUDIT_LOG_LIMIT}`,
    {
      credentials: "same-origin",
      signal,
    }
  );
  const payload = (await response.json().catch(() => null)) as unknown;

  if (!response.ok) {
    throw new Error(resolveActivityErrorMessage(payload, AUDIT_LOAD_ERROR));
  }

  return normalizeAuditEntries(payload);
}

async function defaultLoadTimelineEvents(
  versionId: string,
  signal: AbortSignal
) {
  signal.throwIfAborted();
  const events = await fetchEstimateVersionEvents(versionId, { signal });
  // The shared reader owns validation; this controller still owns cancellation
  // and prevents an obsolete read from publishing after navigation or access loss.
  signal.throwIfAborted();
  return events;
}

function cancelRequest(slot: MutableRefObject<RequestSlot>) {
  slot.current.controller?.abort();
  slot.current = {
    controller: null,
    generation: slot.current.generation + 1,
  };
}

function resolveLoadError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function formatEstimateEditorAuditTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("fr-FR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function useEstimateEditorActivityController({
  actorId,
  tenantId,
  routeVersionId: rawRouteVersionId,
  isAdmin,
  loadAuditEntries = defaultLoadAuditEntries,
  loadTimelineEvents = defaultLoadTimelineEvents,
}: EstimateEditorActivityControllerInput): EstimateEditorActivityController {
  const routeVersionId = normalizeEstimateEditorIdentity(rawRouteVersionId);
  const identityKey = JSON.stringify([
    normalizeEstimateEditorIdentity(actorId),
    normalizeEstimateEditorIdentity(tenantId),
    routeVersionId,
  ]);
  const isEnabled = Boolean(isAdmin && actorId && tenantId && routeVersionId);
  const [accessSession, setAccessSession] =
    useState<ActivityAccessSession>(() => ({
      isEnabled,
      identityKey,
      generation: 0,
    }));
  const hasAccessSessionChanged =
    accessSession.isEnabled !== isEnabled ||
    accessSession.identityKey !== identityKey;
  const currentAccessSession = hasAccessSessionChanged
    ? {
        isEnabled,
        identityKey,
        generation: accessSession.generation + 1,
      }
    : accessSession;
  if (hasAccessSessionChanged) {
    setAccessSession(currentAccessSession);
  }
  const scopeKey =
    isEnabled && routeVersionId
      ? JSON.stringify([identityKey, currentAccessSession.generation])
      : null;
  const [auditSnapshot, setAuditSnapshot] =
    useState<ScopedAuditActivityState | null>(null);
  const [timelineSnapshot, setTimelineSnapshot] =
    useState<ScopedTimelineActivityState | null>(null);
  const activeScopeRef = useRef<ActiveScope>({
    isEnabled,
    routeVersionId,
    scopeKey,
  });
  const scopeGenerationRef = useRef(0);
  const auditRequestRef = useRef<RequestSlot>({
    controller: null,
    generation: 0,
  });
  const timelineRequestRef = useRef<RequestSlot>({
    controller: null,
    generation: 0,
  });

  const cancelAllRequests = useCallback(() => {
    cancelRequest(auditRequestRef);
    cancelRequest(timelineRequestRef);
  }, []);

  useLayoutEffect(() => {
    activeScopeRef.current = { isEnabled, routeVersionId, scopeKey };
    scopeGenerationRef.current += 1;
    cancelAllRequests();
  }, [cancelAllRequests, isEnabled, routeVersionId, scopeKey]);

  const loadAuditForCurrentScope = useCallback(async () => {
    if (!isEnabled || !routeVersionId || !scopeKey) return;
    if (
      !activeScopeRef.current.isEnabled ||
      activeScopeRef.current.routeVersionId !== routeVersionId ||
      activeScopeRef.current.scopeKey !== scopeKey
    ) {
      return;
    }

    auditRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestGeneration = auditRequestRef.current.generation + 1;
    const scopeGeneration = scopeGenerationRef.current;
    auditRequestRef.current = {
      controller,
      generation: requestGeneration,
    };

    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      scopeGenerationRef.current === scopeGeneration &&
      activeScopeRef.current.isEnabled &&
      activeScopeRef.current.routeVersionId === routeVersionId &&
      auditRequestRef.current.controller === controller &&
      auditRequestRef.current.generation === requestGeneration;

    try {
      const entries = await loadAuditEntries(
        routeVersionId,
        controller.signal
      );
      if (!isCurrentRequest()) return;
      setAuditSnapshot({
        scopeKey,
        value: { entries, error: null, isLoading: false },
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      setAuditSnapshot({
        scopeKey,
        value: {
          entries: [],
          error: resolveLoadError(error, AUDIT_LOAD_ERROR),
          isLoading: false,
        },
      });
    } finally {
      if (
        auditRequestRef.current.controller === controller &&
        auditRequestRef.current.generation === requestGeneration
      ) {
        auditRequestRef.current = {
          controller: null,
          generation: requestGeneration,
        };
      }
    }
  }, [isEnabled, loadAuditEntries, routeVersionId, scopeKey]);

  const loadTimelineForCurrentScope = useCallback(async () => {
    if (!isEnabled || !routeVersionId || !scopeKey) return;
    if (
      !activeScopeRef.current.isEnabled ||
      activeScopeRef.current.routeVersionId !== routeVersionId ||
      activeScopeRef.current.scopeKey !== scopeKey
    ) {
      return;
    }

    timelineRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const requestGeneration = timelineRequestRef.current.generation + 1;
    const scopeGeneration = scopeGenerationRef.current;
    timelineRequestRef.current = {
      controller,
      generation: requestGeneration,
    };

    const isCurrentRequest = () =>
      !controller.signal.aborted &&
      scopeGenerationRef.current === scopeGeneration &&
      activeScopeRef.current.isEnabled &&
      activeScopeRef.current.routeVersionId === routeVersionId &&
      timelineRequestRef.current.controller === controller &&
      timelineRequestRef.current.generation === requestGeneration;

    try {
      const entries = await loadTimelineEvents(
        routeVersionId,
        controller.signal
      );
      if (!isCurrentRequest()) return;
      setTimelineSnapshot({
        scopeKey,
        value: { events: entries, error: null, isLoading: false },
      });
    } catch (error) {
      if (!isCurrentRequest()) return;
      setTimelineSnapshot({
        scopeKey,
        value: {
          events: [],
          error: resolveLoadError(error, TIMELINE_LOAD_ERROR),
          isLoading: false,
        },
      });
    } finally {
      if (
        timelineRequestRef.current.controller === controller &&
        timelineRequestRef.current.generation === requestGeneration
      ) {
        timelineRequestRef.current = {
          controller: null,
          generation: requestGeneration,
        };
      }
    }
  }, [isEnabled, loadTimelineEvents, routeVersionId, scopeKey]);

  const refreshAudit = useCallback(async () => {
    if (!scopeKey || activeScopeRef.current.scopeKey !== scopeKey) return;
    setAuditSnapshot((previous) => ({
      scopeKey,
      value: {
        ...(previous?.scopeKey === scopeKey
          ? previous.value
          : EMPTY_AUDIT_STATE),
        error: null,
        isLoading: true,
      },
    }));
    await loadAuditForCurrentScope();
  }, [loadAuditForCurrentScope, scopeKey]);

  const refreshTimeline = useCallback(async () => {
    if (!scopeKey || activeScopeRef.current.scopeKey !== scopeKey) return;
    setTimelineSnapshot((previous) => ({
      scopeKey,
      value: {
        ...(previous?.scopeKey === scopeKey
          ? previous.value
          : EMPTY_TIMELINE_STATE),
        error: null,
        isLoading: true,
      },
    }));
    await loadTimelineForCurrentScope();
  }, [loadTimelineForCurrentScope, scopeKey]);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshAudit(), refreshTimeline()]);
  }, [refreshAudit, refreshTimeline]);

  useEffect(() => {
    if (!isEnabled || !routeVersionId || !scopeKey) return cancelAllRequests;

    const targetVersionId = routeVersionId;
    const targetScopeKey = scopeKey;
    const scopeGeneration = scopeGenerationRef.current;

    auditRequestRef.current.controller?.abort();
    const auditController = new AbortController();
    const auditGeneration = auditRequestRef.current.generation + 1;
    auditRequestRef.current = {
      controller: auditController,
      generation: auditGeneration,
    };

    timelineRequestRef.current.controller?.abort();
    const timelineController = new AbortController();
    const timelineGeneration = timelineRequestRef.current.generation + 1;
    timelineRequestRef.current = {
      controller: timelineController,
      generation: timelineGeneration,
    };

    const isAuditRequestCurrent = () =>
      !auditController.signal.aborted &&
      scopeGenerationRef.current === scopeGeneration &&
      activeScopeRef.current.isEnabled &&
      activeScopeRef.current.routeVersionId === targetVersionId &&
      auditRequestRef.current.controller === auditController &&
      auditRequestRef.current.generation === auditGeneration;
    const isTimelineRequestCurrent = () =>
      !timelineController.signal.aborted &&
      scopeGenerationRef.current === scopeGeneration &&
      activeScopeRef.current.isEnabled &&
      activeScopeRef.current.routeVersionId === targetVersionId &&
      timelineRequestRef.current.controller === timelineController &&
      timelineRequestRef.current.generation === timelineGeneration;

    void loadAuditEntries(targetVersionId, auditController.signal)
      .then((entries) => {
        if (!isAuditRequestCurrent()) return;
        setAuditSnapshot({
          scopeKey: targetScopeKey,
          value: { entries, error: null, isLoading: false },
        });
      })
      .catch((error) => {
        if (!isAuditRequestCurrent()) return;
        setAuditSnapshot({
          scopeKey: targetScopeKey,
          value: {
            entries: [],
            error: resolveLoadError(error, AUDIT_LOAD_ERROR),
            isLoading: false,
          },
        });
      })
      .finally(() => {
        if (
          auditRequestRef.current.controller === auditController &&
          auditRequestRef.current.generation === auditGeneration
        ) {
          auditRequestRef.current = {
            controller: null,
            generation: auditGeneration,
          };
        }
      });

    void loadTimelineEvents(targetVersionId, timelineController.signal)
      .then((events) => {
        if (!isTimelineRequestCurrent()) return;
        setTimelineSnapshot({
          scopeKey: targetScopeKey,
          value: { events, error: null, isLoading: false },
        });
      })
      .catch((error) => {
        if (!isTimelineRequestCurrent()) return;
        setTimelineSnapshot({
          scopeKey: targetScopeKey,
          value: {
            events: [],
            error: resolveLoadError(error, TIMELINE_LOAD_ERROR),
            isLoading: false,
          },
        });
      })
      .finally(() => {
        if (
          timelineRequestRef.current.controller === timelineController &&
          timelineRequestRef.current.generation === timelineGeneration
        ) {
          timelineRequestRef.current = {
            controller: null,
            generation: timelineGeneration,
          };
        }
      });

    return cancelAllRequests;
  }, [
    cancelAllRequests,
    isEnabled,
    loadAuditEntries,
    loadTimelineEvents,
    routeVersionId,
    scopeKey,
  ]);

  const audit = useMemo(() => {
    if (!scopeKey) return EMPTY_AUDIT_STATE;
    return auditSnapshot?.scopeKey === scopeKey
      ? auditSnapshot.value
      : LOADING_AUDIT_STATE;
  }, [auditSnapshot, scopeKey]);

  const timeline = useMemo(() => {
    if (!scopeKey) return EMPTY_TIMELINE_STATE;
    return timelineSnapshot?.scopeKey === scopeKey
      ? timelineSnapshot.value
      : LOADING_TIMELINE_STATE;
  }, [scopeKey, timelineSnapshot]);

  const state = useMemo(() => ({ audit, timeline }), [audit, timeline]);
  const actions = useMemo(
    () => ({ refreshAudit, refreshTimeline, refreshAll }),
    [refreshAll, refreshAudit, refreshTimeline]
  );
  const meta = useMemo(() => ({ isEnabled }), [isEnabled]);

  return { state, actions, meta };
}
