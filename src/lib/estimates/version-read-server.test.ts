import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server-context", async (original) => ({
  ...await original<typeof import("@/lib/estimates/server-context")>(),
  getAuthenticatedContext: vi.fn(),
}));
vi.mock("@/lib/estimates/read-all-items-server", () => ({
  readAllEstimateItems: vi.fn(),
  assertEstimateVersionUnchanged: vi.fn(),
}));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: vi.fn() }));
vi.mock("@/lib/estimates/ai-draft-availability", () => ({ isEstimateAiDraftEnabled: () => false }));
vi.mock("@/lib/estimates/structure-drafts", () => ({
  readAiStructureApplicationsForVersion: vi.fn(async () => []),
  enrichEstimateItemsWithAiStructureProvenance: vi.fn(async (input: { items: unknown[] }) => input.items),
}));
vi.mock("@/lib/estimates/generated-ouvrage-provenance", () => ({
  readGeneratedOuvrageApplicationsForVersion: vi.fn(async () => []),
  enrichEstimateItemsWithGeneratedOuvrageProvenance: vi.fn(async (input: { items: unknown[] }) => input.items),
}));
vi.mock("@/lib/estimates/version-zero-drafts", () => ({
  fetchVersionZeroDraftSummary: vi.fn(async () => null),
  enrichEstimateItemsWithVersionZeroProvenance: vi.fn(async (input: { items: unknown[] }) => input.items),
}));

import { isFeatureEnabled } from "@/lib/feature-flags";
import { readAllEstimateItems } from "@/lib/estimates/read-all-items-server";
import { getAuthenticatedContext } from "@/lib/estimates/server-context";
import { getEstimateVersionDetails } from "@/lib/estimates/version-read-server";
import {
  SENT_ENGINE_1_LINE,
  SENT_ENGINE_1_VERSION,
  SENT_ENGINE_2_LINE,
  SENT_ENGINE_2_VERSION,
  SENT_ESTIMATE_IDS,
  SENT_ESTIMATE_PROJECT,
  SENT_ESTIMATE_STORED,
  TODAY_LABOR_ROLE,
} from "@/test/fixtures/sent-estimate";

const TODAY_MARGIN_TIER = { id: "a1000000-0000-4000-8000-000000000007", tenant_id: SENT_ESTIMATE_IDS.tenant,
  threshold_cents: 0, multiplier: 1.5, position: 1, created_at: SENT_ENGINE_1_VERSION.created_at,
  updated_at: SENT_ENGINE_1_VERSION.updated_at };

// The database as the tenant has it today: the role costs more than when the estimate was sent.
function createSupabase(version: object, status: string) {
  const tables: Record<string, unknown[]> = {
    estimate_versions: [{ ...version, status, estimate_projects: SENT_ESTIMATE_PROJECT }],
    estimate_categories: [],
    estimate_fo_preferences: [],
    supply_types: [],
    labor_roles: [TODAY_LABOR_ROLE],
    estimate_suggestion_rules: [],
    margin_tiers: [TODAY_MARGIN_TIER],
  };
  const read: string[] = [];
  const supabase = {
    from(table: string) {
      if (!(table in tables)) throw new Error(`Unexpected table: ${table}`);
      read.push(table);
      const result = { data: tables[table], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        single: async () => ({ data: tables[table][0], error: null }),
        then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return builder;
    },
  };
  return { supabase, read };
}

// The export context feeds the costing sheets (BDC, DPGF): today's roles, tiers and labour flag are
// what they calculate a version with, so a version they read frozen gets none.
describe("getEstimateVersionDetails export calculation context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);
  });

  const readDetails = async (version: object, line: object, status: string) => {
    const { supabase, read } = createSupabase(version, status);
    vi.mocked(readAllEstimateItems).mockResolvedValue([line] as never);
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: supabase as never,
      userId: SENT_ESTIMATE_IDS.user,
      tenantId: SENT_ESTIMATE_IDS.tenant,
      tenantRole: "engineer",
    });
    const details = await getEstimateVersionDetails(SENT_ESTIMATE_IDS.version, { includeExportCalculationContext: true });
    return { details, read };
  };

  it("gives a draft engine-2 version today's rates, tiers and labour flag to calculate with", async () => {
    const { details } = await readDetails(SENT_ENGINE_2_VERSION, SENT_ENGINE_2_LINE, "draft");
    expect(details.labor_roles).toEqual([TODAY_LABOR_ROLE]);
    expect(details.margin_tiers).toEqual([TODAY_MARGIN_TIER]);
    expect(details.is_labor_split_enabled).toBe(true);
  });

  it("gives a sent engine-2 version its stored amounts and no live tariff to recalculate them", async () => {
    const { details, read } = await readDetails(SENT_ENGINE_2_VERSION, SENT_ENGINE_2_LINE, "sent");
    expect(details.version).toMatchObject({
      total_ht_cents: SENT_ESTIMATE_STORED.htCents,
      total_tax_cents: SENT_ESTIMATE_STORED.taxCents,
      total_ttc_cents: SENT_ESTIMATE_STORED.ttcCents,
    });
    expect(details.items[0]).toMatchObject({
      snapshot_pu_ht_cents: SENT_ESTIMATE_STORED.unitPriceCents,
      line_total_ht_cents: SENT_ESTIMATE_STORED.htCents,
    });
    expect(details.labor_roles).toEqual([]);
    expect(details.margin_tiers).toEqual([]);
    expect(details.is_labor_split_enabled).toBeNull();
    expect(read).not.toContain("labor_roles");
    expect(read).not.toContain("margin_tiers");
    expect(isFeatureEnabled).not.toHaveBeenCalled();
  });

  // Named exception (resolveEstimateCostingSheetSource): the costing sheets of an engine-1 version are
  // built from its inputs, so its context keeps today's roles.
  it("keeps today's roles in the context of a sent engine-1 version", async () => {
    const { details } = await readDetails(SENT_ENGINE_1_VERSION, SENT_ENGINE_1_LINE, "sent");
    expect(details.labor_roles).toEqual([TODAY_LABOR_ROLE]);
    expect(details.is_labor_split_enabled).toBe(true);
  });
});
