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

const UI_MODE_STORAGE_KEY = "timax-ui-mode";
const ONBOARDING_MODE_STORAGE_KEY = "timax-onboarding-ui-mode";

function readUiModeFromStorage(): UiMode | null {
  if (typeof window === "undefined") return null;

  try {
    const rawValue = localStorage.getItem(UI_MODE_STORAGE_KEY);
    return isUiMode(rawValue) ? rawValue : null;
  } catch {
    return null;
  }
}

function writeUiModeToStorage(mode: UiMode) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
    localStorage.setItem(ONBOARDING_MODE_STORAGE_KEY, mode);
  } catch {
    // Keep the UI usable even if storage fails.
  }
}

type SetModeInput = UiMode | ((previousMode: UiMode) => UiMode);

export function useUiMode() {
  const { profile, setProfile } = useUserContext();
  const profileMode = normalizeUiMode(profile?.ui_mode ?? DEFAULT_UI_MODE);

  const [mode, setModeState] = useState<UiMode>(
    () => readUiModeFromStorage() ?? profileMode
  );

  const profileIdRef = useRef<string | null>(profile?.id ?? null);
  const modeRef = useRef<UiMode>(mode);
  const syncedDbModeRef = useRef<UiMode>(profileMode);

  const syncModeToDatabase = useCallback(
    (nextMode: UiMode) => {
      if (!profileIdRef.current) return;

      void updateProfileUiMode({ mode: nextMode })
        .then((result) => {
          const persistedMode = normalizeUiMode(result.mode);
          syncedDbModeRef.current = persistedMode;

          setProfile((currentProfile) =>
            currentProfile
              ? {
                  ...currentProfile,
                  ui_mode: persistedMode,
                }
              : currentProfile
          );
        })
        .catch(() => {
          // Keep optimistic mode locally if the round-trip fails.
        });
    },
    [setProfile]
  );

  useEffect(() => {
    modeRef.current = mode;
    writeUiModeToStorage(mode);
  }, [mode]);

  useEffect(() => {
    profileIdRef.current = profile?.id ?? null;

    if (!profileIdRef.current) {
      return;
    }

    if (profileMode === modeRef.current) {
      syncedDbModeRef.current = profileMode;
      return;
    }

    if (syncedDbModeRef.current !== modeRef.current) {
      syncedDbModeRef.current = modeRef.current;
      syncModeToDatabase(modeRef.current);
    }
  }, [profile?.id, profileMode, syncModeToDatabase]);

  const setMode = useCallback(
    (next: SetModeInput) => {
      const computedMode = normalizeUiMode(
        typeof next === "function" ? next(modeRef.current) : next
      );

      if (computedMode === modeRef.current) {
        return;
      }

      modeRef.current = computedMode;
      setModeState(computedMode);
      writeUiModeToStorage(computedMode);

      setProfile((currentProfile) =>
        currentProfile
          ? {
              ...currentProfile,
              ui_mode: computedMode,
            }
          : currentProfile
      );

      if (profileIdRef.current && syncedDbModeRef.current !== computedMode) {
        syncedDbModeRef.current = computedMode;
        syncModeToDatabase(computedMode);
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
