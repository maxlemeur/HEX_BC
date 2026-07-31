import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET, POST } from "@/app/api/estimates/[versionId]/outliers/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TENANT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const ITEM_ID = "66666666-6666-4666-8666-666666666666";
const LOCK_ID = "77777777-7777-4777-8777-777777777777";
const PROJECT_ID = "88888888-8888-4888-8888-888888888888";

type MockError = {
  code: string;
  message: string;
};

type QueryResult = {
  data: unknown;
  error: MockError | null;
};

type QueryFilter = {
  method: "eq" | "gt";
  column: string;
  value: unknown;
};

type QueryCall = {
  table: string;
  operation: "select" | "upsert" | "delete";
  columns: string | null;
  payload: unknown;
  options: unknown;
  filters: QueryFilter[];
};

type Scenario = {
  userId: string | null;
  memberships: unknown[] | null;
  membershipError: MockError | null;
  version: unknown;
  versionError: MockError | null;
  lock: unknown;
  lockError: MockError | null;
  profile: unknown;
  item: unknown;
  itemError: MockError | null;
  dismissalRows: unknown[];
  dismissalSelectError: MockError | null;
  upsertError: MockError | null;
  deleteError: MockError | null;
};

type QueryBuilder = {
  select: (columns: string) => QueryBuilder;
  eq: (column: string, value: unknown) => QueryBuilder;
  gt: (column: string, value: unknown) => QueryBuilder;
  order: (column: string, options?: unknown) => QueryBuilder;
  limit: (value: number) => QueryBuilder;
  single: () => Promise<QueryResult>;
  maybeSingle: () => Promise<QueryResult>;
  upsert: (payload: unknown, options?: unknown) => Promise<QueryResult>;
  delete: () => QueryBuilder;
  then: Promise<QueryResult>["then"];
};

const DEFAULT_SCENARIO: Scenario = {
  userId: USER_ID,
  memberships: [
    {
      tenant_id: TENANT_ID,
      role: "engineer",
      is_default: true,
      created_at: "2026-07-01T08:00:00.000Z",
    },
  ],
  membershipError: null,
  version: {
    id: VERSION_ID,
    tenant_id: TENANT_ID,
    status: "draft",
    estimate_projects: {
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
    },
  },
  versionError: null,
  lock: {
    id: LOCK_ID,
    version_id: VERSION_ID,
    user_id: USER_ID,
    locked_at: "2026-07-31T08:00:00.000Z",
    expires_at: "2026-07-31T10:00:00.000Z",
  },
  lockError: null,
  profile: { full_name: "Autre utilisateur" },
  item: { id: ITEM_ID, item_type: "line" },
  itemError: null,
  dismissalRows: [],
  dismissalSelectError: null,
  upsertError: null,
  deleteError: null,
};

function createSupabaseHarness(overrides: Partial<Scenario> = {}) {
  const scenario: Scenario = { ...DEFAULT_SCENARIO, ...overrides };
  const calls: QueryCall[] = [];

  function resolveQuery(call: QueryCall): QueryResult {
    switch (call.table) {
      case "tenant_memberships":
        return {
          data: scenario.memberships,
          error: scenario.membershipError,
        };
      case "estimate_versions":
        return { data: scenario.version, error: scenario.versionError };
      case "draft_locks":
        return { data: scenario.lock, error: scenario.lockError };
      case "profiles":
        return { data: scenario.profile, error: null };
      case "estimate_items":
        return { data: scenario.item, error: scenario.itemError };
      case "estimate_item_outlier_dismissals":
        if (call.operation === "upsert") {
          return { data: null, error: scenario.upsertError };
        }
        if (call.operation === "delete") {
          return { data: null, error: scenario.deleteError };
        }
        return {
          data: scenario.dismissalRows,
          error: scenario.dismissalSelectError,
        };
      default:
        throw new Error(`Unexpected table: ${call.table}`);
    }
  }

  function createQueryBuilder(table: string): QueryBuilder {
    const call: QueryCall = {
      table,
      operation: "select",
      columns: null,
      payload: null,
      options: null,
      filters: [],
    };
    calls.push(call);

    const builder: QueryBuilder = {
      select(columns) {
        call.columns = columns;
        return builder;
      },
      eq(column, value) {
        call.filters.push({ method: "eq", column, value });
        return builder;
      },
      gt(column, value) {
        call.filters.push({ method: "gt", column, value });
        return builder;
      },
      order() {
        return builder;
      },
      limit() {
        return builder;
      },
      single() {
        return Promise.resolve(resolveQuery(call));
      },
      maybeSingle() {
        return Promise.resolve(resolveQuery(call));
      },
      upsert(payload, options) {
        call.operation = "upsert";
        call.payload = payload;
        call.options = options;
        return Promise.resolve(resolveQuery(call));
      },
      delete() {
        call.operation = "delete";
        return builder;
      },
      then(onFulfilled, onRejected) {
        return Promise.resolve(resolveQuery(call)).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: scenario.userId ? { id: scenario.userId } : null,
        },
      }),
    },
    from: vi.fn((table: string) => createQueryBuilder(table)),
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

  return { calls };
}

function getContext() {
  return {
    params: Promise.resolve({ versionId: VERSION_ID }),
  };
}

function createPostRequest(dismissed: boolean) {
  return new Request(`http://localhost/api/estimates/${VERSION_ID}/outliers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      item_id: ITEM_ID,
      flag_key: "price_outlier",
      dismissed,
    }),
  });
}

function findCall(
  calls: QueryCall[],
  table: string,
  operation: QueryCall["operation"] = "select"
) {
  return calls.find(
    (call) => call.table === table && call.operation === operation
  );
}

describe("estimate outlier dismissals route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      label: "unauthenticated requests",
      overrides: { userId: null },
      status: 401,
      code: "UNAUTHORIZED",
    },
    {
      label: "users without an active tenant",
      overrides: { memberships: [] },
      status: 403,
      code: "FORBIDDEN",
    },
    {
      label: "non-owners",
      overrides: {
        version: {
          ...DEFAULT_SCENARIO.version as Record<string, unknown>,
          estimate_projects: {
            id: PROJECT_ID,
            tenant_id: TENANT_ID,
            user_id: OTHER_USER_ID,
          },
        },
      },
      status: 404,
      code: "NOT_FOUND",
    },
    {
      label: "projects from another tenant",
      overrides: {
        version: {
          ...DEFAULT_SCENARIO.version as Record<string, unknown>,
          estimate_projects: {
            id: PROJECT_ID,
            tenant_id: OTHER_TENANT_ID,
            user_id: USER_ID,
          },
        },
      },
      status: 404,
      code: "NOT_FOUND",
    },
  ])("rejects $label without loading dismissals", async ({ overrides, status, code }) => {
    const { calls } = createSupabaseHarness(overrides);

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/outliers`),
      getContext()
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
    expect(findCall(calls, "estimate_item_outlier_dismissals")).toBeUndefined();
  });

  it("returns a tenant-scoped, deduplicated dismissal map to tenant admins", async () => {
    const { calls } = createSupabaseHarness({
      memberships: [
        {
          tenant_id: TENANT_ID,
          role: "admin",
          is_default: true,
          created_at: "2026-07-01T08:00:00.000Z",
        },
      ],
      version: {
        ...DEFAULT_SCENARIO.version as Record<string, unknown>,
        estimate_projects: {
          id: PROJECT_ID,
          tenant_id: TENANT_ID,
          user_id: OTHER_USER_ID,
        },
      },
      dismissalRows: [
        { item_id: ITEM_ID, flag_key: "price_outlier" },
        { item_id: ITEM_ID, flag_key: "price_outlier" },
        { item_id: ITEM_ID, flag_key: "quantity_outlier" },
      ],
    });

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/outliers`),
      getContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        dismissed_by_item_id: {
          [ITEM_ID]: ["price_outlier", "quantity_outlier"],
        },
      },
    });

    expect(findCall(calls, "estimate_versions")?.filters).toEqual(
      expect.arrayContaining([
        { method: "eq", column: "id", value: VERSION_ID },
        { method: "eq", column: "tenant_id", value: TENANT_ID },
      ])
    );
    expect(
      findCall(calls, "estimate_item_outlier_dismissals")?.filters
    ).toEqual([
      { method: "eq", column: "tenant_id", value: TENANT_ID },
      { method: "eq", column: "version_id", value: VERSION_ID },
    ]);
  });

  it("rejects read-only versions before checking locks or items", async () => {
    const { calls } = createSupabaseHarness({
      version: {
        ...DEFAULT_SCENARIO.version as Record<string, unknown>,
        status: "sent",
      },
    });

    const response = await POST(createPostRequest(true), getContext());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "READ_ONLY" },
    });
    expect(findCall(calls, "draft_locks")).toBeUndefined();
    expect(findCall(calls, "estimate_items")).toBeUndefined();
  });

  it.each([
    {
      label: "is absent",
      overrides: { lock: null },
      code: "LOCK_REQUIRED",
      details: { lock: null },
    },
    {
      label: "belongs to another user",
      overrides: {
        lock: {
          ...DEFAULT_SCENARIO.lock as Record<string, unknown>,
          user_id: OTHER_USER_ID,
        },
      },
      code: "CONFLICT",
      details: {
        lock: {
          user_id: OTHER_USER_ID,
          holder_name: "Autre utilisateur",
          is_owner: false,
        },
      },
    },
  ])("rejects writes when the active lock $label", async ({ overrides, code, details }) => {
    const { calls } = createSupabaseHarness(overrides);

    const response = await POST(createPostRequest(true), getContext());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code, details },
    });
    expect(findCall(calls, "estimate_items")).toBeUndefined();
    expect(
      findCall(calls, "estimate_item_outlier_dismissals", "upsert")
    ).toBeUndefined();
  });

  it("rejects non-line items after a tenant-scoped lookup", async () => {
    const { calls } = createSupabaseHarness({
      item: { id: ITEM_ID, item_type: "section" },
    });

    const response = await POST(createPostRequest(true), getContext());

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "BAD_REQUEST" },
    });
    expect(findCall(calls, "estimate_items")?.filters).toEqual([
      { method: "eq", column: "tenant_id", value: TENANT_ID },
      { method: "eq", column: "version_id", value: VERSION_ID },
      { method: "eq", column: "id", value: ITEM_ID },
    ]);
  });

  it.each([
    { dismissed: true, operation: "upsert" as const },
    { dismissed: false, operation: "delete" as const },
  ])("persists dismissed=$dismissed with a scoped $operation", async ({
    dismissed,
    operation,
  }) => {
    const expectedDismissedByItemId = dismissed
      ? { [ITEM_ID]: ["price_outlier"] }
      : {};
    const { calls } = createSupabaseHarness({
      dismissalRows: dismissed
        ? [{ item_id: ITEM_ID, flag_key: "price_outlier" }]
        : [],
    });

    const response = await POST(createPostRequest(dismissed), getContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        dismissed_by_item_id: expectedDismissedByItemId,
      },
    });

    const mutationCall = findCall(
      calls,
      "estimate_item_outlier_dismissals",
      operation
    );
    expect(mutationCall).toBeDefined();

    if (operation === "upsert") {
      expect(mutationCall?.payload).toMatchObject({
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        item_id: ITEM_ID,
        flag_key: "price_outlier",
        dismissed_by: USER_ID,
      });
      expect(mutationCall?.options).toEqual({
        onConflict: "version_id,item_id,flag_key",
      });
    } else {
      expect(mutationCall?.filters).toEqual([
        { method: "eq", column: "tenant_id", value: TENANT_ID },
        { method: "eq", column: "version_id", value: VERSION_ID },
        { method: "eq", column: "item_id", value: ITEM_ID },
        { method: "eq", column: "flag_key", value: "price_outlier" },
      ]);
    }
  });
});
