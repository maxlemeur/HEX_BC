import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCadOriginal } from "@/hooks/useCadOriginal";
import { cadPlotMessage, cadReadMessage } from "@/lib/cad/messages";
import type { CadOriginal } from "@/lib/cad/original";
import type { CadPlot } from "@/lib/cad/plot";
import type { CadWorkerRequest, CadWorkerResponse } from "@/workers/cad-reader.worker";

type WorkerStub = {
  onmessage: ((event: { data: CadWorkerResponse }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  postMessage: ReturnType<typeof vi.fn<(request: CadWorkerRequest, transfer: Transferable[]) => void>>;
  terminate: ReturnType<typeof vi.fn<() => void>>;
};

function installWorkers() {
  const workers: WorkerStub[] = [];
  vi.stubGlobal("Worker", vi.fn(function WorkerConstructor() {
    const worker: WorkerStub = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() };
    workers.push(worker);
    return worker;
  }));
  return workers;
}

function installFetch(answer: () => unknown = () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    void url; void init;
    return answer();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const source = { url: "/api/affaires/a/intake/files/d/preview?download=1", fileName: "Réseaux.dxf" };
const summary: CadOriginal = { kind: "summary", summary: { format: "dwg", version: { code: "AC1032", label: "AutoCAD 2018" }, thumbnail: null } };
const plotted = { bytes: new Uint8Array([37, 80, 68, 70]), denominator: 50 } as CadPlot;

/** The request the worker was last sent, once it has been sent. */
async function lastRequest(worker: () => WorkerStub | undefined, count = 1): Promise<CadWorkerRequest> {
  await waitFor(() => expect(worker()?.postMessage).toHaveBeenCalledTimes(count));
  return (worker() as WorkerStub).postMessage.mock.calls[count - 1][0];
}

const answer = (worker: WorkerStub, response: CadWorkerResponse) => act(() => worker.onmessage?.({ data: response }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useCadOriginal", () => {
  it("does nothing without a CAD original", () => {
    const workers = installWorkers(), fetchMock = installFetch();
    const { result } = renderHook(() => useCadOriginal(null));
    expect(result.current.state).toEqual({ status: "idle" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
  });

  it("downloads the original and hands its bytes to the worker, which reads it", async () => {
    const workers = installWorkers(), fetchMock = installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    expect(result.current.state).toEqual({ status: "loading" });

    const request = await lastRequest(() => workers[0]);
    expect(fetchMock.mock.calls[0][0]).toBe(source.url);
    expect(request).toMatchObject({ type: "read", fileName: "Réseaux.dxf" });
    if (request.type !== "read") throw new Error("read expected");
    // The bytes go to the worker without a copy.
    expect(workers[0].postMessage.mock.calls[0][1]).toEqual([request.buffer]);

    await answer(workers[0], { requestId: request.requestId, ok: true, type: "read", original: summary });
    expect(result.current.state).toEqual({ status: "ready", original: summary });
  });

  it("ignores an answer to another request", async () => {
    const workers = installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: "someone-else", ok: true, type: "read", original: summary });
    expect(result.current.state).toEqual({ status: "loading" });
  });

  it("says in French why the file was not read, and reads again when asked", async () => {
    const workers = installWorkers(), fetchMock = installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    const first = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: first.requestId, ok: false, type: "read", reason: "binary_dxf" });
    expect(result.current.state).toEqual({ status: "error", message: cadReadMessage("binary_dxf") });

    act(() => result.current.retry());
    expect(result.current.state).toEqual({ status: "loading" });
    const second = await lastRequest(() => workers[1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(workers[0].terminate).toHaveBeenCalled();
    await answer(workers[1], { requestId: second.requestId, ok: true, type: "read", original: summary });
    expect(result.current.state).toEqual({ status: "ready", original: summary });
  });

  it("repeats what the server says when the download is refused", async () => {
    const workers = installWorkers();
    installFetch(() => ({ ok: false, status: 404, json: async () => ({ error: { message: "Ce document n’est plus disponible dans l’affaire." } }) }));
    const { result } = renderHook(() => useCadOriginal(source));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "Ce document n’est plus disponible dans l’affaire." }));
    expect(workers).toHaveLength(0);
  });

  it("has a sentence of its own when the download fails without one", async () => {
    installWorkers();
    installFetch(() => ({ ok: false, status: 502, json: async () => { throw new Error("not json"); } }));
    const { result } = renderHook(() => useCadOriginal(source));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: "Impossible d’ouvrir ce document." }));
  });

  it("plots with the worker that read the drawing", async () => {
    const workers = installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    const read = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: read.requestId, ok: true, type: "read", original: summary });

    const plotting = result.current.plot({ denominator: 50, shown: [true, false] });
    const request = await lastRequest(() => workers[0], 2);
    expect(request).toMatchObject({ type: "plot", options: { denominator: 50, shown: [true, false] } });
    await answer(workers[0], { requestId: request.requestId, ok: true, type: "plot", plot: plotted });
    await expect(plotting).resolves.toBe(plotted);
    expect(workers).toHaveLength(1);
  });

  it("says in French why a plot is refused", async () => {
    const workers = installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    const read = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: read.requestId, ok: true, type: "read", original: summary });

    const plotting = result.current.plot({});
    const refused = expect(plotting).rejects.toThrow(cadPlotMessage("does_not_fit"));
    const request = await lastRequest(() => workers[0], 2);
    await answer(workers[0], { requestId: request.requestId, ok: false, type: "plot", reason: "does_not_fit" });
    await refused;
  });

  it("has nothing to plot before the drawing is read", async () => {
    installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(null));
    await expect(result.current.plot({})).rejects.toThrow(cadPlotMessage("no_drawing"));
  });

  it("stops a plot that never ends and reads the drawing again", async () => {
    vi.useFakeTimers();
    const workers = installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    await act(() => vi.advanceTimersByTimeAsync(10));
    const { requestId } = workers[0].postMessage.mock.calls[0][0];
    await answer(workers[0], { requestId, ok: true, type: "read", original: summary });
    expect(result.current.state.status).toBe("ready");

    const refused = expect(result.current.plot({})).rejects.toThrow("Le tracé prend trop de temps");
    await act(() => vi.advanceTimersByTimeAsync(180_000));
    await refused;
    // The worker still computing is ended, and another one reads the file again.
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(workers).toHaveLength(2);
    expect(workers[1].postMessage.mock.calls[0][0]).toMatchObject({ type: "read" });
    expect(result.current.state.status).toBe("loading");
  });

  it("stops a reading that never ends", async () => {
    vi.useFakeTimers();
    const workers = installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    await act(() => vi.advanceTimersByTimeAsync(10));
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(120_000));
    expect(result.current.state).toEqual({ status: "error", message: "La lecture de ce fichier prend trop de temps." });
    expect(workers[0].terminate).toHaveBeenCalled();
  });

  it("reports a worker that breaks down", async () => {
    const workers = installWorkers();
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    await lastRequest(() => workers[0]);
    act(() => workers[0].onerror?.({ message: "boom" }));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error", message: cadReadMessage("failed") }));
    expect(workers[0].terminate).toHaveBeenCalled();
  });

  it("stops the download and the worker when the document is closed", async () => {
    const workers = installWorkers(), fetchMock = installFetch();
    const { result, unmount } = renderHook(() => useCadOriginal(source));
    await lastRequest(() => workers[0]);
    const signal = fetchMock.mock.calls[0][1]?.signal;
    unmount();
    expect(signal?.aborted).toBe(true);
    expect(workers[0].terminate).toHaveBeenCalled();
    await expect(result.current.plot({})).rejects.toThrow(cadPlotMessage("no_drawing"));
  });

  it("reads the other original when the document changes", async () => {
    const workers = installWorkers(), fetchMock = installFetch();
    const { result, rerender } = renderHook((props: { url: string; fileName: string }) => useCadOriginal(props), { initialProps: source });
    const first = await lastRequest(() => workers[0]);
    await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: summary });

    rerender({ url: "/autre?download=1", fileName: "Autre.dwg" });
    expect(result.current.state).toEqual({ status: "loading" });
    const second = await lastRequest(() => workers[1]);
    expect(second).toMatchObject({ type: "read", fileName: "Autre.dwg" });
    expect(fetchMock.mock.calls[1][0]).toBe("/autre?download=1");
    expect(workers[0].terminate).toHaveBeenCalled();
  });

  it("says so when the browser has no worker", async () => {
    vi.stubGlobal("Worker", undefined);
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});
