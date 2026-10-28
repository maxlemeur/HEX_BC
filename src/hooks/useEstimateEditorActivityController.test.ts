// @vitest-environment jsdom

import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import {
useEstimateEditorActivityController,
type EstimateEditorAuditLogEntry
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
    actorId: "user-1",
    tenantId: "tenant-1",
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
        error: "Impossible de charger la timeline des événements.",
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


describe("activity document identity", () => {
  const identityA = { actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
  const identityB = { actorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", tenantId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };

  it.each(["actorId", "tenantId"] as const)("retires cached activity when %s changes on the same version", async (field) => {
    const nextAudit = createDeferred<EstimateEditorAuditLogEntry[]>();
    const nextTimeline = createDeferred<EstimateVersionEvent[]>();
    const initialAudit = createAuditEntry("audit-A");
    const initialTimeline = createTimelineEvent("timeline-A");
    const loadAuditEntries = vi.fn<AuditLoader>().mockResolvedValueOnce([initialAudit])
      .mockImplementationOnce(() => nextAudit.promise);
    const loadTimelineEvents = vi.fn<TimelineLoader>().mockResolvedValueOnce([initialTimeline])
      .mockImplementationOnce(() => nextTimeline.promise);
    const { result, rerender } = renderHook((identity) => useEstimateEditorActivityController({
      ...createInput({ loadAuditEntries, loadTimelineEvents }), ...identity,
    }), { initialProps: identityA });
    await waitFor(() => expect(result.current.state.timeline.events).toEqual([initialTimeline]));

    rerender({ ...identityA, [field]: identityB[field] });
    expect(result.current.state.audit).toEqual({ entries: [], error: null, isLoading: true });
    expect(result.current.state.timeline).toEqual({ events: [], error: null, isLoading: true });
    expect(loadAuditEntries).toHaveBeenCalledTimes(2);
    expect(loadTimelineEvents).toHaveBeenCalledTimes(2);

    await act(async () => {
      nextAudit.resolve([createAuditEntry("audit-B")]);
      nextTimeline.resolve([createTimelineEvent("timeline-B")]);
    });
    expect(result.current.state.audit.entries[0]?.id).toBe("audit-B");
    expect(result.current.state.timeline.events[0]?.id).toBe("timeline-B");
  });

  it.each(["actorId", "tenantId"] as const)("aborts old %s reads and ignores their responses and refresh callbacks after A to B to A", async (field) => {
    const auditRequests = Array.from({ length: 3 }, () => createDeferred<EstimateEditorAuditLogEntry[]>());
    const timelineRequests = Array.from({ length: 3 }, () => createDeferred<EstimateVersionEvent[]>());
    const loadAuditEntries = vi.fn<AuditLoader>();
    const loadTimelineEvents = vi.fn<TimelineLoader>();
    auditRequests.forEach((request) => loadAuditEntries.mockImplementationOnce(() => request.promise));
    timelineRequests.forEach((request) => loadTimelineEvents.mockImplementationOnce(() => request.promise));
    const { result, rerender } = renderHook((identity) => useEstimateEditorActivityController({
      ...createInput({ loadAuditEntries, loadTimelineEvents }), ...identity,
    }), { initialProps: identityA });
    const oldActions = result.current.actions;
    const initialAuditSignal = loadAuditEntries.mock.calls[0][1];
    const initialTimelineSignal = loadTimelineEvents.mock.calls[0][1];

    rerender({ ...identityA, [field]: identityB[field] });
    expect(initialAuditSignal.aborted).toBe(true);
    expect(initialTimelineSignal.aborted).toBe(true);
    rerender(identityA);
    expect(loadAuditEntries).toHaveBeenCalledTimes(3);
    expect(loadTimelineEvents).toHaveBeenCalledTimes(3);
    const latestAuditSignal = loadAuditEntries.mock.calls[2][1];
    await act(async () => {
      auditRequests[2].resolve([createAuditEntry("audit-A2")]);
      timelineRequests[2].resolve([createTimelineEvent("timeline-A2")]);
    });
    await act(async () => {
      auditRequests[0].resolve([createAuditEntry("stale-A1")]);
      timelineRequests[0].reject(new Error("stale A1 failure"));
      auditRequests[1].reject(new Error("stale B failure"));
      timelineRequests[1].resolve([createTimelineEvent("stale-B")]);
      await oldActions.refreshAll();
    });
    expect(result.current.state.audit).toMatchObject({ entries: [{ id: "audit-A2" }], error: null, isLoading: false });
    expect(result.current.state.timeline).toMatchObject({ events: [{ id: "timeline-A2" }], error: null, isLoading: false });
    expect(latestAuditSignal.aborted).toBe(false);
    expect(loadAuditEntries).toHaveBeenCalledTimes(3);
    expect(loadTimelineEvents).toHaveBeenCalledTimes(3);
  });

  it("keeps an older refresh callback valid when the same UUID changes only case", async () => {
    const upperVersion = "EEEEEEEE-EEEE-4EEE-8EEE-EEEEEEEEEEEE";
    const audit = createAuditEntry("same-document-audit");
    const timeline = createTimelineEvent("same-document-event", upperVersion.toLowerCase());
    const loadAuditEntries = vi.fn<AuditLoader>(async () => [audit]);
    const loadTimelineEvents = vi.fn<TimelineLoader>(async () => [timeline]);
    const { result, rerender } = renderHook(({ routeVersionId }) => useEstimateEditorActivityController({
      ...createInput({ loadAuditEntries, loadTimelineEvents }), ...identityA, routeVersionId,
    }), { initialProps: { routeVersionId: upperVersion } });
    await waitFor(() => expect(result.current.state.timeline.events).toEqual([timeline]));
    const previousActions = result.current.actions;
    rerender({ routeVersionId: upperVersion.toLowerCase() });
    await waitFor(() => expect(result.current.state.timeline.isLoading).toBe(false));
    await act(async () => { await previousActions.refreshAll(); });
    expect(result.current.state.audit).toEqual({ entries: [audit], error: null, isLoading: false });
    expect(result.current.state.timeline).toEqual({ events: [timeline], error: null, isLoading: false });
    expect(loadAuditEntries).toHaveBeenCalledTimes(2);
    expect(loadTimelineEvents).toHaveBeenCalledTimes(2);
  });

  it.each(["actorId", "tenantId"] as const)("does not load activity without %s", (field) => {
    const loadAuditEntries = vi.fn<AuditLoader>(async () => []);
    const loadTimelineEvents = vi.fn<TimelineLoader>(async () => []);
    const identity = { ...identityA, [field]: null };
    const { result } = renderHook(() => useEstimateEditorActivityController({
      ...createInput({ loadAuditEntries, loadTimelineEvents }), ...identity,
    }));
    expect(result.current.meta.isEnabled).toBe(false);
    expect(loadAuditEntries).not.toHaveBeenCalled();
    expect(loadTimelineEvents).not.toHaveBeenCalled();
  });
});


describe("activity timeline HTTP response contract", () => {
  const versionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const event = {
    ...createTimelineEvent("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", versionId), createdBy: null,
  };

  it.each(["valid", "malformed"])("ignores a late %s HTTP response after the active version changes", async (kind) => {
    const lateResponse = createDeferred<Response>();
    const nextVersion = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const nextEvent = { ...event, estimateVersionId: nextVersion };
    const fetch = vi.fn().mockReturnValueOnce(lateResponse.promise)
      .mockResolvedValueOnce(Response.json({ ok: true, data: { events: [nextEvent] } }));
    vi.stubGlobal("fetch", fetch);
    const loadAuditEntries = async () => [];
    const { result, rerender } = renderHook(({ routeVersionId }) => useEstimateEditorActivityController({
      actorId: "user-1", tenantId: "tenant-1", routeVersionId, isAdmin: true, loadAuditEntries,
    }), { initialProps: { routeVersionId: versionId } });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    rerender({ routeVersionId: nextVersion });
    await waitFor(() => expect(result.current.state.timeline.events).toEqual([nextEvent]));
    await act(async () => { lateResponse.resolve(Response.json({ ok: true, data: kind === "valid" ? { events: [event] } : {} })); });
    expect(result.current.state.timeline.events).toEqual([nextEvent]);
    expect(result.current.state.timeline.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("aborts the in-flight shared HTTP reader when the version changes", async () => {
    const nextVersion = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const nextEvent = { ...event, estimateVersionId: nextVersion };
    const aborted = vi.fn();
    let firstSignal: AbortSignal | null | undefined;
    const fetch = vi.fn()
      .mockImplementationOnce((_path: string, init: RequestInit) => {
        firstSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted();
            reject(new DOMException("The request was aborted.", "AbortError"));
          }, { once: true });
        });
      })
      .mockResolvedValueOnce(Response.json({ ok: true, data: { events: [nextEvent] } }));
    vi.stubGlobal("fetch", fetch);
    const loadAuditEntries = async () => [];
    const { result, rerender } = renderHook(({ routeVersionId }) => useEstimateEditorActivityController({
      actorId: "user-1", tenantId: "tenant-1", routeVersionId, isAdmin: true, loadAuditEntries,
    }), { initialProps: { routeVersionId: versionId } });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal?.aborted).toBe(false);
    rerender({ routeVersionId: nextVersion });
    await waitFor(() => expect(result.current.state.timeline.events).toEqual([nextEvent]));
    expect(firstSignal?.aborted).toBe(true);
    expect(aborted).toHaveBeenCalledOnce();
    expect(result.current.state.timeline.error).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(["HTML 200", "missing events", "malformed event", "foreign event", "ok:false 200"])("reports %s as a failure instead of valid history", async (failure) => {
    const initialResponse = Response.json({ ok: true, data: { events: [event] } });
    const invalid = failure === "HTML 200" ? new Response("<html>Sign in</html>")
      : failure === "missing events" ? Response.json({ ok: true, data: {} })
      : failure === "ok:false 200" ? Response.json({ ok: false, data: { events: [event] } })
      : Response.json({ ok: true, data: { events: [event, failure === "foreign event"
        ? { ...event, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", estimateVersionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }
        : { id: "broken" }] } });
    const fetch = vi.fn().mockResolvedValueOnce(initialResponse).mockResolvedValueOnce(invalid);
    vi.stubGlobal("fetch", fetch);
    const loadAuditEntries = async () => [];
    const { result } = renderHook(() => useEstimateEditorActivityController({
      actorId: "user-1", tenantId: "tenant-1", routeVersionId: versionId, isAdmin: true, loadAuditEntries,
    }));
    await waitFor(() => expect(result.current.state.timeline.events).toEqual([event]));
    await act(async () => { await result.current.actions.refreshTimeline(); });
    expect(result.current.state.timeline.error).not.toBeNull();
    expect(result.current.state.timeline.events).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
