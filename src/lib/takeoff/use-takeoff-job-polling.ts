"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchTakeoffJob,
  isTakeoffApiError,
  type TakeoffJobDetailResponse,
} from "@/lib/takeoff/client";
import { TAKEOFF_JOB_TERMINAL_STATUSES } from "@/lib/takeoff/types";

const BASE_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 30_000;
const PERMANENT_ERROR_STATUSES = new Set([403, 404]);

type UseTakeoffJobPollingResult = {
  data: TakeoffJobDetailResponse | null;
  error: string | null;
  errorStatus: number | null;
  isPolling: boolean;
  refetch: () => void;
};

function getBackoffInterval(consecutiveErrors: number) {
  const interval = BASE_POLL_INTERVAL_MS * Math.pow(2, consecutiveErrors);
  return Math.min(interval, MAX_POLL_INTERVAL_MS);
}

export function useTakeoffJobPolling(
  jobId: string
): UseTakeoffJobPollingResult {
  const [data, setData] = useState<TakeoffJobDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [isPolling, setIsPolling] = useState(true);

  const consecutiveErrorsRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const refetchTriggerRef = useRef(0);

  const stopPolling = useCallback(() => {
    setIsPolling(false);
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    if (!mountedRef.current) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const result = await fetchTakeoffJob(jobId, {
        signal: controller.signal,
      });

      if (!mountedRef.current) return;

      setData(result);
      setError(null);
      setErrorStatus(null);
      consecutiveErrorsRef.current = 0;

      const jobStatus = result.job.status;
      if (TAKEOFF_JOB_TERMINAL_STATUSES.has(jobStatus)) {
        stopPolling();
        return;
      }

      timeoutRef.current = setTimeout(poll, BASE_POLL_INTERVAL_MS);
    } catch (err) {
      if (!mountedRef.current) return;
      if (controller.signal.aborted) return;

      const status = isTakeoffApiError(err) ? err.status : null;
      const message =
        err instanceof Error ? err.message : "Erreur inconnue.";

      setError(message);
      setErrorStatus(status);

      if (status !== null && PERMANENT_ERROR_STATUSES.has(status)) {
        stopPolling();
        return;
      }

      consecutiveErrorsRef.current += 1;
      const delay = getBackoffInterval(consecutiveErrorsRef.current);
      timeoutRef.current = setTimeout(poll, delay);
    }
  }, [jobId, stopPolling]);

  const refetch = useCallback(() => {
    consecutiveErrorsRef.current = 0;
    setError(null);
    setErrorStatus(null);
    setIsPolling(true);

    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    refetchTriggerRef.current += 1;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    poll();

    return () => {
      mountedRef.current = false;
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, refetchTriggerRef.current]);

  return { data, error, errorStatus, isPolling, refetch };
}
