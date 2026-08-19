import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/memberships/[membershipId]/route";
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

const TARGET_PROFILE = {
  id: TARGET_USER_ID,
  full_name: "Camille Martin",
  work_email: "camille@example.test",
  role: "buyer" as const,
};

type MembershipScenario = {
  actorMembership: MembershipRow;
  targetMembership: MembershipRow | null;
  updatedMembership: MembershipRow;
  adminCount: number;
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
    if (this.table === "profiles") {
      return { data: [TARGET_PROFILE], error: null };
    }

    if (this.table !== "tenant_memberships") {
      throw new Error(`Unexpected table: ${this.table}`);
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
        count: this.hasFilter("role", "admin") ? this.scenario.adminCount : 0,
      };
    }

    if (this.hasFilter("id")) {
      return { data: this.scenario.targetMembership, error: null };
    }

    return { data: [this.scenario.actorMembership], error: null };
  }
}

function createMembershipHarness(overrides: Partial<MembershipScenario> = {}) {
  const scenario: MembershipScenario = {
    actorMembership: ACTOR_MEMBERSHIP,
    targetMembership: TARGET_MEMBERSHIP,
    updatedMembership: {
      ...TARGET_MEMBERSHIP,
      role: "viewer",
    },
    adminCount: 2,
    ...overrides,
  };
  const queries: MembershipQuery[] = [];
  const authenticatedClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: ACTOR_USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      const query = new MembershipQuery("authenticated", table, scenario);
      queries.push(query);
      return query;
    }),
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    authenticatedClient as never
  );
  vi.mocked(createServiceRoleClient).mockReturnValue({
    from: vi.fn(() => {
      throw new Error("service-role client should not be used for PATCH/DELETE");
    }),
  } as never);

  return { queries };
}

function membershipParams(membershipId = TARGET_MEMBERSHIP_ID) {
  return { params: Promise.resolve({ membershipId }) };
}

describe("PATCH /api/memberships/[membershipId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates a membership role", async () => {
    const { queries } = createMembershipHarness();

    const response = await PATCH(
      new Request(`http://localhost/api/memberships/${TARGET_MEMBERSHIP_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: "viewer" }),
      }),
      membershipParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { membership?: { id: string; role: string } };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.membership).toEqual(
      expect.objectContaining({
        id: TARGET_MEMBERSHIP_ID,
        role: "viewer",
      })
    );
    const updateQuery = queries.find(
      (query) => query.table === "tenant_memberships" && query.mode === "update"
    );
    expect(updateQuery?.payload).toEqual({ role: "viewer" });
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/memberships/[membershipId] refusals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function patch(membershipId = TARGET_MEMBERSHIP_ID, role = "viewer") {
    return PATCH(
      new Request(`http://localhost/api/memberships/${membershipId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      }),
      membershipParams(membershipId)
    );
  }

  it("refuses a non-admin actor (403) without touching the membership", async () => {
    const { queries } = createMembershipHarness({
      actorMembership: { ...ACTOR_MEMBERSHIP, role: "engineer" },
    });

    const response = await patch();

    expect(response.status).toBe(403);
    expect(queries.some((query) => query.mode === "update")).toBe(false);
  });

  it("refuses a membership of another tenant (403)", async () => {
    const { queries } = createMembershipHarness({
      targetMembership: {
        ...TARGET_MEMBERSHIP,
        tenant_id: "99999999-9999-4999-8999-999999999999",
      },
    });

    const response = await patch();

    expect(response.status).toBe(403);
    expect(queries.some((query) => query.mode === "update")).toBe(false);
  });

  it("returns 404 for an unknown membership", async () => {
    createMembershipHarness({ targetMembership: null });

    const response = await patch();

    expect(response.status).toBe(404);
  });

  it("refuses to demote the last admin (409)", async () => {
    const { queries } = createMembershipHarness({
      targetMembership: { ...TARGET_MEMBERSHIP, role: "admin" },
      adminCount: 1,
    });

    const response = await patch(TARGET_MEMBERSHIP_ID, "viewer");

    expect(response.status).toBe(409);
    expect(queries.some((query) => query.mode === "update")).toBe(false);
  });
});

describe("DELETE /api/memberships/[membershipId] refusals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function remove(membershipId = TARGET_MEMBERSHIP_ID) {
    return DELETE(
      new Request(`http://localhost/api/memberships/${membershipId}`, {
        method: "DELETE",
      }),
      membershipParams(membershipId)
    );
  }

  it("refuses a non-admin actor (403)", async () => {
    const { queries } = createMembershipHarness({
      actorMembership: { ...ACTOR_MEMBERSHIP, role: "viewer" },
    });

    const response = await remove();

    expect(response.status).toBe(403);
    expect(queries.some((query) => query.mode === "delete")).toBe(false);
  });

  it("refuses self-deletion (409)", async () => {
    const { queries } = createMembershipHarness({
      targetMembership: { ...TARGET_MEMBERSHIP, user_id: ACTOR_USER_ID },
    });

    const response = await remove();

    expect(response.status).toBe(409);
    expect(queries.some((query) => query.mode === "delete")).toBe(false);
  });

  it("refuses to delete the last admin (409)", async () => {
    const { queries } = createMembershipHarness({
      targetMembership: { ...TARGET_MEMBERSHIP, role: "admin" },
      adminCount: 1,
    });

    const response = await remove();

    expect(response.status).toBe(409);
    expect(queries.some((query) => query.mode === "delete")).toBe(false);
  });
});

describe("DELETE /api/memberships/[membershipId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a membership", async () => {
    const { queries } = createMembershipHarness();

    const response = await DELETE(
      new Request(`http://localhost/api/memberships/${TARGET_MEMBERSHIP_ID}`, {
        method: "DELETE",
      }),
      membershipParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { deleted_id?: string };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({ deleted_id: TARGET_MEMBERSHIP_ID });
    expect(
      queries.some(
        (query) =>
          query.table === "tenant_memberships" && query.mode === "delete"
      )
    ).toBe(true);
    expect(createServiceRoleClient).not.toHaveBeenCalled();
  });
});
