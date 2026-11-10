import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/item-bulk-server", () => ({ bulkUpdateEstimateItems: vi.fn() }));
vi.mock("@/lib/takeoff/job-read-server", () => ({
  getAuthenticatedTakeoffContext: vi.fn(),
  getTakeoffJobDetailByIdOrThrow: vi.fn(),
  normalizeTakeoffJobSummaryRow: vi.fn((row) => row),
}));
vi.mock("@/lib/takeoff/mapping-preview-server", () => ({ buildTakeoffMappingPreviewForJob: vi.fn() }));
vi.mock("@/lib/takeoff/apply-repository", () => ({
  invokeApplyTakeoffRpc: vi.fn(),
  issueTakeoffDpgfApplyAuthorization: vi.fn(),
  listTakeoffApplyGuardItems: vi.fn(),
  listTakeoffRulePartnerExclusions: vi.fn(),
  loadTakeoffApplyConcurrencyToken: vi.fn(),
  loadTakeoffQuantityComparisonStamp: vi.fn(),
  logTakeoffMappingApplyAuditEvents: vi.fn(),
  revokeTakeoffDpgfApplyAuthorization: vi.fn(),
}));
vi.mock("@/lib/takeoff/dpgf-comparison-repository", () => ({ hasTakeoffDpgfTargetLines: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-context-server", () => ({ loadTakeoffDpgfComparisonContext: vi.fn() }));
vi.mock("@/lib/takeoff/dpgf-comparison-server", () => ({ fetchAllTakeoffDpgfComparisonRows: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({ getTakeoffLowConfidenceThresholdForTenant: vi.fn() }));
vi.mock("@/lib/takeoff/rules/recompute-server", () => ({ recomputeTakeoffRulesQuietly: vi.fn() }));
vi.mock("@/lib/takeoff/audit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/audit")>(),
  logTakeoffAuditEvent: vi.fn(),
}));

import { bulkUpdateEstimateItems } from "@/lib/estimates/item-bulk-server";
import { applyTakeoffJob } from "@/lib/takeoff/apply-server";
import * as repository from "@/lib/takeoff/apply-repository";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow } from "@/lib/takeoff/job-read-server";
import { hasTakeoffDpgfTargetLines } from "@/lib/takeoff/dpgf-comparison-repository";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchAllTakeoffDpgfComparisonRows } from "@/lib/takeoff/dpgf-comparison-server";
import { getTakeoffLowConfidenceThresholdForTenant } from "@/lib/takeoff/feature-flags";
import { logTakeoffAuditEvent } from "@/lib/takeoff/audit";
import { buildTakeoffDpgfComparisonSummary } from "@/lib/takeoff/dpgf-compare";

const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-10-28T10:00:00.000Z";
const auth = { supabase: {}, tenantId: TENANT_ID, userId: USER_ID, tenantRole: "admin" };
const request = { strategy: "merge", target_section_id: SECTION_ID };
const completedJob = { id: JOB_ID, estimate_version_id: VERSION_ID, status: "completed", level: "A" };
const summary = buildTakeoffDpgfComparisonSummary({ rows: [], unusedTakeoffItems: [] });

function calledBefore(first: { mock: { invocationCallOrder: number[] } }, second: { mock: { invocationCallOrder: number[] } }) {
  expect(first.mock.invocationCallOrder[0]).toBeLessThan(second.mock.invocationCallOrder[0]);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(repository.loadTakeoffQuantityComparisonStamp).mockResolvedValue("quantity-stamp");
  vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue(auth as never);
  vi.mocked(getTakeoffJobDetailByIdOrThrow)
    .mockResolvedValueOnce(completedJob as never)
    .mockResolvedValue({ ...completedJob, status: "applied" } as never);
  vi.mocked(buildTakeoffMappingPreviewForJob).mockResolvedValue({
    job_id: JOB_ID,
    strategy: "merge",
    target_section_id: SECTION_ID,
    summary: { included_count: 1 },
    items: [],
  } as never);
  vi.mocked(hasTakeoffDpgfTargetLines).mockResolvedValue(true);
  // The guard runs on every level (TI-664): no line blocks here.
  vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([]);
  vi.mocked(repository.loadTakeoffApplyConcurrencyToken).mockResolvedValue(TOKEN);
  vi.mocked(loadTakeoffDpgfComparisonContext).mockResolvedValue({ jobId: JOB_ID, estimateItems: [], takeoffItems: [],
    comparisonInput: { versionId: VERSION_ID, jobId: JOB_ID, dpgfLines: [], takeoffLines: [] } } as never);
  vi.mocked(fetchAllTakeoffDpgfComparisonRows).mockResolvedValue({ summary, rows: [] } as never);
  vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mockImplementation(async (input) => input.authorizationToken);
  vi.mocked(repository.invokeApplyTakeoffRpc).mockResolvedValue({ data: { created_count: 1 }, error: null } as never);
});

describe("takeoff apply orchestration", () => {
  it("checks the draft before the global DPGF review, authorizes it, then invokes the atomic write", async () => {
    const response = await applyTakeoffJob(JOB_ID, request);

    expect(bulkUpdateEstimateItems).toHaveBeenCalledWith(VERSION_ID, [], TOKEN);
    expect(fetchAllTakeoffDpgfComparisonRows).toHaveBeenCalledWith(
      { context: expect.objectContaining({ jobId: JOB_ID }) }
    );
    calledBefore(vi.mocked(bulkUpdateEstimateItems), vi.mocked(fetchAllTakeoffDpgfComparisonRows));
    calledBefore(vi.mocked(fetchAllTakeoffDpgfComparisonRows), vi.mocked(repository.issueTakeoffDpgfApplyAuthorization));
    calledBefore(vi.mocked(repository.issueTakeoffDpgfApplyAuthorization), vi.mocked(repository.invokeApplyTakeoffRpc));
    const authorization = vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mock.calls[0][0];
    expect(authorization).toMatchObject({ tenantId: TENANT_ID, userId: USER_ID, jobId: JOB_ID, estimateVersionId: VERSION_ID, summary, nowMs: expect.any(Number) });
    expect(authorization.authorizationToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalledExactlyOnceWith({
      supabase: auth.supabase,
      args: { job_id: JOB_ID, strategy: "merge", target_section_id: SECTION_ID, mapping_plan: [], dpgf_authorization_token: authorization.authorizationToken },
    });
    expect(response.summary.created_count).toBe(1);
    expect(getTakeoffJobDetailByIdOrThrow).toHaveBeenCalledTimes(2);
    expect(repository.revokeTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
    expect(logTakeoffAuditEvent).toHaveBeenLastCalledWith(expect.objectContaining({ action: "takeoff.apply.completed" }));
  });

  it("issues a guarded authorization despite non-blocking DPGF quantity warnings", async () => {
    vi.mocked(fetchAllTakeoffDpgfComparisonRows).mockResolvedValue({ summary: { ...summary, significant_gaps: 1 }, rows: [] } as never);
    await applyTakeoffJob(JOB_ID, request);
    expect(repository.issueTakeoffDpgfApplyAuthorization).toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalled();
  });

  it("revokes the issued authorization when the atomic RPC fails, retaining the named timeout", async () => {
    vi.mocked(repository.invokeApplyTakeoffRpc).mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement" } } as never);
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 503, retryable: true, details: { guard: "statement_timeout" } });
    const authorization = vi.mocked(repository.issueTakeoffDpgfApplyAuthorization).mock.calls[0][0];
    expect(repository.revokeTakeoffDpgfApplyAuthorization).toHaveBeenCalledExactlyOnceWith({ jobId: JOB_ID, authorizationToken: authorization.authorizationToken });
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalledTimes(1);
    expect(getTakeoffJobDetailByIdOrThrow).toHaveBeenCalledTimes(1);
  });

  it("persists an admin override audit before any draft authorization or application", async () => {
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockReset()
      .mockResolvedValueOnce({ ...completedJob, level: "C" } as never)
      .mockResolvedValue({ ...completedJob, level: "C", status: "applied" } as never);
    vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.7);
    // TI-677 (PR D): the override records each blocked line's state; the trigger refuses it once a line changed.
    const state = { item_id: SECTION_ID, quantity: 4, unit: "ml", updated_at: "2026-10-28T09:00:00.123456+00:00",
      rule_failures: [], rules_stale: false, designation: "Canalisation", evidence: null, source_page: 1, is_verified: false,
      quantity_entered_by: null };
    const included = { id: "66666666-6666-4666-8666-666666666666", designation: "Vanne", confidence: 0.9, evidence: "Plan A",
      source_page: 1, is_verified: true, is_excluded: false,
      override_state: { ...state, item_id: "66666666-6666-4666-8666-666666666666" } };
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([{
      id: SECTION_ID, designation: "Canalisation", confidence: 0.6, evidence: null, source_page: 1, is_verified: false, is_excluded: false,
      override_state: state,
    }, included] as never);
    await applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: ["  Contrôle manuel du plan  "],
      forced_items: [{ item_id: SECTION_ID, reason_code: "controlled_correction", justification_index: 0 }] });
    expect(getTakeoffLowConfidenceThresholdForTenant).toHaveBeenCalledWith(TENANT_ID, { supabase: auth.supabase });
    expect(logTakeoffAuditEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "takeoff.apply.override", mode: "fail-hard",
      metadata: { estimate_version_id: VERSION_ID, threshold: 0.7, blocked_item_ids: [SECTION_ID], blocked_items_count: 1,
        blocked_items_state: [state], forced_justifications: ["Contrôle manuel du plan"],
        forced_items: [{ item_id: SECTION_ID, reason_code: "controlled_correction", justification_index: 0 }] },
    }));
    calledBefore(vi.mocked(logTakeoffAuditEvent), vi.mocked(bulkUpdateEstimateItems));
  });
});

// TI-686 D10: an administrator forces each blocked line with a coded reason and a justification (H7). Since TI-681,
// lines block for their missing localized proof or page (level C), results to compute again or a blocking rule. Ways it
// fails, written before the change:
// - an override that names one blocked line lifts the others (the job-level justification covered every line);
// - a reason that names a rule is accepted on a line whose results are unreadable, or where no rule blocks;
// - the audit stores the same justification once per line, or keeps entries for lines that do not block;
// - a cap on the number of lines refuses a large job;
// - a client still sending the job-level justification is accepted.
describe("takeoff apply with per-line override reasons", () => {
  const A = "a6860000-0000-4000-8000-00000000000a";
  const B = "a6860000-0000-4000-8000-00000000000b";
  const C = "a6860000-0000-4000-8000-00000000000c";
  const NOTE = "Fiche du fabricant jointe, conforme au CCTP.";
  const material = [{ rule: "dn_network", status: "fail", code: "DN_NETWORK_MATERIAL_BLOCKED", version: 3, acceptable: false,
    reason: "Matériau interdit sur ce réseau (fictif)." }];
  const state = (id: string) => ({ item_id: id, quantity: 4, unit: "ml", updated_at: "2026-10-28T09:00:00.123456+00:00",
    rule_failures: [], rules_stale: false, designation: id, evidence: null, source_page: 1, is_verified: false, quantity_entered_by: null });
  // A: no localized proof (level C); B: a blocked material; C: admitted.
  const guardLine = (id: string, overrides: Record<string, unknown> = {}) => ({ id, designation: `Ligne ${id.slice(-1)}`,
    confidence: 0.95, evidence: "Repère localisé", source_page: 1, is_verified: false, is_excluded: false, rule_results: [],
    rules_stale: false, override_state: state(id), ...overrides });
  const lines = (bOverrides: Record<string, unknown> = { rule_results: material }) => [
    guardLine(B, bOverrides), guardLine(A, { evidence: null }), guardLine(C)];
  const levelC = () => vi.mocked(getTakeoffJobDetailByIdOrThrow).mockReset()
    .mockResolvedValueOnce({ ...completedJob, level: "C" } as never)
    .mockResolvedValue({ ...completedJob, level: "C", status: "applied" } as never);
  const auditMetadata = () => vi.mocked(logTakeoffAuditEvent).mock.calls
    .find(([event]) => event.action === "takeoff.apply.override")?.[0].metadata as Record<string, unknown> | undefined;

  beforeEach(() => {
    levelC();
    vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.5);
  });

  it("refuses an override that leaves a blocked line without its reason, before any audit or write", async () => {
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue(lines() as never);
    await expect(applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: [NOTE],
      forced_items: [{ item_id: A, reason_code: "additional_evidence", justification_index: 0 }] }))
      .rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR",
        details: { guard: "override_reasons", missing_item_ids: [B], invalid_items: [] } });
    expect(auditMetadata()).toBeUndefined();
    expect(bulkUpdateEstimateItems).not.toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).not.toHaveBeenCalled();
  });

  it("records each blocked line once, sorted, its justification stored once, the admitted line left out", async () => {
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue(lines() as never);
    await applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: [NOTE, `  ${NOTE} `],
      forced_items: [
        { item_id: C, reason_code: "controlled_correction", justification_index: 0 },
        { item_id: B, reason_code: "rule_false_positive", false_positive_rules: ["dn_network"], justification_index: 1 },
        { item_id: A, reason_code: "additional_evidence", justification_index: 0 },
      ] });
    const metadata = auditMetadata();
    expect(metadata).toMatchObject({ blocked_items_count: 2, forced_justifications: [NOTE], forced_items: [
      { item_id: A, reason_code: "additional_evidence", justification_index: 0 },
      { item_id: B, reason_code: "rule_false_positive", false_positive_rules: ["dn_network"], justification_index: 0 },
    ] });
    expect(metadata?.blocked_item_ids).toEqual(expect.arrayContaining([A, B]));
    expect(metadata).not.toHaveProperty("justification");
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalled();
  });

  // The route reads unreadable results as none and stale: a reason that names a rule cannot hold there.
  it("accepts an unconditional reason on a line whose results are unreadable, never a false positive", async () => {
    const unreadable = { rule_results: [], rules_stale: true };
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue(lines(unreadable) as never);
    await expect(applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: [NOTE], forced_items: [
      { item_id: A, reason_code: "additional_evidence", justification_index: 0 },
      { item_id: B, reason_code: "rule_false_positive", false_positive_rules: ["dn_network"], justification_index: 0 },
    ] })).rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR", details: { guard: "override_reasons",
      missing_item_ids: [], invalid_items: [{ item_id: B, error: expect.stringMatching(/faux positif/i) }] } });
    expect(auditMetadata()).toBeUndefined();

    vi.mocked(logTakeoffAuditEvent).mockClear();
    levelC();
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue(lines(unreadable) as never);
    await applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: [NOTE], forced_items: [
      { item_id: A, reason_code: "additional_evidence", justification_index: 0 },
      { item_id: B, reason_code: "additional_evidence", justification_index: 0 },
    ] });
    expect(auditMetadata()?.forced_items).toHaveLength(2);
  });

  it("forces 1 500 blocked lines in one override, with no cap on their number", async () => {
    const many = Array.from({ length: 1500 }, (_, index) =>
      guardLine(`a6860000-0000-4000-8000-${String(index).padStart(12, "0")}`, { evidence: null }));
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue(many as never);
    await applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: [NOTE],
      forced_items: many.map((item) => ({ item_id: item.id, reason_code: "additional_evidence", justification_index: 0 })) });
    expect(auditMetadata()).toMatchObject({ blocked_items_count: 1500, forced_justifications: [NOTE] });
    expect(auditMetadata()?.forced_items).toHaveLength(1500);
  });

  it("keeps the override to administrators: an engineer is refused before any reason is read", async () => {
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ ...auth, tenantRole: "engineer" } as never);
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue(lines() as never);
    await expect(applyTakeoffJob(JOB_ID, { ...request, override: true, forced_justifications: [NOTE],
      forced_items: [{ item_id: A, reason_code: "additional_evidence", justification_index: 0 }] }))
      .rejects.toMatchObject({ status: 403 });
    expect(auditMetadata()).toBeUndefined();
  });

  it("refuses the job-level justification of the former override, and an override without its lines", async () => {
    await expect(applyTakeoffJob(JOB_ID, { ...request, override: true, override_justification: NOTE }))
      .rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    await expect(applyTakeoffJob(JOB_ID, { ...request, override: true }))
      .rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    await expect(applyTakeoffJob(JOB_ID, { ...request, forced_justifications: [NOTE],
      forced_items: [{ item_id: A, reason_code: "additional_evidence", justification_index: 0 }] }))
      .rejects.toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(repository.listTakeoffApplyGuardItems).not.toHaveBeenCalled();
  });
});

// A partner's edit makes the other lines of the version stale in the database (TI-664 L5b, Codex): when the
// computation before the application fails, the route keeps the stored state, and a line its partner's edit made
// stale blocks it, as the trigger does, before any authorization or write.
describe("takeoff apply when the rules computation fails", () => {
  it("refuses a line left stale by its partner's edit, never applies its obsolete pass", async () => {
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([{
      id: "66666666-6666-4666-8666-666666666666", designation: "EF inox DN 22", confidence: 0.95, evidence: "Repère localisé",
      source_page: 1, is_verified: false, is_excluded: false, rules_stale: true,
      rule_results: [{ rule: "zone_overlap", status: "pass", code: "ZONE_OVERLAP_NONE", version: 101, acceptable: true, reason: "Aucun tronçon commun." }],
    }] as never);
    const { recomputeTakeoffRulesQuietly } = await import("@/lib/takeoff/rules/recompute-server");
    vi.mocked(recomputeTakeoffRulesQuietly).mockResolvedValue(null);
    await expect(applyTakeoffJob(JOB_ID, request)).rejects.toMatchObject({ status: 422 });
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalled();
    expect(repository.issueTakeoffDpgfApplyAuthorization).not.toHaveBeenCalled();
    expect(repository.invokeApplyTakeoffRpc).not.toHaveBeenCalled();
  });
});

// The mapping plan skips the duplicate of a retained line (TI-677, Codex #160, thread 4467409538): the stored
// results fail both lines, the application leaves the skipped one out, so the retained one is applied. A partner of
// another job counts as the database holds it now. Written before the fix.
describe("takeoff apply with a duplicate the mapping plan skips", () => {
  const RETAINED = "77777777-7777-4777-8777-777777777771";
  const SKIPPED = "77777777-7777-4777-8777-777777777772";
  const OTHER_JOB_LINE = "77777777-7777-4777-8777-777777777773";
  const duplicateOf = (partners: string[]) => [{ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 101, acceptable: true,
    reason: "Tronçon compté aussi sur une autre page.", details: { partner_count: partners.length,
      partners: partners.map((item_id) => ({ item_id, job_id: JOB_ID, zone: "Z2", designation: "EF", overlap_m: 1, resolved: false })) } }];
  const guardLine = (id: string, partners: string[]) => ({ id, designation: "EF cuivre 20/22", confidence: 0.95, evidence: "Repère localisé",
    source_page: 1, is_verified: false, is_excluded: false, rules_stale: false, rule_results: duplicateOf(partners) });
  const previewItem = (id: string, action: string, order: number) => ({ item_id: id, source_order: order, rule_id: null, action,
    original: { is_excluded: false }, transformed: { designation: "EF cuivre 20/22", unit_price_cents: null, category_id: null, assembly_id: null } });

  it("applies the retained line once the plan leaves its only partner out", async () => {
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([guardLine(RETAINED, [SKIPPED]), guardLine(SKIPPED, [RETAINED])] as never);
    vi.mocked(repository.listTakeoffRulePartnerExclusions).mockResolvedValue(new Map());
    vi.mocked(buildTakeoffMappingPreviewForJob).mockResolvedValue({ job_id: JOB_ID, strategy: "merge", target_section_id: SECTION_ID,
      summary: { included_count: 1 }, items: [previewItem(RETAINED, "none", 0), previewItem(SKIPPED, "skip", 1)] } as never);
    await applyTakeoffJob(JOB_ID, request);
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalled();
  });

  // Review of PR B: a stored partner id that is no line id never reaches the query (PostgREST would fail the route).
  it("never asks the database about a partner id that is no line id", async () => {
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([guardLine(RETAINED, ["not-a-line", OTHER_JOB_LINE.toUpperCase()])] as never);
    vi.mocked(repository.listTakeoffRulePartnerExclusions).mockResolvedValue(new Map([[OTHER_JOB_LINE, true]]));
    await applyTakeoffJob(JOB_ID, request);
    expect(repository.listTakeoffRulePartnerExclusions).toHaveBeenCalledWith(expect.objectContaining({ itemIds: [OTHER_JOB_LINE] }));
  });

  it("reads a partner of another job as the database holds it", async () => {
    vi.mocked(repository.listTakeoffApplyGuardItems).mockResolvedValue([guardLine(RETAINED, [OTHER_JOB_LINE])] as never);
    vi.mocked(repository.listTakeoffRulePartnerExclusions).mockResolvedValue(new Map([[OTHER_JOB_LINE, false]]));
    await applyTakeoffJob(JOB_ID, request);
    expect(repository.listTakeoffRulePartnerExclusions).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT_ID,
      itemIds: [OTHER_JOB_LINE] }));
    vi.mocked(repository.listTakeoffRulePartnerExclusions).mockResolvedValue(new Map([[OTHER_JOB_LINE, true]]));
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockReset().mockResolvedValueOnce(completedJob as never)
      .mockResolvedValue({ ...completedJob, status: "applied" } as never);
    await applyTakeoffJob(JOB_ID, request);
    expect(repository.invokeApplyTakeoffRpc).toHaveBeenCalled();
  });
});
