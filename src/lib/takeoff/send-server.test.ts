import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSupabaseFake, servedRows } from "@/lib/takeoff/metre-m3.test-utils";

// Lot 2 M2, fix round 1: what the preview of a send says before anything is confirmed, through previewTakeoffSend with
// the session, the service and the readers it calls stood in for at their module boundary (the database rules are in
// supabase/tests/database/takeoff-send-*.test.sql). Written before the fix: red on 986aea27.
// - Point 12: a draft that holds a DPGF line was read further (its page proposal, whose comparison loader needs the
//   takeoff on that version, threw 409) instead of naming its blocker.
// - Point 4: a takeoff whose lines carry no rule input was said « vérifiés » for the destination although nothing was
//   evaluated. Fictional ids only.
// Fix round 2, written before the fix (red on 2ad71cfb):
// - E: a line with rule inputs and no zone result was enough to say duplicates and coverage « vérifiés »; each control is
//   now said evaluated only when it ran.
// - F: a first draft was confirmed under the preview's fingerprint with other settings than the preview's (a supplies
//   coefficient changed meanwhile), and written with them.
// - H: the versions holding DPGF lines were read in one unpaginated query, one row per DPGF line: beyond PostgREST's
//   ceiling, a second draft's DPGF line was not seen and the preview read on (409 from the comparison loader).
// - A/D: the preview's refusals are answers of the dry run; the estimate being modified (a lock wait that timed out) is
//   said in French, with a retry, never as a database error.
// Closing round, written before the fix (red on 9ed38ced):
// - 1: the real creation helper leaves the engine 3 sale coefficients to the policy, so a policy changed between the
//   preview and the confirmation kept the fingerprint (the earlier case mocked the helper with those very fields).
// - 3: a preview's error that is none of the send's named refusals carried the database text to the HTTP body; the dry
//   run answers a code from a closed list only.
// - 4: a free unit written « status:lot » was shown without its unit (« no unit » was a prefix of the unit).
// Follow-up of the send, written before the fix (red on 0dcea6a2):
// - a replay returned the receipt at once: a process stopped between the commit and what follows it (a first draft's
//   default categories and labour roles, the rules of the draft's other takeoffs) left them missing for good, and the
//   application's audit rows were the server's, after the commit; they are now the send's own (command format 2).

vi.mock("@/lib/takeoff/job-read-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/job-read-server")>(),
  getAuthenticatedTakeoffContext: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/estimates/calc-policy-server", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/estimates/calc-policy-server")>(), readTenantCalcPolicy: vi.fn(async () => ({ engine: 3 })),
}));
vi.mock("@/lib/estimates/canonical-v2-creation", () => ({
  prepareCanonicalEstimateCreation: vi.fn(async () => ({ versionPayload: { id: "70000000-0000-4000-8000-000000000001",
    calc_engine_version: 3 } })),
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
vi.mock("@/lib/estimates/version-creation-repository", () => ({
  ensureDefaultEstimateCategories: vi.fn(async () => undefined), ensureDefaultLaborRoles: vi.fn(async () => undefined),
}));
vi.mock("@/lib/takeoff/audit", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/audit")>(), logTakeoffAuditEvent: vi.fn(async () => undefined),
}));

import { prepareCanonicalEstimateCreation } from "@/lib/estimates/canonical-v2-creation";
import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { ensureDefaultEstimateCategories, ensureDefaultLaborRoles } from "@/lib/estimates/version-creation-repository";
import { logTakeoffMappingApplyAuditEvents } from "@/lib/takeoff/apply-repository";
import { logTakeoffAuditEvent } from "@/lib/takeoff/audit";
import { getAuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { buildTakeoffPageReplacementProposal } from "@/lib/takeoff/page-replacement-server";
import { evaluateTakeoffRulesForDestination, recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { previewTakeoffSend, sendTakeoffJob } from "@/lib/takeoff/send-server";

const TENANT = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const JOB = "40000000-0000-4000-8000-000000000001";
const ITEM = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const DPGF_DRAFT = "30000000-0000-4000-8000-000000000001";
const OTHER_DRAFT = "30000000-0000-4000-8000-000000000002";
const REQUEST = "90000000-0000-4000-8000-000000000001";
const OUTCOME = { format_version: 1, engine: 3, sections_created: [], parts: [],
  lines: [{ change: "created", ref: null, section: "new", title: "Lavabo", unit: "u", quantity: 3, quantity_before: null,
    unit_price_ht_cents: 0, takeoff_item_ids: [ITEM] }] };

/** The settings of a first draft as « Créer un devis » prepares them, on a given day, with a given supplies coefficient. */
function versionPayload(day: string, supplies: number) {
  return { id: randomId(), title: null, date_devis: day, validite_jours: 30, margin_multiplier: 1, margin_mode: "fixed",
    currency: "EUR", margin_bp: 0, discount_bp: 0, discount_amount_cents: null, discount_mode: "simple", discount_steps: [],
    global_coefficient: 1, tax_rate_bp: 2000, rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 3,
    contractor_role: "principal", calc_engine_version: 3, sale_coefficient_fo: supplies, sale_coefficient_mo: 1.2,
    gross_ht_cents: 0, discount_applied_cents: 0, commercial_rounding_cents: 0, total_ht_cents: 0, total_tax_cents: 0,
    total_ttc_cents: 0 };
}
let sequence = 0;
function randomId() {
  sequence += 1;
  return `70000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function setUp(versions: Array<{ id: string; dpgf: boolean | number }>, options: {
  results?: Map<string, unknown[]>; dryRun?: (command: Record<string, unknown>) => unknown;
  dryRunError?: Record<string, unknown>;
  /** false: the session reads no receipt, as a retry that raced the first attempt's commit. */
  receiptsVisible?: boolean;
  /** What the receipt says of the version the send wrote to (a first draft by default). */
  sentVersion?: { version_created: boolean; source_version_id: string | null };
} = {}) {
  // What the service staged, by request: the member's session runs it as public.send_takeoff_job does.
  const staged = new Map<string, Record<string, unknown>>();
  // Every command the service staged, in order (a replay stages the same request again).
  const history: Array<Record<string, unknown>> = [];
  // The requests whose send committed, with their version: a later call of the same request replays its receipt.
  const committed = new Map<string, string>();
  const dpgfLines = versions.flatMap((version) => Array.from({ length: typeof version.dpgf === "number" ? version.dpgf : version.dpgf ? 1 : 0 },
    (_, index) => ({ id: `${version.id.slice(0, 24)}${String(index).padStart(12, "0")}`, version_id: version.id, tenant_id: TENANT,
      item_type: "line", source_provider: "dpgf" })));
  const supabase = createSupabaseFake({
    tables: {
      takeoff_jobs: () => ({ data: { id: JOB, project_id: PROJECT, estimate_version_id: null, status: "completed", level: "C",
        plan_set_id: null, execution_provider: "chatgpt_local", preparation_revision: "1" }, error: null }),
      takeoff_items: () => ({ data: [{ id: ITEM, designation: "Lavabo", quantity: 3, unit: "u", is_excluded: false, source_file_name: "plan.pdf",
        source_page: 1, quantity_entry_category: null, metadata: {}, confidence: 0.95, is_verified: false }], error: null, count: 1 }),
      // The receipt of a committed request, as the session reads it before sending again.
      takeoff_send_receipts: (query) => {
        const request = query.filters.find((filter) => filter.column === "request_id")?.value as string | undefined;
        const visible = options.receiptsVisible !== false && request !== undefined && committed.has(request);
        return { data: visible ? { id: "a0000000-0000-4000-8000-000000000001" } : null, error: null };
      },
      // As « Créer un devis » reads them: the affaire, and its latest version (none).
      estimate_projects: () => ({ data: { id: PROJECT, user_id: USER }, error: null }),
      estimate_versions: () => ({ data: null, error: null }),
      estimate_items: () => ({ data: [{ id: "80000000-0000-4000-8000-000000000001", parent_id: null, item_type: "section", position: 1,
        title: "Lot", unit_code: null, pricing_status: null, description: null, quantity: null, updated_at: "2026-11-21T00:00:00Z",
        source_provider: null, source_job_id: null, source_metadata: null }], error: null, count: 1 }),
    },
    rpc: {
      send_takeoff_job: (args) => {
        const command = staged.get((args as { p_request: { request_id: string } }).p_request.request_id) ?? {};
        if (command.mode === "dry_run" && options.dryRunError) return { data: null, error: options.dryRunError };
        if (command.mode === "dry_run") return { data: options.dryRun ? options.dryRun(command) : { dry_run: true, outcome: OUTCOME }, error: null };
        const request = (args as { p_request: { request_id: string } }).p_request.request_id;
        const replayed = committed.has(request);
        if (!replayed) {
          committed.set(request, (command.destination as { version_payload?: { id?: string } }).version_payload?.id ?? DPGF_DRAFT);
        }
        return { data: { id: "a0000000-0000-4000-8000-000000000001", job_id: JOB, project_id: PROJECT, request_id: request,
          target_version_id: committed.get(request),
          result: { version_created: true, source_version_id: null, ...options.sentVersion, created_count: 1, lines_created: [] },
          replayed }, error: null };
      },
    },
  });
  const service = createSupabaseFake({
    tables: {
      estimate_projects: () => ({ data: { id: PROJECT, name: "Affaire fictive", user_id: USER, is_archived: false }, error: null }),
      estimate_versions: (query) => servedRows(versions.map((version, index) => ({ id: version.id, tenant_id: TENANT, project_id: PROJECT,
        version_number: index + 1, status: "draft", title: null, variant_label: null, updated_at: "2026-11-21T00:00:00Z" })), query),
      // As PostgREST serves them: never more than its ceiling of rows per response.
      estimate_items: (query) => servedRows(dpgfLines, query),
      takeoff_send_receipts: () => ({ data: null, error: null }),
    },
    rpc: {
      takeoff_mapping_rules_stamp: () => ({ data: "a".repeat(32), error: null }),
      stage_takeoff_send: (args) => {
        const command = (args as { p_command: Record<string, unknown> }).p_command;
        staged.set(command.request_id as string, command);
        history.push(command);
        return { data: null, error: null };
      },
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
    transforms: [], results: options.results ?? new Map() } as never);
  // As the comparison loader does for a takeoff not on that version.
  vi.mocked(buildTakeoffPageReplacementProposal).mockRejectedValue(Object.assign(new Error("Comparaison DPGF indisponible."), { status: 409 }));
  return { staged: () => [...staged.values()], history: () => [...history] };
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

describe("previewTakeoffSend — the controls between takeoffs, one by one", () => {
  it("says neither control was evaluated when the takeoff's lines carry inputs but no zone was compared", async () => {
    // A count of washbasins with rule inputs: the evaluator gives it no zone result.
    setUp([], { results: new Map([[ITEM, []]]) });

    const preview = await previewTakeoffSend(JOB, {});

    expect(preview.controls).toMatchObject({ evaluated_for: null, not_evaluated_reason: "no_rule_inputs",
      cross_takeoff: { duplicates: "not_evaluated", coverage: "not_evaluated" } });
  });

  it("says the duplicates were evaluated and the coverage was not, when only the duplicates ran", async () => {
    setUp([], { results: new Map([[ITEM, [{ rule: "zone_overlap", status: "pass", code: "ZONE_OVERLAP_NONE", version: 1,
      acceptable: false, reason: "Aucun doublon." }]]]) });

    const preview = await previewTakeoffSend(JOB, {});

    expect(preview.controls).toMatchObject({ evaluated_for: "first_draft", not_evaluated_reason: null,
      cross_takeoff: { duplicates: "evaluated", coverage: "not_evaluated" } });
  });
});

describe("previewTakeoffSend — destinations read in full", () => {
  it("sees the DPGF line of a second draft behind a first draft of a thousand DPGF lines", async () => {
    setUp([{ id: DPGF_DRAFT, dpgf: 1000 }, { id: OTHER_DRAFT, dpgf: 1 }]);

    const preview = await previewTakeoffSend(JOB, { destination: { kind: "existing_draft", version_id: OTHER_DRAFT } });

    expect(preview.blocked?.reason).toBe("dpgf_reconciliation_required");
    expect(buildTakeoffPageReplacementProposal).not.toHaveBeenCalled();
  });
});

describe("previewTakeoffSend — what its dry run answers", () => {
  it("says the estimate is being modified, with a retry, when a lock the preview needs stayed busy", async () => {
    setUp([], { dryRun: () => ({ dry_run: true, error: { code: "TAKEOFF_SEND_BUSY", reason: null } }) });

    await expect(previewTakeoffSend(JOB, {})).rejects.toMatchObject({ status: 503, retryable: true,
      message: "Le devis est en cours de modification : réessayez dans un instant.", details: { guard: "send_estimate_busy" } });
  });

  it("names a refusal the dry run answered, as the confirmation would", async () => {
    setUp([], { dryRun: () => ({ dry_run: true, error: { code: "TAKEOFF_SEND_PREVIEW_STALE", reason: "destination_changed" } }) });

    await expect(previewTakeoffSend(JOB, {})).rejects.toMatchObject({ status: 409,
      details: { guard: "send_preview_stale", reason: "destination_changed" } });
  });

  it("turns an error that is none of the send's refusals into a failure of the server, without the database's text", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    setUp([], { dryRunError: { code: "23514", message: 'new row for relation "estimate_items" violates check constraint "fixture_check"',
      details: "Failing row contains (texte privé fictif).", hint: null } });

    const refused = await previewTakeoffSend(JOB, {}).then(() => null, (error: unknown) => error);

    expect(refused).toMatchObject({ status: 500, details: { guard: "send_preview_failed" } });
    expect(JSON.stringify(refused)).not.toMatch(/fixture_check|Failing row|texte privé/);
    expect(log).toHaveBeenCalledWith("takeoff.send.preview_failed", { job_id: JOB, code: "23514" });
    log.mockRestore();
  });
});

describe("previewTakeoffSend — the unit of each line, as the line stores it", () => {
  it("shows a free unit that reads like a status as the unit it is, and a line without a unit as one", async () => {
    setUp([], { dryRun: () => ({ dry_run: true, outcome: { ...OUTCOME, lines: [
      { ...OUTCOME.lines[0], title: "Gravier", unit: "status:lot", unitless_status: null },
      { ...OUTCOME.lines[0], title: "Forfait pose", unit: null, unitless_status: "included" }] } }) });

    const preview = await previewTakeoffSend(JOB, {});

    expect(preview.estimate_lines?.map((line) => [line.title, line.unit])).toEqual([["Gravier", "status:lot"], ["Forfait pose", null]]);
  });
});

describe("sendTakeoffJob — a first draft is created with the settings of its preview", () => {
  it("refuses a confirmation whose first draft would take other settings than the preview's, and stages no send", async () => {
    const fake = setUp([]);
    vi.mocked(prepareCanonicalEstimateCreation)
      .mockResolvedValueOnce({ versionPayload: versionPayload("2026-11-21", 1.3) } as never)
      .mockResolvedValueOnce({ versionPayload: versionPayload("2026-11-21", 1.6) } as never);
    const preview = await previewTakeoffSend(JOB, {});

    await expect(sendTakeoffJob(JOB, { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" },
      section: { kind: "new" } })).rejects.toMatchObject({ status: 409, details: { guard: "send_preview_stale" } });
    expect(fake.staged().map((command) => command.mode)).toEqual(["dry_run", "dry_run"]);
  });

  it("sends a first draft confirmed after midnight, dated the day it is created, with the settings of its preview", async () => {
    const fake = setUp([]);
    vi.mocked(prepareCanonicalEstimateCreation)
      .mockResolvedValueOnce({ versionPayload: versionPayload("2026-11-21", 1.3) } as never)
      .mockResolvedValueOnce({ versionPayload: versionPayload("2026-11-22", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});

    await sendTakeoffJob(JOB, { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" },
      section: { kind: "new" } });

    const sent = fake.staged().find((command) => command.mode === "send");
    expect((sent?.destination as { version_payload: Record<string, unknown> }).version_payload)
      .toMatchObject({ date_devis: "2026-11-22", sale_coefficient_fo: 1.3 });
    // After the commit: the first draft's defaults and the draft's rules, once; the audit rows are the send's own.
    expect([vi.mocked(ensureDefaultEstimateCategories).mock.calls.length, vi.mocked(ensureDefaultLaborRoles).mock.calls.length,
      vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length]).toEqual([1, 1, 1]);
    expect(logTakeoffAuditEvent).not.toHaveBeenCalled();
    expect(logTakeoffMappingApplyAuditEvents).not.toHaveBeenCalled();
  });
});

describe("sendTakeoffJob — the settings the creation takes from the policy", () => {
  it("refuses a confirmation after the policy's supplies coefficient changed, through the real creation helper", async () => {
    const actual = await vi.importActual<typeof import("@/lib/estimates/canonical-v2-creation")>("@/lib/estimates/canonical-v2-creation");
    vi.mocked(prepareCanonicalEstimateCreation).mockImplementation(actual.prepareCanonicalEstimateCreation);
    let supplies = 1.3;
    vi.mocked(readTenantCalcPolicy).mockImplementation(async () => ({ engine: 3, defaultSaleCoefficientFo: supplies,
      defaultSaleCoefficientMo: 1.2, allowedTaxRatesBp: [2000, 1000, 550, 210] }));
    const fake = setUp([]);
    const preview = await previewTakeoffSend(JOB, {});
    // What the helper hands the creation: the coefficients are left to the policy, read again by the database.
    const previewed = fake.staged()[0].destination as { version_payload: Record<string, unknown> };
    expect(previewed.version_payload).not.toHaveProperty("sale_coefficient_fo");

    supplies = 1.6;
    await expect(sendTakeoffJob(JOB, { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" },
      section: { kind: "new" } })).rejects.toMatchObject({ status: 409, details: { guard: "send_preview_stale" } });
    expect(fake.staged().map((command) => command.mode)).toEqual(["dry_run", "dry_run"]);
  });
});

describe("sendTakeoffJob — what follows the commit, on a replay too", () => {
  it("repairs on a replay what a stop between the commit and its effects left out, and writes no audit row itself", async () => {
    const fake = setUp([]);
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    const payload = { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
    // The first attempt commits, then its process stops before the first draft's defaults: their call never answers.
    vi.mocked(ensureDefaultEstimateCategories).mockImplementationOnce(() => new Promise<void>(() => undefined));
    void sendTakeoffJob(JOB, payload);
    await vi.waitFor(() => expect(ensureDefaultEstimateCategories).toHaveBeenCalledTimes(1));
    expect([vi.mocked(ensureDefaultLaborRoles).mock.calls.length, vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length]).toEqual([0, 0]);

    // « Réessayer »: the same request returns its receipt, and does what the stopped attempt did not.
    const replayed = await sendTakeoffJob(JOB, payload);

    expect(replayed).toMatchObject({ replayed: true, version_created: true, request_id: REQUEST });
    expect(ensureDefaultEstimateCategories).toHaveBeenLastCalledWith(expect.objectContaining({ tenantId: TENANT, userId: USER }));
    expect(ensureDefaultLaborRoles).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, ownerUserId: USER }));
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT,
      estimateVersionId: replayed.version_id, context: "applied" }));
    // The application's audit rows are the send's own, written in its transaction once (format 2): the server adds none,
    // neither after the commit nor on a replay.
    expect(fake.history().map((command) => [command.mode ?? "replay", command.format_version ?? null]))
      .toEqual([["dry_run", 2], ["dry_run", 2], ["send", 2], ["replay", null]]);
    expect(logTakeoffAuditEvent).not.toHaveBeenCalled();
    expect(logTakeoffMappingApplyAuditEvents).not.toHaveBeenCalled();
  });

  it("does the same when the send itself answers that an attempt in flight committed the request", async () => {
    setUp([], { receiptsVisible: false });
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    const payload = { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
    vi.mocked(ensureDefaultEstimateCategories).mockImplementationOnce(() => new Promise<void>(() => undefined));
    void sendTakeoffJob(JOB, payload);
    await vi.waitFor(() => expect(ensureDefaultEstimateCategories).toHaveBeenCalledTimes(1));
    // The retry read no receipt (it raced the first attempt's commit): the send itself answers with the receipt.
    const replayed = await sendTakeoffJob(JOB, payload);

    expect(replayed.replayed).toBe(true);
    expect(ensureDefaultLaborRoles).toHaveBeenCalledTimes(1);
    expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledTimes(1);
  });
});

describe("sendTakeoffJob — the defaults belong to a first draft only, on a replay too", () => {
  it.each([
    ["a copy of an issued version", { version_created: true, source_version_id: "30000000-0000-4000-8000-000000000009" }],
    ["an existing draft", { version_created: false, source_version_id: null }],
  ])("replays a send to %s without creating defaults, and recomputes its rules", async (_label, sentVersion) => {
    setUp([], { sentVersion });
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    const payload = { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
    await sendTakeoffJob(JOB, payload);
    const replayed = await sendTakeoffJob(JOB, payload);

    expect(replayed.replayed).toBe(true);
    expect([vi.mocked(ensureDefaultEstimateCategories).mock.calls.length, vi.mocked(ensureDefaultLaborRoles).mock.calls.length,
      vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length]).toEqual([0, 0, 2]);
  });
});
