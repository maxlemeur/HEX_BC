import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
}));

import { DELETE } from "@/app/api/affaires/[projectId]/route";
import { getAuthenticatedContext } from "@/lib/estimates/server";

const PROJECT_ID = "eb972cff-4870-4eb5-a079-f37f6fce42e9";
const TENANT_ID = "11111111-1111-4111-8111-111111111111";

function createSupabaseMock({
  versions = [{ status: "draft" }],
  deleteError = null,
}: {
  versions?: Array<{ status: string }>;
  deleteError?: { code?: string; message?: string; details?: string } | null;
}) {
  const single = vi.fn(async () => ({
    data: {
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      is_archived: false,
      estimate_versions: versions,
    },
    error: null,
  }));

  const selectEqTenant = {
    eq: vi.fn(() => ({
      single,
    })),
  };

  const selectEqId = {
    eq: vi.fn(() => selectEqTenant),
  };

  const deleteEq = vi.fn(async () => ({
    error: deleteError,
  }));

  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== "estimate_projects") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: vi.fn(() => selectEqId),
        delete: vi.fn(() => ({
          eq: deleteEq,
        })),
      };
    }),
  };

  return { supabase, deleteEq, single };
}

describe("DELETE /api/affaires/[projectId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes a draft-only affaire", async () => {
    const { supabase, deleteEq } = createSupabaseMock({});
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: supabase as never,
      tenantId: TENANT_ID,
    } as never);

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(200);
    expect(deleteEq).toHaveBeenCalledWith("id", PROJECT_ID);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: {
        deleted: true,
      },
    });
  });

  it("maps Supabase delete errors instead of throwing a 500", async () => {
    const { supabase } = createSupabaseMock({
      deleteError: {
        code: "42501",
        message: "ESTIMATE_VERSION_EVENTS_APPEND_ONLY",
        details: "estimate_version_events is append-only and does not allow update/delete.",
      },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: supabase as never,
      tenantId: TENANT_ID,
    } as never);

    const response = await DELETE(new Request("http://localhost"), {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "FORBIDDEN",
        message: "Acces refuse.",
      }),
    });
  });
});
