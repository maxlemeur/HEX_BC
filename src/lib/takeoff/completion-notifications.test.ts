import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>>,
  /** The launch requests that sealed the list, as the member reads them; « fails » when that read fails. */
  sealed: [] as Array<{ id: string }> | "fails" }));
vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: async () => ({
    tenantId: "10000000-0000-4000-8000-000000000001",
    supabase: { from: (table: string) => {
      const answer = table !== "takeoff_launch_requests" ? Promise.resolve({ data: rows.data, error: null })
        : rows.sealed === "fails" ? Promise.reject(new Error("statement timeout")) : Promise.resolve({ data: rows.sealed, error: null });
      const builder = { select: () => builder, eq: () => builder, order: () => builder, in: () => builder, not: () => builder,
        range: () => answer, then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => answer.then(resolve, reject) };
      return builder;
    } },
  }),
}));
vi.mock("@/lib/takeoff/feature-flags", () => ({ isTakeoffEnabled: async () => true }));

import { listTakeoffCompletionNotifications } from "@/lib/takeoff/completion-notifications";
import { TAKEOFF_COMPLETION_LABELS } from "@/lib/takeoff/completion-outcome";

// Fix round 1: the end of a launch request may be partial (some of its plans were read); its notice is listed and named.
describe("listTakeoffCompletionNotifications", () => {
  it("lists a request's partial end beside the ends of analyses, and drops an unknown outcome", async () => {
    rows.data = [
      { id: "n1", outcome: "partial", subject_kind: "request", request_id: "r1", job_id: null },
      { id: "n2", outcome: "success", subject_kind: "job", request_id: null, job_id: "j1" },
      { id: "n3", outcome: "something_else", subject_kind: "job", request_id: null, job_id: "j2" },
    ];
    const { notifications } = await listTakeoffCompletionNotifications(1);
    expect(notifications.map((notice) => [notice.id, notice.outcome])).toEqual([["n1", "partial"], ["n2", "success"]]);
    expect(TAKEOFF_COMPLETION_LABELS.partial).toBe("Analyse terminée en partie");
  });

  // The independent reading of #501 (second round): the list reading of the requests is optional; when it fails, the
  // notifications are listed as before and a request's end keeps today's link (readsList false).
  it("lists the notifications when the requests' list reading fails, each request's end keeping today's link", async () => {
    const request = "20000000-0000-4000-8000-000000000001";
    rows.data = [{ id: "n1", outcome: "success", subject_kind: "request", request_id: request, job_id: null }];
    rows.sealed = [{ id: request }];
    expect((await listTakeoffCompletionNotifications(1)).notifications.map((notice) => notice.readsList)).toEqual([true]);
    rows.sealed = "fails";
    expect((await listTakeoffCompletionNotifications(1)).notifications.map((notice) => [notice.id, notice.readsList])).toEqual([["n1", false]]);
  });
});
