import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockServiceRoleRpc } = vi.hoisted(() => ({
  mockServiceRoleRpc: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(() => ({ rpc: mockServiceRoleRpc })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/estimates/canonical-v2-creation", () => ({
  instantiateCanonicalEstimateV2FromTemplate: vi.fn(),
  persistCanonicalEstimateV2: vi.fn(),
}));

vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlagValueForTenant: vi.fn().mockResolvedValue(null),
  getStalePriceDaysForTenant: vi.fn().mockResolvedValue(90),
}));

import { buildEstimateSupplierPreselectionReview, createEstimateItem, createMarginTier, deleteEstimateItem, duplicateEstimateTemplate, getEstimateSupplierComparisons, instantiateEstimateFromTemplate, listEstimateVersionVariants, listLatestEstimates, moveEstimateItem, reorderEstimateItems, updateEstimateItem } from "@/lib/estimates/server";
import {
  getFeatureFlagValueForTenant,
  getStalePriceDaysForTenant,
} from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  instantiateCanonicalEstimateV2FromTemplate,
  persistCanonicalEstimateV2,
} from "@/lib/estimates/canonical-v2-creation";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const TEMPLATE_COPY_ID = "66666666-6666-4666-8666-666666666666";

type PostgrestErrorLike = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
};

type QueryResult<T = unknown> = {
  data: T;
  error: PostgrestErrorLike | null;
  count?: number | null;
};

function chainResult<T>(result: QueryResult<T>) {
  const builder = {
    ...result,
    eq: vi.fn(),
    in: vi.fn(),
    is: vi.fn(),
    gt: vi.fn(),
    or: vi.fn(),
    ilike: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
    select: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.in.mockReturnValue(builder);
  builder.is.mockReturnValue(builder);
  builder.gt.mockReturnValue(builder);
  builder.or.mockReturnValue(builder);
  builder.ilike.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.range.mockReturnValue(builder);
  builder.single.mockReturnValue(builder);
  builder.maybeSingle.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);

  return builder;
}

function createMembershipBuilder(
  role: "admin" | "engineer" | "director" = "engineer"
) {
  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };
  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockReturnValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role,
        is_default: true,
        created_at: "2026-02-22T12:00:00.000Z",
      },
    ],
    error: null,
  });
  return membershipBuilder;
}

function createAuth(role: "admin" | "engineer" | "director" = "engineer") {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
          },
        },
        error: null,
      }),
    },
    __membershipBuilder: createMembershipBuilder(role),
  };
}

function createVersionAccessBuilder(
  overrides: Partial<{
    id: string;
    project_id: string;
    parent_version_id: string | null;
    variant_label: string | null;
    max_section_depth: number;
  }> = {}
) {
  const versionId = overrides.id ?? VERSION_ID;
  const projectId = overrides.project_id ?? PROJECT_ID;

  const versionBuilder = {
    eq: vi.fn(),
    single: vi.fn(),
  };
  versionBuilder.eq.mockReturnValue(versionBuilder);
  versionBuilder.single.mockReturnValue({
    data: {
      id: versionId,
      project_id: projectId,
      status: "draft",
      margin_mode: "fixed",
      margin_multiplier: 1,
      max_section_depth: overrides.max_section_depth ?? 2,
      tax_rate_bp: 2000,
      updated_at: "2026-02-22T12:00:00.000Z",
      total_ht_cents: 12000,
      total_tax_cents: 2400,
      total_ttc_cents: 14400,
      parent_version_id: overrides.parent_version_id ?? null,
      variant_label: overrides.variant_label ?? null,
      estimate_projects: {
        id: projectId,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Projet",
        reference: null,
        client_name: null,
        notes: null,
        is_archived: false,
      },
    },
    error: null,
  });
  return versionBuilder;
}

function createDraftLockBuilder(userId: string | null = USER_ID) {
  return chainResult({
    data:
      userId === null
        ? null
        : {
            id: "lock-1",
            version_id: VERSION_ID,
            user_id: userId,
            locked_at: "2026-02-22T12:00:00.000Z",
            expires_at: "2099-02-22T12:00:00.000Z",
          },
    error: null,
  });
}

describe("estimate server coverage additions", () => {
  it.each([
    ["create", () => createEstimateItem(VERSION_ID, { item_type: "section", title: "Lot" }, "2026-02-22T11:00:00.000Z")],
    ["update", () => updateEstimateItem(VERSION_ID, { id: "item-1", title: "Lot" }, "2026-02-22T11:00:00.000Z")],
    ["delete", () => deleteEstimateItem(VERSION_ID, { id: "item-1" }, "2026-02-22T11:00:00.000Z")],
    ["reorder", () => reorderEstimateItems(VERSION_ID, { ordered_ids: ["item-1"] }, "2026-02-22T11:00:00.000Z")],
    ["move", () => moveEstimateItem(VERSION_ID, { item_id: "item-1", from_parent_id: null, to_parent_id: "lot", ordered_source_ids: [], ordered_target_ids: ["item-1"] }, "2026-02-22T11:00:00.000Z")],
  ] as const)("rejects stale %s before any item write", async (_name, run) => {
    const base = createAuth("engineer");
    const access = createVersionAccessBuilder();
    const from = vi.fn((table: string) => {
      if (table === "tenant_memberships") return { select: () => base.__membershipBuilder };
      if (table === "estimate_versions") return { select: () => access };
      throw new Error(`Unexpected write or lock lookup: ${table}`);
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ ...base, from } as never);
    await expect(run()).rejects.toMatchObject({ status: 409, code: "VERSION_CONFLICT" });
    expect(from).not.toHaveBeenCalledWith("estimate_items");
  });

  beforeEach(() => {
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
    vi.clearAllMocks();
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue(null);
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(90);
    vi.mocked(instantiateCanonicalEstimateV2FromTemplate).mockResolvedValue({
      project: { id: PROJECT_ID },
      version: { id: TEMPLATE_COPY_ID },
      insertedLineCount: 1,
      insertedSectionCount: 0,
      rootSectionId: null,
    } as never);
    vi.mocked(persistCanonicalEstimateV2).mockResolvedValue({
      project: { id: PROJECT_ID, name: "Projet test" },
      version: {
        id: VERSION_ID,
        project_id: PROJECT_ID,
        status: "draft",
      },
      insertedLineCount: 0,
      insertedSectionCount: 0,
      rootSectionId: null,
    } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists latest estimates and keeps only the newest version per project", async () => {
    const base = createAuth("engineer");

    const estimateVersionsBuilder = chainResult({
      data: [
        {
          id: "v2",
          project_id: "p1",
          version_number: 2,
          status: "draft",
          title: "v2",
          updated_at: "2026-02-22T10:00:00.000Z",
          total_ht_cents: 2000,
          currency: "EUR",
          estimate_projects: {
            id: "p1",
            name: "Projet 1",
            reference: "REF-1",
            client_name: "Client 1",
            is_archived: false,
          },
        },
        {
          id: "v1",
          project_id: "p1",
          version_number: 1,
          status: "draft",
          title: "v1",
          updated_at: "2026-02-21T10:00:00.000Z",
          total_ht_cents: 1500,
          currency: "USD",
          estimate_projects: {
            id: "p1",
            name: "Projet 1",
            reference: "REF-1",
            client_name: "Client 1",
            is_archived: false,
          },
        },
        {
          id: "v3",
          project_id: "p2",
          version_number: 3,
          status: "sent",
          title: "v3",
          updated_at: "2026-02-22T09:00:00.000Z",
          total_ht_cents: 3000,
          currency: "GBP",
          estimate_projects: {
            id: "p2",
            name: "Projet 2",
            reference: null,
            client_name: null,
            is_archived: false,
          },
        },
      ],
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => estimateVersionsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listLatestEstimates();

    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      project_id: "p1",
      version_id: "v2",
      currency: "EUR",
    });
    expect(result.items[1]).toMatchObject({
      project_id: "p2",
      version_id: "v3",
      currency: "GBP",
    });
    expect(estimateVersionsBuilder.eq).toHaveBeenCalledWith(
      "estimate_projects.user_id",
      USER_ID
    );
  });

  it("returns supplier comparison coverage states, risk flags and selected alternative details", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const estimateItemsBuilder = chainResult({
      data: [
        {
          id: "item-stale",
          item_type: "line",
          title: "Tube acier",
          selected_supplier_price_id: "price-old",
          quantity: 30,
          description: "u",
        },
        {
          id: "item-missing",
          item_type: "line",
          title: "Sans match",
          selected_supplier_price_id: null,
          quantity: 30,
          description: "u",
        },
      ],
      error: null,
    });
    const productsBuilders = [
      chainResult({
        data: [
          {
            id: "product-1",
            designation: "Tube acier",
            reference: "TUBE-001",
          },
        ],
        error: null,
      }),
      chainResult({
        data: [
          {
            id: "product-1",
            designation: "Tube acier",
            reference: "TUBE-001",
          },
        ],
        error: null,
      }),
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: [
          {
            id: "product-1",
            designation: "Tube acier",
            reference: "TUBE-001",
          },
        ],
        error: null,
      }),
    ];
    // Prefix + contains searches for two queries, then matched-price hydration.
    productsBuilders.splice(3, 0, chainResult({ data: [], error: null }));
    const suppliersBuilders = [
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: [
          { id: "supplier-old", name: "Old Supplier" },
          { id: "supplier-best", name: "Best Supplier" },
          { id: "supplier-preferred", name: "Preferred Supplier" },
          { id: "supplier-recent", name: "Recent Supplier" },
        ],
        error: null,
      }),
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: [
          { id: "supplier-old", name: "Old Supplier" },
          { id: "supplier-best", name: "Best Supplier" },
          { id: "supplier-preferred", name: "Preferred Supplier" },
          { id: "supplier-recent", name: "Recent Supplier" },
        ],
        error: null,
      }),
    ];
    const supplierPricebookBuilders: Array<ReturnType<typeof chainResult>> = [
      chainResult({
        data: [
          {
            id: "price-old",
            supplier_id: "supplier-old",
            product_id: "product-1",
            supplier_sku: "OLD-1",
            unit: "u",
            unit_price_cents: 1100,
            currency: "EUR",
            updated_at: "2025-10-01T00:00:00.000Z",
            created_at: "2025-10-01T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-best",
            supplier_id: "supplier-best",
            product_id: "product-1",
            supplier_sku: "BEST-1",
            unit: "u",
            unit_price_cents: 900,
            currency: "EUR",
            updated_at: "2026-02-20T00:00:00.000Z",
            created_at: "2026-02-20T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-preferred",
            supplier_id: "supplier-preferred",
            product_id: "product-1",
            supplier_sku: "PREF-1",
            unit: "u",
            unit_price_cents: 1000,
            currency: "EUR",
            updated_at: "2026-02-10T00:00:00.000Z",
            created_at: "2026-02-10T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-recent",
            supplier_id: "supplier-recent",
            product_id: "product-1",
            supplier_sku: "RECENT-1",
            unit: "u",
            unit_price_cents: 1200,
            currency: "EUR",
            updated_at: "2026-03-05T00:00:00.000Z",
            created_at: "2026-03-05T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
        ],
        error: null,
      }),
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: {
          id: "price-old",
          supplier_id: "supplier-old",
          product_id: "product-1",
          supplier_sku: "OLD-1",
          unit: "u",
          unit_price_cents: 1100,
          currency: "EUR",
          updated_at: "2025-10-01T00:00:00.000Z",
          created_at: "2025-10-01T00:00:00.000Z",
          notes: null,
          is_active: true,
        },
        error: null,
      }),
      chainResult({
        data: [
          {
            id: "price-old",
            supplier_id: "supplier-old",
            product_id: "product-1",
            supplier_sku: "OLD-1",
            unit: "u",
            unit_price_cents: 1100,
            currency: "EUR",
            updated_at: "2025-10-01T00:00:00.000Z",
            created_at: "2025-10-01T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-best",
            supplier_id: "supplier-best",
            product_id: "product-1",
            supplier_sku: "BEST-1",
            unit: "u",
            unit_price_cents: 900,
            currency: "EUR",
            updated_at: "2026-02-20T00:00:00.000Z",
            created_at: "2026-02-20T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-preferred",
            supplier_id: "supplier-preferred",
            product_id: "product-1",
            supplier_sku: "PREF-1",
            unit: "u",
            unit_price_cents: 1000,
            currency: "EUR",
            updated_at: "2026-02-10T00:00:00.000Z",
            created_at: "2026-02-10T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-recent",
            supplier_id: "supplier-recent",
            product_id: "product-1",
            supplier_sku: "RECENT-1",
            unit: "u",
            unit_price_cents: 1200,
            currency: "EUR",
            updated_at: "2026-03-05T00:00:00.000Z",
            created_at: "2026-03-05T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
        ],
        error: null,
      }),
    ];
    const dpgfCatalogueLinksBuilder = chainResult({
      data: [],
      error: null,
    });

    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue("supplier-preferred");
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(90);

    // The supplier-name searches precede supplier hydration for matched prices.
    [suppliersBuilders[1], suppliersBuilders[2]] = [suppliersBuilders[2], suppliersBuilders[1]];
    suppliersBuilders.pop();
    // The selected offer is already in the suggestion; no fallback reread.
    supplierPricebookBuilders.splice(2, 2);
    supplierPricebookBuilders.push(chainResult({
      data: ["price-old", "price-best", "price-preferred", "price-recent"].map((id) => ({
        id, unit: "u", min_quantity: 1, valid_from: null, valid_to: null, is_active: true,
      })),
      error: null,
    }));

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => estimateItemsBuilder),
          };
        }
        if (table === "products") {
          const builder = productsBuilders.shift();
          if (!builder) {
            throw new Error("Unexpected products query");
          }
          return {
            select: vi.fn(() => builder),
          };
        }
        if (table === "suppliers") {
          const builder = suppliersBuilders.shift();
          if (!builder) {
            throw new Error("Unexpected suppliers query");
          }
          return {
            select: vi.fn(() => builder),
          };
        }
        if (table === "supplier_pricebook") {
          const builder = supplierPricebookBuilders.shift();
          if (!builder) {
            throw new Error("Unexpected supplier_pricebook query");
          }
          return {
            select: vi.fn(() => builder),
          };
        }
        if (table === "dpgf_catalogue_links") {
          return {
            select: vi.fn(() => dpgfCatalogueLinksBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await getEstimateSupplierComparisons(VERSION_ID, [
      "item-stale",
      "item-missing",
    ]);

    expect(result.stale_price_days).toBe(90);
    expect(result.coverage_summary).toEqual({
      total_items: 2,
      covered_items: 0,
      ambiguous_items: 0,
      no_price_items: 1,
      stale_items: 1,
    });

    expect(result.comparisons[0]).toMatchObject({
      item_id: "item-stale",
      selected_supplier_price_id: "price-old",
      best_supplier_price_id: "price-best",
      coverage_status: "stale",
      risk_flags: [
        "multiple_alternatives",
        "selected_stale",
        "selected_not_best_price",
      ],
      selected_alternative: {
        supplier_price_id: "price-old",
        is_stale: true,
        is_selected: true,
      },
    });
    expect(result.comparisons[0]?.alternatives.some((alternative) => alternative.is_selected)).toBe(
      true
    );
    expect(result.comparisons[0]?.alternatives.map((alternative) => alternative.kind)).toEqual(
      expect.arrayContaining(["best_price", "most_recent", "preferred_supplier"])
    );

    expect(result.comparisons[1]).toMatchObject({
      item_id: "item-missing",
      selected_supplier_price_id: null,
      best_supplier_price_id: null,
      coverage_status: "no_price",
      risk_flags: [],
      selected_alternative: null,
      alternatives: [],
    });
    expect(result.bulk_preselection).toEqual({
      summary: {
        total_items: 2,
        proposed_items: 0,
        exception_items: 2,
        already_selected_items: 0,
        divergence_items: 0,
        stale_items: 1,
        ambiguous_items: 0,
        no_price_items: 1,

        currency_mismatch_items: 0,
      },
      proposals: [],
      exceptions: [
        expect.objectContaining({
          item_id: "item-stale",
          reason: "stale",
          coverage_status: "stale",
        }),
        expect.objectContaining({
          item_id: "item-missing",
          reason: "no_price",
          coverage_status: "no_price",
        }),
      ],
    });
  });

  it("preserves the selected supplier rationale when the live query no longer returns that price", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const estimateItemsBuilder = chainResult({
      data: [
        {
          id: "item-renamed",
          item_type: "line",
          title: "Ligne renommee",
          selected_supplier_price_id: "price-legacy",
          quantity: 30,
          description: "u",
        },
      ],
      error: null,
    });
    const productsBuilders = [
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: [
          {
            id: "product-legacy",
            designation: "Tube cuivre",
            reference: "CUIVRE-001",
          },
        ],
        error: null,
      }),
    ];
    productsBuilders.splice(1, 0, chainResult({ data: [], error: null }));
    const suppliersBuilders = [
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: [
          { id: "supplier-legacy", name: "Legacy Supplier" },
          { id: "supplier-best", name: "Best Supplier" },
          { id: "supplier-recent", name: "Recent Supplier" },
        ],
        error: null,
      }),
    ];
    const supplierPricebookBuilders: Array<ReturnType<typeof chainResult>> = [
      chainResult({
        data: [],
        error: null,
      }),
      chainResult({
        data: {
          id: "price-legacy",
          supplier_id: "supplier-legacy",
          product_id: "product-legacy",
          supplier_sku: "LEG-1",
          unit: "u",
          unit_price_cents: 1150,
          currency: "EUR",
          updated_at: "2026-01-15T00:00:00.000Z",
          created_at: "2026-01-15T00:00:00.000Z",
          notes: null,
          is_active: true,
        },
        error: null,
      }),
      chainResult({
        data: [
          {
            id: "price-recent",
            supplier_id: "supplier-recent",
            product_id: "product-legacy",
            supplier_sku: "REC-1",
            unit: "u",
            unit_price_cents: 1300,
            currency: "EUR",
            updated_at: "2026-03-05T00:00:00.000Z",
            created_at: "2026-03-05T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-best",
            supplier_id: "supplier-best",
            product_id: "product-legacy",
            supplier_sku: "BEST-1",
            unit: "u",
            unit_price_cents: 900,
            currency: "EUR",
            updated_at: "2026-02-20T00:00:00.000Z",
            created_at: "2026-02-20T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
          {
            id: "price-legacy",
            supplier_id: "supplier-legacy",
            product_id: "product-legacy",
            supplier_sku: "LEG-1",
            unit: "u",
            unit_price_cents: 1150,
            currency: "EUR",
            updated_at: "2026-01-15T00:00:00.000Z",
            created_at: "2026-01-15T00:00:00.000Z",
            notes: null,
            is_active: true,
          },
        ],
        error: null,
      }),
    ];
    const dpgfCatalogueLinksBuilder = chainResult({
      data: [],
      error: null,
    });

    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue(null);
    vi.mocked(getStalePriceDaysForTenant).mockResolvedValue(90);

    supplierPricebookBuilders.push(chainResult({
      data: ["price-legacy", "price-best", "price-recent"].map((id) => ({
        id, unit: "u", min_quantity: 1, valid_from: null, valid_to: null, is_active: true,
      })),
      error: null,
    }));

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => estimateItemsBuilder),
          };
        }
        if (table === "products") {
          const builder = productsBuilders.shift();
          if (!builder) {
            throw new Error("Unexpected products query");
          }
          return {
            select: vi.fn(() => builder),
          };
        }
        if (table === "suppliers") {
          const builder = suppliersBuilders.shift();
          if (!builder) {
            throw new Error("Unexpected suppliers query");
          }
          return {
            select: vi.fn(() => builder),
          };
        }
        if (table === "supplier_pricebook") {
          const builder = supplierPricebookBuilders.shift();
          if (!builder) {
            throw new Error("Unexpected supplier_pricebook query");
          }
          return {
            select: vi.fn(() => builder),
          };
        }
        if (table === "dpgf_catalogue_links") {
          return {
            select: vi.fn(() => dpgfCatalogueLinksBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await getEstimateSupplierComparisons(VERSION_ID, ["item-renamed"]);

    expect(result.comparisons[0]).toMatchObject({
      item_id: "item-renamed",
      selected_supplier_price_id: "price-legacy",
      best_supplier_price_id: "price-best",
      coverage_status: "covered",
      risk_flags: ["multiple_alternatives", "selected_not_best_price"],
      selected_alternative: {
        supplier_price_id: "price-legacy",
        supplier_name: "Legacy Supplier",
        is_selected: true,
      },
    });
    expect(result.comparisons[0]?.alternatives.slice(0, 3).some((alternative) => alternative.is_selected)).toBe(
      true
    );
  });

  it("rejects all_items supplier preselection when the estimate has more than 200 lines", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const estimateItemsBuilder = chainResult({
      data: Array.from({ length: 201 }, (_, index) => ({
        id: `item-${index + 1}`,
        item_type: "line",
        title: `Ligne ${index + 1}`,
        selected_supplier_price_id: null,
      })),
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => estimateItemsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      getEstimateSupplierComparisons(VERSION_ID, null)
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "all_items ne peut pas charger plus de 200 lignes.",
    });
  });

  it("ne preselectionne pas un prix libelle dans une autre devise", () => {
    const result = buildEstimateSupplierPreselectionReview({
      estimateCurrency: "EUR",
      itemTitleById: new Map([["item-usd", "Acier"]]),
      comparisons: [
        {
          item_id: "item-usd",
          selected_supplier_price_id: null,
          best_supplier_price_id: "price-usd",
          coverage_status: "covered",
          risk_flags: [],
          selected_alternative: null,
          alternatives: [
            {
              kind: "best_price",
              supplier_price_id: "price-usd",
              supplier_id: "supplier-usd",
              supplier_name: "US Supplier",
              adjusted_unit_price_cents: 10000,
              currency: "USD",
              supplier_reference: "USD-1",
              catalogue_url: null,
              updated_at: "2026-03-01T00:00:00.000Z",
              is_stale: false,
              product_designation: "Acier",
              is_selected: false,
            },
          ],
        },
      ],
    });

    // Le montant USD ne doit jamais etre injecte tel quel dans un devis EUR.
    expect(result.proposals).toHaveLength(0);
    expect(result.summary.proposed_items).toBe(0);
    expect(result.summary.currency_mismatch_items).toBe(1);
    expect(result.exceptions[0]?.reason).toBe("currency_mismatch");
  });

  it("builds a bulk supplier preselection review for simple proposals and explicit divergences", () => {
    const result = buildEstimateSupplierPreselectionReview({
      comparisons: [
        {
          item_id: "item-proposed",
          selected_supplier_price_id: null,
          best_supplier_price_id: "price-clear",
          coverage_status: "ambiguous",
          risk_flags: ["selection_missing"],
          selected_alternative: null,
          alternatives: [
            {
              kind: "best_price",
              supplier_price_id: "price-clear",
              supplier_id: "supplier-clear",
              supplier_name: "Clear Supplier",
              adjusted_unit_price_cents: 1250,
              currency: "EUR",
              supplier_reference: "CLR-1",
              catalogue_url: null,
              updated_at: "2026-03-01T00:00:00.000Z",
              is_stale: false,
              product_designation: "Tube cuivre",
              is_selected: false,
            },
          ],
        },
        {
          item_id: "item-divergent",
          selected_supplier_price_id: "price-old",
          best_supplier_price_id: "price-best",
          coverage_status: "covered",
          risk_flags: ["multiple_alternatives", "selected_not_best_price"],
          selected_alternative: {
            kind: "selected_current",
            supplier_price_id: "price-old",
            supplier_id: "supplier-old",
            supplier_name: "Old Supplier",
            adjusted_unit_price_cents: 1600,
            currency: "EUR",
            supplier_reference: "OLD-1",
            catalogue_url: null,
            updated_at: "2026-03-01T00:00:00.000Z",
            is_stale: false,
            product_designation: "Cable cuivre",
            is_selected: true,
          },
          alternatives: [
            {
              kind: "best_price",
              supplier_price_id: "price-best",
              supplier_id: "supplier-best",
              supplier_name: "Best Supplier",
              adjusted_unit_price_cents: 1400,
              currency: "EUR",
              supplier_reference: "BEST-1",
              catalogue_url: null,
              updated_at: "2026-03-02T00:00:00.000Z",
              is_stale: false,
              product_designation: "Cable cuivre",
              is_selected: false,
            },
            {
              kind: "selected_current",
              supplier_price_id: "price-old",
              supplier_id: "supplier-old",
              supplier_name: "Old Supplier",
              adjusted_unit_price_cents: 1600,
              currency: "EUR",
              supplier_reference: "OLD-1",
              catalogue_url: null,
              updated_at: "2026-03-01T00:00:00.000Z",
              is_stale: false,
              product_designation: "Cable cuivre",
              is_selected: true,
            },
          ],
        },
      ],
      itemTitleById: new Map([
        ["item-proposed", "Tube cuivre"],
        ["item-divergent", "Cable cuivre"],
      ]),
    });

    expect(result).toEqual({
      summary: {
        total_items: 2,
        proposed_items: 1,
        exception_items: 1,
        already_selected_items: 0,
        divergence_items: 1,
        stale_items: 0,
        ambiguous_items: 0,
        no_price_items: 0,

        currency_mismatch_items: 0,
      },
      proposals: [
        expect.objectContaining({
          item_id: "item-proposed",
          reason: "single_clear_option",
          patch: {
            unit_price_ht_cents: 1250,
            selected_supplier_price_id: "price-clear",
          },
        }),
      ],
      exceptions: [
        expect.objectContaining({
          item_id: "item-divergent",
          reason: "divergence",
          risk_flags: expect.arrayContaining(["selected_not_best_price"]),
        }),
      ],
    });
  });

  it("includes descendant variants when listing comparison data", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder({
      id: "variant-b",
      parent_version_id: "base-version",
    });
    const variantsBuilder = chainResult({
      data: [
        {
          id: "base-version",
          project_id: PROJECT_ID,
          version_number: 1,
          status: "draft",
          title: "Base",
          total_ht_cents: 1000,
          total_tax_cents: 200,
          total_ttc_cents: 1200,
          updated_at: "2026-02-22T08:00:00.000Z",
          parent_version_id: null,
          variant_label: null,
        },
        {
          id: "variant-a",
          project_id: PROJECT_ID,
          version_number: 2,
          status: "draft",
          title: "A",
          total_ht_cents: 1100,
          total_tax_cents: 220,
          total_ttc_cents: 1320,
          updated_at: "2026-02-22T09:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "A",
        },
        {
          id: "variant-b",
          project_id: PROJECT_ID,
          version_number: 3,
          status: "draft",
          title: "B",
          total_ht_cents: 1200,
          total_tax_cents: 240,
          total_ttc_cents: 1440,
          updated_at: "2026-02-22T10:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "B",
        },
        {
          id: "variant-c",
          project_id: PROJECT_ID,
          version_number: 4,
          status: "draft",
          title: "C",
          total_ht_cents: 1300,
          total_tax_cents: 260,
          total_ttc_cents: 1560,
          updated_at: "2026-02-22T11:00:00.000Z",
          parent_version_id: "variant-b",
          variant_label: "C",
        },
        {
          id: "variant-d",
          project_id: PROJECT_ID,
          version_number: 5,
          status: "draft",
          title: "D",
          total_ht_cents: 1400,
          total_tax_cents: 280,
          total_ttc_cents: 1680,
          updated_at: "2026-02-22T11:30:00.000Z",
          parent_version_id: "variant-c",
          variant_label: "D",
        },
        {
          id: "other-base",
          project_id: PROJECT_ID,
          version_number: 10,
          status: "draft",
          title: "Other Base",
          total_ht_cents: 2000,
          total_tax_cents: 400,
          total_ttc_cents: 2400,
          updated_at: "2026-02-22T07:00:00.000Z",
          parent_version_id: null,
          variant_label: null,
        },
        {
          id: "other-variant",
          project_id: PROJECT_ID,
          version_number: 11,
          status: "draft",
          title: "Other Variant",
          total_ht_cents: 2100,
          total_tax_cents: 420,
          total_ttc_cents: 2520,
          updated_at: "2026-02-22T07:30:00.000Z",
          parent_version_id: "other-base",
          variant_label: "A",
        },
      ],
      error: null,
    });
    const lineItemsBuilder = chainResult({
      data: [
        { version_id: "variant-a" },
        { version_id: "variant-a" },
        { version_id: "variant-c" },
        { version_id: "variant-d" },
      ],
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn((columns: string) => {
              if (columns.includes("estimate_projects")) {
                return versionAccessBuilder;
              }

              return variantsBuilder;
            }),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => lineItemsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listEstimateVersionVariants("variant-b");

    expect(result.base_version_id).toBe("base-version");
    expect(result.items.map((item) => item.id)).toEqual([
      "base-version",
      "variant-a",
      "variant-b",
      "variant-c",
      "variant-d",
    ]);
    expect(result.items.find((item) => item.id === "variant-a")?.line_count).toBe(2);
    expect(result.items.find((item) => item.id === "variant-c")?.line_count).toBe(1);
    expect(result.items.find((item) => item.id === "variant-d")?.line_count).toBe(1);
    expect(result.items.some((item) => item.id === "other-variant")).toBe(false);
  });

  it("orders variant labels by generated sequence index", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder({
      id: "base-version",
      parent_version_id: null,
    });
    const variantsBuilder = chainResult({
      data: [
        {
          id: "base-version",
          project_id: PROJECT_ID,
          version_number: 1,
          status: "draft",
          title: "Base",
          total_ht_cents: 1000,
          total_tax_cents: 200,
          total_ttc_cents: 1200,
          updated_at: "2026-02-22T08:00:00.000Z",
          parent_version_id: null,
          variant_label: null,
        },
        {
          id: "variant-aa",
          project_id: PROJECT_ID,
          version_number: 5,
          status: "draft",
          title: "AA",
          total_ht_cents: 1500,
          total_tax_cents: 300,
          total_ttc_cents: 1800,
          updated_at: "2026-02-22T13:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "AA",
        },
        {
          id: "variant-b",
          project_id: PROJECT_ID,
          version_number: 3,
          status: "draft",
          title: "B",
          total_ht_cents: 1200,
          total_tax_cents: 240,
          total_ttc_cents: 1440,
          updated_at: "2026-02-22T10:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "B",
        },
        {
          id: "variant-a",
          project_id: PROJECT_ID,
          version_number: 2,
          status: "draft",
          title: "A",
          total_ht_cents: 1100,
          total_tax_cents: 220,
          total_ttc_cents: 1320,
          updated_at: "2026-02-22T09:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "A",
        },
        {
          id: "variant-z",
          project_id: PROJECT_ID,
          version_number: 4,
          status: "draft",
          title: "Z",
          total_ht_cents: 1400,
          total_tax_cents: 280,
          total_ttc_cents: 1680,
          updated_at: "2026-02-22T12:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "Z",
        },
      ],
      error: null,
    });
    const lineItemsBuilder = chainResult({
      data: [],
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn((columns: string) => {
              if (columns.includes("estimate_projects")) {
                return versionAccessBuilder;
              }

              return variantsBuilder;
            }),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => lineItemsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listEstimateVersionVariants("base-version");

    expect(result.items.map((item) => item.variant_label)).toEqual([
      null,
      "A",
      "B",
      "Z",
      "AA",
    ]);
  });

  it("rejects duplicate template when RPC returns a non-uuid value", async () => {
    const base = createAuth("engineer");

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(() => ({
        data: "",
        error: null,
      })),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      duplicateEstimateTemplate(TEMPLATE_ID, {})
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("throws explicit instantiate failure when canonical persistence fails", async () => {
    const base = createAuth("engineer");

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(() => ({
        data: [{ project_id: null, version_id: null }],
        error: null,
      })),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(instantiateCanonicalEstimateV2FromTemplate).mockRejectedValue(
      new Error("ESTIMATE_CANONICAL_V2_PERSIST_FAILED")
    );

    await expect(
      instantiateEstimateFromTemplate(TEMPLATE_ID, {
        project_name: "Projet",
      })
    ).rejects.toMatchObject({
      status: 500,
      code: "ESTIMATE_TEMPLATE_INSTANTIATE_FAILED",
    });
  });

  it("forbids margin-tier creation for non-admin users", async () => {
    const base = createAuth("engineer");

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createMarginTier({
        threshold_cents: 1000,
        multiplier: 1.1,
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
    });
  });

  it("converts a line to section and clears line payload fields", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const featureFlagBuilder = chainResult({
      data: null,
      error: null,
    });
    const currentItemBuilder = chainResult({
      data: {
        id: "line-1",
        version_id: VERSION_ID,
        parent_id: null,
        item_type: "line",
        title: "Ligne",
      },
      error: null,
    });
    const convertedItemBuilder = chainResult({
      data: {
        id: "line-1",
        version_id: VERSION_ID,
        parent_id: null,
        item_type: "section",
        position: 2,
        title: "Ligne",
      },
      error: null,
    });
    const estimateItemsUpdate = vi.fn(() => convertedItemBuilder);

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "feature_flags") {
          return {
            select: vi.fn(() => featureFlagBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => currentItemBuilder),
            update: estimateItemsUpdate,
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await updateEstimateItem(VERSION_ID, {
      id: "line-1",
      item_type: "section",
    });

    expect(result).toMatchObject({
      converted_from_item_type: "line",
      item: {
        id: "line-1",
        item_type: "section",
      },
    });
    expect(estimateItemsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        item_type: "section",
        description: null,
        quantity: null,
        unit_price_ht_cents: null,
        line_total_ht_cents: null,
        line_total_ttc_cents: null,
      })
    );
  });

  it("rejects section-to-line conversion when section has children", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder({
      max_section_depth: 1,
    });
    const draftLockBuilder = createDraftLockBuilder();
    const featureFlagBuilder = chainResult({
      data: null,
      error: null,
    });
    const currentItemBuilder = chainResult({
      data: {
        id: "section-1",
        version_id: VERSION_ID,
        parent_id: "parent-1",
        item_type: "section",
        position: 1,
        title: "Section",
        aid: null,
      },
      error: null,
    });
    const parentSectionBuilder = chainResult({
      data: {
        id: "parent-1",
        version_id: VERSION_ID,
        parent_id: null,
        item_type: "section",
      },
      error: null,
    });
    const hierarchyItemsBuilder = chainResult({
      data: [
        {
          id: "parent-1",
          parent_id: null,
          item_type: "section",
        },
        {
          id: "section-1",
          parent_id: "parent-1",
          item_type: "section",
        },
        {
          id: "child-1",
          parent_id: "section-1",
          item_type: "line",
        },
      ],
      error: null,
    });
    const sectionChildrenBuilder = chainResult({
      data: [
        {
          id: "child-1",
          parent_id: "section-1",
          position: 1,
        },
      ],
      error: null,
    });
    let estimateItemsCalls = 0;
    const estimateItemsUpdate = vi.fn();

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "feature_flags") {
          return {
            select: vi.fn(() => featureFlagBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          estimateItemsCalls += 1;
          if (estimateItemsCalls === 1) {
            return {
              select: vi.fn(() => currentItemBuilder),
              update: estimateItemsUpdate,
            };
          }
          if (estimateItemsCalls === 2) {
            return {
              select: vi.fn(() => parentSectionBuilder),
              update: estimateItemsUpdate,
            };
          }
          if (estimateItemsCalls === 3) {
            return {
              select: vi.fn(() => hierarchyItemsBuilder),
              update: estimateItemsUpdate,
            };
          }
          if (estimateItemsCalls === 4) {
            return {
              select: vi.fn(() => sectionChildrenBuilder),
              update: estimateItemsUpdate,
            };
          }
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      updateEstimateItem(VERSION_ID, {
        id: "section-1",
        item_type: "line",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Une section avec enfants ne peut pas etre convertie en ligne.",
    });
    expect(estimateItemsUpdate).not.toHaveBeenCalled();
  });

  it("returns conflict when reorder list contains unknown sibling ids", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const siblingsBuilder = chainResult({
      data: [{ id: "a" }, { id: "b" }],
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => siblingsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockReturnValue({
        data: 2,
        error: null,
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      reorderEstimateItems(VERSION_ID, {
        parent_id: null,
        ordered_ids: ["a", "x"],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("returns conflict when reorder RPC updates fewer rows than expected", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const siblingsBuilder = chainResult({
      data: [{ id: "a" }, { id: "b" }],
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => siblingsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockReturnValue({
        data: 1,
        error: null,
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      reorderEstimateItems(VERSION_ID, {
        parent_id: null,
        ordered_ids: ["a", "b"],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("allows moving a line into a non-leaf section when max depth is higher", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder({
      max_section_depth: 3,
    });
    const draftLockBuilder = createDraftLockBuilder();
    const movingItemBuilder = chainResult({
      data: {
        id: "item-1",
        version_id: VERSION_ID,
        parent_id: "parent-source",
        item_type: "line",
      },
      error: null,
    });
    const targetParentBuilder = chainResult({
      data: {
        id: "parent-target",
        version_id: VERSION_ID,
        parent_id: null,
        item_type: "section",
      },
      error: null,
    });
    const sourceSiblingsBuilder = chainResult({
      data: [{ id: "item-1" }, { id: "source-2" }],
      error: null,
    });
    const targetSiblingsBuilder = chainResult({
      data: [{ id: "section-child" }],
      error: null,
    });
    const hierarchyItemsBuilder = chainResult({
      data: [
        {
          id: "parent-source",
          parent_id: null,
          item_type: "section",
        },
        {
          id: "parent-target",
          parent_id: null,
          item_type: "section",
        },
        {
          id: "section-child",
          parent_id: "parent-target",
          item_type: "section",
        },
        {
          id: "item-1",
          parent_id: "parent-source",
          item_type: "line",
        },
      ],
      error: null,
    });

    let estimateItemsCalls = 0;

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          estimateItemsCalls += 1;
          if (estimateItemsCalls === 1) {
            return {
              select: vi.fn(() => movingItemBuilder),
            };
          }
          if (estimateItemsCalls === 2) {
            return {
              select: vi.fn(() => targetParentBuilder),
            };
          }
          if (estimateItemsCalls === 3) {
            return {
              select: vi.fn(() => hierarchyItemsBuilder),
            };
          }
          if (estimateItemsCalls === 4) {
            return {
              select: vi.fn(() => sourceSiblingsBuilder),
            };
          }
          if (estimateItemsCalls === 5) {
            return {
              select: vi.fn(() => targetSiblingsBuilder),
            };
          }
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockReturnValue({
        data: 3,
        error: null,
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await moveEstimateItem(VERSION_ID, {
      item_id: "item-1",
      from_parent_id: "parent-source",
      to_parent_id: "parent-target",
      ordered_source_ids: ["source-2"],
      ordered_target_ids: ["section-child", "item-1"],
    });

    expect(result).toEqual({
      version: expect.objectContaining({ id: VERSION_ID, updated_at: "2026-02-22T12:00:00.000Z" }),
      item_id: "item-1",
      from_parent_id: "parent-source",
      to_parent_id: "parent-target",
      ordered_source_ids: ["source-2"],
      ordered_target_ids: ["section-child", "item-1"],
      updated_count: 3,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("move_estimate_item", {
      target_version_id: VERSION_ID,
      target_item_id: "item-1",
      source_parent_id: "parent-source",
      target_parent_id: "parent-target",
      ordered_source_item_ids: ["source-2"],
      ordered_target_item_ids: ["section-child", "item-1"],
    });
  });

  it("returns conflict when from_parent_id does not match the persisted parent", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const movingItemBuilder = chainResult({
      data: {
        id: "item-1",
        version_id: VERSION_ID,
        parent_id: "actual-parent",
        item_type: "line",
      },
      error: null,
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          return {
            select: vi.fn(() => movingItemBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      moveEstimateItem(VERSION_ID, {
        item_id: "item-1",
        from_parent_id: "stale-parent",
        to_parent_id: "parent-target",
        ordered_source_ids: ["source-2"],
        ordered_target_ids: ["target-1", "item-1"],
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects moving a section under a subsection", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const movingItemBuilder = chainResult({
      data: {
        id: "section-1",
        version_id: VERSION_ID,
        parent_id: null,
        item_type: "section",
      },
      error: null,
    });
    const targetParentBuilder = chainResult({
      data: {
        id: "subsection-1",
        version_id: VERSION_ID,
        parent_id: "root-section",
        item_type: "section",
      },
      error: null,
    });
    const hierarchyItemsBuilder = chainResult({
      data: [
        {
          id: "section-1",
          parent_id: null,
          item_type: "section",
        },
        {
          id: "root-section",
          parent_id: null,
          item_type: "section",
        },
        {
          id: "subsection-1",
          parent_id: "root-section",
          item_type: "section",
        },
      ],
      error: null,
    });

    let estimateItemsCalls = 0;

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          estimateItemsCalls += 1;
          if (estimateItemsCalls === 1) {
            return {
              select: vi.fn(() => movingItemBuilder),
            };
          }
          if (estimateItemsCalls === 2) {
            return {
              select: vi.fn(() => targetParentBuilder),
            };
          }
          if (estimateItemsCalls === 3) {
            return {
              select: vi.fn(() => hierarchyItemsBuilder),
            };
          }
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      moveEstimateItem(VERSION_ID, {
        item_id: "section-1",
        from_parent_id: null,
        to_parent_id: "subsection-1",
        ordered_source_ids: ["line-1"],
        ordered_target_ids: ["line-2", "section-1"],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects moving a line below configured max depth", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const movingItemBuilder = chainResult({
      data: {
        id: "line-1",
        version_id: VERSION_ID,
        parent_id: "parent-source",
        item_type: "line",
      },
      error: null,
    });
    const targetParentBuilder = chainResult({
      data: {
        id: "target-subsection",
        version_id: VERSION_ID,
        parent_id: "parent-mid",
        item_type: "section",
      },
      error: null,
    });
    const hierarchyItemsBuilder = chainResult({
      data: [
        {
          id: "parent-root",
          parent_id: null,
          item_type: "section",
        },
        {
          id: "parent-mid",
          parent_id: "parent-root",
          item_type: "section",
        },
        {
          id: "target-subsection",
          parent_id: "parent-mid",
          item_type: "section",
        },
        {
          id: "line-1",
          parent_id: "parent-source",
          item_type: "line",
        },
      ],
      error: null,
    });

    let estimateItemsCalls = 0;

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "draft_locks") {
          return {
            select: vi.fn(() => draftLockBuilder),
          };
        }
        if (table === "estimate_items") {
          estimateItemsCalls += 1;
          if (estimateItemsCalls === 1) {
            return {
              select: vi.fn(() => movingItemBuilder),
            };
          }
          if (estimateItemsCalls === 2) {
            return {
              select: vi.fn(() => targetParentBuilder),
            };
          }
          if (estimateItemsCalls === 3) {
            return {
              select: vi.fn(() => hierarchyItemsBuilder),
            };
          }
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn(),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      moveEstimateItem(VERSION_ID, {
        item_id: "line-1",
        from_parent_id: "parent-source",
        to_parent_id: "target-subsection",
        ordered_source_ids: ["source-1"],
        ordered_target_ids: ["target-1", "line-1"],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
