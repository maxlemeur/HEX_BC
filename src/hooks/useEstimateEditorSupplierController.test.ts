// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({
  bulkUpdateEstimateItems: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  bulkUpdateEstimateItems: clientMocks.bulkUpdateEstimateItems,
}));

import {
  normalizeSupplierPreselectionReview,
  useEstimateEditorSupplierController,
} from "@/hooks/useEstimateEditorSupplierController";
import type {
  EditorEstimateItem,
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, reject, resolve };
}

function createVersion(id = "version-1", updatedAt = "token-initial") {
  return { id, updated_at: updatedAt } as EstimateVersionRow;
}

function createLine(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id: "line-1",
    version_id: "version-1",
    parent_id: null,
    item_type: "line",
    position: 1,
    title: "Ligne",
    description: "U",
    quantity: 1,
    unit_price_ht_cents: 1000,
    tax_rate_bp: 2000,
    k_fo: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    pu_ht_cents: 1000,
    selected_supplier_price_id: null,
    line_total_ht_cents: 1000,
    line_tax_cents: 200,
    line_total_ttc_cents: 1200,
    ...overrides,
  } as EstimateItem;
}

function createReviewPayload(itemId = "line-1") {
  const alternative = {
    kind: "best_price",
    supplier_price_id: "price-1",
    supplier_id: "supplier-1",
    supplier_name: "Supplier",
    adjusted_unit_price_cents: 750,
    supplier_reference: "REF",
    catalogue_url: null,
    updated_at: "2026-07-15T10:00:00.000Z",
    is_stale: false,
    product_designation: "Produit",
    is_selected: false,
  };
  return {
    data: {
      bulk_preselection: {
        summary: { total_items: 1, proposed_items: 1 },
        proposals: [
          {
            item_id: itemId,
            item_title: "Ligne",
            current_alternative: null,
            proposed_alternative: alternative,
            patch: {
              unit_price_ht_cents: 750,
              selected_supplier_price_id: "price-1",
              description: "NE DOIT PAS ETRE APPLIQUEE",
            },
            reason: "single_clear_option",
            explanation: "Meilleur prix",
          },
        ],
        exceptions: [],
      },
    },
  };
}

function response(payload: unknown, ok = true) {
  return {
    ok,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

function createHarness(input?: {
  routeVersionId?: string;
  items?: EditorEstimateItem[];
  isMutationBlocked?: boolean;
}) {
  let items = input?.items ?? [createLine()];
  let version = createVersion(input?.routeVersionId ?? "version-1");
  const setItems = vi.fn(
    (
      update:
        | EditorEstimateItem[]
        | ((previous: EditorEstimateItem[]) => EditorEstimateItem[])
    ) => {
      items = typeof update === "function" ? update(items) : update;
    }
  );
  const normalizeLine = vi.fn((item: EditorEstimateItem) => ({
    ...item,
    pu_ht_cents: item.unit_price_ht_cents,
    line_total_ht_cents: item.unit_price_ht_cents,
  }));
  const applyVersionToken = vi.fn((updatedAt: string) => {
    version = { ...version, updated_at: updatedAt };
  });
  const ensureGroupedActionCanProceed = vi.fn().mockResolvedValue(true);
  const handleVersionConflict = vi.fn().mockReturnValue(false);
  const setTotalsOutOfSync = vi.fn();
  const reportError = vi.fn();

  const rendered = renderHook(
    ({ routeVersionId }: { routeVersionId: string }) =>
      useEstimateEditorSupplierController({
        routeVersionId,
        items,
        isMutationBlocked: input?.isMutationBlocked ?? false,
        mutationBlockedMessage: "Mutation interdite.",
        getItemsSnapshot: () => items,
        getVersionSnapshot: () => version,
        normalizeLine,
        setItems,
        setTotalsOutOfSync,
        reportError,
        resolveErrorMessage: (message) => `public:${message}`,
        applyVersionToken,
        ensureGroupedActionCanProceed,
        handleVersionConflict,
      }),
    { initialProps: { routeVersionId: input?.routeVersionId ?? "version-1" } }
  );

  return {
    ...rendered,
    applyVersionToken,
    ensureGroupedActionCanProceed,
    getItems: () => items,
    handleVersionConflict,
    normalizeLine,
    reportError,
    setItems,
    setTotalsOutOfSync,
    setVersion: (next: EstimateVersionRow) => {
      version = next;
    },
  };
}

async function openWithPayload(
  harness: ReturnType<typeof createHarness>,
  payload = createReviewPayload()
) {
  vi.mocked(fetch).mockResolvedValueOnce(response(payload));
  await act(async () => {
    await harness.result.current.actions.open();
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  clientMocks.bulkUpdateEstimateItems.mockReset().mockResolvedValue({
    updatedCount: 1,
    versionToken: { id: "version-1", updated_at: "token-next" },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("normalizeSupplierPreselectionReview", () => {
  it("keeps only the strict supplier patch and rejects malformed proposals", () => {
    const review = normalizeSupplierPreselectionReview(createReviewPayload());
    expect(review.proposals).toHaveLength(1);
    expect(review.proposals[0]?.patch).toEqual({
      unit_price_ht_cents: 750,
      selected_supplier_price_id: "price-1",
    });
    expect(normalizeSupplierPreselectionReview({}).proposals).toEqual([]);
  });
});

describe("useEstimateEditorSupplierController", () => {
  it("loads, normalizes and selects the current proposals", async () => {
    const harness = createHarness();
    await openWithPayload(harness);

    expect(fetch).toHaveBeenCalledWith(
      "/api/estimates/version-1/supplier-comparisons",
      expect.objectContaining({ method: "POST" })
    );
    expect(harness.result.current.state).toMatchObject({
      isOpen: true,
      isLoading: false,
      selectedItemIds: ["line-1"],
    });
    expect(harness.result.current.meta.eligibleCount).toBe(1);
  });

  it("invalidates an open request when the dialog closes", async () => {
    const deferred = createDeferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(deferred.promise);
    const harness = createHarness();

    let opening!: Promise<void>;
    act(() => {
      opening = harness.result.current.actions.open();
    });
    act(() => harness.result.current.actions.close());
    await act(async () => {
      deferred.resolve(response(createReviewPayload()));
      await opening;
    });

    expect(harness.result.current.state.isOpen).toBe(false);
    expect(harness.result.current.state.review.proposals).toEqual([]);
  });

  it("resets state and ignores a late response after a route change", async () => {
    const deferred = createDeferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(deferred.promise);
    const harness = createHarness();
    let opening!: Promise<void>;
    act(() => {
      opening = harness.result.current.actions.open();
    });

    harness.setVersion(createVersion("version-2"));
    harness.rerender({ routeVersionId: "version-2" });
    await act(async () => {
      deferred.resolve(response(createReviewPayload()));
      await opening;
    });

    expect(harness.result.current.state).toMatchObject({
      isOpen: false,
      isLoading: false,
      selectedItemIds: [],
    });
  });

  it("projects an empty dialog immediately when an opened dialog changes route", async () => {
    const harness = createHarness();
    await openWithPayload(harness);
    expect(harness.result.current.state).toMatchObject({
      isOpen: true,
      selectedItemIds: ["line-1"],
    });

    harness.setVersion(createVersion("version-2"));
    harness.rerender({ routeVersionId: "version-2" });

    expect(harness.result.current.state).toEqual({
      isOpen: false,
      review: {
        summary: {
          total_items: 0,
          proposed_items: 0,
          exception_items: 0,
          already_selected_items: 0,
          divergence_items: 0,
          stale_items: 0,
          ambiguous_items: 0,
          no_price_items: 0,
        },
        proposals: [],
        exceptions: [],
      },
      selectedItemIds: [],
      error: null,
      isLoading: false,
      isApplying: false,
    });
  });

  it("lets the autosave barrier stop the apply before any optimistic write", async () => {
    const harness = createHarness();
    await openWithPayload(harness);
    harness.ensureGroupedActionCanProceed.mockResolvedValue(false);
    harness.setItems.mockClear();

    await act(async () => {
      await harness.result.current.actions.apply();
    });

    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledTimes(1);
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(clientMocks.bulkUpdateEstimateItems).not.toHaveBeenCalled();
  });

  it("applies the strict patch, normalizes the line and updates the token", async () => {
    const harness = createHarness();
    await openWithPayload(harness);

    await act(async () => {
      await harness.result.current.actions.apply();
    });

    expect(harness.normalizeLine).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "U",
        unit_price_ht_cents: 750,
        selected_supplier_price_id: "price-1",
      })
    );
    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledWith(
      "version-1",
      "token-initial",
      [
        expect.objectContaining({
          id: "line-1",
          updates: expect.objectContaining({
            description: "U",
            unit_price_ht_cents: 750,
            selected_supplier_price_id: "price-1",
          }),
        }),
      ]
    );
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-next");
    expect(harness.setTotalsOutOfSync).toHaveBeenCalledWith(false);
    expect(harness.result.current.state.isOpen).toBe(false);
  });

  it("rolls back a same-route failure and delegates conflicts", async () => {
    const original = createLine();
    const conflict = new Error("conflict");
    clientMocks.bulkUpdateEstimateItems.mockRejectedValueOnce(conflict);
    const harness = createHarness({ items: [original] });
    harness.handleVersionConflict.mockReturnValue(true);
    await openWithPayload(harness);

    await act(async () => {
      await harness.result.current.actions.apply();
    });

    expect(harness.handleVersionConflict).toHaveBeenCalledWith(conflict, {
      persistDraft: true,
    });
    expect(harness.getItems()).toEqual([original]);
    expect(harness.result.current.state.isOpen).toBe(false);
  });

  it("does not apply an old token or rollback onto a new route", async () => {
    const deferred = createDeferred<{
      updatedCount: number;
      versionToken: { id: string; updated_at: string };
    }>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(deferred.promise);
    const harness = createHarness();
    await openWithPayload(harness);

    let applying!: Promise<void>;
    act(() => {
      applying = harness.result.current.actions.apply();
    });
    await waitFor(() => {
      expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(1);
    });
    harness.setVersion(createVersion("version-2"));
    harness.rerender({ routeVersionId: "version-2" });
    expect(harness.result.current.state).toMatchObject({
      isOpen: false,
      isApplying: false,
      selectedItemIds: [],
    });

    await openWithPayload(harness, createReviewPayload("line-2"));
    expect(harness.result.current.state).toMatchObject({
      isOpen: true,
      selectedItemIds: ["line-2"],
    });
    harness.applyVersionToken.mockClear();
    harness.setItems.mockClear();
    await act(async () => {
      deferred.resolve({
        updatedCount: 1,
        versionToken: { id: "version-1", updated_at: "late-token" },
      });
      await applying;
    });

    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.result.current.state).toMatchObject({
      isOpen: true,
      isApplying: false,
      selectedItemIds: ["line-2"],
    });
    expect(harness.result.current.state.review.proposals[0]?.item_id).toBe(
      "line-2"
    );
  });
});
