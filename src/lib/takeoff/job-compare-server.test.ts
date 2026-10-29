import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ assertTakeoffEnabled: vi.fn() }));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { compareTakeoffJobs } from "@/lib/takeoff/job-compare-server";
import {
  authenticatedContext,
  createSupabaseFake,
  filterValue,
  M3_JOB_ID,
  M3_TENANT_ID,
  takeoffItemRow,
  takeoffJobRow,
  type SupabaseFake,
} from "@/lib/takeoff/metre-m3.test-utils";

const OTHER_JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function useFake(fake: SupabaseFake) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue(authenticatedContext(fake) as never);
}

function createComparisonFake(otherJob: Record<string, unknown> | null = {}) {
  return createSupabaseFake({
    tables: {
      takeoff_jobs: (query) => ({
        data: filterValue(query, "id") === M3_JOB_ID
          ? takeoffJobRow()
          : otherJob === null ? null : takeoffJobRow({ id: OTHER_JOB_ID, ...otherJob }),
        error: null,
      }),
      takeoff_items: () => ({ data: [], count: 0, error: null }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
});

describe("takeoff job comparison boundary", () => {
  it.each([
    { estimate_version_id: OTHER_JOB_ID },
    { source_file_name: "Plan R-1.pdf" },
    { source_file_name: null },
    { plan_set_id: OTHER_JOB_ID },
  ])("checks version and durable document identity before loading items (%j)", async (other) => {
    const fake = createComparisonFake(other);
    useFake(fake);
    await expect(compareTakeoffJobs(M3_JOB_ID, { with: OTHER_JOB_ID }))
      .rejects.toMatchObject({ status: 409, code: "CONFLICT" });
    expect(fake.tablesTouched).toEqual(["takeoff_jobs", "takeoff_jobs"]);
  });

  it("requires both jobs to be accessible in the active tenant", async () => {
    const fake = createComparisonFake(null);
    useFake(fake);
    await expect(compareTakeoffJobs(M3_JOB_ID, { with: OTHER_JOB_ID }))
      .rejects.toMatchObject({ status: 404 });
    expect(fake.tablesTouched).toEqual(["takeoff_jobs", "takeoff_jobs"]);
    for (const query of fake.queries) expect(filterValue(query, "tenant_id")).toBe(M3_TENANT_ID);
  });

  it("compares the full item collection beyond the first 200 rows", async () => {
    const reads = new Map<string, number>();
    const fake = createSupabaseFake({
      tables: {
        takeoff_jobs: (query) => ({ data: takeoffJobRow({ id: filterValue(query, "id") }), error: null }),
        takeoff_items: (query) => {
          const jobId = String(filterValue(query, "job_id"));
          const page = reads.get(jobId) ?? 0;
          reads.set(jobId, page + 1);
          const start = page * 200;
          const size = page === 0 ? 200 : 1;
          const rows = Array.from({ length: size }, (_, offset) => {
            const index = start + offset;
            return takeoffItemRow({
              id: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
              designation: `Tube cuivre ${index}`,
              quantity: index === 200 && jobId === OTHER_JOB_ID ? 19 : 12.5,
            });
          });
          return { data: rows, count: 201, error: null };
        },
      },
    });
    useFake(fake);

    const response = await compareTakeoffJobs(M3_JOB_ID, { with: OTHER_JOB_ID });

    expect(response.changed).toHaveLength(1);
    expect(response.unchanged).toHaveLength(200);
    expect(JSON.stringify(response.changed)).toContain("Tube cuivre 200");
    expect(reads.get(M3_JOB_ID)).toBe(2);
    expect(reads.get(OTHER_JOB_ID)).toBe(2);
    for (const query of fake.queries) expect(filterValue(query, "tenant_id")).toBe(M3_TENANT_ID);
  });
});
