import { beforeEach, describe, expect, it, vi } from "vitest";

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

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
};

function createOrderBuilder(result: QueryResult, requiredOrders = 1) {
  let orderCallCount = 0;
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.order.mockImplementation(() => {
    orderCallCount += 1;
    if (orderCallCount >= requiredOrders) {
      return Promise.resolve(result);
    }
    return builder;
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
    },
    1
  );
  const marginTiersBuilder = createOrderBuilder(
    {
      data: input.marginTiers,
      error: null,
    },
    2
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
    from: vi.fn((table: string) => {
      if (table === "estimate_items") {
        return {
          select: vi.fn(() => estimateItemsBuilder),
        };
      }
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
}) {
  return {
    id: input.id,
    item_type: "line",
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
    });
    vi.mocked(evaluateRules).mockResolvedValue({
      violations: [],
      blockingViolations: [],
      warningViolations: [],
      unavailableSignals: [],
    });
  });

  it("returns canSend=true when no flags are raised", async () => {
    const supabase = createSupabaseGatingMock({
      items: [createLineItem({ id: "line-1", quantity: 2, unitPriceHtCents: 5000 })],
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
    expect(result.warningFlags).toHaveLength(0);
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
        margin_mode: "fixed",
        margin_multiplier: 1,
        margin_bp: 900,
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
          key: "rule_violation",
          severity: "blocking",
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
          key: "critical_open_questions",
          count: 1,
        }),
        expect.objectContaining({
          key: "client_clarification_required",
          count: 1,
        }),
      ])
    );
    expect(result.warningFlags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "open_questions_pending",
          count: 1,
        }),
      ])
    );
  });
});
