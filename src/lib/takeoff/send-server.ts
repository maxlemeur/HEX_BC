import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { prepareCanonicalEstimateCreation } from "@/lib/estimates/canonical-v2-creation";
import { ABSENT_TENANT_CALC_POLICY, readTenantCalcPolicy, type TenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { requireEstimateEngineVersion, usesSaleCoefficients } from "@/lib/estimates/engine/capabilities";
import { ensureDefaultEstimateCategories, ensureDefaultLaborRoles } from "@/lib/estimates/version-creation-repository";
import { forbidden, mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildTakeoffAtomicMappingPlan } from "@/lib/takeoff/apply-preparation";
import { listTakeoffApplyGuardItems, listTakeoffRulePartnerExclusions } from "@/lib/takeoff/apply-repository";
import { mapApplyTakeoffRpcError, type ApplyTakeoffRpcError } from "@/lib/takeoff/apply-errors";
import { takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { getTakeoffLowConfidenceThresholdForTenant } from "@/lib/takeoff/feature-flags";
import { forcedItemError, FORCE_MESSAGES, packForcedItems, type ForcedEntry } from "@/lib/takeoff/force-reasons";
import { checkApplyGuard, type GuardBlockedItem } from "@/lib/takeoff/guards";
import { takeoffHypothesisCause } from "@/lib/takeoff/hypothesis";
import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import { buildTakeoffPageReplacementProposal } from "@/lib/takeoff/page-replacement-server";
import { parseApplyTakeoffPayload } from "@/lib/takeoff/query-parsers";
import { failurePartners, isLineId, leftOutByPartners } from "@/lib/takeoff/rules/partner-exclusions";
import { ruleFailuresReopen, ruleOverrideFailureKeys } from "@/lib/takeoff/rules/failure-keys";
import { evaluateTakeoffRulesForDestination, recomputeTakeoffRulesQuietly } from "@/lib/takeoff/rules/recompute-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import {
  takeoffSendPreviewRequestSchema,
  takeoffSendRequestSchema,
  type TakeoffSendBlocker,
  type TakeoffSendDestination,
  type TakeoffSendPreviewResponse,
  type TakeoffSendResponse,
  type TakeoffSendSectionChoice,
} from "@/lib/takeoff/send-contracts";
import {
  defaultTakeoffSendSection,
  orderTakeoffSendSections,
  previewOrReplay,
  proposeTakeoffSendAccumulations,
  resolveTakeoffSendDestinations,
  sameTakeoffSendDestination,
  takeoffSendSectionTitle,
  type TakeoffSendSectionLine,
  type TakeoffSendVersion,
} from "@/lib/takeoff/send-plan";
import { parseWithSchema, TAKEOFF_TENANT_ADMIN_ROLE } from "@/lib/takeoff/server-helpers";
import type { TakeoffMappingPreviewItem, TakeoffPreviewConversionResponse } from "@/lib/takeoff/types";
import type { Json } from "@/types/database";

// Lot 2, M2: « Envoyer au tableau de chiffrage » for a takeoff of an affaire (one admitted without a version, M1). The
// preview reads and computes, then runs the send and rolls it back (its dry run): it shows the lines as the estimate would
// hold them and writes nothing. The confirmation computes the same preview again, refuses it when its fingerprint
// differs from the one the user confirmed, and hands the database what it computed — the state it computed it from and
// the outcome the member saw (public.send_takeoff_job) —, which reads that state again under its locks and refuses any
// other outcome.

type Context = AuthenticatedTakeoffContext & { tenantRole: string };
type Service = ReturnType<typeof createServiceRoleClient>;

const BLOCKER_MESSAGES: Record<TakeoffSendBlocker, string> = {
  not_completed: "Le métré doit être terminé pour être envoyé au tableau de chiffrage.",
  already_sent: "Ce métré a déjà été envoyé au tableau de chiffrage.",
  no_line: "Aucune ligne retenue à envoyer : réintégrez au moins une ligne dans la revue.",
  dpgf_reconciliation_required: "Ce devis contient des lignes DPGF : l’envoi passe par le rapprochement DPGF, qui n’est pas encore "
    + "possible pour un métré d’affaire. Choisissez un autre brouillon ; rien n’est écrit.",
  copy_pages_already_in_estimate: "La version à copier porte déjà des pages de ce métré : la copie ne peut pas les remplacer "
    + "dans le même envoi. Créez d’abord la copie depuis le devis, puis envoyez-y le métré.",
  preparation_already_sent: "Un autre métré de la même préparation est déjà dans ce devis : relancez la préparation ou "
    + "choisissez un autre brouillon.",
  choose_destination: "Plusieurs brouillons peuvent recevoir ce métré : choisissez la destination.",
  read_only: "Ce métré est accessible en lecture seule.",
  rules_unbounded: "Les contrôles de ce métré ne peuvent pas être enregistrés pour ce devis : contactez le support.",
  draft_locked: "Ce brouillon est ouvert par un autre membre : l’envoi y sera possible quand il l’aura libéré.",
  plan_send_pending: "L’envoi au tableau de chiffrage d’une analyse par plan arrive avec une prochaine version : relisez son "
    + "résultat dans la revue ; rien n’est écrit.",
};

const PRICE_ACTIONS = new Set(["set_price", "apply_assembly"]);

/**
 * The format of the command the server stages: 2, whose send writes the application's audit rows (« takeoff.apply.completed »
 * and one « takeoff.mapping.applied » per line a mapping rule changed) in its own transaction, once. The database still
 * admits format 1, the previous application's, whose server writes them after the commit.
 */
const SEND_COMMAND_FORMAT = 2;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const sha256 = (value: unknown) => createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");

function failed(error: { message?: string } | null, message: string, jobId?: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

/**
 * The impact preview without any price effect: « Fixer le prix » leaves the price as the line has it, an ouvrage rule
 * keeps the measured line and its ouvrage is not inserted. Prices are never touched by this journey; the database
 * refuses a plan that would (TAKEOFF_SEND_PRICE_RULE_REFUSED).
 */
export function withoutPriceEffects(preview: TakeoffPreviewConversionResponse): TakeoffPreviewConversionResponse {
  const items = preview.items.map((item): TakeoffMappingPreviewItem => (PRICE_ACTIONS.has(item.action)
    ? { ...item, action: "none", action_params: {}, transformed: { ...item.original } } : item));
  const included = items.filter((item) => !item.original.is_excluded);
  return { ...preview, items, summary: {
    total_count: items.length,
    included_count: included.length,
    transformed_count: included.filter((item) => item.action !== "none").length,
    overridden_count: included.filter((item) => item.applied_by === "override").length,
    excluded_by_mapping_count: included.filter((item) => item.transformed.is_excluded && item.action === "skip").length,
    assembly_insertions_count: 0,
  } };
}

type SendJob = { id: string; project_id: string; estimate_version_id: string | null; status: string; level: string;
  plan_set_id: string | null; execution_provider: string | null; preparation_revision: string | null;
  /** A plan's unit of one analysis per plan (« plan:… »), whose send stays closed (the database refuses it too). */
  launch_unit_key: string | null };

async function readSendJob(ctx: Context, jobId: string): Promise<SendJob> {
  const { data, error } = await ctx.supabase.from("takeoff_jobs" as never)
    .select("id, project_id, estimate_version_id, status, level, plan_set_id, execution_provider, launch_unit_key, preparation_revision:preparation_snapshot->>preparation_revision" as never)
    .eq("tenant_id" as never, ctx.tenantId as never).eq("id" as never, jobId as never).maybeSingle();
  if (error) failed(error, "Impossible de charger le métré.", jobId);
  if (!data) {
    throw new TakeoffError({ status: 404, code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND, message: "Job takeoff introuvable.",
      details: { job_id: jobId }, retryable: false, jobId });
  }
  return data as unknown as SendJob;
}

async function readVersions(service: Service, tenantId: string, projectId: string): Promise<TakeoffSendVersion[]> {
  const { data, error } = await readAllRows(() => service.from("estimate_versions")
    .select("id, version_number, status, title, variant_label, updated_at", { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId));
  if (error) failed(error as { message?: string }, "Impossible de lire les versions de l’affaire.");
  const versions = (data ?? []) as Array<Omit<TakeoffSendVersion, "holds_dpgf_lines">>;
  // One answer per version (does it hold a DPGF line?), never a list of its DPGF lines cut at PostgREST's ceiling.
  const withDpgf = await Promise.all(versions.map(async (version) => {
    const { data: line, error: lineError } = await service.from("estimate_items").select("id").eq("tenant_id", tenantId)
      .eq("version_id", version.id).eq("item_type", "line").eq("source_provider", "dpgf").limit(1);
    if (lineError) failed(lineError, "Impossible de lire les lignes DPGF de l’affaire.");
    return (line ?? []).length > 0;
  }));
  return versions.map((version, index) => ({ ...version, holds_dpgf_lines: withDpgf[index] }));
}

type SendItem = { id: string; designation: string; quantity: number; unit: string; is_excluded: boolean; source_file_name: string | null;
  source_page: number | null; quantity_entry_category: string | null; metadata: unknown; confidence: number | null; is_verified: boolean };

async function readSendItems(ctx: Context, jobId: string): Promise<SendItem[]> {
  const { data, error } = await readAllRows(() => ctx.supabase.from("takeoff_items" as never)
    .select("id, designation, quantity, unit, is_excluded, source_file_name, source_page, quantity_entry_category, metadata, confidence, is_verified" as never,
      { count: "exact" })
    .eq("tenant_id" as never, ctx.tenantId as never).eq("job_id" as never, jobId as never));
  if (error) failed(error as { message?: string }, "Impossible de lire les lignes du métré.", jobId);
  return ((data ?? []) as unknown as SendItem[]).map((item) => ({ ...item, quantity: Number(item.quantity) }));
}

type DraftItem = { id: string; parent_id: string | null; item_type: string; position: number | null; title: string | null;
  unit_code: string | null; pricing_status: string | null; description: string | null; quantity: number | string | null; updated_at: string;
  source_provider: string | null; source_job_id: string | null; source_metadata: unknown };

async function readDraftItems(ctx: Context, versionId: string): Promise<DraftItem[]> {
  const { data, error } = await readAllRows(() => ctx.supabase.from("estimate_items" as never)
    .select("id, parent_id, item_type, position, title, unit_code, pricing_status, description, quantity, updated_at, source_provider, source_job_id, source_metadata" as never,
      { count: "exact" })
    .eq("tenant_id" as never, ctx.tenantId as never).eq("version_id" as never, versionId as never), { pageSize: 1000 });
  if (error) failed(error as { message?: string }, "Impossible de lire le brouillon de devis.");
  return (data ?? []) as unknown as DraftItem[];
}

/** The send as the database writes it, from the state the preview read; what the dry run and the confirmation stage. */
type StagedParts = {
  destination: Record<string, unknown>;
  section: { kind: "new"; id: string; title: string } | { kind: "existing"; id: string };
  expected: { versions: Array<{ id: string; status: string; updated_at: string }>; job_stamp: string; peers_stamp: string | null;
    mapping_stamp: string };
  mapping_plan: ReturnType<typeof buildTakeoffAtomicMappingPlan>;
  page_decisions: unknown[];
  rule_results: unknown[];
  rule_transforms: unknown[];
  accumulations: Array<{ takeoff_item_id: string; estimate_item_id: string; expected_updated_at: string; expected_quantity: number }>;
  price_rules_ignored: unknown[];
};

type Computed = {
  response: TakeoffSendPreviewResponse;
  /** What the confirmation hands the database; null when the preview blocks or has no outcome to confirm. */
  command: (StagedParts & {
    target: TakeoffSendDestination;
    /** The outcome the dry run showed: the confirmation is refused when the send would write anything else. */
    outcome: Record<string, unknown>;
    blocked_items: GuardBlockedItem[];
    guard_items: Awaited<ReturnType<typeof listTakeoffApplyGuardItems>>;
    threshold: number;
    engine: number | null;
  }) | null;
};

const DRY_RUN_JUSTIFICATION = "Aperçu de l’envoi : motif provisoire, jamais enregistré.";

/**
 * The dry run of the send: the command staged by the service under a fresh identity, run by the member's session and
 * rolled back (public.send_takeoff_job, mode dry_run). It returns what the send would leave — lines created, changed and
 * removed, each in its section, with the quantity as written — and writes nothing.
 */
async function dryRunSend(ctx: Context, jobId: string, parts: StagedParts, override: Record<string, unknown> | null) {
  const requestId = randomUUID();
  const staged = { format_version: SEND_COMMAND_FORMAT, mode: "dry_run", request_id: requestId, job_id: jobId, fingerprint: sha256({ dry_run: requestId }),
    client: {}, ...parts, override, expected_outcome: null };
  const { error: stageError } = await createServiceRoleClient().rpc("stage_takeoff_send" as never,
    { p_actor_id: ctx.userId, p_command: staged as unknown as Json } as never);
  if (stageError) throw mapSendTakeoffRpcError(stageError, jobId);
  const { data, error } = await ctx.supabase.rpc("send_takeoff_job" as never, {
    p_request: { request_id: requestId, job_id: jobId, fingerprint: staged.fingerprint } as unknown as Json } as never);
  // Raised: none of the send's named refusals (a check of the database, a fault). Its text stays in the server's log.
  if (error) {
    console.error("takeoff.send.preview_failed", { job_id: jobId, code: (error as { code?: string }).code ?? null });
    throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true, jobId,
      message: "L’aperçu de l’envoi n’a pas pu être calculé.", details: { guard: "send_preview_failed" } });
  }
  // The dry run answers the send's named refusals by their code (and, for a stale preview or a page decision, the
  // identifier of its reason), as the confirmation would raise them; its staged command goes with that answer.
  const answer = data as { outcome?: Record<string, unknown>; error?: { code?: string; reason?: string | null } } | null;
  if (answer?.error) {
    return { error: { message: answer.error.code ?? "", details: answer.error.reason ? JSON.stringify({ reason: answer.error.reason }) : null,
      hint: null } as ApplyTakeoffRpcError, outcome: null };
  }
  const outcome = answer?.outcome;
  if (!outcome || typeof outcome !== "object") failed(null, "L’aperçu de l’envoi n’a pas pu être calculé.", jobId);
  return { error: null, outcome };
}

/** An override that holds for every blocked line, for the administrator's dry run only (rolled back with it). */
function dryRunOverride(blocked: readonly GuardBlockedItem[], guardItems: Awaited<ReturnType<typeof listTakeoffApplyGuardItems>>,
  threshold: number) {
  const forced = blocked.map((line) => ({ item_id: line.item_id, reason_code: "additional_evidence" as const,
    justification: DRY_RUN_JUSTIFICATION }));
  return overrideFromForced(blocked, forced, guardItems, threshold);
}

type OutcomeLine = { change: "created" | "changed" | "removed"; section: string | null; title: string; unit: string | null;
  quantity: number; quantity_before: number | null; unit_price_ht_cents: number | null; takeoff_item_ids: string[] };

async function computeSendPreview(ctx: Context, job: SendJob, request: {
  destination?: TakeoffSendDestination; section?: TakeoffSendSectionChoice; page_decisions?: unknown[];
}): Promise<Computed> {
  const service = createServiceRoleClient();
  const { data: project, error: projectError } = await service.from("estimate_projects")
    .select("id, name, user_id, is_archived").eq("tenant_id", ctx.tenantId).eq("id", job.project_id).maybeSingle();
  if (projectError || !project) failed(projectError, "Impossible de lire l’affaire du métré.", job.id);
  const canEdit = !project.is_archived && (ctx.tenantRole === TAKEOFF_TENANT_ADMIN_ROLE
    || (ctx.tenantRole === "engineer" && project.user_id === ctx.userId));
  const reasonOnly = (blocker: TakeoffSendBlocker, extra: Partial<TakeoffSendPreviewResponse> = {}): Computed => ({ command: null,
    response: { job_id: job.id, fingerprint: sha256({ format_version: 1, job_id: job.id, blocker, extra }),
      destinations: [], destination: null, destination_label: null, section: null, section_options: [],
      new_section_title: takeoffSendSectionTitle(null), blocked: { reason: blocker, message: BLOCKER_MESSAGES[blocker] }, engine: null,
      lines: [], left_out: [], price_rules_ignored: [], reservations: [], estimate_lines: null, outcome_pending: null,
      controls: { evaluated_for: null, not_evaluated_reason: null, cross_takeoff: null, blocked_items: [], medium_items: [], threshold: 0 },
      page_proposal: null,
      impact: { sent_count: 0, accumulated_count: 0, version_created: false, section_created: false }, ...extra } });

  // A takeoff that cannot be sent from here (already sent, not finished, or read by someone who cannot write the affaire)
  // gets its reason only: nothing of the affaire's versions nor of its estimates is read for it.
  const early: TakeoffSendBlocker | null = job.status === "applied" || job.estimate_version_id !== null ? "already_sent"
    : job.status !== "completed" ? "not_completed" : !canEdit ? "read_only"
      : job.launch_unit_key?.startsWith("plan:") ? "plan_send_pending" : null;
  if (early) return reasonOnly(early);

  // The mapping rules' state, read before the rules themselves: a rule changed after it refuses the send.
  const { data: mappingStamp, error: mappingStampError } = await service.rpc("takeoff_mapping_rules_stamp" as never,
    { p_tenant_id: ctx.tenantId } as never);
  if (mappingStampError || typeof mappingStamp !== "string") failed(mappingStampError, "Impossible de lire les règles de correspondance.", job.id);

  const versions = await readVersions(service, ctx.tenantId, job.project_id);
  const { options, preferred } = resolveTakeoffSendDestinations(versions);
  if (request.destination && !options.some((option) => sameTakeoffSendDestination(option.destination, request.destination))) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId: job.id,
      message: "Les versions de l’affaire ont changé depuis l’aperçu : vérifiez la destination proposée puis confirmez.",
      details: { guard: "send_preview_stale", reason: "destination_changed" } });
  }
  const destination = request.destination ?? preferred;
  const option = destination ? options.find((entry) => sameTakeoffSendDestination(entry.destination, destination)) ?? null : null;
  const destinations = options.map((entry) => ({ destination: entry.destination, label: entry.label, blocked: entry.blocked }));
  // A destination that cannot receive this send (a draft that holds DPGF lines) says so at once, by name: nothing of it
  // is read further (its page proposal and its DPGF comparison need the takeoff on that version, which only the send does).
  if (option?.blocked) {
    return reasonOnly(option.blocked, { destinations, destination: destination ?? null, destination_label: option.label });
  }
  const targetVersionId = destination?.kind === "existing_draft" ? destination.version_id : null;
  const readVersionId = destination?.kind === "existing_draft" ? destination.version_id
    : destination?.kind === "version_copy" ? destination.source_version_id : null;
  const policy = destination && destination.kind !== "existing_draft" ? await readTenantCalcPolicy(ctx.supabase, ctx.tenantId) : null;

  const { data: planSet } = job.plan_set_id ? await service.from("plan_sets").select("name").eq("tenant_id", ctx.tenantId)
    .eq("id", job.plan_set_id).maybeSingle() : { data: null };
  const newSectionTitle = takeoffSendSectionTitle(planSet?.name);

  // The section: a new one in a created version, else one of the draft's (the one the last send filled by default).
  const draftItems = targetVersionId ? await readDraftItems(ctx, targetVersionId) : [];
  const ordered = orderTakeoffSendSections(draftItems.filter((item) => item.item_type === "section"));
  let lastSentSectionId: string | null = null;
  if (targetVersionId && !request.section) {
    const { data: last } = await service.from("takeoff_send_receipts" as never).select("write_plan" as never)
      .eq("tenant_id" as never, ctx.tenantId as never).eq("target_version_id" as never, targetVersionId as never)
      .order("created_at" as never, { ascending: false }).limit(1).maybeSingle();
    const sections = (last as { write_plan?: { sections?: Array<{ id?: string }> } } | null)?.write_plan?.sections;
    lastSentSectionId = sections?.[0]?.id ?? null;
  }
  const sectionChoice = destination?.kind === "existing_draft"
    ? defaultTakeoffSendSection({ requested: request.section, ordered, lastSentSectionId }) : { kind: "new" as const };
  const sectionId = sectionChoice.kind === "existing" ? sectionChoice.id : null;

  // What enters: the lines the review retains, the administrator's mapping rules without any price effect.
  const preview = withoutPriceEffects(await buildTakeoffMappingPreviewForJob({ supabase: ctx.supabase, tenantId: ctx.tenantId,
    jobId: job.id, request: parseApplyTakeoffPayload({ strategy: "append", target_section_id: sectionId }) }));
  const items = await readSendItems(ctx, job.id);
  const byId = new Map(items.map((item) => [item.id, item]));
  const original = await buildTakeoffMappingPreviewForJob({ supabase: ctx.supabase, tenantId: ctx.tenantId, jobId: job.id,
    request: parseApplyTakeoffPayload({ strategy: "append", target_section_id: sectionId }) });
  const priceRulesIgnored = original.items.filter((item) => !item.original.is_excluded && PRICE_ACTIONS.has(item.action))
    .map((item) => ({ takeoff_item_id: item.item_id, designation: item.original.designation, rule_name: item.rule_name,
      action: item.action as "set_price" | "apply_assembly" }));
  const sentItems = preview.items.filter((item) => !item.original.is_excluded && item.action !== "skip");
  const leftOut = preview.items.filter((item) => item.original.is_excluded || item.action === "skip").map((item) => ({
    takeoff_item_id: item.item_id, designation: item.original.designation,
    reason: item.original.is_excluded ? "excluded" as const : "rule_skip" as const, rule_name: item.original.is_excluded ? null : item.rule_name }));

  // The controls, evaluated for this destination against the takeoffs its lines come from: those the draft holds or a
  // copy carried over to it, and its DPGF lines; for a copy, those of the version it copies; none for a first draft.
  // Nothing is shown as checked that was not evaluated here: a takeoff whose lines carry no rule inputs says so.
  const rules = destination ? await evaluateTakeoffRulesForDestination({ tenantId: ctx.tenantId, projectId: job.project_id,
    jobId: job.id, destinationVersionId: readVersionId, supabase: service }) : null;
  const threshold = await getTakeoffLowConfidenceThresholdForTenant(ctx.tenantId, { supabase: ctx.supabase });
  const storedGuardItems = await listTakeoffApplyGuardItems({ supabase: ctx.supabase, tenantId: ctx.tenantId, jobId: job.id });
  const skipped = new Set(preview.items.filter((item) => item.action === "skip").map((item) => item.item_id));
  const guardItems = storedGuardItems.map((item) => {
    const evaluated = rules?.results.get(item.id);
    const kept = { ...item, is_excluded: item.is_excluded || skipped.has(item.id) };
    if (!evaluated) return kept;
    // As the send command leaves the line once it wrote the rules evaluated for this destination: fresh, and a verified
    // line whose evaluation brings a failure it did not have loses its verification. An administrator's override binds
    // to that state, the one the application's trigger reads (takeoff_apply_override_state_holds).
    const evaluatedLine = { ...kept, rule_results: evaluated, rules_stale: false,
      is_verified: item.is_verified && !ruleFailuresReopen(item.rule_results ?? [], evaluated) };
    return { ...evaluatedLine, override_state: { ...item.override_state, rule_failures: ruleOverrideFailureKeys(evaluated),
      rules_stale: false, is_verified: evaluatedLine.is_verified } };
  });
  const ownIds = new Set(guardItems.map((item) => item.id.toLowerCase()));
  const outsidePartners = [...new Set(guardItems.flatMap((item) => (item.is_excluded ? [] : item.rule_results ?? [])
    .flatMap((result) => (result.status === "fail" ? failurePartners(result)?.ids ?? [] : []))
    .filter(isLineId).map((id) => id.toLowerCase()).filter((id) => !ownIds.has(id))))];
  const partnerExclusions = outsidePartners.length > 0
    ? await listTakeoffRulePartnerExclusions({ supabase: ctx.supabase, tenantId: ctx.tenantId, itemIds: outsidePartners }) : undefined;
  const guard = destination ? checkApplyGuard(guardItems, threshold, { level: job.level, partnerExclusions, leftOut: leftOutByPartners }) : null;
  const blockedIds = new Set((guard?.blocked_items ?? []).map((item) => item.item_id));

  // The pages another takeoff already brought into the draft (or into the version a copy would start from).
  const pageProposal = readVersionId ? await buildTakeoffPageReplacementProposal({ supabase: ctx.supabase, tenantId: ctx.tenantId,
    userId: ctx.userId, jobId: job.id, versionId: readVersionId, mappingPreview: preview,
    applyRequest: parseApplyTakeoffPayload({ strategy: "append", target_section_id: sectionId }) }) : null;
  const pageNewLines = new Set((pageProposal?.pages ?? []).flatMap((page) => page.new_line_ids));
  const pageLineIds = new Set((pageProposal?.pages ?? []).flatMap((page) => page.lines.map((line) => line.id)));

  // Earlier takeoff lines of the same item in the chosen section receive the new part (plan A then plan B), on both
  // engines; the outcome of the dry run says what the send really does with each of them.
  const engine = destination?.kind === "existing_draft"
    ? await (async () => {
      const { data } = await service.from("estimate_versions").select("calc_engine_version").eq("id", destination.version_id).maybeSingle();
      return data?.calc_engine_version ?? null;
    })() : policy?.engine ?? null;
  const sectionLines: TakeoffSendSectionLine[] = sectionId ? draftItems.filter((item) => item.item_type === "line" && item.parent_id === sectionId)
    .map((item) => ({ ...item, quantity: Number(item.quantity ?? 0) })) : [];
  const sourceIds = [...new Set(sectionLines.flatMap((line) => {
    const metadata = line.source_metadata as Record<string, unknown> | null;
    return [metadata?.takeoff_item_id, ...(Array.isArray((metadata?.takeoff_contributions as { item_ids?: unknown } | undefined)?.item_ids)
      ? (metadata!.takeoff_contributions as { item_ids: unknown[] }).item_ids : [])].filter((id): id is string => typeof id === "string");
  }))];
  const sourceQuantities = new Map<string, number>();
  if (sourceIds.length > 0) {
    const { data, error } = await readAllRowsInChunks(sourceIds, (chunk) => service.from("takeoff_items")
      .select("id, quantity", { count: "exact" }).eq("tenant_id", ctx.tenantId).in("id", chunk));
    if (error) failed(error as { message?: string }, "Impossible de lire les métrés déjà au devis.", job.id);
    for (const row of (data ?? []) as Array<{ id: string; quantity: number | string }>) sourceQuantities.set(row.id, Number(row.quantity));
  }
  const accumulations = proposeTakeoffSendAccumulations({ sectionLines, sourceQuantities, pageLineIds,
    sent: sentItems.map((item) => {
      const stored = byId.get(item.item_id);
      return { takeoff_item_id: item.item_id, designation: item.transformed.designation, unit: item.transformed.unit,
        quantity: item.transformed.quantity,
        accumulable: !!stored && stored.quantity_entry_category === null && takeoffHypothesisCause(stored) === null
          && !blockedIds.has(item.item_id) && !pageNewLines.has(item.item_id) };
    }) });

  const lines = sentItems.map((item) => {
    const stored = byId.get(item.item_id);
    const target = accumulations.get(item.item_id);
    return { takeoff_item_id: item.item_id, designation: item.transformed.designation, quantity: item.transformed.quantity,
      unit: item.transformed.unit, source_file_name: stored?.source_file_name ?? null, source_page: stored?.source_page ?? null,
      renamed_from: item.action === "rename" ? item.original.designation : null,
      target: target ? { kind: "existing_line" as const, estimate_item_id: target.id, title: target.title ?? "",
        quantity_before: target.quantity, quantity_after: target.quantity + sentItems.filter((other) => accumulations.get(other.item_id)?.id === target.id)
          .reduce((sum, other) => sum + other.transformed.quantity, 0) } : { kind: "new_line" as const } };
  });
  type Reservation = TakeoffSendPreviewResponse["reservations"][number];
  const reservations = sentItems.flatMap((item): Reservation[] => {
    const stored = byId.get(item.item_id);
    if (!stored) return [];
    const cause = takeoffHypothesisCause(stored);
    if (cause) return [{ takeoff_item_id: item.item_id, designation: item.transformed.designation, kind: cause }];
    if (stored.quantity_entry_category) return [{ takeoff_item_id: item.item_id, designation: item.transformed.designation, kind: "entered" as const }];
    return (guard?.medium_items ?? []).some((medium) => medium.item_id === item.item_id)
      ? [{ takeoff_item_id: item.item_id, designation: item.transformed.designation, kind: "to_review" as const }] : [];
  });

  const sameLaunch = destination?.kind === "existing_draft" && job.plan_set_id ? await (async () => {
    const { data } = await service.from("takeoff_jobs").select("id").eq("tenant_id", ctx.tenantId)
      .eq("estimate_version_id", destination.version_id).eq("plan_set_id", job.plan_set_id!).eq("level", job.level as never)
      .eq("preparation_snapshot->>preparation_revision" as never, (job.preparation_revision ?? "") as never).neq("id", job.id).limit(1);
    return (data ?? []).length > 0;
  })() : false;
  let blocker: TakeoffSendBlocker | null = !destination ? "choose_destination"
    : destination.kind === "version_copy" && (pageProposal?.pages.length ?? 0) > 0 ? "copy_pages_already_in_estimate"
      : sameLaunch ? "preparation_already_sent" : sentItems.length === 0 ? "no_line" : null;

  const sectionTitle = sectionChoice.kind === "existing" ? ordered.find((section) => section.id === sectionChoice.id)?.label ?? "" : newSectionTitle;
  const expectedVersions = [...versions].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((version) => ({ id: version.id, status: version.status, updated_at: version.updated_at }));
  const mappingPlan = buildTakeoffAtomicMappingPlan(preview.items);
  const ruleWrites = rules?.writes ?? [];
  const accumulationList = [...accumulations.entries()].map(([takeoffItemId, line]) => ({ takeoff_item_id: takeoffItemId,
    estimate_item_id: line.id, expected_updated_at: line.updated_at, expected_quantity: line.quantity }));
  const blockedItems = guard?.blocked_items ?? [];
  const pageDecisions = request.page_decisions ?? [];

  // The send as the database would write it: the first draft created as « Créer un devis » creates it (same engine and
  // settings), the section created with it or in the draft, everything the preview read and the state it read it from.
  let parts: StagedParts | null = null;
  if (!blocker && destination && rules?.jobStamp) {
    let staged: Record<string, unknown>;
    if (destination.kind === "first_draft") {
      const prepared = await prepareCanonicalEstimateCreation({ supabase: ctx.supabase, tenantId: ctx.tenantId, actorUserId: ctx.userId,
        project: { kind: "existing", id: job.project_id }, source: { kind: "blank", importId: null }, expectedCalcEngineVersion: engine });
      staged = { kind: "first_draft", version_payload: prepared.versionPayload };
    } else {
      staged = { ...destination };
    }
    parts = { destination: staged,
      section: sectionChoice.kind === "existing" ? sectionChoice : { kind: "new", id: randomUUID(), title: newSectionTitle },
      expected: { versions: expectedVersions, job_stamp: rules.jobStamp, peers_stamp: rules.peersStamp, mapping_stamp: mappingStamp },
      mapping_plan: mappingPlan, page_decisions: pageDecisions, rule_results: ruleWrites, rule_transforms: rules.transforms,
      accumulations: accumulationList, price_rules_ignored: priceRulesIgnored };
  }

  // The outcome: the send run and rolled back. It needs the member's decisions on the pages already in the estimate, and,
  // for lines the guard blocks, an administrator (whose override is checked again at the confirmation).
  let outcome: Record<string, unknown> | null = null;
  let outcomePending: TakeoffSendPreviewResponse["outcome_pending"] = null;
  if (parts) {
    if ((pageProposal?.pages.length ?? 0) > 0 && pageDecisions.length === 0) {
      outcomePending = "page_decisions";
    } else if (blockedItems.length > 0 && ctx.tenantRole !== TAKEOFF_TENANT_ADMIN_ROLE) {
      outcomePending = "blocked";
    } else {
      const run = await dryRunSend(ctx, job.id, parts, blockedItems.length > 0 ? dryRunOverride(blockedItems, guardItems, threshold) : null);
      if (run.error?.message === "TAKEOFF_SEND_DRAFT_LOCKED") blocker = "draft_locked";
      else if (run.error) throw mapSendTakeoffRpcError(run.error, job.id);
      else outcome = run.outcome;
    }
  }

  // The lines of the estimate as the send leaves them, each in its section by its title.
  const sourceSections = destination?.kind === "version_copy" ? (await readDraftItems(ctx, destination.source_version_id))
    .filter((item) => item.item_type === "section") : [];
  const sectionTitleOf = (ref: string | null) => {
    if (ref === null) return null;
    if (ref === "new") return newSectionTitle;
    const [kind, id] = ref.split(":");
    const found = (kind === "copy" ? sourceSections : draftItems).find((item) => item.id === id);
    return found?.title ?? null;
  };
  const estimateLines = outcome ? ((outcome.lines ?? []) as OutcomeLine[]).map((line) => ({ change: line.change,
    section_title: sectionTitleOf(line.section), title: line.title, unit: line.unit,
    quantity: Number(line.quantity), quantity_before: line.quantity_before === null ? null : Number(line.quantity_before),
    unit_price_ht_cents: line.unit_price_ht_cents, takeoff_item_ids: line.takeoff_item_ids })) : null;
  // Each control between takeoffs is said evaluated only when it ran for a line of this takeoff: a line with rule inputs
  // that no zone compares (a count of washbasins) is no evaluation of the duplicates nor of the coverage.
  const ran = (rule: string) => [...(rules?.results.values() ?? [])].some((results) => results.some((result) => result.rule === rule));
  const crossTakeoff = destination ? { duplicates: ran("zone_overlap") ? "evaluated" as const : "not_evaluated" as const,
    coverage: ran("zone_coverage") ? "evaluated" as const : "not_evaluated" as const } : null;
  const evaluated = crossTakeoff !== null && (crossTakeoff.duplicates === "evaluated" || crossTakeoff.coverage === "evaluated");

  // A first draft is created with the settings its preview was computed with (coefficients, rates, rounding, validity):
  // they are part of what is confirmed, and a change refuses the confirmation. Not its identifier, drawn for each run, nor
  // its date: the draft is dated the day it is created, as « Créer un devis » dates it, so that a confirmation after
  // midnight is not refused by the date alone.
  const draftSettings = parts?.destination.kind === "first_draft"
    ? firstDraftSettings(parts.destination.version_payload as Record<string, unknown>, policy) : null;
  const fingerprint = sha256({
    format_version: 3, job_id: job.id, destination, engine, draft_settings: draftSettings,
    section: sectionChoice.kind === "existing" ? sectionChoice : { kind: "new", title: newSectionTitle },
    expected: { versions: expectedVersions, job_stamp: rules?.jobStamp ?? null, peers_stamp: rules?.peersStamp ?? null, mapping_stamp: mappingStamp },
    mapping_plan: mappingPlan, rules: ruleWrites.map((write) => [write.id, write.results]), transforms: rules?.transforms ?? [],
    accumulations: accumulationList, page_proposal: pageProposal, page_decisions: pageDecisions,
    blocked: blockedItems.map((item) => [item.item_id, item.reasons]),
    price_rules_ignored: priceRulesIgnored.map((rule) => [rule.takeoff_item_id, rule.action]), blocker, outcome, outcome_pending: outcomePending,
  });

  const response: TakeoffSendPreviewResponse = {
    job_id: job.id, fingerprint, destinations,
    destination: destination ?? null, destination_label: option?.label ?? null,
    section: destination ? (sectionChoice.kind === "existing" ? { kind: "existing", id: sectionChoice.id, title: sectionTitle }
      : { kind: "new", title: newSectionTitle }) : null,
    section_options: destination?.kind === "existing_draft" ? ordered : [],
    new_section_title: newSectionTitle,
    blocked: blocker ? { reason: blocker, message: BLOCKER_MESSAGES[blocker] } : null,
    engine,
    lines, left_out: leftOut, price_rules_ignored: priceRulesIgnored, reservations,
    estimate_lines: estimateLines, outcome_pending: outcomePending,
    controls: { evaluated_for: destination && evaluated ? destination.kind : null,
      not_evaluated_reason: destination && !evaluated ? "no_rule_inputs" : null, cross_takeoff: crossTakeoff,
      blocked_items: blockedItems.map((item) => ({ item_id: item.item_id, designation: item.designation, confidence: item.confidence,
        is_verified: item.is_verified, reasons: item.reasons, ...(item.rule_failures ? { rule_failures: item.rule_failures.map((failure) => ({
          rule: failure.rule, code: failure.code, reason: failure.reason, acceptable: failure.acceptable })) } : {}) })),
      medium_items: (guard?.medium_items ?? []).map((item) => ({ item_id: item.item_id, designation: item.designation,
        confidence: item.confidence, ...(item.rule_failures ? { rule_failures: item.rule_failures.map((failure) => ({ rule: failure.rule,
          code: failure.code, reason: failure.reason, acceptable: failure.acceptable })) } : {}),
        ...(item.source_page !== undefined ? { source_page: item.source_page } : {}),
        ...(item.source_file_name !== undefined ? { source_file_name: item.source_file_name } : {}) })),
      threshold },
    page_proposal: pageProposal,
    impact: { sent_count: sentItems.length, accumulated_count: accumulations.size,
      version_created: destination?.kind === "first_draft" || destination?.kind === "version_copy",
      section_created: sectionChoice.kind === "new" },
  };
  if (blocker || !destination || !parts || !outcome) return { response, command: null };
  return { response, command: { ...parts, target: destination, outcome, blocked_items: blockedItems, guard_items: guardItems, threshold,
    engine } };
}

/**
 * The settings a first draft is stored with, read as persist_estimate_creation_atomic stores them: those its payload names,
 * and those it leaves to the creation — the engine 3 sale coefficients of the tenant's policy (1.30 and 1.20 without
 * one), the principal contractor role. Not its identifier nor its date.
 */
function firstDraftSettings(payload: Record<string, unknown>, policy: TenantCalcPolicy | null) {
  const settings = Object.fromEntries(Object.entries(payload).filter(([key]) => key !== "id" && key !== "date_devis"));
  if (usesSaleCoefficients(requireEstimateEngineVersion(payload))) {
    settings.sale_coefficient_fo = payload.sale_coefficient_fo ?? policy?.defaultSaleCoefficientFo
      ?? ABSENT_TENANT_CALC_POLICY.defaultSaleCoefficientFo;
    settings.sale_coefficient_mo = payload.sale_coefficient_mo ?? policy?.defaultSaleCoefficientMo
      ?? ABSENT_TENANT_CALC_POLICY.defaultSaleCoefficientMo;
  }
  settings.contractor_role = typeof payload.contractor_role === "string" && payload.contractor_role.trim()
    ? payload.contractor_role.trim() : "principal";
  return settings;
}

async function contextOf(): Promise<Context> {
  const context = await getAuthenticatedTakeoffContext();
  return { ...context, tenantRole: context.tenantRole ?? "" } as Context;
}

/** POST /api/takeoff/jobs/[jobId]/send-to-estimate/preview: the destination and the outcome of sending this takeoff; writes nothing. */
export async function previewTakeoffSend(jobId: string, body: unknown): Promise<TakeoffSendPreviewResponse> {
  const ctx = await contextOf();
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const request = parseWithSchema(takeoffSendPreviewRequestSchema, body ?? {}, "Aperçu d’envoi invalide.");
  const job = await readSendJob(ctx, normalizedJobId);
  return (await computeSendPreview(ctx, job, request)).response;
}

const STALE_MESSAGES: Record<string, string> = {
  destination_changed: "Une version de devis a été créée ou modifiée depuis l’aperçu : vérifiez la destination proposée puis confirmez.",
  takeoff_changed: "Le métré a été modifié depuis l’aperçu (une ligne, une preuve ou un repère) : vérifiez le nouvel aperçu puis confirmez.",
  estimate_changed: "Le devis ou les métrés qu’il porte ont changé depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
  rules_changed: "Les contrôles du métré ont changé depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
  mapping_changed: "Les règles de correspondance ont changé depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
  accumulation_changed: "Une ligne du devis qui devait recevoir ce métré a changé : vérifiez le nouvel aperçu puis confirmez.",
  outcome_changed: "Les lignes que l’envoi écrirait ne sont plus celles de l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
};

function staleError(reason: string | null, jobId: string) {
  return new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId,
    message: STALE_MESSAGES[reason ?? ""]
      ?? "Le métré ou le devis a changé depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez. Rien n’a été écrit.",
    details: { guard: "send_preview_stale", reason } });
}

function detailReason(details: string | null | undefined) {
  try {
    const parsed = JSON.parse(details ?? "") as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}

function busyError(jobId: string) {
  return new TakeoffError({ status: 503, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId,
    message: "Le devis est en cours de modification : réessayez dans un instant.", details: { guard: "send_estimate_busy" } });
}

export function mapSendTakeoffRpcError(error: ApplyTakeoffRpcError, jobId: string): TakeoffError {
  const conflict = (message: string, guard: string, retryable = false) => new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
    message, details: { guard }, retryable, jobId });
  switch (error.message) {
    case "TAKEOFF_SEND_PREVIEW_STALE": return staleError(detailReason(error.details), jobId);
    case "ESTIMATE_CALC_POLICY_CONTEXT_CHANGED": return staleError("destination_changed", jobId);
    case "TAKEOFF_SEND_ALREADY_SENT": return conflict(BLOCKER_MESSAGES.already_sent, "send_already_sent");
    case "TAKEOFF_SEND_JOB_NOT_READY": return conflict(BLOCKER_MESSAGES.not_completed, "send_not_ready");
    case "TAKEOFF_SEND_DRAFT_LOCKED": return conflict(BLOCKER_MESSAGES.draft_locked, "send_draft_locked", true);
    case "TAKEOFF_SEND_REQUEST_CONFLICT":
      return conflict("Cette confirmation a déjà servi à un autre envoi : rouvrez l’aperçu puis confirmez.", "send_request_conflict");
    case "TAKEOFF_SEND_RECEIPT_NOT_READABLE":
      return new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId,
        message: "Cet envoi n’est plus accessible : l’affaire a changé de responsable.", details: { guard: "send_receipt_not_readable" } });
    case "TAKEOFF_SEND_PROJECT_NOT_WRITABLE":
      return new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId,
        message: "Seul le propriétaire de l’affaire ou un administrateur envoie ce métré.", details: { guard: "send_project_not_writable" } });
    case "TAKEOFF_SEND_DPGF_RECONCILIATION_REQUIRED":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId,
        message: BLOCKER_MESSAGES.dpgf_reconciliation_required, details: { guard: "send_dpgf_reconciliation_required" } });
    case "TAKEOFF_SEND_COMMAND_INVALID":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false, jobId,
        message: "Envoi au tableau de chiffrage invalide.", details: { guard: "send_command_invalid" } });
    case "TAKEOFF_SEND_BUSY": return busyError(jobId);
    case "TAKEOFF_SEND_PREPARATION_ALREADY_SENT":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId,
        message: BLOCKER_MESSAGES.preparation_already_sent, details: { guard: "send_preparation_already_sent" } });
    default:
      // A lock the send needs stayed held past its short wait (the estimate being saved, another send of it), or two
      // writes crossed: nothing was written, the same request can be tried again.
      if (error.code === "55P03" || error.code === "40P01") return busyError(jobId);
      return mapApplyTakeoffRpcError(error, { jobId });
  }
}

/** The override as the audit stores it, bound to the state of each blocked line as evaluated for the destination. */
function overrideFromForced(blocked: readonly GuardBlockedItem[], forced: ForcedEntry[],
  guardItems: Awaited<ReturnType<typeof listTakeoffApplyGuardItems>>, threshold: number) {
  const states = new Map(guardItems.map((item) => [item.id, item.override_state]));
  const metadata = takeoffAuditMetadataBuilders["takeoff.apply.override"]({ estimate_version_id: "00000000-0000-4000-8000-000000000000",
    threshold, blocked_item_ids: blocked.map((item) => item.item_id), blocked_items_count: blocked.length,
    blocked_items_state: blocked.flatMap((item) => { const state = states.get(item.item_id); return state ? [state] : []; }),
    ...packForcedItems(forced) });
  // The send command binds the audit to the version it creates or chooses (metadata.estimate_version_id included).
  return Object.fromEntries(Object.entries(metadata as Record<string, unknown>).filter(([key]) => key !== "estimate_version_id"));
}

/** An administrator's override of the blocked lines, each line's coded reason checked against the line as evaluated. */
function overrideMetadata(blocked: readonly GuardBlockedItem[], payload: { forced_items?: Array<{ item_id: string;
  reason_code: string; false_positive_rules?: string[]; justification_index: number }>; forced_justifications?: string[] },
  guardItems: Awaited<ReturnType<typeof listTakeoffApplyGuardItems>>, threshold: number, jobId: string) {
  const entries = new Map((payload.forced_items ?? []).map((entry) => [entry.item_id.toLowerCase(), entry]));
  const forced: ForcedEntry[] = [];
  const missing_item_ids: string[] = [];
  const invalid_items: Array<{ item_id: string; error: string }> = [];
  for (const line of blocked) {
    const entry = entries.get(line.item_id.toLowerCase());
    if (!entry) { missing_item_ids.push(line.item_id); continue; }
    const error = forcedItemError(line, entry as never, payload.forced_justifications ?? []);
    if (error) { invalid_items.push({ item_id: line.item_id, error }); continue; }
    forced.push({ item_id: line.item_id, reason_code: entry.reason_code as ForcedEntry["reason_code"],
      false_positive_rules: entry.false_positive_rules as ForcedEntry["false_positive_rules"],
      justification: (payload.forced_justifications ?? [])[entry.justification_index] });
  }
  if (missing_item_ids.length > 0 || invalid_items.length > 0) {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, message: FORCE_MESSAGES.overrideReasons,
      details: { guard: "override_reasons", missing_item_ids, invalid_items }, retryable: false, jobId });
  }
  return overrideFromForced(blocked, forced, guardItems, threshold);
}

type ReceiptRow = { id: string; job_id: string; project_id: string; request_id: string; target_version_id: string;
  result: Record<string, unknown>; replayed?: boolean;
  /** What the send and a replay say of what follows the commit: the format that ran (1: the previous application's), */
  command_format?: number;
  /** whether the server completed it (« unrecorded »: a receipt from before that record), */
  effects?: "pending" | "completed" | "unrecorded";
  /** whether a first draft's defaults were recorded as done (they are, as soon as they succeed), */
  defaults?: "pending" | "completed" | "unrecorded";
  /** and the affaire's owner at the send (none for a receipt from before that record). */
  affaire_owner_id?: string | null };

function responseOf(receipt: ReceiptRow, replayed: boolean): TakeoffSendResponse {
  const result = receipt.result as { version_created?: boolean; created_count?: number; updated_count?: number; removed_count?: number;
    ignored_count?: number; lines_created?: string[]; lines_changed?: string[]; lines_removed?: Array<{ id: string }>;
    sections_changed?: string[] };
  return { job_id: receipt.job_id, receipt_id: receipt.id, request_id: receipt.request_id, replayed,
    version_id: receipt.target_version_id, version_created: result.version_created === true,
    created_count: result.created_count ?? 0, updated_count: result.updated_count ?? 0, removed_count: result.removed_count ?? 0,
    ignored_count: result.ignored_count ?? 0, lines_created: result.lines_created ?? [], lines_updated: result.lines_changed ?? [],
    lines_removed: (result.lines_removed ?? []).map((line) => line.id), sections_changed: result.sections_changed ?? [] };
}

/**
 * What follows the commit of a send, done by the attempt that committed it and, while it is not recorded as completed, by
 * a replay of its request (a process stopped between the commit and these effects leaves them to the next attempt):
 * - a first draft gets the default categories and labour roles « Créer un devis » gives it, for the affaire's owner at the
 *   send (upserted on their names), recorded as done as soon as they are: a replay never creates them again, even while
 *   the rest is pending (a default renamed since stays renamed; only a stop between those upserts and that record leaves
 *   them to be created again);
 * - then the other takeoffs of the draft, which have a new peer, have their rules computed again (their stale state blocks
 *   them meanwhile). Only a recomputation that wrote every line it read completes the effects; otherwise they stay pending
 *   for the next replay;
 * - then the server records them completed — which, for a command of format 1 whose server did not write the
 *   application's audit row, writes it (public.complete_takeoff_send_effects).
 * Only a member who may still send to the affaire does any of it: the operator rule of the send, on the membership, the
 * tenant and the affaire as the database holds them now (not as the request read them). Any other reader of the receipt
 * gets the receipt and nothing else.
 */
async function afterCommit(ctx: Context, receipt: ReceiptRow) {
  if (receipt.effects === "completed") return;
  const service = createServiceRoleClient();
  const [projectRead, membershipRead, tenantRead] = await Promise.all([
    service.from("estimate_projects").select("user_id, is_archived").eq("tenant_id", ctx.tenantId).eq("id", receipt.project_id)
      .maybeSingle(),
    service.from("tenant_memberships").select("role").eq("tenant_id", ctx.tenantId).eq("user_id", ctx.userId).maybeSingle(),
    service.from("tenants").select("is_active").eq("id", ctx.tenantId).maybeSingle(),
  ]);
  const readError = projectRead.error ?? membershipRead.error ?? tenantRead.error;
  if (readError) failed(readError, "Impossible de vérifier les droits sur l’affaire du métré.", receipt.job_id);
  const project = projectRead.data as { user_id: string; is_archived: boolean } | null;
  const role = (membershipRead.data as { role: string } | null)?.role ?? null;
  const maySend = (tenantRead.data as { is_active: boolean } | null)?.is_active === true && !!project && !project.is_archived
    && (role === TAKEOFF_TENANT_ADMIN_ROLE || (role === "engineer" && project.user_id === ctx.userId));
  if (!maySend) return;

  const complete = async (step: "defaults" | "all") => {
    const { error } = await service.rpc("complete_takeoff_send_effects" as never, { p_receipt_id: receipt.id, p_step: step } as never);
    if (error) {
      console.error("takeoff.send.effects_completion_failed", { job_id: receipt.job_id, step,
        code: (error as { code?: string }).code ?? null });
    }
    return !error;
  };
  const result = receipt.result as { version_created?: boolean; source_version_id?: string | null };
  // A receipt from before the record names no owner at the send: its defaults are not guessed from today's owner.
  if (result.version_created === true && !result.source_version_id && receipt.affaire_owner_id && receipt.defaults !== "completed") {
    try {
      await ensureDefaultEstimateCategories({ supabase: ctx.supabase, tenantId: ctx.tenantId, userId: ctx.userId });
      await ensureDefaultLaborRoles({ supabase: ctx.supabase, tenantId: ctx.tenantId, ownerUserId: receipt.affaire_owner_id });
    } catch (defaultsError) {
      // Left pending: the next replay of the request does them again.
      console.error("takeoff.send.defaults_failed", { job_id: receipt.job_id,
        message: defaultsError instanceof Error ? defaultsError.message.slice(0, 300) : "unknown" });
      return;
    }
    if (!await complete("defaults")) return;
  }
  const recomputed = await recomputeTakeoffRulesQuietly({ tenantId: ctx.tenantId, estimateVersionId: receipt.target_version_id,
    context: "applied" });
  if (!recomputed || recomputed.skipped > 0) {
    console.error("takeoff.send.rules_pending", { job_id: receipt.job_id, skipped: recomputed?.skipped ?? null });
    return;
  }
  await complete("all");
}

/**
 * POST /api/takeoff/jobs/[jobId]/send-to-estimate: sends what the preview showed. A replay of the same request returns its receipt
 * (a timeout after commit never creates a second version nor applies twice); a preview the state no longer matches is
 * refused with 409 and computed again by the screen.
 */
export async function sendTakeoffJob(jobId: string, body: unknown): Promise<TakeoffSendResponse> {
  const ctx = await contextOf();
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const payload = parseWithSchema(takeoffSendRequestSchema, body, "Envoi au tableau de chiffrage invalide.");

  // What the user confirmed, and only that: a replay with the same inputs returns the receipt, the same request with
  // other inputs is a conflict (public.send_takeoff_job compares it with the receipt's).
  const client = { fingerprint: payload.fingerprint, destination: payload.destination, section: payload.section,
    page_decisions: payload.page_decisions, override: payload.override === true,
    forced_justifications: payload.forced_justifications ?? null, forced_items: payload.forced_items ?? null };
  const request = { request_id: payload.request_id, job_id: normalizedJobId, fingerprint: payload.fingerprint };
  const send = async (command: Record<string, unknown>) => {
    const { error: stageError } = await createServiceRoleClient().rpc("stage_takeoff_send" as never,
      { p_actor_id: ctx.userId, p_command: { ...request, ...command, client } as unknown as Json } as never);
    if (stageError) throw mapSendTakeoffRpcError(stageError, normalizedJobId);
    return ctx.supabase.rpc("send_takeoff_job" as never, { p_request: request as unknown as Json } as never);
  };

  const committed = async () => {
    const { data: existing, error: existingError } = await ctx.supabase.from("takeoff_send_receipts" as never)
      .select("id" as never).eq("tenant_id" as never, ctx.tenantId as never)
      .eq("request_id" as never, payload.request_id as never).maybeSingle();
    if (existingError) failed(existingError, "Impossible de vérifier l’envoi déjà confirmé.", normalizedJobId);
    return existing !== null;
  };
  // Committed already (a timeout after commit): the command compares this confirmation with the receipt's, and what
  // follows the commit is done again (an attempt stopped after its commit left it undone).
  const replay = async () => {
    const { data, error } = await send({});
    if (error) throw mapSendTakeoffRpcError(error, normalizedJobId);
    const receipt = data as unknown as ReceiptRow;
    await afterCommit(ctx, receipt);
    return responseOf(receipt, true);
  };
  if (await committed()) return replay();

  const job = await readSendJob(ctx, normalizedJobId);
  const computed = await previewOrReplay({ committed, replay,
    preview: () => computeSendPreview(ctx, job, { destination: payload.destination, section: payload.section,
      page_decisions: payload.page_decisions }),
    settled: ({ response, command }) => response.fingerprint === payload.fingerprint && !response.blocked && command !== null });
  if ("replayed" in computed) return computed.replayed;
  const { response, command } = computed.preview;
  if (response.fingerprint !== payload.fingerprint) throw staleError(null, normalizedJobId);
  if (response.outcome_pending === "page_decisions") {
    throw new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false, jobId: normalizedJobId,
      message: "Décidez d’abord des pages déjà au devis : l’envoi en dépend.", details: { guard: "send_page_decisions_required" } });
  }
  if (response.blocked || !command) {
    if (!response.blocked && response.outcome_pending === "blocked") {
      throw new TakeoffError({ code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, status: 422, retryable: false, jobId: normalizedJobId,
        details: { blocked_items: response.controls.blocked_items, threshold: response.controls.threshold } });
    }
    throw new TakeoffError({ status: response.blocked?.reason === "already_sent" ? 409 : 422,
      code: response.blocked?.reason === "already_sent" ? TakeoffErrorCode.CONFLICT : TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message: response.blocked?.message ?? BLOCKER_MESSAGES.no_line, details: { guard: `send_${response.blocked?.reason ?? "blocked"}` },
      retryable: false, jobId: normalizedJobId });
  }
  if (command.blocked_items.length > 0 && payload.override !== true) {
    throw new TakeoffError({ code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, status: 422, retryable: false, jobId: normalizedJobId,
      details: { blocked_items: response.controls.blocked_items, threshold: command.threshold } });
  }
  if (payload.override === true && ctx.tenantRole !== TAKEOFF_TENANT_ADMIN_ROLE) {
    throw forbidden("Seul un administrateur peut forcer l'application des lignes bloquées.");
  }
  const override = payload.override === true
    ? overrideMetadata(command.blocked_items, payload, command.guard_items, command.threshold, normalizedJobId) : null;

  // The server stages what it computed (the rules evaluated for the destination, the plan, the outcome the member saw)
  // and the user's session sends it: the command never takes them from the browser.
  const { data, error } = await send({ format_version: SEND_COMMAND_FORMAT, mode: "send", destination: command.destination,
    section: command.section,
    expected: command.expected, mapping_plan: command.mapping_plan, page_decisions: command.page_decisions,
    rule_results: command.rule_results, rule_transforms: command.rule_transforms, accumulations: command.accumulations,
    override, price_rules_ignored: command.price_rules_ignored, expected_outcome: command.outcome });
  if (error) throw mapSendTakeoffRpcError(error, normalizedJobId);
  const receipt = data as unknown as ReceiptRow;
  // After commit, never before (a refused confirmation leaves no default category nor role), and again by a replay: the
  // same request committed by an attempt in flight, or stopped after its commit, is answered with its receipt.
  await afterCommit(ctx, receipt);
  return responseOf(receipt, receipt.replayed === true);
}
