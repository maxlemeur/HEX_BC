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
    // A worker that read nothing has nothing to plot: it is ended with what its reader holds.
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);

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

  describe("a DWG with a conversion address", () => {
    const dwg = { url: "/api/affaires/a/intake/files/d/preview?download=1", fileName: "Réseaux.dwg", drawingUrl: "/api/affaires/a/intake/files/d/drawing" };
    const drawing = { kind: "drawing", drawing: { layers: [] } } as unknown as CadOriginal;
    const dxf = new ArrayBuffer(16);

    /** The original downloads; the DXF is answered as `conversion` says. */
    function installDwgFetch(conversion: () => unknown) {
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        void init;
        return url === dwg.drawingUrl ? conversion() : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    it("asks the server for its DXF and reads it with the worker that read the DWG", async () => {
      const workers = installWorkers(), fetchMock = installDwgFetch(() => ({ ok: true, arrayBuffer: async () => dxf }));
      const { result } = renderHook(() => useCadOriginal(dwg));
      const first = await lastRequest(() => workers[0]);
      expect(first).toMatchObject({ type: "read", fileName: "Réseaux.dwg" });
      await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: summary });
      // What the DWG says is known; its drawing is on its way.
      expect(result.current.state).toEqual({ status: "loading", converting: true });

      const second = await lastRequest(() => workers[0], 2);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([dwg.url, dwg.drawingUrl]);
      expect(second.type).toBe("read");
      if (second.type !== "read") throw new Error("read expected");
      // The worker picks its reader by the name: the converted bytes are a DXF.
      expect(second.fileName).toMatch(/\.dxf$/);
      expect(second.buffer).toBe(dxf);
      await answer(workers[0], { requestId: second.requestId, ok: true, type: "read", original: drawing });
      expect(result.current.state).toEqual({ status: "ready", original: drawing, source: summary.kind === "summary" ? summary.summary : null });
      expect(workers).toHaveLength(1);
    });

    it("keeps what the DWG says and repeats why the server did not convert it", async () => {
      const workers = installWorkers();
      const refusal = "Ce DWG est enregistré dans un format antérieur à AutoCAD R13.";
      installDwgFetch(() => ({ ok: false, status: 422, json: async () => ({ error: { message: refusal } }) }));
      const { result } = renderHook(() => useCadOriginal(dwg));
      const first = await lastRequest(() => workers[0]);
      await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: summary });
      await waitFor(() => expect(result.current.state).toEqual({ status: "ready", original: summary, notice: refusal }));
      expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    });

    it("keeps what the DWG says when the conversion cannot be reached or its DXF is not read", async () => {
      const workers = installWorkers();
      let reachable = false;
      installDwgFetch(() => {
        if (!reachable) throw new TypeError("Failed to fetch");
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(16) };
      });
      const { result } = renderHook(() => useCadOriginal(dwg));
      const first = await lastRequest(() => workers[0]);
      await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: summary });
      // A conversion that was not reached can be asked again.
      await waitFor(() => expect(result.current.state).toEqual({ status: "ready", original: summary, notice: "Le dessin de ce DWG n’a pas pu être demandé au serveur.", retryable: true }));

      reachable = true;
      act(() => result.current.retry());
      const again = await lastRequest(() => workers[1]);
      await answer(workers[1], { requestId: again.requestId, ok: true, type: "read", original: summary });
      const converted = await lastRequest(() => workers[1], 2);
      await answer(workers[1], { requestId: converted.requestId, ok: false, type: "read", reason: "too_large" });
      expect(result.current.state).toEqual({ status: "ready", original: summary, notice: cadReadMessage("too_large") });
    });

    it("offers to ask again a server that is busy, not one that refuses the file", async () => {
      const workers = installWorkers();
      const busy = "Le serveur convertit déjà plusieurs DWG. Réessayez dans un instant.";
      installDwgFetch(() => ({ ok: false, status: 503, json: async () => ({ error: { message: busy } }) }));
      const { result } = renderHook(() => useCadOriginal(dwg));
      const first = await lastRequest(() => workers[0]);
      await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: summary });
      await waitFor(() => expect(result.current.state).toEqual({ status: "ready", original: summary, notice: busy, retryable: true }));
    });

    it("keeps what the DWG says when the reading of its DXF never ends", async () => {
      vi.useFakeTimers();
      const workers = installWorkers();
      installDwgFetch(() => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(16) }));
      const { result } = renderHook(() => useCadOriginal(dwg));
      await act(() => vi.advanceTimersByTimeAsync(10));
      const { requestId } = workers[0].postMessage.mock.calls[0][0];
      await answer(workers[0], { requestId, ok: true, type: "read", original: summary });
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(workers[0].postMessage).toHaveBeenCalledTimes(2);

      await act(() => vi.advanceTimersByTimeAsync(120_000));
      expect(result.current.state).toEqual({ status: "ready", original: summary, notice: "La lecture du dessin de ce DWG prend trop de temps." });
      // The worker still reading is ended: it would answer nothing else.
      expect(workers[0].terminate).toHaveBeenCalled();
    });

    it("stops asking for the drawing when the document is closed", async () => {
      const workers = installWorkers();
      const fetchMock = installDwgFetch(() => new Promise(() => {}));
      const { result, unmount } = renderHook(() => useCadOriginal(dwg));
      const first = await lastRequest(() => workers[0]);
      await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original: summary });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      expect(result.current.state).toEqual({ status: "loading", converting: true });
      const signal = fetchMock.mock.calls[1][1]?.signal;
      expect(signal?.aborted).toBe(false);
      unmount();
      expect(signal?.aborted).toBe(true);
      expect(workers[0].terminate).toHaveBeenCalled();
      expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    });

    it("asks for no conversion of a Revit model, nor of a DWG without a conversion address", async () => {
      const revit: CadOriginal = { kind: "summary", summary: { format: "rvt", version: null, thumbnail: null } };
      for (const [props, original] of [[{ ...dwg, fileName: "Maquette.rvt" }, revit], [{ url: dwg.url, fileName: dwg.fileName }, summary]] as const) {
        const workers = installWorkers(), fetchMock = installDwgFetch(() => ({ ok: true, arrayBuffer: async () => dxf }));
        const { result, unmount } = renderHook(() => useCadOriginal(props));
        const first = await lastRequest(() => workers[0]);
        await answer(workers[0], { requestId: first.requestId, ok: true, type: "read", original });
        expect(result.current.state).toEqual({ status: "ready", original });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        unmount();
      }
    });
  });

  it("says so when the browser has no worker", async () => {
    vi.stubGlobal("Worker", undefined);
    installFetch();
    const { result } = renderHook(() => useCadOriginal(source));
    await waitFor(() => expect(result.current.state.status).toBe("error"));
  });
});
