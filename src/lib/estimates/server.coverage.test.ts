import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  createEstimate,
  createEstimateTemplateFromVersion,
  createMarginTier,
  deleteEstimateItem,
  deleteMarginTier,
  duplicateEstimateTemplate,
  getEstimateTemplate,
  instantiateEstimateFromTemplate,
  listEstimateTemplates,
  listEstimateProjectVersions,
  listEstimateVersionVariants,
  listEstimateVersionEvents,
  listLatestEstimates,
  moveEstimateItem,
  reorderEstimateItems,
  updateEstimateItem,
  updateMarginTier,
} from "@/lib/estimates/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const TEMPLATE_ID = "55555555-5555-4555-8555-555555555555";
const TEMPLATE_COPY_ID = "66666666-6666-4666-8666-666666666666";
const MARGIN_TIER_ID = "77777777-7777-4777-8777-777777777777";

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
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("creates an estimate with default version values when optional fields are omitted", async () => {
    const base = createAuth("engineer");
    const insertedProjectPayloads: Array<Record<string, unknown>> = [];
    const insertedVersionPayloads: Array<Record<string, unknown>> = [];
    const categoryUpsertCalls: unknown[] = [];
    const laborRoleUpsertCalls: unknown[] = [];

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "estimate_projects") {
          return {
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedProjectPayloads.push(payload);
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: {
                      id: PROJECT_ID,
                      name: "Projet test",
                    },
                    error: null,
                  })),
                })),
              };
            }),
            delete: vi.fn(() => chainResult({ data: null, error: null })),
          };
        }
        if (table === "estimate_versions") {
          return {
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedVersionPayloads.push(payload);
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: {
                      id: VERSION_ID,
                      project_id: PROJECT_ID,
                      status: "draft",
                    },
                    error: null,
                  })),
                })),
              };
            }),
          };
        }
        if (table === "estimate_categories") {
          return {
            upsert: vi.fn((payload: unknown) => {
              categoryUpsertCalls.push(payload);
              return {
                data: null,
                error: null,
              };
            }),
          };
        }
        if (table === "labor_roles") {
          return {
            upsert: vi.fn((payload: unknown) => {
              laborRoleUpsertCalls.push(payload);
              return {
                data: null,
                error: null,
              };
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createEstimate({
      project: {
        name: "Projet test",
        reference: " REF ",
        client_name: " Client ",
        notes: " Notes ",
      },
    });

    expect(result.project.id).toBe(PROJECT_ID);
    expect(result.version.id).toBe(VERSION_ID);
    expect(insertedProjectPayloads[0]).toMatchObject({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      reference: "REF",
      client_name: "Client",
      notes: "Notes",
    });
    expect(insertedVersionPayloads[0]).toMatchObject({
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_number: 1,
      status: "draft",
      validite_jours: 30,
      margin_multiplier: 1,
      margin_mode: "fixed",
      currency: "EUR",
      margin_bp: 0,
      discount_bp: 0,
      tax_rate_bp: 2000,
      rounding_mode: "none",
      rounding_step_cents: 1,
      total_ht_cents: 0,
      total_tax_cents: 0,
      total_ttc_cents: 0,
    });
    expect(insertedVersionPayloads[0]?.date_devis).toBe(
      new Date().toISOString().slice(0, 10)
    );
    expect(categoryUpsertCalls).toHaveLength(1);
    const categoriesPayload = categoryUpsertCalls[0];
    expect(Array.isArray(categoriesPayload)).toBe(true);
    if (!Array.isArray(categoriesPayload)) return;
    expect(categoriesPayload).toHaveLength(3);

    expect(laborRoleUpsertCalls).toHaveLength(1);
    const laborRolesPayload = laborRoleUpsertCalls[0];
    expect(Array.isArray(laborRolesPayload)).toBe(true);
    if (!Array.isArray(laborRolesPayload)) return;
    expect(laborRolesPayload).toHaveLength(9);
  });

  it("maps estimate version events and trims actor names", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const eventsBuilder = chainResult({
      data: [
        {
          id: "event-1",
          estimate_version_id: VERSION_ID,
          event_type: "sent",
          metadata: { reason: "manual" },
          created_by: USER_ID,
          occurred_at: null,
          created_at: "2026-02-22T11:00:00.000Z",
          profiles: {
            full_name: "  Alice  ",
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
            select: vi.fn(() => versionAccessBuilder),
          };
        }
        if (table === "estimate_version_events") {
          return {
            select: vi.fn(() => eventsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listEstimateVersionEvents(VERSION_ID);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "event-1",
      actor_name: "Alice",
      occurred_at: "2026-02-22T11:00:00.000Z",
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

  it("allows directors to load project version timelines", async () => {
    const base = createAuth("director");
    const projectBuilder = chainResult({
      data: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: "owner-2",
      },
      error: null,
    });
    const totalCountBuilder = chainResult({
      data: null,
      count: 1,
      error: null,
    });
    const versionsBuilder = chainResult({
      data: [
        {
          id: VERSION_ID,
          project_id: PROJECT_ID,
          version_number: 4,
          status: "draft",
          title: "Review",
          updated_at: "2026-02-22T12:00:00.000Z",
          created_at: "2026-02-22T11:00:00.000Z",
          total_ttc_cents: 14400,
          total_ht_cents: 12000,
          parent_version_id: null,
          variant_label: null,
        },
      ],
      error: null,
    });
    const auditBuilder = chainResult({
      data: [],
      error: null,
    });
    const profilesBuilder = chainResult({
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
        if (table === "estimate_projects") {
          return {
            select: vi.fn(() => projectBuilder),
          };
        }
        if (table === "estimate_versions") {
          return {
            select: vi.fn((columns: string, options?: { count?: "exact"; head?: boolean }) => {
              if (options?.count === "exact" && options?.head === true) {
                return totalCountBuilder;
              }

              if (columns.includes("version_number")) {
                return versionsBuilder;
              }

              throw new Error(`Unexpected select on estimate_versions: ${columns}`);
            }),
          };
        }
        if (table === "audit_logs") {
          return {
            select: vi.fn(() => auditBuilder),
          };
        }
        if (table === "profiles") {
          return {
            select: vi.fn(() => profilesBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listEstimateProjectVersions({
      projectId: PROJECT_ID,
      page: 1,
      pageSize: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.id).toBe(VERSION_ID);
  });

  it("allows directors to load variant comparisons for review", async () => {
    const base = createAuth("director");
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
          id: "variant-b",
          project_id: PROJECT_ID,
          version_number: 2,
          status: "draft",
          title: "Variant B",
          total_ht_cents: 1200,
          total_tax_cents: 240,
          total_ttc_cents: 1440,
          updated_at: "2026-02-22T10:00:00.000Z",
          parent_version_id: "base-version",
          variant_label: "B",
        },
      ],
      error: null,
    });
    const lineItemsBuilder = chainResult({
      data: [{ version_id: "variant-b" }],
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
    expect(result.items.map((item) => item.id)).toEqual(["base-version", "variant-b"]);
  });

  it("lists templates with search and computed line counts", async () => {
    const base = createAuth("engineer");
    const templatesBuilder = chainResult({
      data: [
        {
          id: TEMPLATE_ID,
          name: "Template A",
          description: "Desc",
          source_version_id: VERSION_ID,
          created_by: USER_ID,
          created_at: "2026-02-21T10:00:00.000Z",
          updated_at: "2026-02-22T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const lineCountsBuilder = chainResult({
      data: [
        { template_id: TEMPLATE_ID },
        { template_id: TEMPLATE_ID },
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
        if (table === "estimate_templates") {
          return {
            select: vi.fn(() => templatesBuilder),
          };
        }
        if (table === "estimate_template_items") {
          return {
            select: vi.fn(() => lineCountsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listEstimateTemplates({
      search: "  plomberie  ",
      limit: 10,
      order: "recent",
    });

    expect(templatesBuilder.or).toHaveBeenCalledWith(
      "name.ilike.%plomberie%,description.ilike.%plomberie%"
    );
    expect(result.templates).toHaveLength(1);
    expect(result.templates[0]).toMatchObject({
      id: TEMPLATE_ID,
      item_count: 2,
    });
  });

  it("loads one template with sorted items and line count", async () => {
    const base = createAuth("engineer");
    const templateBuilder = chainResult({
      data: {
        id: TEMPLATE_ID,
        name: "Template A",
        description: null,
        source_version_id: VERSION_ID,
        created_by: USER_ID,
        created_at: "2026-02-21T10:00:00.000Z",
        updated_at: "2026-02-22T10:00:00.000Z",
      },
      error: null,
    });
    const itemsBuilder = chainResult({
      data: [
        { id: "ti-1", item_type: "section", position: 1, title: "Section" },
        { id: "ti-2", item_type: "line", position: 2, title: "Line A" },
        { id: "ti-3", item_type: "line", position: 3, title: "Line B" },
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
        if (table === "estimate_templates") {
          return {
            select: vi.fn(() => templateBuilder),
          };
        }
        if (table === "estimate_template_items") {
          return {
            select: vi.fn(() => itemsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await getEstimateTemplate(TEMPLATE_ID);

    expect(result.template.id).toBe(TEMPLATE_ID);
    expect(result.template.item_count).toBe(2);
    expect(result.template.items).toHaveLength(3);
  });

  it("creates a template from a version and trims payload fields", async () => {
    const base = createAuth("engineer");
    const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];
    const templateBuilder = chainResult({
      data: {
        id: TEMPLATE_ID,
        name: "Template copied",
        description: "Desc",
        source_version_id: VERSION_ID,
        created_by: USER_ID,
        created_at: "2026-02-21T10:00:00.000Z",
        updated_at: "2026-02-22T10:00:00.000Z",
      },
      error: null,
    });
    const lineCountsBuilder = chainResult({
      data: [{ template_id: TEMPLATE_ID }],
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
        if (table === "estimate_templates") {
          return {
            select: vi.fn(() => templateBuilder),
          };
        }
        if (table === "estimate_template_items") {
          return {
            select: vi.fn(() => lineCountsBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn((fn: string, payload: Record<string, unknown>) => {
        rpcCalls.push({ fn, payload });
        return {
          data: TEMPLATE_ID,
          error: null,
        };
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createEstimateTemplateFromVersion({
      source_version_id: VERSION_ID,
      name: "  Template copied  ",
      description: "  Desc  ",
    });

    expect(rpcCalls[0]).toMatchObject({
      fn: "create_estimate_template_from_version",
      payload: {
        p_source_version_id: VERSION_ID,
        p_name: "Template copied",
        p_description: "Desc",
      },
    });
    expect(result.template.item_count).toBe(1);
  });

  it("maps RPC source-version not-found errors when creating a template", async () => {
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
        data: null,
        error: {
          code: "XX000",
          message: "template source version not found",
          details: null,
          hint: null,
        },
      })),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createEstimateTemplateFromVersion({
        source_version_id: VERSION_ID,
        name: "Template",
      })
    ).rejects.toMatchObject({
      status: 404,
      code: "ESTIMATE_TEMPLATE_SOURCE_VERSION_NOT_FOUND",
    });
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

  it("instantiates template and returns redirect route", async () => {
    const base = createAuth("engineer");
    const rpcCalls: Array<{ fn: string; payload: Record<string, unknown> }> = [];

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
      rpc: vi.fn((fn: string, payload: Record<string, unknown>) => {
        rpcCalls.push({ fn, payload });
        return {
          data: [
            {
              project_id: PROJECT_ID,
              version_id: TEMPLATE_COPY_ID,
            },
          ],
          error: null,
        };
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await instantiateEstimateFromTemplate(TEMPLATE_ID, {
      project_name: "  Projet du client  ",
      version_title: "  V1  ",
      date_devis: "2026-02-22",
      validite_jours: 45,
    });

    expect(rpcCalls[0]).toMatchObject({
      fn: "instantiate_estimate_from_template",
      payload: {
        p_template_id: TEMPLATE_ID,
        p_project_name: "Projet du client",
        p_version_title: "V1",
        p_date_devis: "2026-02-22",
        p_validite_jours: 45,
      },
    });
    expect(result).toEqual({
      projectId: PROJECT_ID,
      versionId: TEMPLATE_COPY_ID,
      redirectTo: `/dashboard/estimates/${TEMPLATE_COPY_ID}/edit`,
    });
  });

  it("throws explicit instantiate failure when RPC response shape is invalid", async () => {
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

  it("creates and deletes margin tiers as admin", async () => {
    const base = createAuth("admin");
    const insertedPayloads: Array<Record<string, unknown>> = [];

    const positionBuilder = chainResult({
      data: [{ position: 4 }],
      error: null,
    });
    const existingTierBuilder = chainResult({
      data: { id: MARGIN_TIER_ID },
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
        if (table === "margin_tiers") {
          return {
            select: vi.fn((columns: string) => {
              if (columns === "position") return positionBuilder;
              return existingTierBuilder;
            }),
            insert: vi.fn((payload: Record<string, unknown>) => {
              insertedPayloads.push(payload);
              return {
                select: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: {
                      id: MARGIN_TIER_ID,
                      threshold_cents: 5000,
                      multiplier: 1.15,
                      position: 5,
                    },
                    error: null,
                  })),
                })),
              };
            }),
            delete: vi.fn(() => chainResult({ data: null, error: null })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const created = await createMarginTier({
      threshold_cents: 5000,
      multiplier: 1.15,
    });

    expect(insertedPayloads[0]).toMatchObject({
      tenant_id: TENANT_ID,
      threshold_cents: 5000,
      multiplier: 1.15,
      position: 5,
    });
    expect(created.margin_tier).toMatchObject({
      id: MARGIN_TIER_ID,
    });

    const deleted = await deleteMarginTier(MARGIN_TIER_ID);
    expect(deleted).toEqual({ deleted: true });
  });

  it("maps unique constraint conflicts for margin tiers", async () => {
    const base = createAuth("admin");
    const positionBuilder = chainResult({
      data: [{ position: 1 }],
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
        if (table === "margin_tiers") {
          return {
            select: vi.fn(() => positionBuilder),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(() => ({
                  data: null,
                  error: {
                    code: "23505",
                    message: "duplicate key value violates unique constraint threshold_cents",
                    details: null,
                    hint: null,
                  },
                })),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createMarginTier({
        threshold_cents: 5000,
        multiplier: 1.2,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });
  });

  it("returns not-found when updating an unknown margin tier", async () => {
    const base = createAuth("admin");
    const missingTierBuilder = chainResult({
      data: null,
      error: {
        code: "PGRST116",
        message: "No rows",
        details: null,
        hint: null,
      },
    });

    const supabase = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") {
          return {
            select: vi.fn(() => base.__membershipBuilder),
          };
        }
        if (table === "margin_tiers") {
          return {
            select: vi.fn(() => missingTierBuilder),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    single: vi.fn(() => ({
                      data: null,
                      error: null,
                    })),
                  })),
                })),
              })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      updateMarginTier(MARGIN_TIER_ID, {
        multiplier: 1.2,
      })
    ).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
  });

  it("deletes an estimate item in draft mode with an active lock", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const currentItemBuilder = chainResult({
      data: { id: "item-1" },
      error: null,
    });
    const deleteBuilder = chainResult({
      data: null,
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
            select: vi.fn(() => currentItemBuilder),
            delete: vi.fn(() => deleteBuilder),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await deleteEstimateItem(VERSION_ID, {
      id: "item-1",
    });

    expect(result).toEqual({
      deleted_id: "item-1",
    });
    expect(deleteBuilder.eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
    expect(deleteBuilder.eq).toHaveBeenCalledWith("id", "item-1");
    expect(deleteBuilder.eq).toHaveBeenCalledWith("version_id", VERSION_ID);
  });

  it("returns not-found when deleting an unknown estimate item", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder();
    const draftLockBuilder = createDraftLockBuilder();
    const currentItemBuilder = chainResult({
      data: null,
      error: {
        code: "PGRST116",
        message: "No rows",
        details: null,
        hint: null,
      },
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
            select: vi.fn(() => currentItemBuilder),
            delete: vi.fn(() => chainResult({ data: null, error: null })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      deleteEstimateItem(VERSION_ID, {
        id: "missing-item",
      })
    ).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
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

  it("reorders sibling estimate items and returns updated count", async () => {
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

    const result = await reorderEstimateItems(VERSION_ID, {
      parent_id: null,
      ordered_ids: ["a", "b"],
    });

    expect(result).toEqual({
      parent_id: null,
      ordered_ids: ["a", "b"],
      updated_count: 2,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("reorder_estimate_items", {
      target_version_id: VERSION_ID,
      target_parent_id: null,
      ordered_item_ids: ["a", "b"],
    });
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

  it("moves an estimate item across parents and calls move_estimate_item RPC", async () => {
    const base = createAuth("engineer");
    const versionAccessBuilder = createVersionAccessBuilder({
      max_section_depth: 1,
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
      data: [{ id: "target-1" }],
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
      ordered_target_ids: ["target-1", "item-1"],
    });

    expect(result).toEqual({
      item_id: "item-1",
      from_parent_id: "parent-source",
      to_parent_id: "parent-target",
      ordered_source_ids: ["source-2"],
      ordered_target_ids: ["target-1", "item-1"],
      updated_count: 3,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("move_estimate_item", {
      target_version_id: VERSION_ID,
      target_item_id: "item-1",
      source_parent_id: "parent-source",
      target_parent_id: "parent-target",
      ordered_source_item_ids: ["source-2"],
      ordered_target_item_ids: ["target-1", "item-1"],
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
