import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import { useEstimateEditorQualityController } from "@/hooks/useEstimateEditorQualityController";
import type { EstimateItem } from "@/lib/estimates/editor-items";
import type { EstimateOutlierFlagsByItemId } from "@/lib/estimates/outlier-detection";
import type { Database } from "@/types/database";

const mocks = vi.hoisted(() => ({
  fetchDismissedFlags: vi.fn(),
  toggleDismissedFlag: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateOutlierDismissedFlags: mocks.fetchDismissedFlags,
  toggleEstimateOutlierDismissedFlag: mocks.toggleDismissedFlag,
}));

type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type ControllerInput = Parameters<
  typeof useEstimateEditorQualityController
>[0];

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function createLine(
  id: string,
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
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-01T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    line_nature: "supply_and_labor",
    position: 1,
    title: `Line ${id}`,
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
    labor_role_id: "role-1",
    category_id: "category-1",
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

function createSettings(
  overrides: Partial<EstimateSettingsState> = {}
): EstimateSettingsState {
  return {
    title: "Devis principal",
    exclusions: "",
    date_devis: "2026-07-15",
    validite_jours: 30,
    currency: "EUR",
    margin_multiplier: 1.2,
    discount_cents: 0,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
    ...overrides,
  };
}

function createInput(overrides: Partial<ControllerInput> = {}): ControllerInput {
  const items = [createLine("line-1")];
  return {
    routeVersionId: "version-1",
    activeVersionId: "version-1",
    reloadToken: 0,
    items,
    deferredItems: items,
    categories: [{ id: "category-1" } as EstimateCategory],
    settings: createSettings(),
    isReadOnly: false,
    readOnlyErrorMessage: "Cette version est en lecture seule.",
    isConflictLocked: false,
    conflictMessage: null,
    reportError: vi.fn(),
    resolveErrorMessage: (message) => `public:${message}`,
    onVersionConflict: vi.fn(() => false),
    openSettings: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  mocks.fetchDismissedFlags.mockReset();
  mocks.toggleDismissedFlag.mockReset();
  mocks.fetchDismissedFlags.mockResolvedValue({});
  mocks.toggleDismissedFlag.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useEstimateEditorQualityController contract and computations", () => {

  it("updates filters and outlier configuration while ignoring invalid thresholds", () => {
    const { result } = renderHook(() =>
      useEstimateEditorQualityController(createInput())
    );

    act(() => {
      result.current.actions.changeQualityFilter("price_outlier");
      result.current.actions.changeOutlierMethod("zscore");
      result.current.actions.changeOutlierThreshold(2.25);
      result.current.actions.toggleFinalizationPanel();
      result.current.actions.toggleChecklistCollapsed();
    });

    expect(result.current.state).toMatchObject({
      qualityFilter: "price_outlier",
      outlierConfig: expect.objectContaining({
        method: "zscore",
        threshold: 2.25,
      }),
      isFinalizationPanelOpen: true,
      isChecklistCollapsed: false,
    });

    act(() => {
      result.current.actions.changeOutlierThreshold(0);
      result.current.actions.changeOutlierThreshold(Number.NaN);
      result.current.actions.changeOutlierThreshold(Number.POSITIVE_INFINITY);
    });

    expect(result.current.state.outlierConfig.threshold).toBe(2.25);
  });
});

describe("useEstimateEditorQualityController dismissed outlier lifecycle", () => {
  it("reloads dismissals and ignores a stale request after its effect is cancelled", async () => {
    const firstRequest = createDeferred<EstimateOutlierFlagsByItemId>();
    const secondRequest = createDeferred<EstimateOutlierFlagsByItemId>();
    mocks.fetchDismissedFlags
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const initialInput = createInput();
    const { result, rerender } = renderHook(
      (input: ControllerInput) => useEstimateEditorQualityController(input),
      { initialProps: initialInput }
    );

    await waitFor(() => {
      expect(mocks.fetchDismissedFlags).toHaveBeenCalledTimes(1);
    });

    rerender({ ...initialInput, reloadToken: 1 });
    await waitFor(() => {
      expect(mocks.fetchDismissedFlags).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      secondRequest.resolve({ "line-1": ["quantity_outlier"] });
      await secondRequest.promise;
    });
    expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({
      "line-1": ["quantity_outlier"],
    });

    await act(async () => {
      firstRequest.resolve({ "line-1": ["price_outlier"] });
      await firstRequest.promise;
    });
    expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({
      "line-1": ["quantity_outlier"],
    });
  });

  it("prunes deleted lines, deduplicates flags and resets when no route version remains", async () => {
    const lineOne = createLine("line-1");
    const lineTwo = createLine("line-2");
    mocks.fetchDismissedFlags.mockResolvedValue({
      "line-1": ["price_outlier", "price_outlier"],
      "line-2": ["quantity_outlier"],
      "deleted-line": ["price_outlier"],
    });
    const initialInput = createInput({
      items: [lineOne, lineTwo],
      deferredItems: [lineOne, lineTwo],
    });
    const { result, rerender } = renderHook(
      (input: ControllerInput) => useEstimateEditorQualityController(input),
      { initialProps: initialInput }
    );

    await waitFor(() => {
      expect(
        result.current.state.dismissedOutlierFlagsByItemId["line-1"]
      ).toBeDefined();
    });

    rerender({
      ...initialInput,
      items: [lineOne],
      deferredItems: [lineOne],
    });
    await waitFor(() => {
      expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({
        "line-1": ["price_outlier"],
      });
    });

    rerender({
      ...initialInput,
      routeVersionId: "",
      activeVersionId: null,
      items: [lineOne],
      deferredItems: [lineOne],
    });
    await waitFor(() => {
      expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({});
      expect(result.current.state.outlierActionPendingByItemId).toEqual({});
    });
    expect(mocks.fetchDismissedFlags).toHaveBeenCalledTimes(1);
  });

  it("prunes a pending action when its line is removed", async () => {
    const toggleRequest = createDeferred<EstimateOutlierFlagsByItemId>();
    mocks.toggleDismissedFlag.mockReturnValue(toggleRequest.promise);
    const lineOne = createLine("line-1");
    const lineTwo = createLine("line-2");
    const initialInput = createInput({
      items: [lineOne, lineTwo],
      deferredItems: [lineOne, lineTwo],
    });
    const { result, rerender } = renderHook(
      (input: ControllerInput) => useEstimateEditorQualityController(input),
      { initialProps: initialInput }
    );
    let togglePromise!: Promise<void>;

    act(() => {
      togglePromise = result.current.actions.toggleOutlierDismiss(
        "line-2",
        "price_outlier",
        true
      );
    });
    expect(result.current.state.outlierActionPendingByItemId).toEqual({
      "line-2": true,
    });

    rerender({
      ...initialInput,
      items: [lineOne],
      deferredItems: [lineOne],
    });
    await waitFor(() => {
      expect(result.current.state.outlierActionPendingByItemId).toEqual({});
    });

    await act(async () => {
      toggleRequest.resolve({});
      await togglePromise;
    });
    expect(result.current.state.outlierActionPendingByItemId).toEqual({});
  });
});

describe("useEstimateEditorQualityController dismissal mutations", () => {

  it("guards read-only, conflict-locked and missing-version mutations", async () => {
    const reportError = vi.fn();
    const initialInput = createInput({
      isReadOnly: true,
      readOnlyErrorMessage: "Lecture seule.",
      reportError,
    });
    const { result, rerender } = renderHook(
      (input: ControllerInput) => useEstimateEditorQualityController(input),
      { initialProps: initialInput }
    );

    await act(async () => {
      await result.current.actions.toggleOutlierDismiss(
        "line-1",
        "price_outlier",
        true
      );
    });

    rerender({
      ...initialInput,
      isReadOnly: false,
      isConflictLocked: true,
      conflictMessage: "Conflit actif.",
    });
    await act(async () => {
      await result.current.actions.toggleOutlierDismiss(
        "line-1",
        "price_outlier",
        true
      );
    });

    rerender({
      ...initialInput,
      isReadOnly: false,
      isConflictLocked: false,
      activeVersionId: null,
    });
    await act(async () => {
      await result.current.actions.toggleOutlierDismiss(
        "line-1",
        "price_outlier",
        true
      );
    });

    expect(reportError.mock.calls).toEqual([
      ["Lecture seule."],
      ["Conflit actif."],
      ["Version introuvable."],
    ]);
    expect(mocks.toggleDismissedFlag).not.toHaveBeenCalled();
    expect(result.current.state.outlierActionPendingByItemId).toEqual({});
  });

  it("transforms ordinary failures, delegates version conflicts and always clears pending", async () => {
    const reportError = vi.fn();
    const resolveErrorMessage = vi.fn((message: string) => `resolved:${message}`);
    const onVersionConflict = vi.fn(() => false);
    const ordinaryError = new Error("network down");
    mocks.toggleDismissedFlag.mockRejectedValueOnce(ordinaryError);
    const { result } = renderHook(() =>
      useEstimateEditorQualityController(
        createInput({
          reportError,
          resolveErrorMessage,
          onVersionConflict,
        })
      )
    );

    await act(async () => {
      await result.current.actions.toggleOutlierDismiss(
        "line-1",
        "quantity_outlier",
        true
      );
    });

    expect(onVersionConflict).toHaveBeenCalledWith(ordinaryError);
    expect(resolveErrorMessage).toHaveBeenCalledWith("network down");
    expect(reportError).toHaveBeenLastCalledWith("resolved:network down");
    expect(result.current.state.outlierActionPendingByItemId).toEqual({});

    reportError.mockClear();
    resolveErrorMessage.mockClear();
    onVersionConflict.mockReset();
    onVersionConflict.mockReturnValue(true);
    const conflictError = new Error("version conflict");
    mocks.toggleDismissedFlag.mockRejectedValueOnce(conflictError);

    await act(async () => {
      await result.current.actions.toggleOutlierDismiss(
        "line-1",
        "price_outlier",
        false
      );
    });

    expect(onVersionConflict).toHaveBeenCalledWith(conflictError);
    expect(resolveErrorMessage).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(null);
    expect(result.current.state.outlierActionPendingByItemId).toEqual({});
  });

  it("ignores a mutation completing after an A-B-A route change", async () => {
    const toggleRequest = createDeferred<EstimateOutlierFlagsByItemId>();
    const onVersionConflict = vi.fn(() => false);
    mocks.toggleDismissedFlag.mockReturnValueOnce(toggleRequest.promise);
    const initialInput = createInput({ onVersionConflict });
    const { result, rerender } = renderHook(
      (input: ControllerInput) => useEstimateEditorQualityController(input),
      { initialProps: initialInput }
    );

    let togglePromise!: Promise<void>;
    act(() => {
      togglePromise = result.current.actions.toggleOutlierDismiss(
        "line-1",
        "price_outlier",
        true
      );
    });

    rerender({
      ...initialInput,
      routeVersionId: "version-2",
      activeVersionId: "version-2",
    });
    rerender(initialInput);

    expect(result.current.state.outlierActionPendingByItemId).toEqual({});

    await act(async () => {
      toggleRequest.resolve({ "line-1": ["price_outlier"] });
      await togglePromise;
    });

    expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({});
    expect(result.current.state.outlierActionPendingByItemId).toEqual({});
    expect(onVersionConflict).not.toHaveBeenCalled();
  });

  it("keeps only the latest dismissal result for one item", async () => {
    const firstRequest = createDeferred<EstimateOutlierFlagsByItemId>();
    const secondRequest = createDeferred<EstimateOutlierFlagsByItemId>();
    mocks.toggleDismissedFlag
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise);
    const { result } = renderHook(() =>
      useEstimateEditorQualityController(createInput())
    );

    let firstToggle!: Promise<void>;
    let secondToggle!: Promise<void>;
    act(() => {
      firstToggle = result.current.actions.toggleOutlierDismiss(
        "line-1",
        "price_outlier",
        true
      );
      secondToggle = result.current.actions.toggleOutlierDismiss(
        "line-1",
        "quantity_outlier",
        true
      );
    });

    await act(async () => {
      secondRequest.resolve({ "line-1": ["quantity_outlier"] });
      await secondToggle;
    });
    expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({
      "line-1": ["quantity_outlier"],
    });

    await act(async () => {
      firstRequest.resolve({ "line-1": ["price_outlier"] });
      await firstToggle;
    });
    expect(result.current.state.dismissedOutlierFlagsByItemId).toEqual({
      "line-1": ["quantity_outlier"],
    });
  });
});
