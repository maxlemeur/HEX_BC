import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import { useEstimateEditorExportController } from "@/hooks/useEstimateEditorExportController";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import type { EstimateQualityFlagCounts } from "@/lib/estimate-quality";
import type {
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

const mocks = vi.hoisted(() => ({
  exportEstimate: vi.fn(),
  exportToCSV: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  exportEstimate: mocks.exportEstimate,
}));

vi.mock("@/lib/export", () => ({
  exportToCSV: mocks.exportToCSV,
}));

type ControllerInput = Parameters<typeof useEstimateEditorExportController>[0];

const QUALITY_COUNTS: EstimateQualityFlagCounts = {
  linesCount: 1,
  linesWithAnomaliesCount: 0,
  totalFlagsCount: 0,
  byFlag: {
    missing_price: 0,
    missing_quantity: 0,
    missing_labor_time: 0,
    missing_labor_role: 0,
    supplier_price_outdated: 0,
    labor_split_incomplete: 0,
    price_outlier: 0,
    quantity_outlier: 0,
  },
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

function createJsonResponse(
  payload: unknown,
  options: { ok?: boolean; status?: number } = {}
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: vi.fn(async () => payload),
  } as unknown as Response;
}

function createLine(id = "line-1"): EstimateItem {
  return {
    id,
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-01T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: `Line ${id}`,
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
  };
}

function createSettings(): EstimateSettingsState {
  return {
    title: "Devis principal",
    date_devis: "2026-07-15",
    validite_jours: 30,
    currency: "EUR",
    margin_multiplier: 1.2,
    discount_cents: 0,
    tax_rate_bp: 2000,
    rounding_mode: "none",
    rounding_step_cents: 1,
  };
}

function createTotals(): EstimateTotals {
  return {
    costSubtotalCents: 1000,
    saleSubtotalBeforeCoefficientCents: 1000,
    saleSubtotalCents: 1000,
    discountCents: 0,
    appliedMarginMultiplier: 1.2,
    globalCoefficient: 1,
    discountMode: "simple",
    discountStepTotals: [],
    saleTotalCents: 1000,
    taxCents: 200,
    ttcCents: 1200,
    roundedTtcCents: 1200,
    roundingAdjustmentCents: 0,
    adjustedTaxCents: 200,
  };
}

function createInput(overrides: Partial<ControllerInput> = {}): ControllerInput {
  return {
    versionId: "version-1",
    projectName: "Projet Alpha",
    version: {
      id: "version-1",
      version_number: 2,
      status: "draft",
    } as EstimateVersionRow,
    settings: createSettings(),
    totals: createTotals(),
    items: [createLine()],
    supplyTypeById: new Map(),
    laborRoleById: new Map(),
    qualityFlagsByItemId: {},
    qualityCounts: QUALITY_COUNTS,
    isLaborSplitEnabled: false,
    reportError: vi.fn(),
    resolveErrorMessage: (message) => `resolved:${message}`,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mocks.exportEstimate.mockReset();
  mocks.exportToCSV.mockReset();
  mocks.exportEstimate.mockResolvedValue({ filename: "export.xlsx", size: 1 });
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useEstimateEditorExportController streaming exports", () => {
  it("uses the standard, DPGF and BDC streaming contracts", async () => {
    const { result } = renderHook(() =>
      useEstimateEditorExportController(createInput())
    );

    await act(async () => {
      await result.current.actions.exportExcel();
      await result.current.actions.exportDpgf();
      await result.current.actions.exportBdc();
    });

    expect(mocks.exportEstimate.mock.calls).toEqual([
      ["version-1", "xlsx"],
      ["version-1", "xlsx", { mode: "dpgf" }],
      ["version-1", "xlsx", { mode: "bdc" }],
    ]);
  });

  it("exposes the active state and blocks a second export until completion", async () => {
    const deferred = createDeferred<{ filename: string; size: number }>();
    mocks.exportEstimate.mockReturnValueOnce(deferred.promise);
    const { result } = renderHook(() =>
      useEstimateEditorExportController(createInput())
    );

    let exportPromise!: Promise<void>;
    act(() => {
      exportPromise = result.current.actions.exportDpgf();
    });

    expect(result.current.state).toEqual({
      isExporting: true,
      activeMode: "dpgf",
    });
    expect(result.current.meta).toMatchObject({
      isDisabled: true,
      loadingLabel: "Export DPGF...",
    });

    await act(async () => {
      await result.current.actions.exportBdc();
    });
    expect(mocks.exportEstimate).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({ filename: "dpgf.xlsx", size: 10 });
      await exportPromise;
    });

    expect(result.current.state).toEqual({
      isExporting: false,
      activeMode: null,
    });
    expect(result.current.meta.loadingLabel).toBe("Export XLSX...");
  });

  it("reports transformed errors and always resets the active state", async () => {
    const reportError = vi.fn();
    const resolveErrorMessage = vi.fn((message: string) => `public:${message}`);
    mocks.exportEstimate.mockRejectedValueOnce(new Error("network down"));
    const { result } = renderHook(() =>
      useEstimateEditorExportController(
        createInput({ reportError, resolveErrorMessage })
      )
    );

    await act(async () => {
      await result.current.actions.exportExcel();
    });

    expect(resolveErrorMessage).toHaveBeenCalledWith("network down");
    expect(reportError).toHaveBeenCalledWith("public:network down");
    expect(result.current.state).toEqual({
      isExporting: false,
      activeMode: null,
    });
    expect(result.current.meta.isDisabled).toBe(false);
  });
});

describe("useEstimateEditorExportController CSV export", () => {
  it("loads supplier comparisons in chunks of 200 and exports split columns", async () => {
    const lineItems = Array.from({ length: 401 }, (_, index) =>
      createLine(`line-${index}`)
    );
    const firstResponse = createDeferred<Response>();
    fetchMock.mockImplementation(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { item_ids: string[] };
        const response = createJsonResponse({
          comparisons: [
            {
              item_id: body.item_ids[0],
              alternatives: [
                {
                  supplier_name: `Supplier ${body.item_ids[0]}`,
                  unit_price_cents: 1000,
                },
              ],
            },
          ],
        });
        return fetchMock.mock.calls.length === 1
          ? firstResponse.promise
          : Promise.resolve(response);
      }
    );
    const { result } = renderHook(() =>
      useEstimateEditorExportController(
        createInput({
          items: lineItems,
          isLaborSplitEnabled: true,
        })
      )
    );

    let exportPromise!: Promise<void>;
    act(() => {
      exportPromise = result.current.actions.exportCsv();
    });

    expect(result.current.state).toEqual({
      isExporting: true,
      activeMode: "csv",
    });
    expect(result.current.meta.loadingLabel).toBe("Export CSV...");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      firstResponse.resolve(
        createJsonResponse({
          comparisons: [
            {
              item_id: "line-0",
              alternatives: [
                { supplier_name: "Supplier line-0", unit_price_cents: 1000 },
              ],
            },
          ],
        })
      );
      await exportPromise;
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const chunks = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
        item_ids: string[];
      };
      return body.item_ids;
    });
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 1]);
    expect(chunks.flat()).toEqual(lineItems.map((item) => item.id));

    expect(mocks.exportToCSV).toHaveBeenCalledTimes(1);
    const [rows, columns, options] = mocks.exportToCSV.mock.calls[0];
    expect(rows).toHaveLength(401);
    expect(rows[0].supplier_1).toContain("Supplier line-0");
    expect(columns.map((column: { key: string }) => column.key)).toEqual(
      expect.arrayContaining([
        "section_path",
        "supplier_1",
        "h_mo_atelier",
        "labor_role_chantier",
      ])
    );
    expect(options.filename).toMatch(/^Projet_Alpha_V2_\d{4}-\d{2}-\d{2}$/);
    expect(result.current.state).toEqual({
      isExporting: false,
      activeMode: null,
    });
  });

  it("reports comparison request failures but still produces the CSV", async () => {
    const reportError = vi.fn();
    fetchMock.mockResolvedValue(
      createJsonResponse(
        { error: "service unavailable" },
        { ok: false, status: 503 }
      )
    );
    const { result } = renderHook(() =>
      useEstimateEditorExportController(createInput({ reportError }))
    );

    await act(async () => {
      await result.current.actions.exportCsv();
    });

    expect(reportError).toHaveBeenCalledWith(
      "Certaines comparaisons fournisseurs n'ont pas pu etre chargees pour l'export."
    );
    expect(mocks.exportToCSV).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({
      isExporting: false,
      activeMode: null,
    });
  });

  it("keeps CSV disabled and side-effect free when recap data is incomplete", async () => {
    const { result } = renderHook(() =>
      useEstimateEditorExportController(createInput({ totals: null }))
    );

    expect(result.current.meta.isDisabled).toBe(true);
    await act(async () => {
      await result.current.actions.exportCsv();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.exportToCSV).not.toHaveBeenCalled();
  });
});
