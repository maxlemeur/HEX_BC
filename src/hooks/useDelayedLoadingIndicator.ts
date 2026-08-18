"use client";

import { useEffect, useState } from "react";

export const SLOW_LOADING_DELAY_MS = 3_000;

export function useDelayedLoadingIndicator(
  isLoading: boolean,
  delayMs = SLOW_LOADING_DELAY_MS
) {
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setIsSlow(false);
      return;
    }

    const timeout = setTimeout(() => setIsSlow(true), delayMs);
    return () => clearTimeout(timeout);
  }, [delayMs, isLoading]);

  return isSlow;
}
