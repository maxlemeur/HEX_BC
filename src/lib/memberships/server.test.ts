import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import {
  createMembership,
  deleteMembership,
  updateMembership,
} from "@/lib/memberships/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222";
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

const TARGET_PROFILE = {
  id: TARGET_USER_ID,
  full_name: "Camille Martin",
  work_email: "camille@example.test",
  role: "buyer" as const,
};

type MembershipScenario = {
  actorMembership: MembershipRow;
  targetMembership: MembershipRow | null;
  duplicateMembership: { id: string } | null;
  targetExistingMembershipCount: number;
  adminCount: number;
  createdMembership: MembershipRow;
  updatedMembership: MembershipRow;
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
            : [TARGET_PROFILE],
        error: null,
      };
    }

    if (this.table !== "tenant_memberships") {
      throw new Error(`Unexpected table: ${this.table}`);
    }

    if (
      this.selectedColumns.includes("tenants!inner(is_active)") &&
      this.hasFilter("tenants.is_active", true) &&
      !this.scenario.tenantActive
    ) {
      return { data: [], error: null };
    }

    if (this.mode === "insert") {
      return { data: this.scenario.createdMembership, error: null };
    }

    if (this.mode === "update") {
      return { data: this.scenario.updatedMembership, error: null };
    }

    if (this.mode === "delete") {
      return { data: null, error: null };
    }

    if (this.selectOptions?.head) {
      return {
        data: null,
        error: null,
        count: this.hasFilter("role", "admin")
          ? this.scenario.adminCount
          : this.scenario.targetExistingMembershipCount,
      };
    }

    if (this.hasFilter("id")) {
      return { data: this.scenario.targetMembership, error: null };
    }

    if (this.hasFilter("tenant_id") && this.hasFilter("user_id", TARGET_USER_ID)) {
      return { data: this.scenario.duplicateMembership, error: null };
    }

    return { data: [this.scenario.actorMembership], error: null };
  }
}

function createMembershipHarness(
  overrides: Partial<MembershipScenario> = {}
) {
  const scenario: MembershipScenario = {
    actorMembership: ACTOR_MEMBERSHIP,
    targetMembership: TARGET_MEMBERSHIP,
    duplicateMembership: null,
    targetExistingMembershipCount: 0,
    adminCount: 2,
    createdMembership: TARGET_MEMBERSHIP,
    updatedMembership: TARGET_MEMBERSHIP,
    tenantActive: true,
    ...overrides,
  };
  const queries: MembershipQuery[] = [];
  const buildClient = (source: QuerySource) => ({
    auth:
      source === "authenticated"
        ? {
            getUser: vi.fn().mockResolvedValue({
              data: { user: { id: ACTOR_USER_ID } },
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
    queries,
  };
}

function mutationQueries(queries: MembershipQuery[]) {
  return queries.filter((query) => query.mode !== "read");
}

describe("memberships service authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-admin before service-role lookup or mutation", async () => {
    const { queries } = createMembershipHarness({
      actorMembership: {
        ...ACTOR_MEMBERSHIP,
        role: "engineer",
      },
    });

    await expect(
      createMembership({ user_id: TARGET_USER_ID, role: "engineer" })
    ).rejects.toMatchObject({ status: 403 });

    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(mutationQueries(queries)).toHaveLength(0);
  });

  it("rejects membership administration when the current tenant is inactive", async () => {
    const { queries } = createMembershipHarness({ tenantActive: false });

    await expect(
      createMembership({ user_id: TARGET_USER_ID, role: "engineer" })
    ).rejects.toMatchObject({
      status: 403,
      message: "Aucun tenant actif pour cet utilisateur.",
    });

    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(mutationQueries(queries)).toHaveLength(0);
  });

  it.each([
    {
      label: "update",
      run: () => updateMembership(TARGET_MEMBERSHIP_ID, { role: "viewer" }),
    },
    {
      label: "delete",
      run: () => deleteMembership(TARGET_MEMBERSHIP_ID),
    },
  ])("blocks a cross-tenant $label before mutation", async ({ run }) => {
    const { queries } = createMembershipHarness({
      targetMembership: {
        ...TARGET_MEMBERSHIP,
        tenant_id: OTHER_TENANT_ID,
      },
    });

    await expect(run()).rejects.toMatchObject({ status: 403 });
    expect(mutationQueries(queries)).toHaveLength(0);
  });

  it("does not demote the last tenant admin", async () => {
    const { queries } = createMembershipHarness({
      targetMembership: ACTOR_MEMBERSHIP,
      adminCount: 1,
    });

    await expect(
      updateMembership(ACTOR_MEMBERSHIP_ID, { role: "engineer" })
    ).rejects.toMatchObject({ status: 409 });

    expect(mutationQueries(queries)).toHaveLength(0);
  });

  it("does not allow an admin to delete their own membership", async () => {
    const { queries } = createMembershipHarness({
      targetMembership: ACTOR_MEMBERSHIP,
    });

    await expect(deleteMembership(ACTOR_MEMBERSHIP_ID)).rejects.toMatchObject({
      status: 409,
    });

    expect(mutationQueries(queries)).toHaveLength(0);
  });
});

describe("membership creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a duplicate before using the directory service", async () => {
    const { queries } = createMembershipHarness({
      duplicateMembership: { id: TARGET_MEMBERSHIP_ID },
    });

    await expect(
      createMembership({ user_id: TARGET_USER_ID, role: "engineer" })
    ).rejects.toMatchObject({ status: 409 });

    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(mutationQueries(queries)).toHaveLength(0);
  });

  it.each([
    { existingMembershipCount: 0, expectedDefault: true },
    { existingMembershipCount: 2, expectedDefault: false },
  ])(
    "sets is_default=$expectedDefault when the user has $existingMembershipCount existing memberships",
    async ({ existingMembershipCount, expectedDefault }) => {
      const createdMembership = {
        ...TARGET_MEMBERSHIP,
        is_default: expectedDefault,
      };
      const { queries } = createMembershipHarness({
        targetExistingMembershipCount: existingMembershipCount,
        createdMembership,
      });

      await expect(
        createMembership({ user_id: TARGET_USER_ID, role: "engineer" })
      ).resolves.toMatchObject({
        membership: {
          id: TARGET_MEMBERSHIP_ID,
          user_id: TARGET_USER_ID,
          is_default: expectedDefault,
          user_full_name: TARGET_PROFILE.full_name,
        },
      });

      const insertQuery = queries.find(
        (query) =>
          query.table === "tenant_memberships" && query.mode === "insert"
      );
      expect(insertQuery?.payload).toEqual({
        tenant_id: TENANT_ID,
        user_id: TARGET_USER_ID,
        role: "engineer",
        is_default: expectedDefault,
      });
      expect(createServiceRoleClient).toHaveBeenCalledTimes(1);
    }
  );
});
