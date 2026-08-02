import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  acquireLock,
  releaseLock,
  renewLock,
} from "@/lib/estimates/locks";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "66666666-6666-4666-8666-666666666666";
const OTHER_SESSION_ID = "77777777-7777-4777-8777-777777777777";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";

const LOCK_ID = "55555555-5555-4555-8555-555555555555";
const LOCKED_AT = "2026-02-21T10:00:00.000Z";
const EXPIRES_AT = "2026-02-21T10:30:00.000Z";

type SupabaseError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
};

type QueryResult<T> = {
  data: T;
  error: SupabaseError | null;
};

type LockRow = {
  id: string;
  version_id: string;
  user_id: string;
  session_id: string;
  tenant_id: string;
  locked_at: string;
  expires_at: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  work_email: string | null;
};

type SupabaseMockConfig = {
  role?: "admin" | "engineer" | "viewer";
  versionStatus?: "draft" | "sent" | "accepted" | "archived";
  versionOwnerUserId?: string;
  insertLockResult?: QueryResult<LockRow | null>;
  existingLockResults?: QueryResult<LockRow | null>[];
  updateLockResult?: QueryResult<LockRow | null>;
  deleteLockResult?: QueryResult<LockRow | null>;
  ownerProfileResults?: QueryResult<ProfileRow | null>[];
  cleanupError?: SupabaseError | null;
};

function createSupabaseError(code: string, message: string): SupabaseError {
  return {
    code,
    message,
    details: null,
    hint: null,
  };
}

function createLockRow(userId: string, overrides?: Partial<LockRow>): LockRow {
  return {
    id: LOCK_ID,
    version_id: VERSION_ID,
    user_id: userId,
    session_id: userId === USER_ID ? SESSION_ID : OTHER_SESSION_ID,
    tenant_id: TENANT_ID,
    locked_at: LOCKED_AT,
    expires_at: EXPIRES_AT,
    created_at: LOCKED_AT,
    ...overrides,
  };
}

function createSupabaseMock(config: SupabaseMockConfig = {}) {
  const existingLockResults = [...(config.existingLockResults ?? [])];
  const ownerProfileResults = [...(config.ownerProfileResults ?? [])];

  const tenantMembershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  tenantMembershipBuilder.eq.mockReturnValue(tenantMembershipBuilder);
  tenantMembershipBuilder.order.mockReturnValue(tenantMembershipBuilder);
  tenantMembershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: config.role ?? "engineer",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const estimateVersionBuilder = {
    eq: vi.fn(),
    single: vi.fn(),
  };

  estimateVersionBuilder.eq.mockReturnValue(estimateVersionBuilder);
  estimateVersionBuilder.single.mockResolvedValue({
    data: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      status: config.versionStatus ?? "draft",
      estimate_projects: {
        tenant_id: TENANT_ID,
        user_id: config.versionOwnerUserId ?? USER_ID,
      },
    },
    error: null,
  });

  const draftLockSelectBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => {
      return (
        existingLockResults.shift() ?? {
          data: null,
          error: null,
        }
      );
    }),
  };

  draftLockSelectBuilder.eq.mockReturnValue(draftLockSelectBuilder);

  const draftLockInsertSingle = vi
    .fn()
    .mockResolvedValue(
      config.insertLockResult ?? {
        data: createLockRow(USER_ID),
        error: null,
      }
    );

  const draftLockInsertSelect = {
    single: draftLockInsertSingle,
  };

  const draftLockInsert = vi.fn(() => ({
    select: vi.fn(() => draftLockInsertSelect),
  }));

  const draftLockUpdateMaybeSingle = vi
    .fn()
    .mockResolvedValue(
      config.updateLockResult ?? {
        data: createLockRow(USER_ID, {
          expires_at: "2026-02-21T11:00:00.000Z",
        }),
        error: null,
      }
    );

  const draftLockUpdateBuilder = {
    eq: vi.fn(),
    select: vi.fn(() => ({
      maybeSingle: draftLockUpdateMaybeSingle,
    })),
  };

  draftLockUpdateBuilder.eq.mockReturnValue(draftLockUpdateBuilder);

  const draftLockUpdate = vi.fn(() => draftLockUpdateBuilder);

  const draftLockDeleteMaybeSingle = vi
    .fn()
    .mockResolvedValue(
      config.deleteLockResult ?? {
        data: createLockRow(USER_ID),
        error: null,
      }
    );

  const draftLockDeleteBuilder = {
    eq: vi.fn(),
    select: vi.fn(() => ({
      maybeSingle: draftLockDeleteMaybeSingle,
    })),
  };

  draftLockDeleteBuilder.eq.mockReturnValue(draftLockDeleteBuilder);

  const draftLockDelete = vi.fn(() => draftLockDeleteBuilder);

  const profileBuilder = {
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => {
      return (
        ownerProfileResults.shift() ?? {
          data: {
            id: USER_ID,
            full_name: "Owner User",
            work_email: "owner@example.com",
          },
          error: null,
        }
      );
    }),
  };

  profileBuilder.eq.mockReturnValue(profileBuilder);

  const supabase = {
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
    rpc: vi.fn().mockResolvedValue({
      data: 0,
      error: config.cleanupError ?? null,
    }),
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => tenantMembershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => estimateVersionBuilder),
        };
      }

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLockSelectBuilder),
          insert: draftLockInsert,
          update: draftLockUpdate,
          delete: draftLockDelete,
        };
      }

      if (table === "profiles") {
        return {
          select: vi.fn(() => profileBuilder),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    __mocks: {
      draftLockInsert,
      draftLockUpdate,
      draftLockDelete,
    },
  };

  return supabase;
}

describe("estimate draft locks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires a lock and cleans up expired locks first", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await acquireLock(VERSION_ID, SESSION_ID);

    expect(supabase.rpc).toHaveBeenCalledWith("cleanup_expired_draft_locks", {
      target_tenant_id: TENANT_ID,
    });
    expect(result.lock.user_id).toBe(USER_ID);
    expect(result.lock.session_id).toBe(SESSION_ID);
    expect(result.lock.is_current_user).toBe(true);
    expect(result.lock.is_current_session).toBe(true);
    expect(supabase.__mocks.draftLockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: SESSION_ID })
    );
  });

  it("returns 409 with owner details when another user owns the lock", async () => {
    const supabase = createSupabaseMock({
      insertLockResult: {
        data: null,
        error: createSupabaseError("23505", "duplicate key value violates unique constraint"),
      },
      existingLockResults: [
        {
          data: createLockRow(OTHER_USER_ID),
          error: null,
        },
      ],
      ownerProfileResults: [
        {
          data: {
            id: OTHER_USER_ID,
            full_name: "Alice Martin",
            work_email: "alice.martin@example.com",
          },
          error: null,
        },
      ],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(acquireLock(VERSION_ID, SESSION_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      details: {
        lock: {
          user_id: OTHER_USER_ID,
          owner: {
            full_name: "Alice Martin",
          },
        },
      },
    });
  });

  it("rejects another page opened by the same user", async () => {
    const supabase = createSupabaseMock({
      insertLockResult: {
        data: null,
        error: createSupabaseError(
          "23505",
          "duplicate key value violates unique constraint"
        ),
      },
      existingLockResults: [
        {
          data: createLockRow(USER_ID, { session_id: OTHER_SESSION_ID }),
          error: null,
        },
      ],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      acquireLock(VERSION_ID, SESSION_ID)
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      details: {
        lock: {
          user_id: USER_ID,
          session_id: OTHER_SESSION_ID,
          is_current_user: true,
          is_current_session: false,
        },
      },
    });
  });

  it("renews an existing lock for the owner", async () => {
    const supabase = createSupabaseMock({
      updateLockResult: {
        data: createLockRow(USER_ID, {
          expires_at: "2026-02-21T12:00:00.000Z",
        }),
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await renewLock(VERSION_ID, SESSION_ID);

    expect(result.lock.user_id).toBe(USER_ID);
    expect(result.lock.owner?.id).toBe(USER_ID);
    expect(supabase.__mocks.draftLockUpdate).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when release is requested by a non-owner", async () => {
    const supabase = createSupabaseMock({
      deleteLockResult: {
        data: null,
        error: null,
      },
      existingLockResults: [
        {
          data: createLockRow(OTHER_USER_ID),
          error: null,
        },
      ],
      ownerProfileResults: [
        {
          data: {
            id: OTHER_USER_ID,
            full_name: "Owner Lock",
            work_email: "owner.lock@example.com",
          },
          error: null,
        },
      ],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(releaseLock(VERSION_ID, SESSION_ID)).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      details: {
        lock: {
          user_id: OTHER_USER_ID,
          owner: {
            full_name: "Owner Lock",
          },
        },
      },
    });
  });

  it("does not release a lock held by another page of the same user", async () => {
    const supabase = createSupabaseMock({
      deleteLockResult: {
        data: null,
        error: null,
      },
      existingLockResults: [
        {
          data: createLockRow(USER_ID, { session_id: OTHER_SESSION_ID }),
          error: null,
        },
      ],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      releaseLock(VERSION_ID, SESSION_ID)
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
      details: {
        lock: {
          user_id: USER_ID,
          session_id: OTHER_SESSION_ID,
          is_current_session: false,
        },
      },
    });
  });

  it("rejects force release for non-admin users", async () => {
    const supabase = createSupabaseMock({
      role: "engineer",
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      releaseLock(VERSION_ID, SESSION_ID, {
        force: true,
      })
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Seuls les admins peuvent forcer le deverrouillage.",
    });
  });

  it("allows force release for admins", async () => {
    const supabase = createSupabaseMock({
      role: "admin",
      deleteLockResult: {
        data: createLockRow(OTHER_USER_ID),
        error: null,
      },
      ownerProfileResults: [
        {
          data: {
            id: OTHER_USER_ID,
            full_name: "Locked User",
            work_email: "locked.user@example.com",
          },
          error: null,
        },
      ],
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await releaseLock(VERSION_ID, SESSION_ID, {
      force: true,
    });

    expect(result.released).toBe(true);
    expect(result.lock?.user_id).toBe(OTHER_USER_ID);
    expect(supabase.__mocks.draftLockDelete).toHaveBeenCalledTimes(1);
  });
});
