import { describe, expect, it, vi } from "vitest";

const rows = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedTenantContext: async () => ({
    tenantId: "10000000-0000-4000-8000-000000000001",
    supabase: { from: () => {
      const builder = { select: () => builder, eq: () => builder, order: () => builder, range: async () => ({ data: rows.data, error: null }) };
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
});
