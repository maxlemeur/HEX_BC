import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearDocumentAutoSaveDraft, clearDocumentConflictDraft, editorDocumentDraftStorageKey,
  hasUnownedDocumentDraft, readDocumentAutoSaveDraft, readDocumentConflictDraft,
  writeDocumentAutoSaveDraft, writeDocumentConflictDraft,
} from "@/lib/estimates/editor-document-drafts";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
  };
}
const scope = { actorId: "actor-a", tenantId: "tenant-a", versionId: "version-a" };
const entries = [{ id: "line-a", updates: { quantity: 2 } }];
const conflict = { settings: { title: "Local" }, items: [{ id: "line-a", quantity: 3 }], saved_at: "2026-10-28T12:00:00.000Z" };

beforeEach(() => vi.stubGlobal("window", { localStorage: memoryStorage(), sessionStorage: memoryStorage() }));
afterEach(() => vi.unstubAllGlobals());

describe("document drafts with a proven identity", () => {
  it("restores autosave and conflict drafts only in their complete identity", () => {
    writeDocumentAutoSaveDraft(scope, entries);
    writeDocumentConflictDraft(scope, conflict);
    expect(readDocumentAutoSaveDraft(scope)?.buffered_updates).toEqual(entries);
    expect(readDocumentConflictDraft(scope)).toEqual(conflict);
    expect(readDocumentAutoSaveDraft({ ...scope, actorId: "actor-b" })).toBeNull();
    expect(readDocumentConflictDraft({ ...scope, tenantId: "tenant-b" })).toBeNull();
    expect(readDocumentAutoSaveDraft({ ...scope, versionId: "version-b" })).toBeNull();
  });

  it("normalizes identity casing in both the key and the envelope", () => {
    writeDocumentAutoSaveDraft({ actorId: "ACTOR-A", tenantId: "TENANT-A", versionId: "VERSION-A" }, entries);
    expect(readDocumentAutoSaveDraft(scope)?.buffered_updates).toEqual(entries);
    expect(window.localStorage.length).toBe(1);
    const envelope = JSON.parse(window.localStorage.getItem(editorDocumentDraftStorageKey("autosave", scope)!)!);
    expect(envelope).toMatchObject({ schemaVersion: 2, identity: scope });
  });

  it.each(["actorId", "tenantId", "versionId"] as const)("refuses a forged envelope with another %s at the expected key", (field) => {
    const envelope = { schemaVersion: 2, identity: { ...scope, [field]: "foreign" },
      draft: { buffered_updates: entries, saved_at: conflict.saved_at } };
    window.localStorage.setItem(editorDocumentDraftStorageKey("autosave", scope)!, JSON.stringify(envelope));
    expect(readDocumentAutoSaveDraft(scope)).toBeNull();
    window.sessionStorage.setItem(editorDocumentDraftStorageKey("conflict", scope)!, JSON.stringify({ ...envelope, draft: conflict }));
    expect(readDocumentConflictDraft(scope)).toBeNull();
  });

  it("preserves unowned legacy bytes without applying or attributing them", () => {
    const oldAuto = JSON.stringify({ buffered_updates: entries, saved_at: conflict.saved_at });
    const oldConflict = JSON.stringify(conflict);
    const autoKey = "estimate:edit:autosave-buffer:version-a";
    const conflictKey = "estimate:edit:conflict-draft:version-a";
    window.localStorage.setItem(autoKey, oldAuto);
    window.sessionStorage.setItem(conflictKey, oldConflict);
    expect(hasUnownedDocumentDraft(scope)).toBe(true);
    expect(readDocumentAutoSaveDraft(scope)).toBeNull();
    expect(readDocumentConflictDraft(scope)).toBeNull();
    writeDocumentAutoSaveDraft(scope, entries);
    writeDocumentConflictDraft(scope, conflict);
    clearDocumentAutoSaveDraft(scope);
    clearDocumentConflictDraft(scope);
    expect(window.localStorage.getItem(autoKey)).toBe(oldAuto);
    expect(window.sessionStorage.getItem(conflictKey)).toBe(oldConflict);
    expect(window.localStorage.length).toBe(1);
    expect(window.sessionStorage.length).toBe(1);
  });

  it("does not read or store an identity-free draft while the profile is unavailable", () => {
    const incomplete = { ...scope, actorId: null };
    writeDocumentAutoSaveDraft(incomplete, entries);
    writeDocumentConflictDraft(incomplete, conflict);
    expect(editorDocumentDraftStorageKey("autosave", incomplete)).toBeNull();
    expect(readDocumentAutoSaveDraft(incomplete)).toBeNull();
    expect(readDocumentConflictDraft(incomplete)).toBeNull();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("clears only the current actor's record and leaves another actor's pending work intact", () => {
    const other = { ...scope, actorId: "actor-b" };
    writeDocumentAutoSaveDraft(scope, entries);
    writeDocumentAutoSaveDraft(other, entries);
    writeDocumentAutoSaveDraft(scope, []);
    expect(readDocumentAutoSaveDraft(scope)).toBeNull();
    expect(readDocumentAutoSaveDraft(other)?.buffered_updates).toEqual(entries);
  });

  it("rejects an incomplete record instead of applying a partial intention set", () => {
    window.localStorage.setItem(editorDocumentDraftStorageKey("autosave", scope)!, JSON.stringify({
      schemaVersion: 2, identity: scope,
      draft: { buffered_updates: [...entries, { id: "line-b", updates: null }], saved_at: conflict.saved_at },
    }));
    expect(readDocumentAutoSaveDraft(scope)).toBeNull();
  });
});
