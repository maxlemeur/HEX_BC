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
// Review of #434, written before the fix (red on 327516ed):
// - a reader of a receipt who may no longer send to the affaire triggered the repair (rules recomputed by the service);
// - a replay redid the effects of a send whose effects had completed (a renamed default labour role came back), and for
//   the affaire's current owner instead of the owner at the send;
// - a replay of a receipt of format 1 left its audit row to nobody.
// Closing round, written before the fix (red on a36a306b):
// - the member's role was the one read when the request started: demoted meanwhile, they still repaired;
// - a recompute of the rules that failed, or left lines unwritten, was recorded as completed;
// - the first draft's defaults were recorded as done only with the rest, so a stop before the rules left them to redo.
// Lot 4, PR 5b (#484), written before the fix (red on ee09f2b7): a job read against the affaire's list of items is sent
// item by item only, and the database refuses today's send of it (TAKEOFF_SEND_JOB_NOT_READY, reason item_list_job); the
// preview answered « Le métré doit être terminé… » for that finished job, and the confirmation said the same.

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
import { takeoffSendPreviewResponseSchema } from "@/lib/takeoff/send-contracts";
import { mapSendTakeoffRpcError, previewTakeoffSend, sendTakeoffJob } from "@/lib/takeoff/send-server";

const TENANT = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const JOB = "40000000-0000-4000-8000-000000000001";
const ITEM = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const DPGF_DRAFT = "30000000-0000-4000-8000-000000000001";
const OTHER_DRAFT = "30000000-0000-4000-8000-000000000002";
const REQUEST = "90000000-0000-4000-8000-000000000001";
const OTHER_JOB = "40000000-0000-4000-8000-000000000002";
const PLAN_FILE = "a0000000-0000-4000-8000-0000000000f1";
const LOCATION = "b0000000-0000-4000-8000-0000000000c1";
/** The context of a grouped or standalone analysis: no peer, no location; its stamps all the same. */
// The manifests a request is sealed with (src/lib/takeoff/launch-request.ts): lot 2's grouped unit (format 1), and one
// unit per plan (format 2).
const GROUPED_MANIFEST = { format_version: 1, intent: "initial", order: { kind: "free_extraction", version: 1, list: null },
  units: [{ key: "grouped", plans: ["70000000-0000-4000-8000-000000000001"] }],
  plans: [{ entry_key: "70000000-0000-4000-8000-000000000001", name: "plan.pdf", logical_id: "70000000-0000-4000-8000-000000000001",
    intake_document_id: null, plan_file_id: "70000000-0000-4000-8000-000000000001", generation: null }],
  references: [], coverage: { plans_retained: 1, plans_omitted: [], references_omitted: [] },
  preparation: { revision: 1, rule_version: 1 }, budget: { tokens: 400000, cost_cents: 2500 } };
const PLAN_MANIFEST = { ...GROUPED_MANIFEST, format_version: 2,
  units: [{ key: "plan:70000000-0000-4000-8000-000000000001", ordinal: 1, plans: ["70000000-0000-4000-8000-000000000001"] }] };
const NO_CONTEXT = { peers: [], plans: [], stamps: { peers: "1".repeat(32), locations: "2".repeat(32) }, display: null };
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
  /** The affaire's owner the send recorded (the member by default). */
  ownerAtSend?: string;
  /** A request a server of format 1 committed before this one runs. */
  committedBefore?: { request: string; format: number };
  /** The member's role as the database holds it now (the context may say otherwise). */
  membershipRole?: string;
  /**
   * Lot 3: the context the database computed for the send (read_takeoff_send_context, through the rules' evaluation): an
   * analysis of one plan of a request when it names one (display), a grouped or standalone analysis otherwise.
   */
  context?: Record<string, unknown>;
  /** The job's own fields, over the completed versionless analysis of the fake. */
  job?: Record<string, unknown>;
  /** The pages of the plan sent whose own level contradicts the operator's (the rules' evaluation). */
  levelContradictions?: unknown[];
  /** The affaire's other takeoffs, as the service reads them (eq filters applied); none read when undefined. */
  twins?: Array<Record<string, unknown>>;
  /**
   * The manifest the job's launch request was sealed with, as the database holds it: a request of one analysis per plan
   * (format 2) by default when the context names one; lot 2's grouped request (format 1) otherwise.
   */
  requestManifest?: Record<string, unknown>;
  /** Lot 4: the revision of the affaire's list of items the job's launch request was read against (none by default). */
  itemListRevision?: string;
} = {}) {
  // What the service staged, by request: the member's session runs it as public.send_takeoff_job does.
  const staged = new Map<string, Record<string, unknown>>();
  // Every command the service staged, in order (a replay stages the same request again).
  const history: Array<Record<string, unknown>> = [];
  // The requests whose send committed — their version, the format that ran, whether what follows the commit was
  // recorded as completed —: a later call of the same request replays its receipt.
  const committed = new Map<string, { version: string; format: number; completed: boolean; defaults: boolean }>();
  if (options.committedBefore) {
    committed.set(options.committedBefore.request, { version: DPGF_DRAFT, format: options.committedBefore.format, completed: false,
      defaults: false });
  }
  const membership = { role: options.membershipRole ?? "engineer" };
  const completions: string[] = [];
  const dpgfLines = versions.flatMap((version) => Array.from({ length: typeof version.dpgf === "number" ? version.dpgf : version.dpgf ? 1 : 0 },
    (_, index) => ({ id: `${version.id.slice(0, 24)}${String(index).padStart(12, "0")}`, version_id: version.id, tenant_id: TENANT,
      item_type: "line", source_provider: "dpgf" })));
  const supabase = createSupabaseFake({
    tables: {
      takeoff_jobs: () => ({ data: { id: JOB, project_id: PROJECT, estimate_version_id: null, status: "completed", level: "C",
        plan_set_id: null, execution_provider: "chatgpt_local", preparation_revision: "1",
        launch_request_id: options.context?.display ? REQUEST : null, ...options.job },
        error: null }),
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
          committed.set(request, { version: (command.destination as { version_payload?: { id?: string } }).version_payload?.id ?? DPGF_DRAFT,
            format: Number(command.format_version ?? 1), completed: false, defaults: false });
        }
        const sent = committed.get(request)!;
        return { data: { id: request, job_id: JOB, project_id: PROJECT, request_id: request, target_version_id: sent.version,
          result: { version_created: true, source_version_id: null, ...options.sentVersion, created_count: 1, lines_created: [] },
          replayed, command_format: sent.format, effects: sent.completed ? "completed" : "pending",
          defaults: sent.completed || sent.defaults ? "completed" : "pending", affaire_owner_id: options.ownerAtSend ?? USER }, error: null };
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
      ...(options.job?.plan_set_id ? { plan_sets: () => ({ data: { name: "Plans fictifs" }, error: null }) } : {}),
      ...(options.twins ? { takeoff_jobs: (query: { filters: Array<{ kind: string; column: string; value: unknown }> }) => ({
        data: options.twins!.filter((row) => query.filters.every((filter) => (filter.kind !== "eq" && filter.kind !== "is")
          || !(filter.column in row) || row[filter.column] === filter.value)).slice(0, 1), error: null }) } : {}),
      // The member's membership and the tenant as the database holds them now.
      tenant_memberships: () => ({ data: { role: membership.role }, error: null }),
      tenants: () => ({ data: { is_active: true }, error: null }),
      // The job's launch request, by its identifier, its manifest projected as PostgREST projects the server's select
      // (`format_version:manifest->>format_version`: the manifest's own field, as text).
      takeoff_launch_requests: (query: { columns: string | null; filters: Array<{ column: string; value: unknown }> }) => {
        const manifest: Record<string, unknown> | undefined = options.requestManifest ?? (options.context?.display ? PLAN_MANIFEST : undefined);
        const asked = query.filters.find((filter) => filter.column === "id")?.value;
        if (asked === REQUEST && (query.columns ?? "").includes("item_list_revision_id")) {
          return { data: { item_list_revision_id: options.itemListRevision ?? null }, error: null };
        }
        if (!manifest || asked !== REQUEST) return { data: null, error: null };
        const field = /(\w+):manifest->>(\w+)/.exec(query.columns ?? "");
        return { data: field ? { [field[1]]: manifest[field[2]] === undefined ? null : String(manifest[field[2]]) } : { id: REQUEST, manifest },
          error: null };
      },
    },
    rpc: {
      takeoff_mapping_rules_stamp: () => ({ data: "a".repeat(32), error: null }),
      // A step of the receipt's effects recorded (its id is its request's in this fake), once: the first draft's defaults,
      // or all of them.
      complete_takeoff_send_effects: (args) => {
        const { p_receipt_id: receipt, p_step: step } = args as { p_receipt_id: string; p_step?: string };
        completions.push(`${receipt}:${step ?? "all"}`);
        const sent = committed.get(receipt);
        const first = !!sent && !sent.completed && (step !== "defaults" || !sent.defaults);
        if (sent && step === "defaults") sent.defaults = true;
        else if (sent) sent.completed = true;
        return { data: first, error: null };
      },
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
    transforms: [], results: options.results ?? new Map(), context: options.context ?? NO_CONTEXT,
    levelContradictions: options.levelContradictions ?? [] } as never);
  // As the comparison loader does for a takeoff not on that version.
  vi.mocked(buildTakeoffPageReplacementProposal).mockRejectedValue(Object.assign(new Error("Comparaison DPGF indisponible."), { status: 409 }));
  // A recomputation of the rules that wrote every line it read.
  vi.mocked(recomputeTakeoffRulesQuietly).mockResolvedValue({ lines: 0, written: 0, skipped: 0, reopened: 0 });
  return { staged: () => [...staged.values()], history: () => [...history], completions: () => [...completions],
    setRole: (role: string) => { membership.role = role; } };
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

describe("previewTakeoffSend — one analysis per plan", () => {
  // Lot 3, migration C: the send of a plan's analysis opens while the request's other plans are read. Until then (#448)
  // the preview answered « plan_send_pending » with no line; now it previews the plan's lines, names the plans its controls
  // compared it with and those not read yet, and stages the stamps of the context the database computed, which the send
  // compares again under its locks.
  const planContext = (unread: Array<{ plan_name: string; state: string; compared_reading_at?: string | null }>, peers = "c".repeat(32)) => ({
    peers: [{ job_id: OTHER_JOB, stamp: "d".repeat(32) }],
    plans: [{ job_id: JOB, plan_file_id: PLAN_FILE, content_hash: "e".repeat(64), location: { id: LOCATION, revision: 2,
      building_choice: "reading", building: null, level_choice: "value", level: "R+1" }, current_copy: true }],
    stamps: { peers, locations: "f".repeat(32) },
    display: { request_id: REQUEST, plan_name: "plan-a.pdf",
      peers: [{ job_id: OTHER_JOB, plan_name: "plan-b.pdf", read_at: "2026-11-22T09:00:00Z", request: "same" }],
      unread: unread.map((plan) => ({ compared_reading_at: null, ...plan })), never_read: ["plan-d.pdf"],
      uncompared: { grouped: 1, outside_request: 0 } },
  });
  const contradiction = { source_file_name: "plan-a.pdf", source_page: 2, read_level: "R+2", operator_level: "R+1" };

  it("previews the plan's lines while another plan is read, names its scope and stages the context's stamps", async () => {
    const fake = setUp([], { context: planContext([{ plan_name: "plan-c.pdf", state: "running" }]), levelContradictions: [contradiction] });

    const preview = await previewTakeoffSend(JOB, {});

    expect(preview.blocked).toBeNull();
    expect(preview.estimate_lines).toEqual([expect.objectContaining({ change: "created", title: "Lavabo", quantity: 3 })]);
    expect(preview.plan_scope).toEqual({ request_id: REQUEST, plan_name: "plan-a.pdf",
      location: { building: null, level: "R+1", generation: 2 },
      compared: [{ job_id: OTHER_JOB, plan_name: "plan-b.pdf", read_at: "2026-11-22T09:00:00Z", request: "same" }],
      unread: [{ plan_name: "plan-c.pdf", state: "running", compared_reading_at: null }],
      never_read: ["plan-d.pdf"], uncompared: { grouped: 1, outside_request: 0 }, level_contradictions: [contradiction] });
    // The dry run carries the stamps the database computed, never a hash of this server's.
    expect(fake.staged()[0].expected).toMatchObject({ context: { peers: "c".repeat(32), locations: "f".repeat(32) } });
  });

  it("keeps its fingerprint while a plan not read progresses, and changes it when a peer was read", async () => {
    setUp([], { context: planContext([{ plan_name: "plan-c.pdf", state: "queued" }]) });
    const queued = await previewTakeoffSend(JOB, {});
    setUp([], { context: planContext([{ plan_name: "plan-c.pdf", state: "running" }]) });
    const running = await previewTakeoffSend(JOB, {});
    setUp([], { context: planContext([], "9".repeat(32)) });
    const read = await previewTakeoffSend(JOB, {});

    expect(running.fingerprint).toBe(queued.fingerprint);
    expect(read.fingerprint).not.toBe(queued.fingerprint);
  });

  // The grouped analysis of a request of format 1 (lot 2), not a standalone one: its request's manifest says so, and this
  // server reads it. Its preview has no plan scope at all (the key is absent, the shape a page of the previous version
  // reads), even from an evaluation whose context would name one. Red before: the server took the scope from the
  // evaluation alone (fix round 2, point 5; the manifest itself since fix round 3, point 6).
  it("previews a grouped analysis of a request as lot 2 does: no plan scope, by its request's format", async () => {
    const context = planContext([{ plan_name: "plan-c.pdf", state: "queued" }]);
    const fake = setUp([], { job: { launch_request_id: REQUEST, launch_unit_key: "grouped" }, requestManifest: GROUPED_MANIFEST, context });
    const preview = await previewTakeoffSend(JOB, {});
    expect(preview.blocked).toBeNull();
    expect(preview).not.toHaveProperty("plan_scope");
    expect(preview.estimate_lines).toEqual([expect.objectContaining({ change: "created", title: "Lavabo", quantity: 3 })]);
    expect(fake.staged()[0].expected).toMatchObject({ context: context.stamps });
  });

  it("names the scope of a unit of a request of one analysis per plan", async () => {
    setUp([], { job: { launch_request_id: REQUEST, launch_unit_key: `plan:${PLAN_FILE}` }, requestManifest: PLAN_MANIFEST,
      context: planContext([{ plan_name: "plan-c.pdf", state: "queued" }]) });
    expect((await previewTakeoffSend(JOB, {})).plan_scope).toMatchObject({ request_id: REQUEST, plan_name: "plan-a.pdf" });
  });
});

// Fix round 1, point 5: an open page of the previous version reads a preview of this server, and a page of this version a
// preview of the previous server, during a deployment. The previous contract is this one without `plan_scope` (strict),
// as 2c5424215 has it. Red before the fix: the server always sent `plan_scope` (null for a grouped analysis), which the
// previous strict schema refuses, and this schema required it.
describe("previewTakeoffSend — the preview's contract across one deployment", () => {
  const previousContract = takeoffSendPreviewResponseSchema.omit({ plan_scope: true }).strict();

  it("answers a grouped or standalone analysis in the previous shape", async () => {
    setUp([]);
    const preview = await previewTakeoffSend(JOB, {});
    expect(previousContract.safeParse(preview).success).toBe(true);
  });

  it("reads a preview of the previous server, which has no plan scope and may name the closed per-plan send", async () => {
    setUp([]);
    // The previous server never answers plan_scope.
    const previous: Record<string, unknown> = { ...(await previewTakeoffSend(JOB, {})) };
    delete previous.plan_scope;
    expect(takeoffSendPreviewResponseSchema.safeParse(previous).success).toBe(true);
    expect(takeoffSendPreviewResponseSchema.safeParse({ ...previous, blocked: { reason: "plan_send_pending",
      message: "L’envoi au tableau de chiffrage d’une analyse par plan arrive avec une prochaine version." } }).success).toBe(true);
  });
});

describe("previewTakeoffSend — another takeoff of the same preparation in the draft", () => {
  // As the send decides it since 20261121193413: a second analysis launched without a request, of the same plan set,
  // preparation revision, level and provider, is refused by name in one draft; two analyses of one request (two plans)
  // go to the same draft. Before this pull request the server refused the second plan of a request as well.
  const PLAN_SET = "a0000000-0000-4000-8000-0000000000a1";
  const twin = (overrides: Record<string, unknown> = {}) => ({ id: OTHER_JOB, tenant_id: TENANT, estimate_version_id: OTHER_DRAFT,
    plan_set_id: PLAN_SET, level: "C", execution_provider: "chatgpt_local", launch_request_id: null,
    "preparation_snapshot->>preparation_revision": "1", ...overrides });

  it("names a twin launched without a request", async () => {
    setUp([{ id: OTHER_DRAFT, dpgf: false }], { job: { plan_set_id: PLAN_SET }, twins: [twin()] });
    vi.mocked(buildTakeoffPageReplacementProposal).mockResolvedValue({ pages: [] } as never);
    const preview = await previewTakeoffSend(JOB, {});
    expect(preview.destination).toEqual({ kind: "existing_draft", version_id: OTHER_DRAFT });
    expect(preview.blocked?.reason).toBe("preparation_already_sent");
  });

  it("does not compare the analysis of a request: two plans of one request go to one draft", async () => {
    const fake = setUp([{ id: OTHER_DRAFT, dpgf: false }], { job: { plan_set_id: PLAN_SET, launch_request_id: REQUEST }, twins: [twin()] });
    vi.mocked(buildTakeoffPageReplacementProposal).mockResolvedValue({ pages: [] } as never);
    const preview = await previewTakeoffSend(JOB, {});
    expect(preview.blocked).toBeNull();
    expect(fake.staged()).toHaveLength(1);
  });

  // Fix round 1, point 6: the fake applies `.is(...)`: an identical job of a request already in the draft is no twin of an
  // analysis launched without one (red with the filter `launch_request_id is null` removed).
  it("does not name an identical analysis of a request in the draft as a twin of one launched without a request", async () => {
    setUp([{ id: OTHER_DRAFT, dpgf: false }], { job: { plan_set_id: PLAN_SET }, twins: [twin({ launch_request_id: REQUEST })] });
    vi.mocked(buildTakeoffPageReplacementProposal).mockResolvedValue({ pages: [] } as never);
    expect((await previewTakeoffSend(JOB, {})).blocked).toBeNull();
  });

  it("does not name a twin of another provider", async () => {
    setUp([{ id: OTHER_DRAFT, dpgf: false }], { job: { plan_set_id: PLAN_SET }, twins: [twin({ execution_provider: "chatgpt" })] });
    vi.mocked(buildTakeoffPageReplacementProposal).mockResolvedValue({ pages: [] } as never);
    expect((await previewTakeoffSend(JOB, {})).blocked).toBeNull();
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

describe("previewTakeoffSend — a job read against the affaire's list of items", () => {
  const LIST_JOB_MESSAGE = "Ce métré a été lu contre la liste des postes : il s’envoie poste par poste. Rien n’a été écrit.";

  it("refuses it with its own reason before any dry run, never as a takeoff to finish", async () => {
    const fake = setUp([], { itemListRevision: "c0000000-0000-4000-8000-000000000001", job: { launch_request_id: REQUEST } });

    await expect(previewTakeoffSend(JOB, {})).rejects.toMatchObject({ status: 409, retryable: false, message: LIST_JOB_MESSAGE,
      details: { guard: "send_item_list_job" } });
    expect(fake.staged()).toEqual([]);
  });

  it("refuses its confirmation the same way, and stages nothing", async () => {
    const fake = setUp([], { itemListRevision: "c0000000-0000-4000-8000-000000000001", job: { launch_request_id: REQUEST } });

    await expect(sendTakeoffJob(JOB, { request_id: "a1000000-0000-4000-8000-000000000001", fingerprint: "f".repeat(64),
      destination: { kind: "first_draft" }, section: { kind: "new" } })).rejects.toMatchObject({ status: 409, message: LIST_JOB_MESSAGE,
      details: { guard: "send_item_list_job" } });
    expect(fake.history()).toEqual([]);
  });

  it("says the same when the database refuses the link of such a job (its trigger, reason item_list_job)", () => {
    expect(mapSendTakeoffRpcError({ message: "TAKEOFF_SEND_JOB_NOT_READY", details: JSON.stringify({ reason: "item_list_job" }),
      hint: null } as never, JOB)).toMatchObject({ status: 409, message: LIST_JOB_MESSAGE, details: { guard: "send_item_list_job" } });
    expect(mapSendTakeoffRpcError({ message: "TAKEOFF_SEND_JOB_NOT_READY", details: null, hint: null } as never, JOB))
      .toMatchObject({ status: 409, details: { guard: "send_not_ready" } });
  });

  it("previews a job of a request read without a list as before", async () => {
    setUp([], { requestManifest: GROUPED_MANIFEST, job: { launch_request_id: REQUEST } });

    const preview = await previewTakeoffSend(JOB, {});

    expect(preview.blocked).toBeNull();
    expect(preview.estimate_lines).toEqual([expect.objectContaining({ title: "Lavabo", quantity: 3 })]);
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
    const fake = setUp([], { sentVersion });
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    const payload = { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
    // The first attempt commits, then stops while the rules are computed again (their call never answers).
    vi.mocked(recomputeTakeoffRulesQuietly).mockImplementationOnce(() => new Promise(() => undefined));
    void sendTakeoffJob(JOB, payload);
    await vi.waitFor(() => expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledTimes(1));
    const replayed = await sendTakeoffJob(JOB, payload);

    expect(replayed.replayed).toBe(true);
    expect([vi.mocked(ensureDefaultEstimateCategories).mock.calls.length, vi.mocked(ensureDefaultLaborRoles).mock.calls.length,
      vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length]).toEqual([0, 0, 2]);
    expect(fake.completions()).toEqual([`${REQUEST}:all`]);
  });
});

describe("sendTakeoffJob — a replay repairs only what did not complete, for whom may still send", () => {
  async function stopAfterCommit(fake: ReturnType<typeof setUp>) {
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    const payload = { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
    vi.mocked(ensureDefaultEstimateCategories).mockImplementationOnce(() => new Promise<void>(() => undefined));
    void sendTakeoffJob(JOB, payload);
    await vi.waitFor(() => expect(ensureDefaultEstimateCategories).toHaveBeenCalledTimes(1));
    expect(fake.completions()).toEqual([]);
    return payload;
  }
  const effects = () => [vi.mocked(ensureDefaultEstimateCategories).mock.calls.length, vi.mocked(ensureDefaultLaborRoles).mock.calls.length,
    vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length];

  it("records the effects completed after the attempt that committed, and a replay then does nothing more", async () => {
    const fake = setUp([]);
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    const payload = { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
    await sendTakeoffJob(JOB, payload);
    expect([effects(), fake.completions()]).toEqual([[1, 1, 1], [`${REQUEST}:defaults`, `${REQUEST}:all`]]);

    // The owner renamed a default labour role since: a replay must not create it again.
    const replayed = await sendTakeoffJob(JOB, payload);

    expect(replayed.replayed).toBe(true);
    expect([effects(), fake.completions()]).toEqual([[1, 1, 1], [`${REQUEST}:defaults`, `${REQUEST}:all`]]);
  });

  it("repairs the labour roles of the owner the send recorded, not of the affaire's owner of now", async () => {
    const fake = setUp([], { ownerAtSend: "60000000-0000-4000-8000-000000000009" });
    const payload = await stopAfterCommit(fake);

    await sendTakeoffJob(JOB, payload);

    expect(ensureDefaultLaborRoles).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "60000000-0000-4000-8000-000000000009" }));
    expect(fake.completions()).toEqual([`${REQUEST}:defaults`, `${REQUEST}:all`]);
  });

  it("gives a reader who may no longer send to the affaire the receipt and nothing else", async () => {
    const fake = setUp([]);
    const payload = await stopAfterCommit(fake);
    // The engineer who sent is now a director: they still read the receipt.
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: (await getAuthenticatedTakeoffContext()).supabase,
      tenantId: TENANT, userId: USER, tenantRole: "director" } as never);
    fake.setRole("director");

    const replayed = await sendTakeoffJob(JOB, payload);

    expect(replayed).toMatchObject({ replayed: true, request_id: REQUEST });
    expect([effects(), fake.completions()]).toEqual([[1, 0, 0], []]);
  });

  it("has the database complete a receipt of format 1 it replays, which writes the audit row its server did not", async () => {
    const fake = setUp([], { committedBefore: { request: REQUEST, format: 1 } });

    const replayed = await sendTakeoffJob(JOB, { request_id: REQUEST, fingerprint: "f".repeat(64), destination: { kind: "first_draft" },
      section: { kind: "new" } });

    expect(replayed.replayed).toBe(true);
    expect(fake.completions()).toEqual([`${REQUEST}:defaults`, `${REQUEST}:all`]);
    expect(logTakeoffAuditEvent).not.toHaveBeenCalled();
  });
});

describe("sendTakeoffJob — what follows the commit, decided on what the database holds now", () => {
  async function previewed() {
    vi.mocked(prepareCanonicalEstimateCreation).mockResolvedValue({ versionPayload: versionPayload("2026-11-21", 1.3) } as never);
    const preview = await previewTakeoffSend(JOB, {});
    return { request_id: REQUEST, fingerprint: preview.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } };
  }

  it("does nothing for a member demoted since the request started, whatever the request's context says", async () => {
    const fake = setUp([]);
    const payload = await previewed();
    vi.mocked(ensureDefaultEstimateCategories).mockImplementationOnce(() => new Promise<void>(() => undefined));
    void sendTakeoffJob(JOB, payload);
    await vi.waitFor(() => expect(ensureDefaultEstimateCategories).toHaveBeenCalledTimes(1));
    // The replay's context was read as an engineer's; the membership is a director's by the time it repairs.
    fake.setRole("director");

    await sendTakeoffJob(JOB, payload);

    expect([vi.mocked(ensureDefaultLaborRoles).mock.calls.length, vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length,
      fake.completions()]).toEqual([0, 0, []]);
  });

  it.each([
    ["failed", null],
    ["left lines unwritten", { lines: 2, written: 1, skipped: 1, reopened: 0 }],
  ])("leaves the effects pending when the rules' recompute %s, and the next replay completes them", async (_label, outcome) => {
    const fake = setUp([]);
    const payload = await previewed();
    vi.mocked(recomputeTakeoffRulesQuietly).mockResolvedValueOnce(outcome as never);

    await sendTakeoffJob(JOB, payload);
    expect(fake.completions()).toEqual([`${REQUEST}:defaults`]);

    await sendTakeoffJob(JOB, payload);
    expect(fake.completions()).toEqual([`${REQUEST}:defaults`, `${REQUEST}:all`]);
  });

  it("records the defaults as soon as they are done, and a replay after a stop before the rules does not redo them", async () => {
    const fake = setUp([]);
    const payload = await previewed();
    // The first attempt creates the defaults, then stops while the rules are computed again.
    vi.mocked(recomputeTakeoffRulesQuietly).mockImplementationOnce(() => new Promise(() => undefined));
    void sendTakeoffJob(JOB, payload);
    await vi.waitFor(() => expect(recomputeTakeoffRulesQuietly).toHaveBeenCalledTimes(1));
    expect(fake.completions()).toEqual([`${REQUEST}:defaults`]);

    // The owner renames a default labour role, then the member retries.
    await sendTakeoffJob(JOB, payload);

    expect([vi.mocked(ensureDefaultEstimateCategories).mock.calls.length, vi.mocked(ensureDefaultLaborRoles).mock.calls.length,
      vi.mocked(recomputeTakeoffRulesQuietly).mock.calls.length]).toEqual([1, 1, 2]);
    expect(fake.completions()).toEqual([`${REQUEST}:defaults`, `${REQUEST}:all`]);
  });
});
