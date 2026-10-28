// @vitest-environment jsdom

import { act,cleanup,renderHook } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  deleteEstimateItem: vi.fn(),
  duplicateEstimateSection: vi.fn(),
  fetchEstimateEditorData: vi.fn(),
  insertAssemblyIntoVersion: vi.fn(),
  insertTemplateIntoVersion: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  deleteEstimateItem: clientMocks.deleteEstimateItem,
  duplicateEstimateSection: clientMocks.duplicateEstimateSection,
  fetchEstimateEditorData: clientMocks.fetchEstimateEditorData,
  insertAssemblyIntoVersion: clientMocks.insertAssemblyIntoVersion,
  insertTemplateIntoVersion: clientMocks.insertTemplateIntoVersion,
}));

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorStructureController } from "@/hooks/useEstimateEditorStructureController";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";
import type {
EditorEstimateItem,
EstimateItem,
EstimateVersionRow,
} from "@/lib/estimates/editor-items";

function createItem(
  id: string,
  overrides: Partial<EstimateItem> = {}
): EstimateItem {
  return {
    id,
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: id,
    ...overrides,
  } as EstimateItem;
}

function createVersion(id = "version-1", updatedAt = "token-initial") {
  return {
    id,
    updated_at: updatedAt,
  } as EstimateVersionRow;
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createDuplicateResult(
  versionToken: { id: string; updated_at: string } | null
) {
  return {
    duplicatedSectionId: "section-copy",
    sourceVersionId: "version-1",
    targetVersionId: "version-1",
    copiedItemCount: 2,
    versionToken,
  };
}

function createHarness(input?: {
  document?: EstimateEditorDocument;
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isMutationBlocked?: boolean;
  conflictHandled?: boolean;
  convertV3Items?: Parameters<typeof useEstimateEditorStructureController>[0]["convertV3Items"];
}) {
  let items = input?.items ?? [];
  let version =
    input && "version" in input ? (input.version ?? null) : createVersion();
  const applyVersionToken = vi.fn();
  const clearHistory = vi.fn();
  const ensureGroupedActionCanProceed = vi.fn().mockResolvedValue(true);
  const handleVersionConflict = vi
    .fn()
    .mockReturnValue(input?.conflictHandled ?? false);
  const pushHistoryCommand = vi.fn();
  const reloadItems = vi.fn().mockResolvedValue(undefined);
  const reportError = vi.fn();
  const setTotalsOutOfSync = vi.fn();
  const highlightItems = vi.fn();
  const setItems = vi.fn(
    (
      update:
        | EditorEstimateItem[]
        | ((previous: EditorEstimateItem[]) => EditorEstimateItem[])
    ) => {
      if (input?.document) input.document.setDraftItems(update);
      else items = typeof update === "function" ? update(items) : update;
    }
  );

  const rendered = renderHook(() =>
    useEstimateEditorStructureController({
      document: input?.document,
      routeVersionId: version?.id ?? "version-1",
      isMutationBlocked: input?.isMutationBlocked ?? false,
      mutationBlockedMessage: "Mutation interdite.",
      getItemsSnapshot: () => input?.document ? input.document.getSnapshot().items : items,
      getVersionSnapshot: () => input?.document ? input.document.getSnapshot().version : version,
      setItems,
      setTotalsOutOfSync,
      reportError,
      resolveErrorMessage: (message) => `public:${message}`,
      applyVersionToken,
      handleVersionConflict,
      ensureGroupedActionCanProceed,
      pushHistoryCommand,
      reloadItems,
      convertV3Items: input?.convertV3Items,
      clearHistory,
      highlightItems,
    })
  );

  return {
    ...rendered,
    applyVersionToken,
    clearHistory,
    highlightItems,
    ensureGroupedActionCanProceed,
    getItems: () => input?.document ? input.document.getSnapshot().items : items,
    handleVersionConflict,
    pushHistoryCommand,
    reloadItems,
    reportError,
    setItems,
    setTotalsOutOfSync,
    setVersion: (nextVersion: EstimateVersionRow | null) => {
      version = nextVersion;
      rendered.rerender();
    },
  };
}

function readHistoryCommand(
  pushHistoryCommand: ReturnType<typeof vi.fn>,
  index = 0
): EstimateEditorHistoryCommand {
  const command = pushHistoryCommand.mock.calls[index]?.[0];
  if (!command) {
    throw new Error("Expected an editor history command.");
  }
  return command as EstimateEditorHistoryCommand;
}

function itemPositions(items: EditorEstimateItem[]) {
  return Object.fromEntries(items.map((item) => [item.id, item.position]));
}

beforeEach(() => {
  vi.resetAllMocks();
  clientMocks.deleteEstimateItem.mockImplementation(async (versionId: string, itemId: string) => ({
    versionToken: { id: versionId, updated_at: "2026-10-28T10:00:00.123458Z" },
    deletedIds: [itemId],
  }));
  clientMocks.fetchEstimateEditorData.mockResolvedValue({
    version: createVersion("version-1", "token-refreshed"),
  });
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorStructureController insertions", () => {
  it("does not start a structure mutation when the autosave barrier refuses", async () => {
    const harness = createHarness();
    harness.ensureGroupedActionCanProceed.mockResolvedValueOnce(false);

    await act(async () => {
      await harness.result.current.actions.insertAssembly("assembly-1", null);
    });

    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledWith(
      "insérer l'assemblage"
    );
    expect(clientMocks.insertAssemblyIntoVersion).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("serializes structure mutations while the first request is active", async () => {
    const deferred = createDeferred<EstimateItem[]>();
    clientMocks.insertAssemblyIntoVersion.mockReturnValueOnce(deferred.promise);
    const harness = createHarness();

    let firstRequest!: Promise<void | boolean>;
    await act(async () => {
      firstRequest = harness.result.current.actions.insertAssembly(
        "assembly-1",
        null
      );
      await Promise.resolve();
    });

    await act(async () => {
      await harness.result.current.actions.insertTemplate("template-1", null);
    });

    expect(clientMocks.insertAssemblyIntoVersion).toHaveBeenCalledTimes(1);
    expect(clientMocks.insertTemplateIntoVersion).not.toHaveBeenCalled();
    expect(harness.reportError).toHaveBeenLastCalledWith(
      "Une modification de structure est déjà en cours. Patientez avant de réessayer."
    );

    await act(async () => {
      deferred.resolve([]);
      await firstRequest;
    });
  });

  it("shifts template siblings by the number of inserted roots", async () => {
    const originalItems = [
      createItem("section-a", { item_type: "section", position: 1 }),
      createItem("section-b", { item_type: "section", position: 2 }),
    ];
    const insertedItems = [
      createItem("template-root-a", {
        item_type: "section",
        position: 2,
      }),
      createItem("template-child", {
        parent_id: "template-root-a",
        position: 1,
      }),
      createItem("template-root-b", {
        item_type: "section",
        position: 3,
      }),
    ];
    clientMocks.insertTemplateIntoVersion.mockResolvedValue(insertedItems);
    const harness = createHarness({ items: originalItems });

    await act(async () => {
      await harness.result.current.actions.insertTemplate(
        "template-1",
        "section-a"
      );
    });

    expect(clientMocks.insertTemplateIntoVersion).toHaveBeenCalledWith(
      "template-1",
      { versionId: "version-1", afterItemId: "section-a" }
    );
    expect(itemPositions(harness.getItems())).toEqual({
      "section-a": 1,
      "section-b": 4,
      "template-root-a": 2,
      "template-child": 1,
      "template-root-b": 3,
    });
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-refreshed");
    expect(readHistoryCommand(harness.pushHistoryCommand).label).toBe(
      "insert-template"
    );
  });

  it("delegates a 409 insertion conflict without exposing a second error", async () => {
    const conflict = Object.assign(new Error("version conflict"), {
      status: 409,
    });
    clientMocks.insertAssemblyIntoVersion.mockRejectedValue(conflict);
    const harness = createHarness({
      items: [createItem("section-a", { item_type: "section" })],
      conflictHandled: true,
    });

    await act(async () => {
      await harness.result.current.actions.insertAssembly("assembly-1", null);
    });

    expect(harness.handleVersionConflict).toHaveBeenCalledWith(conflict, {
      persistDraft: true,
    });
    expect(harness.reportError).toHaveBeenCalledWith(null);
    expect(harness.reportError).not.toHaveBeenCalledWith(
      "public:version conflict"
    );
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(clientMocks.fetchEstimateEditorData).not.toHaveBeenCalled();
  });
});

describe("document-owned structure transitions", () => {
  function connected(convertV3Items?: Parameters<typeof useEstimateEditorStructureController>[0]["convertV3Items"]) {
    const wire = createEstimateEditorResponseFixture();
    const data = parseEstimateEditorData(wire, wire.version.id);
    const prepared = prepareEstimateEditorRead(data, false);
    const scope = { actorId: "actor-1", tenantId: data.version.tenant_id, versionId: data.version.id };
    const document = new EstimateEditorDocument(scope);
    document.acceptRead(prepared);
    clientMocks.fetchEstimateEditorData.mockResolvedValue(data);
    const harness = createHarness({ document, version: data.version, convertV3Items });
    const acceptServerRead = (items: typeof data.items, updatedAt = "2026-10-28T10:00:00.123457Z") => {
      const lines = items.filter((item) => item.item_type === "line");
      const read = { ...data, items, version: { ...data.version, updated_at: updatedAt,
        content_revision: data.version.content_revision + 1,
        total_ht_cents: lines.reduce((sum, item) => sum + (item.line_total_ht_cents ?? 0), 0),
        total_tax_cents: lines.reduce((sum, item) => sum + (item.line_tax_cents ?? 0), 0),
        total_ttc_cents: lines.reduce((sum, item) => sum + (item.line_total_ttc_cents ?? 0), 0),
      } };
      document.acceptRead(prepareEstimateEditorRead(read, false));
    };
    const queueServerRead = (items: typeof data.items, updatedAt?: string) => {
      harness.reloadItems.mockImplementationOnce(async () => { acceptServerRead(items, updatedAt); });
    };
    return { ...harness, document, data, prepared, scope, acceptServerRead, queueServerRead };
  }

  it("confirms inserted template rows and shifted positions without overwriting a newer local title", async () => {
    const harness = connected();
    const inserted = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555", title: "Ligne template" };
    harness.queueServerRead([{ ...harness.data.items[0], position: 2 }, inserted]);
    const response = createDeferred<EstimateItem[]>();
    clientMocks.insertTemplateIntoVersion.mockReturnValueOnce(response.promise);
    let pending!: Promise<void | boolean>;
    await act(async () => { pending = harness.result.current.actions.insertTemplate("template", null); });
    act(() => harness.document.setDraftItems((items) => items.map((item) => ({ ...item, title: "Saisie pendant insertion" }))));
    await act(async () => { response.resolve([inserted]); await pending; });
    expect(harness.document.getSnapshot().confirmedItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: harness.data.items[0].id, position: 2, title: harness.data.items[0].title }),
      inserted,
    ]));
    expect(harness.document.getSnapshot().items.find((item) => item.id === harness.data.items[0].id)?.title).toBe("Saisie pendant insertion");
    expect(harness.setItems).not.toHaveBeenCalled();
  });

  it("rolls back a refused template undo while preserving edits made during its request", async () => {
    const harness = connected();
    const inserted = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555", title: "Ligne template" };
    clientMocks.insertTemplateIntoVersion.mockResolvedValueOnce([inserted]);
    harness.queueServerRead([{ ...harness.data.items[0], position: 2 }, inserted]);
    await act(async () => harness.result.current.actions.insertTemplate("template", null));
    const command = readHistoryCommand(harness.pushHistoryCommand);
    const deletion = createDeferred<{ versionToken: { id: string; updated_at: string }; deletedIds: string[] }>();
    clientMocks.deleteEstimateItem.mockReturnValueOnce(deletion.promise);
    let undo!: Promise<void | boolean>;
    await act(async () => { undo = command.undo({ isCurrentScope: () => true }); });
    act(() => harness.document.setDraftItems((items) => items.map((item) => ({ ...item, title: "Saisie après annulation" }))));
    await act(async () => {
      const rejection = expect(undo).rejects.toThrow("Refus");
      deletion.reject(new Error("Refus"));
      await rejection;
    });
    expect(harness.document.getSnapshot().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: inserted.id, title: inserted.title }),
      expect.objectContaining({ id: harness.data.items[0].id, title: "Saisie après annulation" }),
    ]));
    expect(harness.document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("retains acknowledged deletions when a later template root cannot be deleted", async () => {
    const harness = connected();
    const first = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555" };
    const second = { ...first, id: "66666666-6666-4666-8666-666666666666", position: 2 };
    clientMocks.insertTemplateIntoVersion.mockResolvedValueOnce([first, second]);
    harness.queueServerRead([{ ...harness.data.items[0], position: 3 }, first, second]);
    await act(async () => harness.result.current.actions.insertTemplate("template", null));
    clientMocks.deleteEstimateItem.mockResolvedValueOnce({
      versionToken: { id: harness.data.version.id, updated_at: "2026-10-28T10:00:00.123458Z" }, deletedIds: [first.id],
    }).mockRejectedValueOnce(new Error("Deuxième suppression refusée"));
    const command = readHistoryCommand(harness.pushHistoryCommand);
    await act(async () => { await expect(command.undo({ isCurrentScope: () => true })).rejects.toThrow("Deuxième"); });
    expect(harness.document.getSnapshot().confirmedItems.some((item) => item.id === first.id)).toBe(false);
    expect(harness.document.getSnapshot().items.some((item) => item.id === first.id)).toBe(false);
    expect(harness.document.getSnapshot().items.some((item) => item.id === second.id)).toBe(true);
    expect(harness.document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("keeps a newer versioned read when an earlier template deletion receipt arrives", async () => {
    const harness = connected();
    const inserted = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555", title: "Ligne template" };
    clientMocks.insertTemplateIntoVersion.mockResolvedValueOnce([inserted]);
    const confirmedRows = [{ ...harness.data.items[0], position: 2 }, inserted];
    harness.queueServerRead(confirmedRows);
    await act(async () => harness.result.current.actions.insertTemplate("template", null));
    const command = readHistoryCommand(harness.pushHistoryCommand);
    const deletion = createDeferred<{ versionToken: { id: string; updated_at: string }; deletedIds: string[] }>();
    clientMocks.deleteEstimateItem.mockReturnValueOnce(deletion.promise);
    let undo!: Promise<void | boolean>;
    await act(async () => { undo = command.undo({ isCurrentScope: () => true }); });
    act(() => harness.acceptServerRead(confirmedRows.map((item) => item.id === inserted.id
      ? { ...item, title: "Titre confirmé plus récent" } : item), "2026-10-28T10:00:00.123459Z"));
    harness.setTotalsOutOfSync.mockClear();
    await act(async () => {
      deletion.resolve({ versionToken: { id: harness.data.version.id, updated_at: "2026-10-28T10:00:00.123458Z" }, deletedIds: [inserted.id] });
      expect(await undo).toBe(false);
    });
    expect(harness.document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123459Z");
    expect(harness.document.getSnapshot().confirmedItems.find((item) => item.id === inserted.id)?.title).toBe("Titre confirmé plus récent");
    expect(harness.document.getSnapshot().items.find((item) => item.id === inserted.id)?.title).toBe("Titre confirmé plus récent");
    expect(harness.document.getSnapshot().itemOperationCount).toBe(0);
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
  });

  it.each(["insertAssembly", "insertTemplate"] as const)("does not publish %s history or highlight for roots absent from the full read", async (action) => {
    const harness = connected();
    const inserted = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555" };
    const insertMock = action === "insertAssembly" ? clientMocks.insertAssemblyIntoVersion : clientMocks.insertTemplateIntoVersion;
    insertMock.mockResolvedValueOnce([inserted]);
    harness.queueServerRead(harness.data.items, "2026-10-28T10:00:00.123459Z");
    await act(async () => { await harness.result.current.actions[action]("source", null); });
    expect(harness.document.getSnapshot().confirmedItems).toEqual(harness.data.items);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(harness.highlightItems).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
  });

  it.each(["insertAssembly", "insertTemplate"] as const)("returns false for %s redo when its roots are absent from the full read", async (action) => {
    const harness = connected();
    const inserted = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555" };
    const recreated = { ...inserted, id: "66666666-6666-4666-8666-666666666666" };
    const insertMock = action === "insertAssembly" ? clientMocks.insertAssemblyIntoVersion : clientMocks.insertTemplateIntoVersion;
    insertMock.mockResolvedValueOnce([inserted]).mockResolvedValueOnce([recreated]);
    harness.queueServerRead([...harness.data.items, inserted]);
    await act(async () => { await harness.result.current.actions[action]("source", null); });
    const command = readHistoryCommand(harness.pushHistoryCommand);
    harness.queueServerRead(harness.data.items, "2026-10-28T10:00:00.123459Z");
    harness.setTotalsOutOfSync.mockClear();
    await act(async () => { expect(await command.redo({ isCurrentScope: () => true })).toBe(false); });
    expect(harness.document.getSnapshot().confirmedItems).toEqual(harness.data.items);
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
  });

  it("ignores stale actor callbacks and their late insertion replies", async () => {
    const harness = connected();
    const oldInsert = harness.result.current.actions.insertTemplate;
    const response = createDeferred<EstimateItem[]>();
    clientMocks.insertTemplateIntoVersion.mockReturnValueOnce(response.promise);
    let pending!: Promise<void | boolean>;
    await act(async () => { pending = oldInsert("template", null); });
    act(() => {
      harness.document.changeScope({ ...harness.scope, actorId: "actor-2" });
      harness.document.acceptRead(harness.prepared);
    });
    const before = harness.document.getSnapshot();
    await act(async () => { await oldInsert("other-template", null); });
    expect(clientMocks.insertTemplateIntoVersion).toHaveBeenCalledTimes(1);
    await act(async () => { response.resolve([{ ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555" }]); await pending; });
    expect(harness.document.getSnapshot()).toBe(before);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("rolls back only the failed conversion while preserving a concurrent edit elsewhere", async () => {
    const response = createDeferred<Awaited<ReturnType<NonNullable<Parameters<typeof useEstimateEditorStructureController>[0]["convertV3Items"]>>>>();
    const convert = vi.fn().mockReturnValue(response.promise);
    const harness = connected(convert);
    const other = { ...harness.data.items[0], id: "55555555-5555-4555-8555-555555555555", position: 2 };
    act(() => harness.document.acceptCreatedItem(null, other));
    let pending!: Promise<boolean>;
    await act(async () => { pending = harness.result.current.actions.convertItems([harness.data.items[0].id], "section"); });
    act(() => harness.document.setDraftItems((items) => items.map((item) => ({ ...item, title: "Saisie concurrente" }))));
    await act(async () => { response.reject(new Error("Conversion refusée")); expect(await pending).toBe(false); });
    expect(harness.document.getSnapshot().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: harness.data.items[0].id, title: harness.data.items[0].title }),
      expect.objectContaining({ id: other.id, title: "Saisie concurrente" }),
    ]));
    expect(harness.document.getSnapshot().itemOperationCount).toBe(0);
  });
});

describe("useEstimateEditorStructureController history", () => {
  it("uses remapped template roots across undo, redo, then undo", async () => {
    const initialItems = [
      createItem("existing", { item_type: "section", position: 1 }),
    ];
    const firstInsertion = [
      createItem("old-root-a", { item_type: "section", position: 2 }),
      createItem("old-child", { parent_id: "old-root-a", position: 1 }),
      createItem("old-root-b", { item_type: "section", position: 3 }),
    ];
    const recreatedInsertion = [
      createItem("new-root-a", { item_type: "section", position: 2 }),
      createItem("new-child", { parent_id: "new-root-a", position: 1 }),
      createItem("new-root-b", { item_type: "section", position: 3 }),
    ];
    clientMocks.insertTemplateIntoVersion
      .mockResolvedValueOnce(firstInsertion)
      .mockResolvedValueOnce(recreatedInsertion);
    const harness = createHarness({ items: initialItems });

    await act(async () => {
      await harness.result.current.actions.insertTemplate("template-1", null);
    });
    const command = readHistoryCommand(harness.pushHistoryCommand);

    await act(async () => {
      await command.undo();
    });

    expect(harness.getItems().map((item) => item.id)).toEqual(["existing"]);
    expect(clientMocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      1,
      "version-1",
      "old-root-a"
    );
    expect(clientMocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      2,
      "version-1",
      "old-root-b"
    );

    await act(async () => {
      await command.redo();
    });

    expect(harness.getItems().map((item) => item.id)).toEqual([
      "existing",
      "new-root-a",
      "new-child",
      "new-root-b",
    ]);

    await act(async () => {
      await command.undo();
    });

    expect(clientMocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      3,
      "version-1",
      "new-root-a"
    );
    expect(clientMocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      4,
      "version-1",
      "new-root-b"
    );
    expect(clientMocks.fetchEstimateEditorData).toHaveBeenCalledTimes(2);
  });
});

describe("useEstimateEditorStructureController duplication", () => {

  it("refreshes the token when duplication does not return one", async () => {
    clientMocks.duplicateEstimateSection.mockResolvedValue(
      createDuplicateResult(null)
    );
    const harness = createHarness();

    await act(async () => {
      await harness.result.current.actions.duplicateSection("section-1");
    });

    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(clientMocks.fetchEstimateEditorData).toHaveBeenCalledWith(
      "version-1"
    );
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-refreshed");
  });
});

describe("useEstimateEditorStructureController route races", () => {
  it("ignores a late token refresh from the previous route generation", async () => {
    const deferredRefresh = createDeferred<{
      version: EstimateVersionRow;
    }>();
    clientMocks.insertAssemblyIntoVersion.mockResolvedValue([
      createItem("assembly-root", { item_type: "section" }),
    ]);
    clientMocks.fetchEstimateEditorData.mockReturnValueOnce(
      deferredRefresh.promise
    );
    const harness = createHarness();

    let request!: Promise<void | boolean>;
    await act(async () => {
      request = harness.result.current.actions.insertAssembly(
        "assembly-1",
        null
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(clientMocks.fetchEstimateEditorData).toHaveBeenCalledWith(
      "version-1"
    );

    act(() => {
      harness.setVersion(createVersion("version-2", "token-version-2"));
    });
    await act(async () => {
      deferredRefresh.resolve({
        version: createVersion("version-1", "late-token-version-1"),
      });
      await request;
    });

    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "assembly",
      call: (
        actions: ReturnType<
          typeof useEstimateEditorStructureController
        >["actions"]
      ) => actions.insertAssembly("assembly-1", null),
      mock: clientMocks.insertAssemblyIntoVersion,
    },
    {
      label: "template",
      call: (
        actions: ReturnType<
          typeof useEstimateEditorStructureController
        >["actions"]
      ) => actions.insertTemplate("template-1", null),
      mock: clientMocks.insertTemplateIntoVersion,
    },
  ])("ignores a late $label response after a version change", async ({ call, mock }) => {
    const deferred = createDeferred<EstimateItem[]>();
    mock.mockReturnValueOnce(deferred.promise);
    const harness = createHarness({
      items: [createItem("existing", { item_type: "section" })],
    });

    let request!: Promise<void | boolean>;
    act(() => {
      request = call(harness.result.current.actions);
    });
    harness.setVersion(createVersion("version-2", "token-version-2"));

    await act(async () => {
      deferred.resolve([
        createItem("late-root", { item_type: "section", position: 2 }),
      ]);
      await request;
    });

    expect(harness.getItems().map((item) => item.id)).toEqual(["existing"]);
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(clientMocks.fetchEstimateEditorData).not.toHaveBeenCalled();
  });

  it("ignores a late duplication response after a version change", async () => {
    const deferred = createDeferred<
      ReturnType<typeof createDuplicateResult>
    >();
    clientMocks.duplicateEstimateSection.mockReturnValueOnce(deferred.promise);
    const harness = createHarness();

    let request!: Promise<void | boolean>;
    act(() => {
      request = harness.result.current.actions.duplicateSection("section-1");
    });
    harness.setVersion(createVersion("version-2", "token-version-2"));

    await act(async () => {
      deferred.resolve(
        createDuplicateResult({
          id: "version-1",
          updated_at: "late-token",
        })
      );
      await request;
    });

    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(clientMocks.fetchEstimateEditorData).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorStructureController v3 conversion (lot 3.2, entrée 1)", () => {
  it("commits one v3 batch, rereads the grid for the new ids and applies the batch token", async () => {
    const lines = [createItem("line-a"), createItem("line-b", { position: 2 })];
    const convertV3Items = vi.fn().mockResolvedValue({ id: "version-1", updated_at: "token-converted", content_revision: 3 });
    const harness = createHarness({ items: lines, convertV3Items });

    let committed: boolean | undefined;
    await act(async () => {
      committed = await harness.result.current.actions.convertItems(["line-a", "line-b"], "section");
    });

    expect(committed).toBe(true);
    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledWith("convertir en section");
    expect(convertV3Items).toHaveBeenCalledWith("version-1", "token-initial", lines, ["line-a", "line-b"], "section");
    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledWith(false);
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-converted", 3);
    expect(harness.clearHistory).toHaveBeenCalledTimes(1);
    expect(harness.reportError).toHaveBeenLastCalledWith(null);
  });

  it("reports a refused batch by its message and keeps the grid as it was", async () => {
    const convertV3Items = vi.fn().mockRejectedValue(new Error("La section contient des lignes ou des sous-sections."));
    const section = createItem("section-a", { item_type: "section" });
    const harness = createHarness({ items: [section], convertV3Items });

    let committed: boolean | undefined;
    await act(async () => {
      committed = await harness.result.current.actions.convertItems(["section-a"], "line");
    });

    expect(committed).toBe(false);
    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledWith("convertir en ligne");
    expect(harness.reportError).toHaveBeenLastCalledWith("public:La section contient des lignes ou des sous-sections.");
    expect(harness.getItems()).toEqual([section]);
    expect(harness.reloadItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.clearHistory).not.toHaveBeenCalled();
  });

  it("sends nothing on a v1/v2 version, which keeps its direct conversion", async () => {
    const harness = createHarness({ items: [createItem("line-a")] });

    let committed: boolean | undefined;
    await act(async () => {
      committed = await harness.result.current.actions.convertItems(["line-a"], "section");
    });

    expect(committed).toBe(false);
    expect(harness.ensureGroupedActionCanProceed).not.toHaveBeenCalled();
  });
});
