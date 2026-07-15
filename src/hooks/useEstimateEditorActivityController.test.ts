// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatEstimateEditorAuditTimestamp,
  useEstimateEditorActivityController,
  type EstimateEditorAuditLogEntry,
} from "@/hooks/useEstimateEditorActivityController";
import type { EstimateVersionEvent } from "@/lib/estimates/client";

type ControllerInput = Parameters<
  typeof useEstimateEditorActivityController
>[0];
type AuditLoader = NonNullable<ControllerInput["loadAuditEntries"]>;
type TimelineLoader = NonNullable<ControllerInput["loadTimelineEvents"]>;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createAuditEntry(
  id: string,
  overrides: Partial<EstimateEditorAuditLogEntry> = {}
): EstimateEditorAuditLogEntry {
  return {
    id,
    created_at: "2026-07-15T08:00:00.000Z",
    action: "update",
    table_name: "estimate_versions",
    record_id: `record-${id}`,
    ...overrides,
  };
}

function createTimelineEvent(
  id: string,
  versionId = "version-1"
): EstimateVersionEvent {
  return {
    id,
    estimateVersionId: versionId,
    eventType: "updated",
    metadata: {},
    createdBy: "user-1",
    actorName: "Admin",
    occurredAt: "2026-07-15T08:00:00.000Z",
    createdAt: "2026-07-15T08:00:00.000Z",
  };
}

function createInput(
  overrides: Partial<ControllerInput> = {}
): ControllerInput {
  return {
    routeVersionId: "version-1",
    isAdmin: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useEstimateEditorActivityController", () => {
  it("loads and normalizes audit and timeline activity for an admin", async () => {
    const auditEntry = createAuditEntry("audit-1");
    const timelineEvent = createTimelineEvent("event-1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          data: [auditEntry, { id: "invalid" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ok: true,
          data: [timelineEvent, { id: "invalid" }],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() =>
      useEstimateEditorActivityController(createInput())
    );

    expect(result.current.meta.isEnabled).toBe(true);
    expect(result.current.actions).toEqual(
      expect.objectContaining({
        refreshAudit: expect.any(Function),
        refreshTimeline: expect.any(Function),
        refreshAll: expect.any(Function),
      })
    );

    await waitFor(() => {
      expect(result.current.state.audit).toEqual({
        entries: [auditEntry],
        error: null,
        isLoading: false,
      });
      expect(result.current.state.timeline).toEqual({
        events: [timelineEvent],
        error: null,
        isLoading: false,
      });
    });

    const [auditUrl, auditInit] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(auditUrl).toBe(
      "/api/audit?estimate_version_id=version-1&limit=25"
    );
    expect(auditInit).toMatchObject({ credentials: "same-origin" });
    expect(auditInit.signal).toBeInstanceOf(AbortSignal);
    const [timelineUrl, timelineInit] = fetchMock.mock.calls[1] as unknown as [
      string,
      RequestInit,
    ];
    expect(timelineUrl).toBe("/api/estimates/version-1/events");
    expect(timelineInit).toMatchObject({ credentials: "same-origin" });
    expect(timelineInit.signal).toBeInstanceOf(AbortSignal);
    expect(
      formatEstimateEditorAuditTimestamp("not-a-timestamp")
    ).toBe("not-a-timestamp");
  });

  it("loads only while admin access is enabled and resets when it is removed", async () => {
    const auditEntry = createAuditEntry("audit-admin");
    const timelineEvent = createTimelineEvent("event-admin");
    const loadAuditEntries = vi.fn<AuditLoader>(async () => [auditEntry]);
    const loadTimelineEvents = vi.fn<TimelineLoader>(async () => [
      timelineEvent,
    ]);
    const { result, rerender } = renderHook(
      ({ isAdmin }: { isAdmin: boolean }) =>
        useEstimateEditorActivityController(
          createInput({ isAdmin, loadAuditEntries, loadTimelineEvents })
        ),
      { initialProps: { isAdmin: false } }
    );

    expect(result.current.meta.isEnabled).toBe(false);
    expect(loadAuditEntries).not.toHaveBeenCalled();
    expect(loadTimelineEvents).not.toHaveBeenCalled();

    rerender({ isAdmin: true });
    await waitFor(() => {
      expect(result.current.state.audit.entries).toEqual([auditEntry]);
      expect(result.current.state.timeline.events).toEqual([timelineEvent]);
    });

    rerender({ isAdmin: false });
    await waitFor(() => {
      expect(result.current.meta.isEnabled).toBe(false);
      expect(result.current.state.audit).toEqual({
        entries: [],
        error: null,
        isLoading: false,
      });
      expect(result.current.state.timeline).toEqual({
        events: [],
        error: null,
        isLoading: false,
      });
    });

    const auditCallCount = loadAuditEntries.mock.calls.length;
    const timelineCallCount = loadTimelineEvents.mock.calls.length;
    await act(async () => {
      await result.current.actions.refreshAll();
    });
    expect(loadAuditEntries).toHaveBeenCalledTimes(auditCallCount);
    expect(loadTimelineEvents).toHaveBeenCalledTimes(timelineCallCount);
  });

  it("starts a fresh loading session when admin access returns on the same route", async () => {
    const initialAuditEntry = createAuditEntry("audit-initial-session");
    const initialTimelineEvent = createTimelineEvent(
      "event-initial-session"
    );
    const nextAuditEntry = createAuditEntry("audit-next-session");
    const nextTimelineEvent = createTimelineEvent("event-next-session");
    const nextAuditRequest =
      createDeferred<EstimateEditorAuditLogEntry[]>();
    const nextTimelineRequest = createDeferred<EstimateVersionEvent[]>();
    const loadAuditEntries = vi
      .fn<AuditLoader>()
      .mockResolvedValueOnce([initialAuditEntry])
      .mockImplementationOnce(() => nextAuditRequest.promise);
    const loadTimelineEvents = vi
      .fn<TimelineLoader>()
      .mockResolvedValueOnce([initialTimelineEvent])
      .mockImplementationOnce(() => nextTimelineRequest.promise);
    const { result, rerender } = renderHook(
      ({ isAdmin }: { isAdmin: boolean }) =>
        useEstimateEditorActivityController(
          createInput({ isAdmin, loadAuditEntries, loadTimelineEvents })
        ),
      { initialProps: { isAdmin: false } }
    );

    rerender({ isAdmin: true });
    await waitFor(() => {
      expect(result.current.state.audit.entries).toEqual([
        initialAuditEntry,
      ]);
      expect(result.current.state.timeline.events).toEqual([
        initialTimelineEvent,
      ]);
    });

    rerender({ isAdmin: false });
    expect(result.current.state.audit).toEqual({
      entries: [],
      error: null,
      isLoading: false,
    });
    expect(result.current.state.timeline).toEqual({
      events: [],
      error: null,
      isLoading: false,
    });

    rerender({ isAdmin: true });
    await waitFor(() => {
      expect(loadAuditEntries).toHaveBeenCalledTimes(2);
      expect(loadTimelineEvents).toHaveBeenCalledTimes(2);
      expect(result.current.state.audit).toEqual({
        entries: [],
        error: null,
        isLoading: true,
      });
      expect(result.current.state.timeline).toEqual({
        events: [],
        error: null,
        isLoading: true,
      });
    });

    await act(async () => {
      nextAuditRequest.resolve([nextAuditEntry]);
      nextTimelineRequest.resolve([nextTimelineEvent]);
      await Promise.all([
        nextAuditRequest.promise,
        nextTimelineRequest.promise,
      ]);
    });

    await waitFor(() => {
      expect(result.current.state.audit.entries).toEqual([nextAuditEntry]);
      expect(result.current.state.timeline.events).toEqual([
        nextTimelineEvent,
      ]);
    });
  });

  it("exposes independent loading and error states", async () => {
    const auditRequest = createDeferred<EstimateEditorAuditLogEntry[]>();
    const timelineRequest = createDeferred<EstimateVersionEvent[]>();
    const loadAuditEntries = vi.fn<AuditLoader>(() => auditRequest.promise);
    const loadTimelineEvents = vi.fn<TimelineLoader>(
      () => timelineRequest.promise
    );
    const { result } = renderHook(() =>
      useEstimateEditorActivityController(
        createInput({ loadAuditEntries, loadTimelineEvents })
      )
    );

    await waitFor(() => {
      expect(result.current.state.audit.isLoading).toBe(true);
      expect(result.current.state.timeline.isLoading).toBe(true);
    });

    await act(async () => {
      auditRequest.reject(new Error("Audit indisponible."));
      timelineRequest.reject("timeline unavailable");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.audit).toEqual({
        entries: [],
        error: "Audit indisponible.",
        isLoading: false,
      });
      expect(result.current.state.timeline).toEqual({
        events: [],
        error: "Impossible de charger la timeline des evenements.",
        isLoading: false,
      });
    });
  });

  it("aborts both in-flight resources when admin access is disabled", async () => {
    let auditSignal: AbortSignal | null = null;
    let timelineSignal: AbortSignal | null = null;
    const loadAuditEntries = vi.fn(
      (_versionId: string, signal: AbortSignal) => {
        auditSignal = signal;
        return new Promise<EstimateEditorAuditLogEntry[]>(() => undefined);
      }
    );
    const loadTimelineEvents = vi.fn(
      (_versionId: string, signal: AbortSignal) => {
        timelineSignal = signal;
        return new Promise<EstimateVersionEvent[]>(() => undefined);
      }
    );
    const { result, rerender } = renderHook(
      ({ isAdmin }: { isAdmin: boolean }) =>
        useEstimateEditorActivityController(
          createInput({ isAdmin, loadAuditEntries, loadTimelineEvents })
        ),
      { initialProps: { isAdmin: true } }
    );

    await waitFor(() => {
      expect(auditSignal).not.toBeNull();
      expect(timelineSignal).not.toBeNull();
      expect(result.current.state.audit.isLoading).toBe(true);
      expect(result.current.state.timeline.isLoading).toBe(true);
    });

    rerender({ isAdmin: false });

    await waitFor(() => {
      expect((auditSignal as AbortSignal | null)?.aborted).toBe(true);
      expect((timelineSignal as AbortSignal | null)?.aborted).toBe(true);
      expect(result.current.state.audit.isLoading).toBe(false);
      expect(result.current.state.timeline.isLoading).toBe(false);
    });
  });

  it("keeps only the latest concurrent refresh result", async () => {
    const initialAudit = createAuditEntry("audit-initial");
    const initialTimeline = createTimelineEvent("event-initial");
    const staleAuditRequest =
      createDeferred<EstimateEditorAuditLogEntry[]>();
    const staleTimelineRequest = createDeferred<EstimateVersionEvent[]>();
    const latestAuditRequest =
      createDeferred<EstimateEditorAuditLogEntry[]>();
    const latestTimelineRequest = createDeferred<EstimateVersionEvent[]>();
    const loadAuditEntries = vi
      .fn<AuditLoader>(async () => [initialAudit])
      .mockImplementationOnce(async () => [initialAudit]);
    const loadTimelineEvents = vi
      .fn<TimelineLoader>(async () => [initialTimeline])
      .mockImplementationOnce(async () => [initialTimeline]);
    const { result } = renderHook(() =>
      useEstimateEditorActivityController(
        createInput({ loadAuditEntries, loadTimelineEvents })
      )
    );

    await waitFor(() => {
      expect(result.current.state.audit.entries).toEqual([initialAudit]);
      expect(result.current.state.timeline.events).toEqual([initialTimeline]);
    });

    loadAuditEntries
      .mockImplementationOnce(() => staleAuditRequest.promise)
      .mockImplementationOnce(() => latestAuditRequest.promise);
    loadTimelineEvents
      .mockImplementationOnce(() => staleTimelineRequest.promise)
      .mockImplementationOnce(() => latestTimelineRequest.promise);

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.actions.refreshAll();
    });
    await waitFor(() => {
      expect(loadAuditEntries).toHaveBeenCalledTimes(2);
      expect(loadTimelineEvents).toHaveBeenCalledTimes(2);
    });

    let latestRefresh!: Promise<void>;
    act(() => {
      latestRefresh = result.current.actions.refreshAll();
    });

    const latestAudit = createAuditEntry("audit-latest");
    const latestTimeline = createTimelineEvent("event-latest");
    await act(async () => {
      latestAuditRequest.resolve([latestAudit]);
      latestTimelineRequest.resolve([latestTimeline]);
      await latestRefresh;
    });
    expect(result.current.state.audit.entries).toEqual([latestAudit]);
    expect(result.current.state.timeline.events).toEqual([latestTimeline]);

    await act(async () => {
      staleAuditRequest.resolve([createAuditEntry("audit-stale")]);
      staleTimelineRequest.resolve([createTimelineEvent("event-stale")]);
      await staleRefresh;
    });
    expect(result.current.state.audit.entries).toEqual([latestAudit]);
    expect(result.current.state.timeline.events).toEqual([latestTimeline]);
  });

  it("resets on version change and ignores late results from the previous version", async () => {
    const initialAudit = createAuditEntry("audit-v1");
    const initialTimeline = createTimelineEvent("event-v1", "version-1");
    const staleAuditRequest =
      createDeferred<EstimateEditorAuditLogEntry[]>();
    const staleTimelineRequest = createDeferred<EstimateVersionEvent[]>();
    const versionTwoAuditRequest =
      createDeferred<EstimateEditorAuditLogEntry[]>();
    const versionTwoTimelineRequest =
      createDeferred<EstimateVersionEvent[]>();
    let staleAuditSignal: AbortSignal | null = null;
    let staleTimelineSignal: AbortSignal | null = null;
    const loadAuditEntries = vi
      .fn<AuditLoader>(async () => [initialAudit])
      .mockImplementationOnce(async () => [initialAudit])
      .mockImplementationOnce((_versionId, signal) => {
        staleAuditSignal = signal;
        return staleAuditRequest.promise;
      })
      .mockImplementationOnce(() => versionTwoAuditRequest.promise);
    const loadTimelineEvents = vi
      .fn<TimelineLoader>(async () => [initialTimeline])
      .mockImplementationOnce(async () => [initialTimeline])
      .mockImplementationOnce((_versionId, signal) => {
        staleTimelineSignal = signal;
        return staleTimelineRequest.promise;
      })
      .mockImplementationOnce(() => versionTwoTimelineRequest.promise);
    const { result, rerender } = renderHook(
      ({ routeVersionId }: { routeVersionId: string }) =>
        useEstimateEditorActivityController(
          createInput({
            routeVersionId,
            loadAuditEntries,
            loadTimelineEvents,
          })
        ),
      { initialProps: { routeVersionId: "version-1" } }
    );

    await waitFor(() => {
      expect(result.current.state.audit.entries).toEqual([initialAudit]);
      expect(result.current.state.timeline.events).toEqual([initialTimeline]);
    });

    let staleRefresh!: Promise<void>;
    act(() => {
      staleRefresh = result.current.actions.refreshAll();
    });
    await waitFor(() => {
      expect(staleAuditSignal).not.toBeNull();
      expect(staleTimelineSignal).not.toBeNull();
    });

    rerender({ routeVersionId: "version-2" });
    await waitFor(() => {
      expect(loadAuditEntries).toHaveBeenLastCalledWith(
        "version-2",
        expect.any(AbortSignal)
      );
      expect(loadTimelineEvents).toHaveBeenLastCalledWith(
        "version-2",
        expect.any(AbortSignal)
      );
      expect((staleAuditSignal as AbortSignal | null)?.aborted).toBe(true);
      expect((staleTimelineSignal as AbortSignal | null)?.aborted).toBe(true);
      expect(result.current.state.audit).toEqual({
        entries: [],
        error: null,
        isLoading: true,
      });
      expect(result.current.state.timeline).toEqual({
        events: [],
        error: null,
        isLoading: true,
      });
    });

    await act(async () => {
      staleAuditRequest.resolve([createAuditEntry("audit-stale")]);
      staleTimelineRequest.resolve([
        createTimelineEvent("event-stale", "version-1"),
      ]);
      await staleRefresh;
    });
    expect(result.current.state.audit.entries).toEqual([]);
    expect(result.current.state.timeline.events).toEqual([]);

    const versionTwoAudit = createAuditEntry("audit-v2");
    const versionTwoTimeline = createTimelineEvent("event-v2", "version-2");
    await act(async () => {
      versionTwoAuditRequest.resolve([versionTwoAudit]);
      versionTwoTimelineRequest.resolve([versionTwoTimeline]);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.audit.entries).toEqual([versionTwoAudit]);
      expect(result.current.state.timeline.events).toEqual([
        versionTwoTimeline,
      ]);
    });
  });
});
