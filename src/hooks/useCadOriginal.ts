"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cadPlotMessage, cadReadMessage } from "@/lib/cad/messages";
import type { CadOriginal } from "@/lib/cad/original";
import type { CadPlot, CadPlotOptions } from "@/lib/cad/plot";
import type { CadWorkerRequest, CadWorkerResponse } from "@/workers/cad-reader.worker";

export type CadOriginalSource = { url: string; fileName: string };

export type CadOriginalState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; original: CadOriginal }
  | { status: "error"; message: string };

const READ_TIMEOUT_MS = 120_000;
const PLOT_TIMEOUT_MS = 180_000;

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
 */
export function useCadOriginal(source: CadOriginalSource | null) {
  const url = source?.url ?? null, fileName = source?.fileName ?? null;
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
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        return fail(typeof payload?.error?.message === "string" ? payload.error.message : "Impossible d’ouvrir ce document.");
      }
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
      if (outcome.type === "read") setState({ status: "ready", original: outcome.original });
    })().catch(() => fail("Impossible d’ouvrir ce document."));

    return () => {
      abort.abort();
      session?.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [url, fileName, attempt]);

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
