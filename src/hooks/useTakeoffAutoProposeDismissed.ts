import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY_PREFIX = "takeoff-auto-propose-dismissed-";

function readDismissed(projectId: string) {
  try {
    return localStorage.getItem(`${STORAGE_KEY_PREFIX}${projectId}`) === "1";
  } catch {
    return false;
  }
}

export function useTakeoffAutoProposeDismissed(projectId: string) {
  const [dismissed, setDismissed] = useState(false);
  const prevProjectIdRef = useRef(projectId);

  // Sync from localStorage when projectId changes (not on initial mount
  // to avoid SSR hydration mismatch — initial value is always false).
  useEffect(() => {
    const value = readDismissed(projectId);
    if (value !== dismissed || prevProjectIdRef.current !== projectId) {
      prevProjectIdRef.current = projectId;
      if (value) setDismissed(true);
      else setDismissed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const dismissPermanently = useCallback(() => {
    try {
      localStorage.setItem(`${STORAGE_KEY_PREFIX}${projectId}`, "1");
    } catch {}
    setDismissed(true);
  }, [projectId]);

  return { dismissed, dismissPermanently };
}
