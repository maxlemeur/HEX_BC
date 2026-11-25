import { describe, expect, it, vi } from "vitest";
import { requireAffaireAccess } from "@/lib/affaires/access-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readUnlistedFinds } from "./unlisted-finds-server";
import { designationKey, findCommandSchema, listMismatchesPlan } from "./unlisted-finds";

vi.mock("@/lib/affaires/access-server", () => ({ requireAffaireAccess: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("./feature-flags", () => ({ assertTakeoffEnabled: vi.fn() }));
vi.mock("./source-visibility-server", () => ({ readTakeoffVisibleSources: vi.fn(async () => "all") }));

describe("unlisted find decisions", () => {
  it("matches case, combining accents and Unicode spacing, preserving punctuation and word boundaries", () => {
    expect(designationKey("  RÉSEAU\u0085 d’eau\u202f ")).toBe(designationKey("re\u0301seau d’eau"));
    expect(designationKey("CE-01")).not.toBe(designationKey("CE 01"));
    expect(designationKey("A B")).not.toBe(designationKey("AB"));
  });
  it("requires a strict majority of the sealed list and at least one reported find", () => {
    const facts = { planKey: "plan", planName: "Plan fictif", total: 4, missing: 2, outside: 3, truncated: false };
    expect(listMismatchesPlan(facts)).toBe(false);
    expect(listMismatchesPlan({ ...facts, missing: 3 })).toBe(true);
    expect(listMismatchesPlan({ ...facts, missing: 4, outside: 0 })).toBe(false);
  });
  it("supersedes only the inspected pages of a full-list reread", async () => {
    const manifest = {
      plans: [{ entry_key: "plan", logical_id: "plan", plan_file_id: "c0000000-0000-4000-8000-000000000001",
        name: "Plan fictif", page_count: 2 }],
      units: [{ key: "unit", plans: ["plan"], pages: [1, 2] }],
      order: { list: {} },
    };
    const publications = ["new", "old"].map(job_id => ({
      job_id, launch_unit_key: "unit", pages: [1, 2], answer_count: 3,
      takeoff_launch_requests: { manifest }, takeoff_list_revisions: { item_count: 3 },
    }));
    const findings = [
      { job_id: "new", unlisted_findings: [{ page: 1, designation: "Nouvelle bouche", evidence: "N1" }] },
      { job_id: "old", unlisted_findings: [{ page: 1, designation: "Ancienne bouche", evidence: "A1" },
        { page: 2, designation: "Clapet conservé", evidence: "C2" }] },
    ].map(row => ({ ...row, takeoff_results: { warnings: [] } }));
    const answers = [
      ...Array.from({ length: 3 }, () => ({ job_id: "new", outcome: "uncertain", searched_pages: [1], unreadable_pages: [2] })),
      ...Array.from({ length: 3 }, () => ({ job_id: "old", outcome: "not_found", searched_pages: [1, 2], unreadable_pages: [] })),
    ];
    const client = {
      rpc: async () => ({ data: true, error: null }),
      from(table: string) {
        let rows: Record<string, unknown>[] = [];
        const query = {
          select(fields: string) {
            if (table === "takeoff_item_answer_publications") rows = fields.includes("unlisted_findings") ? findings : publications;
            if (table === "takeoff_item_answers") rows = answers;
            return query;
          },
          eq(column: string, value: unknown) {
            if (column === "job_id" || column === "outcome") rows = rows.filter(row => row[column] === value);
            return query;
          },
          in(column: string, values: string[]) {
            rows = rows.filter(row => values.includes(String(row[column])));
            return query;
          },
          is: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          range: (start: number, end: number) => Promise.resolve({ data: rows.slice(start, end + 1), error: null, count: rows.length }),
          then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: rows.length }).then(resolve),
        };
        return query;
      },
    };
    vi.mocked(requireAffaireAccess).mockResolvedValue({
      context: { userId: "member", tenantId: "tenant", supabase: client }, project: { id: "project" },
    } as never);
    vi.mocked(createServiceRoleClient).mockReturnValue(client as never);
    const view = await readUnlistedFinds("project");
    expect(view.finds.map(({ designation, page }) => [designation, page])).toEqual([
      ["Nouvelle bouche", 1], ["Clapet conservé", 2],
    ]);
    expect(view.notices.some(listMismatchesPlan)).toBe(false);
  });
  it("takes the member and tenant exclusively from the session", () => {
    const uuid = "c0000000-0000-4000-8000-000000000001";
    const command = { kind: "dismiss", jobId: uuid, index: 0, intentKey: uuid, reason: "outside_scope" };
    expect(findCommandSchema.safeParse(command).success).toBe(true);
    for (const name of ["actor","tenantId","p_actor","p_tenant_id"]) {
      expect(findCommandSchema.safeParse({ ...command,[name]: uuid }).success).toBe(false);
    }
  });
});
