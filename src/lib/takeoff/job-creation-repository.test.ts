import { describe, expect, it, vi } from "vitest";

import { getTakeoffPlanSetJobByPreparation } from "@/lib/takeoff/job-creation-repository";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

// The receipt of a launch on a version (a reopened hub finds the job of its preparation) is a job without a launch
// request: a request's job of the same plan set and preparation revision, sent to that version since, is never the
// receipt of an unrelated launch (migration 20261121170448_takeoff_launch_requests.sql narrows the receipt index so).
function jobs(rows: Array<{ id: string; launch_request_id: string | null }>) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "abortSignal"]) {
    builder[method] = (...args: unknown[]) => { calls.push([method, args]); return builder; };
  }
  builder.maybeSingle = async () => {
    const withoutRequest = calls.some(([method, args]) => method === "is" && args[0] === "launch_request_id" && args[1] === null);
    const [row] = rows.filter((job) => !withoutRequest || job.launch_request_id === null);
    return { data: row ?? null, error: null };
  };
  return { from: () => builder } as never;
}

describe("getTakeoffPlanSetJobByPreparation", () => {
  it("never returns a launch request's job as the receipt of a launch on a version", async () => {
    const supabase = jobs([{ id: "job-of-request", launch_request_id: "request-1" }, { id: "job-of-launch", launch_request_id: null }]);
    const found = await getTakeoffPlanSetJobByPreparation({ supabase, tenantId: "tenant", projectId: "affaire", estimateVersionId: "version",
      planSetId: "plans", preparationRevision: 3, level: "C", executionProvider: "chatgpt_local" });
    expect(found).toMatchObject({ id: "job-of-launch" });
  });
});
