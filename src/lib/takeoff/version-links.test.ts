import { beforeEach, describe, expect, it, vi } from "vitest";

import { linkTakeoffJobsFromSourceVersionToTargetVersion } from "@/lib/takeoff/version-links";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SOURCE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const TARGET_VERSION_ID = "44444444-4444-4444-8444-444444444444";
const ORIGINAL_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const LEGACY_VERSION_ID = "66666666-6666-4666-8666-666666666666";

type CarryOverMockInput = {
  directJobIds: string[];
  inheritedLinks: Array<{
    takeoff_job_id: string;
    source_version_id: string;
  }>;
  upsertedRows: Array<{ id: string }>;
};

function createCarryOverSupabaseMock(input: CarryOverMockInput) {
  const takeoffJobsSelectBuilder = {
    eq: vi.fn(),
  };
  takeoffJobsSelectBuilder.eq.mockReturnValueOnce(takeoffJobsSelectBuilder);
  takeoffJobsSelectBuilder.eq.mockResolvedValueOnce({
    data: input.directJobIds.map((id) => ({ id })),
    error: null,
  });

  const inheritedLinksSelectBuilder = {
    eq: vi.fn(),
  };
  inheritedLinksSelectBuilder.eq.mockReturnValueOnce(inheritedLinksSelectBuilder);
  inheritedLinksSelectBuilder.eq.mockResolvedValueOnce({
    data: input.inheritedLinks.map((link) => ({
      takeoff_job_id: link.takeoff_job_id,
      source_version_id: link.source_version_id,
      target_version_id: SOURCE_VERSION_ID,
      linked_at: "2026-03-01T10:00:00.000Z",
    })),
    error: null,
  });

  const takeoffVersionLinksUpsertSelect = vi.fn(async (columns: string) => {
    void columns;
    return {
      data: input.upsertedRows,
      error: null,
    };
  });
  const takeoffVersionLinksUpsert = vi.fn(
    (payload: Array<Record<string, unknown>>, options: Record<string, unknown>) => {
      void payload;
      void options;
      return {
        select: takeoffVersionLinksUpsertSelect,
      };
    }
  );

  const takeoffJobsSelect = vi.fn(() => takeoffJobsSelectBuilder);
  const takeoffVersionLinksSelect = vi.fn(() => inheritedLinksSelectBuilder);

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        return {
          select: takeoffJobsSelect,
        };
      }

      if (table === "takeoff_version_links") {
        return {
          select: takeoffVersionLinksSelect,
          upsert: takeoffVersionLinksUpsert,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase: supabase as never,
    takeoffVersionLinksUpsert,
    takeoffVersionLinksUpsertSelect,
  };
}

describe("linkTakeoffJobsFromSourceVersionToTargetVersion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("carries inherited jobs forward when the source version has no direct jobs", async () => {
    const inheritedJobId = "77777777-7777-4777-8777-777777777777";
    const mock = createCarryOverSupabaseMock({
      directJobIds: [],
      inheritedLinks: [
        {
          takeoff_job_id: inheritedJobId,
          source_version_id: ORIGINAL_VERSION_ID,
        },
      ],
      upsertedRows: [{ id: "88888888-8888-4888-8888-888888888888" }],
    });

    const result = await linkTakeoffJobsFromSourceVersionToTargetVersion({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
    });

    expect(result).toEqual({
      source_job_count: 1,
      linked_count: 1,
    });
    expect(mock.takeoffVersionLinksUpsert).toHaveBeenCalledTimes(1);
    expect(mock.takeoffVersionLinksUpsertSelect).toHaveBeenCalledWith("id");

    const [payload, options] = mock.takeoffVersionLinksUpsert.mock.calls[0]!;
    expect(payload).toEqual([
      {
        tenant_id: TENANT_ID,
        takeoff_job_id: inheritedJobId,
        source_version_id: ORIGINAL_VERSION_ID,
        target_version_id: TARGET_VERSION_ID,
        linked_by: USER_ID,
      },
    ]);
    expect(options).toEqual({
      onConflict: "takeoff_job_id,target_version_id",
      ignoreDuplicates: true,
    });
  });

  it("combines direct and inherited jobs and preserves each job source version", async () => {
    const directJobId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const inheritedJobId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const overlappingJobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const mock = createCarryOverSupabaseMock({
      directJobIds: [directJobId, overlappingJobId],
      inheritedLinks: [
        {
          takeoff_job_id: inheritedJobId,
          source_version_id: ORIGINAL_VERSION_ID,
        },
        {
          takeoff_job_id: overlappingJobId,
          source_version_id: LEGACY_VERSION_ID,
        },
      ],
      upsertedRows: [
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
        { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" },
        { id: "ffffffff-ffff-4fff-8fff-ffffffffffff" },
      ],
    });

    const result = await linkTakeoffJobsFromSourceVersionToTargetVersion({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      sourceVersionId: SOURCE_VERSION_ID,
      targetVersionId: TARGET_VERSION_ID,
    });

    expect(result).toEqual({
      source_job_count: 3,
      linked_count: 3,
    });
    expect(mock.takeoffVersionLinksUpsert).toHaveBeenCalledTimes(1);

    const [payload] = mock.takeoffVersionLinksUpsert.mock.calls[0]!;
    expect(payload).toHaveLength(3);
    expect(payload).toEqual(
      expect.arrayContaining([
        {
          tenant_id: TENANT_ID,
          takeoff_job_id: directJobId,
          source_version_id: SOURCE_VERSION_ID,
          target_version_id: TARGET_VERSION_ID,
          linked_by: USER_ID,
        },
        {
          tenant_id: TENANT_ID,
          takeoff_job_id: inheritedJobId,
          source_version_id: ORIGINAL_VERSION_ID,
          target_version_id: TARGET_VERSION_ID,
          linked_by: USER_ID,
        },
        {
          tenant_id: TENANT_ID,
          takeoff_job_id: overlappingJobId,
          source_version_id: SOURCE_VERSION_ID,
          target_version_id: TARGET_VERSION_ID,
          linked_by: USER_ID,
        },
      ])
    );
  });
});
