// @vitest-environment jsdom

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimateEditorHistoryCommand } from "@/hooks/useEstimateEditorHistoryController";
import { useEstimateEditorItemsController } from "@/hooks/useEstimateEditorItemsController";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

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
    content_revision: 1,
    seal_hash: null,
    parent_version_id: null,
    variant_label: null,
    calc_engine_version: 1,
    contractor_role: "principal",
    ...overrides,
  };
}

function createItem(
  id = "line-1",
  overrides: Partial<EstimateItem> = {}
): EstimateItem {
  return {
    id,
    created_at: "2026-07-15T08:00:00.000Z",
    updated_at: "2026-07-15T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: "Ligne initiale",
    aid: null,
    description: null,
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
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
    enqueueItemUpdate: dependencies.enqueueItemUpdate,
    pushHistoryCommand: dependencies.pushHistoryCommand,
    reloadItems,
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
  mocks.deleteEstimateItem.mockResolvedValue(undefined);
  mocks.reorderEstimateItems.mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useEstimateEditorItemsController", () => {
  it("adds sections and lines optimistically before reconciling server ids", async () => {
    const version = createVersion();
    const sectionDeferred = createDeferred<EstimateItem>();
    const lineDeferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem
      .mockImplementationOnce(() => sectionDeferred.promise)
      .mockImplementationOnce(() => lineDeferred.promise);
    const { result, dependencies } = renderController({
      version,
      initialItems: [],
    });

    let sectionRequest!: Promise<void>;
    act(() => {
      sectionRequest = result.current.actions.addSection(null);
    });
    await waitFor(() => {
      expect(findTempItem(result.current.items)).toMatchObject({
        item_type: "section",
        parent_id: null,
        position: 1,
        title: "Nouveau lot",
        _optimistic: true,
        _pendingCreate: true,
      });
    });
    const optimisticSection = findTempItem(result.current.items);
    expect(mocks.createEstimateItem).toHaveBeenNthCalledWith(
      1,
      version.id,
      expect.objectContaining({
        parent_id: null,
        item_type: "section",
        position: 1,
        title: "Nouveau lot",
      })
    );

    await act(async () => {
      sectionDeferred.resolve(
        createSection("section-real", {
          title: optimisticSection?.title ?? "Nouveau lot",
        })
      );
      await sectionRequest;
    });
    expect(result.current.items).toEqual([
      expect.objectContaining({
        id: "section-real",
        _optimistic: false,
        _pendingCreate: false,
      }),
    ]);

    let lineRequest!: Promise<void>;
    act(() => {
      lineRequest = result.current.actions.addLine("section-real");
    });
    await waitFor(() => {
      expect(findTempItem(result.current.items)).toMatchObject({
        item_type: "line",
        parent_id: "section-real",
        position: 1,
        title: "Nouvelle ligne",
        _optimistic: true,
        _pendingCreate: true,
      });
    });

    await act(async () => {
      lineDeferred.resolve(
        createItem("line-real", { parent_id: "section-real" })
      );
      await lineRequest;
    });
    expect(result.current.items.map((item) => item.id)).toEqual([
      "section-real",
      "line-real",
    ]);
    expect(dependencies.pushHistoryCommand.mock.calls.map(([command]) => command.label))
      .toEqual(["add-section", "add-line"]);
  });

  it("keeps a non-persistent patch local only", async () => {
    const initialItem = createItem();
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [initialItem],
    });

    await act(async () => {
      await result.current.actions.patchItem(
        initialItem.id,
        { title: "Brouillon local" },
        { persist: false }
      );
    });

    expect(result.current.items[0]).toMatchObject({
      id: initialItem.id,
      title: "Brouillon local",
    });
    expect(dependencies.normalizePatchedItem).toHaveBeenCalledTimes(1);
    expect(dependencies.enqueueItemUpdate).not.toHaveBeenCalled();
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();
    expect(dependencies.setTotalsOutOfSync).not.toHaveBeenCalled();
  });

  it("merges a persistent temp patch into create and enqueues it under the real id", async () => {
    const deferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [],
    });

    let createRequest!: Promise<void>;
    act(() => {
      createRequest = result.current.actions.addLine(null);
    });
    await waitFor(() => {
      expect(findTempItem(result.current.items)).toBeDefined();
    });
    const tempId = findTempItem(result.current.items)?.id;
    expect(tempId).toBeDefined();

    await act(async () => {
      await result.current.actions.patchItem(
        tempId as string,
        { title: "Ligne modifiee", aid: "A-42" },
        { persist: true }
      );
    });
    expect(findTempItem(result.current.items)).toMatchObject({
      title: "Ligne modifiee",
      aid: "A-42",
    });
    expect(dependencies.enqueueItemUpdate).not.toHaveBeenCalled();

    await act(async () => {
      deferred.resolve(createItem("line-real", { title: "Titre serveur" }));
      await createRequest;
    });

    expect(result.current.items).toEqual([
      expect.objectContaining({
        id: "line-real",
        title: "Ligne modifiee",
        aid: "A-42",
        _optimistic: false,
        _pendingCreate: false,
      }),
    ]);
    expect(dependencies.enqueueItemUpdate).toHaveBeenCalledTimes(1);
    expect(dependencies.enqueueItemUpdate).toHaveBeenCalledWith(
      "line-real",
      expect.objectContaining({ title: "Ligne modifiee", aid: "A-42" })
    );
    expect(dependencies.pushHistoryCommand).toHaveBeenCalledWith(
      expect.objectContaining({ label: "add-line" })
    );
  });

  it("deletes the real item best-effort when its temp row was removed during create", async () => {
    const deferred = createDeferred<EstimateItem>();
    mocks.createEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [],
    });

    let createRequest!: Promise<void>;
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

    let createRequest!: Promise<void>;
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
    const deferred = createDeferred<void>();
    mocks.deleteEstimateItem.mockImplementationOnce(() => deferred.promise);
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems,
      reloadItemsResult: initialItems,
    });

    let deleteRequest!: Promise<void>;
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
      })
    );
    expect(mocks.createEstimateItem).toHaveBeenNthCalledWith(
      2,
      "version-1",
      expect.objectContaining({
        item_type: "line",
        parent_id: "section-new",
        position: 1,
      })
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

  it("blocks create, patch and delete mutations while a version conflict is active", async () => {
    const initialItem = createItem();
    const { result, dependencies } = renderController({
      version: createVersion(),
      initialItems: [initialItem],
      isMutationBlocked: true,
    });

    await act(async () => {
      await result.current.actions.addSection(null);
      await result.current.actions.addLine(null);
      await result.current.actions.patchItem(
        initialItem.id,
        { title: "Interdit" },
        { persist: true }
      );
      await result.current.actions.deleteItem(initialItem.id);
    });

    expect(dependencies.reportError).toHaveBeenCalledTimes(4);
    expect(dependencies.reportError).toHaveBeenCalledWith(
      "Conflit de version actif."
    );
    expect(result.current.items).toEqual([initialItem]);
    expect(window.confirm).not.toHaveBeenCalled();
    expect(mocks.createEstimateItem).not.toHaveBeenCalled();
    expect(mocks.deleteEstimateItem).not.toHaveBeenCalled();
    expect(dependencies.enqueueItemUpdate).not.toHaveBeenCalled();
    expect(dependencies.pushHistoryCommand).not.toHaveBeenCalled();
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

    let createRequest!: Promise<void>;
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
      expect.any(Object)
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
    let redoPromise!: Promise<void>;

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
});
