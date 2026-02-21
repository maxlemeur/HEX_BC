"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 2000;
export const DEFAULT_AUTOSAVE_RETRY_DELAY_MS = 2000;

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";
export type AutoSaveReason = "debounce" | "manual" | "retry";
export type AutoSaveResult = "saved" | "noop" | "blocked" | "error";

type SaveShortcutLikeEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
};

export type UseAutoSaveOptions = {
  enabled: boolean;
  hasPendingChanges: boolean;
  debounceMs?: number;
  retryDelayMs?: number;
  enableShortcut?: boolean;
  enableBeforeUnloadGuard?: boolean;
  onSave: (reason: AutoSaveReason) => Promise<AutoSaveResult>;
};

export type UseAutoSaveResult = {
  status: AutoSaveStatus;
  statusLabel: string;
  isSaving: boolean;
  flushNow: () => Promise<void>;
  scheduleSave: () => void;
};

export function isSaveShortcutKey(event: SaveShortcutLikeEvent) {
  return event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey);
}

export function shouldBlockBeforeUnload(
  hasPendingChanges: boolean,
  isSaving: boolean
) {
  return hasPendingChanges || isSaving;
}

export function resolveAutoSaveStatusLabel(status: AutoSaveStatus) {
  switch (status) {
    case "saving":
      return "Sauvegarde en cours...";
    case "error":
      return "Erreur de sauvegarde";
    case "saved":
    case "idle":
    default:
      return "Sauvegarde";
  }
}

export function useAutoSave({
  enabled,
  hasPendingChanges,
  debounceMs = DEFAULT_AUTOSAVE_DEBOUNCE_MS,
  retryDelayMs = DEFAULT_AUTOSAVE_RETRY_DELAY_MS,
  enableShortcut = true,
  enableBeforeUnloadGuard = true,
  onSave,
}: UseAutoSaveOptions): UseAutoSaveResult {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [isSaving, setIsSaving] = useState(false);

  const debounceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queuedSaveAfterCurrentRef = useRef(false);
  const executeSaveRef = useRef<((reason: AutoSaveReason) => Promise<void>) | null>(
    null
  );

  const isSavingRef = useRef(isSaving);
  const enabledRef = useRef(enabled);
  const hasPendingRef = useRef(hasPendingChanges);
  const debounceMsRef = useRef(debounceMs);
  const retryDelayMsRef = useRef(retryDelayMs);
  const onSaveRef = useRef(onSave);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    hasPendingRef.current = hasPendingChanges;
  }, [hasPendingChanges]);

  useEffect(() => {
    debounceMsRef.current = debounceMs;
  }, [debounceMs]);

  useEffect(() => {
    retryDelayMsRef.current = retryDelayMs;
  }, [retryDelayMs]);

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

  const scheduleDebouncedSave = useCallback(() => {
    if (!enabledRef.current) return;
    if (!hasPendingRef.current) return;

    clearDebounceTimer();
    debounceTimeoutRef.current = setTimeout(() => {
      debounceTimeoutRef.current = null;
      void executeSaveRef.current?.("debounce");
    }, debounceMsRef.current);
  }, [clearDebounceTimer]);

  const scheduleRetry = useCallback((force = false) => {
    if (!enabledRef.current) return;
    if (!force && !hasPendingRef.current) return;
    if (retryTimeoutRef.current !== null) return;

    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
      void executeSaveRef.current?.("retry");
    }, retryDelayMsRef.current);
  }, []);

  const executeSave = useCallback(
    async (reason: AutoSaveReason) => {
      if (!enabledRef.current) return;

      if (isSavingRef.current) {
        queuedSaveAfterCurrentRef.current = true;
        return;
      }

      if (!hasPendingRef.current) {
        setStatus("saved");
        return;
      }

      clearDebounceTimer();
      if (reason === "manual") {
        clearRetryTimer();
      }

      isSavingRef.current = true;
      setIsSaving(true);
      setStatus("saving");

      let shouldRetry = false;

      try {
        const result = await onSaveRef.current(reason);
        if (result === "error" || result === "blocked") {
          shouldRetry = true;
          setStatus("error");
        } else {
          setStatus("saved");
        }
      } catch {
        shouldRetry = true;
        setStatus("error");
      } finally {
        isSavingRef.current = false;
        setIsSaving(false);

        if (shouldRetry) {
          scheduleRetry(true);
        } else if (queuedSaveAfterCurrentRef.current && hasPendingRef.current) {
          queuedSaveAfterCurrentRef.current = false;
          scheduleDebouncedSave();
        } else {
          queuedSaveAfterCurrentRef.current = false;
        }
      }
    },
    [clearDebounceTimer, clearRetryTimer, scheduleDebouncedSave, scheduleRetry]
  );

  useEffect(() => {
    executeSaveRef.current = executeSave;
  }, [executeSave]);

  const scheduleSave = useCallback(() => {
    if (!enabledRef.current) return;
    if (!hasPendingRef.current) return;
    scheduleDebouncedSave();
  }, [scheduleDebouncedSave]);

  const flushNow = useCallback(async () => {
    await executeSave("manual");
  }, [executeSave]);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      if (!isSavingRef.current) {
        setStatus("idle");
      }
      return;
    }

    if (hasPendingChanges && !isSavingRef.current) {
      scheduleDebouncedSave();
      return;
    }

    if (!hasPendingChanges) {
      clearTimers();
      if (!isSavingRef.current) {
        setStatus("saved");
      }
    }
  }, [clearTimers, enabled, hasPendingChanges, scheduleDebouncedSave]);

  useEffect(() => {
    if (!enabled || !enableShortcut) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSaveShortcutKey(event)) return;
      if (!hasPendingRef.current && !isSavingRef.current) return;

      event.preventDefault();
      void executeSave("manual");
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [enableShortcut, enabled, executeSave]);

  useEffect(() => {
    if (!enabled || !enableBeforeUnloadGuard) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldBlockBeforeUnload(
          hasPendingRef.current,
          isSavingRef.current
        )
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [enableBeforeUnloadGuard, enabled]);

  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, [clearTimers]);

  return {
    status,
    statusLabel: resolveAutoSaveStatusLabel(status),
    isSaving,
    flushNow,
    scheduleSave,
  };
}
