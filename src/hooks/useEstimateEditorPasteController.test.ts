// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batchEstimateOperations: vi.fn(),
  commitEstimateV3Operations: vi.fn(),
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

vi.mock("@/lib/estimates/v3-editor-writer", () => ({
  commitEstimateV3Operations: mocks.commitEstimateV3Operations,
}));

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorPasteController } from "@/hooks/useEstimateEditorPasteController";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";
import type { ClipboardPreviewValues } from "@/lib/estimates/clipboard";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateItemInsertPayload,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import type { EstimateV3EditorWriter } from "@/lib/estimates/v3-editor-writer";

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
    version_id: "627ef080-0001-4000-8000-000000000001",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: id,
    ...overrides,
  } as EditorEstimateItem;
}

function createVersion(id = "627ef080-0001-4000-8000-000000000001"): EstimateVersionRow {
  return {
    id,
    updated_at: id === "627ef080-0001-4000-8000-000000000001" ? "token-initial" : `${id}-token`,
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
    h_mo_per_unit: null,
    control_unit_price: null,
    hourly_rate: null,
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
      id: input.versionId ?? "627ef080-0001-4000-8000-000000000001",
      updated_at: input.updatedAt,
    },
    results: input.operations.map((operation, index) => ({
      index,
      op: "create" as const,
      status: "ok" as const,
      data: {
        item: createItem(`created-${idOffset + index + 1}`, { ...operation.data, version_id: input.versionId ?? "627ef080-0001-4000-8000-000000000001" }),
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
  document?: EstimateEditorDocument;
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isLaborSplitEnabled?: boolean;
  settings?: {
    margin_multiplier: number;
    tax_rate_bp: number;
    contractor_role?: string;
  } | null;
  conflictHandled?: boolean;
  v3Writer?: EstimateV3EditorWriter;
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
      if (input?.document) input.document.setDraftItems(update);
      else items = typeof update === "function" ? update(items) : update;
    }
  );

  const rendered = renderHook(() =>
    useEstimateEditorPasteController({
      document: input?.document,
      settings:
        input && "settings" in input
          ? (input.settings ?? null)
          : { margin_multiplier: 1.2, tax_rate_bp: 2000 },
      isLaborSplitEnabled: input?.isLaborSplitEnabled ?? false,
      isMutationBlocked: false,
      mutationBlockedMessage: "Mutation interdite.",
      supplyTypeIdByLowerName: new Map([["acier", "supply-steel"]]),
      getItemsSnapshot: () => input?.document?.getSnapshot().items ?? items,
      getVersionSnapshot: () => input?.document?.getSnapshot().version ?? version,
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
      v3Writer: input?.v3Writer,
    })
  );

  return {
    ...rendered,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    getItems: () => input?.document?.getSnapshot().items ?? items,
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
  mocks.deleteEstimateItem.mockReset().mockImplementation(async (id: string, itemId: string) => ({ versionToken: { id, updated_at: `token-${++generatedTokenCount}` }, deletedIds: [itemId] }));
  mocks.reorderEstimateItems.mockReset().mockImplementation(async (id: string) => ({ versionToken: { id, updated_at: `token-${++generatedTokenCount}` } }));
  mocks.commitEstimateV3Operations.mockReset().mockImplementation(async () => ({
    id: "627ef080-0001-4000-8000-000000000001",
    updated_at: `token-${++generatedTokenCount}`,
  }));
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
});

describe("useEstimateEditorPasteController anchors and payloads", () => {
  it("2.8: stores pasted hours per unit on a v1/v2 as line hours h/u × Q (P-16)", async () => {
    const harness = createHarness({ items: [] });

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("O1", { quantity: 20, unit: "ml", h_mo: null, h_mo_per_unit: 1.991, control_unit_price: 174.59 })],
      });
    });

    expect(mocks.computeEstimateLineValues).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: 20, h_mo: 39.82 }),
      expect.anything()
    );
  });

  it("keeps the nominal line rate but computes pasted line tax at zero under reverse charge", async () => {
    const harness = createHarness({
      settings: {
        margin_multiplier: 1.2,
        tax_rate_bp: 2000,
        contractor_role: "subcontractor",
      },
    });

    await act(async () => {
      await harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("Ligne autoliquidée", { unit_price_ht: 100 })],
      });
    });

    expect(mocks.computeEstimateLineValues).toHaveBeenCalledWith(
      expect.objectContaining({ tax_rate_bp: 2000 }),
      expect.objectContaining({ taxRateBp: 0 })
    );
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
    expect(mocks.batchEstimateOperations.mock.calls[0]?.[0]).toBe("627ef080-0001-4000-8000-000000000001");
    expect(mocks.batchEstimateOperations.mock.calls[0]?.[1]).toBe(
      "token-initial"
    );
    expect(mocks.batchEstimateOperations.mock.calls[0]?.[2]).toHaveLength(100);
    expect(mocks.batchEstimateOperations.mock.calls[1]?.[0]).toBe("627ef080-0001-4000-8000-000000000001");
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
    let redoPromise!: Promise<void | boolean>;

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
      "627ef080-0001-4000-8000-000000000001",
      null,
      ["anchor", "created-1", "tail"]
    );

    await act(async () => {
      await command.undo();
    });

    expect(mocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      1,
      "627ef080-0001-4000-8000-000000000001",
      "created-1"
    );
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      2,
      "627ef080-0001-4000-8000-000000000001",
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
      "627ef080-0001-4000-8000-000000000001",
      [expect.objectContaining({ id: "created-1", title: "Pasted" })]
    );
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      3,
      "627ef080-0001-4000-8000-000000000001",
      null,
      ["anchor", "recreated-1", "tail"]
    );

    await act(async () => {
      await command.undo();
    });

    expect(mocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      2,
      "627ef080-0001-4000-8000-000000000001",
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
    let pastePromise!: Promise<void | boolean>;

    act(() => {
      pastePromise = harness.result.current.actions.pasteRows({
        anchorRowId: null,
        rows: [createRow("Late row")],
      });
    });

    await waitFor(() => {
      expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1);
    });
    harness.setVersion(createVersion("627ef080-0001-4000-8000-000000000002"));
    await act(async () => {
      deferred.resolve(
        makeBatchResult({
          updatedAt: "late-token",
          operations: [
            {
              op: "create",
              data: {
                version_id: "627ef080-0001-4000-8000-000000000001",
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

// Sub-lot 2.8, rule 2: a paste into a v3 goes through the v3 batch writer, its reorder and its undo included.
// Isolation exception: undoing 101 pasted lines (batches of 100) and the payload keys, too costly in a journey;
// IO04 and V3E13 paste into a v3 grid.
describe("useEstimateEditorPasteController v3 (2.8)", () => {
  function createV3Writer() {
    let deletions = 0;
    return {
      deleteItems: vi.fn(async () => ({ id: "627ef080-0001-4000-8000-000000000001", updated_at: `token-delete-${++deletions}` })),
      updateItems: vi.fn(),
      buildInsertPayload: vi.fn(),
      buildUpdatePayload: vi.fn(),
    } as unknown as EstimateV3EditorWriter & { deleteItems: ReturnType<typeof vi.fn> };
  }

  it("undoes 101 pasted lines in v3 batches of at most 100 deletions", async () => {
    const v3Writer = createV3Writer();
    const harness = createHarness({ v3Writer });
    const rows = Array.from({ length: 101 }, (_, index) => createRow(`Ligne ${index + 1}`, { unit: "u" }));

    await act(async () => {
      await harness.result.current.actions.pasteRows({ anchorRowId: null, rows });
    });
    await act(async () => {
      await readHistoryCommand(harness.pushHistoryCommand).undo();
    });

    expect(v3Writer.deleteItems.mock.calls.map((call) => (call[2] as string[]).length)).toEqual([100, 1]);
    expect(mocks.deleteEstimateItem).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).toHaveBeenLastCalledWith("token-delete-2");
    expect(harness.getItems()).toEqual([]);
  });
});


describe("document-owned paste receipts", () => {
  function setupDocument() {
    const wire = createEstimateEditorResponseFixture();
    wire.version.updated_at = "2026-10-28T10:00:00.123456Z";
    wire.items.push({ ...wire.items[0], id: "55555555-5555-4555-8555-555555555555", position: 2 });
    const data = parseEstimateEditorData(wire, wire.version.id);
    const document = new EstimateEditorDocument({ actorId: "actor-1", tenantId: data.version.tenant_id, versionId: data.version.id });
    document.acceptRead(prepareEstimateEditorRead(data, false));
    const harness = createHarness({ document, version: data.version });
    const reread = (items: EstimateItem[], updatedAt: string) => document.acceptRead(prepareEstimateEditorRead({
      ...data, version: { ...data.version, updated_at: updatedAt },
      items: items.map((item) => ({ ...item, source_metadata: {} })),
    }, false));
    mocks.batchEstimateOperations.mockImplementation(async (versionId: string, _token: string, operations: CreateOperation[]) => {
      const result = makeBatchResult({ versionId, updatedAt: "2026-10-28T10:00:00.123457Z", operations });
      result.results.forEach((entry) => {
        entry.data.item = { ...data.items[0], ...entry.data.item, tenant_id: data.version.tenant_id, updated_at: result.versionToken.updated_at };
      });
      return result;
    });
    return { document, data, harness, reread };
  }

  it("keeps a newer full read when the paste reorder receipt arrives late", async () => {
    const { document, data, harness, reread } = setupDocument();
    const response = createDeferred<{ versionToken: { id: string; updated_at: string } }>();
    mocks.reorderEstimateItems.mockReturnValueOnce(response.promise);
    let completion!: Promise<void | boolean>;
    act(() => { completion = harness.result.current.actions.pasteRows({ anchorRowId: data.items[0].id, rows: [createRow("Collée")] }); });
    await waitFor(() => expect(mocks.reorderEstimateItems).toHaveBeenCalledTimes(1));
    expect(document.getSnapshot().confirmedItems).toHaveLength(3);
    const newerItems = document.getSnapshot().confirmedItems.map((item) => ({ ...item, title: `Récent ${item.title}` }));
    act(() => { reread(newerItems, "2026-10-28T10:00:00.123459Z"); });
    await act(async () => {
      response.resolve({ versionToken: { id: data.version.id, updated_at: "2026-10-28T10:00:00.123458Z" } });
      await completion;
    });
    expect(document.getSnapshot().confirmedItems).toEqual(newerItems);
    expect(document.getSnapshot().items).toMatchObject(newerItems);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123459Z");
    expect(document.getSnapshot().itemOperationCount).toBe(0);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
  });

  it("keeps a row present in a newer read when an undo deletion receipt is stale", async () => {
    const { document, data, harness, reread } = setupDocument();
    await act(async () => { await harness.result.current.actions.pasteRows({ anchorRowId: null, rows: [createRow("Collée")] }); });
    const confirmedItems = document.getSnapshot().confirmedItems;
    expect(confirmedItems).toHaveLength(3);
    const response = createDeferred<{ versionToken: { id: string; updated_at: string }; deletedIds: string[] }>();
    mocks.deleteEstimateItem.mockReturnValueOnce(response.promise);
    const command = readHistoryCommand(harness.pushHistoryCommand);
    let completion!: Promise<void | boolean>;
    act(() => { completion = command.undo(); });
    act(() => { reread(confirmedItems, "2026-10-28T10:00:00.123459Z"); });
    await act(async () => {
      response.resolve({ versionToken: { id: data.version.id, updated_at: "2026-10-28T10:00:00.123458Z" }, deletedIds: ["created-1"] });
      expect(await completion).toBe(false);
    });
    expect(document.getSnapshot().confirmedItems).toEqual(confirmedItems);
    expect(document.getSnapshot().items).toMatchObject(confirmedItems);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123459Z");
    expect(document.getSnapshot().itemOperationCount).toBe(0);
  });

  it("does not install created rows from a batch older than the confirmed read", async () => {
    const { document, data, harness, reread } = setupDocument();
    const response = createDeferred<ReturnType<typeof makeBatchResult>>();
    mocks.batchEstimateOperations.mockReturnValueOnce(response.promise);
    let completion!: Promise<void | boolean>;
    act(() => { completion = harness.result.current.actions.pasteRows({ anchorRowId: null, rows: [createRow("Collée")] }); });
    await waitFor(() => expect(mocks.batchEstimateOperations).toHaveBeenCalledTimes(1));
    act(() => { reread(data.items, "2026-10-28T10:00:00.123459Z"); });
    const operations = mocks.batchEstimateOperations.mock.calls[0][2] as CreateOperation[];
    await act(async () => {
      response.resolve(makeBatchResult({ versionId: data.version.id, updatedAt: "2026-10-28T10:00:00.123458Z", operations }));
      await completion;
    });
    expect(document.getSnapshot().confirmedItems).toEqual(data.items);
    expect(document.getSnapshot().items).toMatchObject(data.items);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});
