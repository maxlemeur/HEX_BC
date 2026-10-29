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
