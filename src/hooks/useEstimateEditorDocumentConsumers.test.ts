import { act, cleanup, renderHook } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateEditorItemsController } from "@/hooks/useEstimateEditorItemsController";
import { useEstimateEditorOrderingController } from "@/hooks/useEstimateEditorOrderingController";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import type { EditorEstimateItem } from "@/lib/estimates/editor-items";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

const mocks = vi.hoisted(() => ({ create: vi.fn(), reorder: vi.fn(), move: vi.fn(), remove: vi.fn() }));
vi.mock("@/lib/estimates/client", () => ({
  createEstimateItem: mocks.create,
  reorderEstimateItems: mocks.reorder,
  moveEstimateItem: mocks.move,
  deleteEstimateItem: mocks.remove,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.reorder.mockImplementation(async (versionId: string) => ({
    versionToken: { id: versionId, updated_at: "2026-10-28T10:00:00.123457Z" },
  }));
  mocks.remove.mockImplementation(async (versionId: string, itemId: string) => ({
    versionToken: { id: versionId, updated_at: "2026-10-28T10:00:00.123457Z" }, deletedIds: [itemId],
  }));
});
afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup(empty = false) {
  const wire = createEstimateEditorResponseFixture();
  wire.items.push({ ...wire.items[0], id: "55555555-5555-4555-8555-555555555555", position: 2, title: "Deuxième ligne" });
  if (empty) wire.items = [];
  const data = parseEstimateEditorData(wire, wire.version.id);
  const prepared = prepareEstimateEditorRead(data, false);
  const scope = { actorId: "actor-1", tenantId: data.version.tenant_id, versionId: data.version.id };
  const document = new EstimateEditorDocument(scope);
  document.acceptRead(prepared);
  const callbacks = {
    setTotalsOutOfSync: vi.fn(), reportError: vi.fn(), pushHistoryCommand: vi.fn(),
    resolveErrorMessage: (message: string) => message,
    applyVersionToken: vi.fn(), reloadItems: vi.fn().mockResolvedValue(undefined),
  };
  const view = renderHook(() => {
    const snapshot = useSyncExternalStore(document.subscribe, document.getSnapshot, document.getSnapshot);
    const common = {
      document, isMutationBlocked: false, mutationBlockedMessage: "Bloqué",
      getItemsSnapshot: () => document.getSnapshot().items,
      getVersionSnapshot: () => document.getSnapshot().version,
      setItems: document.setDraftItems,
      ...callbacks,
    };
    return {
      ordering: useEstimateEditorOrderingController(common),
      items: useEstimateEditorItemsController({
        ...common, version: snapshot.version, settings: snapshot.settings,
        isLaborSplitEnabled: false, normalizePatchedItem: (item: EditorEstimateItem) => item,
        enqueueItemUpdate: document.enqueueItem,
      }),
      snapshot,
    };
  });
  return { ...view, document, data, prepared, scope, callbacks };
}

describe("document-owned controller mutations", () => {
  it("rolls back a refused reorder without erasing a title edited while the request was pending", async () => {
    const { result, document, data } = setup();
    const request = deferred<void>();
    mocks.reorder.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.ordering.actions.reorder(null, data.items.map((item) => item.id).reverse()); });
    act(() => document.setDraftItems((items) => items.map((item) => item.id === data.items[0].id ? { ...item, title: "Titre saisi ensuite" } : item)));
    await act(async () => { request.reject(new Error("Refus serveur")); await completion; });
    expect(document.getSnapshot().items.map((item) => item.position)).toEqual([1, 2]);
    expect(document.getSnapshot().items[0].title).toBe("Titre saisi ensuite");
    expect(document.getSnapshot().confirmedItems[0].title).toBe(data.items[0].title);
    expect(document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("confirms an accepted order in the baseline and ignores a late failure from another actor", async () => {
    const { result, document, data, scope, prepared, callbacks } = setup();
    await act(async () => result.current.ordering.actions.reorder(null, data.items.map((item) => item.id).reverse()));
    expect(document.getSnapshot().confirmedItems.map((item) => item.position)).toEqual([2, 1]);
    const request = deferred<void>();
    mocks.reorder.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.ordering.actions.reorder(null, data.items.map((item) => item.id)); });
    act(() => { document.changeScope({ ...scope, actorId: "actor-2" }); document.acceptRead(prepared); });
    await act(async () => { request.reject(new Error("Ancien acteur")); await completion; });
    expect(document.getSnapshot().items).toMatchObject(prepared.draft.items);
    expect(callbacks.reportError).not.toHaveBeenCalledWith("Impossible de reordonner les lignes.");
  });

  it("keeps preview-only edits out of persistable intentions and the confirmed baseline", async () => {
    const { result, document, data } = setup();
    await act(async () => result.current.items.actions.patchItem(data.items[0].id, { title: "Aperçu" }, { persist: false }));
    expect(document.getSnapshot().items[0].title).toBe("Aperçu");
    expect(document.getSnapshot().confirmedItems[0].title).toBe(data.items[0].title);
    expect(document.getSnapshot().pendingCount).toBe(0);
    expect(document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("confirms the raw created line while retaining a later temp edit under the real id", async () => {
    const { result, document } = setup(true);
    const created = createEstimateEditorResponseFixture().items[0];
    const request = deferred<typeof created>();
    mocks.create.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.items.actions.addLine(null); });
    const tempId = document.getSnapshot().items[0].id;
    await act(async () => result.current.items.actions.patchItem(tempId, { title: "Titre local pendant création" }, { persist: true }));
    await act(async () => { request.resolve(created); await completion; });
    expect(document.getSnapshot().confirmedItems).toEqual([created]);
    expect(document.getSnapshot().items[0]).toMatchObject({ id: created.id, title: "Titre local pendant création" });
    expect(document.getSnapshot().pendingCount).toBe(1);
    expect(document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("keeps deletion, recreation and undo ordering in the confirmed baseline", async () => {
    const { result, document, data, callbacks } = setup();
    await act(async () => result.current.items.actions.deleteItem(data.items[0].id));
    expect(document.getSnapshot().confirmedItems.map((item) => item.id)).toEqual([data.items[1].id]);
    const command = callbacks.pushHistoryCommand.mock.calls[0][0];
    const recreated = { ...data.items[0], id: "66666666-6666-4666-8666-666666666666" };
    mocks.create.mockResolvedValueOnce(recreated);
    await act(async () => command.undo({ isCurrentScope: () => true }));
    expect(document.getSnapshot().confirmedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: recreated.id, position: 1 }),
      expect.objectContaining({ id: data.items[1].id, position: 2 }),
    ]));
    expect(document.getSnapshot().confirmedItems.some((item) => item.id === data.items[0].id)).toBe(false);
    await act(async () => command.redo({ isCurrentScope: () => true }));
    expect(document.getSnapshot().confirmedItems.map((item) => item.id)).toEqual([data.items[1].id]);
    expect(document.getSnapshot().itemOperationCount).toBe(0);
  });

  it.each(["addLine", "addSection"] as const)("does not resurrect a deleted row from a stale %s receipt", async (action) => {
    const { result, document, data, callbacks } = setup(true);
    const created = { ...createEstimateEditorResponseFixture().items[0], item_type: action === "addSection" ? "section" as const : "line" as const };
    const request = deferred<typeof created>();
    mocks.create.mockImplementationOnce(async (_versionId, _payload, options) => {
      const item = await request.promise;
      options.onVersionToken({ id: data.version.id, updated_at: "2026-10-28T10:00:00.123457Z" });
      return item;
    });
    let completion!: Promise<void>;
    act(() => { completion = result.current.items.actions[action](null); });
    expect(document.getSnapshot().items).toHaveLength(1);
    act(() => document.acceptRead(prepareEstimateEditorRead({ ...data,
      version: { ...data.version, updated_at: "2026-10-28T10:00:00.123459Z" }, items: [],
    }, false)));
    await act(async () => { request.resolve(created); await completion; });
    expect(document.getSnapshot().confirmedItems).toEqual([]);
    expect(document.getSnapshot().items).toEqual([]);
    expect(document.getSnapshot().pendingCount).toBe(0);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123459Z");
    expect(callbacks.pushHistoryCommand).not.toHaveBeenCalled();
    expect(callbacks.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(callbacks.applyVersionToken).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps newer confirmed creation and both local drafts without publishing stale creation success", async () => {
    const { result, document, data, callbacks } = setup(true);
    const created = createEstimateEditorResponseFixture().items[0];
    const request = deferred<typeof created>();
    mocks.create.mockImplementationOnce(async (_versionId, _payload, options) => {
      const item = await request.promise;
      options.onVersionToken({ id: data.version.id, updated_at: "2026-10-28T10:00:00.123457Z" });
      return item;
    });
    let completion!: Promise<void>;
    act(() => { completion = result.current.items.actions.addLine(null); });
    const tempId = document.getSnapshot().items[0].id;
    await act(async () => result.current.items.actions.patchItem(tempId, { title: "Titre temporaire local" }, { persist: true }));
    const newer = { ...created, title: "Titre serveur récent", updated_at: "2026-10-28T10:00:00.123459Z" };
    act(() => {
      document.acceptRead(prepareEstimateEditorRead({ ...data, version: { ...data.version, updated_at: newer.updated_at }, items: [newer] }, false));
      document.setDraftItems((items) => items.map((item) => item.id === created.id ? { ...item, description: "Description locale UUID" } : item));
      document.enqueueItem(created.id, { description: "Description locale UUID" });
    });
    callbacks.setTotalsOutOfSync.mockClear();
    await act(async () => { request.resolve(created); await completion; });
    expect(document.getSnapshot().confirmedItems).toEqual([newer]);
    expect(document.getSnapshot().items).toMatchObject([{ id: created.id, title: "Titre temporaire local", description: "Description locale UUID" }]);
    expect(document.getSnapshot().version?.updated_at).toBe(newer.updated_at);
    expect(callbacks.pushHistoryCommand).not.toHaveBeenCalled();
    expect(callbacks.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(callbacks.applyVersionToken).not.toHaveBeenCalled();
  });

  it("stops a multi-row restoration after a stale creation receipt without another POST", async () => {
    const { result, document, data, callbacks } = setup(true);
    const created = createEstimateEditorResponseFixture().items[0];
    const request = deferred<typeof created>();
    mocks.create.mockImplementationOnce(async (_versionId, _payload, options) => {
      const item = await request.promise;
      options.onVersionToken({ id: data.version.id, updated_at: "2026-10-28T10:00:00.123457Z" });
      return item;
    });
    const onProgress = vi.fn();
    let completion!: Promise<unknown>;
    act(() => { completion = result.current.items.actions.recreateItemsFromSnapshots(data.version.id,
      [created, { ...created, id: "55555555-5555-4555-8555-555555555555", position: 2 }], { onProgress }); });
    act(() => document.acceptRead(prepareEstimateEditorRead({ ...data,
      version: { ...data.version, updated_at: "2026-10-28T10:00:00.123459Z" }, items: [],
    }, false)));
    await act(async () => {
      request.resolve(created);
      await expect(completion).rejects.toThrow("version plus récente");
    });
    expect(document.getSnapshot().confirmedItems).toEqual([]);
    expect(document.getSnapshot().items).toEqual([]);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(onProgress).not.toHaveBeenCalled();
    expect(callbacks.applyVersionToken).not.toHaveBeenCalled();
    expect(mocks.reorder).not.toHaveBeenCalled();
  });

  it("does not publish a created line into a new actor's document", async () => {
    const { result, document, prepared, scope, callbacks } = setup(true);
    const created = createEstimateEditorResponseFixture().items[0];
    const request = deferred<typeof created>();
    mocks.create.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.items.actions.addLine(null); });
    act(() => { document.changeScope({ ...scope, actorId: "actor-2" }); document.acceptRead(prepared); });
    await act(async () => { request.resolve(created); await completion; });
    expect(document.getSnapshot().confirmedItems).toEqual([]);
    expect(document.getSnapshot().items).toEqual([]);
    expect(callbacks.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("reports undo as unapplied when its reorder receipt is older than a full read", async () => {
    const { result, document, data, callbacks } = setup();
    await act(async () => result.current.ordering.actions.reorder(null, data.items.map((item) => item.id).reverse()));
    const command = callbacks.pushHistoryCommand.mock.calls[0][0];
    const response = deferred<{ versionToken: { id: string; updated_at: string } }>();
    mocks.reorder.mockReturnValueOnce(response.promise);
    let undo!: Promise<void | boolean>;
    act(() => { undo = command.undo({ isCurrentScope: () => true }); });
    act(() => document.acceptRead(prepareEstimateEditorRead({ ...data,
      version: { ...data.version, updated_at: "2026-10-28T10:00:00.123459Z" },
      items: data.items.map((item, index) => ({ ...item, position: index + 3 })),
    }, false)));
    await act(async () => {
      response.resolve({ versionToken: { id: data.version.id, updated_at: "2026-10-28T10:00:00.123458Z" } });
      expect(await undo).toBe(false);
    });
    expect(document.getSnapshot().items.map((item) => item.position)).toEqual([3, 4]);
    expect(document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("keeps the newer confirmed order when an earlier reorder receipt arrives late", async () => {
    const { result, document, data, prepared, callbacks } = setup();
    const request = deferred<{ versionToken: { id: string; updated_at: string } }>();
    mocks.reorder.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = result.current.ordering.actions.reorder(null, data.items.map((item) => item.id).reverse()); });
    expect(document.getSnapshot().items[0].position).toBe(2);
    const latestItems = data.items.map((item, index) => ({ ...item, position: index + 3 }));
    act(() => {
      document.acceptRead({ ...prepared,
        confirmed: { ...data, version: { ...data.version, updated_at: "2026-10-28T10:00:00.123458Z" }, items: latestItems },
        draft: { ...prepared.draft, items: latestItems },
      });
    });
    await act(async () => {
      request.resolve({ versionToken: { id: data.version.id, updated_at: "2026-10-28T10:00:00.123457Z" } });
      await completion;
    });
    expect(document.getSnapshot().confirmedItems.map((item) => item.position)).toEqual([3, 4]);
    expect(document.getSnapshot().items.map((item) => item.position)).toEqual([3, 4]);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123458Z");
    expect(document.getSnapshot().itemOperationCount).toBe(0);
    expect(callbacks.pushHistoryCommand).not.toHaveBeenCalled();
    expect(callbacks.setTotalsOutOfSync).not.toHaveBeenCalled();
  });

  it("refuses an old actor's action before optimistic mutation or any network request", async () => {
    const { result, document, prepared, scope, data } = setup();
    const oldReorder = result.current.ordering.actions.reorder;
    const oldCreate = result.current.items.actions.addLine;
    const oldPatch = result.current.items.actions.patchItem;
    act(() => { document.changeScope({ ...scope, actorId: "actor-2" }); document.acceptRead(prepared); });
    const before = document.getSnapshot();
    await act(async () => {
      await oldReorder(null, data.items.map((item) => item.id).reverse());
      await oldCreate(null);
      await oldPatch(data.items[0].id, { title: "Ancien acteur" }, { persist: true });
    });
    expect(mocks.reorder).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(document.getSnapshot()).toBe(before);
  });
});
