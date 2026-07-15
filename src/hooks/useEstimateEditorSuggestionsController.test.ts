// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
      items = typeof update === "function" ? update(items) : update;
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
  const categories: EstimateCategory[] = [];

  const rendered = renderHook(
    ({ routeVersionId, isMutationBlocked }: HookProps) =>
      useEstimateEditorSuggestionsController({
        routeVersionId,
        currentUserId:
          input && "currentUserId" in input
            ? (input.currentUserId ?? null)
            : USER_ID,
        previewItems: items,
        categories,
        isMutationBlocked,
        mutationBlockedMessage: "Mutation interdite.",
        getItemsSnapshot: () => items,
        getVersionSnapshot: () => version,
        setItems,
        normalizeLine,
        setTotalsOutOfSync,
        reportError,
        resolveErrorMessage,
        ensureGroupedActionCanProceed,
        applyVersionToken,
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
    getItems: () => items,
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
  it("hydrates only the active scope and ignores a late learning response from another route", async () => {
    const harness = createHarness();
    const deferredLearning = createDeferred<SuggestionLearningClientState>();
    clientMocks.fetchEstimateSuggestionLearnings.mockReturnValueOnce(
      deferredLearning.promise
    );

    await act(async () => {
      expect(
        harness.result.current.actions.hydrate({
          versionId: VERSION_B,
          rules: [createRule("wrong-rule")],
          learning: createLearning("wrong-rule"),
        })
      ).toBe(false);
      expect(
        harness.result.current.actions.hydrate({
          versionId: VERSION_A,
          rules: [createRule("rule-late", 2), createRule("rule-first", 1)],
          learning: createLearning("rule-first"),
        })
      ).toBe(true);
    });

    expect(
      harness.result.current.state.rules.map((rule) => rule.id)
    ).toEqual(["rule-first", "rule-late"]);
    await openSuggestionDialog(harness);

    let learningPromise!: Promise<unknown>;
    act(() => {
      learningPromise = harness.result.current.actions.loadLearning();
    });

    harness.replaceExternalVersion(createVersion(VERSION_B, "token-b"));
    harness.replaceExternalItems([
      createLine("line-b", { version_id: VERSION_B }),
    ]);
    harness.rerender({
      routeVersionId: VERSION_B,
      isMutationBlocked: false,
    });
    expect(harness.result.current.state).toMatchObject({
      rules: [],
      learningState: { enabled: false, by_rule_id: {} },
      isSavingRules: false,
      isDialogOpen: false,
      selectedItemIds: [],
      isApplying: false,
      undoState: null,
      isUndoing: false,
    });
    await act(async () => {
      harness.result.current.actions.hydrate({
        versionId: VERSION_B,
        rules: [createRule("rule-b")],
        learning: createLearning("rule-b", 9),
      });
      deferredLearning.resolve(createLearning("rule-a-late", 99));
      await learningPromise;
    });

    expect(harness.result.current.state.rules.map((rule) => rule.id)).toEqual([
      "rule-b",
    ]);
    expect(
      harness.result.current.state.learningState.by_rule_id["rule-b"]
        ?.learning_boost
    ).toBe(9);
    expect(
      harness.result.current.state.learningState.by_rule_id["rule-a-late"]
    ).toBeUndefined();
  });

  it("resets the active scope and ignores learning resolved after the reset", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    const deferredLearning = createDeferred<SuggestionLearningClientState>();
    clientMocks.fetchEstimateSuggestionLearnings.mockReturnValueOnce(
      deferredLearning.promise
    );

    let learningPromise!: Promise<unknown>;
    act(() => {
      learningPromise = harness.result.current.actions.loadLearning();
    });
    act(() => {
      expect(
        harness.result.current.actions.resetScope(VERSION_B)
      ).toBe(false);
      expect(
        harness.result.current.actions.resetScope(VERSION_A)
      ).toBe(true);
    });

    expect(harness.result.current.state).toMatchObject({
      rules: [],
      learningState: { enabled: false, by_rule_id: {} },
      isSavingRules: false,
      rulesError: null,
      isDialogOpen: false,
      selectedItemIds: [],
      dialogError: null,
      isApplying: false,
      progress: null,
      undoState: null,
      isUndoing: false,
    });

    await act(async () => {
      deferredLearning.resolve(createLearning("rule-late", 99));
      await learningPromise;
    });

    expect(harness.result.current.state.learningState).toEqual({
      enabled: false,
      by_rule_id: {},
    });
    expect(harness.result.current.state.rules).toEqual([]);
  });

  it("treats learning loading as optional and reuses the shared client parser", async () => {
    const harness = createHarness();
    clientMocks.fetchEstimateSuggestionLearnings.mockRejectedValueOnce(
      new Error("offline")
    );

    let learning;
    await act(async () => {
      learning = await harness.result.current.actions.loadLearning();
    });

    expect(clientMocks.fetchEstimateSuggestionLearnings).toHaveBeenCalledWith(
      VERSION_A
    );
    expect(learning).toEqual({
      enabled: false,
      by_rule_id: {},
    });
    expect(harness.result.current.state.learningState.enabled).toBe(false);
    expect(harness.reportError).not.toHaveBeenCalled();
  });

  it("creates and updates rules in sorted order while exposing one saving state", async () => {
    const harness = createHarness();
    await act(async () => {
      harness.result.current.actions.hydrate({
        versionId: VERSION_A,
        rules: [createRule("rule-2", 2), createRule("rule-1", 1)],
        learning: null,
      });
    });

    clientMocks.createEstimateSuggestionRule.mockResolvedValueOnce(
      createRule("rule-3", 3)
    );
    await act(async () => {
      await harness.result.current.actions.createRule({
        name: "Regle 3",
        match_value: "porte",
        unit: "u",
        category_id: null,
        k_fo: 1.1,
        k_mo: null,
        labor_role_id: null,
        position: null,
        is_active: true,
      });
    });

    expect(clientMocks.createEstimateSuggestionRule).toHaveBeenCalledWith(
      VERSION_A,
      expect.objectContaining({
        name: "Regle 3",
        match_type: "keyword",
        position: 3,
      })
    );
    expect(harness.result.current.state.rules.map((rule) => rule.id)).toEqual([
      "rule-1",
      "rule-2",
      "rule-3",
    ]);

    clientMocks.updateEstimateSuggestionRule.mockResolvedValueOnce(
      createRule("rule-3", 0, { name: "Prioritaire" })
    );
    await act(async () => {
      await harness.result.current.actions.updateRule("rule-3", {
        name: "Prioritaire",
        position: 0,
      });
    });

    expect(harness.result.current.state.rules.map((rule) => rule.id)).toEqual([
      "rule-3",
      "rule-1",
      "rule-2",
    ]);
    expect(harness.result.current.state.isSavingRules).toBe(false);
    expect(harness.result.current.state.rulesError).toBeNull();
  });

  it("drops a late rule mutation when the route changes", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    const deferredRule = createDeferred<SuggestionRule>();
    clientMocks.createEstimateSuggestionRule.mockReturnValueOnce(
      deferredRule.promise
    );

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = harness.result.current.actions.createRule({
        name: "Regle tardive",
        match_value: "porte",
        unit: "u",
        category_id: null,
        k_fo: null,
        k_mo: null,
        labor_role_id: null,
        position: null,
        is_active: true,
      });
    });
    await waitFor(() =>
      expect(harness.result.current.state.isSavingRules).toBe(true)
    );

    harness.replaceExternalVersion(createVersion(VERSION_B, "token-b"));
    harness.rerender({
      routeVersionId: VERSION_B,
      isMutationBlocked: false,
    });
    await act(async () => {
      harness.result.current.actions.hydrate({
        versionId: VERSION_B,
        rules: [createRule("rule-b")],
        learning: null,
      });
      deferredRule.resolve(createRule("rule-a-late", 2));
      await createPromise;
    });

    expect(harness.result.current.state.rules.map((rule) => rule.id)).toEqual([
      "rule-b",
    ]);
    expect(harness.result.current.state.isSavingRules).toBe(false);
  });

  it("tracks only supported correction fields and keeps a new route learning state", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);

    await act(async () => {
      await harness.result.current.actions.trackCorrections([]);
      await harness.result.current.actions.trackCorrections([
        {
          rule_id: "rule-1",
          field_name: "unsupported",
          original_value: "a",
          corrected_value: "b",
          item_title: "Ligne",
        },
      ]);
    });
    expect(
      clientMocks.trackEstimateSuggestionCorrections
    ).not.toHaveBeenCalled();

    const deferredTracking =
      createDeferred<TrackEstimateSuggestionCorrectionsResult>();
    clientMocks.trackEstimateSuggestionCorrections.mockReturnValueOnce(
      deferredTracking.promise
    );
    let trackingPromise!: Promise<void>;
    act(() => {
      trackingPromise = harness.result.current.actions.trackCorrections([
        {
          rule_id: "rule-1",
          field_name: "k_fo",
          original_value: "1.2",
          corrected_value: "1.3",
          item_title: "Ligne",
        },
      ]);
    });

    expect(
      clientMocks.trackEstimateSuggestionCorrections
    ).toHaveBeenCalledWith(VERSION_A, {
      corrections: [
        {
          rule_id: "rule-1",
          field_name: "k_fo",
          original_value: "1.2",
          corrected_value: "1.3",
          item_title: "Ligne",
        },
      ],
    });

    harness.replaceExternalVersion(createVersion(VERSION_B, "token-b"));
    harness.rerender({
      routeVersionId: VERSION_B,
      isMutationBlocked: false,
    });
    await act(async () => {
      harness.result.current.actions.hydrate({
        versionId: VERSION_B,
        rules: [createRule("rule-b")],
        learning: createLearning("rule-b", 8),
      });
      deferredTracking.resolve(createTrackResult("rule-1", 99));
      await trackingPromise;
    });

    expect(
      harness.result.current.state.learningState.by_rule_id["rule-b"]
        ?.learning_boost
    ).toBe(8);
    expect(
      harness.result.current.state.learningState.by_rule_id["rule-1"]
    ).toBeUndefined();
  });

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
      [expect.objectContaining({ id: "line-1" })]
    );
    expect(harness.normalizeLine).toHaveBeenCalledTimes(1);
    expect(
      harness.getItems().find((item) => item.id === "line-2")?.description
    ).toBeNull();
  });

  it("applies selected suggestions, aggregates feedback, and restores the exact snapshot on undo", async () => {
    const lines = [createLine("line-1"), createLine("line-2")];
    const harness = createHarness({ items: lines });
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    clientMocks.bulkUpdateEstimateItems
      .mockReset()
      .mockResolvedValueOnce(createBulkResult("token-applied", 2))
      .mockResolvedValueOnce(createBulkResult("token-undone", 2));

    await act(async () => {
      await harness.result.current.actions.applySelected();
    });

    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenNthCalledWith(
      1,
      VERSION_A,
      "token-initial",
      [
        expect.objectContaining({
          id: "line-1",
          updates: expect.objectContaining({
            description: "u",
            k_fo: 1.2,
            pu_ht_cents: 1440,
            line_total_ttc_cents: 1728,
          }),
        }),
        expect.objectContaining({
          id: "line-2",
          updates: expect.objectContaining({
            description: "u",
            k_fo: 1.2,
          }),
        }),
      ]
    );
    expect(clientMocks.sendEstimateSuggestionRuleFeedback).toHaveBeenCalledWith(
      VERSION_A,
      "rule-1",
      "accept",
      2
    );
    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-applied");
    expect(harness.result.current.meta.appliedCount).toBe(2);
    expect(harness.getItems().map((item) => item.description)).toEqual([
      "u",
      "u",
    ]);

    await act(async () => {
      await harness.result.current.actions.undoLastApply();
    });

    expect(harness.ensureGroupedActionCanProceed.mock.calls).toEqual([
      ["appliquer les suggestions en lot"],
      ["annuler les suggestions en lot"],
    ]);
    expect(clientMocks.bulkUpdateEstimateItems).toHaveBeenNthCalledWith(
      2,
      VERSION_A,
      "token-applied",
      [
        expect.objectContaining({
          id: "line-1",
          updates: expect.objectContaining({
            description: null,
            k_fo: 1,
          }),
        }),
        expect.objectContaining({
          id: "line-2",
          updates: expect.objectContaining({
            description: null,
            k_fo: 1,
          }),
        }),
      ]
    );
    expect(harness.getItems()).toEqual(lines);
    expect(harness.applyVersionToken).toHaveBeenLastCalledWith("token-undone");
    expect(harness.result.current.state.undoState).toBeNull();
    expect(harness.setTotalsOutOfSync).toHaveBeenNthCalledWith(1, false);
    expect(harness.setTotalsOutOfSync).toHaveBeenNthCalledWith(2, false);
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

    expect(harness.applyVersionToken).toHaveBeenCalledWith("token-next");
    expect(harness.result.current.meta.appliedCount).toBe(1);
    expect(harness.getItems()[0]?.description).toBe("u");
    expect(harness.reportError).toHaveBeenCalledWith(
      "1 compteur(s) de suggestions n'ont pas pu etre mis a jour."
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

  it("ignores a late feedback failure after the primary success changes route", async () => {
    const harness = createHarness();
    await hydrateWithRule(harness);
    await openSuggestionDialog(harness);
    const deferredFeedback = createDeferred<null>();
    clientMocks.sendEstimateSuggestionRuleFeedback.mockReturnValueOnce(
      deferredFeedback.promise
    );

    let applyPromise!: Promise<void>;
    act(() => {
      applyPromise = harness.result.current.actions.applySelected();
    });
    await waitFor(() =>
      expect(harness.applyVersionToken).toHaveBeenCalledWith("token-next")
    );

    harness.replaceExternalVersion(createVersion(VERSION_B, "token-b"));
    harness.replaceExternalItems([
      createLine("line-b", { version_id: VERSION_B }),
    ]);
    harness.rerender({
      routeVersionId: VERSION_B,
      isMutationBlocked: false,
    });

    await act(async () => {
      deferredFeedback.reject(new Error("late feedback failure"));
      await applyPromise;
    });

    expect(harness.reportError).not.toHaveBeenCalledWith(
      expect.stringContaining("compteur")
    );
    expect(harness.result.current.state.undoState).toBeNull();
  });
});
