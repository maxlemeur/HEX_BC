import { isRecord } from "@/lib/value-guards";

const AUTOSAVE_PREFERENCE_STORAGE_PREFIX =
  "estimate:edit:autosave-enabled:v1:";

export type EditorConflictDraft<TSettings, TItem> = {
  settings: TSettings | null;
  items: TItem[];
  saved_at: string;
};

export type EditorAutoSaveDraft<TUpdate> = {
  buffered_updates: {
    id: string;
    updates: TUpdate;
  }[];
  saved_at: string;
};

function buildAutoSavePreferenceStorageKey(userId: string) {
  return `${AUTOSAVE_PREFERENCE_STORAGE_PREFIX}${userId}`;
}

export function readAutoSaveEnabledPreferenceFromLocal(userId: string | null) {
  if (!userId || typeof window === "undefined") return true;

  try {
    const raw = window.localStorage.getItem(
      buildAutoSavePreferenceStorageKey(userId)
    );
    if (!raw) return true;

    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) && typeof parsed.enabled === "boolean"
      ? parsed.enabled
      : true;
  } catch {
    return true;
  }
}

export function writeAutoSaveEnabledPreferenceToLocal(
  userId: string | null,
  enabled: boolean
) {
  if (!userId || typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      buildAutoSavePreferenceStorageKey(userId),
      JSON.stringify({ enabled })
    );
  } catch {
    // The preference is best-effort; the in-memory choice remains effective.
  }
}
