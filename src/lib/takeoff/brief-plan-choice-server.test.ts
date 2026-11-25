import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { BRIEF_PLAN_CHANGED } from "./brief-plan-choice";
import { attestBriefPlanChoice } from "./brief-plan-choice-server";
import { createSupabaseFake } from "./metre-m3.test-utils";

vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));

// Two different working copies whose read history can only be verified after the bytes are hashed.
const tenant = "aaaaaaaa-0000-4000-8000-000000000001";
const set = "aaaaaaaa-0000-4000-8000-000000000002";
const ids = ["aaaaaaaa-0000-4000-8000-000000000003", "aaaaaaaa-0000-4000-8000-000000000004"];
const selected = ids.map((id, index) => ({ id, version: String(index).repeat(64) }));
const blob = new Blob(["same fictional PDF"]);
const hash = createHash("sha256").update("same fictional PDF").digest("hex");

function confirmCopies(changed: boolean) {
  const rows = ids.map(id => ({ id, plan_set_id: set, file_name: "Plan.pdf", file_size_bytes: blob.size,
    file_path: `${tenant}/${set}/${id}/Plan.pdf` }));
  const session = createSupabaseFake({ tables: { plan_files: () => ({ data: rows, error: null, count: 2 }) },
    storage: { "plan-files": () => ({ data: blob, error: null }) } });
  const service = createSupabaseFake({ rpc: { takeoff_brief_plan_options: (args) => {
    const attested = (args as { p_plans?: unknown }).p_plans;
    const options = selected.map(({ id, version }, i) => ({ plan_file_id: id, plan_name: "Plan.pdf",
      plan_version: version, reading_state: attested ? (i ? "analysed" : "not_analysed") : "unverified" }));
    return { data: changed && attested ? options.slice(1) : options, error: null };
  } } });
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
  return attestBriefPlanChoice({ tenantId: tenant, supabase: session.client } as never, set, selected);
}

it("reserves identical selected content once using the copy with a verified prior reading", async () => {
  expect(await confirmCopies(false)).toEqual({ plans: { [ids[1]]: { version: selected[1].version, sha256: hash } } });
});

it("refuses the choice when even a redundant selected copy changed while hashing", async () => {
  expect(await confirmCopies(true)).toEqual({ message: BRIEF_PLAN_CHANGED });
});
