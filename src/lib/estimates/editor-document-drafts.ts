import type { EditorAutoSaveDraft, EditorConflictDraft } from "@/lib/estimates/editor-drafts";
import { isRecord } from "@/lib/estimates/editor-values";

export type EditorDocumentDraftScope = {
  actorId: string | null;
  tenantId: string | null;
  versionId: string;
};
type Identity = { actorId: string; tenantId: string; versionId: string };
type Kind = "autosave" | "conflict";

export const UNOWNED_DOCUMENT_DRAFT_MESSAGE = "Un ancien brouillon ne peut pas être restauré automatiquement.";
const PREFIX: Record<Kind, string> = {
  autosave: "estimate:edit:autosave-buffer:",
  conflict: "estimate:edit:conflict-draft:",
};

function identityOf(scope: EditorDocumentDraftScope): Identity | null {
  const actorId = scope.actorId?.trim().toLowerCase();
  const tenantId = scope.tenantId?.trim().toLowerCase();
  const versionId = scope.versionId.trim().toLowerCase();
  return actorId && tenantId && versionId ? { actorId, tenantId, versionId } : null;
}

/** V2 envelopes have { schemaVersion: 2, identity: { actorId, tenantId, versionId }, draft }. */
export function editorDocumentDraftStorageKey(kind: Kind, scope: EditorDocumentDraftScope): string | null {
  const identity = identityOf(scope);
  return identity ? `${PREFIX[kind]}v2:${[identity.actorId, identity.tenantId, identity.versionId].map(encodeURIComponent).join(":")}` : null;
}

function withStorage<T>(kind: Kind, fallback: T, action: (storage: Storage) => T): T {
  if (typeof window === "undefined") return fallback;
  try { return action(kind === "autosave" ? window.localStorage : window.sessionStorage); }
  catch { return fallback; }
}

function readEnvelope(kind: Kind, scope: EditorDocumentDraftScope): unknown {
  const expected = identityOf(scope);
  const key = editorDocumentDraftStorageKey(kind, scope);
  if (!expected || !key) return null;
  return withStorage(kind, null, (storage) => {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.identity)) return null;
    const identity = value.identity;
    if (typeof identity.actorId !== "string" || typeof identity.tenantId !== "string" || typeof identity.versionId !== "string") return null;
    const actual = identityOf({ actorId: identity.actorId, tenantId: identity.tenantId, versionId: identity.versionId });
    if (!actual || actual.actorId !== expected.actorId || actual.tenantId !== expected.tenantId || actual.versionId !== expected.versionId) return null;
    return value.draft;
  });
}

function writeEnvelope(kind: Kind, scope: EditorDocumentDraftScope, draft: unknown) {
  const identity = identityOf(scope);
  const key = editorDocumentDraftStorageKey(kind, scope);
  if (!identity || !key) return;
  withStorage(kind, undefined, (storage) => {
    storage.setItem(key, JSON.stringify({ schemaVersion: 2, identity, draft }));
  });
}

function clearEnvelope(kind: Kind, scope: EditorDocumentDraftScope) {
  const key = editorDocumentDraftStorageKey(kind, scope);
  if (!key) return;
  withStorage(kind, undefined, (storage) => { storage.removeItem(key); });
}

/** An unowned legacy payload is never read, displayed, removed, or attributed to the current actor. */
export function hasUnownedDocumentDraft(scope: EditorDocumentDraftScope): boolean {
  const identity = identityOf(scope);
  if (!identity) return false;
  const versionIds = new Set([scope.versionId, identity.versionId]);
  return (["autosave", "conflict"] as const).some((kind) => withStorage(kind, false, (storage) =>
    [...versionIds].some((versionId) => storage.getItem(`${PREFIX[kind]}${versionId}`) !== null)
  ));
}

export function readDocumentAutoSaveDraft<TUpdate>(scope: EditorDocumentDraftScope): EditorAutoSaveDraft<TUpdate> | null {
  const value = readEnvelope("autosave", scope);
  if (!isRecord(value) || !Array.isArray(value.buffered_updates) ||
      typeof value.saved_at !== "string" || !Number.isFinite(Date.parse(value.saved_at)) ||
      value.buffered_updates.length === 0) return null;
  const entries: EditorAutoSaveDraft<TUpdate>["buffered_updates"] = [];
  for (const entry of value.buffered_updates) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || !isRecord(entry.updates)) return null;
    entries.push({ id: entry.id, updates: entry.updates as TUpdate });
  }
  return { buffered_updates: entries, saved_at: value.saved_at };
}

export function writeDocumentAutoSaveDraft<TUpdate>(
  scope: EditorDocumentDraftScope,
  bufferedUpdates: EditorAutoSaveDraft<TUpdate>["buffered_updates"]
) {
  if (bufferedUpdates.length === 0) { clearDocumentAutoSaveDraft(scope); return; }
  writeEnvelope("autosave", scope, { buffered_updates: bufferedUpdates, saved_at: new Date().toISOString() });
}

export function clearDocumentAutoSaveDraft(scope: EditorDocumentDraftScope) { clearEnvelope("autosave", scope); }

export function readDocumentConflictDraft<TSettings, TItem>(
  scope: EditorDocumentDraftScope
): EditorConflictDraft<TSettings, TItem> | null {
  const value = readEnvelope("conflict", scope);
  if (!isRecord(value) || !Array.isArray(value.items) || value.items.some((item) => !isRecord(item)) ||
      (value.settings !== null && !isRecord(value.settings)) ||
      typeof value.saved_at !== "string" || !Number.isFinite(Date.parse(value.saved_at))) return null;
  return { settings: value.settings as TSettings | null, items: value.items as TItem[], saved_at: value.saved_at };
}

export function writeDocumentConflictDraft<TSettings, TItem>(
  scope: EditorDocumentDraftScope, draft: EditorConflictDraft<TSettings, TItem>
) { writeEnvelope("conflict", scope, draft); }

export function clearDocumentConflictDraft(scope: EditorDocumentDraftScope) { clearEnvelope("conflict", scope); }
