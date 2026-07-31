import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedContextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: getAuthenticatedContextMock,
}));

import {
  bulkDeleteAffairesInputSchema,
  bulkDeleteDraftAffaires,
} from "./delete-server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("bulkDeleteDraftAffaires", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes the RPC to the authenticated tenant and reports partial results", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { project_id: PROJECT_A, outcome: "deleted", message: null },
        {
          project_id: PROJECT_B,
          outcome: "not_eligible",
          message: "Affaire non eligible.",
        },
      ],
      error: null,
    });
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "engineer",
      supabase: { rpc },
    });

    const result = await bulkDeleteDraftAffaires([
      PROJECT_A,
      PROJECT_B,
      PROJECT_A,
    ]);

    expect(rpc).toHaveBeenCalledWith("bulk_delete_draft_affaires", {
      p_tenant_id: TENANT_ID,
      p_project_ids: [PROJECT_A, PROJECT_B],
    });
    expect(result).toEqual({
      requestedCount: 2,
      deletedIds: [PROJECT_A],
      failures: [
        {
          projectId: PROJECT_B,
          reason: "not_eligible",
          message: "Affaire non eligible.",
        },
      ],
    });
  });

  it("rejects read-only tenant roles before calling the RPC", async () => {
    const rpc = vi.fn();
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "viewer",
      supabase: { rpc },
    });

    await expect(bulkDeleteDraftAffaires([PROJECT_A])).rejects.toMatchObject({
      status: 403,
      code: "ESTIMATE_WRITE_ROLE_REQUIRED",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("marks missing RPC rows as failures instead of treating them as deleted", async () => {
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: {
        rpc: vi.fn().mockResolvedValue({
          data: [{ project_id: PROJECT_A, outcome: "deleted", message: null }],
          error: null,
        }),
      },
    });

    await expect(
      bulkDeleteDraftAffaires([PROJECT_A, PROJECT_B])
    ).resolves.toEqual({
      requestedCount: 2,
      deletedIds: [PROJECT_A],
      failures: [
        {
          projectId: PROJECT_B,
          reason: "failed",
          message: "Aucun resultat de suppression n'a ete retourne.",
        },
      ],
    });
  });
});

describe("bulkDeleteAffairesInputSchema", () => {
  it("deduplicates identifiers and rejects oversized batches", () => {
    expect(
      bulkDeleteAffairesInputSchema.parse({
        projectIds: [PROJECT_A, PROJECT_A],
      }).projectIds
    ).toEqual([PROJECT_A]);

    expect(() =>
      bulkDeleteAffairesInputSchema.parse({
        projectIds: Array.from(
          { length: 101 },
          (_, index) =>
            `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`
        ),
      })
    ).toThrow();
  });
});
