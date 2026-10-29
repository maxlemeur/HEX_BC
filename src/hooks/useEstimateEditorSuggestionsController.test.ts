// @vitest-environment jsdom

import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { useEstimateEditorSuggestionsController } from "@/hooks/useEstimateEditorSuggestionsController";
import type {
SuggestionLearningState as SuggestionLearningClientState,
TrackEstimateSuggestionCorrectionsResult,
} from "@/lib/estimates/client";
import type {
EditorEstimateItem,
EstimateItem,
EstimateVersionRow,
} from "@/lib/estimates/editor-items";
import type { Database } from "@/types/database";

type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];

const clientMocks = vi.hoisted(() => ({
  bulkUpdateEstimateItems: vi.fn(),
  createEstimateSuggestionRule: vi.fn(),
  fetchEstimateSuggestionLearnings: vi.fn(),
  sendEstimateSuggestionRuleFeedback: vi.fn(),
  trackEstimateSuggestionCorrections: vi.fn(),
  updateEstimateSuggestionRule: vi.fn(),
}));

vi.mock("@/lib/estimates/client", () => ({
  bulkUpdateEstimateItems: clientMocks.bulkUpdateEstimateItems,
  createEstimateSuggestionRule: clientMocks.createEstimateSuggestionRule,
  fetchEstimateSuggestionLearnings:
    clientMocks.fetchEstimateSuggestionLearnings,
  sendEstimateSuggestionRuleFeedback:
    clientMocks.sendEstimateSuggestionRuleFeedback,
  trackEstimateSuggestionCorrections:
    clientMocks.trackEstimateSuggestionCorrections,
  updateEstimateSuggestionRule:
    clientMocks.updateEstimateSuggestionRule,
}));

const VERSION_A = "33333333-3333-4333-8333-333333333333";
const VERSION_B = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const NOW_ISO = "2026-07-15T12:00:00.000Z";

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
  id = VERSION_A,
  updatedAt = "token-initial"
): EstimateVersionRow {
  return {
    id,
    updated_at: updatedAt,
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
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    tenant_id: TENANT_ID,
    version_id: VERSION_A,
    parent_id: null,
    item_type: "line",
    position: 1,
    title: "Pose fenetre " + id,
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
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
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

function createRule(
  id: string,
  position = 1,
  overrides: Partial<SuggestionRule> = {}
): SuggestionRule {
  return {
    id,
    created_at: NOW_ISO,
    updated_at: NOW_ISO,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: id,
    match_type: "keyword",
    match_value: "fenetre",
    unit: "u",
    category_id: null,
    k_fo: 1.2,
    k_mo: null,
    labor_role_id: null,
    usage_count: 0,
    last_used_at: null,
    position,
    is_active: true,
    ...overrides,
  };
}

function createLearning(
  ruleId: string,
  learningBoost = 2
): SuggestionLearningClientState {
  return {
    config: {
      enabled: true,
      threshold: 2,
      retention_months: 12,
    },
    proposals: [],
    by_rule_id: {
      [ruleId]: {
        rule_id: ruleId,
        learning_boost: learningBoost,
        overrides: {
          description: "ml",
        },
        fields: [],
      },
    },
  };
}

function createTrackResult(
  ruleId: string,
  learningBoost = 3
): TrackEstimateSuggestionCorrectionsResult {
  return {
    ...createLearning(ruleId, learningBoost),
    tracked_count: 1,
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
// One line as normalizeLine leaves it (1440, 288, 1728), one line as created (1000, 200, 1200).
const ONE_NORMALIZED = { total_ht_cents: 1440, total_tax_cents: 288, total_ttc_cents: 1728 };

function createBulkResult(
  updatedAt: string,
  updatedCount = 1,
  versionId = VERSION_A
) {
  return {
    updatedCount,
    versionToken: {
      id: versionId,
      updated_at: updatedAt,
    },
  };
}

type HookProps = {
  routeVersionId: string;
  isMutationBlocked: boolean;
};

function createHarness(input?: {
  document?: EstimateEditorDocument;
  items?: EditorEstimateItem[];
  version?: EstimateVersionRow | null;
  routeVersionId?: string;
  currentUserId?: string | null;
}) {
  let items = input?.items ?? [createLine("line-1")];
  let version =
    input && "version" in input
      ? (input.version ?? null)
      : createVersion(input?.routeVersionId ?? VERSION_A);

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
  const normalizeLine = vi.fn((item: EditorEstimateItem) => ({
    ...item,
    pu_ht_cents: 1440,
    line_total_ht_cents: 1440,
    line_tax_cents: 288,
    line_total_ttc_cents: 1728,
  }));
  const setTotalsOutOfSync = vi.fn();
  const reportError = vi.fn();
  const resolveErrorMessage = vi.fn(
    (message: string) => "public:" + message
  );
  const ensureGroupedActionCanProceed = vi.fn().mockResolvedValue(true);
  const applyVersionToken = vi.fn((updatedAt: string) => {
    if (version) version = { ...version, updated_at: updatedAt };
  });
  const handleVersionConflict = vi.fn().mockReturnValue(false);
  const computeVersionTotalsPatch = vi.fn(totalsOf);
  const categories: EstimateCategory[] = [];

  const rendered = renderHook(
    ({ routeVersionId, isMutationBlocked }: HookProps) =>
      useEstimateEditorSuggestionsController({
        document: input?.document,
        routeVersionId,
        currentUserId:
          input && "currentUserId" in input
            ? (input.currentUserId ?? null)
            : USER_ID,
        previewItems: input?.document?.getSnapshot().items ?? items,
        categories,
        isMutationBlocked,
        mutationBlockedMessage: "Mutation interdite.",
        getItemsSnapshot: () => input?.document?.getSnapshot().items ?? items,
        getVersionSnapshot: () => input?.document?.getSnapshot().version ?? version,
        setItems,
        normalizeLine,
        setTotalsOutOfSync,
        reportError,
        resolveErrorMessage,
        ensureGroupedActionCanProceed,
        computeVersionTotalsPatch,
        applyVersionToken,
        markItemsSynced: vi.fn(),
        handleVersionConflict,
      }),
    {
      initialProps: {
        routeVersionId: input?.routeVersionId ?? VERSION_A,
        isMutationBlocked: false,
      },
    }
  );

  return {
    ...rendered,
    getItems: () => input?.document?.getSnapshot().items ?? items,
    replaceExternalItems: (nextItems: EditorEstimateItem[]) => {
      items = nextItems;
    },
    getVersion: () => version,
    replaceExternalVersion: (nextVersion: EstimateVersionRow | null) => {
      version = nextVersion;
    },
    setItems,
    normalizeLine,
    setTotalsOutOfSync,
    reportError,
    resolveErrorMessage,
    ensureGroupedActionCanProceed,
    computeVersionTotalsPatch,
    applyVersionToken,
    handleVersionConflict,
  };
}

async function hydrateWithRule(
  harness: ReturnType<typeof createHarness>,
  rule = createRule("rule-1")
) {
  await act(async () => {
    harness.result.current.actions.hydrate({
      versionId: VERSION_A,
      rules: [rule],
      learning: createLearning(rule.id),
    });
  });
}

async function openSuggestionDialog(
  harness: ReturnType<typeof createHarness>
) {
  await act(async () => {
    harness.result.current.actions.openDialog();
  });
  expect(harness.result.current.state.isDialogOpen).toBe(true);
}

beforeEach(() => {
  clientMocks.bulkUpdateEstimateItems
    .mockReset()
    .mockResolvedValue(createBulkResult("token-next"));
  clientMocks.createEstimateSuggestionRule
    .mockReset()
    .mockResolvedValue(createRule("rule-created", 2));
  clientMocks.fetchEstimateSuggestionLearnings
    .mockReset()
    .mockResolvedValue(createLearning("rule-1"));
  clientMocks.sendEstimateSuggestionRuleFeedback
    .mockReset()
    .mockResolvedValue(null);
  clientMocks.trackEstimateSuggestionCorrections
    .mockReset()
    .mockResolvedValue(createTrackResult("rule-1"));
  clientMocks.updateEstimateSuggestionRule
    .mockReset()
    .mockResolvedValue(createRule("rule-1", 1, { name: "Regle mise a jour" }));
});

afterEach(() => {
  cleanup();
});

describe("useEstimateEditorSuggestionsController", () => {
  it("lets the autosave barrier block a bulk apply before any optimistic write", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    harness.ensureGroupedActionCanProceed.mockResolvedValueOnce(false);

    await act(async () => {
      await harness.result.current.actions.applySelected();
    });

    expect(harness.ensureGroupedActionCanProceed).toHaveBeenCalledWith(
      "appliquer les suggestions en lot"
    );
    expect(harness.setItems).not.toHaveBeenCalled();
    expect(harness.normalizeLine).not.toHaveBeenCalled();
    expect(clientMocks.bulkUpdateEstimateItems).not.toHaveBeenCalled();
    expect(harness.result.current.state.isDialogOpen).toBe(true);
  });

  it("never revives a selection after an item leaves and returns to the preview", async () => {
    const lines = [createLine("line-1"), createLine("line-2")];
    const harness = createHarness({ items: lines });
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    expect(harness.result.current.state.selectedItemIds).toEqual([
      "line-1",
      "line-2",
    ]);

    harness.replaceExternalItems([
      lines[0]!,
      { ...lines[1]!, title: "Pose porte line-2" },
    ]);
    harness.rerender({
      routeVersionId: VERSION_A,
      isMutationBlocked: false,
    });

    expect(harness.result.current.state.selectedItemIds).toEqual(["line-1"]);
    expect(
      harness.result.current.meta.selectedPreview.map((entry) => entry.itemId)
    ).toEqual(["line-1"]);

    harness.replaceExternalItems(lines);
    harness.rerender({
      routeVersionId: VERSION_A,
      isMutationBlocked: false,
    });

    expect(
      harness.result.current.meta.preview.map((entry) => entry.itemId)
    ).toEqual(["line-1", "line-2"]);
    expect(harness.result.current.state.selectedItemIds).toEqual(["line-1"]);
    expect(
      harness.result.current.meta.selectedPreview.map((entry) => entry.itemId)
    ).toEqual(["line-1"]);

    await act(async () => {
      await harness.result.current.actions.applySelected();
    });

    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledWith(
      VERSION_A,
      "token-initial",
      [expect.objectContaining({ id: "line-1" })],
      { total_ht_cents: 2440, total_tax_cents: 488, total_ttc_cents: 2928 }
    );
    expect(harness.normalizeLine).toHaveBeenCalledTimes(1);
    expect(
      harness.getItems().find((item) => item.id === "line-2")?.description
    ).toBeNull();
  });

  it("keeps the primary bulk success when feedback fails", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    clientMocks.sendEstimateSuggestionRuleFeedback.mockRejectedValueOnce(
      new Error("feedback unavailable")
    );

    await act(async () => {
      await harness.result.current.actions.applySelected();
    });

    expect(harness.applyVersionToken).toHaveBeenCalledWith(
      "token-next",
      ONE_NORMALIZED
    );
    expect(harness.result.current.meta.appliedCount).toBe(1);
    expect(harness.getItems()[0]?.description).toBe("u");
    expect(harness.reportError).toHaveBeenCalledWith(
      "1 compteur(s) de suggestions n'ont pas pu être mis à jour."
    );
    expect(harness.setItems).toHaveBeenCalledTimes(1);
  });

  it("never revives undo after applied lines disappear and return", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);

    await act(async () => {
      await harness.result.current.actions.applySelected();
    });
    expect(harness.result.current.meta.appliedCount).toBe(1);
    const appliedItems = harness.getItems().map((item) => ({ ...item }));

    harness.replaceExternalItems([]);
    harness.rerender({
      routeVersionId: VERSION_A,
      isMutationBlocked: false,
    });

    expect(harness.result.current.state.undoState).toBeNull();
    expect(harness.result.current.meta.appliedCount).toBeNull();

    harness.replaceExternalItems(appliedItems);
    harness.rerender({
      routeVersionId: VERSION_A,
      isMutationBlocked: false,
    });

    expect(harness.result.current.state.undoState).toBeNull();
    expect(harness.result.current.meta.appliedCount).toBeNull();

    await act(async () => {
      await harness.result.current.actions.undoLastApply();
    });

    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(1);
    expect(harness.result.current.state.undoState).toBeNull();
    expect(harness.result.current.state.isUndoing).toBe(false);
  });

  it("rolls back a same-route conflict and persists the conflict draft", async () => {
    const originalLine = createLine("line-1");
    const harness = createHarness({ items: [originalLine] });
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    const conflict = new Error("Version modifiee");
    clientMocks.bulkUpdateEstimateItems.mockRejectedValueOnce(conflict);
    harness.handleVersionConflict.mockReturnValueOnce(true);

    await act(async () => {
      await harness.result.current.actions.applySelected();
    });

    expect(harness.getItems()).toEqual([originalLine]);
    expect(harness.handleVersionConflict).toHaveBeenCalledWith(conflict, {
      persistDraft: true,
    });
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(harness.result.current.state.isDialogOpen).toBe(false);
    expect(harness.result.current.state.dialogError).toBeNull();
  });

  it("never applies or rolls back an old version after a route switch", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    const deferredBulk = createDeferred<ReturnType<typeof createBulkResult>>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(
      deferredBulk.promise
    );

    let applyPromise!: Promise<void>;
    act(() => {
      applyPromise = harness.result.current.actions.applySelected();
    });
    await waitFor(() =>
      expect(harness.result.current.state.isApplying).toBe(true)
    );

    const lineB = createLine("line-b", {
      version_id: VERSION_B,
      title: "Ligne B",
    });
    harness.replaceExternalVersion(createVersion(VERSION_B, "token-b"));
    harness.replaceExternalItems([lineB]);
    harness.rerender({
      routeVersionId: VERSION_B,
      isMutationBlocked: false,
    });

    await act(async () => {
      deferredBulk.resolve(createBulkResult("token-a-late", 1, VERSION_A));
      await applyPromise;
    });

    expect(harness.getItems()).toEqual([lineB]);
    expect(harness.applyVersionToken).not.toHaveBeenCalled();
    expect(
      clientMocks.sendEstimateSuggestionRuleFeedback
    ).not.toHaveBeenCalled();
    expect(harness.result.current.state.undoState).toBeNull();
    expect(harness.result.current.state.isDialogOpen).toBe(false);
  });
});


describe("suggestion receipts accepted by the document", () => {
  function documentWithLine() {
    const document = new EstimateEditorDocument({ actorId: USER_ID, tenantId: TENANT_ID, versionId: VERSION_A });
    document.setConfirmedVersion({ ...createVersion(VERSION_A, "2026-10-28T10:00:00.123456Z"),
      tenant_id: TENANT_ID, calc_engine_version: 1, estimate_projects: null });
    document.acceptItems([createLine("line-1")]);
    return document;
  }

  it("does not report or remember a stale successful suggestion after a newer read", async () => {
    const document = documentWithLine();
    const harness = createHarness({ document });
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    const request = createDeferred<ReturnType<typeof createBulkResult>>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = harness.result.current.actions.applySelected(); });
    await waitFor(() => expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(1));
    act(() => document.transaction(() => {
      document.setConfirmedVersion((version) => version && { ...version, updated_at: "2026-10-28T10:00:00.123458Z" });
      document.acceptItems([createLine("line-1", { k_fo: 1.4 })]);
    }));
    await act(async () => { request.resolve(createBulkResult("2026-10-28T10:00:00.123457Z")); await completion; });
    expect(document.getSnapshot().items[0].k_fo).toBe(1.4);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123458Z");
    expect(harness.result.current.state.isDialogOpen).toBe(true);
    expect(harness.result.current.meta.appliedCount).toBeNull();
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
    expect(clientMocks.sendEstimateSuggestionRuleFeedback).not.toHaveBeenCalled();
  });

  it("keeps a newer confirmed value and undo context when the undo receipt is stale", async () => {
    const document = documentWithLine();
    const harness = createHarness({ document });
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    clientMocks.bulkUpdateEstimateItems.mockResolvedValueOnce(createBulkResult("2026-10-28T10:00:00.123457Z"));
    await act(async () => { await harness.result.current.actions.applySelected(); });
    expect(harness.result.current.meta.appliedCount).toBe(1);
    harness.setTotalsOutOfSync.mockClear();
    const request = createDeferred<ReturnType<typeof createBulkResult>>();
    clientMocks.bulkUpdateEstimateItems.mockReturnValueOnce(request.promise);
    let completion!: Promise<void>;
    act(() => { completion = harness.result.current.actions.undoLastApply(); });
    await waitFor(() => expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenCalledTimes(2));
    act(() => document.transaction(() => {
      document.setConfirmedVersion((version) => version && { ...version, updated_at: "2026-10-28T10:00:00.123459Z" });
      document.acceptItems([createLine("line-1", { k_fo: 1.6 })]);
    }));
    await act(async () => { request.resolve(createBulkResult("2026-10-28T10:00:00.123458Z")); await completion; });
    expect(document.getSnapshot().items[0].k_fo).toBe(1.6);
    expect(document.getSnapshot().version?.updated_at).toBe("2026-10-28T10:00:00.123459Z");
    expect(harness.result.current.meta.appliedCount).toBe(1);
    expect(harness.setTotalsOutOfSync).not.toHaveBeenCalledWith(false);
  });
});
