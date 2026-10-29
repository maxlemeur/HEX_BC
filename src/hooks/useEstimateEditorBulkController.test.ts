// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEstimateEditorHistoryController, type EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { useEstimateEditorBulkController } from "@/hooks/useEstimateEditorBulkController";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import { withRederivedFoProvision } from "@/lib/estimates/fo-provision";
import type { EstimateV3EditorWriter } from "@/lib/estimates/v3-editor-writer";

const clientMocks = vi.hoisted(() => ({
  bulkUpdateEstimateItems: vi.fn(),
  deleteEstimateItem: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  bulkUpdateEstimateItems: clientMocks.bulkUpdateEstimateItems,
  deleteEstimateItem: clientMocks.deleteEstimateItem,
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createVersion(
  overrides: Partial<EstimateVersionRow> = {}
): EstimateVersionRow {
  return {
    id: "version-1",
    updated_at: "token-initial",
    ...overrides,
  } as EstimateVersionRow;
}

function createLine(
  id: string,
  overrides: Partial<EstimateItem> = {}
): EstimateItem {
  return {
    h_mo_atelier_per_unit: null,
    h_mo_chantier_per_unit: null,
    h_mo_per_unit: null,
    line_nature: null,
    pricing_status: "priced",
    product_id: null,
    snapshot_gross_fo_ht_cents: null,
    snapshot_gross_ht_cents: null,
    unit_code: null,
    id,
    created_at: "2026-07-15T08:00:00.000Z",
    updated_at: "2026-07-15T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: "section-1",
    item_type: "line",
    position: 1,
    title: id,
    aid: null,
    description: null,
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    fo_provision: 1,
    h_mo: 1,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: 0,
    k_mo_atelier: 1,
    labor_role_atelier_id: null,
    h_mo_chantier: 0,
    k_mo_chantier: 1,
    labor_role_chantier_id: null,
    pu_ht_cents: 1000,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    line_total_ht_cents: 1000,
    line_tax_cents: 200,
    line_total_ttc_cents: 1200,
    ...overrides,
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

// Stands for the editor's persisted-totals calculation: the sums of the rows it receives, so that
// a call on the wrong rows sends wrong totals.
function totalsOf(rows: EditorEstimateItem[]) {
  const lines = rows.filter((row) => row.item_type === "line");
  const sum = (
    key: "line_total_ht_cents" | "line_tax_cents" | "line_total_ttc_cents"
  ) => lines.reduce((total, row) => total + (row[key] ?? 0), 0);
  return {
    total_ht_cents: sum("line_total_ht_cents"),
    total_tax_cents: sum("line_tax_cents"),
    total_ttc_cents: sum("line_total_ttc_cents"),
  };
}

function createBulkResult(updatedAt: string, updatedCount = 1) {
  return {
    updatedCount,
    versionToken: {
      id: "version-1",
      updated_at: updatedAt,
    },
  };
}

type HarnessInput = {
  document?: EstimateEditorDocument;
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isMutationBlocked?: boolean;
  isLaborSplitEnabled?: boolean;
  v3Writer?: EstimateV3EditorWriter;
};

function createHarness(input: HarnessInput = {}) {
  let items = input.items ?? [];
  let version =
    "version" in input ? (input.version ?? null) : createVersion();

  const setItems = vi.fn(
    (
      update:
        | EditorEstimateItem[]
        | ((previous: EditorEstimateItem[]) => EditorEstimateItem[])
    ) => {
      if (input.document) input.document.setDraftItems(update);
      else items = typeof update === "function" ? update(items) : update;
    }
  );
  const setTotalsOutOfSync = vi.fn();
  const reportError = vi.fn();
  const resolveErrorMessage = vi.fn(
    (message: string) => `public:${message}`
  );
  const normalizeLine = vi.fn((item: EditorEstimateItem) => item);
  const computeVersionTotalsPatch = vi.fn(totalsOf);
  const applyVersionToken = vi.fn((updatedAt: string) => {
    if (version) {
      version = { ...version, updated_at: updatedAt };
    }
  });
  const markItemsSynced = vi.fn();
  const ensureGroupedActionCanProceed = vi.fn().mockResolvedValue(true);
  const handleVersionConflict = vi.fn().mockReturnValue(false);
  const triggerVersionReload = vi.fn();
  const pushHistoryCommand = vi.fn();
  const recreateItemsFromSnapshots = vi.fn().mockResolvedValue({
    idMap: new Map<string, string>(),
    createdItems: [],
  });
  const siblingOrderSnapshots: Array<Map<string | null, string[]>> = [];
  const applySiblingOrder = vi.fn(
    async (
      _versionId: string,
      remainingParents: Map<string | null, string[]>,
      _idMap?: Map<string, string>,
      isCurrentScope: () => boolean = () => true
    ) => {
      if (!isCurrentScope()) return;
      // The real helper consumes each acknowledged parent. Keep a copy before
      // consumption: Vitest records the original, mutable Map by reference.
      siblingOrderSnapshots.push(new Map(
        Array.from(remainingParents, ([parentId, ids]) => [parentId, [...ids]])
      ));
      remainingParents.clear();
    }
  );
  const reloadItems = vi.fn().mockResolvedValue(undefined);

  const rendered = renderHook(() =>
    useEstimateEditorBulkController({
      document: input.document,
      isMutationBlocked: input.isMutationBlocked ?? false,
      mutationBlockedMessage: "Mutation interdite.",
      isLaborSplitEnabled: input.isLaborSplitEnabled ?? true,
      getItemsSnapshot: () => input.document?.getSnapshot().items ?? items,
      getVersionSnapshot: () => input.document?.getSnapshot().version ?? version,
      setItems,
      setTotalsOutOfSync,
      reportError,
      resolveErrorMessage,
      normalizeLine,
      computeVersionTotalsPatch,
      applyVersionToken,
      markItemsSynced,
      ensureGroupedActionCanProceed,
      handleVersionConflict,
      triggerVersionReload,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
      applySiblingOrder,
      reloadItems,
      v3Writer: input.v3Writer,
    })
  );

  return {
    ...rendered,
    getItems: () => input.document?.getSnapshot().items ?? items,
    getVersion: () => input.document?.getSnapshot().version ?? version,
    setItems,
    setTotalsOutOfSync,
    reportError,
    resolveErrorMessage,
    normalizeLine,
    computeVersionTotalsPatch,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    handleVersionConflict,
    triggerVersionReload,
    pushHistoryCommand,
    recreateItemsFromSnapshots,
    applySiblingOrder,
    siblingOrderSnapshots,
    reloadItems,
  };
}

function readHistoryCommand(
  pushHistoryCommand: ReturnType<typeof vi.fn>,
  index = 0
): EstimateEditorHistoryCommand {
  const command = pushHistoryCommand.mock.calls[index]?.[0];
  if (!command) throw new Error("Expected an editor history command.");
  return command as EstimateEditorHistoryCommand;
}

beforeEach(() => {
  clientMocks.bulkUpdateEstimateItems.mockReset().mockResolvedValue(
    createBulkResult("token-next")
  );
  clientMocks.deleteEstimateItem.mockReset().mockImplementation(async (versionId: string, id: string) => ({
    versionToken: { id: versionId, updated_at: "token-delete" }, deletedIds: [id],
  }));
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorBulkController", () => {
  it("lets the grouped-action barrier block every bulk mutation", async () => {
    const line = createLine("line-1");
    const harness = createHarness({ items: [line] });
    harness.ensureGroupedActionCanProceed.mockResolvedValue(false);

    await act(async () => {
      await harness.result.current.actions.applyBulkMajoration([line.id], 1.5);
      await harness.result.current.actions.bulkDeleteLines([line.id]);
      await harness.result.current.actions.bulkMoveLines([line.id], "target");
      await harness.result.current.actions.bulkSetCategory(
        [line.id],
        "category-new"
      );
      await harness.result.current.actions.bulkSetLaborRole(
        [line.id],
        "role-new"
      );
    });

    expect(
      harness.ensureGroupedActionCanProceed.mock.calls.map(([label]) => label)
    ).toEqual([
      "appliquer la majoration en lot",
      "supprimer les lignes sélectionnées",
      "déplacer les lignes sélectionnées",
      "appliquer la catégorie en lot",
      "appliquer le rôle MO en lot",
    ]);
    expect(harness.getItems()).toEqual([line]);
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.normalizeLine).not.toHaveBeenCalled();
    expect(clientMocks.bulkUpdateEstimateItems).not.toHaveBeenCalled();
    expect(clientMocks.deleteEstimateItem).not.toHaveBeenCalled();
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("normalizes majoration and labor role before persisting tokens and history", async () => {
    const line = createLine("line-1");
    const harness = createHarness({ items: [line] });
    harness.normalizeLine.mockImplementation((item) => ({
      ...item,
      pu_ht_cents:
        item.labor_role_id === "role-new"
          ? 2800
          : Math.round(1000 * (item.h_mo_majoration ?? 1)),
      line_total_ht_cents:
        item.labor_role_id === "role-new"
          ? 2800
          : Math.round(1000 * (item.h_mo_majoration ?? 1)),
    }));
    clientMocks.bulkUpdateEstimateItems
      .mockResolvedValueOnce(createBulkResult("token-majoration"))
      .mockResolvedValueOnce(createBulkResult("token-role"));

    await act(async () => {
      await harness.result.current.actions.applyBulkMajoration([line.id], 1.5);
    });

    expect(harness.normalizeLine).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: line.id,
        h_mo_majoration: 1.5,
      })
    );
    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenNthCalledWith(
      1,
      "version-1",
      "token-initial",
      [
        expect.objectContaining({
          id: line.id,
          updates: expect.objectContaining({
            h_mo_majoration: 1.5,
            pu_ht_cents: 1500,
            line_total_ht_cents: 1500,
          }),
        }),
      ],
      { total_ht_cents: 1500, total_tax_cents: 200, total_ttc_cents: 1200 }
    );
    expect(harness.getItems()[0]).toMatchObject({
      h_mo_majoration: 1.5,
      pu_ht_cents: 1500,
    });

    await act(async () => {
      await harness.result.current.actions.bulkSetLaborRole(
        [line.id],
        "role-new"
      );
    });

    expect(harness.normalizeLine).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        labor_role_id: "role-new",
        labor_role_atelier_id: "role-new",
        labor_role_chantier_id: "role-new",
      })
    );
    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenNthCalledWith(
      2,
      "version-1",
      "token-majoration",
      [
        expect.objectContaining({
          id: line.id,
          updates: expect.objectContaining({
            labor_role_id: "role-new",
            labor_role_atelier_id: "role-new",
            labor_role_chantier_id: "role-new",
            pu_ht_cents: 2800,
            line_total_ht_cents: 2800,
          }),
        }),
      ],
      { total_ht_cents: 2800, total_tax_cents: 200, total_ttc_cents: 1200 }
    );
    expect(harness.applyVersionToken.mock.calls.map(([token]) => token)).toEqual(
      ["token-majoration", "token-role"]
    );
    expect(harness.getVersion()?.updated_at).toBe("token-role");
    expect(harness.pushHistoryCommand.mock.calls.map(([command]) => command.label))
      .toEqual(["bulk-majoration", "bulk-set-labor-role"]);
  });

  it("applies, undoes and redoes a bulk category with fresh tokens", async () => {
    const line = createLine("line-1", { category_id: "category-old" });
    const harness = createHarness({ items: [line] });
    clientMocks.bulkUpdateEstimateItems
      .mockResolvedValueOnce(createBulkResult("token-category-apply"))
      .mockResolvedValueOnce(createBulkResult("token-category-undo"))
      .mockResolvedValueOnce(createBulkResult("token-category-redo"));

    await act(async () => {
      await harness.result.current.actions.bulkSetCategory(
        [line.id],
        "category-new"
      );
    });
    expect(harness.getItems()[0].category_id).toBe("category-new");
    const command = readHistoryCommand(harness.pushHistoryCommand);
    expect(command.label).toBe("bulk-set-category");

    await act(async () => {
      await command.undo();
    });
    expect(harness.getItems()[0].category_id).toBe("category-old");

    await act(async () => {
      await command.redo();
    });
    expect(harness.getItems()[0].category_id).toBe("category-new");

    expect(
      clientMocks.bulkUpdateEstimateItems.mock.calls.map((call) => call[1])
    ).toEqual([
      "token-initial",
      "token-category-apply",
      "token-category-undo",
    ]);
    expect(harness.applyVersionToken.mock.calls.map(([token]) => token)).toEqual(
      [
        "token-category-apply",
        "token-category-undo",
        "token-category-redo",
      ]
    );
    expect(
      harness.computeVersionTotalsPatch.mock.calls.map(([rows]) =>
        rows.map((row) => row.category_id)
      )
    ).toEqual([["category-new"], ["category-old"], ["category-new"]]);
  });

  it("keeps the live FO provision of a v3 line when a bulk edit is undone or redone (TI-534)", async () => {
    const TUBE = "8f9a1b2c-0000-4000-8000-000000000041";
    const legacy = createLine("line-1", { category_id: "category-old", supply_type_id: TUBE, fo_provision: 1 });
    const v3Writer: EstimateV3EditorWriter = {
      deleteItems: vi.fn(),
      updateItems: vi.fn().mockResolvedValue({ id: "version-1", updated_at: "token-v3" }),
      buildInsertPayload: vi.fn(),
      buildUpdatePayload: vi.fn((item: EstimateItem) => ({ category_id: item.category_id })),
    };
    const harness = createHarness({ items: [legacy], version: createVersion({ calc_engine_version: 3 }), v3Writer });
    harness.normalizeLine.mockImplementation((item) => withRederivedFoProvision(
      harness.getItems().find((candidate) => candidate.id === item.id), item, new Map([[TUBE, 1.03]])));

    await act(async () => {
      await harness.result.current.actions.bulkSetCategory([legacy.id], "category-new");
    });
    const command = readHistoryCommand(harness.pushHistoryCommand);
    // A Type FO change and its undo in between re-derived the tube's provision, on the server as in the editor.
    act(() => {
      harness.setItems((previous) => previous.map((item) => ({ ...item, fo_provision: 1.03 })));
    });

    await act(async () => {
      await command.undo();
    });
    expect(harness.getItems()[0]).toMatchObject({ category_id: "category-old", fo_provision: 1.03 });
    await act(async () => {
      await command.redo();
    });
    expect(harness.getItems()[0]).toMatchObject({ category_id: "category-new", fo_provision: 1.03 });
  });

  it("sends the totals of the rows after each write with the action, its undo and its redo", async () => {
    const target = createLine("line-target");
    const other = createLine("line-other", {
      position: 2,
      line_total_ht_cents: 300,
      line_tax_cents: 60,
      line_total_ttc_cents: 360,
    });
    const harness = createHarness({ items: [target, other] });
    harness.normalizeLine.mockImplementation((item) => ({
      ...item,
      line_total_ht_cents: 1500,
      line_tax_cents: 300,
      line_total_ttc_cents: 1800,
    }));
    const recalculated = {
      total_ht_cents: 1801,
      total_tax_cents: 360,
      total_ttc_cents: 2161,
    };
    clientMocks.bulkUpdateEstimateItems
      .mockResolvedValueOnce(createBulkResult("token-apply"))
      .mockResolvedValueOnce(createBulkResult("token-undo"))
      .mockResolvedValueOnce({
        ...createBulkResult("token-redo"),
        totals: recalculated,
      });

    await act(async () => {
      await harness.result.current.actions.applyBulkMajoration([target.id], 1.5);
    });
    const command = readHistoryCommand(harness.pushHistoryCommand);
    await act(async () => {
      await command.undo();
    });
    await act(async () => {
      await command.redo();
    });

    // Every row of the editor, the target as each write leaves it.
    expect(
      harness.computeVersionTotalsPatch.mock.calls.map(([rows]) =>
        rows.map((row) => [row.id, row.h_mo_majoration, row.line_total_ht_cents])
      )
    ).toEqual([
      [
        ["line-target", 1.5, 1500],
        ["line-other", 1, 300],
      ],
      [
        ["line-target", 1, 1000],
        ["line-other", 1, 300],
      ],
      [
        ["line-target", 1.5, 1500],
        ["line-other", 1, 300],
      ],
    ]);
    const applied = {
      total_ht_cents: 1800,
      total_tax_cents: 360,
      total_ttc_cents: 2160,
    };
    const restored = {
      total_ht_cents: 1300,
      total_tax_cents: 260,
      total_ttc_cents: 1560,
    };
    expect(
      clientMocks.bulkUpdateEstimateItems.mock.calls.map((call) => call[3])
    ).toEqual([applied, restored, applied]);
    // A v1 draft stores the patch as sent; a v2 draft returns the totals it recalculated. Only
    // the v3 writer returns a content revision.
    expect(harness.applyVersionToken.mock.calls).toEqual([
      ["token-apply", applied, undefined],
      ["token-undo", restored, undefined],
      ["token-redo", recalculated, undefined],
    ]);
  });

  it("applies, undoes and redoes a bulk move with stable selected order", async () => {
    const lineA = createLine("line-a", {
      parent_id: "source-a",
      position: 2,
    });
    const lineB = createLine("line-b", {
      parent_id: "source-b",
      position: 1,
    });
    const targetSibling = createLine("target-sibling", {
      parent_id: "target",
      position: 3,
    });
    const harness = createHarness({ items: [lineA, lineB, targetSibling] });
    clientMocks.bulkUpdateEstimateItems
      .mockResolvedValueOnce(createBulkResult("token-move-apply", 2))
      .mockResolvedValueOnce(createBulkResult("token-move-undo", 2))
      .mockResolvedValueOnce(createBulkResult("token-move-redo", 2));

    await act(async () => {
      await harness.result.current.actions.bulkMoveLines(
        [lineB.id, lineA.id],
        "target"
      );
    });
    expect(
      harness.getItems().map(({ id, parent_id, position }) => ({
        id,
        parentId: parent_id,
        position,
      }))
    ).toEqual([
      { id: "line-a", parentId: "target", position: 5 },
      { id: "line-b", parentId: "target", position: 4 },
      { id: "target-sibling", parentId: "target", position: 3 },
    ]);
    expect(
      clientMocks.bulkUpdateEstimateItems.mock.calls[0][2].map(
        (entry: { id: string }) => entry.id
      )
    ).toEqual(["line-b", "line-a"]);
    const command = readHistoryCommand(harness.pushHistoryCommand);
    expect(command.label).toBe("bulk-move-lines");

    await act(async () => {
      await command.undo();
    });
    expect(harness.getItems().slice(0, 2)).toEqual([lineA, lineB]);

    await act(async () => {
      await command.redo();
    });
    expect(harness.getItems()[0]).toMatchObject({
      id: "line-a",
      parent_id: "target",
      position: 5,
    });
    expect(harness.getItems()[1]).toMatchObject({
      id: "line-b",
      parent_id: "target",
      position: 4,
    });
    expect(
      clientMocks.bulkUpdateEstimateItems.mock.calls.map((call) => call[1])
    ).toEqual(["token-initial", "token-move-apply", "token-move-undo"]);
    // A move changes no amount: its write carries no version totals (see applyBulkLineState).
    expect(harness.computeVersionTotalsPatch).not.toHaveBeenCalled();
    expect(
      clientMocks.bulkUpdateEstimateItems.mock.calls.map((call) => call[3])
    ).toEqual([undefined, undefined, undefined]);
  });

  it.each([
    {
      name: "ordinary failure",
      error: new Error("bulk failed"),
      isConflict: false,
      expectedError: "public:bulk failed",
    },
    {
      name: "409 conflict",
      error: Object.assign(new Error("version conflict"), { status: 409 }),
      isConflict: true,
      expectedError: null,
    },
  ])(
    "rolls back an optimistic bulk update on $name",
    async ({ error, isConflict, expectedError }) => {
      const line = createLine("line-1", { category_id: "category-old" });
      const deferred = createDeferred<ReturnType<typeof createBulkResult>>();
      clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(deferred.promise);
      const harness = createHarness({ items: [line] });
      harness.handleVersionConflict.mockImplementation(
        (receivedError) => receivedError === error && isConflict
      );

      let request!: Promise<void>;
      act(() => {
        request = harness.result.current.actions.bulkSetCategory(
          [line.id],
          "category-new"
        );
      });
      await waitFor(() => {
        expect(harness.getItems()[0].category_id).toBe("category-new");
      });

      await act(async () => {
        deferred.reject(error);
        await request;
      });

      expect(harness.getItems()).toEqual([line]);
      expect(harness.handleVersionConflict).toHaveBeenCalledWith(error, {
        persistDraft: true,
      });
      if (expectedError) {
        expect(harness.reportError).toHaveBeenLastCalledWith(expectedError);
      } else {
        expect(harness.reportError).toHaveBeenCalledTimes(1);
        expect(harness.reportError).toHaveBeenCalledWith(null);
      }
      expect(harness.applyVersionToken).not.toHaveBeenCalled();
      expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    }
  );

  it("undoes and redoes a successful bulk delete with remapped ids", async () => {
    const lineA = createLine("line-a", { position: 1 });
    const survivor = createLine("line-survivor", { position: 2 });
    const lineB = createLine("line-b", { position: 3 });
    const harness = createHarness({ items: [lineA, survivor, lineB] });

    await act(async () => {
      await harness.result.current.actions.bulkDeleteLines([
        lineA.id,
        lineB.id,
      ]);
    });
    expect(harness.getItems()).toEqual([survivor]);
    expect(clientMocks.deleteEstimateItem.mock.calls).toEqual([
      ["version-1", "line-a"],
      ["version-1", "line-b"],
    ]);
    const command = readHistoryCommand(harness.pushHistoryCommand);
    expect(command.label).toBe("bulk-delete-lines");

    const recreatedLineA = createLine("line-a-new", { position: 1 });
    const recreatedLineB = createLine("line-b-new", { position: 3 });
    const idMap = new Map([
      [lineA.id, recreatedLineA.id],
      [lineB.id, recreatedLineB.id],
    ]);
    harness.recreateItemsFromSnapshots.mockResolvedValueOnce({
      idMap,
      createdItems: [recreatedLineA, recreatedLineB],
    });

    await act(async () => {
      await command.undo();
    });
    expect(harness.recreateItemsFromSnapshots).toHaveBeenCalledWith(
      "version-1",
      [lineA, lineB],
      {
        isCurrentScope: expect.any(Function),
        onProgress: expect.any(Function),
      }
    );
    const siblingOrder = harness.siblingOrderSnapshots[0];
    expect(siblingOrder.get("section-1")).toEqual([
      "line-a",
      "line-survivor",
      "line-b",
    ]);
    const remainingParents = harness.applySiblingOrder.mock.calls[0][1];
    expect(remainingParents.size).toBe(0);
    expect(harness.applySiblingOrder).toHaveBeenCalledWith(
      "version-1",
      remainingParents,
      idMap,
      expect.any(Function)
    );
    expect(new Set(harness.getItems().map((item) => item.id))).toEqual(
      new Set(["line-survivor", "line-a-new", "line-b-new"])
    );

    await act(async () => {
      await command.redo();
    });
    expect(clientMocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      3,
      "version-1",
      "line-a-new"
    );
    expect(clientMocks.deleteEstimateItem).toHaveBeenNthCalledWith(
      4,
      "version-1",
      "line-b-new"
    );
    expect(harness.getItems()).toEqual([survivor]);
  });

  it("reloads and reports a partial delete after checking for conflict", async () => {
    const lines = [
      createLine("line-a", { position: 1 }),
      createLine("line-b", { position: 2 }),
      createLine("line-c", { position: 3 }),
    ];
    const failure = new Error("second delete failed");
    clientMocks.deleteEstimateItem
      .mockResolvedValueOnce({ versionToken: { id: "version-1", updated_at: "token-delete" }, deletedIds: ["line-a"] })
      .mockRejectedValueOnce(failure);
    const harness = createHarness({ items: lines });
    harness.handleVersionConflict.mockReturnValue(false);

    await act(async () => {
      await harness.result.current.actions.bulkDeleteLines(
        lines.map((line) => line.id)
      );
    });

    expect(clientMocks.deleteEstimateItem).toHaveBeenCalledTimes(2);
    expect(harness.getItems()).toEqual(lines);
    expect(harness.handleVersionConflict).toHaveBeenCalledWith(failure, {
      persistDraft: true,
    });
    expect(harness.triggerVersionReload).toHaveBeenCalledTimes(1);
    expect(harness.reportError).toHaveBeenLastCalledWith(
      "Suppression partielle détectée (1/3) : public:second delete failed. La version a été rechargee; vérifiez les lignes puis réessayez."
    );
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});


describe("bulk receipts accepted by the document", () => {
  function documentWithLines() {
    const scope = { actorId: "actor-1", tenantId: "tenant-1", versionId: "version-1" };
    const document = new EstimateEditorDocument(scope);
    document.setConfirmedVersion({ ...createVersion({ tenant_id: scope.tenantId, calc_engine_version: 1,
      updated_at: "2026-10-28T10:00:00.123456Z" }), estimate_projects: null });
    document.acceptItems([createLine("line-a"), createLine("line-b", { position: 2 })]);
    return { document, scope };
  }

  it("ignores a stale successful bulk receipt after a newer read, including its success history", async () => {
    const { document } = documentWithLines();
    const request = createDeferred<ReturnType<typeof createBulkResult>>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(request.promise);
    const harness = createHarness({ document });
    let completion!: Promise<void>;
    act(() => { completion = harness.result.current.actions.applyBulkMajoration(["line-a"], 2); });
    await waitFor(() => expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(1));
    act(() => document.transaction(() => {
      document.setConfirmedVersion((version) => version && { ...version, updated_at: "2026-10-28T10:00:00.123458Z" });
      document.acceptItems(document.getSnapshot().confirmedItems.map((item) => item.id === "line-a" ? { ...item, h_mo_majoration: 3 } : item));
    }));
    await act(async () => { request.resolve(createBulkResult("2026-10-28T10:00:00.123457Z")); await completion; });
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123458Z");
    expect(document.getSnapshot().items[0].h_mo_majoration).toBe(3);
    expect(document.getSnapshot().confirmedItems[0].h_mo_majoration).toBe(3);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
  });

  it.each(["undo", "redo"] as const)("keeps the real history pointer when a stale %s receipt is superseded", async (direction) => {
    const { document } = documentWithLines();
    clientMocks.bulkUpdateEstimateItems.mockResolvedValueOnce(createBulkResult("2026-10-28T10:00:00.123457Z"));
    const harness = createHarness({ document });
    const history = renderHook(() => useEstimateEditorHistoryController({ scopeKey: "actor-1:tenant-1:version-1", reportError: vi.fn() }));
    await act(async () => { await harness.result.current.actions.applyBulkMajoration(["line-a"], 2); });
    act(() => { history.result.current.actions.push(readHistoryCommand(harness.pushHistoryCommand)); });
    if (direction === "redo") {
      clientMocks.bulkUpdateEstimateItems.mockResolvedValueOnce(createBulkResult("2026-10-28T10:00:00.123458Z"));
      await act(async () => { await history.result.current.actions.undo(); });
    }
    const pending = createDeferred<ReturnType<typeof createBulkResult>>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(pending.promise);
    let completed!: Promise<void>;
    act(() => { completed = history.result.current.actions[direction](); });
    await waitFor(() => expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(direction === "undo" ? 2 : 3));
    act(() => document.transaction(() => {
      document.setConfirmedVersion((version) => version && { ...version, updated_at: "2026-10-28T10:00:00.123460Z" });
      document.acceptItems(document.getSnapshot().confirmedItems.map((item) => item.id === "line-a" ? { ...item, h_mo_majoration: 4 } : item));
    }));
    await act(async () => { pending.resolve(createBulkResult("2026-10-28T10:00:00.123459Z")); await completed; });
    expect(document.getSnapshot().items[0].h_mo_majoration).toBe(4);
    expect(history.result.current.state.canUndo).toBe(direction === "undo");
    expect(history.result.current.state.canRedo).toBe(direction === "redo");
    expect(history.result.current.state.feedback).toBeNull();
  });

  it("publishes accepted rows and their token in one document notification", async () => {
    const { document } = documentWithLines();
    const request = createDeferred<ReturnType<typeof createBulkResult>>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(request.promise);
    const harness = createHarness({ document });
    let completion!: Promise<void>;
    act(() => { completion = harness.result.current.actions.applyBulkMajoration(["line-a"], 2); });
    await waitFor(() => expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(1));
    const observed: Array<{ token: string | undefined; majoration: number }> = [];
    const stop = document.subscribe(() => observed.push({ token: document.getSnapshot().version?.updated_at,
      majoration: document.getSnapshot().confirmedItems[0].h_mo_majoration }));
    await act(async () => { request.resolve(createBulkResult("2026-10-28T10:00:00.123457Z")); await completion; });
    stop();
    expect(observed).toEqual([{ token: "2026-10-28T10:00:00.123457Z", majoration: 2 }]);
  });

  it("stops a legacy multi-delete between requests when the actor changes", async () => {
    const { document, scope } = documentWithLines();
    const initial = document.getSnapshot();
    const request = createDeferred<{ versionToken: { id: string; updated_at: string }; deletedIds: string[] }>();
    clientMocks.deleteEstimateItem.mockReturnValueOnce(request.promise);
    const harness = createHarness({ document });
    let completion!: Promise<void>;
    act(() => { completion = harness.result.current.actions.bulkDeleteLines(["line-a", "line-b"]); });
    await waitFor(() => expect(clientMocks.deleteEstimateItem).toHaveBeenCalledTimes(1));
    act(() => {
      document.changeScope({ ...scope, actorId: "actor-2" });
      document.setConfirmedVersion(initial.version);
      document.acceptItems(initial.confirmedItems);
    });
    await act(async () => { request.resolve({ versionToken: { id: scope.versionId, updated_at: "2026-10-28T10:00:00.123457Z" }, deletedIds: ["line-a"] }); await completion; });
    expect(clientMocks.deleteEstimateItem).toHaveBeenCalledTimes(1);
    expect(document.getSnapshot().confirmedItems).toEqual(initial.confirmedItems);
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});
