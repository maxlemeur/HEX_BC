import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/job-read-server", () => ({
  getAuthenticatedTakeoffContext: vi.fn(),
  getTakeoffJobDetailByIdOrThrow: vi.fn(),
  listAllTakeoffItemsByJobId: vi.fn(),
}));
vi.mock("@/lib/takeoff/mapping-rules-server", () => ({ listActiveTakeoffMappingRules: vi.fn() }));

import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow, listAllTakeoffItemsByJobId } from "@/lib/takeoff/job-read-server";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";
import { previewTakeoffJobConversion } from "@/lib/takeoff/mapping-preview-server";
import type { TakeoffJobItem, TakeoffMappingRule } from "@/lib/takeoff/types";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID = "44444444-4444-4444-8444-444444444444";
const EXCLUDED_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const RULE_ID = "66666666-6666-4666-8666-666666666666";
const auth = { supabase: {}, tenantId: TENANT_ID, userId: ITEM_ID, tenantRole: "admin" };
const item: TakeoffJobItem = {
  id: ITEM_ID, designation: "Tube cuivre", quantity: 12, unit: "ml", confidence: 0.9,
  evidence: "Plan A", source_file_name: "plan.pdf", source_page: 1, metadata: {}, is_excluded: false,
  exclusion_reason: null, is_verified: true, verified_at: null, verified_by: null,
  created_at: "2026-10-28T10:00:00.000Z", updated_at: "2026-10-28T10:00:00.000Z",
};
const rule: TakeoffMappingRule = {
  id: RULE_ID, tenant_id: TENANT_ID, created_at: item.created_at, updated_at: item.updated_at, created_by: null,
  name: "Tube normalisé", match_pattern: "Tube", match_type: "contains", action: "rename",
  action_params: { designation: "Tube cuivre normalisé" }, priority: 10, is_active: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(auth as never);
  vi.mocked(getTakeoffJobDetailByIdOrThrow).mockResolvedValue({ id: JOB_ID, status: "completed" } as never);
  vi.mocked(listAllTakeoffItemsByJobId).mockResolvedValue([item, { ...item, id: EXCLUDED_ITEM_ID, is_excluded: true, exclusion_reason: "Hors périmètre" }]);
  vi.mocked(listActiveTakeoffMappingRules).mockResolvedValue([rule]);
});

describe("takeoff mapping conversion preview", () => {
  it("uses every item and the tenant rules, preserving the preview contract for replace at the root", async () => {
    const preview = await previewTakeoffJobConversion(JOB_ID, { strategy: "replace" });
    expect(listAllTakeoffItemsByJobId).toHaveBeenCalledExactlyOnceWith({ supabase: auth.supabase, tenantId: TENANT_ID, jobId: JOB_ID });
    expect(listActiveTakeoffMappingRules).toHaveBeenCalledExactlyOnceWith({ supabase: auth.supabase, tenantId: TENANT_ID });
    expect(preview).toMatchObject({ job_id: JOB_ID, strategy: "replace", target_section_id: null, summary: { included_count: 1 } });
    expect(preview.items).toHaveLength(2);
    expect(preview.items.find((row) => row.item_id === ITEM_ID)).toMatchObject({ action: "rename", rule_id: RULE_ID, transformed: { designation: "Tube cuivre normalisé" } });
    expect(preview.items.find((row) => row.item_id === EXCLUDED_ITEM_ID)).toMatchObject({ original: { is_excluded: true } });
  });

  it.each(["queued", "processing", "failed", "applied"])("refuses a %s job before loading mapping inputs", async (status) => {
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockResolvedValue({ id: JOB_ID, status } as never);
    await expect(previewTakeoffJobConversion(JOB_ID, { strategy: "merge" })).rejects.toMatchObject({ status: 409, details: { current_status: status, allowed_statuses: ["completed"] } });
    expect(listAllTakeoffItemsByJobId).not.toHaveBeenCalled();
    expect(listActiveTakeoffMappingRules).not.toHaveBeenCalled();
  });
});
