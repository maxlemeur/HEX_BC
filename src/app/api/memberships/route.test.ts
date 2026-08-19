import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { GET, POST } from "@/app/api/memberships/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_USER_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";

type TenantRole = "admin" | "engineer" | "viewer" | "director";
type QueryMode = "read" | "insert" | "update" | "delete";
type QuerySource = "authenticated" | "directory";
type SelectOptions = { count?: "exact"; head?: boolean };
type QueryResult = {
  data: unknown;
  error: null;
  count?: number;
};

type MembershipRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

const ACTOR_MEMBERSHIP: MembershipRow = {
  id: ACTOR_MEMBERSHIP_ID,
  tenant_id: TENANT_ID,
  user_id: ACTOR_USER_ID,
  role: "admin",
  is_default: true,
  created_at: "2026-07-01T08:00:00.000Z",
  updated_at: "2026-07-01T08:00:00.000Z",
};

const TARGET_MEMBERSHIP: MembershipRow = {
  id: TARGET_MEMBERSHIP_ID,
  tenant_id: TENANT_ID,
  user_id: TARGET_USER_ID,
  role: "engineer",
  is_default: false,
  created_at: "2026-07-02T08:00:00.000Z",
  updated_at: "2026-07-02T08:00:00.000Z",
};

const ACTOR_PROFILE = {
  id: ACTOR_USER_ID,
  full_name: "Nadia Admin",
  work_email: "nadia@example.test",
  role: "buyer" as const,
};

const TARGET_PROFILE = {
  id: TARGET_USER_ID,
  full_name: "Camille Martin",
  work_email: "camille@example.test",
  role: "buyer" as const,
};

type MembershipScenario = {
  authenticated: boolean;
  actorMembership: MembershipRow | null;
  listedMemberships: MembershipRow[];
  duplicateMembership: { id: string } | null;
  targetExistingMembershipCount: number;
  createdMembership: MembershipRow;
  tenantActive: boolean;
};

class MembershipQuery {
  mode: QueryMode = "read";
  readonly filters: Array<[string, unknown]> = [];
  selectedColumns = "";
  selectOptions: SelectOptions | undefined;
  payload: unknown = null;

  constructor(
    readonly source: QuerySource,
    readonly table: string,
    private readonly scenario: MembershipScenario
  ) {}

  select(columns: string, options?: SelectOptions) {
    this.selectedColumns = columns;
    this.selectOptions = options;
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  in(column: string, values: unknown[]) {
    this.filters.push([column, values]);
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  insert(payload: unknown) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  single() {
    return Promise.resolve(this.resolve());
  }

  maybeSingle() {
    return Promise.resolve(this.resolve());
  }

  then(
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }

  private hasFilter(column: string, value?: unknown) {
    return this.filters.some(
      ([candidateColumn, candidateValue]) =>
        candidateColumn === column &&
        (value === undefined || candidateValue === value)
    );
  }

  private resolve(): QueryResult {
    if (this.table === "tenants") {
      return {
        data: {
          id: TENANT_ID,
          name: "Tenant test",
          slug: "tenant-test",
          is_active: this.scenario.tenantActive,
        },
        error: null,
      };
    }

    if (this.table === "profiles") {
      return {
        data:
          this.source === "directory"
            ? { id: TARGET_USER_ID }
            : [ACTOR_PROFILE, TARGET_PROFILE],
        error: null,
      };
    }

    if (this.table !== "tenant_memberships") {
      throw new Error(`Unexpected table: ${this.table}`);
    }

    if (
      this.selectedColumns.includes("tenants!inner(is_active)") &&
      this.hasFilter("tenants.is_active", true) &&
      (!this.scenario.tenantActive || !this.scenario.actorMembership)
    ) {
      return { data: [], error: null };
    }

    if (this.mode === "insert") {
      return { data: this.scenario.createdMembership, error: null };
    }

    if (this.selectOptions?.head) {
      return {
        data: null,
        error: null,
        count: this.scenario.targetExistingMembershipCount,
      };
    }

    if (this.hasFilter("tenant_id") && this.hasFilter("user_id", TARGET_USER_ID)) {
      return { data: this.scenario.duplicateMembership, error: null };
    }

    if (this.hasFilter("tenant_id") && !this.hasFilter("user_id")) {
      return { data: this.scenario.listedMemberships, error: null };
    }

    return {
      data: this.scenario.actorMembership ? [this.scenario.actorMembership] : [],
      error: null,
    };
  }
}

function createMembershipHarness(overrides: Partial<MembershipScenario> = {}) {
  const scenario: MembershipScenario = {
    authenticated: true,
    actorMembership: ACTOR_MEMBERSHIP,
    listedMemberships: [ACTOR_MEMBERSHIP, TARGET_MEMBERSHIP],
    duplicateMembership: null,
    targetExistingMembershipCount: 0,
    createdMembership: TARGET_MEMBERSHIP,
    tenantActive: true,
    ...overrides,
  };
  const queries: MembershipQuery[] = [];
  const buildClient = (source: QuerySource) => ({
    auth:
      source === "authenticated"
        ? {
            getUser: vi.fn().mockResolvedValue({
              data: {
                user: scenario.authenticated ? { id: ACTOR_USER_ID } : null,
              },
              error: null,
            }),
          }
        : undefined,
    from: vi.fn((table: string) => {
      const query = new MembershipQuery(source, table, scenario);
      queries.push(query);
      return query;
    }),
  });
  const authenticatedClient = buildClient("authenticated");
  const directoryClient = buildClient("directory");

  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    authenticatedClient as never
  );
  vi.mocked(createServiceRoleClient).mockReturnValue(directoryClient as never);

  return {
    authenticatedClient,
    directoryClient,
    queries,
  };
}

describe("GET /api/memberships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the caller is unauthenticated", async () => {
    createMembershipHarness({ authenticated: false });

    const response = await GET(
      new Request("http://localhost/api/memberships")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(401);
    expect(body).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "UNAUTHORIZED",
      }),
    });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller has no active tenant", async () => {
    createMembershipHarness({ actorMembership: null });

    const response = await GET(
      new Request("http://localhost/api/memberships")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(403);
    expect(body).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "FORBIDDEN",
        message: "Aucun tenant actif pour cet utilisateur.",
      }),
    });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns 200 with the tenant membership list from the server", async () => {
    createMembershipHarness();

    const response = await GET(
      new Request("http://localhost/api/memberships")
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        current_user_id?: string;
        memberships?: Array<{ id: string; user_full_name: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.current_user_id).toBe(ACTOR_USER_ID);
    expect(body.data?.memberships).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ACTOR_MEMBERSHIP_ID,
          user_full_name: ACTOR_PROFILE.full_name,
        }),
        expect.objectContaining({
          id: TARGET_MEMBERSHIP_ID,
          user_full_name: TARGET_PROFILE.full_name,
        }),
      ])
    );
  });
});

describe("POST /api/memberships", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a membership with 201 and uses the directory service-role client", async () => {
    const { queries } = createMembershipHarness();

    const response = await POST(
      new Request("http://localhost/api/memberships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: TARGET_USER_ID,
          role: "engineer",
        }),
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        membership?: {
          id: string;
          user_id: string;
          role: string;
        };
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.membership).toEqual(
      expect.objectContaining({
        id: TARGET_MEMBERSHIP_ID,
        user_id: TARGET_USER_ID,
        role: "engineer",
      })
    );
    expect(createServiceRoleClient).toHaveBeenCalledTimes(1);
    expect(
      queries.some(
        (query) => query.source === "directory" && query.table === "profiles"
      )
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.table === "tenant_memberships" && query.mode === "insert"
      )
    ).toBe(true);
  });

  it("returns 400 when the create body is invalid", async () => {
    createMembershipHarness();

    const response = await POST(
      new Request("http://localhost/api/memberships", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: "not-a-uuid",
          role: "engineer",
        }),
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(body).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "VALIDATION_ERROR",
      }),
    });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});
