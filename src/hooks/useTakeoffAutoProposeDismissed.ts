import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const STORAGE_KEY_PREFIX = "takeoff-auto-propose:v2";
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

export function useTakeoffAutoProposeDismissed(
  projectId: string,
  options: UseTakeoffAutoProposeDismissedOptions = {},
) {
  const context = options.context ?? "hub";
  const profileId = options.profileId ?? null;
  const scopeKey = options.scopeKey ?? null;
  const [dismissed, setDismissed] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
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
  const prevSyncKeyRef = useRef(
    `${projectId}:${context}:${profileId ?? "anonymous"}:${scopeKey ?? "none"}`,
  );

  useEffect(() => {
    const nextSyncKey = `${projectId}:${context}:${profileId ?? "anonymous"}:${scopeKey ?? "none"}`;
    const nextDismissed = readDismissed({ projectId, context, profileId });
    const nextSnoozed = readSnooze({
      projectId,
      context,
      profileId,
      scopeKey,
    });

    if (
      prevSyncKeyRef.current !== nextSyncKey ||
      nextDismissed !== dismissed ||
      nextSnoozed !== snoozed
    ) {
      prevSyncKeyRef.current = nextSyncKey;
      setDismissed(nextDismissed);
      setSnoozed(nextSnoozed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context, dismissed, profileId, projectId, scopeKey, snoozed]);

  const dismissPermanently = useCallback(() => {
    try {
      localStorage.setItem(scopedStorageKeys.dismissed, "1");
      localStorage.removeItem(scopedStorageKeys.snooze);
    } catch {}
    setDismissed(true);
    setSnoozed(false);
  }, [scopedStorageKeys.dismissed, scopedStorageKeys.snooze]);

  const dismissTemporarily = useCallback(() => {
    const payload: SnoozePayload = {
      until: new Date(Date.now() + SNOOZE_DURATION_MS).toISOString(),
      scopeKey,
    };

    try {
      localStorage.setItem(scopedStorageKeys.snooze, JSON.stringify(payload));
    } catch {}
    setSnoozed(true);
  }, [scopeKey, scopedStorageKeys.snooze]);

  const clearTemporaryDismissal = useCallback(() => {
    try {
      localStorage.removeItem(scopedStorageKeys.snooze);
    } catch {}
    setSnoozed(false);
  }, [scopedStorageKeys.snooze]);

  return {
    dismissed,
    temporarilyDismissed: snoozed,
    dismissPermanently,
    dismissTemporarily,
    clearTemporaryDismissal,
  };
}
