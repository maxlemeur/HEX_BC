import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readTakeoffJobsReadingList, readTakeoffReviewLinkFacts } from "@/lib/takeoff/review-link-server";

// The facts the review's link resolver acts on, read with the member's session (review-link-server.ts). The rows below
// stand for what the member's session returns; the reader must narrow them itself to the link's tenant, affaire, job and
// version. Ways it could prove a wrong fact:
// - a launch request of the first format, or none, taken for a reading against the list;
// - the plan of another job's answers;
// - the live target of an estimate line in another version, another affaire or another tenant taken for this link's;
// - an item withdrawn from the affaire's list since it was sent (absent from the latest revision, present in an earlier
//   one or in another affaire's) taken as still listed: its detail cannot show it (the independent reading of #501).
// Fictional ids.

const id = (prefix: string, n: number) => `${prefix}000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = id("a1", 1);
const T2 = id("a1", 2);
const P = id("b1", 1);
const P2 = id("b1", 2);
const V = id("c1", 1);
const V2 = id("c1", 2);
const PLAN = id("d1", 1);
const PLAN2 = id("d1", 2);
const [J, F, G, K] = [1, 2, 3, 4].map((n) => id("e1", n));
const [R1, R2] = [1, 2].map((n) => id("f1", n));
const [I1, I2, I3] = [1, 2, 3].map((n) => id("aa", n));
const [L, L2, L3, L4, L5] = [1, 2, 3, 4, 5].map((n) => id("bb", n));
const [REV1, REV2, REV3] = [1, 2, 3].map((n) => id("cc", n));

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {
  takeoff_jobs: [
    { id: J, tenant_id: T, project_id: P, launch_request_id: R1 },
    { id: F, tenant_id: T, project_id: P, launch_request_id: null },
    { id: G, tenant_id: T, project_id: P, launch_request_id: R2 },
    { id: K, tenant_id: T, project_id: P, launch_request_id: R1 },
  ],
  takeoff_launch_requests: [
    { id: R1, tenant_id: T, item_list_revision_id: REV1 },
    { id: R2, tenant_id: T, item_list_revision_id: null },
  ],
  takeoff_item_answers: [
    { id: id("dd", 1), tenant_id: T, project_id: P, job_id: K, item_id: I3, plan_logical_id: PLAN2 },
    { id: id("dd", 2), tenant_id: T, project_id: P, job_id: J, item_id: I1, plan_logical_id: PLAN },
    { id: id("dd", 3), tenant_id: T, project_id: P, job_id: J, item_id: I2, plan_logical_id: PLAN },
  ],
  takeoff_item_send_targets: [
    { tenant_id: T, project_id: P, version_id: V, estimate_item_id: L, item_id: I1 },
    { tenant_id: T, project_id: P, version_id: V2, estimate_item_id: L2, item_id: I1 },
    { tenant_id: T, project_id: P2, version_id: V, estimate_item_id: L3, item_id: I1 },
    { tenant_id: T2, project_id: P, version_id: V, estimate_item_id: L4, item_id: I1 },
    { tenant_id: T, project_id: P, version_id: V, estimate_item_id: L5, item_id: I2 },
  ],
  takeoff_list_revisions: [
    { id: REV1, tenant_id: T, project_id: P, revision: 1 },
    { id: REV2, tenant_id: T, project_id: P, revision: 2 },
    { id: REV3, tenant_id: T, project_id: P2, revision: 3 },
  ],
  takeoff_list_revision_entries: [
    { revision_id: REV1, tenant_id: T, project_id: P, item_id: I1 },
    { revision_id: REV1, tenant_id: T, project_id: P, item_id: I2 },
    { revision_id: REV2, tenant_id: T, project_id: P, item_id: I1 },
    { revision_id: REV3, tenant_id: T, project_id: P2, item_id: I2 },
  ],
};

/** A query over the rows above: the filters the reader asks for, and nothing else. */
function client() {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => ((rows = rows.filter((row) => row[column] === value)), builder),
        in: (column: string, values: unknown[]) => ((rows = rows.filter((row) => values.includes(row[column]))), builder),
        not: (column: string, operator: string, value: unknown) => {
          if (operator !== "is" || value !== null) throw new Error("unexpected filter");
          rows = rows.filter((row) => row[column] !== null && row[column] !== undefined);
          return builder;
        },
        order: (column: string, options?: { ascending?: boolean }) => {
          const sign = options?.ascending === false ? -1 : 1;
          rows.sort((left, right) => (left[column] as number) > (right[column] as number) ? sign : -sign);
          return builder;
        },
        limit: (count: number) => ((rows = rows.slice(0, count)), builder),
        maybeSingle: async () => {
          if (rows.length > 1) return { data: null, error: { message: "several rows" } };
          return { data: rows[0] ?? null, error: null };
        },
        then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return builder;
    },
  } as never;
}

const facts = (input: { jobId: string; versionId?: string | null; line?: string | null }) =>
  readTakeoffReviewLinkFacts({ supabase: client(), tenantId: T, projectId: P, jobId: input.jobId,
    versionId: input.versionId === undefined ? V : input.versionId,
    line: input.line ?? null });

describe("readTakeoffReviewLinkFacts", () => {
  it("knows a job read against the list by its request's sealed list only", async () => {
    expect(await facts({ jobId: F })).toEqual({ readsList: false });
    expect(await facts({ jobId: G })).toEqual({ readsList: false });
    expect(await readTakeoffJobsReadingList(client(), T, [J, F, G, K, "pas-un-id", null])).toEqual(new Set([J, K]));
    expect(await readTakeoffJobsReadingList(client(), T2, [J])).toEqual(new Set());
  });

  it("names the plan of this job's own answers", async () => {
    expect(await facts({ jobId: J })).toEqual({ readsList: true, planKey: PLAN, line: null });
    expect(await facts({ jobId: K })).toEqual({ readsList: true, planKey: PLAN2, line: null });
  });

  it("takes an estimate line's item from its live target in the link's tenant, affaire and version only", async () => {
    expect(await facts({ jobId: J, line: L })).toEqual({ readsList: true, planKey: PLAN,
      line: { itemId: I1, answered: true, withdrawn: false } });
    // Another reading of the list, which did not answer that item.
    expect(await facts({ jobId: K, line: L })).toEqual({ readsList: true, planKey: PLAN2,
      line: { itemId: I1, answered: false, withdrawn: false } });
    for (const line of [L2, L3, L4, "pas-un-id"]) {
      expect(await facts({ jobId: J, line }), line).toEqual({ readsList: true, planKey: PLAN, line: null });
    }
    expect(await facts({ jobId: J, line: L, versionId: null })).toEqual({ readsList: true, planKey: PLAN, line: null });
  });

  it("says when the line's item was withdrawn from the affaire's latest list", async () => {
    expect(await facts({ jobId: J, line: L5 })).toEqual({ readsList: true, planKey: PLAN,
      line: { itemId: I2, answered: true, withdrawn: true } });
  });
});
