import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import {
  connectionSecretContext,
  sealDriveSecret,
} from "@/lib/affaires/google-drive/secrets";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_USER_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_USER_ID = "44444444-4444-4444-8444-444444444444";
const ACTOR_MEMBERSHIP_ID = "55555555-5555-4555-8555-555555555555";
const TARGET_MEMBERSHIP_ID = "66666666-6666-4666-8666-666666666666";
const DRIVE_CONNECTION_ID = "77777777-7777-4777-8777-777777777777";
const DRIVE_GRANT_VERSION = "88888888-8888-4888-8888-888888888888";
const DRIVE_TOKEN_KEY = Buffer.alloc(32, 5);

type TenantRole = "admin" | "engineer" | "viewer" | "director";
type QueryMode = "read" | "insert" | "update" | "delete";
type QuerySource = "authenticated" | "directory";
type SelectOptions = { count?: "exact"; head?: boolean };
type QueryResult = {
  data: unknown;
  error: { code: string; message: string } | null;
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
  // The target member's Google Drive connection, and whether its Google account is connected elsewhere.
  drive: { connectedElsewhere: boolean } | null;
  removalFails: boolean;
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

    if (this.table === "google_drive_connections") {
      // The membership trigger deletes the member's connection with the membership.
      if (this.hasFilter("google_account_id"))
        return {
          data: this.scenario.drive?.connectedElsewhere ? [{ id: "elsewhere" }] : [],
          error: null,
        };
      return {
        data: this.scenario.drive
          ? { id: DRIVE_CONNECTION_ID, grant_version: DRIVE_GRANT_VERSION }
          : null,
        error: null,
      };
    }

    if (this.table !== "tenant_memberships") {
      throw new Error(`Unexpected table: ${this.table}`);
    }

    if (
      /tenants!inner\([^)]*\bis_active\b/.test(this.selectedColumns) &&
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
      return {
        data: null,
        error: this.scenario.removalFails ? { code: "XX000", message: "fixture failure" } : null,
      };
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
    drive: null,
    removalFails: false,
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
    rpc: vi.fn(async (name: string) => {
      if (name !== "google_drive_single_secret" || !scenario.drive)
        return { data: [], error: null };
      const context = connectionSecretContext(TENANT_ID, TARGET_USER_ID, "google_account_fixture");
      return {
        data: [{
          tenant_id: TENANT_ID,
          user_id: TARGET_USER_ID,
          google_account_id: "google_account_fixture",
          status: "active",
          updated_at: "2026-07-03T08:00:00.000Z",
          shared_grant: scenario.drive.connectedElsewhere,
          refresh_token_ciphertext: sealDriveSecret(DRIVE_TOKEN_KEY, "fixture-refresh", context),
          write_refresh_token_ciphertext: null,
          write_enabled: false,
          grant_version: DRIVE_GRANT_VERSION,
        }],
        error: null,
      };
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
      message: "Aucune organisation active pour cet utilisateur.",
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

describe("removing a member who connected Google Drive (Google simulated)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_ENABLED", "true");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_ID", "fixture-client");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_CLIENT_SECRET", "fixture-secret");
    vi.stubEnv("MERGEONE_GOOGLE_DRIVE_TOKEN_KEY", DRIVE_TOKEN_KEY.toString("base64"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:9");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-role");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const answerRevocations = (queries: MembershipQuery[], status: number) => {
    const revocations: Array<{ token: string | null; afterRemoval: boolean }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://oauth2.googleapis.com/revoke");
      revocations.push({
        token: new URLSearchParams(String(init.body)).get("token"),
        afterRemoval: queries.some((query) => query.table === "tenant_memberships" && query.mode === "delete"),
      });
      return new Response(null, { status });
    }));
    return revocations;
  };

  it.each([
    { connectedElsewhere: false, revoked: ["fixture-refresh"] },
    { connectedElsewhere: true, revoked: [] },
  ])("revokes their Google grant after the removal unless the account stays connected elsewhere ($connectedElsewhere)", async ({ connectedElsewhere, revoked }) => {
    const { queries } = createMembershipHarness({ drive: { connectedElsewhere } });
    const revocations = answerRevocations(queries, 200);

    await expect(deleteMembership(TARGET_MEMBERSHIP_ID)).resolves.toEqual({ deleted_id: TARGET_MEMBERSHIP_ID });
    expect(revocations).toEqual(revoked.map((token) => ({ token, afterRemoval: true })));
  });

  it("removes the member when Google fails to revoke their grant", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { queries } = createMembershipHarness({ drive: { connectedElsewhere: false } });
      const revocations = answerRevocations(queries, 503);

      await expect(deleteMembership(TARGET_MEMBERSHIP_ID)).resolves.toEqual({ deleted_id: TARGET_MEMBERSHIP_ID });
      expect(revocations).toEqual([{ token: "fixture-refresh", afterRemoval: true }]);
      expect(logged).toHaveBeenCalledWith("Google Drive grant not revoked", expect.objectContaining({ cause: "member_removed" }));
    } finally {
      logged.mockRestore();
    }
  });

  it("revokes nothing when the membership could not be removed", async () => {
    const { queries } = createMembershipHarness({ drive: { connectedElsewhere: false }, removalFails: true });
    const revocations = answerRevocations(queries, 200);

    await expect(deleteMembership(TARGET_MEMBERSHIP_ID)).rejects.toThrow("Impossible de retirer le membre.");
    expect(revocations).toEqual([]);
  });
});
