"use client";

import { useCallback, useEffect, useState } from "react";

import { materialRequestErrorMessage } from "@/lib/material-requests/client";

/**
 * Loads what an affaire screen shows from one server call, as the server answered it. A late answer of an earlier
 * call (another affaire, a reload) is dropped. `reload` asks again; `error` is the server's sentence, or `fallback`.
 * `fetcher` is a module function of `@/lib/material-requests/client`, so its identity is stable.
 */
export function useRetryableLoad<T>(
  fetcher: (projectId: string, signal: AbortSignal) => Promise<T>,
  projectId: string,
  fallback: string,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    fetcher(projectId, abort.signal)
      .then((next) => {
        if (!abort.signal.aborted) setData(next);
      })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) setError(materialRequestErrorMessage(cause, fallback));
      });
    return () => abort.abort();
  }, [fetcher, projectId, fallback, attempt]);

  const reload = useCallback(() => {
    setError(null);
    setAttempt((current) => current + 1);
  }, []);

  return { data, setData, error, reload };
}
