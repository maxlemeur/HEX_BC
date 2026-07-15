// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  moveEstimateItem: vi.fn(),
  reorderEstimateItems: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  moveEstimateItem: clientMocks.moveEstimateItem,
  reorderEstimateItems: clientMocks.reorderEstimateItems,
}));

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorOrderingController } from "@/hooks/useEstimateEditorOrderingController";
import type {
  EditorEstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

function createItem(
  id: string,
  overrides: Partial<EditorEstimateItem> = {}
): EditorEstimateItem {
  return {
    id,
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: id,
    ...overrides,
  } as EditorEstimateItem;
}

function createVersion(id = "version-1"): EstimateVersionRow {
  return {
    id,
    updated_at: `${id}-token`,
  } as EstimateVersionRow;
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function itemOrder(items: EditorEstimateItem[]) {
  return items.map(({ id, parent_id, position }) => ({
    id,
    parentId: parent_id ?? null,
    position,
  }));
}

function createHarness(input?: {
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isMutationBlocked?: boolean;
}) {
  let items = input?.items ?? [];
  let version =
    input && "version" in input ? (input.version ?? null) : createVersion();
  const reportError = vi.fn();
  const setTotalsOutOfSync = vi.fn();
  const pushHistoryCommand = vi.fn();
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
    useEstimateEditorOrderingController({
      isMutationBlocked: input?.isMutationBlocked ?? false,
      mutationBlockedMessage: "Mutation interdite.",
      getItemsSnapshot: () => items,
      getVersionSnapshot: () => version,
      setItems,
      setTotalsOutOfSync,
      reportError,
      resolveErrorMessage: (message) => `public:${message}`,
      pushHistoryCommand,
    })
  );

  return {
    ...rendered,
    getItems: () => items,
    setVersion: (nextVersion: EstimateVersionRow | null) => {
      version = nextVersion;
    },
    pushHistoryCommand,
    reportError,
    setItems,
    setTotalsOutOfSync,
  };
}

function readHistoryCommand(
  pushHistoryCommand: ReturnType<typeof vi.fn>
): EstimateEditorHistoryCommand {
  const command = pushHistoryCommand.mock.calls[0]?.[0];
  if (!command) {
    throw new Error("Expected an editor history command.");
  }
  return command as EstimateEditorHistoryCommand;
}

beforeEach(() => {
  clientMocks.moveEstimateItem.mockReset().mockResolvedValue(undefined);
  clientMocks.reorderEstimateItems.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorOrderingController reorder", () => {
  it("does nothing when sibling order is unchanged", async () => {
    const harness = createHarness({
      items: [
        createItem("line-a", { parent_id: "section", position: 1 }),
        createItem("line-b", { parent_id: "section", position: 2 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.reorder("section", [
        "line-a",
        "line-b",
      ]);
    });

    expect(harness.setItems).not.toHaveBeenCalled();
    expect(clientMocks.reorderEstimateItems).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it.each([
    {
      marker: "temporary id",
      item: createItem("tmp:line-a", { parent_id: "section", position: 1 }),
    },
    {
      marker: "pending flag",
      item: createItem("line-a", {
        parent_id: "section",
        position: 1,
        _pendingCreate: true,
      }),
    },
  ])("blocks reorder for an item with a $marker", async ({ item }) => {
    const harness = createHarness({
      items: [
        item,
        createItem("line-b", { parent_id: "section", position: 2 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.reorder("section", [
        "line-b",
        item.id,
      ]);
    });

    expect(harness.reportError).toHaveBeenCalledWith(
      "Impossible de reordonner tant que des elements en creation ne sont pas synchronises."
    );
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(clientMocks.reorderEstimateItems).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("applies optimistic order and registers server-backed undo and redo", async () => {
    const harness = createHarness({
      items: [
        createItem("line-a", { parent_id: "section", position: 1 }),
        createItem("line-b", { parent_id: "section", position: 2 }),
        createItem("other", { parent_id: "other-section", position: 7 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.reorder("section", [
        "line-b",
        "line-a",
      ]);
    });

    expect(itemOrder(harness.getItems())).toEqual([
      { id: "line-a", parentId: "section", position: 2 },
      { id: "line-b", parentId: "section", position: 1 },
      { id: "other", parentId: "other-section", position: 7 },
    ]);
    expect(clientMocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      1,
      "version-1",
      "section",
      ["line-b", "line-a"]
    );

    const command = readHistoryCommand(harness.pushHistoryCommand);
    expect(command.label).toBe("reorder");

    await act(async () => {
      await command.undo();
    });

    expect(itemOrder(harness.getItems()).slice(0, 2)).toEqual([
      { id: "line-a", parentId: "section", position: 1 },
      { id: "line-b", parentId: "section", position: 2 },
    ]);
    expect(clientMocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      2,
      "version-1",
      "section",
      ["line-a", "line-b"]
    );

    await act(async () => {
      await command.redo();
    });

    expect(itemOrder(harness.getItems()).slice(0, 2)).toEqual([
      { id: "line-a", parentId: "section", position: 2 },
      { id: "line-b", parentId: "section", position: 1 },
    ]);
    expect(clientMocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      3,
      "version-1",
      "section",
      ["line-b", "line-a"]
    );
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledTimes(2);
    expect(harness.setTotalsOutOfSync).toHaveBeenNthCalledWith(1, false);
    expect(harness.setTotalsOutOfSync).toHaveBeenNthCalledWith(2, false);
  });

  it("restores the snapshot when persistence fails", async () => {
    clientMocks.reorderEstimateItems.mockRejectedValueOnce(
      new Error("reorder failed")
    );
    const initialItems = [
      createItem("line-a", { parent_id: "section", position: 1 }),
      createItem("line-b", { parent_id: "section", position: 2 }),
    ];
    const harness = createHarness({ items: initialItems });

    await act(async () => {
      await harness.result.current.actions.reorder("section", [
        "line-b",
        "line-a",
      ]);
    });

    expect(harness.getItems()).toBe(initialItems);
    expect(harness.setItems).toHaveBeenCalledTimes(2);
    expect(harness.reportError).toHaveBeenCalledWith(
      "Impossible de reordonner les lignes."
    );
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorOrderingController move", () => {
  it("delegates a same-parent move to reorder", async () => {
    const harness = createHarness({
      items: [
        createItem("line-a", { parent_id: "section", position: 1 }),
        createItem("line-b", { parent_id: "section", position: 2 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.move(
        "line-a",
        "section",
        "section",
        ["line-b"],
        ["line-b", "line-a"]
      );
    });

    expect(clientMocks.moveEstimateItem).not.toHaveBeenCalled();
    expect(clientMocks.reorderEstimateItems).toHaveBeenCalledWith(
      "version-1",
      "section",
      ["line-b", "line-a"]
    );
    expect(readHistoryCommand(harness.pushHistoryCommand).label).toBe("reorder");
  });

  it.each([
    {
      marker: "temporary id",
      moved: createItem("tmp:moved", {
        parent_id: "source",
        position: 2,
      }),
    },
    {
      marker: "pending flag",
      moved: createItem("moved", {
        parent_id: "source",
        position: 2,
        _pendingCreate: true,
      }),
    },
  ])("blocks an inter-parent move for an item with a $marker", async ({ moved }) => {
    const harness = createHarness({
      items: [
        createItem("source-a", { parent_id: "source", position: 1 }),
        moved,
        createItem("target-a", { parent_id: "target", position: 1 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.move(
        moved.id,
        "source",
        "target",
        ["source-a"],
        ["target-a", moved.id]
      );
    });

    expect(harness.reportError).toHaveBeenCalledWith(
      "Impossible de deplacer tant que des elements en creation ne sont pas synchronises."
    );
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(clientMocks.moveEstimateItem).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("persists an exact inter-parent payload with optimistic undo and redo", async () => {
    const harness = createHarness({
      items: [
        createItem("source-a", { parent_id: "source", position: 1 }),
        createItem("moved", { parent_id: "source", position: 2 }),
        createItem("target-a", { parent_id: "target", position: 1 }),
        createItem("target-b", { parent_id: "target", position: 2 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.move(
        "moved",
        "source",
        "target",
        ["source-a"],
        ["target-a", "moved", "target-b"]
      );
    });

    expect(itemOrder(harness.getItems())).toEqual([
      { id: "source-a", parentId: "source", position: 1 },
      { id: "moved", parentId: "target", position: 2 },
      { id: "target-a", parentId: "target", position: 1 },
      { id: "target-b", parentId: "target", position: 3 },
    ]);
    expect(clientMocks.moveEstimateItem).toHaveBeenNthCalledWith(1, "version-1", {
      item_id: "moved",
      from_parent_id: "source",
      to_parent_id: "target",
      ordered_source_ids: ["source-a"],
      ordered_target_ids: ["target-a", "moved", "target-b"],
    });
    expect(harness.setTotalsOutOfSync).toHaveBeenNthCalledWith(1, false);

    const command = readHistoryCommand(harness.pushHistoryCommand);
    expect(command.label).toBe("move-item");

    await act(async () => {
      await command.undo();
    });

    expect(itemOrder(harness.getItems())).toEqual([
      { id: "source-a", parentId: "source", position: 1 },
      { id: "moved", parentId: "source", position: 2 },
      { id: "target-a", parentId: "target", position: 1 },
      { id: "target-b", parentId: "target", position: 2 },
    ]);
    expect(clientMocks.moveEstimateItem).toHaveBeenNthCalledWith(2, "version-1", {
      item_id: "moved",
      from_parent_id: "target",
      to_parent_id: "source",
      ordered_source_ids: ["target-a", "target-b"],
      ordered_target_ids: ["source-a", "moved"],
    });

    await act(async () => {
      await command.redo();
    });

    expect(itemOrder(harness.getItems())).toEqual([
      { id: "source-a", parentId: "source", position: 1 },
      { id: "moved", parentId: "target", position: 2 },
      { id: "target-a", parentId: "target", position: 1 },
      { id: "target-b", parentId: "target", position: 3 },
    ]);
    expect(clientMocks.moveEstimateItem).toHaveBeenNthCalledWith(3, "version-1", {
      item_id: "moved",
      from_parent_id: "source",
      to_parent_id: "target",
      ordered_source_ids: ["source-a"],
      ordered_target_ids: ["target-a", "moved", "target-b"],
    });
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledTimes(3);
  });

  it("restores the snapshot and resolves the error when persistence fails", async () => {
    clientMocks.moveEstimateItem.mockRejectedValueOnce(new Error("move failed"));
    const initialItems = [
      createItem("source-a", { parent_id: "source", position: 1 }),
      createItem("moved", { parent_id: "source", position: 2 }),
      createItem("target-a", { parent_id: "target", position: 1 }),
    ];
    const harness = createHarness({ items: initialItems });

    await act(async () => {
      await harness.result.current.actions.move(
        "moved",
        "source",
        "target",
        ["source-a"],
        ["target-a", "moved"]
      );
    });

    expect(harness.getItems()).toBe(initialItems);
    expect(harness.setItems).toHaveBeenCalledTimes(2);
    expect(harness.reportError).toHaveBeenNthCalledWith(1, null);
    expect(harness.reportError).toHaveBeenNthCalledWith(2, "public:move failed");
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorOrderingController route races", () => {
  it.each(["reorder", "move"] as const)(
    "does not register %s history after a late response from another version",
    async (actionName) => {
      const deferred = createDeferred();
      const harness = createHarness({
        items: [
          createItem("line-a", { parent_id: "source", position: 1 }),
          createItem("line-b", { parent_id: "source", position: 2 }),
          createItem("target-a", { parent_id: "target", position: 1 }),
        ],
      });

      if (actionName === "reorder") {
        clientMocks.reorderEstimateItems.mockReturnValueOnce(deferred.promise);
      } else {
        clientMocks.moveEstimateItem.mockReturnValueOnce(deferred.promise);
      }

      let actionPromise!: Promise<void>;
      act(() => {
        actionPromise =
          actionName === "reorder"
            ? harness.result.current.actions.reorder("source", [
                "line-b",
                "line-a",
              ])
            : harness.result.current.actions.move(
                "line-b",
                "source",
                "target",
                ["line-a"],
                ["target-a", "line-b"]
              );
      });

      harness.setVersion(createVersion("version-2"));
      await act(async () => {
        deferred.resolve();
        await actionPromise;
      });

      expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
      expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
    }
  );
});
