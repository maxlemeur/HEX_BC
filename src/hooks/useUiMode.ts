"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { updateProfileUiMode } from "@/app/dashboard/_actions/profile";
import { useUserContext } from "@/components/UserContext";
import {
  DEFAULT_UI_MODE,
  isUiMode,
  normalizeUiMode,
  type UiMode,
} from "@/lib/ui-mode";

const UI_MODE_STORAGE_KEY_PREFIX = "timax-ui-mode";
const ONBOARDING_MODE_STORAGE_KEY = "timax-onboarding-ui-mode";

function getUiModeStorageKey(profileId: string | null) {
  return profileId
    ? `${UI_MODE_STORAGE_KEY_PREFIX}:${profileId}`
    : UI_MODE_STORAGE_KEY_PREFIX;
}

function readUiModeFromStorage(profileId: string | null): UiMode | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = localStorage.getItem(getUiModeStorageKey(profileId));
    return isUiMode(rawValue) ? rawValue : null;
  } catch {
    return null;
  }
}

function writeUiModeToStorage(mode: UiMode, profileId: string | null) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(getUiModeStorageKey(profileId), mode);
    localStorage.setItem(ONBOARDING_MODE_STORAGE_KEY, mode);
  } catch {
    // Keep the UI usable even if storage fails.
  }
}

type SetModeInput = UiMode | ((previousMode: UiMode) => UiMode);

export function useUiMode() {
  const { profile, setProfile } = useUserContext();
  const profileId = profile?.id ?? null;
  const profileMode = normalizeUiMode(profile?.ui_mode ?? DEFAULT_UI_MODE);

  const [fallbackMode, setFallbackMode] = useState<UiMode>(
    () => readUiModeFromStorage(null) ?? profileMode
  );
  const mode = profileId ? profileMode : fallbackMode;

  const profileIdRef = useRef<string | null>(profileId);
  const modeRef = useRef<UiMode>(mode);
  const syncedDbModeRef = useRef<UiMode>(profileMode);

  const syncModeToDatabase = useCallback(
    (nextMode: UiMode, expectedProfileId: string) => {
      if (!expectedProfileId) return;

      void updateProfileUiMode({ mode: nextMode })
        .then((result) => {
          const persistedMode = normalizeUiMode(result.mode);
          setProfile((currentProfile) =>
            currentProfile?.id === expectedProfileId
              ? {
                  ...currentProfile,
                  ui_mode: persistedMode,
                }
              : currentProfile
          );

          if (profileIdRef.current === expectedProfileId) {
            syncedDbModeRef.current = persistedMode;
          }
        })
        .catch(() => {
          // Keep optimistic mode locally if the round-trip fails.
        });
    },
    [setProfile]
  );

  useEffect(() => {
    modeRef.current = mode;
    writeUiModeToStorage(mode, profileId);
  }, [mode, profileId]);

  useEffect(() => {
    profileIdRef.current = profileId;
    syncedDbModeRef.current = profileMode;
  }, [profileId, profileMode]);

  const setMode = useCallback(
    (next: SetModeInput) => {
      const computedMode = normalizeUiMode(
        typeof next === "function" ? next(modeRef.current) : next
      );

      if (computedMode === modeRef.current) {
        return;
      }

      modeRef.current = computedMode;
      writeUiModeToStorage(computedMode, profileIdRef.current);

      if (!profileIdRef.current) {
        setFallbackMode(computedMode);
        return;
      }

      setProfile((currentProfile) =>
        currentProfile
          ? {
              ...currentProfile,
              ui_mode: computedMode,
            }
          : currentProfile
      );

      if (profileIdRef.current && syncedDbModeRef.current !== computedMode) {
        const expectedProfileId = profileIdRef.current;
        syncedDbModeRef.current = computedMode;
        syncModeToDatabase(computedMode, expectedProfileId);
      }
    },
    [setProfile, syncModeToDatabase]
  );

  return useMemo(
    () => ({
      mode,
      setMode,
      isExpert: mode === "expert",
      isSimplified: mode === "simplified",
    }),
    [mode, setMode]
  );
}
