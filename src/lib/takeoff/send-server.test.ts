import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFake } from "@/lib/takeoff/metre-m3.test-utils";

// Lot 2 M2, fix round 1: what the preview of a send says before anything is confirmed, through previewTakeoffSend with
// the session, the service and the readers it calls stood in for at their module boundary (the database rules are in
// supabase/tests/database/takeoff-send-*.test.sql). Written before the fix: red on 986aea27.
// - Point 12: a draft that holds a DPGF line was read further (its page proposal, whose comparison loader needs the
//   takeoff on that version, threw 409) instead of naming its blocker.
// - Point 4: a takeoff whose lines carry no rule input was said « vérifiés » for the destination although nothing was
//   evaluated. Fictional ids only.

vi.mock("@/lib/takeoff/job-read-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/job-read-server")>(),
  getAuthenticatedTakeoffContext: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/estimates/calc-policy-server", () => ({ readTenantCalcPolicy: vi.fn(async () => ({ engine: 3 })) }));
vi.mock("@/lib/estimates/canonical-v2-creation", () => ({
  prepareCanonicalEstimateCreation: vi.fn(async () => ({ versionPayload: { id: "70000000-0000-4000-8000-000000000001" } })),
}));
vi.mock("@/lib/takeoff/mapping-preview-server", () => ({ buildTakeoffMappingPreviewForJob: vi.fn() }));
vi.mock("@/lib/takeoff/rules/recompute-server", () => ({
  evaluateTakeoffRulesForDestination: vi.fn(), recomputeTakeoffRulesQuietly: vi.fn(),
}));
vi.mock("@/lib/takeoff/feature-flags", () => ({ getTakeoffLowConfidenceThresholdForTenant: vi.fn(async () => 0.5) }));
vi.mock("@/lib/takeoff/apply-repository", () => ({
  listTakeoffApplyGuardItems: vi.fn(async () => []), listTakeoffRulePartnerExclusions: vi.fn(), logTakeoffMappingApplyAuditEvents: vi.fn(),
}));
vi.mock("@/lib/takeoff/page-replacement-server", () => ({ buildTakeoffPageReplacementProposal: vi.fn() }));

import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { buildTakeoffPageReplacementProposal } from "@/lib/takeoff/page-replacement-server";
import { evaluateTakeoffRulesForDestination } from "@/lib/takeoff/rules/recompute-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { previewTakeoffSend } from "@/lib/takeoff/send-server";

const TENANT = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const JOB = "40000000-0000-4000-8000-000000000001";
const ITEM = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const DPGF_DRAFT = "30000000-0000-4000-8000-000000000001";

function setUp(versions: Array<{ id: string; dpgf: boolean }>) {
  const supabase = createSupabaseFake({
    tables: {
      takeoff_jobs: () => ({ data: { id: JOB, project_id: PROJECT, estimate_version_id: null, status: "completed", level: "C",
        plan_set_id: null, execution_provider: "chatgpt_local", preparation_revision: "1" }, error: null }),
      takeoff_items: () => ({ data: [{ id: ITEM, designation: "Lavabo", quantity: 3, unit: "u", is_excluded: false, source_file_name: "plan.pdf",
        source_page: 1, quantity_entry_category: null, metadata: {}, confidence: 0.95, is_verified: false }], error: null, count: 1 }),
      // The draft as its session reads it (one section).
      estimate_items: () => ({ data: [{ id: "80000000-0000-4000-8000-000000000001", parent_id: null, item_type: "section", position: 1,
        title: "Lot", unit_code: null, pricing_status: null, description: null, quantity: null, updated_at: "2026-11-21T00:00:00Z",
        source_provider: null, source_job_id: null, source_metadata: null }], error: null, count: 1 }),
    },
    rpc: {
      send_takeoff_job: () => ({ data: { dry_run: true, outcome: { format_version: 1, engine: 3, sections_created: [], parts: [],
        lines: [{ change: "created", ref: null, section: "new", title: "Lavabo", unit: "u", quantity: 3, quantity_before: null,
          unit_price_ht_cents: 0, takeoff_item_ids: [ITEM] }] } }, error: null }),
    },
  });
  const service = createSupabaseFake({
    tables: {
      estimate_projects: () => ({ data: { id: PROJECT, name: "Affaire fictive", user_id: USER, is_archived: false }, error: null }),
      estimate_versions: () => ({ data: versions.map((version, index) => ({ id: version.id, version_number: index + 1, status: "draft",
        title: null, variant_label: null, updated_at: "2026-11-21T00:00:00Z" })), error: null }),
      estimate_items: () => ({ data: versions.filter((version) => version.dpgf).map((version) => ({ version_id: version.id })), error: null }),
      takeoff_send_receipts: () => ({ data: null, error: null }),
    },
    rpc: {
      takeoff_mapping_rules_stamp: () => ({ data: "a".repeat(32), error: null }),
      stage_takeoff_send: () => ({ data: null, error: null }),
    },
  });
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: supabase.client, tenantId: TENANT, userId: USER,
    tenantRole: "engineer" } as never);
  vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
  const state = { designation: "Lavabo", quantity: 3, unit: "u", is_excluded: false, category_id: null, unit_price_cents: null, assembly_id: null };
  vi.mocked(buildTakeoffMappingPreviewForJob).mockResolvedValue({ job_id: JOB, strategy: "append", target_section_id: null,
    summary: { total_count: 1, included_count: 1, transformed_count: 0, overridden_count: 0, excluded_by_mapping_count: 0,
      assembly_insertions_count: 0 },
    items: [{ item_id: ITEM, source_order: 0, rule_id: null, rule_name: null, action: "none", action_params: {}, applied_by: "none",
      original: state, transformed: state }] });
  // The takeoff's lines carry no rule input: nothing is evaluated for any destination.
  vi.mocked(evaluateTakeoffRulesForDestination).mockResolvedValue({ jobStamp: "b".repeat(32), peersStamp: null, writes: [],
    transforms: [], results: new Map() } as never);
  // As the comparison loader does for a takeoff not on that version.
  vi.mocked(buildTakeoffPageReplacementProposal).mockRejectedValue(Object.assign(new Error("Comparaison DPGF indisponible."), { status: 409 }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("previewTakeoffSend — a destination that cannot receive the send", () => {
  it("names a draft that holds DPGF lines as blocked, before reading anything of it", async () => {
    setUp([{ id: DPGF_DRAFT, dpgf: true }]);

    const preview = await previewTakeoffSend(JOB, { destination: { kind: "existing_draft", version_id: DPGF_DRAFT } });

    expect(preview.blocked?.reason).toBe("dpgf_reconciliation_required");
    expect(preview.destination).toEqual({ kind: "existing_draft", version_id: DPGF_DRAFT });
    expect(preview.estimate_lines).toBeNull();
    expect(buildTakeoffPageReplacementProposal).not.toHaveBeenCalled();
  });
});

describe("previewTakeoffSend — the controls between takeoffs", () => {
  it("says the controls were not evaluated when no line of the takeoff carries their inputs", async () => {
    setUp([]);

    const preview = await previewTakeoffSend(JOB, {});

    expect(preview.destination).toEqual({ kind: "first_draft" });
    expect(preview.controls).toMatchObject({ evaluated_for: null, not_evaluated_reason: "no_rule_inputs" });
    // The outcome is still shown: the controls are not what the send writes.
    expect(preview.estimate_lines).toEqual([{ change: "created", section_title: "Métré", title: "Lavabo", unit: "u", quantity: 3,
      quantity_before: null, unit_price_ht_cents: 0, takeoff_item_ids: [ITEM] }]);
  });
});
