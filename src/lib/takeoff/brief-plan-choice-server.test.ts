import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { attestBriefPlanChoice, readBriefPlanOptions } from "./brief-plan-choice-server";
import { createSupabaseFake } from "./metre-m3.test-utils";

vi.mock("@/lib/takeoff/feature-flags", () => ({ isTakeoffEnabled: () => true }));
vi.mock("@/lib/takeoff/local-dispatcher", () => ({ isTakeoffPlanDispatchActive: () => true }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

const tenant = "aaaaaaaa-0000-4000-8000-000000000001";
const project = "aaaaaaaa-0000-4000-8000-000000000002";
const ids = ["aaaaaaaa-0000-4000-8000-000000000003", "aaaaaaaa-0000-4000-8000-000000000004"];
const selected = ids.map((id, i) => ({ id, version: String(i).repeat(64) }));
const blob = new Blob(["same fictional PDF"]);
const hash = createHash("sha256").update("same fictional PDF").digest("hex");

function setup(jobStatus: "processing" | "completed" | "canceled", { grouped = false, visible = true, changed = false } = {}) {
  const rows = ids.map((id, i) => ({ id, plan_set_id: project, file_name: `Plan-${i}.pdf`, file_size_bytes: blob.size,
    file_path: `${tenant}/${project}/${id}/Plan-${i}.pdf` }));
  const session = createSupabaseFake({ rpc: { can_access_takeoff_project: () => ({ data: visible, error: null }) },
    tables: { affaire_intake_documents: () => ({ data: [], error: null }), plan_files: ({ filters }) => {
    const filter = filters.find(f => f.column === "id")?.value as string[] | undefined;
    const found = rows.filter(row => (visible || row.id !== ids[0]) && (!filter || filter.includes(row.id)));
    return { data: found, count: found.length, error: null };
  } }, storage: { "plan-files": () => ({ data: blob, error: null }) } });
  const key = grouped ? "grouped" : `plan:${ids[0]}`;
  const request = { id: "request", created_at: "2026-11-01", state: jobStatus === "processing" ? "admitted" : "closed",
    manifest: { format_version: grouped ? 1 : 2, plans: [{ entry_key: ids[0], plan_file_id: ids[0], content_sha256: hash, name: "Plan précédent.pdf" }],
      units: [{ key, plans: [ids[0]] }] },
    takeoff_jobs: [{ id: "job", launch_request_id: "request", launch_unit_key: key, status: jobStatus, analysis_outcome: null }] };
  const service = createSupabaseFake({ tables: { takeoff_launch_requests: ({ filters }) => {
    expect(filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "tenant_id", value: tenant }),
      expect.objectContaining({ column: "project_id", value: project })]));
    return { count: 1, data: [request], error: null };
  } }, rpc: { takeoff_brief_plan_options: args => {
    const plans = (args as { p_plans?: Record<string, unknown> }).p_plans;
    const current = selected.filter(({ id }) => !plans || (id in plans && !(changed && id === ids[0])));
    return { data: current.map(({ id, version }) => ({ plan_file_id: id, plan_name: rows.find(row => row.id === id)!.file_name,
      plan_version: version, reading_state: "unverified" })), error: null };
  } } });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
  const context = { tenantId: tenant, supabase: session.client } as never;
  return {
    confirm: (plans = selected.slice(1)) => attestBriefPlanChoice(context, project, plans),
    list: () => readBriefPlanOptions(context, project),
  };
}

it("refuses both named copies before confirmation when their bytes are identical", async () => {
  const result = await setup("canceled").confirm(selected);
  expect(result).toMatchObject({ message: expect.stringMatching(/Plan-0\.pdf.*Plan-1\.pdf.*gardez-en un seul/i) });
});

it("refuses a twin while its grouped unit runs and withholds an inaccessible source name", async () => {
  const fixture = setup("processing", { grouped: true, visible: false });
  expect(await fixture.list()).toEqual([expect.objectContaining({ id: ids[1], state: "in_progress" })]);
  const result = await fixture.confirm();
  expect(result).toMatchObject({ message: "L’analyse de ce fichier est déjà en cours dans cette affaire." });
});

it("leaves the twin selectable after cancellation and sends every accepted copy to SQL", async () => {
  expect(await setup("canceled").confirm()).toEqual({ plans: { [ids[1]]: { version: selected[1].version, sha256: hash } } });
});

it("reports a changed generation when a replacement made the two downloads identical", async () => {
  expect(await setup("canceled", { changed: true }).confirm(selected)).toMatchObject({ code: "TAKEOFF_BRIEF_PLAN_CHANGED" });
});
