// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorBulkController } from "@/hooks/useEstimateEditorBulkController";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

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
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  isMutationBlocked?: boolean;
  isLaborSplitEnabled?: boolean;
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
      items = typeof update === "function" ? update(items) : update;
    }
  );
  const setTotalsOutOfSync = vi.fn();
  const reportError = vi.fn();
  const resolveErrorMessage = vi.fn(
    (message: string) => `public:${message}`
  );
  const normalizeLine = vi.fn((item: EditorEstimateItem) => item);
  const applyVersionToken = vi.fn((updatedAt: string) => {
    if (version) {
      version = { ...version, updated_at: updatedAt };
    }
  });
  const ensureGroupedActionCanProceed = vi.fn().mockResolvedValue(true);
  const handleVersionConflict = vi.fn().mockReturnValue(false);
  const triggerVersionReload = vi.fn();
  const pushHistoryCommand = vi.fn();
  const recreateItemsFromSnapshots = vi.fn().mockResolvedValue({
    idMap: new Map<string, string>(),
    createdItems: [],
  });
  const applySiblingOrder = vi.fn().mockResolvedValue(undefined);
  const reloadItems = vi.fn().mockResolvedValue(undefined);

  const rendered = renderHook(() =>
    useEstimateEditorBulkController({
      isMutationBlocked: input.isMutationBlocked ?? false,
      mutationBlockedMessage: "Mutation interdite.",
      isLaborSplitEnabled: input.isLaborSplitEnabled ?? true,
      getItemsSnapshot: () => items,
      getVersionSnapshot: () => version,
      setItems,
      setTotalsOutOfSync,
      reportError,
      resolveErrorMessage,
      normalizeLine,
      applyVersionToken,
      ensureGroupedActionCanProceed,
      handleVersionConflict,
      triggerVersionReload,
      pushHistoryCommand,
      recreateItemsFromSnapshots,
      applySiblingOrder,
      reloadItems,
    })
  );

  return {
    ...rendered,
    getItems: () => items,
    getVersion: () => version,
    setItems,
    setTotalsOutOfSync,
    reportError,
    resolveErrorMessage,
    normalizeLine,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    handleVersionConflict,
    triggerVersionReload,
    pushHistoryCommand,
    recreateItemsFromSnapshots,
    applySiblingOrder,
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
  clientMocks.deleteEstimateItem.mockReset().mockResolvedValue(undefined);
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
      ]
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
      ]
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
      [lineA, lineB]
    );
    const siblingOrder = harness.applySiblingOrder.mock.calls[0][1] as Map<
      string | null,
      string[]
    >;
    expect(siblingOrder.get("section-1")).toEqual([
      "line-a",
      "line-survivor",
      "line-b",
    ]);
    expect(harness.applySiblingOrder).toHaveBeenCalledWith(
      "version-1",
      siblingOrder,
      idMap
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
      .mockResolvedValueOnce(undefined)
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
      "Suppression partielle detectee (1/3) : public:second delete failed. La version a ete rechargee; verifiez les lignes puis reessayez."
    );
    expect(harness.pushHistoryCommand).not.toHaveBeenCalled();
  });
});
