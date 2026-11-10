"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cadPlotMessage, cadReadMessage } from "@/lib/cad/messages";
import type { CadOriginal } from "@/lib/cad/original";
import type { CadPlot, CadPlotOptions } from "@/lib/cad/plot";
import type { CadSummary } from "@/lib/cad/summary";
import type { CadWorkerRequest, CadWorkerResponse } from "@/workers/cad-reader.worker";

export type CadOriginalSource = {
  url: string;
  fileName: string;
  /** Where the server gives the DXF of a DWG; without it a DWG shows what its file says and no more. */
  drawingUrl?: string;
};

export type CadOriginalState =
  | { status: "idle" }
  /** `converting`: the DWG is read, and its drawing is asked of the server. */
  | { status: "loading"; converting?: true }
  /**
   * `source`: the drawing is the server's conversion of this DWG.
   * `notice`: why the DWG is shown without its drawing; `retryable`: asking again may bring it.
   */
  | { status: "ready"; original: CadOriginal; source?: CadSummary; notice?: string; retryable?: true }
  | { status: "error"; message: string };

const READ_TIMEOUT_MS = 120_000;
const PLOT_TIMEOUT_MS = 180_000;
const UNREACHED = "Le dessin de ce DWG n’a pas pu être demandé au serveur.";

/** What a refusal says, or the sentence kept for one that says nothing. */
async function refusalMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => null);
  return typeof payload?.error?.message === "string" ? payload.error.message : fallback;
}

type Outcome = CadWorkerResponse | "timeout" | "closed";
type Ask = { type: "read"; fileName: string; buffer: ArrayBuffer } | { type: "plot"; options: CadPlotOptions };

function buildRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** One worker for one opened original: it reads the file, then plots the drawing it kept. */
function openCadSession() {
  const worker = new Worker(new URL("../workers/cad-reader.worker.ts", import.meta.url), { type: "module" });
  const pending = new Map<string, (outcome: Outcome) => void>();
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const settle of [...pending.values()]) settle("closed");
  };

  worker.onmessage = (event: MessageEvent<CadWorkerResponse>) => {
    const response = event.data;
    if (response) pending.get(response.requestId)?.(response);
  };
  // A worker that breaks down answers none of the requests it was sent.
  worker.onerror = close;

  const ask = (request: Ask, transfer: Transferable[], timeoutMs: number) =>
    new Promise<Outcome>((resolve) => {
      if (closed) return resolve("closed");
      const requestId = buildRequestId();
      const timer = window.setTimeout(() => pending.get(requestId)?.("timeout"), timeoutMs);
      pending.set(requestId, (outcome) => {
        window.clearTimeout(timer);
        pending.delete(requestId);
        resolve(outcome);
      });
      worker.postMessage({ ...request, requestId } satisfies CadWorkerRequest, transfer);
    });

  return { ask, close };
}

type CadSession = ReturnType<typeof openCadSession>;

/**
 * Downloads a CAD original and reads it in a worker. `source` is null for a
 * document that is not one; the worker lives as long as the document is open.
 * A DWG is read for what its file says, then the server is asked for its DXF,
 * which the same worker reads: the drawing replaces the summary when it comes.
 */
export function useCadOriginal(source: CadOriginalSource | null) {
  const url = source?.url ?? null, fileName = source?.fileName ?? null, drawingUrl = source?.drawingUrl ?? null;
  const [state, setState] = useState<CadOriginalState>(source ? { status: "loading" } : { status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const sessionRef = useRef<CadSession | null>(null);

  useEffect(() => {
    if (url === null || fileName === null) {
      setState((prior) => (prior.status === "idle" ? prior : { status: "idle" }));
      return;
    }
    const abort = new AbortController();
    let session: CadSession | null = null;
    const fail = (message: string) => {
      if (!abort.signal.aborted) setState({ status: "error", message });
    };
    setState({ status: "loading" });

    void (async () => {
      if (typeof Worker === "undefined") return fail("Ce navigateur ne permet pas de lire les plans.");
      const response = await fetch(url, { cache: "no-store", signal: abort.signal });
      if (!response.ok) return fail(await refusalMessage(response, "Impossible d’ouvrir ce document."));
      const buffer = await response.arrayBuffer();
      if (abort.signal.aborted) return;
      session = openCadSession();
      sessionRef.current = session;
      const outcome = await session.ask({ type: "read", fileName, buffer }, [buffer], READ_TIMEOUT_MS);
      if (abort.signal.aborted) return;
      if (outcome === "timeout") {
        // The reading holds the worker: nothing else would be answered.
        session.close();
        return fail("La lecture de ce fichier prend trop de temps.");
      }
      if (outcome === "closed" || !outcome.ok) return fail(cadReadMessage(outcome === "closed" ? "failed" : outcome.reason));
      if (outcome.type !== "read") return;
      const { original } = outcome;
      if (original.kind !== "summary" || original.summary.format !== "dwg" || drawingUrl === null) return setState({ status: "ready", original });

      // The DWG stays shown by what its file says whenever its drawing does not come.
      // A server that was not reached, or that is busy, can be asked again; a file it refuses would be refused again.
      const undrawn = (notice: string, retryable = false) => {
        if (!abort.signal.aborted) setState({ status: "ready", original, notice, ...(retryable ? { retryable } : {}) });
      };
      setState({ status: "loading", converting: true });
      const conversion = await fetch(drawingUrl, { cache: "no-store", signal: abort.signal }).catch(() => null);
      if (abort.signal.aborted) return;
      if (!conversion) return undrawn(UNREACHED, true);
      if (!conversion.ok) return undrawn(await refusalMessage(conversion, UNREACHED), conversion.status >= 500);
      const dxf = await conversion.arrayBuffer().catch(() => null);
      if (abort.signal.aborted) return;
      if (!dxf) return undrawn(UNREACHED, true);
      const drawn = await session.ask({ type: "read", fileName: `${fileName}.dxf`, buffer: dxf }, [dxf], READ_TIMEOUT_MS);
      if (abort.signal.aborted) return;
      if (drawn === "timeout") {
        // The reading holds the worker, which a summary does not need.
        session.close();
        return undrawn("La lecture du dessin de ce DWG prend trop de temps.");
      }
      if (drawn === "closed" || !drawn.ok) return undrawn(cadReadMessage(drawn === "closed" ? "failed" : drawn.reason));
      if (drawn.type === "read") setState({ status: "ready", original: drawn.original, source: original.summary });
    })().catch(() => fail("Impossible d’ouvrir ce document."));

    return () => {
      abort.abort();
      session?.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [url, fileName, drawingUrl, attempt]);

  const retry = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((prior) => prior + 1);
  }, []);

  const plot = useCallback(async (options: CadPlotOptions): Promise<CadPlot> => {
    const session = sessionRef.current;
    const outcome = (await session?.ask({ type: "plot", options }, [], PLOT_TIMEOUT_MS)) ?? "closed";
    if (outcome === "timeout") {
      // The worker is still computing and would answer nothing else: it is ended, and another one reads the file again.
      session?.close();
      if (sessionRef.current === session) {
        setState({ status: "loading" });
        setAttempt((prior) => prior + 1);
      }
      throw new Error("Le tracé prend trop de temps : masquez des calques ou choisissez une échelle plus petite.");
    }
    if (outcome === "closed") throw new Error(cadPlotMessage("no_drawing"));
    if (outcome.ok && outcome.type === "plot") return outcome.plot;
    throw new Error(cadPlotMessage(outcome.ok ? "failed" : outcome.reason));
  }, []);

  return { state, retry, plot };
}
