import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthenticatedContextMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: getAuthenticatedContextMock,
}));

import {
  bulkArchiveDraftAffaires,
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
      bulkDeleteDraftAffaires([PROJECT_A, PROJECT_B]),
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
  it("chunks large selections into safe 100-affaire RPC calls", async () => {
    const projectIds = Array.from(
      { length: 205 },
      (_, index) =>
        `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    const rpc = vi
      .fn()
      .mockImplementation((_name: string, args: { p_project_ids: string[] }) =>
        Promise.resolve({
          data: args.p_project_ids.map((projectId) => ({
            project_id: projectId,
            outcome: "deleted",
            message: null,
          })),
          error: null,
        }),
      );
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: { rpc },
    });

    const result = await bulkDeleteDraftAffaires(projectIds);

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((call) => call[1].p_project_ids.length)).toEqual([
      100, 100, 5,
    ]);
    expect(result.deletedIds).toHaveLength(205);
    expect(result.failures).toEqual([]);
  });

  it("reports unprocessed identifiers when a later RPC batch fails", async () => {
    const projectIds = Array.from(
      { length: 105 },
      (_, index) =>
        `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: projectIds.slice(0, 100).map((projectId) => ({
          project_id: projectId,
          outcome: "deleted",
          message: null,
        })),
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "08006", message: "connection failure" },
      });
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: { rpc },
    });

    const result = await bulkDeleteDraftAffaires(projectIds);

    expect(result.deletedIds).toHaveLength(100);
    expect(result.failures).toHaveLength(5);
    expect(result.failures.map((failure) => failure.projectId)).toEqual(
      projectIds.slice(100),
    );
  });
});

describe("bulkArchiveDraftAffaires", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("scopes archive requests to the authenticated tenant and reports partial results", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { project_id: PROJECT_A, outcome: "archived", message: null },
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

    const result = await bulkArchiveDraftAffaires([
      PROJECT_A,
      PROJECT_B,
      PROJECT_A,
    ]);

    expect(rpc).toHaveBeenCalledWith("bulk_archive_draft_affaires", {
      p_tenant_id: TENANT_ID,
      p_project_ids: [PROJECT_A, PROJECT_B],
    });
    expect(result).toEqual({
      requestedCount: 2,
      archivedIds: [PROJECT_A],
      failures: [
        {
          projectId: PROJECT_B,
          reason: "not_eligible",
          message: "Affaire non eligible.",
        },
      ],
    });
  });

  it("chunks large archive selections into safe 100-affaire RPC calls", async () => {
    const projectIds = Array.from(
      { length: 205 },
      (_, index) =>
        `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    const rpc = vi
      .fn()
      .mockImplementation((_name: string, args: { p_project_ids: string[] }) =>
        Promise.resolve({
          data: args.p_project_ids.map((projectId) => ({
            project_id: projectId,
            outcome: "archived",
            message: null,
          })),
          error: null,
        }),
      );
    getAuthenticatedContextMock.mockResolvedValue({
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: { rpc },
    });

    const result = await bulkArchiveDraftAffaires(projectIds);

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc.mock.calls.map((call) => call[1].p_project_ids.length)).toEqual([
      100, 100, 5,
    ]);
    expect(result.archivedIds).toHaveLength(205);
    expect(result.failures).toEqual([]);
  });
});
describe("bulkDeleteAffairesInputSchema", () => {
  it("deduplicates identifiers and enforces the 1,000-affaire API limit", () => {
    expect(
      bulkDeleteAffairesInputSchema.parse({
        projectIds: [PROJECT_A, PROJECT_A],
      }).projectIds,
    ).toEqual([PROJECT_A]);

    const maximumBatch = Array.from(
      { length: 1000 },
      (_, index) =>
        `${String(index).padStart(8, "0")}-0000-4000-8000-000000000000`,
    );
    expect(
      bulkDeleteAffairesInputSchema.parse({ projectIds: maximumBatch })
        .projectIds,
    ).toHaveLength(1000);
    expect(() =>
      bulkDeleteAffairesInputSchema.parse({
        projectIds: [...maximumBatch, "00001000-0000-4000-8000-000000000000"],
      }),
    ).toThrow();
  });
});
