// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isMutationBlocked?: boolean;
  conflictHandled?: boolean;
}) {
  let items = input?.items ?? [];
  let version =
    input && "version" in input ? (input.version ?? null) : createVersion();
  const applyVersionToken = vi.fn();
  const ensureGroupedActionCanProceed = vi.fn().mockResolvedValue(true);
  const handleVersionConflict = vi
    .fn()
    .mockReturnValue(input?.conflictHandled ?? false);
  const pushHistoryCommand = vi.fn();
  const reloadItems = vi.fn().mockResolvedValue(undefined);
  const reportError = vi.fn();
  const setTotalsOutOfSync = vi.fn();
  const setItems = vi.fn(
    (
      update:
        | EditorEstimateItem[]
        | ((previous: EditorEstimateItem[]) => EditorEstimateItem[])
    ) => {
      items = typeof update === "function" ? update(items) : update;
    }
  );

  const rendered = renderHook(() =>
    useEstimateEditorStructureController({
      routeVersionId: version?.id ?? "version-1",
      isMutationBlocked: input?.isMutationBlocked ?? false,
      mutationBlockedMessage: "Mutation interdite.",
      getItemsSnapshot: () => items,
      getVersionSnapshot: () => version,
      setItems,
      setTotalsOutOfSync,
      reportError,
      resolveErrorMessage: (message) => `public:${message}`,
      applyVersionToken,
      handleVersionConflict,
      ensureGroupedActionCanProceed,
      pushHistoryCommand,
      reloadItems,
    })
  );

  return {
    ...rendered,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    getItems: () => items,
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
  clientMocks.deleteEstimateItem.mockResolvedValue(undefined);
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
      "inserer l'assemblage"
    );
    expect(clientMocks.insertAssemblyIntoVersion).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("serializes structure mutations while the first request is active", async () => {
    const deferred = createDeferred<EstimateItem[]>();
    clientMocks.insertAssemblyIntoVersion.mockReturnValueOnce(deferred.promise);
    const harness = createHarness();

    let firstRequest!: Promise<void>;
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
      "Une modification de structure est deja en cours. Patientez avant de reessayer."
    );

    await act(async () => {
      deferred.resolve([]);
      await firstRequest;
    });
  });

  it("positions an assembly optimistically and refreshes the version token", async () => {
    const originalItems = [
      createItem("section-a", { item_type: "section", position: 1 }),
      createItem("section-b", { item_type: "section", position: 2 }),
      createItem("nested", { parent_id: "section-b", position: 1 }),
    ];
    const insertedItems = [
      createItem("assembly-root", {
        item_type: "section",
        position: 2,
      }),
      createItem("assembly-child", {
        parent_id: "assembly-root",
        position: 1,
      }),
    ];
    clientMocks.insertAssemblyIntoVersion.mockResolvedValue(insertedItems);
    const harness = createHarness({ items: originalItems });

    await act(async () => {
      await harness.result.current.actions.insertAssembly(
        "assembly-1",
        "section-a"
      );
    });

    expect(clientMocks.insertAssemblyIntoVersion).toHaveBeenCalledWith(
      "assembly-1",
      { versionId: "version-1", afterItemId: "section-a" }
    );
    expect(itemPositions(harness.getItems())).toEqual({
      "section-a": 1,
      "section-b": 3,
      nested: 1,
      "assembly-root": 2,
      "assembly-child": 1,
    });
    expect(clientMocks.fetchEstimateEditorData).toHaveBeenCalledWith(
      "version-1"
    );
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-refreshed");
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledWith(false);
    expect(readHistoryCommand(harness.pushHistoryCommand).label).toBe(
      "insert-assembly"
    );
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
  it("reloads items and applies the token returned by duplication", async () => {
    clientMocks.duplicateEstimateSection.mockResolvedValue(
      createDuplicateResult({
        id: "version-1",
        updated_at: "token-from-duplication",
      })
    );
    const harness = createHarness();

    await act(async () => {
      await harness.result.current.actions.duplicateSection("section-1");
    });

    expect(clientMocks.duplicateEstimateSection).toHaveBeenCalledWith(
      "version-1",
      "section-1"
    );
    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledWith(false);
    expect(harness.applyVersionToken).toHaveBeenCalledWith(
      "token-from-duplication"
    );
    expect(clientMocks.fetchEstimateEditorData).not.toHaveBeenCalled();
  });

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

    let request!: Promise<void>;
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

    let request!: Promise<void>;
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

    let request!: Promise<void>;
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
