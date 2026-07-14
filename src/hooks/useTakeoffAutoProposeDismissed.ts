import { useCallback, useMemo, useSyncExternalStore } from "react";

const STORAGE_KEY_PREFIX = "takeoff-auto-propose:v2";
const STORAGE_CHANGE_EVENT = "takeoff-auto-propose:storage-change";
const SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000;

type UseTakeoffAutoProposeDismissedOptions = {
  context?: "hub" | "import";
  profileId?: string | null;
  scopeKey?: string | null;
};

type SnoozePayload = {
  until: string;
  scopeKey: string | null;
};

function buildScopedKey(input: {
  kind: "dismissed" | "snooze";
  projectId: string;
  context: string;
  profileId: string | null;
}) {
  return `${STORAGE_KEY_PREFIX}:${input.kind}:${input.profileId ?? "anonymous"}:${input.projectId}:${input.context}`;
}

function readDismissed(input: {
  projectId: string;
  context: string;
  profileId: string | null;
}) {
  try {
    return localStorage.getItem(
      buildScopedKey({ ...input, kind: "dismissed" }),
    ) === "1";
  } catch {
    return false;
  }
}

function readSnooze(input: {
  projectId: string;
  context: string;
  profileId: string | null;
  scopeKey: string | null;
}) {
  try {
    const raw = localStorage.getItem(
      buildScopedKey({ ...input, kind: "snooze" }),
    );
    if (!raw) {
      return false;
    }

    const parsed = JSON.parse(raw) as Partial<SnoozePayload>;
    if (typeof parsed.until !== "string") {
      return false;
    }

    const until = new Date(parsed.until);
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
      localStorage.removeItem(buildScopedKey({ ...input, kind: "snooze" }));
      return false;
    }

    if ((parsed.scopeKey ?? null) !== input.scopeKey) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function notifyStorageChange() {
  window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT));
}

export function useTakeoffAutoProposeDismissed(
  projectId: string,
  options: UseTakeoffAutoProposeDismissedOptions = {},
) {
  const context = options.context ?? "hub";
  const profileId = options.profileId ?? null;
  const scopeKey = options.scopeKey ?? null;
  const scopedStorageKeys = useMemo(
    () => ({
      dismissed: buildScopedKey({
        kind: "dismissed",
        projectId,
        context,
        profileId,
      }),
      snooze: buildScopedKey({
        kind: "snooze",
        projectId,
        context,
        profileId,
      }),
    }),
    [context, profileId, projectId],
  );
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const handleStorage = (event: StorageEvent) => {
        if (
          event.key === null ||
          event.key === scopedStorageKeys.dismissed ||
          event.key === scopedStorageKeys.snooze
        ) {
          onStoreChange();
        }
      };
      window.addEventListener("storage", handleStorage);
      window.addEventListener(STORAGE_CHANGE_EVENT, onStoreChange);
      return () => {
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(STORAGE_CHANGE_EVENT, onStoreChange);
      };
    },
    [scopedStorageKeys.dismissed, scopedStorageKeys.snooze],
  );
  const getSnapshot = useCallback(
    () =>
      `${readDismissed({ projectId, context, profileId }) ? "1" : "0"}:${
        readSnooze({ projectId, context, profileId, scopeKey }) ? "1" : "0"
      }`,
    [context, profileId, projectId, scopeKey],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => "0:0");
  const [dismissedValue, snoozedValue] = snapshot.split(":");
  const dismissed = dismissedValue === "1";
  const snoozed = snoozedValue === "1";

  const dismissPermanently = useCallback(() => {
    try {
      localStorage.setItem(scopedStorageKeys.dismissed, "1");
      localStorage.removeItem(scopedStorageKeys.snooze);
    } catch {}
    notifyStorageChange();
  }, [scopedStorageKeys.dismissed, scopedStorageKeys.snooze]);

  const dismissTemporarily = useCallback(() => {
    const payload: SnoozePayload = {
      until: new Date(Date.now() + SNOOZE_DURATION_MS).toISOString(),
      scopeKey,
    };

    try {
      localStorage.setItem(scopedStorageKeys.snooze, JSON.stringify(payload));
    } catch {}
    notifyStorageChange();
  }, [scopeKey, scopedStorageKeys.snooze]);

  const clearTemporaryDismissal = useCallback(() => {
    try {
      localStorage.removeItem(scopedStorageKeys.snooze);
    } catch {}
    notifyStorageChange();
  }, [scopedStorageKeys.snooze]);

  return {
    dismissed,
    temporarilyDismissed: snoozed,
    dismissPermanently,
    dismissTemporarily,
    clearTemporaryDismissal,
  };
}
