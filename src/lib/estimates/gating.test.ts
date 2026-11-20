import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlagValueForTenant: vi.fn(),
  getStalePriceDaysForTenant: vi.fn(),
}));

vi.mock("@/lib/estimates/rules-engine", () => ({
  evaluateRules: vi.fn(),
}));

vi.mock("@/lib/affaires/register-gate-server", () => ({
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

vi.mock("@/lib/estimates/version-zero-drafts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/estimates/version-zero-drafts")>()),
  fetchVersionZeroDraftSummary: vi.fn(),
}));

vi.mock("@/lib/estimates/fixed-discount-evidence-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/estimates/fixed-discount-evidence-server")>()),
  loadCanonicalFixedDiscountEvidence: vi.fn(),
}));

import {
  evaluateEstimateSendGating,
} from "@/lib/estimates/gating";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-gate-server";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import { evaluateRules } from "@/lib/estimates/rules-engine";
import { fetchVersionZeroDraftSummary } from "@/lib/estimates/version-zero-drafts";
import { loadCanonicalFixedDiscountEvidence } from "@/lib/estimates/fixed-discount-evidence-server";
import { resolveEstimateSendOverride } from "@/lib/estimates/version-lifecycle-plan";
import { composeProvisionalQuantityMention, planProvisionalQuantityMentions } from "@/lib/estimates/provisional-quantity";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

function createOrderBuilder(result: QueryResult) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    range: vi.fn(),
    then: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.then.mockImplementation((resolve: (value: QueryResult) => unknown) =>
    Promise.resolve(result).then(resolve)
  );
  builder.range.mockImplementation((from: number, to: number) => {
    const rows = Array.isArray(result.data) ? result.data : [];
    return Promise.resolve({ ...result, data: rows.slice(from, to + 1), count: rows.length });
  });

  return builder;
}

function createSupabaseGatingMock(input: {
  items: unknown[];
  marginTiers: unknown[];
  documents: unknown[];
  supplierPrices?: unknown[];
  errors?: Partial<Record<"marginTiers" | "documents" | "supplierPrices", QueryResult["error"]>>;
}) {
  const estimateItemsBuilder = createOrderBuilder(
    {
      data: input.items,
      error: null,
    }
  );
  const marginTiersBuilder = createOrderBuilder(
    {
      data: input.errors?.marginTiers ? null : input.marginTiers,
      error: input.errors?.marginTiers ?? null,
    }
  );
  const estimateDocumentsBuilder = {
    eq: vi.fn(),
    limit: vi.fn().mockResolvedValue({
      data: input.errors?.documents ? null : input.documents,
      error: input.errors?.documents ?? null,
    }),
  };
  estimateDocumentsBuilder.eq.mockReturnValue(estimateDocumentsBuilder);

  const supplierPricesBuilder = {
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({
      data: input.errors?.supplierPrices ? null : input.supplierPrices ?? [],
      error: input.errors?.supplierPrices ?? null,
    }),
  };
  supplierPricesBuilder.eq.mockReturnValue(supplierPricesBuilder);

  return {
    rpc: vi.fn((functionName: string) => {
      if (functionName === "read_estimate_version_items") return estimateItemsBuilder;
      throw new Error(`Unexpected function: ${functionName}`);
    }),
    from: vi.fn((table: string) => {
      if (table === "margin_tiers") {
        return {
          select: vi.fn(() => marginTiersBuilder),
        };
      }
      if (table === "estimate_documents") {
        return {
          select: vi.fn(() => estimateDocumentsBuilder),
        };
      }
      if (table === "supplier_pricebook") {
        return {
          select: vi.fn(() => supplierPricesBuilder),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createLineItem(input: {
  id: string;
  quantity: number;
  unitPriceHtCents: number;
  laborHours?: number;
  laborRoleId?: string | null;
  selectedSupplierPriceId?: string | null;
  lineNature?: "supply_only" | "supply_and_labor" | "labor_only";
}) {
  return {
    id: input.id,
    item_type: "line",
    line_nature: input.lineNature ?? "supply_and_labor",
    quantity: input.quantity,
    unit_price_ht_cents: input.unitPriceHtCents,
    h_mo: input.laborHours ?? 1,
    labor_role_id: input.laborRoleId ?? "role-1",
    selected_supplier_price_id: input.selectedSupplierPriceId ?? null,
    h_mo_atelier: null,
    h_mo_chantier: null,
    labor_role_atelier_id: null,
    labor_role_chantier_id: null,
    k_mo_atelier: 1,
    k_mo_chantier: 1,
  };
}

describe("estimate send gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue(null);
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(90);
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 0,
      criticalOpenEntries: [],
      nonCriticalOpenEntries: [],
      clarifyWithClientEntries: [],
      openAssumptionEntries: [],
      openMissingPieceEntries: [],
    });
    vi.mocked(evaluateRules).mockResolvedValue({
      violations: [],
      blockingViolations: [],
      warningViolations: [],
      unavailableSignals: [],
    });
    vi.mocked(fetchVersionZeroDraftSummary).mockResolvedValue(null as never);
    vi.mocked(loadCanonicalFixedDiscountEvidence).mockResolvedValue(null);
  });

  it("returns blocking flags for tiered margin without tiers and missing pdf", async () => {
    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 0, unitPriceHtCents: 0 })],
      marginTiers: [],
      documents: [],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "tiered",
        margin_multiplier: 1,
        total_ht_cents: 10000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags.map((flag) => flag.key)).toEqual(
      expect.arrayContaining([
        "missing_price",
        "missing_quantity",
        "margin_not_configured",
        "no_pdf_generated",
      ])
    );
  });

  it("supports warning override via feature flags", async () => {
    vi.mocked(getFeatureFlagValueForTenant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("missing_price");

    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 1, unitPriceHtCents: 0 })],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        total_ht_cents: 10000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.canSend).toBe(true);
    expect(result.blockingFlags).toHaveLength(0);
    expect(result.warningFlags.map((flag) => flag.key)).toContain("missing_price");
  });

  it("keeps conflicting tenant flags blocking, including explicitly recorded zero split hours", async () => {
    const tenantFlags: Record<string, string> = {
      ESTIMATE_GATING_BLOCKING_FLAGS: "unknown_key; MISSING_LABOR_TIME",
      ESTIMATE_GATING_WARNING_FLAGS: "missing_labor_time, MISSING_PRICE\nmissing_price",
    };
    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (tenantId, key) =>
      tenantId === TENANT_ID ? tenantFlags[key] ?? null : null
    );
    const supabase = createSupabaseGatingMock({
      items: [{ ...createLineItem({ id: "line-1", quantity: 1, unitPriceHtCents: 0 }), h_mo_atelier: 0 }],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: { id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 10000, project_id: "project-1" },
      project: { id: "project-1", client_name: null, notes: null },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags.map(({ key, label }) => [key, label])).toEqual([
      ["missing_labor_time", "Temps de main-d’œuvre manquant"],
    ]);
    expect(result.warningFlags.map(({ key, label }) => [key, label])).toEqual([
      ["missing_price", "Prix manquant"],
    ]);
  });

  it("blocks publication when the selected line nature hides entered labor", async () => {
    const supabase = createSupabaseGatingMock({
      items: [
        createLineItem({
          id: "line-1",
          quantity: 1,
          unitPriceHtCents: 5000,
          laborHours: 2,
          laborRoleId: "role-1",
          lineNature: "supply_only",
        }),
      ],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        total_ht_cents: 10000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "line_nature_mismatch" }),
      ]),
    );
  });

  it("adds supplier_price_outdated warning for stale selected supplier prices", async () => {
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(30);

    const supabase = createSupabaseGatingMock({
      items: [
        createLineItem({
          id: "line-1",
          quantity: 1,
          unitPriceHtCents: 5000,
          selectedSupplierPriceId: "sp-1",
        }),
      ],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
      supplierPrices: [
        {
          id: "sp-1",
          updated_at: "2025-01-01T00:00:00.000Z",
          created_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        total_ht_cents: 10000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.warningFlags.map((flag) => flag.key)).toContain(
      "supplier_price_outdated"
    );
  });

  it("surfaces rules engine violations through rule_violation flags", async () => {
    vi.mocked(evaluateRules).mockResolvedValue({
      violations: [
        {
          rule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          rule_type: "min_margin",
          scope_type: "global",
          scope_id: null,
          threshold_value: 1200,
          action: "block",
          severity: "blocking",
          metric_key: "margin_bp",
          actual_value: 900,
          comparator: ">=",
          approval_status: null,
          approval_id: null,
          approval_created_at: null,
          approval_decided_at: null,
          source_state: "ready",
          message: "Violation marge minimum.",
        },
      ],
      blockingViolations: [
        {
          rule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          rule_type: "min_margin",
          scope_type: "global",
          scope_id: null,
          threshold_value: 1200,
          action: "block",
          severity: "blocking",
          metric_key: "margin_bp",
          actual_value: 900,
          comparator: ">=",
          approval_status: null,
          approval_id: null,
          approval_created_at: null,
          approval_decided_at: null,
          source_state: "ready",
          message: "Violation marge minimum.",
        },
      ],
      warningViolations: [],
      unavailableSignals: [],
    });

    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 1, unitPriceHtCents: 5000 })],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "tiered",
        margin_multiplier: 1.6,
        margin_bp: 900,
        discount_bp: 0,
        calc_engine_version: 2,
        content_revision: 3,
        calc_snapshot_content_revision: 2,
        calc_snapshot_context: { effective_margin_multiplier: 1.4 },
        total_ht_cents: 10000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.canSend).toBe(false);
    expect(evaluateRules).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          margin_mode: "tiered",
          content_revision: 3,
          calc_snapshot_content_revision: 2,
          calc_snapshot_context: { effective_margin_multiplier: 1.4 },
        }),
      })
    );
    expect(result.blockingFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "rule_violation",
          severity: "blocking",
          count: 1,
        }),
      ])
    );
  });

  it("fails closed for unavailable blocking rule signals and preserves warnings", async () => {
    vi.mocked(evaluateRules).mockResolvedValue({
      violations: [],
      blockingViolations: [],
      warningViolations: [],
      unavailableSignals: [
        {
          rule_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          rule_type: "critical_exceptions_max",
          scope_type: "global",
          scope_id: null,
          threshold_value: 0,
          action: "block",
          metric_key: "critical_exceptions_count",
          comparator: "<=",
          source_state: "unavailable",
          message: "Signal indisponible.",
        },
        {
          rule_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          rule_type: "takeoff_evidence_coverage_min",
          scope_type: "global",
          scope_id: null,
          threshold_value: 8000,
          action: "warn",
          metric_key: "takeoff_evidence_coverage_bp",
          comparator: ">=",
          source_state: "unavailable",
          message: "Signal indisponible.",
        },
      ],
    });

    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 1, unitPriceHtCents: 5000 })],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        total_ht_cents: 5000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "rule_violation",
          severity: "blocking",
          count: 1,
        }),
      ])
    );
    expect(result.warningFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "rule_violation",
          severity: "warning",
          count: 1,
        }),
      ])
    );
  });

  it("adds register blockers and warnings to client send gating", async () => {
    vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
      openQuestionsCount: 3,
      criticalOpenEntries: [
        {
          id: "reg-1",
          kind: "missing_piece",
          severity: "critical",
          status: "open",
          text: "CCTP complet manquant",
          scopeLabel: "Affaire test",
        },
      ],
      nonCriticalOpenEntries: [
        {
          id: "reg-2",
          kind: "assumption",
          severity: "warning",
          status: "open",
          text: "Le phasage reste a confirmer",
          scopeLabel: "Affaire test",
        },
        {
          id: "reg-4",
          kind: "missing_piece",
          severity: "warning",
          status: "open",
          text: "Ajouter le DOE",
          scopeLabel: "Lot CFO",
        },
      ],
      clarifyWithClientEntries: [
        {
          id: "reg-3",
          kind: "assumption",
          severity: "warning",
          status: "clarify_with_client",
          text: "Valider la variante avec le client",
          scopeLabel: "Lot CFO",
        },
        {
          id: "reg-5",
          kind: "missing_piece",
          severity: "warning",
          status: "clarify_with_client",
          text: "Demander le plan de reservation",
          scopeLabel: "Lot CFO",
        },
      ],
      openAssumptionEntries: [
        {
          id: "reg-2",
          kind: "assumption",
          severity: "warning",
          status: "open",
          text: "Le phasage reste a confirmer",
          scopeLabel: "Affaire test",
        },
      ],
      openMissingPieceEntries: [
        {
          id: "reg-4",
          kind: "missing_piece",
          severity: "warning",
          status: "open",
          text: "Ajouter le DOE",
          scopeLabel: "Lot CFO",
        },
      ],
    });

    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 1, unitPriceHtCents: 5000 })],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        margin_bp: 1200,
        discount_bp: 0,
        total_ht_cents: 10000,
        project_id: "55555555-5555-4555-8555-555555555555",
      },
      project: {
        id: "55555555-5555-4555-8555-555555555555",
        client_name: "Client A",
        notes: null,
      },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "critical_missing_pieces",
          category: "documents",
          count: 1,
        }),
        expect.objectContaining({
          key: "client_clarification_required",
          category: "register",
          count: 1,
        }),
        expect.objectContaining({
          key: "client_missing_documents_required",
          category: "documents",
          count: 1,
          details: {
            register_entries: [
              expect.objectContaining({
                href: "/dashboard/affaires/55555555-5555-4555-8555-555555555555?registerStatus=clarify_with_client&registerKind=missing_piece&registerFocus=reg-5",
              }),
            ],
          },
        }),
      ])
    );
    expect(result.warningFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "missing_pieces_pending",
          category: "documents",
          count: 1,
          details: {
            register_entries: [
              expect.objectContaining({
                href: "/dashboard/affaires/55555555-5555-4555-8555-555555555555?registerStatus=open&registerKind=missing_piece&registerFocus=reg-4",
              }),
            ],
          },
        }),
        expect.objectContaining({
          key: "open_questions_pending",
          category: "register",
          count: 1,
        }),
      ])
    );
  });

  // TI-682 (D25): a « Non chiffrée » line is a line still to classify. It never leaves for the client by default.
  it("blocks a « Non chiffrée » line whatever the tenant flags, and leaves the stated statuses alone", async () => {
    vi.mocked(getFeatureFlagValueForTenant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("not_priced_unclassified,missing_price,missing_quantity");
    const statusLine = (id: string, pricingStatus: string) => ({
      ...createLineItem({ id, quantity: 0, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null }),
      pricing_status: pricingStatus,
    });
    const supabase = createSupabaseGatingMock({
      items: [
        { ...createLineItem({ id: "line-priced", quantity: 2, unitPriceHtCents: 1500 }), pricing_status: "priced" },
        statusLine("line-b-not-priced", "not_priced"),
        statusLine("line-a-not-priced", "not_priced"),
        statusLine("line-included", "included"),
        statusLine("line-for-memory", "for_memory"),
        statusLine("line-out-of-scope", "out_of_scope"),
        statusLine("line-not-applicable", "not_applicable"),
      ],
      marginTiers: [],
      documents: [{ id: "doc-1" }],
    });

    const result = await evaluateEstimateSendGating({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        total_ht_cents: 3000,
        project_id: "55555555-5555-4555-8555-555555555555",
        calc_engine_version: 3,
      },
      project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
    });

    expect(result.canSend).toBe(false);
    expect(result.blockingFlags).toEqual([
      expect.objectContaining({
        key: "not_priced_unclassified",
        severity: "blocking",
        category: "estimate_quality",
        count: 2,
        item_ids: ["line-a-not-priced", "line-b-not-priced"],
        label: "Lignes non chiffrées à classer",
      }),
    ]);
    expect(result.warningFlags.map((flag) => flag.key)).not.toContain("not_priced_unclassified");
  });

  // TI-682 (D25): never a line at 0 € without saying so. Engine 3 has the statuses to say it (« Inclus », « Pour mémoire »).
  it("flags a priced v3 line that has neither a price nor hours, and lets the tenant downgrade it", async () => {
    const emptyLabourLine = (id: string) => ({
      ...createLineItem({ id, quantity: 3, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null, lineNature: "labor_only" }),
      pricing_status: "priced",
      h_mo_per_unit: 0,
    });
    const items = [
      emptyLabourLine("line-empty"),
      { ...emptyLabourLine("line-hours"), h_mo: 6, h_mo_per_unit: 2, labor_role_id: "role-1" },
      { ...emptyLabourLine("line-included"), pricing_status: "included", quantity: 0 },
      { ...createLineItem({ id: "line-supply", quantity: 1, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null }), pricing_status: "priced" },
      { ...emptyLabourLine("line-no-quantity"), quantity: 0 },
    ];
    const evaluate = (engine: number) => evaluateEstimateSendGating({
      supabase: createSupabaseGatingMock({ items, marginTiers: [], documents: [{ id: "doc-1" }] }) as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID,
        margin_mode: "fixed",
        margin_multiplier: 1,
        total_ht_cents: 3000,
        project_id: "55555555-5555-4555-8555-555555555555",
        calc_engine_version: engine,
      },
      project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
    });

    const blocked = await evaluate(3);
    expect(blocked.canSend).toBe(false);
    expect(blocked.blockingFlags).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: "priced_line_without_amount",
        severity: "blocking",
        count: 1,
        item_ids: ["line-empty"],
        label: "Lignes chiffrées à 0 €",
      }),
      // Lines already missing their price or their quantity keep their own flag and are not counted twice.
      expect.objectContaining({ key: "missing_price", item_ids: ["line-supply"] }),
      expect.objectContaining({ key: "missing_quantity", item_ids: ["line-no-quantity"] }),
    ]));

    // A version read without its engine column is never treated as engine 3.
    const unknownEngine = await evaluateEstimateSendGating({
      supabase: createSupabaseGatingMock({ items, marginTiers: [], documents: [{ id: "doc-1" }] }) as never,
      tenantId: TENANT_ID,
      version: { id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 3000, project_id: "55555555-5555-4555-8555-555555555555" },
      project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
    });
    expect([...unknownEngine.blockingFlags, ...unknownEngine.warningFlags].map((flag) => flag.key)).not.toContain("priced_line_without_amount");

    // Engines 1 and 2 have no status to say « Inclus »: their lines keep today's flags only.
    const legacy = await evaluate(2);
    expect([...legacy.blockingFlags, ...legacy.warningFlags].map((flag) => flag.key)).not.toContain("priced_line_without_amount");

    vi.mocked(getFeatureFlagValueForTenant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("priced_line_without_amount,missing_price");
    const downgraded = await evaluate(3);
    expect(downgraded.blockingFlags.map((flag) => flag.key)).not.toContain("priced_line_without_amount");
    expect(downgraded.warningFlags).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "priced_line_without_amount", item_ids: ["line-empty"] }),
    ]));
  });

  it.each(["h_mo", "h_mo_atelier", "h_mo_chantier", "h_mo_per_unit", "h_mo_atelier_per_unit", "h_mo_chantier_per_unit"])(
    "counts hours stored in %s alone as an amount to price (TI-682)", async (column) => {
      const line = {
        ...createLineItem({ id: "line-hours", quantity: 3, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null, lineNature: "labor_only" }),
        pricing_status: "priced",
        h_mo_per_unit: 0,
        [column]: 2,
      };
      const result = await evaluateEstimateSendGating({
        supabase: createSupabaseGatingMock({ items: [line], marginTiers: [], documents: [{ id: "doc-1" }] }) as never,
        tenantId: TENANT_ID,
        version: {
          id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 3000,
          project_id: "55555555-5555-4555-8555-555555555555", calc_engine_version: 3,
        },
        project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
      });
      expect([...result.blockingFlags, ...result.warningFlags].map((flag) => flag.key)).not.toContain("priced_line_without_amount");
    });
  // TI-682, lot C (D11, D25): a necessary service left unpriced and then excluded says why, internally, before it leaves.
  describe("excluded_without_reason", () => {
    const excluded = (id: string, pricingStatus: string, extra: Record<string, unknown> = {}) => ({
      ...createLineItem({ id, quantity: 0, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null }),
      pricing_status: pricingStatus, was_not_priced: false, status_reason: null, ...extra,
    });
    const items = [
      { ...createLineItem({ id: "line-priced", quantity: 2, unitPriceHtCents: 1500 }), pricing_status: "priced" },
      excluded("line-b-out", "out_of_scope", { was_not_priced: true }),
      excluded("line-a-memory", "for_memory", { was_not_priced: true }),
      excluded("line-included", "included", { was_not_priced: true }),
      excluded("line-not-applicable", "not_applicable", { was_not_priced: true }),
      excluded("line-with-reason", "out_of_scope", { was_not_priced: true, status_reason: { code: "other_trade", note: null } }),
      excluded("line-unreadable-reason", "included", { was_not_priced: true, status_reason: { code: "other", note: null } }),
      // Created or imported directly with its status (V3E16, V3E20): no reason is asked.
      excluded("line-dpgf-memory", "for_memory"),
      excluded("line-dpgf-out", "out_of_scope"),
      // Priced again after « Non chiffrée »: nothing to say to anyone.
      { ...createLineItem({ id: "line-repriced", quantity: 1, unitPriceHtCents: 500 }), pricing_status: "priced", was_not_priced: true },
    ];
    const evaluate = (engine: number | undefined) => evaluateEstimateSendGating({
      supabase: createSupabaseGatingMock({ items, marginTiers: [], documents: [{ id: "doc-1" }] }) as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 3000,
        project_id: "55555555-5555-4555-8555-555555555555",
        ...(engine === undefined ? {} : { calc_engine_version: engine }),
      },
      project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
    });

    it("blocks an engine 3 line excluded after « Non chiffrée » without a readable reason, and only those", async () => {
      const result = await evaluate(3);
      expect(result.canSend).toBe(false);
      expect(result.blockingFlags).toEqual([
        expect.objectContaining({
          key: "excluded_without_reason",
          severity: "blocking",
          category: "estimate_quality",
          count: 5,
          item_ids: ["line-a-memory", "line-b-out", "line-included", "line-not-applicable", "line-unreadable-reason"],
          label: "Motif interne d'exclusion à saisir",
        }),
      ]);
      expect(result.warningFlags.map((flag) => flag.key)).not.toContain("excluded_without_reason");
    });

    it("lets no tenant setting downgrade it", async () => {
      vi.mocked(getFeatureFlagValueForTenant)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("excluded_without_reason");
      const result = await evaluate(3);
      expect(result.blockingFlags.map((flag) => flag.key)).toEqual(["excluded_without_reason"]);
      expect(result.warningFlags.map((flag) => flag.key)).not.toContain("excluded_without_reason");
    });

    it("never raises it on engines 1 and 2, nor on a version read without its engine", async () => {
      for (const engine of [1, 2, undefined]) {
        const result = await evaluate(engine);
        expect([...result.blockingFlags, ...result.warningFlags].map((flag) => flag.key)).not.toContain("excluded_without_reason");
      }
    });

    it("is satisfied once every such line carries a readable reason", async () => {
      const result = await evaluateEstimateSendGating({
        supabase: createSupabaseGatingMock({
          items: [excluded("line-out", "out_of_scope", { was_not_priced: true, status_reason: { code: "client_supplied", note: null } })],
          marginTiers: [], documents: [{ id: "doc-1" }],
        }) as never,
        tenantId: TENANT_ID,
        version: {
          id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 0,
          project_id: "55555555-5555-4555-8555-555555555555", calc_engine_version: 3,
        },
        project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
      });
      expect([...result.blockingFlags, ...result.warningFlags].map((flag) => flag.key)).not.toContain("excluded_without_reason");
    });
  });
  // TI-682, lot C, PR 4 (D10, D25, D28): the written reserve. A reserved « Non chiffrée » line leaves unpriced, and the
  // offer says so in its « Précisions et limites de prestation » text.
  describe("offer_reserve_declared and offer_limits_required", () => {
    const reserve = (extra: Record<string, unknown> = {}) => ({ kind: "reserve", basis: "private_estimate", code: "pending_survey",
      note: null, decided_by: "11111111-1111-4111-8111-111111111111", decided_at: "2026-11-11T18:02:23.123456+00:00", ...extra });
    const unpriced = (id: string, extra: Record<string, unknown> = {}) => ({
      ...createLineItem({ id, quantity: 1, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null }),
      pricing_status: "not_priced", was_not_priced: true, status_reason: null, offer_choice: null, ...extra,
    });
    const priced = { ...createLineItem({ id: "line-priced", quantity: 2, unitPriceHtCents: 1500 }), pricing_status: "priced" };
    const evaluate = (items: unknown[], options: { engine?: number; exclusions?: string | null | undefined } = {}) =>
      evaluateEstimateSendGating({
        supabase: createSupabaseGatingMock({ items, marginTiers: [], documents: [{ id: "doc-1" }] }) as never,
        tenantId: TENANT_ID,
        version: {
          id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 3000,
          project_id: "55555555-5555-4555-8555-555555555555", calc_engine_version: options.engine ?? 3,
          ...("exclusions" in options ? { exclusions: options.exclusions } : {}),
        },
        project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
      });
    const keys = (result: Awaited<ReturnType<typeof evaluate>>) => ({
      blocking: result.blockingFlags.map((flag) => flag.key), warning: result.warningFlags.map((flag) => flag.key),
    });

    it("takes a reserved line out of the lines to classify and lists it as a warning, once the limits say something", async () => {
      const result = await evaluate([priced, unpriced("line-b-reserved", { offer_choice: reserve() }),
        unpriced("line-a-reserved", { offer_choice: reserve({ basis: "indicative_quantities", note: "RC article 5.2" }) })],
      { exclusions: "Réseaux enterrés non chiffrés." });
      expect(result.canSend).toBe(true);
      expect(keys(result)).toEqual({ blocking: [], warning: ["offer_reserve_declared"] });
      expect(result.warningFlags[0]).toMatchObject({
        key: "offer_reserve_declared", severity: "warning", count: 2, item_ids: ["line-a-reserved", "line-b-reserved"],
        label: "Réserves écrites dans l'offre",
      });
    });

    it("refuses a reserve with empty limits, without override, whatever the tenant flags", async () => {
      vi.mocked(getFeatureFlagValueForTenant)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("offer_limits_required");
      const result = await evaluate([priced, unpriced("line-reserved", { offer_choice: reserve() })], { exclusions: null });
      expect(result.canSend).toBe(false);
      expect(keys(result)).toEqual({ blocking: ["offer_limits_required"], warning: ["offer_reserve_declared"] });
      expect(result.blockingFlags[0]).toMatchObject({ severity: "blocking", item_ids: ["line-reserved"],
        label: "Précisions et limites de prestation à rédiger" });
      expect(() => resolveEstimateSendOverride(result, true)).toThrow(expect.objectContaining({
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        details: expect.objectContaining({ not_forceable: ["offer_limits_required"] }),
      }));
    });

    it("counts limits made of blanks or invisible characters as empty, and a version read without its limits too", async () => {
      for (const exclusions of ["", "   \n\t ", "\u00a0\u2003", "\u200b\u200d\ufeff", undefined]) {
        const result = await evaluate([unpriced("line-reserved", { offer_choice: reserve() })],
          exclusions === undefined ? {} : { exclusions });
        expect(keys(result).blocking, JSON.stringify(exclusions)).toEqual(["offer_limits_required"]);
      }
      const written = await evaluate([unpriced("line-reserved", { offer_choice: reserve() })], { exclusions: " Néant. " });
      expect(keys(written).blocking).toEqual([]);
    });

    it("keeps a line to classify when its reserve is unreadable, and never asks limits without a reserve", async () => {
      const result = await evaluate([
        unpriced("line-plain"),
        unpriced("line-unreadable", { offer_choice: reserve({ code: "other", note: null }) }),
        unpriced("line-foreign", { offer_choice: { kind: "provisional_quantity" } }),
      ], { exclusions: null });
      expect(keys(result)).toEqual({ blocking: ["not_priced_unclassified"], warning: [] });
      expect(result.blockingFlags[0].item_ids).toEqual(["line-foreign", "line-plain", "line-unreadable"]);
    });

    it("blocks the unreserved lines next to the reserved ones", async () => {
      const result = await evaluate([unpriced("line-plain"), unpriced("line-reserved", { offer_choice: reserve() })],
        { exclusions: "Limites." });
      expect(keys(result)).toEqual({ blocking: ["not_priced_unclassified"], warning: ["offer_reserve_declared"] });
      expect(result.blockingFlags[0].item_ids).toEqual(["line-plain"]);
    });

    it("reads no reserve on engines 1 and 2 nor on a version read without its engine", async () => {
      for (const engine of [1, 2]) {
        const result = await evaluate([unpriced("line-reserved", { offer_choice: reserve() })], { engine, exclusions: "Limites." });
        expect(keys(result)).toEqual({ blocking: ["not_priced_unclassified"], warning: [] });
      }
    });
  });
  // TI-682, lot C, PR 5: the provisional quantity. A priced line whose quantity rests on a takeoff hypothesis leaves
  // priced; once an administrator declared it provisional, the offer's limits text carries the sentence written from the
  // line as it is now. An hypothesis nobody declared is listed for the issuer, never blocked.
  describe("provisional_quantity_mention_missing and takeoff_hypothesis_without_mention", () => {
    const marker = (cause: string | null = "estimated") => ({ takeoff_provision: { version: 1, job_id: "job-1", sources: [
      { takeoff_item_id: "takeoff-1", forced: false, forced_reason: null, entry_category: null, hypothesis_cause: cause },
    ] } });
    const provisional = (extra: Record<string, unknown> = {}) => ({ kind: "provisional_quantity", basis: "private_estimate",
      note: null, established_on: "le plan CVC indice B", to_confirm_by: "le relevé contradictoire sur site",
      decided_by: "11111111-1111-4111-8111-111111111111", decided_at: "2026-11-12T09:00:00.000000+00:00", ...extra });
    const pricedLine = (id: string, extra: Record<string, unknown> = {}) => ({
      ...createLineItem({ id, quantity: 12, unitPriceHtCents: 1500 }), title: "Calorifuge des réseaux EC", unit_code: "ml",
      pricing_status: "priced", was_not_priced: false, status_reason: null, offer_choice: null,
      source_metadata: marker(), ...extra,
    });
    const sentence = "Calorifuge des réseaux EC : quantité provisionnelle de 12 ml, établie sur le plan CVC indice B, à "
      + "confirmer selon le relevé contradictoire sur site.";
    const evaluate = (items: unknown[], options: { engine?: number; exclusions?: string | null } = {}) =>
      evaluateEstimateSendGating({
        supabase: createSupabaseGatingMock({ items, marginTiers: [], documents: [{ id: "doc-1" }] }) as never,
        tenantId: TENANT_ID,
        version: {
          id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 18000,
          project_id: "55555555-5555-4555-8555-555555555555", calc_engine_version: options.engine ?? 3,
          exclusions: options.exclusions ?? null,
        },
        project: { id: "55555555-5555-4555-8555-555555555555", client_name: "Client A", notes: null },
      });
    const keys = (result: Awaited<ReturnType<typeof evaluate>>) => ({
      blocking: result.blockingFlags.map((flag) => flag.key), warning: result.warningFlags.map((flag) => flag.key),
    });

    it("blocks a declared provisional quantity until its sentence is in the limits, without override, whatever the tenant flags", async () => {
      vi.mocked(getFeatureFlagValueForTenant)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("provisional_quantity_mention_missing");
      const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional() })],
        { exclusions: "Réseaux enterrés non compris." });
      expect(result.canSend).toBe(false);
      expect(keys(result)).toEqual({ blocking: ["provisional_quantity_mention_missing"], warning: [] });
      expect(result.blockingFlags[0]).toMatchObject({ severity: "blocking", item_ids: ["line-provisional"],
        label: "Mention « quantité provisionnelle » à écrire" });
      expect(() => resolveEstimateSendOverride(result, true)).toThrow(expect.objectContaining({
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        details: expect.objectContaining({ not_forceable: ["provisional_quantity_mention_missing"] }),
      }));
    });

    it("lets the line leave priced once the limits carry its sentence, whatever its blanks and line breaks", async () => {
      for (const exclusions of [sentence, `Réseaux enterrés non compris.\n\n${sentence.replace(", à confirmer", ",\n  à confirmer")}`]) {
        const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional() })], { exclusions });
        expect(keys(result), exclusions).toEqual({ blocking: [], warning: [] });
        expect(result.canSend).toBe(true);
      }
    });

    it("blocks again once the quantity, the title or the unit changed after the sentence was written", async () => {
      for (const change of [{ quantity: 12.5 }, { title: "Calorifuge EC" }, { unit_code: "u" }, { quantity: null }]) {
        const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional(), ...change })],
          { exclusions: sentence });
        expect(keys(result).blocking, JSON.stringify(change)).toContain("provisional_quantity_mention_missing");
      }
    });

    it("also asks the limits text when it is empty, as for a reserve", async () => {
      for (const exclusions of [null, "", " \n "]) {
        const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional() })], { exclusions });
        expect(keys(result).blocking, JSON.stringify(exclusions))
          .toEqual(["offer_limits_required", "provisional_quantity_mention_missing"]);
      }
    });

    it("blocks a line whose declared choice cannot be read, without override: a declaration never falls back to a warning", async () => {
      // The database only stores a choice it reads; the application reading it otherwise is a fault of the tool. The line
      // then leaves neither as declared (no sentence can be written) nor as an hypothesis nobody declared.
      const reserve = { kind: "reserve", basis: "private_estimate", code: "pending_survey", note: null,
        decided_by: "11111111-1111-4111-8111-111111111111", decided_at: "2026-11-12T09:00:00.000000+00:00" };
      const lines = [
        pricedLine("line-unreadable", { offer_choice: provisional({ established_on: 12 }) }),
        pricedLine("line-other-kind", { offer_choice: reserve, source_metadata: null }),
        pricedLine("line-included", { pricing_status: "included", offer_choice: provisional() }),
      ];
      vi.mocked(getFeatureFlagValueForTenant).mockResolvedValueOnce(null).mockResolvedValueOnce("offer_choice_unreadable");
      const result = await evaluate(lines, { exclusions: "Réseaux enterrés non compris." });
      expect(keys(result)).toEqual({ blocking: ["offer_choice_unreadable"], warning: [] });
      expect(result.blockingFlags[0]).toMatchObject({ severity: "blocking",
        item_ids: ["line-included", "line-other-kind", "line-unreadable"], label: "Choix d'offre illisible" });
      expect(() => resolveEstimateSendOverride(result, true)).toThrow(expect.objectContaining({
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        details: expect.objectContaining({ not_forceable: ["offer_choice_unreadable"] }),
      }));
      // Another engine carries no choice: nothing is read there.
      expect(keys(await evaluate([pricedLine("line-unreadable", { offer_choice: provisional({ established_on: 12 }) })],
        { engine: 2, exclusions: "Réseaux enterrés non compris." })).blocking).not.toContain("offer_choice_unreadable");
    });

    it("lists the priced hypotheses nobody declared, as a warning only", async () => {
      const result = await evaluate([
        pricedLine("line-b-hypothesis"),
        pricedLine("line-a-entered", { source_metadata: { takeoff_provision: { version: 1, job_id: "job-1", sources: [
          { takeoff_item_id: "takeoff-2", forced: false, forced_reason: null, entry_category: "hypothesis" }] } } }),
        pricedLine("line-provision", { source_metadata: marker(null) }),
        pricedLine("line-plain", { source_metadata: {} }),
        pricedLine("line-declared", { offer_choice: provisional({ established_on: "le plan CVC indice C" }) }),
        pricedLine("line-unpriced-hypothesis", { pricing_status: "included" }),
      ], { exclusions: sentence.replace("indice B", "indice C") });
      expect(keys(result)).toEqual({ blocking: [], warning: ["takeoff_hypothesis_without_mention"] });
      expect(result.warningFlags[0]).toMatchObject({ severity: "warning", item_ids: ["line-a-entered", "line-b-hypothesis"],
        label: "Quantités sur hypothèse sans mention" });
      expect(result.canSend).toBe(true);
    });

    it("does not take the sentence of « Gros Tube » for the sentence of « Tube »", async () => {
      const tube = "Tube : quantité provisionnelle de 12 ml, établie sur le plan CVC indice B, à confirmer selon le relevé "
        + "contradictoire sur site.";
      const result = await evaluate([pricedLine("line-tube", { title: "Tube", offer_choice: provisional() }),
        pricedLine("line-big-tube", { title: "Gros Tube", offer_choice: provisional() })], { exclusions: `Gros ${tube}` });
      expect(keys(result).blocking).toEqual(["provisional_quantity_mention_missing"]);
      expect(result.blockingFlags[0].item_ids).toEqual(["line-tube"]);
    });

    it("warns of a provisional sentence that matches no current line, and lets the offer leave", async () => {
      const before = sentence.replace("de 12 ml", "de 10 ml");
      const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional() })],
        { exclusions: `${before}\n${sentence}` });
      expect(keys(result)).toEqual({ blocking: [], warning: ["provisional_quantity_mention_stale"] });
      expect(result.warningFlags[0]).toMatchObject({ severity: "warning", item_ids: [VERSION_ID], count: 1,
        label: "Mention « quantité provisionnelle » à relire" });
      expect(result.canSend).toBe(true);
      const orphan = await evaluate([pricedLine("line-hypothesis")], { exclusions: sentence });
      expect(keys(orphan)).toEqual({ blocking: [], warning: ["takeoff_hypothesis_without_mention", "provisional_quantity_mention_stale"] });
    });

    it("says what unblocks the offer when its limits can no longer receive the missing sentences", async () => {
      const long = { established_on: "é".repeat(160), to_confirm_by: "è".repeat(160) };
      const lines = Array.from({ length: 14 }, (_, index) =>
        pricedLine(`line-${String(index).padStart(2, "0")}`, { title: `Ligne ${index}`, offer_choice: provisional(long) }));
      const exclusions = "Réseaux enterrés non compris.";
      const result = await evaluate(lines, { exclusions });
      const missingFlag = result.blockingFlags.find((flag) => flag.key === "provisional_quantity_mention_missing");
      const written = planProvisionalQuantityMentions(exclusions, lines.map((line) =>
        composeProvisionalQuantityMention(line, line.offer_choice as never)!)).text;
      expect(written.length).toBeGreaterThan(5000);
      expect(missingFlag?.details).toEqual({ limits_overflow: { missing_characters: written.length - 5000, limit: 5000 } });
      expect(() => resolveEstimateSendOverride(result, true)).toThrow(expect.objectContaining({
        code: "ESTIMATE_GATING_NOT_FORCEABLE",
        message: expect.stringContaining(`il manque ${written.length - 5000} caractères sur 5000`),
      }));
      // Under the bound, the flag says nothing of room.
      const fitting = await evaluate(lines.slice(0, 2), { exclusions });
      expect(fitting.blockingFlags.find((flag) => flag.key === "provisional_quantity_mention_missing")?.details).toBeUndefined();
    });

    it("reads no provisional quantity on engines 1 and 2, nor a choice the line's status does not fit", async () => {
      for (const engine of [1, 2]) {
        const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional() })], { engine });
        expect(keys(result), String(engine)).toEqual({ blocking: [], warning: [] });
      }
      const unpriced = await evaluate([pricedLine("line-unpriced", { pricing_status: "not_priced", was_not_priced: true,
        offer_choice: provisional() })], { exclusions: "Limites." });
      expect(keys(unpriced)).toEqual({ blocking: ["not_priced_unclassified"], warning: [] });
    });

    it("never warns of a provisional sentence on engines 1 and 2, where no line declares one", async () => {
      for (const engine of [1, 2]) {
        const result = await evaluate([pricedLine("line-provisional", { offer_choice: provisional() })],
          { engine, exclusions: sentence });
        expect(keys(result), String(engine)).toEqual({ blocking: [], warning: [] });
      }
    });
  });
  // The whole outcome of the send control, its loads and their order, as observed before the function was split into
  // named steps (refactor wave of 2026-11-16): every flag, its place in the result, its details, and every query.
  describe("send control outcome, loads and their order", () => {
    type GatingInput = Parameters<typeof evaluateEstimateSendGating>[0];
    const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
    // A version whose project id differs from the project's tells apart which of the two each read and flag uses.
    const VERSION_PROJECT_ID = "66666666-6666-4666-8666-666666666666";
    const EMPTY_REGISTER = {
      openQuestionsCount: 0, criticalOpenEntries: [], nonCriticalOpenEntries: [], clarifyWithClientEntries: [],
      openAssumptionEntries: [], openMissingPieceEntries: [],
    };
    const cleanLine = (id = "line-clean", extra: Record<string, unknown> = {}) => ({
      ...createLineItem({ id, quantity: 1, unitPriceHtCents: 5000 }), ...extra,
    });
    const evaluate = (options: {
      items?: unknown[];
      marginTiers?: unknown[];
      documents?: unknown[];
      supplierPrices?: unknown[];
      errors?: Parameters<typeof createSupabaseGatingMock>[0]["errors"];
      version?: Record<string, unknown>;
      project?: Record<string, unknown>;
      supabase?: unknown;
    } = {}) => evaluateEstimateSendGating({
      supabase: (options.supabase ?? createSupabaseGatingMock({
        items: options.items ?? [cleanLine()],
        marginTiers: options.marginTiers ?? [],
        documents: options.documents ?? [{ id: "doc-1" }],
        supplierPrices: options.supplierPrices,
        errors: options.errors,
      })) as never,
      tenantId: TENANT_ID,
      version: {
        id: VERSION_ID, margin_mode: "fixed", margin_multiplier: 1, total_ht_cents: 10000, project_id: PROJECT_ID,
        ...options.version,
      } as GatingInput["version"],
      project: { id: PROJECT_ID, client_name: "Client A", notes: null, ...options.project } as GatingInput["project"],
    });
    const keys = (result: Awaited<ReturnType<typeof evaluate>>) => ({
      blocking: result.blockingFlags.map((flag) => flag.key), warning: result.warningFlags.map((flag) => flag.key),
    });
    const format = (args: unknown[]) => args.map((arg) => JSON.stringify(arg)).join(", ");
    /** The existing fake, with each query it receives written down as one line, in the order the queries start. */
    function recordQueries(supabase: ReturnType<typeof createSupabaseGatingMock>, log: string[]) {
      const wrap = (target: object, index: number): object => new Proxy(target, {
        get(object, property, receiver) {
          const value = Reflect.get(object, property, receiver);
          if (typeof value !== "function" || property === "then") return value;
          return (...args: unknown[]) => {
            log[index] += `.${String(property)}(${format(args)})`;
            const result = value.apply(object, args);
            return result && typeof result === "object" && !(result instanceof Promise) ? wrap(result, index) : result;
          };
        },
      });
      return {
        rpc: (...args: unknown[]) =>
          wrap((supabase.rpc as (...rpcArgs: unknown[]) => object)(...args), log.push(`rpc(${format(args)})`) - 1),
        from: (table: string) => wrap(supabase.from(table), log.push(`from(${format([table])})`) - 1),
      };
    }
    const violation = (ruleId: string, action: "block" | "warn") => ({
      rule_id: ruleId, rule_type: "min_margin" as const, scope_type: "global" as const, scope_id: null, threshold_value: 1200,
      action, severity: action === "block" ? "blocking" as const : "warning" as const, metric_key: "margin_bp" as const,
      actual_value: 900, comparator: ">=" as const, approval_status: null, approval_id: null, approval_created_at: null,
      approval_decided_at: null, source_state: "ready" as const, message: `Violation ${ruleId}.`,
    });
    const violationDetails = (ruleId: string, action: "block" | "warn") => ({
      rule_id: ruleId, rule_type: "min_margin", scope_type: "global", scope_id: null, threshold_value: 1200, action,
      metric_key: "margin_bp", actual_value: 900, comparator: ">=", approval_status: null, approval_id: null,
      approval_created_at: null, approval_decided_at: null, source_state: "ready", message: `Violation ${ruleId}.`,
    });
    const unavailable = (ruleId: string, action: "block" | "warn" | "require_approval") => ({
      rule_id: ruleId, rule_type: "critical_exceptions_max" as const, scope_type: "global" as const, scope_id: null,
      threshold_value: 0, action, metric_key: "critical_exceptions_count" as const, comparator: "<=" as const,
      source_state: "unavailable" as const, message: `Signal ${ruleId} indisponible.`,
    });
    const unavailableDetails = (ruleId: string, action: string) => ({
      rule_id: ruleId, rule_type: "critical_exceptions_max", scope_type: "global", scope_id: null, threshold_value: 0,
      action, metric_key: "critical_exceptions_count", comparator: "<=", source_state: "unavailable",
      message: `Signal ${ruleId} indisponible.`,
    });
    const registerEntry = (id: string, kind: "missing_piece" | "assumption", status: "open" | "clarify_with_client",
      severity: "critical" | "warning") => ({ id, kind, severity, status, text: `Entrée ${id}`, scopeLabel: "Affaire test" });
    const href = (query: string) => `/dashboard/affaires/${PROJECT_ID}?${query}`;

    it("lets a clean estimate leave with no flag, the tenant's stale-price delay and the time of the check", async () => {
      vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(45);
      const before = Date.now();
      const result = await evaluate();
      expect(result).toEqual({
        canSend: true, blockingFlags: [], warningFlags: [], stalePriceDays: 45, checkedAt: expect.any(String),
      });
      expect(new Date(result.checkedAt).toISOString()).toBe(result.checkedAt);
      expect(Date.parse(result.checkedAt)).toBeGreaterThanOrEqual(before);
    });

    it("lets an estimate with warnings only leave", async () => {
      const result = await evaluate({
        items: [cleanLine("line-stale", { selected_supplier_price_id: "sp-old" })],
        supplierPrices: [{ id: "sp-old", updated_at: "2025-01-01T00:00:00.000Z", created_at: "2025-01-01T00:00:00.000Z" }],
      });
      expect(result.canSend).toBe(true);
      expect(keys(result)).toEqual({ blocking: [], warning: ["supplier_price_outdated"] });
    });

    it("scopes every query and read to the tenant and version, and reads the selected supplier prices once each", async () => {
      const log: string[] = [];
      vi.mocked(fetchAffaireRegisterGateSummary).mockImplementation(async (input) => {
        log.push(`fetchAffaireRegisterGateSummary(${format([input.projectId, input.versionId])})`);
        return EMPTY_REGISTER;
      });
      vi.mocked(fetchVersionZeroDraftSummary).mockImplementation(async (input) => {
        log.push(`fetchVersionZeroDraftSummary(${format([input.versionId])})`);
        return null as never;
      });
      vi.mocked(getStalePriceDaysForTenant).mockImplementation(async (tenantId) => {
        log.push(`getStalePriceDaysForTenant(${format([tenantId])})`);
        return 90;
      });
      vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (tenantId, key) => {
        log.push(`getFeatureFlagValueForTenant(${format([tenantId, key])})`);
        return null;
      });
      const evidence = { source: "draft_calculation" } as never;
      vi.mocked(loadCanonicalFixedDiscountEvidence).mockImplementation(async () => {
        log.push("loadCanonicalFixedDiscountEvidence");
        return evidence;
      });
      vi.mocked(evaluateRules).mockImplementation(async () => {
        log.push("evaluateRules");
        return { violations: [], blockingViolations: [], warningViolations: [], unavailableSignals: [] };
      });
      const supabase = recordQueries(createSupabaseGatingMock({
        items: [
          cleanLine("line-b", { selected_supplier_price_id: "sp-1", category_id: "cat-1" }),
          cleanLine("line-a", { selected_supplier_price_id: "sp-1", category_id: null }),
          cleanLine("line-c", { selected_supplier_price_id: "sp-2", category_id: "cat-2" }),
          cleanLine("line-d", { selected_supplier_price_id: "", category_id: "cat-2" }),
          { id: "section-1", item_type: "section", selected_supplier_price_id: "sp-3", category_id: "cat-3" },
        ],
        marginTiers: [],
        documents: [{ id: "doc-1" }],
        supplierPrices: [],
      }), log);
      const version = {
        id: VERSION_ID, project_id: VERSION_PROJECT_ID, margin_mode: "fixed", margin_multiplier: 1.25, margin_bp: 2000,
        discount_bp: 150, discount_amount_cents: 500, tenant_id: TENANT_ID, status: "draft",
        updated_at: "2026-11-16T08:00:00.000Z", calc_engine_version: 2, content_revision: 4,
        calc_snapshot_content_revision: 4, calc_snapshot_context: { effective_margin_multiplier: 1.25 },
        total_ht_cents: 10000, exclusions: null,
      };

      await evaluate({ supabase, version, project: { user_id: "owner-1" } });

      expect([...log].sort()).toEqual([
        `rpc("read_estimate_version_items", {"p_tenant_id":"${TENANT_ID}","p_version_id":"${VERSION_ID}"}, {"count":"exact","get":true})`
          + `.order("position", {"ascending":true}).order("id", {"ascending":true}).range(0, 499)`,
        `from("margin_tiers").select("id", {"count":"exact"}).eq("tenant_id", "${TENANT_ID}")`
          + `.order("threshold_cents", {"ascending":true}).order("position", {"ascending":true})`,
        `from("estimate_documents").select("id").eq("tenant_id", "${TENANT_ID}").eq("version_id", "${VERSION_ID}").limit(1)`,
        `fetchAffaireRegisterGateSummary("${PROJECT_ID}", "${VERSION_ID}")`,
        `fetchVersionZeroDraftSummary("${VERSION_ID}")`,
        `getStalePriceDaysForTenant("${TENANT_ID}")`,
        `getFeatureFlagValueForTenant("${TENANT_ID}", "ESTIMATE_GATING_BLOCKING_FLAGS")`,
        `getFeatureFlagValueForTenant("${TENANT_ID}", "ESTIMATE_GATING_WARNING_FLAGS")`,
        `from("supplier_pricebook").select("id, updated_at, created_at", {"count":"exact"}).eq("tenant_id", "${TENANT_ID}")`
          + `.in("id", ["sp-1","sp-2"])`,
        "loadCanonicalFixedDiscountEvidence",
        "evaluateRules",
      ].sort());
      expect(vi.mocked(fetchAffaireRegisterGateSummary).mock.calls[0]?.[0].supabase).toBe(supabase);
      expect(vi.mocked(getFeatureFlagValueForTenant).mock.calls.map((call) => call[2]?.supabase)).toEqual([supabase, supabase]);
      expect(vi.mocked(getStalePriceDaysForTenant).mock.calls[0]?.[1]?.supabase).toBe(supabase);
      expect(vi.mocked(loadCanonicalFixedDiscountEvidence).mock.calls[0]?.[0]).toStrictEqual({
        supabase, tenantId: TENANT_ID, projectUserId: "owner-1", authorizedVersion: version,
      });
      expect(vi.mocked(evaluateRules).mock.calls[0]?.[0]).toStrictEqual({
        supabase,
        tenantId: TENANT_ID,
        fixedDiscountEvidence: evidence,
        version: {
          id: VERSION_ID, project_id: VERSION_PROJECT_ID, margin_bp: 2000, margin_multiplier: 1.25, margin_mode: "fixed",
          discount_bp: 150, discount_amount_cents: 500, tenant_id: TENANT_ID, status: "draft",
          updated_at: "2026-11-16T08:00:00.000Z", calc_engine_version: 2, content_revision: 4,
          calc_snapshot_content_revision: 4, calc_snapshot_context: { effective_margin_multiplier: 1.25 }, total_ht_cents: 10000,
        },
        project: { id: PROJECT_ID, client_name: "Client A" },
        items: [
          { id: "line-b", category_id: "cat-1", item_type: "line" },
          { id: "line-a", category_id: null, item_type: "line" },
          { id: "line-c", category_id: "cat-2", item_type: "line" },
          { id: "line-d", category_id: "cat-2", item_type: "line" },
        ],
      });
    });

    it("reads no supplier price when no line selected one", async () => {
      const log: string[] = [];
      const supabase = recordQueries(createSupabaseGatingMock({
        items: [cleanLine(), { id: "section-1", item_type: "section", selected_supplier_price_id: "sp-3" }],
        marginTiers: [], documents: [{ id: "doc-1" }],
      }), log);
      await evaluate({ supabase });
      expect(log.map((entry) => entry.slice(0, entry.indexOf(")") + 1)).sort()).toEqual([
        `rpc("read_estimate_version_items", {"p_tenant_id":"${TENANT_ID}","p_version_id":"${VERSION_ID}"}, {"count":"exact","get":true})`,
        `from("margin_tiers")`,
        `from("estimate_documents")`,
      ].sort());
    });

    const fixedDiscountVersion = {
      discount_amount_cents: 500, tenant_id: TENANT_ID, status: "draft", updated_at: "2026-11-16T08:00:00.000Z",
      content_revision: 4,
    };
    it.each([
      ["no fixed discount", { discount_amount_cents: null }, {}],
      ["a version read without its fixed discount", { discount_amount_cents: undefined }, {}],
      ["a project read without its owner", {}, { user_id: undefined }],
      ["a project without an owner", {}, { user_id: null }],
      ["a version of another tenant", { tenant_id: "33333333-3333-4333-8333-333333333333" }, {}],
      ["a version read without its status", { status: undefined }, {}],
      ["a version read without its update time", { updated_at: undefined }, {}],
      ["a version read without its content revision", { content_revision: undefined }, {}],
    ])("hands the rules no fixed discount evidence, and reads none, for %s", async (_label, version, project) => {
      await evaluate({ version: { ...fixedDiscountVersion, ...version }, project: { user_id: "owner-1", ...project } });
      expect(loadCanonicalFixedDiscountEvidence).not.toHaveBeenCalled();
      expect(vi.mocked(evaluateRules).mock.calls[0]?.[0].fixedDiscountEvidence).toBeNull();
    });

    it("reads the fixed discount evidence for a discount of 0 too, and hands the rules what it read", async () => {
      vi.mocked(loadCanonicalFixedDiscountEvidence).mockResolvedValue(null);
      await evaluate({ version: { ...fixedDiscountVersion, discount_amount_cents: 0 }, project: { user_id: "owner-1" } });
      expect(loadCanonicalFixedDiscountEvidence).toHaveBeenCalledTimes(1);
      expect(vi.mocked(evaluateRules).mock.calls[0]?.[0].fixedDiscountEvidence).toBeNull();
    });

    it("assembles every family of flags in a fixed order, with their categories, labels and details", async () => {
      vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(30);
      vi.mocked(fetchVersionZeroDraftSummary).mockResolvedValue({
        activeDraft: { id: "draft-1", counts: { pending: 3 }, selectedLots: ["CVC", "PLB"] },
      } as never);
      vi.mocked(evaluateRules).mockResolvedValue({
        violations: [violation("rule-block", "block"), violation("rule-warn", "warn")],
        blockingViolations: [violation("rule-block", "block")],
        warningViolations: [violation("rule-warn", "warn")],
        unavailableSignals: [unavailable("signal-warn", "warn"), unavailable("signal-block", "block"),
          unavailable("signal-approval", "require_approval")],
      });
      vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
        ...EMPTY_REGISTER,
        criticalOpenEntries: [
          registerEntry("reg-critical-question", "assumption", "open", "critical"),
          registerEntry("reg-critical-piece", "missing_piece", "open", "critical"),
        ],
        clarifyWithClientEntries: [
          registerEntry("reg-clarify-question", "assumption", "clarify_with_client", "warning"),
          registerEntry("reg-clarify-piece-b", "missing_piece", "clarify_with_client", "warning"),
          registerEntry("reg-clarify-piece-a", "missing_piece", "clarify_with_client", "warning"),
        ],
        nonCriticalOpenEntries: [
          registerEntry("reg-open-piece", "missing_piece", "open", "warning"),
          registerEntry("reg-open-question", "assumption", "open", "warning"),
        ],
      } as never);

      const result = await evaluate({
        items: [
          { ...createLineItem({ id: "line-missing-price", quantity: 1, unitPriceHtCents: 0 }), pricing_status: "priced" },
          cleanLine("line-stale", { selected_supplier_price_id: "sp-old", pricing_status: "priced" }),
          { ...createLineItem({ id: "line-not-priced", quantity: 1, unitPriceHtCents: 0, laborHours: 0, laborRoleId: null }),
            pricing_status: "not_priced", offer_choice: null },
        ],
        marginTiers: [],
        documents: [],
        supplierPrices: [{ id: "sp-old", updated_at: "2025-01-01T00:00:00.000Z", created_at: "2025-01-01T00:00:00.000Z" }],
        version: {
          margin_mode: "tiered", total_ht_cents: 10000, calc_engine_version: 3, exclusions: null, project_id: VERSION_PROJECT_ID,
        },
        project: { notes: "{\"budget_ht_cents\": 8000}" },
      });

      const meta = (key: string, severity: "blocking" | "warning", category: string, itemIds: string[],
        label: string, description: string, details?: Record<string, unknown>) =>
        ({ key, category, severity, count: itemIds.length, item_ids: itemIds, label, description, details });
      expect(result.canSend).toBe(false);
      expect(result.stalePriceDays).toBe(30);
      expect(result.blockingFlags).toStrictEqual([
        meta("missing_price", "blocking", "estimate_quality", ["line-missing-price"], "Prix manquant",
          expect.any(String)),
        meta("margin_not_configured", "blocking", "estimate_quality", [VERSION_ID], "Marge par tranches non configurée",
          "Le mode de marge par tranches est actif mais aucune tranche n'est configurée pour cette organisation.",
          { margin_mode: "tiered", margin_tiers_count: 0 }),
        meta("total_exceeds_budget", "blocking", "estimate_quality", [VERSION_ID], "Budget dépassé",
          "Le total HT du devis dépasse le plafond budgétaire configuré pour le projet.",
          { total_ht_cents: 10000, budget_ceiling_ht_cents: 8000 }),
        meta("no_pdf_generated", "blocking", "pdf", [VERSION_ID], "PDF absent",
          "Aucun document PDF n'est généré pour cette version. Lancez une génération avant l'envoi."),
        meta("version_zero_review_pending", "blocking", "estimate_quality", [VERSION_ID], "V0 IA à revoir",
          "Une V0 assistée est encore active sur cette version. La revue humaine explicite doit être finalisée avant envoi.",
          { draft_id: "draft-1", pending_count: 3, selected_lots: ["CVC", "PLB"] }),
        meta("not_priced_unclassified", "blocking", "estimate_quality", ["line-not-priced"],
          "Lignes non chiffrées à classer", expect.any(String)),
        {
          key: "rule_violation", category: "approvals", severity: "blocking", count: 1, item_ids: [],
          label: "Règles métier non respectées",
          description: "Des règles métier (marge, remise, approbation) ne sont pas satisfaites.",
          details: { violations: [violationDetails("rule-block", "block")] },
        },
        {
          key: "rule_violation", category: "approvals", severity: "blocking", count: 2, item_ids: [],
          label: "Règles métier non respectées",
          description: "Des règles bloquantes ne peuvent pas être evaluees avec les preuves disponibles.",
          details: { unavailable_signals: [unavailableDetails("signal-block", "block"),
            unavailableDetails("signal-approval", "require_approval")] },
        },
        {
          key: "critical_missing_pieces", category: "documents", severity: "blocking", count: 1, item_ids: [],
          label: "Documents critiques manquants",
          description: "Des pièces critiques restent manquantes ou inexploitees dans le registre affaire.",
          details: { register_entries: [{ ...registerEntry("reg-critical-piece", "missing_piece", "open", "critical"),
            href: href("registerStatus=open&registerSeverity=critical&registerKind=missing_piece&registerFocus=reg-critical-piece") }] },
        },
        {
          key: "critical_open_questions", category: "register", severity: "blocking", count: 1, item_ids: [],
          label: "Questions critiques ouvertes",
          description: "Le registre affaire contient des hypothèses ou pièces manquantes critiques encore ouvertes.",
          details: { register_entries: [{ ...registerEntry("reg-critical-question", "assumption", "open", "critical"),
            href: href("registerStatus=open&registerSeverity=critical&registerKind=assumption&registerFocus=reg-critical-question") }] },
        },
        {
          key: "client_missing_documents_required", category: "documents", severity: "blocking", count: 2, item_ids: [],
          label: "Documents attendus du client",
          description: "Des pièces attendues du client restent nécessaires avant l'envoi.",
          details: { register_entries: [
            { ...registerEntry("reg-clarify-piece-b", "missing_piece", "clarify_with_client", "warning"),
              href: href("registerStatus=clarify_with_client&registerKind=missing_piece&registerFocus=reg-clarify-piece-b") },
            { ...registerEntry("reg-clarify-piece-a", "missing_piece", "clarify_with_client", "warning"),
              href: href("registerStatus=clarify_with_client&registerKind=missing_piece&registerFocus=reg-clarify-piece-a") },
          ] },
        },
        {
          key: "client_clarification_required", category: "register", severity: "blocking", count: 1, item_ids: [],
          label: "Clarification client requise",
          description: "Le registre affaire contient des points à clarifier avec le client avant l'envoi.",
          details: { register_entries: [{ ...registerEntry("reg-clarify-question", "assumption", "clarify_with_client", "warning"),
            href: href("registerStatus=clarify_with_client&registerKind=assumption&registerFocus=reg-clarify-question") }] },
        },
      ]);
      expect(result.warningFlags).toStrictEqual([
        meta("supplier_price_outdated", "warning", "estimate_quality", ["line-stale"], expect.any(String),
          expect.any(String), { stale_price_days: 30 }),
        {
          key: "rule_violation", category: "approvals", severity: "warning", count: 1, item_ids: [],
          label: "Règles métier non respectées",
          description: "Des règles métier (marge, remise, approbation) ne sont pas satisfaites.",
          details: { violations: [violationDetails("rule-warn", "warn")] },
        },
        {
          key: "rule_violation", category: "approvals", severity: "warning", count: 1, item_ids: [],
          label: "Règles métier non respectées",
          description: "Certaines règles d'avertissement ne peuvent pas être evaluees avec les preuves disponibles.",
          details: { unavailable_signals: [unavailableDetails("signal-warn", "warn")] },
        },
        {
          key: "missing_pieces_pending", category: "documents", severity: "warning", count: 1, item_ids: [],
          label: "Documents manquants à traiter",
          description: "Des pièces manquantes non critiques restent ouvertes dans le registre affaire.",
          details: { register_entries: [{ ...registerEntry("reg-open-piece", "missing_piece", "open", "warning"),
            href: href("registerStatus=open&registerKind=missing_piece&registerFocus=reg-open-piece") }] },
        },
        {
          key: "open_questions_pending", category: "register", severity: "warning", count: 1, item_ids: [],
          label: "Questions ouvertes à traiter",
          description: "Des hypothèses ou pièces manquantes non critiques restent ouvertes dans le registre affaire.",
          details: { register_entries: [{ ...registerEntry("reg-open-question", "assumption", "open", "warning"),
            href: href("registerStatus=open&registerKind=assumption&registerFocus=reg-open-question") }] },
        },
      ]);
    });

    it("keeps the register and rule flags at their own severity, whatever the tenant flags", async () => {
      vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => key === "ESTIMATE_GATING_BLOCKING_FLAGS"
        ? "missing_pieces_pending,open_questions_pending"
        : "rule_violation,critical_missing_pieces,critical_open_questions,client_missing_documents_required,client_clarification_required");
      vi.mocked(evaluateRules).mockResolvedValue({
        violations: [violation("rule-block", "block")], blockingViolations: [violation("rule-block", "block")],
        warningViolations: [], unavailableSignals: [unavailable("signal-block", "block")],
      });
      vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
        ...EMPTY_REGISTER,
        criticalOpenEntries: [registerEntry("reg-1", "missing_piece", "open", "critical"),
          registerEntry("reg-2", "assumption", "open", "critical")],
        clarifyWithClientEntries: [registerEntry("reg-3", "missing_piece", "clarify_with_client", "warning"),
          registerEntry("reg-4", "assumption", "clarify_with_client", "warning")],
        nonCriticalOpenEntries: [registerEntry("reg-5", "missing_piece", "open", "warning"),
          registerEntry("reg-6", "assumption", "open", "warning")],
      } as never);
      const result = await evaluate();
      expect(result.blockingFlags.map((flag) => [flag.key, flag.severity])).toEqual([
        ["rule_violation", "blocking"], ["rule_violation", "blocking"], ["critical_missing_pieces", "blocking"],
        ["critical_open_questions", "blocking"], ["client_missing_documents_required", "blocking"],
        ["client_clarification_required", "blocking"],
      ]);
      expect(result.warningFlags.map((flag) => [flag.key, flag.severity])).toEqual([
        ["missing_pieces_pending", "warning"], ["open_questions_pending", "warning"],
      ]);
    });

    it("moves a line flag the tenant made blocking to the blocking flags, with its details", async () => {
      vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(30);
      vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) =>
        key === "ESTIMATE_GATING_BLOCKING_FLAGS" ? "supplier_price_outdated" : null);
      const result = await evaluate({
        items: [cleanLine("line-stale", { selected_supplier_price_id: "sp-old" }),
          cleanLine("line-fresh", { selected_supplier_price_id: "sp-new" })],
        supplierPrices: [
          { id: "sp-old", updated_at: "2025-01-01T00:00:00.000Z", created_at: "2025-01-01T00:00:00.000Z" },
          { id: "sp-new", updated_at: new Date().toISOString(), created_at: "2025-01-01T00:00:00.000Z" },
        ],
      });
      expect(result.canSend).toBe(false);
      expect(keys(result)).toEqual({ blocking: ["supplier_price_outdated"], warning: [] });
      expect(result.blockingFlags[0]).toMatchObject({
        severity: "blocking", item_ids: ["line-stale"], details: { stale_price_days: 30 },
      });
    });

    it("judges a selected supplier price by the tenant's stale-price delay", async () => {
      vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(30);
      const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const result = await evaluate({
        items: [cleanLine("line-60-days", { selected_supplier_price_id: "sp-60-days" }),
          cleanLine("line-29-days", { selected_supplier_price_id: "sp-29-days" })],
        supplierPrices: [
          // Older than the tenant's 30 days, younger than the default 90: stale.
          { id: "sp-60-days", updated_at: daysAgo(60), created_at: daysAgo(400) },
          // Just inside the tenant's 30 days: fresh.
          { id: "sp-29-days", updated_at: daysAgo(29), created_at: daysAgo(400) },
        ],
      });
      expect(result.canSend).toBe(true);
      expect(result.warningFlags).toEqual([expect.objectContaining({
        key: "supplier_price_outdated", count: 1, item_ids: ["line-60-days"], details: { stale_price_days: 30 },
      })]);
    });

    it.each([
      ["no notes", null, null],
      ["blank notes", "  \n ", null],
      ["free text without a budget", "Client pressé, relancer lundi.", null],
      ["a JSON budget, rounded", "{\"budget_ht_cents\": 5000.4}", 5000],
      ["a JSON budget written as text", "{\"budget_ht_cents\": \" 6000 \"}", 6000],
      ["a JSON budget ceiling", "{\"budget_ceiling_ht_cents\": 7000}", 7000],
      ["a JSON total budget", "{\"total_budget_ht_cents\": 8000}", 8000],
      ["the first JSON budget field before the others", "{\"budget_ht_cents\": 4000, \"budget_ceiling_ht_cents\": 9000}", 4000],
      ["a negative JSON budget, which stops the reading", "{\"budget_ht_cents\": -1, \"budget_ceiling_ht_cents\": 5000}", null],
      ["an unreadable JSON budget, skipped for the next field", "{\"budget_ht_cents\": \"abc\", \"budget_ceiling_ht_cents\": 5000}", 5000],
      ["a JSON array", "[5000]", null],
      ["a JSON object without a budget", "{\"other\": 1}", null],
      ["a budget written in free text", "Budget client : budget_ht_cents = 9000 (oral)", 9000],
      ["a budget ceiling written in free text, whatever its case", "BUDGET_CEILING_HT_CENTS:9500", 9500],
      ["a budget equal to the total", "{\"budget_ht_cents\": 10000}", null],
      ["a budget above the total", "{\"budget_ht_cents\": 20000}", null],
    ])("reads the project budget from %s", async (_label, notes, ceiling) => {
      const result = await evaluate({ project: { notes }, version: { total_ht_cents: 10000 } });
      const flag = result.blockingFlags.find((candidate) => candidate.key === "total_exceeds_budget");
      if (ceiling === null) {
        expect(flag).toBeUndefined();
        expect(result.canSend).toBe(true);
        return;
      }
      expect(flag).toMatchObject({ item_ids: [VERSION_ID], details: { total_ht_cents: 10000, budget_ceiling_ht_cents: ceiling } });
    });

    it("leaves the margin alone when tiers exist or the margin is not tiered", async () => {
      expect(keys(await evaluate({ version: { margin_mode: "tiered" }, marginTiers: [{ id: "tier-1" }] })).blocking).toEqual([]);
      expect(keys(await evaluate({ version: { margin_mode: "fixed" }, marginTiers: [] })).blocking).toEqual([]);
    });

    it("waits for no V0 review once the draft is closed, and goes on when the V0 summary cannot be read", async () => {
      vi.mocked(fetchVersionZeroDraftSummary).mockResolvedValueOnce({ activeDraft: null } as never);
      expect(keys(await evaluate())).toEqual({ blocking: [], warning: [] });
      vi.mocked(fetchVersionZeroDraftSummary).mockRejectedValueOnce(new Error("no request scope"));
      const unreadable = await evaluate();
      expect(unreadable.canSend).toBe(true);
      expect(keys(unreadable)).toEqual({ blocking: [], warning: [] });
    });

    it.each([
      ["margin tiers", { marginTiers: { code: "XX000", message: "boom" } }, "Impossible de charger les tranches de marge."],
      ["documents", { documents: { code: "XX000", message: "boom" } }, "Impossible de charger les documents de la version."],
      ["margin tiers before documents", { marginTiers: { code: "XX000", message: "a" }, documents: { code: "XX000", message: "b" } },
        "Impossible de charger les tranches de marge."],
      ["supplier prices", { supplierPrices: { code: "XX000", message: "boom" } },
        "Impossible de charger les prix fournisseurs sélectionnés."],
    ])("refuses to judge when the %s cannot be read, before any rule", async (_label, errors, message) => {
      await expect(evaluate({
        items: [cleanLine("line-1", { selected_supplier_price_id: "sp-1" })], errors,
      })).rejects.toMatchObject({ status: 400, code: "BAD_REQUEST", message });
      expect(evaluateRules).not.toHaveBeenCalled();
    });

    it("maps a refused read the way every estimate read does", async () => {
      await expect(evaluate({ errors: { marginTiers: { code: "42501", message: "permission denied" } } }))
        .rejects.toMatchObject({ status: 403, code: "FORBIDDEN", message: "Accès refusé." });
    });
  });
});
