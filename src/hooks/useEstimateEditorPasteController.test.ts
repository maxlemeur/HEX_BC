// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batchEstimateOperations: vi.fn(),
  computeEstimateLineValues: vi.fn(),
  deleteEstimateItem: vi.fn(),
  reorderEstimateItems: vi.fn(),
}));

vi.mock("@/lib/estimate-calculations", () => ({
  computeEstimateLineValues: mocks.computeEstimateLineValues,
}));

vi.mock("@/lib/estimates/client", () => ({
  batchEstimateOperations: mocks.batchEstimateOperations,
  deleteEstimateItem: mocks.deleteEstimateItem,
  reorderEstimateItems: mocks.reorderEstimateItems,
}));

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorPasteController } from "@/hooks/useEstimateEditorPasteController";
import type { ClipboardPreviewValues } from "@/lib/estimates/clipboard";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateItemInsertPayload,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

type CreateOperation = {
  op: "create";
  data: EstimateItemInsertPayload;
};

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
    updated_at: id === "version-1" ? "token-initial" : `${id}-token`,
  } as EstimateVersionRow;
}

function createRow(
  designation: string | null,
  overrides: Partial<ClipboardPreviewValues> = {}
): ClipboardPreviewValues {
  return {
    designation,
    quantity: 1,
    unit: null,
    unit_price_ht: 0,
    supply_type: null,
    k_fo: 1,
    h_mo: 0,
    k_mo: 1,
    h_mo_majoration: 1,
    ...overrides,
  };
}

function makeBatchResult(input: {
  versionId?: string;
  updatedAt: string;
  operations: CreateOperation[];
  idOffset?: number;
}) {
  const idOffset = input.idOffset ?? 0;
  return {
    committed: true,
    versionToken: {
      id: input.versionId ?? "version-1",
      updated_at: input.updatedAt,
    },
    results: input.operations.map((operation, index) => ({
      index,
      op: "create" as const,
      status: "ok" as const,
      data: {
        item: createItem(`created-${idOffset + index + 1}`, operation.data),
      },
    })),
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function createHarness(input?: {
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isLaborSplitEnabled?: boolean;
  settings?: { margin_multiplier: number; tax_rate_bp: number } | null;
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
  const triggerVersionReload = vi.fn();
  const pushHistoryCommand = vi.fn();
  const reloadItems = vi.fn().mockResolvedValue(undefined);
  const reportError = vi.fn();
  const setTotalsOutOfSync = vi.fn();
  const recreateItemsFromSnapshots = vi.fn();
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
    useEstimateEditorPasteController({
      settings:
        input && "settings" in input
          ? (input.settings ?? null)
          : { margin_multiplier: 1.2, tax_rate_bp: 2000 },
      isLaborSplitEnabled: input?.isLaborSplitEnabled ?? false,
      isMutationBlocked: false,
      mutationBlockedMessage: "Mutation interdite.",
      supplyTypeIdByLowerName: new Map([["acier", "supply-steel"]]),
      getItemsSnapshot: () => items,
      getVersionSnapshot: () => version,
      setItems,
      setTotalsOutOfSync,
      reportError,
      resolveErrorMessage: (message) => `public:${message}`,
      applyVersionToken,
      ensureGroupedActionCanProceed,
      handleVersionConflict,
      triggerVersionReload,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
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
    recreateItemsFromSnapshots,
    reloadItems,
    reportError,
    setItems,
    setTotalsOutOfSync,
    triggerVersionReload,
    setVersion: (nextVersion: EstimateVersionRow | null) => {
      version = nextVersion;
    },
  };
}

function readHistoryCommand(
  pushHistoryCommand: ReturnType<typeof vi.fn>
): EstimateEditorHistoryCommand {
  const command = pushHistoryCommand.mock.calls[0]?.[0];
  if (!command) throw new Error("Expected a paste history command.");
  return command as EstimateEditorHistoryCommand;
}

function itemOrder(items: EditorEstimateItem[]) {
  return items.map(({ id, parent_id, position }) => ({
    id,
    parentId: parent_id ?? null,
    position,
  }));
}

let generatedItemCount = 0;
let generatedTokenCount = 0;

beforeEach(() => {
  generatedItemCount = 0;
  generatedTokenCount = 0;
  mocks.batchEstimateOperations.mockReset().mockImplementation(
    async (
      versionId: string,
      _token: string,
      operations: CreateOperation[]
    ) => {
      const result = makeBatchResult({
        versionId,
        updatedAt: `token-${++generatedTokenCount}`,
        operations,
        idOffset: generatedItemCount,
      });
      generatedItemCount += operations.length;
      return result;
    }
  );
  mocks.computeEstimateLineValues.mockReset().mockReturnValue({
    puHtCents: 777,
    saleLineCents: 1554,
    taxLineCents: 311,
    ttcLineCents: 1865,
  });
  mocks.deleteEstimateItem.mockReset().mockResolvedValue(undefined);
  mocks.reorderEstimateItems.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorPasteController validation barrier", () => {
  it("stops before validation and writes when the grouped-action barrier refuses", async () => {
    const harness = createHarness();
    harness.ensureGroupedActionCanProceed.mockResolvedValueOnce(false);

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("Ligne")],
      });
    });

    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledWith(
      "coller les lignes"
    );
    expect(mocks.batchEstimateOperations).not.toHaveBeenCalled();
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("rejects an empty valid selection after crossing the barrier", async () => {
    const harness = createHarness();

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("   "), createRow(null)],
      });
    });

    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledTimes(1);
    expect(harness.reportError).toHaveBeenCalledWith(
      "Aucune ligne valide a inserer."
    );
    expect(mocks.computeEstimateLineValues).not.toHaveBeenCalled();
    expect(mocks.batchEstimateOperations).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorPasteController anchors and payloads", () => {
  it("inserts under a section with normalized positions, payload and calculations", async () => {
    const harness = createHarness({
      isLaborSplitEnabled: true,
      items: [
        createItem("section", {
          item_type: "section",
          parent_id: null,
          position: 1,
        }),
        createItem("existing-line", {
          parent_id: "section",
          position: 4,
        }),
      ],
    });
    const pastedRow = createRow("  Tube acier  ", {
      quantity: 2,
      unit: "  ml  ",
      unit_price_ht: 12.34,
      supply_type: "  Acier  ",
      k_fo: 1.1,
      h_mo: 3,
      k_mo: 1.4,
      h_mo_majoration: 1.25,
    });

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: "section",
        rows: [pastedRow],
      });
    });

    expect(harness.ensureGroupedActionCanProceed.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.batchEstimateOperations.mock.invocationCallOrder[0]
    );
    expect(mocks.computeEstimateLineValues).toHaveBeenCalledWith(
      expect.objectContaining({
        quantity: 2,
        unit_price_ht_cents: 1234,
        tax_rate_bp: 2000,
        k_fo: 1.1,
        h_mo: 3,
        h_mo_majoration: 1.25,
        k_mo: 1.4,
      }),
      {
        marginMultiplier: 1.2,
        taxRateBp: 2000,
        isLaborSplitEnabled: true,
      }
    );
    expect(mocks.batchEstimateOperations).toHaveBeenCalledWith(
      "version-1",
      "token-initial",
      [
        {
          op: "create",
          data: expect.objectContaining({
            version_id: "version-1",
            parent_id: "section",
            item_type: "line",
            position: 5,
            title: "Tube acier",
            description: "ml",
            quantity: 2,
            unit_price_ht_cents: 1234,
            supply_type_id: "supply-steel",
            pu_ht_cents: 777,
            line_total_ht_cents: 1554,
            line_tax_cents: 311,
            line_total_ttc_cents: 1865,
            h_mo_atelier: 0,
            k_mo_atelier: 1,
            labor_role_atelier_id: null,
            h_mo_chantier: 0,
            k_mo_chantier: 1,
            labor_role_chantier_id: null,
          }),
        },
      ]
    );
    expect(itemOrder(harness.getItems())).toEqual([
      { id: "section", parentId: null, position: 1 },
      { id: "existing-line", parentId: "section", position: 4 },
      { id: "created-1", parentId: "section", position: 5 },
    ]);
    expect(mocks.reorderEstimateItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-1");
    expect(readHistoryCommand(harness.pushHistoryCommand).label).toBe(
      "paste-insert"
    );
  });

  it("inserts immediately after a line anchor and persists the resulting order", async () => {
    const harness = createHarness({
      items: [
        createItem("before", { parent_id: "section", position: 1 }),
        createItem("anchor", { parent_id: "section", position: 2 }),
        createItem("after", { parent_id: "section", position: 3 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: "anchor",
        rows: [createRow("Pasted A"), createRow("Pasted B")],
      });
    });

    expect(mocks.batchEstimateOperations.mock.calls[0]?.[2]).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ position: 4 }) }),
      expect.objectContaining({ data: expect.objectContaining({ position: 5 }) }),
    ]);
    expect(mocks.reorderEstimateItems).toHaveBeenCalledWith(
      "version-1",
      "section",
      ["before", "anchor", "created-1", "created-2", "after"]
    );
    expect(itemOrder(harness.getItems())).toEqual([
      { id: "before", parentId: "section", position: 1 },
      { id: "anchor", parentId: "section", position: 2 },
      { id: "after", parentId: "section", position: 5 },
      { id: "created-1", parentId: "section", position: 3 },
      { id: "created-2", parentId: "section", position: 4 },
    ]);
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledWith(false);
  });

  it("reloads and rejects when post-anchor reorder fails", async () => {
    mocks.reorderEstimateItems.mockRejectedValueOnce(
      new Error("reorder unavailable")
    );
    const harness = createHarness({
      items: [
        createItem("anchor", { parent_id: "section", position: 1 }),
        createItem("after", { parent_id: "section", position: 2 }),
      ],
    });

    await act(async () => {
      await expect(
        harness.result.current.actions.pasteRows({
          anchorRowId: "anchor",
          rows: [createRow("Pasted")],
        })
      ).rejects.toThrow("public:reorder unavailable");
    });

    expect(harness.reloadItems).toHaveBeenCalledTimes(1);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorPasteController batching", () => {
  it("chains version tokens across chunks larger than 100 operations", async () => {
    const harness = createHarness();
    const rows = Array.from({ length: 101 }, (_, index) =>
      createRow(`Pasted ${index + 1}`)
    );

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows,
      });
    });

    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(2);
    expect(mocks.batchEstimateOperations.mock.calls[0]?.[0]).toBe("version-1");
    expect(mocks.batchEstimateOperations.mock.calls[0]?.[1]).toBe(
      "token-initial"
    );
    expect(mocks.batchEstimateOperations.mock.calls[0]?.[2]).toHaveLength(100);
    expect(mocks.batchEstimateOperations.mock.calls[1]?.[0]).toBe("version-1");
    expect(mocks.batchEstimateOperations.mock.calls[1]?.[1]).toBe("token-1");
    expect(mocks.batchEstimateOperations.mock.calls[1]?.[2]).toHaveLength(1);
    expect(
      (mocks.batchEstimateOperations.mock.calls[1]?.[2] as CreateOperation[])[0]
        ?.data.position
    ).toBe(101);
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-2");
    expect(harness.getItems()).toHaveLength(101);
    expect(mocks.reorderEstimateItems).not.toHaveBeenCalled();
  });

  it("deletes creations from completed chunks when a later chunk fails", async () => {
    mocks.batchEstimateOperations.mockReset();
    mocks.batchEstimateOperations.mockImplementationOnce(
      async (
        versionId: string,
        _token: string,
        operations: CreateOperation[]
      ) =>
        makeBatchResult({
          versionId,
          updatedAt: "token-first-chunk",
          operations,
        })
    );
    mocks.batchEstimateOperations.mockResolvedValueOnce({
      committed: false,
      versionToken: { id: "version-1", updated_at: "token-first-chunk" },
      results: [
        {
          index: 0,
          op: "create",
          status: "error",
          message: "second chunk failed",
        },
      ],
    });
    const harness = createHarness();
    const rows = Array.from({ length: 101 }, (_, index) =>
      createRow(`Pasted ${index + 1}`)
    );

    await act(async () => {
      await expect(
        harness.result.current.actions.pasteRows({
          anchorRowId: null,
          rows,
        })
      ).rejects.toThrow("public:second chunk failed");
    });

    expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(2);
    expect(mocks.batchEstimateOperations.mock.calls[1]?.[1]).toBe(
      "token-first-chunk"
    );
    expect(mocks.deleteEstimateItem).toHaveBeenCalledTimes(100);
    expect(mocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      1,
      "version-1",
      "created-1"
    );
    expect(mocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      100,
      "version-1",
      "created-100"
    );
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.triggerVersionReload).toHaveBeenCalledTimes(1);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("delegates a 409 without wrapping the conflict error", async () => {
    const conflict = Object.assign(new Error("version conflict"), {
      status: 409,
    });
    mocks.batchEstimateOperations.mockReset().mockRejectedValueOnce(conflict);
    const harness = createHarness({ conflictHandled: true });

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("Pasted")],
      });
    });

    expect(harness.handleVersionConflict).toHaveBeenCalledWith(conflict, {
      persistDraft: true,
    });
    expect(harness.reportError).toHaveBeenCalledWith(null);
    expect(harness.reportError).not.toHaveBeenCalledWith(
      "public:version conflict"
    );
    expect(harness.triggerVersionReload).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});

describe("useEstimateEditorPasteController history", () => {
  it("ignores a recreated paste result after its history scope changes", async () => {
    const harness = createHarness();

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("Pasted")],
      });
    });

    const command = readHistoryCommand(harness.pushHistoryCommand);
    const deferred = createDeferred<{
      idMap: Map<string, string>;
      createdItems: EstimateItem[];
    }>();
    harness.recreateItemsFromSnapshots.mockReturnValueOnce(deferred.promise);
    harness.setItems.mockClear();
    mocks.reorderEstimateItems.mockClear();
    let isCurrentScope = true;
    let redoPromise!: Promise<void>;

    act(() => {
      redoPromise = command.redo({
        isCurrentScope: () => isCurrentScope,
      });
    });
    isCurrentScope = false;
    await act(async () => {
      deferred.resolve({
        idMap: new Map([["created-1", "recreated-1"]]),
        createdItems: [createItem("recreated-1") as EstimateItem],
      });
      await redoPromise;
    });

    expect(harness.setItems).not.toHaveBeenCalled();
    expect(mocks.reorderEstimateItems).not.toHaveBeenCalled();
  });

  it("remaps inserted ids across redo and deletes the remapped ids on the next undo", async () => {
    const harness = createHarness({
      items: [
        createItem("anchor", { parent_id: null, position: 1 }),
        createItem("tail", { parent_id: null, position: 2 }),
      ],
    });

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: "anchor",
        rows: [createRow("Pasted")],
      });
    });

    const command = readHistoryCommand(harness.pushHistoryCommand);
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      1,
      "version-1",
      null,
      ["anchor", "created-1", "tail"]
    );

    await act(async () => {
      await command.undo();
    });

    expect(mocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      1,
      "version-1",
      "created-1"
    );
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      2,
      "version-1",
      null,
      ["anchor", "tail"]
    );

    const recreated = createItem("recreated-1", {
      parent_id: null,
      position: 3,
      title: "Pasted",
    }) as EstimateItem;
    harness.recreateItemsFromSnapshots.mockResolvedValueOnce({
      idMap: new Map([["created-1", "recreated-1"]]),
      createdItems: [recreated],
    });

    await act(async () => {
      await command.redo();
    });

    expect(harness.recreateItemsFromSnapshots).toHaveBeenCalledWith(
      "version-1",
      [expect.objectContaining({ id: "created-1", title: "Pasted" })]
    );
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      3,
      "version-1",
      null,
      ["anchor", "recreated-1", "tail"]
    );

    await act(async () => {
      await command.undo();
    });

    expect(mocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      2,
      "version-1",
      "recreated-1"
    );
    expect(harness.getItems().map((item) => item.id)).toEqual([
      "anchor",
      "tail",
    ]);
  });
});

describe("useEstimateEditorPasteController route races", () => {
  it("ignores a late batch response after the active version changes", async () => {
    const deferred = createDeferred<ReturnType<typeof makeBatchResult>>();
    mocks.batchEstimateOperations.mockReset().mockReturnValueOnce(deferred.promise);
    const harness = createHarness();
    let pastePromise!: Promise<void>;

    act(() => {
      pastePromise = harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("Late row")],
      });
    });

    await waitFor(() => {
      expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1);
    });
    harness.setVersion(createVersion("version-2"));
    await act(async () => {
      deferred.resolve(
        makeBatchResult({
          updatedAt: "late-token",
          operations: [
            {
              op: "create",
              data: {
                version_id: "version-1",
                parent_id: null,
                item_type: "line",
                position: 1,
                title: "Late row",
              },
            },
          ],
        })
      );
      await pastePromise;
    });

    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(mocks.reorderEstimateItems).not.toHaveBeenCalled();
    expect(mocks.deleteEstimateItem).not.toHaveBeenCalled();
  });
});
