"use client";

import { useCallback, useRef, useState } from "react";

import { useOptionalUserContext } from "@/components/UserContext";

/**
 * Unidentified authenticated sessions never read a previous user's browser
 * preferences. The unscoped key is retained only outside UserProvider (tests).
 */
export function useEstimatePreferenceKey(key: string) {
  const context = useOptionalUserContext();
  return context ? (context.profile?.id ? `${key}:${context.profile.id}` : null) : key;
}

export function useEstimatePreferenceStorage<T>(
  key: string | null,
  parse: (raw: string | null) => T,
  serialize: (value: T) => string | null = JSON.stringify,
) {
  const read = () => {
    try {
      return parse(key && typeof window !== "undefined" ? localStorage.getItem(key) : null);
    } catch {
      return parse(null);
    }
  };
  const [stored, setStored] = useState(() => ({ key, value: read() }));
  const current = stored.key === key ? stored : { key, value: read() };
  if (stored.key !== key) setStored(current);
  const valueRef = useRef(current);
  valueRef.current = current;

  const update = useCallback((input: T | ((previous: T) => T)) => {
    const previous = valueRef.current;
    // A callback from a prior session must not mutate the new session's preferences.
    if (previous.key !== key) return;
    const value = typeof input === "function"
      ? (input as (previous: T) => T)(previous.value)
      : input;
    const next = { key, value };
    valueRef.current = next;
    setStored(next);
    if (!key || typeof window === "undefined") return;
    try {
      const raw = serialize(value);
      if (raw === null) localStorage.removeItem(key);
      else localStorage.setItem(key, raw);
    } catch {
      // Display preferences remain usable when browser storage is unavailable.
    }
  }, [key, serialize]);

  return [current.value, update] as const;
}
