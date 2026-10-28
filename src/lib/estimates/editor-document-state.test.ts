import { describe, expect, it, vi } from "vitest";

import { EstimateEditorDocument, type Scope } from "@/lib/estimates/editor-document-state";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

function prepared() {
  const response = createEstimateEditorResponseFixture();
  return prepareEstimateEditorRead(parseEstimateEditorData(response, response.version.id), false);
}

function setup() {
  const read = prepared();
  const scope: Scope = { actorId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    tenantId: read.confirmed.version.tenant_id, versionId: read.confirmed.version.id };
  const document = new EstimateEditorDocument(scope);
  document.acceptRead(read);
  return { document, read, scope, id: read.confirmed.items[0].id };
}

function preview(document: EstimateEditorDocument, id: string, quantity: number) {
  document.setDraftItems((items) => items.map((item) => item.id === id ? { ...item, quantity } : item));
}

function commit(document: EstimateEditorDocument, id: string, quantity: number) {
  preview(document, id, quantity);
  return document.enqueueItem(id, { quantity });
}

describe("the estimate document owns confirmed values and local intentions", () => {
  it("keeps an uncommitted preview local without changing its confirmed row or journal", () => {
    const { document, id } = setup();
    preview(document, id, 3);
    expect(document.getSnapshot().items[0].quantity).toBe(3);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(2);
    expect(document.getSnapshot().pendingCount).toBe(0);
    expect(document.getUnsavedUpdates().size).toBe(0);
  });

  it("captures a durable immutable save without temporarily reverting its displayed values", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    expect(document.getSnapshot()).toMatchObject({ pendingCount: 0, inFlightCount: 1 });
    expect(document.getSnapshot().items[0].quantity).toBe(3);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(2);
    expect(document.getUnsavedUpdates().get(id)).toEqual({ quantity: 3 });
    expect(Object.isFrozen(capture.entries[0].updates)).toBe(true);
    expect(document.acceptSave(capture)).toBe(true);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
    expect(document.getSnapshot()).toMatchObject({ pendingCount: 0, inFlightCount: 0 });
    expect(document.acceptSave(capture)).toBe(false);
  });

  it("an acknowledgement confirms only the capture, leaving a newer committed edit pending", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    commit(document, id, 4);
    document.acceptSave(capture);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
    expect(document.getSnapshot().items[0].quantity).toBe(4);
    expect(document.getPendingUpdates().get(id)).toEqual({ quantity: 4 });
  });

  it("preserves a newer preview without turning it into a persistable edit on acknowledgement", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    preview(document, id, 4);
    document.acceptSave(capture);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
    expect(document.getSnapshot().items[0].quantity).toBe(4);
    expect(document.getPendingUpdates().size).toBe(0);
  });

  it("queues a return to the old confirmed value while a different value is in flight", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    expect(commit(document, id, 2)).toBe(true);
    document.acceptSave(capture);
    expect(document.getSnapshot().items[0].quantity).toBe(2);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
    expect(document.getPendingUpdates().get(id)).toEqual({ quantity: 2 });
  });

  it("requeues a failed capture behind more recent edits and preserves an uncommitted preview", () => {
    const { document, id } = setup();
    document.enqueueItem(id, { quantity: 3, title: "Titre envoyé" });
    const capture = document.captureSave();
    commit(document, id, 4);
    document.setDraftItems((items) => items.map((item) => ({ ...item, title: "Titre en cours de saisie" })));
    document.rejectSave(capture);
    expect(document.getPendingUpdates().get(id)).toEqual({ quantity: 4, title: "Titre envoyé" });
    expect(document.getSnapshot().items[0]).toMatchObject({ quantity: 4, title: "Titre en cours de saisie" });
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(2);
    expect(document.rejectSave(capture)).toBe(false);
  });

  it("rebases a fresh read under in-flight, pending and preview values", () => {
    const { document, read, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    document.enqueueItem(id, { title: "Titre local" });
    document.setDraftItems((items) => items.map((item) => ({ ...item, description: "Aperçu local" })));
    const newer = structuredClone(read);
    newer.confirmed.version.updated_at = "2026-10-28T10:00:00.123457Z";
    newer.confirmed.items[0] = { ...newer.confirmed.items[0], quantity: 5, title: "Titre serveur", unit_price_ht_cents: 1200 };
    newer.draft.items = newer.confirmed.items;
    document.acceptRead(newer);
    expect(document.getSnapshot().items[0]).toMatchObject({
      quantity: 3, title: "Titre local", description: "Aperçu local", unit_price_ht_cents: 1200,
    });
    expect(document.getSnapshot().confirmedItems[0]).toMatchObject({ quantity: 5, title: "Titre serveur" });
    document.acceptSave(capture, "2026-10-28T10:00:00.123456Z");
    expect(document.getSnapshot().items[0].quantity).toBe(5);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(5);
  });

  it("does not mistake a normalized projection for the persisted baseline", () => {
    const { document, read, id } = setup();
    const projected = { ...read, draft: { ...read.draft,
      items: read.draft.items.map((item) => ({ ...item, line_total_ht_cents: 2700 })) } };
    document.acceptRead(projected);
    expect(document.getSnapshot().items[0].line_total_ht_cents).toBe(2700);
    expect(document.getSnapshot().confirmedItems[0].line_total_ht_cents).toBe(2600);
    expect(document.enqueueItem(id, { line_total_ht_cents: 2700 })).toBe(true);
  });

  it("does not enqueue unchanged values and removes an unsent edit reverted to the baseline", () => {
    const { document, id } = setup();
    expect(commit(document, id, 2)).toBe(false);
    expect(commit(document, id, 3)).toBe(true);
    expect(commit(document, id, 2)).toBe(true);
    expect(document.getPendingUpdates().size).toBe(0);
    expect(document.getSnapshot().items[0].quantity).toBe(2);
  });

  it("reconciles an external acknowledgement without clearing edits to other fields", () => {
    const { document, id } = setup();
    document.enqueueItem(id, { quantity: 3, title: "Local" });
    document.acknowledgeItems([{ id, updates: { quantity: 3 } }]);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
    expect(document.getPendingUpdates().get(id)).toEqual({ title: "Local" });
    expect(document.getSnapshot().items[0]).toMatchObject({ title: "Local", quantity: 3 });
  });

  it("retires an acknowledged preview so a later read can show the new server value", () => {
    const { document, read, id } = setup();
    preview(document, id, 3);
    document.acknowledgeItems([{ id, updates: { quantity: 3 } }]);
    document.acceptItems(read.confirmed.items.map((item) => ({ ...item, quantity: 4 })));
    expect(document.getSnapshot().items[0].quantity).toBe(4);
    expect(document.getSnapshot().pendingCount).toBe(0);
  });

  it("keeps a different later preview when an external receipt confirms older values", () => {
    const { document, id } = setup();
    preview(document, id, 4);
    document.acknowledgeItems([{ id, updates: { quantity: 3 } }]);
    expect(document.getSnapshot().items[0].quantity).toBe(4);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
  });

  it("does not expose a mutable copy of the intention journal", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    const copy = document.getPendingUpdates();
    copy.get(id)!.quantity = 99;
    expect(document.getPendingUpdates().get(id)).toEqual({ quantity: 3 });
    document.updatePending((pending) => pending.set(id, { quantity: 4 }));
    expect(document.getSnapshot().items[0].quantity).toBe(4);
  });
});

describe("document identity and structural reconciliation", () => {
  it("rejects older revisions at PostgreSQL microsecond precision", () => {
    const { document, read } = setup();
    const newer = { ...read.confirmed.version, updated_at: "2026-10-28T10:00:00.123457Z" };
    expect(document.setConfirmedVersion(newer)).toBe(true);
    expect(document.acceptRead(read)).toBe(false);
    expect(document.setConfirmedVersion(read.confirmed.version)).toBe(false);
    expect(document.getSnapshot().version?.updated_at).toBe(newer.updated_at);
  });

  it("rejects a foreign document or tenant without applying a partial snapshot", () => {
    const { document, read } = setup();
    const before = document.getSnapshot();
    const foreign = structuredClone(read);
    foreign.confirmed.version.tenant_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    expect(document.acceptRead(foreign)).toBe(false);
    foreign.confirmed.version = { ...read.confirmed.version, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect(document.acceptRead(foreign)).toBe(false);
    expect(document.getSnapshot()).toBe(before);
  });

  it("invalidates old requests after A to B to A and when the actor changes", () => {
    const { document, read, scope, id } = setup();
    const oldScope = document.captureScope();
    commit(document, id, 3);
    const capture = document.captureSave();
    document.changeScope({ ...scope, versionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    document.changeScope(scope);
    expect(document.isCurrent(oldScope)).toBe(false);
    expect(document.acceptRead(read, undefined, oldScope)).toBe(false);
    expect(document.acceptSave(capture)).toBe(false);
    expect(document.rejectSave(capture)).toBe(false);
    expect(document.getSnapshot()).toMatchObject({ version: null, items: [], pendingCount: 0, inFlightCount: 0, generation: 2 });
    document.acceptRead(read);
    const currentScope = document.captureScope();
    document.changeScope({ ...scope, actorId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
    expect(document.isCurrent(currentScope)).toBe(false);
    expect(document.getSnapshot().settings).toBeNull();
  });

  it("treats UUID spelling as the same identity without lowercasing non-UUID identifiers", () => {
    const { document, scope } = setup();
    const token = document.captureScope();
    expect(document.changeScope({ ...scope, actorId: scope.actorId!.toUpperCase() })).toBe(false);
    expect(document.isCurrent({ ...token, actorId: token.actorId!.toUpperCase() })).toBe(true);
    const arbitrary = new EstimateEditorDocument({ ...scope, actorId: "Actor-A" });
    expect(arbitrary.changeScope({ ...scope, actorId: "actor-a" })).toBe(true);
  });

  it("preserves local edits and temporary rows while accepting an unrelated structural insertion", () => {
    const { document, read, id } = setup();
    preview(document, id, 3);
    const temp = { ...read.draft.items[0], id: "tmp:local", _clientKey: "temporary-key", _pendingCreate: true };
    document.setDraftItems((items) => [...items, temp]);
    const added = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Ligne insérée" };
    document.acceptItems([...read.confirmed.items, added]);
    expect(document.getSnapshot().items.map((item) => item.id)).toEqual([id, added.id, temp.id]);
    expect(document.getSnapshot().items[0].quantity).toBe(3);
    expect(document.getSnapshot().confirmedItems.map((item) => item.id)).toEqual([id, added.id]);
  });

  it("does not resurrect a persisted row removed on the server merely because it has local edits", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    document.acceptItems([]);
    expect(document.getSnapshot().items).toEqual([]);
    expect(document.getSnapshot().confirmedItems).toEqual([]);
  });

  it("keeps an optimistic deletion through a read and can discard that operation explicitly", () => {
    const { document, read } = setup();
    document.setDraftItems([]);
    document.acceptItems(read.confirmed.items);
    expect(document.getSnapshot().items).toEqual([]);
    document.discardItemDraft();
    expect(document.getSnapshot().items).toHaveLength(1);
    expect(document.getSnapshot().pendingCount).toBe(0);
  });
});

describe("settings and atomic publication", () => {
  it("keeps edited settings, takes concurrent server values elsewhere, and discards to the latest baseline", () => {
    const { document, read } = setup();
    document.setDraftSettings((settings) => ({ ...settings!, title: "Titre local" }));
    const incoming = { ...read, draft: { ...read.draft,
      settings: { ...read.draft.settings, title: "Titre serveur", validite_jours: 60 } } };
    document.acceptRead(incoming);
    expect(document.getSnapshot().settings).toMatchObject({ title: "Titre local", validite_jours: 60 });
    expect(document.getSnapshot().savedSettings).toMatchObject({ title: "Titre serveur", validite_jours: 60 });
    document.discardSettings();
    expect(document.getSnapshot().settings).toBe(document.getSnapshot().savedSettings);
  });

  it("publishes a multi-part confirmation once, with the complete document already installed", () => {
    const { document, read } = setup();
    const observed = vi.fn(() => document.getSnapshot());
    document.subscribe(observed);
    document.transaction(() => {
      document.setConfirmedVersion({ ...read.confirmed.version, title: "Confirmé" });
      document.setConfirmedSettings({ ...read.draft.settings, title: "Confirmé" });
      document.acceptItems(read.confirmed.items.map((item) => ({ ...item, quantity: 4 })));
    });
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.results[0].value).toMatchObject({
      version: { title: "Confirmé" }, savedSettings: { title: "Confirmé" }, confirmedItems: [{ quantity: 4 }],
    });
  });
});

describe("operation-owned optimistic changes", () => {
  it.each([false, true])("does not confirm stale direct-write values after a fresh read (new preview: %s)", (laterPreview) => {
    const { document, read, id } = setup();
    document.acceptItems(read.confirmed.items.map((item) => ({ ...item, quantity: 1 })));
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, quantity: 2 })));
    const latestItems = read.confirmed.items.map((item) => ({ ...item, quantity: 3 }));
    document.acceptRead({ ...read,
      confirmed: { ...read.confirmed, version: { ...read.confirmed.version, updated_at: "2026-10-28T10:00:00.123458Z" }, items: latestItems },
      draft: { ...read.draft, items: latestItems },
    });
    if (laterPreview) preview(document, id, 4);
    const accepted = document.acceptItemsReceipt(operation, {
      version: { id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z" },
      updates: [{ id, updates: { quantity: 2 } }],
    });
    expect(accepted).toBe(false);
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(3);
    expect(document.getSnapshot().items[0].quantity).toBe(laterPreview ? 4 : 3);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123458Z");
    expect(document.getSnapshot().itemOperationCount).toBe(0);
    document.acceptItems(latestItems.map((item) => ({ ...item, quantity: 5 })));
    expect(document.getSnapshot().items[0].quantity).toBe(laterPreview ? 4 : 5);
  });

  it("does not confirm a stale ordering delta after a fresher read", () => {
    const { document, read } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, position: 2 })));
    const latestItems = read.confirmed.items.map((item) => ({ ...item, position: 3 }));
    document.acceptRead({ ...read,
      confirmed: { ...read.confirmed, version: { ...read.confirmed.version, updated_at: "2026-10-28T10:00:00.123458Z" }, items: latestItems },
      draft: { ...read.draft, items: latestItems },
    });
    expect(document.acceptItemsReceipt(operation, {
      version: { id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z" },
    })).toBe(false);
    expect(document.getSnapshot().confirmedItems[0].position).toBe(3);
    expect(document.getSnapshot().items[0].position).toBe(3);
  });

  it("accepts current version, totals and returned rows together without swallowing a later preview", () => {
    const { document, read, id } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, quantity: 3 })));
    preview(document, id, 4);
    const observed = vi.fn(() => document.getSnapshot());
    document.subscribe(observed);
    expect(document.acceptItemsReceipt(operation, {
      version: { id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z", content_revision: 5 },
      totals: { total_ht_cents: 3900, total_tax_cents: 780, total_ttc_cents: 4680 },
      updates: [{ id, updates: { quantity: 3 } }],
    })).toBe(true);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.results[0].value).toMatchObject({
      version: { updated_at: "2026-10-28T10:00:00.123457Z", content_revision: 5, total_ht_cents: 3900 },
      confirmedItems: [{ quantity: 3 }], items: [{ quantity: 4 }], itemOperationCount: 0,
    });
  });

  it("confirms a current structural delta when the receipt omits returned rows", () => {
    const { document, read } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, position: 2 })));
    expect(document.acceptItemsReceipt(operation, {
      version: { id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z" },
    })).toBe(true);
    expect(document.getSnapshot()).toMatchObject({ confirmedItems: [{ position: 2 }], items: [{ position: 2 }], itemOperationCount: 0 });
  });

  it("ignores an old-scope receipt without changing the current document", () => {
    const { document, read, scope, id } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, quantity: 3 })));
    document.changeScope({ ...scope, actorId: "another-actor" });
    document.acceptRead(read);
    const before = document.getSnapshot();
    expect(document.acceptItemsReceipt(operation, {
      version: { id: scope.versionId, updated_at: "2026-10-28T10:00:00.123457Z" },
      updates: [{ id, updates: { quantity: 3 } }],
    })).toBe(false);
    expect(document.getSnapshot()).toBe(before);
  });

  it("rolls back a failed deletion without erasing a newer edit to a surviving row", () => {
    const { document, read, id } = setup();
    const survivor = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    document.acceptItems([...read.confirmed.items, survivor]);
    const operation = document.beginItemsOperation((items) => items.filter((item) => item.id !== id));
    commit(document, survivor.id, 9);
    expect(document.rollbackItems(operation)).toBe(true);
    expect(document.getSnapshot().items.find((item) => item.id === survivor.id)?.quantity).toBe(9);
    expect(document.getSnapshot().items.some((item) => item.id === id)).toBe(true);
    expect(document.getPendingUpdates().get(survivor.id)).toEqual({ quantity: 9 });
    expect(document.getSnapshot().itemOperationCount).toBe(0);
    expect(document.rollbackItems(operation)).toBe(false);
  });

  it("rolls back only the changed fields and retains later edits to the same row", () => {
    const { document, id } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, position: 5 })));
    preview(document, id, 7);
    document.rollbackItems(operation);
    expect(document.getSnapshot().items[0]).toMatchObject({ position: 1, quantity: 7 });
  });

  it("does not undo a later edit to an operation's own field, even after a round trip", () => {
    const { document } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, position: 5 })));
    document.setDraftItems((items) => items.map((item) => ({ ...item, position: 6 })));
    document.setDraftItems((items) => items.map((item) => ({ ...item, position: 5 })));
    document.rollbackItems(operation);
    expect(document.getSnapshot().items[0].position).toBe(5);
  });

  it("uses a fresh server baseline when undoing an older optimistic reorder", () => {
    const { document, read } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, position: 5 })));
    document.acceptItems(read.confirmed.items.map((item) => ({ ...item, position: 3 })));
    document.rollbackItems(operation);
    expect(document.getSnapshot().items[0].position).toBe(3);
  });

  it("restores a removed row on the newly read baseline while preserving its earlier local preview", () => {
    const { document, read, id } = setup();
    preview(document, id, 7);
    const operation = document.beginItemsOperation([]);
    document.acceptItems(read.confirmed.items.map((item) => ({ ...item, title: "Nouveau titre serveur" })));
    document.rollbackItems(operation);
    expect(document.getSnapshot().items[0]).toMatchObject({ quantity: 7, title: "Nouveau titre serveur" });
    expect(document.getSnapshot().pendingCount).toBe(0);
  });

  it("confirms a successful deletion and removes its tombstone and obsolete intentions", () => {
    const { document, read, id } = setup();
    commit(document, id, 7);
    const operation = document.beginItemsOperation([]);
    expect(document.acceptItemsOperation(operation)).toBe(true);
    expect(document.getSnapshot()).toMatchObject({ items: [], confirmedItems: [], pendingCount: 0, itemOperationCount: 0 });
    // A later explicit server restoration is visible: there is no old optimistic tombstone.
    document.acceptItems(read.confirmed.items);
    expect(document.getSnapshot().items).toHaveLength(1);
  });

  it("accepts a deletion receipt atomically and never requeues that row from a failed older save", () => {
    const { document, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    preview(document, id, 4);
    const listener = vi.fn();
    document.subscribe(listener);
    expect(document.confirmDeletedItems([id], document.captureScope())).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(document.getSnapshot()).toMatchObject({ items: [], confirmedItems: [], pendingCount: 0 });
    expect(document.getUnsavedUpdates().size).toBe(0);
    document.rejectSave(capture);
    expect(document.getPendingUpdates().size).toBe(0);
    expect(document.enqueueItem(id, { quantity: 5 })).toBe(false);
  });

  it("ignores a deletion receipt from another scope", () => {
    const { document, scope, read, id } = setup();
    const old = document.captureScope();
    document.changeScope({ ...scope, actorId: "another-actor" });
    document.acceptRead(read);
    expect(document.confirmDeletedItems([id], old)).toBe(false);
    expect(document.getSnapshot().confirmedItems).toHaveLength(1);
  });

  it("gates each deletion receipt independently and keeps rows from a newer read", () => {
    const { document, read, id } = setup();
    const other = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    document.acceptItems([...read.confirmed.items, other]);
    const observed = vi.fn(() => document.getSnapshot());
    document.subscribe(observed);
    expect(document.confirmDeletedItems([id], document.captureScope(), {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z", content_revision: 5,
    })).toBe(true);
    expect(observed).toHaveBeenCalledTimes(1);
    expect(observed.mock.results[0].value).toMatchObject({
      version: { updated_at: "2026-10-28T10:00:00.123457Z", content_revision: 5 }, confirmedItems: [{ id: other.id }],
    });
    document.setConfirmedVersion({ ...read.confirmed.version, updated_at: "2026-10-28T10:00:00.123459Z" });
    const before = document.getSnapshot();
    expect(document.confirmDeletedItems([other.id], document.captureScope(), {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123458Z", content_revision: 6,
    })).toBe(false);
    expect(document.getSnapshot()).toBe(before);
    expect(document.getSnapshot().confirmedItems.map((item) => item.id)).toEqual([other.id]);
    expect(document.confirmDeletedItems([other.id], document.captureScope(), {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123460Z", content_revision: 7,
    })).toBe(true);
    expect(document.getSnapshot().confirmedItems).toEqual([]);
  });

  it("does not requeue deleted rows when an older save fails after an accepted deletion delta", () => {
    const { document, read, id } = setup();
    commit(document, id, 3);
    const capture = document.captureSave();
    const operation = document.beginItemsOperation([]);
    expect(document.acceptItemsReceipt(operation, {
      version: { id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z" },
    })).toBe(true);
    expect(document.getUnsavedUpdates().size).toBe(0);
    document.rejectSave(capture);
    expect(document.getPendingUpdates().size).toBe(0);
    expect(document.getSnapshot()).toMatchObject({ confirmedItems: [], items: [] });
  });

  it("confirms an operation's fields without confirming a concurrent preview", () => {
    const { document, id } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, position: 5 })));
    preview(document, id, 7);
    document.acceptItemsOperation(operation);
    expect(document.getSnapshot().confirmedItems[0]).toMatchObject({ position: 5, quantity: 2 });
    expect(document.getSnapshot().items[0]).toMatchObject({ position: 5, quantity: 7 });
    expect(document.getSnapshot().pendingCount).toBe(0);
  });

  it("releases local preview tracking without misrepresenting the preview as confirmed", () => {
    const { document } = setup();
    const operation = document.beginItemsOperation((items) => items.map((item) => ({ ...item, quantity: 7 })));
    document.releaseItemsOperation(operation);
    expect(document.getSnapshot()).toMatchObject({ itemOperationCount: 0, pendingCount: 0 });
    expect(document.getSnapshot().confirmedItems[0].quantity).toBe(2);
    expect(document.getSnapshot().items[0].quantity).toBe(7);
  });

  it("confirms a created row under its real id, retaining preview, queued input and the client key", () => {
    const { document, read } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const temporary = { ...created, id: "tmp:created", _clientKey: "created-key", _pendingCreate: true, quantity: 3 };
    document.setDraftItems((items) => [...items, temporary]);
    document.enqueueItem(temporary.id, { title: "Titre en attente" });
    const displayed = { ...created, quantity: 3, title: "Titre en attente" };
    expect(document.acceptCreatedItem(temporary.id, created, document.captureScope(), displayed)).toBe(true);
    expect(document.getSnapshot().confirmedItems.find((item) => item.id === created.id)?.quantity).toBe(2);
    expect(document.getSnapshot().items.find((item) => item.id === created.id)).toMatchObject({
      quantity: 3, title: "Titre en attente", _clientKey: "created-key",
    });
    expect(document.getPendingUpdates().get(created.id)).toEqual({ title: "Titre en attente" });
    expect(document.getPendingUpdates().has(temporary.id)).toBe(false);
    expect(document.getSnapshot().items.some((item) => item.id === temporary.id)).toBe(false);
  });

  it("ignores a late structural response and a late creation after actor change", () => {
    const { document, scope, read } = setup();
    const token = document.captureScope();
    const operation = document.beginItemsOperation([]);
    document.changeScope({ ...scope, actorId: "another-actor" });
    expect(document.acceptItemsOperation(operation)).toBe(false);
    expect(document.rollbackItems(operation)).toBe(false);
    expect(document.acceptCreatedItem("tmp:old", read.confirmed.items[0], token)).toBe(false);
    expect(document.getSnapshot().confirmedItems).toEqual([]);
  });

  it("confirms a server-side recreation without a temporary row but still rejects a removed temporary row", () => {
    const { document, read } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect(document.acceptCreatedItem("tmp:removed", created, document.captureScope())).toBe(false);
    expect(document.acceptCreatedItem(null, created, document.captureScope())).toBe(true);
    expect(document.getSnapshot().confirmedItems.find((item) => item.id === created.id)).toEqual(created);
    expect(document.getSnapshot().items.find((item) => item.id === created.id)).toMatchObject({
      quantity: 2, _clientKey: created.id, _pendingCreate: false,
    });
    expect(document.getPendingUpdates().size).toBe(0);
  });

  it.each(["tmp:late-create", null])("keeps a newer read when an old creation receipt arrives for %s", (tempId) => {
    const { document, read } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    if (tempId) document.setDraftItems((items) => [...items,
      { ...created, id: tempId, quantity: 3, _clientKey: "stable-create-key", _pendingCreate: true }]);
    const newer = { ...created, quantity: 4, title: "Modification serveur récente", unit_price_ht_cents: 1100,
      updated_at: "2026-10-28T10:00:00.123457Z" };
    document.acceptRead({
      ...read,
      confirmed: { ...read.confirmed,
        version: { ...read.confirmed.version, updated_at: newer.updated_at }, items: [...read.confirmed.items, newer] },
      draft: { ...read.draft, items: [...read.draft.items, newer] },
    });
    expect(document.acceptCreatedItem(tempId, created, document.captureScope(),
      tempId ? { ...created, quantity: 3 } : undefined)).toBe(true);
    expect(document.getSnapshot().confirmedItems.find((item) => item.id === created.id)).toEqual(newer);
    expect(document.getSnapshot().items.find((item) => item.id === created.id)).toMatchObject({
      quantity: tempId ? 3 : 4, title: newer.title, unit_price_ht_cents: 1100, updated_at: newer.updated_at,
      _clientKey: tempId ? "stable-create-key" : created.id,
    });
    expect(document.getPendingUpdates().size).toBe(0);
    expect(document.getSnapshot().items.filter((item) => item.id === created.id)).toHaveLength(1);
    expect(document.getSnapshot().version?.updated_at).toBe(newer.updated_at);
  });

  it("publishes a current create receipt's version and real row together", () => {
    const { document, read } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const tempId = "tmp:atomic-create";
    document.setDraftItems((items) => [...items, { ...created, id: tempId, _pendingCreate: true }]);
    const published: Array<{ updatedAt: string | undefined; ids: string[] }> = [];
    document.subscribe(() => published.push({ updatedAt: document.getSnapshot().version?.updated_at,
      ids: document.getSnapshot().confirmedItems.map((item) => item.id) }));
    expect(document.acceptCreatedItem(tempId, created, document.captureScope(), undefined, {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z",
    })).toBe(true);
    expect(published).toEqual([{ updatedAt: "2026-10-28T10:00:00.123457Z", ids: [...read.confirmed.items.map((item) => item.id), created.id] }]);
    expect(document.getSnapshot().items.some((item) => item.id === tempId)).toBe(false);
  });

  it("does not transfer a temporary value over a newer save already in flight for the real UUID", () => {
    const { document, read } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const tempId = "tmp:older-intent";
    document.setDraftItems((items) => [...items, { ...created, id: tempId, quantity: 3, _pendingCreate: true }]);
    const newer = { ...created, quantity: 4, updated_at: "2026-10-28T10:00:00.123458Z" };
    document.acceptRead({ ...read,
      confirmed: { ...read.confirmed, version: { ...read.confirmed.version, updated_at: newer.updated_at }, items: [...read.confirmed.items, newer] },
      draft: { ...read.draft, items: [...read.draft.items, newer] },
    });
    commit(document, created.id, 5);
    const capture = document.captureSave();
    document.enqueueItem(tempId, { quantity: 3 });
    expect(document.acceptCreatedItem(tempId, created, document.captureScope(), { ...created, quantity: 3 }, {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z",
    })).toBe(false);
    expect(document.getSnapshot().items.find((item) => item.id === created.id)?.quantity).toBe(5);
    expect(document.getPendingUpdates().has(created.id)).toBe(false);
    expect(document.getPendingUpdates().has(tempId)).toBe(false);
    document.acceptSave(capture);
    expect(document.getSnapshot().confirmedItems.find((item) => item.id === created.id)?.quantity).toBe(5);
    expect(document.getPendingUpdates().has(created.id)).toBe(false);
  });

  it("does not recreate an absent UUID from a create receipt older than the complete read", () => {
    const { document, read, id } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const tempId = "tmp:already-deleted";
    document.setDraftItems((items) => [...items, { ...created, id: tempId, quantity: 3, _pendingCreate: true }]);
    document.enqueueItem(tempId, { quantity: 3 });
    commit(document, id, 9);
    document.acceptRead({ ...read,
      confirmed: { ...read.confirmed, version: { ...read.confirmed.version, updated_at: "2026-10-28T10:00:00.123458Z" } },
    });
    expect(document.acceptCreatedItem(tempId, created, document.captureScope(), { ...created, quantity: 3 }, {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z",
    })).toBe(false);
    expect(document.getSnapshot().confirmedItems.map((item) => item.id)).toEqual([id]);
    expect(document.getSnapshot().items.map((item) => item.id)).toEqual([id]);
    expect(document.getPendingUpdates().get(id)).toEqual({ quantity: 9 });
    expect(document.getPendingUpdates().has(tempId)).toBe(false);
    expect(document.getPendingUpdates().has(created.id)).toBe(false);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123458Z");
  });

  it("retires only the temporary row when a stale create receipt's real UUID is already confirmed", () => {
    const { document, read } = setup();
    const created = { ...read.confirmed.items[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    const tempId = "tmp:already-read";
    document.setDraftItems((items) => [...items, { ...created, id: tempId, quantity: 3, _clientKey: "original-key", _pendingCreate: true }]);
    document.enqueueItem(tempId, { quantity: 3 });
    const newer = { ...created, title: "Confirmed recent title", updated_at: "2026-10-28T10:00:00.123458Z" };
    document.acceptRead({ ...read,
      confirmed: { ...read.confirmed, version: { ...read.confirmed.version, updated_at: newer.updated_at }, items: [...read.confirmed.items, newer] },
      draft: { ...read.draft, items: [...read.draft.items, newer] },
    });
    document.setDraftItems((items) => items.map((item) => item.id === created.id ? { ...item, title: "Newer local title" } : item));
    expect(document.acceptCreatedItem(tempId, created, document.captureScope(), { ...created, quantity: 3 }, {
      id: read.confirmed.version.id, updated_at: "2026-10-28T10:00:00.123457Z",
    })).toBe(false);
    expect(document.getSnapshot().confirmedItems.find((item) => item.id === created.id)).toEqual(newer);
    expect(document.getSnapshot().items.find((item) => item.id === created.id)).toMatchObject({
      title: "Newer local title", quantity: 3, _clientKey: "original-key",
    });
    expect(document.getSnapshot().items.some((item) => item.id === tempId)).toBe(false);
    expect(document.getPendingUpdates().get(created.id)).toEqual({ quantity: 3 });
    expect(document.getSnapshot().version?.updated_at).toBe(newer.updated_at);
  });
});
