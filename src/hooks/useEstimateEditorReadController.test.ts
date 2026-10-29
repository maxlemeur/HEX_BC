// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateEditorReadController, useEstimateEditorReadState } from "@/hooks/useEstimateEditorReadController";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

const mocks = vi.hoisted(() => ({ read: vi.fn(), learnings: vi.fn() }));
vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateEditorData: mocks.read,
  fetchEstimateSuggestionLearnings: mocks.learnings,
  isEstimateApiError: () => false,
}));

function useRead(input: Omit<Parameters<typeof useEstimateEditorReadController>[0], "readState">) {
  const readState = useEstimateEditorReadState();
  return useEstimateEditorReadController({ ...input, readState });
}

function document() {
  const response = createEstimateEditorResponseFixture();
  return parseEstimateEditorData(response, response.version.id);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const data = document();
  const handlers = {
    getCurrentVersion: vi.fn(() => data.version),
    isRecoveryRequired: false,
    clearSuggestions: vi.fn(),
    apply: vi.fn(),
    finish: vi.fn(),
    reportRefreshError: vi.fn(),
    resolveErrorMessage: (message: string) => message,
  };
  const props = {
    versionId: data.version.id, tenantId: data.version.tenant_id, actorId: "actor-1",
    reloadToken: 0, isLaborSplitEnabled: false, autoOpenVersionZero: false, handlers,
  };
  return { data, handlers, props };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockReset();
  mocks.learnings.mockReset().mockResolvedValue(null);
});
afterEach(cleanup);

describe("the editor read lifecycle", () => {
  it("ignores responses from an earlier visit, including navigation A to B to A", async () => {
    const { data, handlers, props } = setup();
    const first = deferred<typeof data>();
    const middle = deferred<typeof data>();
    const latest = deferred<typeof data>();
    mocks.read.mockReturnValueOnce(first.promise).mockReturnValueOnce(middle.promise).mockReturnValueOnce(latest.promise);
    const view = renderHook((input) => useRead(input), { initialProps: props });
    view.rerender({ ...props, versionId: "another-version" });
    view.rerender(props);
    await act(async () => { first.resolve(data); middle.resolve(data); });
    expect(handlers.apply).not.toHaveBeenCalled();
    expect(handlers.finish).not.toHaveBeenCalled();
    await act(async () => { latest.resolve(data); });
    expect(handlers.apply).toHaveBeenCalledTimes(1);
    expect(view.result.current.isLoading).toBe(false);
  });

  it("ignores a read started by another actor even for the same version", async () => {
    const { data, handlers, props } = setup();
    const oldRead = deferred<typeof data>();
    const newRead = deferred<typeof data>();
    mocks.read.mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const view = renderHook((input) => useRead(input), { initialProps: props });
    view.rerender({ ...props, actorId: "actor-2" });
    await act(async () => { oldRead.resolve(data); });
    expect(handlers.apply).not.toHaveBeenCalled();
    await act(async () => { newRead.resolve(data); });
    expect(handlers.apply).toHaveBeenCalledTimes(1);
    expect(handlers.apply.mock.calls[0][2]).toBe(false);
  });

  it("does not replace a newer confirmed revision, preserving PostgreSQL microseconds", async () => {
    const { data, handlers, props } = setup();
    handlers.getCurrentVersion.mockReturnValue({ ...data.version, updated_at: "2026-10-28T10:00:00.123457Z" });
    mocks.read.mockResolvedValue(data);
    const view = renderHook(() => useRead(props));
    await waitFor(() => expect(view.result.current.state.status).toBe("ready"));
    expect(handlers.apply).not.toHaveBeenCalled();
    expect(handlers.finish).toHaveBeenCalledWith(false);
  });

  it("keeps the current document when a later network read fails", async () => {
    const { data, handlers, props } = setup();
    mocks.read.mockResolvedValueOnce(data).mockRejectedValueOnce(new TypeError("Network failure"));
    const view = renderHook((input) => useRead(input), { initialProps: props });
    await waitFor(() => expect(handlers.apply).toHaveBeenCalledTimes(1));
    view.rerender({ ...props, reloadToken: 1 });
    await waitFor(() => expect(handlers.reportRefreshError).toHaveBeenCalledWith(expect.stringContaining("saisies sont conservées")));
    expect(view.result.current.loadError).toBeNull();
    expect(view.result.current.isLoading).toBe(false);
    expect(handlers.apply).toHaveBeenCalledTimes(1);
    expect(handlers.finish).toHaveBeenLastCalledWith(false);
  });

  it("fails initial loading without applying data from another tenant", async () => {
    const { data, handlers, props } = setup();
    mocks.read.mockResolvedValue({ ...data, version: { ...data.version, tenant_id: "another-tenant" } });
    const view = renderHook(() => useRead(props));
    await waitFor(() => expect(view.result.current.loadError).toContain("autre organisation"));
    expect(handlers.apply).not.toHaveBeenCalled();
    expect(handlers.finish).toHaveBeenCalledWith(false);
  });

  it("leaves a known mutation-read failure to its explicit recovery owner", async () => {
    const { data, handlers, props } = setup();
    mocks.read.mockResolvedValue(data);
    const view = renderHook((input) => useRead(input), { initialProps: props });
    await waitFor(() => expect(handlers.apply).toHaveBeenCalledTimes(1));
    view.rerender({ ...props, reloadToken: 1, handlers: { ...handlers, isRecoveryRequired: true } });
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(view.result.current.state.status).toBe("ready");
  });
});
