import {
  isRecord,
  toNonEmptyString,
} from "@/lib/estimates/editor-values";

const CONFLICT_DRAFT_STORAGE_PREFIX = "estimate:edit:conflict-draft:";
const AUTOSAVE_BUFFER_STORAGE_PREFIX = "estimate:edit:autosave-buffer:";

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

function buildConflictDraftStorageKey(versionId: string) {
  return `${CONFLICT_DRAFT_STORAGE_PREFIX}${versionId}`;
}

function buildAutoSaveDraftStorageKey(versionId: string) {
  return `${AUTOSAVE_BUFFER_STORAGE_PREFIX}${versionId}`;
}

export function readConflictDraftFromSession<TSettings, TItem>(
  versionId: string
): EditorConflictDraft<TSettings, TItem> | null {
  if (!versionId || typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(
      buildConflictDraftStorageKey(versionId)
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return null;

    const settingsValue = parsed.settings;
    if (
      settingsValue !== null &&
      settingsValue !== undefined &&
      !isRecord(settingsValue)
    ) {
      return null;
    }

    if (!Array.isArray(parsed.items)) return null;

    return {
      settings:
        settingsValue === null || settingsValue === undefined
          ? null
          : (settingsValue as TSettings),
      items: parsed.items as TItem[],
      saved_at: toNonEmptyString(parsed.saved_at) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeConflictDraftToSession<TSettings, TItem>(
  versionId: string,
  draft: EditorConflictDraft<TSettings, TItem>
) {
  if (!versionId || typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      buildConflictDraftStorageKey(versionId),
      JSON.stringify(draft)
    );
  } catch {
    // Storage can be unavailable or full; drafts must never break the editor.
  }
}

export function clearConflictDraftFromSession(versionId: string) {
  if (!versionId || typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(buildConflictDraftStorageKey(versionId));
  } catch {
    // Best-effort cleanup when browser storage is unavailable.
  }
}

export function readAutoSaveDraftFromLocal<TUpdate>(
  versionId: string
): EditorAutoSaveDraft<TUpdate> | null {
  if (!versionId || typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(
      buildAutoSaveDraftStorageKey(versionId)
    );
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.buffered_updates)) {
      return null;
    }

    const bufferedUpdates = parsed.buffered_updates
      .map((entry) => {
        if (!isRecord(entry)) return null;
        if (typeof entry.id !== "string" || !entry.id) return null;
        if (!isRecord(entry.updates)) return null;
        return {
          id: entry.id,
          updates: entry.updates as TUpdate,
        };
      })
      .filter(
        (value): value is EditorAutoSaveDraft<TUpdate>["buffered_updates"][number] =>
          value !== null
      );

    if (bufferedUpdates.length === 0) return null;

    return {
      buffered_updates: bufferedUpdates,
      saved_at: toNonEmptyString(parsed.saved_at) ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeAutoSaveDraftToLocal<TUpdate>(
  versionId: string,
  bufferedUpdates: EditorAutoSaveDraft<TUpdate>["buffered_updates"]
) {
  if (!versionId || typeof window === "undefined") return;

  if (bufferedUpdates.length === 0) {
    clearAutoSaveDraftFromLocal(versionId);
    return;
  }

  const payload: EditorAutoSaveDraft<TUpdate> = {
    buffered_updates: bufferedUpdates,
    saved_at: new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(
      buildAutoSaveDraftStorageKey(versionId),
      JSON.stringify(payload)
    );
  } catch {
    // Storage can be unavailable or full; in-memory autosave remains active.
  }
}

export function clearAutoSaveDraftFromLocal(versionId: string) {
  if (!versionId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(buildAutoSaveDraftStorageKey(versionId));
  } catch {
    // Best-effort cleanup when browser storage is unavailable.
  }
}
