// @vitest-environment jsdom

import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import {
useCallback,
useEffect,
useRef,
useState,
type Dispatch,
type SetStateAction,
} from "react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorItemsController } from "@/hooks/useEstimateEditorItemsController";
import type {
EditorEstimateItem,
EstimateItem,
EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import { withRederivedFoProvision } from "@/lib/estimates/fo-provision";
import type { EstimateV3EditorWriter } from "@/lib/estimates/v3-editor-writer";

const mocks = vi.hoisted(() => ({
  createEstimateItem: vi.fn(),
  deleteEstimateItem: vi.fn(),
  reorderEstimateItems: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  createEstimateItem: mocks.createEstimateItem,
  deleteEstimateItem: mocks.deleteEstimateItem,
  reorderEstimateItems: mocks.reorderEstimateItems,
}));

type ControllerInput = Parameters<typeof useEstimateEditorItemsController>[0];

type HarnessProps = {
  version: EstimateVersionRow | null;
  initialItems: EditorEstimateItem[];
  isMutationBlocked?: boolean;
  reloadItemsResult?: EditorEstimateItem[];
  v3Writer?: EstimateV3EditorWriter;
};

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
    commercial_rounding_cents: null,
    discount_applied_cents: null,
    gross_ht_cents: null,
    sale_coefficient_fo: null,
    sale_coefficient_mo: null,
    id: "version-1",
    created_at: "2026-07-15T08:00:00.000Z",
    updated_at: "token-initial",
    tenant_id: "tenant-1",
    project_id: "project-1",
    version_number: 1,
    status: "draft",
    approval_status: "not_required",
    approval_summary: {},
    approval_evaluated_at: null,
    title: "Devis principal",
    date_devis: "2026-07-15",
    exclusions: null,
    validite_jours: 30,
    margin_multiplier: 1.2,
    margin_mode: "fixed",
    currency: "EUR",
    margin_bp: 2000,
    discount_bp: 0,
    discount_amount_cents: null,
    discount_mode: "simple",
    discount_steps: [],
    global_coefficient: 1,
    max_section_depth: 4,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
    total_ht_cents: 1000,
    total_tax_cents: 200,
    total_ttc_cents: 1200,
    rounding_adjustment_cents: 0,
    content_revision: 1,
    seal_hash: null,
    seal_payload_version: null,
    parent_version_id: null,
    variant_label: null,
    calc_engine_version: 1,
    contractor_role: "principal",
    ...overrides,
    calc_snapshot_content_revision:
      overrides.calc_snapshot_content_revision ?? null,
    calc_snapshot_context: overrides.calc_snapshot_context ?? null,
  };
}

function createItem(
  id = "line-1",
  overrides: Partial<EstimateItem> = {}
): EstimateItem {
  return {
    h_mo_atelier_per_unit: null,
    h_mo_chantier_per_unit: null,
    h_mo_per_unit: null,
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
    parent_id: null,
    item_type: "line",
    line_nature: "supply_only",
    position: 1,
    title: "Ligne initiale",
    aid: null,
    description: null,
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    fo_provision: 1,
    h_mo: 0,
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

function createSection(
  id: string,
  overrides: Partial<EstimateItem> = {}
): EstimateItem {
  return createItem(id, {
    item_type: "section",
    title: "Chapitre",
    ...overrides,
  });
}

function createDependencies() {
  return {
    setTotalsOutOfSync: vi.fn(),
    reportError: vi.fn(),
    resolveErrorMessage: vi.fn((message: string) => `public:${message}`),
    normalizePatchedItem: vi.fn((item: EditorEstimateItem) => item),
    applyVersionToken: vi.fn(),
    enqueueItemUpdate: vi.fn(),
    pushHistoryCommand: vi.fn(),
    reloadItems: vi.fn().mockResolvedValue(undefined),
  };
}

type HarnessDependencies = ReturnType<typeof createDependencies>;

function useItemsControllerHarness(
  props: HarnessProps,
  dependencies: HarnessDependencies
) {
  const [items, setItemsState] = useState<EditorEstimateItem[]>(
    props.initialItems
  );
  const itemsRef = useRef(items);
  const scopeKeyRef = useRef(props.version?.id ?? null);

  const setItems = useCallback<
    Dispatch<SetStateAction<EditorEstimateItem[]>>
  >((update) => {
    const nextItems =
      typeof update === "function" ? update(itemsRef.current) : update;
    itemsRef.current = nextItems;
    setItemsState(nextItems);
  }, []);

  useEffect(() => {
    const scopeKey = props.version?.id ?? null;
    if (scopeKeyRef.current === scopeKey) return;
    scopeKeyRef.current = scopeKey;
    setItems(props.initialItems);
  }, [props.initialItems, props.version?.id, setItems]);

  const getItemsSnapshot = useCallback(() => itemsRef.current, []);
  const getVersionSnapshot = useCallback(
    () => props.version,
    [props.version]
  );
  const reloadItems = useCallback(async () => {
    await dependencies.reloadItems();
    if (props.reloadItemsResult) {
      setItems(props.reloadItemsResult);
    }
  }, [dependencies, props.reloadItemsResult, setItems]);

  const input: ControllerInput = {
    version: props.version,
    settings: props.version
      ? { margin_multiplier: 1.2, tax_rate_bp: 2000 }
      : null,
    isLaborSplitEnabled: false,
    isMutationBlocked: props.isMutationBlocked ?? false,
    mutationBlockedMessage: "Conflit de version actif.",
    getItemsSnapshot,
    getVersionSnapshot,
    setItems,
    setTotalsOutOfSync: dependencies.setTotalsOutOfSync,
    reportError: dependencies.reportError,
    resolveErrorMessage: dependencies.resolveErrorMessage,
    normalizePatchedItem: dependencies.normalizePatchedItem,
    applyVersionToken: dependencies.applyVersionToken,
    enqueueItemUpdate: dependencies.enqueueItemUpdate,
    pushHistoryCommand: dependencies.pushHistoryCommand,
    reloadItems,
    v3Writer: props.v3Writer,
  };
  const controller = useEstimateEditorItemsController(input);

  return { ...controller, items };
}

function renderController(
  initialProps: HarnessProps,
  dependencies = createDependencies()
) {
  const rendered = renderHook(
    (props: HarnessProps) =>
      useItemsControllerHarness(props, dependencies),
    { initialProps }
  );
  return { ...rendered, dependencies };
}

function findTempItem(items: EditorEstimateItem[]) {
  return items.find((item) => item.id.startsWith("tmp:"));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.deleteEstimateItem.mockImplementation(async (versionId: string, itemId: string) => ({
    versionToken: { id: versionId, updated_at: "2026-07-15T08:00:01.000Z" }, deletedIds: [itemId],
  }));
  mocks.reorderEstimateItems.mockImplementation(async (versionId: string) => ({
    versionToken: { id: versionId, updated_at: "2026-07-15T08:00:02.000Z" },
  }));
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useEstimateEditorItemsController", () => {

  describe("TI-534 FO provision on a v3", () => {
    const TUBE = "8f9a1b2c-0000-4000-8000-000000000041";
    const RACCORD = "8f9a1b2c-0000-4000-8000-000000000042";
    const PROVISIONS = new Map([[TUBE, 1.03], [RACCORD, 1.01]]);

    function createV3Writer(): EstimateV3EditorWriter {
      return {
        deleteItems: vi.fn().mockResolvedValue({ id: "version-1", updated_at: "token-after-delete" }),
        updateItems: vi.fn().mockResolvedValue({ id: "version-1", updated_at: "token-after-update" }),
        buildInsertPayload: vi.fn((versionId: string, item: EstimateItem) => ({ version_id: versionId, item_type: item.item_type, title: item.title })),
        buildUpdatePayload: vi.fn((item: EstimateItem) => ({ title: item.title })),
      };
    }

    // The editor state's mirror: a supply type change re-derives the provision against the current row.
    function mirrorDependencies(currentItems: () => EditorEstimateItem[]) {
      const dependencies = createDependencies();
      dependencies.normalizePatchedItem.mockImplementation((item: EditorEstimateItem) =>
        withRederivedFoProvision(currentItems().find((candidate) => candidate.id === item.id), item, PROVISIONS));
      return dependencies;
    }

    it("starts a new line at 1.010 and keeps the provision of a type chosen before confirmation", async () => {
      const deferred = createDeferred<EstimateItem>();
      mocks.createEstimateItem.mockImplementationOnce(() => deferred.promise);
      let current: () => EditorEstimateItem[] = () => [];
      const { result } = renderController(
        { version: createVersion({ calc_engine_version: 3 }), initialItems: [], v3Writer: createV3Writer() },
        mirrorDependencies(() => current()),
      );
      current = () => result.current.items;

      let createRequest!: Promise<void | boolean>;
      act(() => {
        createRequest = result.current.actions.addLine(null);
      });
      const tempId = findTempItem(result.current.items)?.id as string;
      expect(findTempItem(result.current.items)?.fo_provision).toBe(1.01);

      await act(async () => {
        await result.current.actions.patchItem(tempId, { supply_type_id: TUBE }, { persist: true });
      });
      expect(findTempItem(result.current.items)?.fo_provision).toBe(1.03);

      // The server row was created without a type (1.010); the queued patch makes it re-derive 1.030.
      await act(async () => {
        deferred.resolve(createItem("line-real", { fo_provision: 1.01, supply_type_id: null }));
        await createRequest;
      });
      expect(result.current.items).toEqual([
        expect.objectContaining({ id: "line-real", supply_type_id: TUBE, fo_provision: 1.03 }),
      ]);
    });

    it("re-derives the provision when a supply type change is undone and keeps it through other undone edits, as the writer does", async () => {
      const legacy = createItem("line-legacy", { supply_type_id: TUBE, fo_provision: 1 });
      let current: () => EditorEstimateItem[] = () => [];
      const { result, dependencies } = renderController(
        { version: createVersion({ calc_engine_version: 3 }), initialItems: [legacy], v3Writer: createV3Writer() },
        mirrorDependencies(() => current()),
      );
      current = () => result.current.items;

      await act(async () => {
        await result.current.actions.patchItem(legacy.id, { k_fo: 1.2 }, { persist: true });
      });
      expect(result.current.items[0]).toMatchObject({ k_fo: 1.2, fo_provision: 1 });

      await act(async () => {
        await result.current.actions.patchItem(legacy.id, { supply_type_id: RACCORD }, { persist: true });
      });
      expect(result.current.items[0]).toMatchObject({ supply_type_id: RACCORD, fo_provision: 1.01 });

      const [kFoEdit, typeChange] = dependencies.pushHistoryCommand.mock.calls
        .slice(-2).map(([command]) => command as EstimateEditorHistoryCommand);
      await act(async () => {
        await typeChange.undo();
      });
      expect(result.current.items[0]).toMatchObject({ supply_type_id: TUBE, fo_provision: 1.03 });

      // Undoing or redoing an edit that keeps the type keeps the live provision, not the one its snapshot carried.
      await act(async () => {
        await kFoEdit.undo();
      });
      expect(result.current.items[0]).toMatchObject({ k_fo: legacy.k_fo, fo_provision: 1.03 });
      await act(async () => {
        await kFoEdit.redo();
      });
      expect(result.current.items[0]).toMatchObject({ k_fo: 1.2, fo_provision: 1.03 });
    });
  });

  it("applies the refreshed version token before persisting edits queued during creation", async () => {
    const deferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockImplementationOnce(
      async (
        _versionId: string,
        _payload: unknown,
        options?: {
          onVersionToken?: (token: { id: string; updated_at: string }) => void;
        }
      ) => {
        const created = await deferred.promise;
        options?.onVersionToken?.({
          id: "version-1",
          updated_at: "token-after-create",
        });
        return created;
      }
    );
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [],
    });

    let createRequest!: Promise<void | boolean>;
    act(() => {
      createRequest = result.current.actions.addLine(null);
    });
    const tempId = findTempItem(result.current.items)?.id;
    expect(tempId).toBeTruthy();

    act(() => {
      void result.current.actions.patchItem(
        tempId!,
        { title: "Titre saisi pendant la creation" },
        { persist: true }
      );
    });

    await act(async () => {
      deferred.resolve(createItem("line-created"));
      await createRequest;
    });

    expect(dependencies.applyVersionToken).toHaveBeenCalledWith(
      "token-after-create"
    );
    expect(dependencies.enqueueItemUpdate).toHaveBeenCalledWith(
      "line-created",
      expect.objectContaining({ title: "Titre saisi pendant la creation" })
    );
    expect(
      dependencies.applyVersionToken.mock.invocationCallOrder[0]
    ).toBeLessThan(dependencies.enqueueItemUpdate.mock.invocationCallOrder[0]!);
  });

  it("promotes and persists a supply-only line when labor is entered", async () => {
    const initialItem = createItem("line-supply", {
      line_nature: "supply_only",
      unit_price_ht_cents: 1000,
      h_mo: 0,
    });
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [initialItem],
    });

    await act(async () => {
      await result.current.actions.patchItem(
        initialItem.id,
        { h_mo: 0.5 },
        { persist: true },
      );
    });

    expect(result.current.items[0]).toMatchObject({
      h_mo: 0.5,
      line_nature: "supply_and_labor",
    });
    expect(dependencies.enqueueItemUpdate).toHaveBeenCalledWith(
      initialItem.id,
      expect.objectContaining({
        h_mo: 0.5,
        line_nature: "supply_and_labor",
      }),
    );
  });

  it("deletes the real item best-effort when its temp row was removed during create", async () => {
    const deferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [],
    });

    let createRequest!: Promise<void | boolean>;
    act(() => {
      createRequest = result.current.actions.addLine(null);
    });
    await waitFor(() => {
      expect(findTempItem(result.current.items)).toBeDefined();
    });
    const tempId = findTempItem(result.current.items)?.id as string;

    await act(async () => {
      await result.current.actions.deleteItem(tempId);
    });
    expect(result.current.items).toEqual([]);
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve(createItem("line-created-after-removal"));
      await createRequest;
    });

    expect(mocks.deleteEstimateItem).toHaveBeenCalledWith(
      "version-1",
      "line-created-after-removal"
    );
    expect(result.current.items).toEqual([]);
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("rolls back an optimistic create and reports its failure", async () => {
    const deferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [],
    });

    let createRequest!: Promise<void | boolean>;
    act(() => {
      createRequest = result.current.actions.addSection(null);
    });
    await waitFor(() => {
      expect(findTempItem(result.current.items)).toBeDefined();
    });

    await act(async () => {
      deferred.reject(new Error("create failed"));
      await createRequest;
    });

    expect(result.current.items).toEqual([]);
    expect(dependencies.reportError).toHaveBeenLastCalledWith(
      "public:create failed"
    );
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("removes a subtree optimistically and reloads it after a delete failure", async () => {
    const section = createSection("section-old", { position: 1 });
    const child = createItem("line-old", {
      parent_id: section.id,
      position: 1,
    });
    const initialItems = [section, child];
    const deferred = createDeferred<{
      versionToken: { id: string; updated_at: string }; deletedIds: string[];
    }>();
    mocks.deleteEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems,
      reloadItemsResult: initialItems,
    });

    let deleteRequest!: Promise<void | boolean>;
    act(() => {
      deleteRequest = result.current.actions.deleteItem(section.id);
    });
    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });

    await act(async () => {
      deferred.reject(new Error("delete failed"));
      await deleteRequest;
    });

    expect(dependencies.reloadItems).toHaveBeenCalledTimes(1);
    expect(result.current.items.map((item) => item.id)).toEqual([
      "section-old",
      "line-old",
    ]);
    expect(dependencies.reportError).toHaveBeenLastCalledWith(
      "public:delete failed"
    );
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();
  });

  it("undoes a subtree delete parent-first with remapped order and redoes the new root id", async () => {
    const deletedSection = createSection("section-old", { position: 1 });
    const deletedChild = createItem("line-old", {
      parent_id: deletedSection.id,
      position: 1,
    });
    const sibling = createSection("section-sibling", { position: 2 });
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [deletedSection, deletedChild, sibling],
    });

    await act(async () => {
      await result.current.actions.deleteItem(deletedSection.id);
    });
    expect(result.current.items.map((item) => item.id)).toEqual([
      "section-sibling",
    ]);
    const historyCommand = dependencies.pushHistoryCommand.mock
      .calls[0][0] as EstimateEditorHistoryCommand;
    expect(historyCommand.label).toBe("delete-item");

    mocks.createEstimateItem
      .mockResolvedValueOnce(
        createSection("section-new", { position: 1, title: "Chapitre" })
      )
      .mockResolvedValueOnce(
        createItem("line-new", { parent_id: "section-new", position: 1 })
      );

    await act(async () => {
      await historyCommand.undo();
    });

    expect(mocks.createEstimateItem).toHaveBeenNthCalledWith(
      1,
      "version-1",
      expect.objectContaining({
        item_type: "section",
        parent_id: null,
        position: 1,
      }),
      expect.objectContaining({ onVersionToken: expect.any(Function) })
    );
    expect(mocks.createEstimateItem).toHaveBeenNthCalledWith(
      2,
      "version-1",
      expect.objectContaining({
        item_type: "line",
        parent_id: "section-new",
        position: 1,
      }),
      expect.objectContaining({ onVersionToken: expect.any(Function) })
    );
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      1,
      "version-1",
      null,
      ["section-new", "section-sibling"]
    );
    expect(mocks.reorderEstimateItems).toHaveBeenNthCalledWith(
      2,
      "version-1",
      "section-new",
      ["line-new"]
    );
    expect(new Set(result.current.items.map((item) => item.id))).toEqual(
      new Set(["section-sibling", "section-new", "line-new"])
    );

    await act(async () => {
      await historyCommand.redo();
    });

    expect(mocks.deleteEstimateItem).toHaveBeenLastCalledWith(
      "version-1",
      "section-new"
    );
    expect(result.current.items.map((item) => item.id)).toEqual([
      "section-sibling",
    ]);
  });

  it("ignores a late create response after the edited version changes", async () => {
    const versionOne = createVersion();
    const versionTwo = createVersion({
      id: "version-2",
      updated_at: "token-version-2",
    });
    const versionTwoItem = createItem("version-2-line", {
      version_id: versionTwo.id,
    });
    const deferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, rerender, dependencies } = renderController({
      version: versionOne,
      initialItems: [],
    });

    let createRequest!: Promise<void | boolean>;
    act(() => {
      createRequest = result.current.actions.addLine(null);
    });
    await waitFor(() => {
      expect(findTempItem(result.current.items)).toBeDefined();
    });

    rerender({
      version: versionTwo,
      initialItems: [versionTwoItem],
    });
    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual([
        "version-2-line",
      ]);
    });

    await act(async () => {
      deferred.resolve(
        createItem("late-version-1-line", { version_id: versionOne.id })
      );
      await createRequest;
    });

    expect(mocks.createEstimateItem).toHaveBeenCalledWith(
      versionOne.id,
      expect.any(Object),
      expect.objectContaining({ onVersionToken: expect.any(Function) })
    );
    expect(result.current.items.map((item) => item.id)).toEqual([
      "version-2-line",
    ]);
    expect(dependencies.enqueueItemUpdate).not.toHaveBeenCalled();
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();
    expect(mocks.deleteEstimateItem).not.toHaveBeenCalled();
  });

  it("does not append a late redo creation after the history scope changes", async () => {
    const versionOne = createVersion();
    const versionTwo = createVersion({
      id: "version-2",
      updated_at: "token-version-2",
    });
    mocks.createEstimateItem.mockResolvedValueOnce(
      createItem("line-version-1", { version_id: versionOne.id })
    );
    const { result, rerender, dependencies } = renderController({
      version: versionOne,
      initialItems: [],
    });

    await act(async () => {
      await result.current.actions.addLine(null);
    });
    const command = dependencies.pushHistoryCommand.mock
      .calls[0]?.[0] as EstimateEditorHistoryCommand;
    const deferredRedo = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockReturnValueOnce(deferredRedo.promise);
    let isCurrentScope = true;
    let redoPromise!: Promise<void | boolean>;

    act(() => {
      redoPromise = command.redo({
        isCurrentScope: () => isCurrentScope,
      });
    });
    isCurrentScope = false;
    const versionTwoItem = createItem("version-2-line", {
      version_id: versionTwo.id,
    });
    rerender({
      version: versionTwo,
      initialItems: [versionTwoItem],
    });
    await waitFor(() => {
      expect(result.current.items.map((item) => item.id)).toEqual([
        "version-2-line",
      ]);
    });

    await act(async () => {
      deferredRedo.resolve(
        createItem("late-redo-line", { version_id: versionOne.id })
      );
      await redoPromise;
    });

    expect(result.current.items.map((item) => item.id)).toEqual([
      "version-2-line",
    ]);
  });

  it("keeps its actions across renders whose inputs did not change", () => {
    // The editor table props are built from these actions: new ones on every render redraw every row.
    const version = createVersion();
    const input: ControllerInput = {
      version,
      settings: { margin_multiplier: 1.2, tax_rate_bp: 2000 },
      isLaborSplitEnabled: false,
      isMutationBlocked: false,
      mutationBlockedMessage: "Conflit de version actif.",
      getItemsSnapshot: () => [],
      getVersionSnapshot: () => version,
      setItems: vi.fn(),
      ...createDependencies(),
    };
    const { result, rerender } = renderHook(() => useEstimateEditorItemsController(input));
    const firstActions = result.current.actions;

    rerender();

    expect(result.current.actions).toBe(firstActions);
  });
});
