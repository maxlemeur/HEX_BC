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

vi.mock("@/lib/affaires/register-server", () => ({
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

import {
  evaluateEstimateSendGating,
} from "@/lib/estimates/gating";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import { evaluateRules } from "@/lib/estimates/rules-engine";
import { resolveEstimateSendOverride } from "@/lib/estimates/version-lifecycle-plan";
import { appendProvisionalQuantityMentions, composeProvisionalQuantityMention } from "@/lib/estimates/provisional-quantity";

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
}) {
  const estimateItemsBuilder = createOrderBuilder(
    {
      data: input.items,
      error: null,
    }
  );
  const marginTiersBuilder = createOrderBuilder(
    {
      data: input.marginTiers,
      error: null,
    }
  );
  const estimateDocumentsBuilder = {
    eq: vi.fn(),
    limit: vi.fn().mockResolvedValue({
      data: input.documents,
      error: null,
    }),
  };
  estimateDocumentsBuilder.eq.mockReturnValue(estimateDocumentsBuilder);

  const supplierPricesBuilder = {
    eq: vi.fn(),
    in: vi.fn().mockResolvedValue({
      data: input.supplierPrices ?? [],
      error: null,
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
      const written = appendProvisionalQuantityMentions(exclusions, lines.map((line) =>
        composeProvisionalQuantityMention(line, line.offer_choice as never)!));
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
  });
});
