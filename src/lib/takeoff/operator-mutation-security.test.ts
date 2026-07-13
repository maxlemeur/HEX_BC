import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  getAuthenticatedContext: vi.fn(),
  insertAssemblyIntoVersion: vi.fn(),
  suggestEstimateCataloguePrices: vi.fn(),
  updateEstimateItem: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

vi.mock("@/lib/takeoff/version-links", () => ({
  listAccessibleTakeoffJobsForVersion: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import {
  batchUpdateTakeoffItems,
  requestTakeoffPriceSuggestion,
  reviewTakeoffPriceSuggestion,
  saveTakeoffDpgfManualLink,
  saveTakeoffReviewDecision,
  updateTakeoffRiskAlertStatus,
} from "@/lib/takeoff/server";
import {
  createPlanSet,
  deletePlanFile,
  deletePlanSet,
} from "@/lib/takeoff/plans";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const OBJECT_ID = "44444444-4444-4444-8444-444444444444";

describe("takeoff operator mutation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: {},
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "viewer",
    } as never);
  });

  it.each([
    [
      "force-refresh price suggestions",
      () =>
        requestTakeoffPriceSuggestion(JOB_ID, {
          version_id: OBJECT_ID,
          estimate_item_id: OBJECT_ID,
          force_refresh: true,
        }),
    ],
    [
      "review price suggestions",
      () =>
        reviewTakeoffPriceSuggestion(JOB_ID, OBJECT_ID, {
          version_id: OBJECT_ID,
          action: "reject",
          review_note: "Revue interdite",
        }),
    ],
    [
      "replace DPGF manual links",
      () =>
        saveTakeoffDpgfManualLink(JOB_ID, {
          version_id: OBJECT_ID,
          estimate_item_id: OBJECT_ID,
          takeoff_item_ids: [],
        }),
    ],
    [
      "forge DPGF review decisions",
      () =>
        saveTakeoffReviewDecision(JOB_ID, {
          version_id: OBJECT_ID,
          estimate_item_id: OBJECT_ID,
          decision: "keep_dpgf",
          reason: "Revue interdite",
        }),
    ],
    [
      "suppress risk alerts",
      () =>
        updateTakeoffRiskAlertStatus(JOB_ID, OBJECT_ID, {
          version_id: OBJECT_ID,
          status: "assumed",
          review_note: "Revue interdite",
        }),
    ],
    [
      "modify completed takeoff items",
      () =>
        batchUpdateTakeoffItems(JOB_ID, {
          items: [],
        }),
    ],
    [
      "create plan sets",
      () =>
        createPlanSet({
          project_id: OBJECT_ID,
          name: "Plans interdits",
          description: null,
          metadata: {},
        }),
    ],
    ["delete plan sets", () => deletePlanSet(OBJECT_ID)],
    ["delete plan files", () => deletePlanFile(OBJECT_ID, OBJECT_ID)],
  ])("rejects a viewer attempting to %s", async (_label, action) => {
    await expect(action()).rejects.toMatchObject({ status: 403 });
  });
});
