"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 2000;
export const DEFAULT_AUTOSAVE_RETRY_DELAY_MS = 2000;
export const DEFAULT_AUTOSAVE_MAX_RETRIES = 3;
export const MAX_AUTOSAVE_RETRY_DELAY_MS = 30_000;

export type AutoSaveStatus =
  | "idle"
  | "pending"
  | "saving"
  | "saved"
  | "error"
  | "offline"
  | "disabled"
  | "blocked";
export type AutoSaveReason = "debounce" | "manual" | "retry" | "reconnect";
export type AutoSaveResult = "saved" | "noop" | "blocked" | "error";

type SaveShortcutLikeEvent = {
  key?: string | null;
  ctrlKey?: boolean;
  metaKey?: boolean;
};

export type UseAutoSaveOptions = {
  enabled: boolean;
  automaticEnabled?: boolean;
  hasPendingChanges: boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  maxAutomaticRetries?: number;
  enableShortcut?: boolean;
  enableBeforeUnloadGuard?: boolean;
  onSave: (reason: AutoSaveReason) => Promise<AutoSaveResult>;
};

export type UseAutoSaveResult = {
  status: AutoSaveStatus;
  statusLabel: string;
  isSaving: boolean;
  isOnline: boolean;
  lastSavedAt: string | null;
  flushNow: () => Promise<void>;
  scheduleSave: () => void;
};

type RestingStatusInput = {
  enabled: boolean;
  automaticEnabled: boolean;
  hasPendingChanges: boolean;
  isOnline: boolean;
};

function readBrowserOnlineStatus() {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function resolveRestingStatus({
  enabled,
  automaticEnabled,
  hasPendingChanges,
  isOnline,
}: RestingStatusInput): AutoSaveStatus {
  if (!enabled) return "blocked";
  if (!isOnline && hasPendingChanges) return "offline";
  if (!automaticEnabled) {
    return hasPendingChanges ? "pending" : "disabled";
  }
  return hasPendingChanges ? "pending" : "idle";
}

export function isSaveShortcutKey(event: SaveShortcutLikeEvent) {
  const normalizedKey = event.key?.toLowerCase();
  return normalizedKey === "s" && Boolean(event.ctrlKey || event.metaKey);
}

export function shouldBlockBeforeUnload(
  hasPendingChanges: boolean,
  isSaving: boolean
) {
  return hasPendingChanges || isSaving;
}

export function shouldAutomaticallyRetry(result: AutoSaveResult) {
  return result === "error";
}

export function resolveAutoSaveRetryDelay(
  retryDelayMs: number,
  retryAttempt: number
) {
  return Math.min(
    retryDelayMs * 2 ** Math.max(0, retryAttempt),
    MAX_AUTOSAVE_RETRY_DELAY_MS
  );
}

export function resolveAutoSaveStatusLabel(status: AutoSaveStatus) {
  switch (status) {
    case "pending":
      return "En attente";
    case "saving":
      return "Synchronisation…";
    case "error":
      return "Échec de synchronisation";
    case "offline":
      return "Hors ligne";
    case "disabled":
      return "Auto désactivée";
    case "blocked":
      return "Synchronisation bloquée";
    case "saved":
      return "Sauvegardé";
    case "idle":
    default:
      return "À jour";
  }
}

export function useAutoSave({
  enabled,
  automaticEnabled = true,
  hasPendingChanges,
  debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  retryDelayMs = DEFAULT_AUTOSAVE_RETRY_DELAY_MS,
  maxAutomaticRetries = DEFAULT_AUTOSAVE_MAX_RETRIES,
  enableShortcut = true,
  enableBeforeUnloadGuard = true,
  onSave,
}: UseAutoSaveOptions): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>(() =>
    resolveRestingStatus({
      enabled,
      automaticEnabled,
      hasPendingChanges,
      isOnline: readBrowserOnlineStatus(),
    })
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isOnline, setIsOnline] = useState(readBrowserOnlineStatus);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedSaveAfterCurrentRef = useRef(false);
  const automaticRetryCountRef = useRef(0);
  const executeSaveRef = useRef<
    ((reason: AutoSaveReason) => Promise<void>) | null
  >(null);

  const isMountedRef = useRef(true);
  const isSavingRef = useRef(isSaving);
  const enabledRef = useRef(enabled);
  const automaticEnabledRef = useRef(automaticEnabled);
  const hasPendingRef = useRef(hasPendingChanges);
  const isOnlineRef = useRef(isOnline);
  const debounceMsRef = useRef(debounceMs);
  const retryDelayMsRef = useRef(retryDelayMs);
  const maxAutomaticRetriesRef = useRef(maxAutomaticRetries);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      enabledRef.current = false;
      queuedSaveAfterCurrentRef.current = false;
      executeSaveRef.current = null;
    };
  }, []);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    automaticEnabledRef.current = automaticEnabled;
  }, [automaticEnabled]);

  useEffect(() => {
    hasPendingRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    isOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    debounceMsRef.current = debounceMs;
  }, [debounceMs]);

  useEffect(() => {
    retryDelayMsRef.current = retryDelayMs;
  }, [retryDelayMs]);

  useEffect(() => {
    maxAutomaticRetriesRef.current = maxAutomaticRetries;
  }, [maxAutomaticRetries]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimeoutRef.current !== null) {
      clearTimeout(debounceTimeoutRef.current);
      debounceTimeoutRef.current = null;
    }
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (retryTimeoutRef.current !== null) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const clearTimers = useCallback(() => {
    clearDebounceTimer();
    clearRetryTimer();
  }, [clearDebounceTimer, clearRetryTimer]);

  const currentRestingStatus = useCallback(
    () =>
      resolveRestingStatus({
        enabled: enabledRef.current,
        automaticEnabled: automaticEnabledRef.current,
        hasPendingChanges: hasPendingRef.current,
        isOnline: isOnlineRef.current,
      }),
    []
  );

  const scheduleDebouncedSave = useCallback(() => {
    if (!isMountedRef.current) return;
    if (!enabledRef.current || !automaticEnabledRef.current) return;
    if (!isOnlineRef.current || !hasPendingRef.current) return;

    setStatus("pending");
    clearDebounceTimer();
    debounceTimeoutRef.current = setTimeout(() => {
      debounceTimeoutRef.current = null;
      void executeSaveRef.current?.("debounce");
    }, debounceMsRef.current);
  }, [clearDebounceTimer]);

  const scheduleRetry = useCallback((force = false) => {
    if (!isMountedRef.current) return;
    if (!enabledRef.current || !automaticEnabledRef.current) return;
    if (!isOnlineRef.current) return;
    if (!force && !hasPendingRef.current) return;
    if (retryTimeoutRef.current !== null) return;
    if (automaticRetryCountRef.current >= maxAutomaticRetriesRef.current) return;

    const delay = resolveAutoSaveRetryDelay(
      retryDelayMsRef.current,
      automaticRetryCountRef.current
    );
    automaticRetryCountRef.current += 1;

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      void executeSaveRef.current?.("retry");
    }, delay);
  }, []);

  const executeSave = useCallback(
    async (reason: AutoSaveReason) => {
      if (!isMountedRef.current) return;
      if (!enabledRef.current) {
        setStatus("blocked");
        return;
      }
      if (!isOnlineRef.current) {
        setStatus("offline");
        return;
      }

      if (isSavingRef.current) {
        queuedSaveAfterCurrentRef.current = true;
        return;
      }

      if (!hasPendingRef.current) {
        setStatus(currentRestingStatus());
        return;
      }

      clearDebounceTimer();
      if (reason === "manual" || reason === "reconnect") {
        clearRetryTimer();
        automaticRetryCountRef.current = 0;
      }

      isSavingRef.current = true;
      setIsSaving(true);
      setStatus("saving");

      let shouldRetry = false;

      try {
        const result = await onSaveRef.current(reason);
        if (!isMountedRef.current) return;

        if (result === "error") {
          shouldRetry = true;
          setStatus("error");
        } else if (result === "blocked") {
          setStatus("blocked");
        } else if (result === "saved") {
          automaticRetryCountRef.current = 0;
          setLastSavedAt(new Date().toISOString());
          setStatus("saved");
        } else {
          automaticRetryCountRef.current = 0;
          setStatus(currentRestingStatus());
        }
      } catch {
        if (!isMountedRef.current) return;
        shouldRetry = true;
        setStatus("error");
      } finally {
        isSavingRef.current = false;
        if (!isMountedRef.current) {
          queuedSaveAfterCurrentRef.current = false;
          return;
        }
        setIsSaving(false);

        if (shouldRetry) {
          scheduleRetry(true);
        } else if (queuedSaveAfterCurrentRef.current && hasPendingRef.current) {
          queuedSaveAfterCurrentRef.current = false;
          if (automaticEnabledRef.current) {
            scheduleDebouncedSave();
          } else {
            setStatus("pending");
          }
        } else {
          queuedSaveAfterCurrentRef.current = false;
        }
      }
    },
    [
      clearDebounceTimer,
      clearRetryTimer,
      currentRestingStatus,
      scheduleDebouncedSave,
      scheduleRetry,
    ]
  );

  useEffect(() => {
    executeSaveRef.current = executeSave;
  }, [executeSave]);

  const scheduleSave = useCallback(() => {
    if (!enabledRef.current || !hasPendingRef.current) return;
    if (!automaticEnabledRef.current) {
      setStatus("pending");
      return;
    }
    scheduleDebouncedSave();
  }, [scheduleDebouncedSave]);

  const flushNow = useCallback(async () => {
    await executeSave("manual");
  }, [executeSave]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      if (!isSavingRef.current) setStatus("blocked");
      return;
    }

    if (!isOnline && hasPendingChanges) {
      clearTimers();
      if (!isSavingRef.current) setStatus("offline");
      return;
    }

    if (!automaticEnabled) {
      clearTimers();
      if (!isSavingRef.current) {
        setStatus((current) =>
          current === "saved"
            ? current
            : hasPendingChanges
              ? "pending"
              : "disabled"
        );
      }
      return;
    }

    if (hasPendingChanges && !isSavingRef.current) {
      scheduleDebouncedSave();
      return;
    }

    if (!hasPendingChanges) {
      clearTimers();
      automaticRetryCountRef.current = 0;
      if (!isSavingRef.current) {
        setStatus((current) => (current === "saved" ? current : "idle"));
      }
    }
  }, [
    automaticEnabled,
    clearTimers,
    enabled,
    hasPendingChanges,
    isOnline,
    scheduleDebouncedSave,
  ]);

  useEffect(() => {
    const handleOffline = () => {
      isOnlineRef.current = false;
      setIsOnline(false);
      clearTimers();
      if (hasPendingRef.current && !isSavingRef.current) {
        setStatus("offline");
      }
    };
    const handleOnline = () => {
      isOnlineRef.current = true;
      setIsOnline(true);
      if (
        enabledRef.current &&
        automaticEnabledRef.current &&
        hasPendingRef.current
      ) {
        automaticRetryCountRef.current = 0;
        setStatus("pending");
        void executeSaveRef.current?.("reconnect");
      }
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [clearTimers]);

  useEffect(() => {
    if (!enableShortcut) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcutKey(event)) return;

      event.preventDefault();
      if (
        enabledRef.current &&
        (hasPendingRef.current || isSavingRef.current)
      ) {
        void executeSave("manual");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enableShortcut, executeSave]);

  useEffect(() => {
    if (!enableBeforeUnloadGuard) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!shouldBlockBeforeUnload(hasPendingRef.current, isSavingRef.current)) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [enableBeforeUnloadGuard]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => {
      setStatus(currentRestingStatus());
    }, 3000);
    return () => clearTimeout(timer);
  }, [currentRestingStatus, status]);

  return {
    status,
    statusLabel: resolveAutoSaveStatusLabel(status),
    isSaving,
    isOnline,
    lastSavedAt,
    flushNow,
    scheduleSave,
  };
}
