import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { prepareCanonicalEstimateCreation } from "@/lib/estimates/canonical-v2-creation";
import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { ensureDefaultEstimateCategories, ensureDefaultLaborRoles } from "@/lib/estimates/version-creation-repository";
import { forbidden, mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { buildTakeoffAtomicMappingPlan } from "@/lib/takeoff/apply-preparation";
import { listTakeoffApplyGuardItems, listTakeoffRulePartnerExclusions, logTakeoffMappingApplyAuditEvents } from "@/lib/takeoff/apply-repository";
import { mapApplyTakeoffRpcError, type ApplyTakeoffRpcError } from "@/lib/takeoff/apply-errors";
import { logTakeoffAuditEvent, takeoffAuditMetadataBuilders } from "@/lib/takeoff/audit";
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
// preview reads and computes; it writes nothing. The confirmation computes the same preview again, refuses it when its
// fingerprint differs from the one the user confirmed, and hands the database what it computed with the state it
// computed it from (public.send_takeoff_job), which reads that state again under its locks.

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
};

const PRICE_ACTIONS = new Set(["set_price", "apply_assembly"]);

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
  plan_set_id: string | null; execution_provider: string | null; preparation_revision: string | null };

async function readSendJob(ctx: Context, jobId: string): Promise<SendJob> {
  const { data, error } = await ctx.supabase.from("takeoff_jobs" as never)
    .select("id, project_id, estimate_version_id, status, level, plan_set_id, execution_provider, preparation_revision:preparation_snapshot->>preparation_revision" as never)
    .eq("tenant_id" as never, ctx.tenantId as never).eq("id" as never, jobId as never).maybeSingle();
  if (error) failed(error, "Impossible de charger le métré.", jobId);
  if (!data) {
    throw new TakeoffError({ status: 404, code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND, message: "Job takeoff introuvable.",
      details: { job_id: jobId }, retryable: false, jobId });
  }
  return data as unknown as SendJob;
}

async function readVersions(service: Service, tenantId: string, projectId: string): Promise<TakeoffSendVersion[]> {
  const { data, error } = await service.from("estimate_versions")
    .select("id, version_number, status, title, variant_label, updated_at")
    .eq("tenant_id", tenantId).eq("project_id", projectId);
  if (error) failed(error, "Impossible de lire les versions de l’affaire.");
  const versions = (data ?? []) as Array<Omit<TakeoffSendVersion, "holds_dpgf_lines">>;
  const dpgf = versions.length ? await service.from("estimate_items").select("version_id").eq("tenant_id", tenantId)
    .in("version_id", versions.map((version) => version.id)).eq("item_type", "line").eq("source_provider", "dpgf") : { data: [], error: null };
  if (dpgf.error) failed(dpgf.error, "Impossible de lire les lignes DPGF de l’affaire.");
  const withDpgf = new Set(((dpgf.data ?? []) as Array<{ version_id: string }>).map((row) => row.version_id));
  return versions.map((version) => ({ ...version, holds_dpgf_lines: withDpgf.has(version.id) }));
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

type Computed = {
  response: TakeoffSendPreviewResponse;
  /** What the confirmation hands the database; null when the preview blocks. */
  command: {
    destination: TakeoffSendDestination;
    section: { kind: "new"; title: string } | { kind: "existing"; id: string };
    expected: { versions: Array<{ id: string; status: string; updated_at: string }>; job_stamp: string; version_stamp: string | null };
    mapping_plan: ReturnType<typeof buildTakeoffAtomicMappingPlan>;
    rule_results: unknown[];
    rule_transforms: unknown[];
    accumulations: Array<{ takeoff_item_id: string; estimate_item_id: string; expected_updated_at: string; expected_quantity: number }>;
    expected_impact: { sent: number; accumulated: number };
    write_plan: Record<string, unknown>;
    blocked_items: GuardBlockedItem[];
    guard_items: Awaited<ReturnType<typeof listTakeoffApplyGuardItems>>;
    threshold: number;
    preview: TakeoffPreviewConversionResponse;
    engine: number | null;
  } | null;
};

async function computeSendPreview(ctx: Context, job: SendJob, request: {
  destination?: TakeoffSendDestination; section?: TakeoffSendSectionChoice;
}): Promise<Computed> {
  const service = createServiceRoleClient();
  const { data: project, error: projectError } = await service.from("estimate_projects")
    .select("id, name, user_id, is_archived").eq("tenant_id", ctx.tenantId).eq("id", job.project_id).maybeSingle();
  if (projectError || !project) failed(projectError, "Impossible de lire l’affaire du métré.", job.id);
  const canEdit = !project.is_archived && (ctx.tenantRole === TAKEOFF_TENANT_ADMIN_ROLE
    || (ctx.tenantRole === "engineer" && project.user_id === ctx.userId));

  // A takeoff that cannot be sent from here (already sent, not finished, or read by someone who cannot write the affaire)
  // gets its reason only: nothing of the affaire's versions nor of its estimates is read for it.
  const early: TakeoffSendBlocker | null = job.status === "applied" || job.estimate_version_id !== null ? "already_sent"
    : job.status !== "completed" ? "not_completed" : !canEdit ? "read_only" : null;
  if (early) {
    return { command: null, response: { job_id: job.id, fingerprint: sha256({ format_version: 1, job_id: job.id, blocker: early }),
      destinations: [], destination: null, destination_label: null, section: null, section_options: [],
      new_section_title: takeoffSendSectionTitle(null), blocked: { reason: early, message: BLOCKER_MESSAGES[early] }, engine: null,
      lines: [], left_out: [], price_rules_ignored: [], reservations: [],
      controls: { evaluated_for: null, blocked_items: [], medium_items: [], threshold: 0 }, page_proposal: null,
      impact: { sent_count: 0, accumulated_count: 0, version_created: false, section_created: false } } };
  }

  const versions = await readVersions(service, ctx.tenantId, job.project_id);
  const { options, preferred } = resolveTakeoffSendDestinations(versions);
  if (request.destination && !options.some((option) => sameTakeoffSendDestination(option.destination, request.destination))) {
    throw new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT, retryable: true, jobId: job.id,
      message: "Les versions de l’affaire ont changé depuis l’aperçu : vérifiez la destination proposée puis confirmez.",
      details: { guard: "send_preview_stale", reason: "destination_changed" } });
  }
  const destination = request.destination ?? preferred;
  const option = destination ? options.find((entry) => sameTakeoffSendDestination(entry.destination, destination)) ?? null : null;
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

  // The controls, evaluated for this destination: the takeoffs the draft holds and its DPGF lines; for a copy, those of
  // the version it copies (their lines are the copy's); none for a first draft. Nothing is shown as passed that was not
  // evaluated here.
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

  // Earlier takeoff lines of the same item in the chosen section receive the new part (plan A then plan B).
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
  const accumulations = proposeTakeoffSendAccumulations({ engine, sectionLines, sourceQuantities, pageLineIds,
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
  const blocker: TakeoffSendBlocker | null = !destination ? "choose_destination"
    : option?.blocked ?? (destination.kind === "version_copy" && (pageProposal?.pages.length ?? 0) > 0 ? "copy_pages_already_in_estimate"
      : sameLaunch ? "preparation_already_sent" : sentItems.length === 0 ? "no_line" : null);

  const sectionTitle = sectionChoice.kind === "existing" ? ordered.find((section) => section.id === sectionChoice.id)?.label ?? "" : newSectionTitle;
  const expectedVersions = [...versions].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
    .map((version) => ({ id: version.id, status: version.status, updated_at: version.updated_at }));
  const mappingPlan = buildTakeoffAtomicMappingPlan(preview.items);
  const ruleWrites = rules?.writes ?? [];
  const accumulationList = [...accumulations.entries()].map(([takeoffItemId, line]) => ({ takeoff_item_id: takeoffItemId,
    estimate_item_id: line.id, expected_updated_at: line.updated_at, expected_quantity: line.quantity }));
  const blockedItems = guard?.blocked_items ?? [];

  const fingerprint = sha256({
    format_version: 1, job_id: job.id, destination, engine, section: sectionChoice.kind === "existing" ? sectionChoice : { kind: "new", title: newSectionTitle },
    expected: { versions: expectedVersions, job_stamp: rules?.jobStamp ?? null, version_stamp: rules?.versionStamp ?? null },
    mapping_plan: mappingPlan, rules: ruleWrites.map((write) => [write.id, write.results]), transforms: rules?.transforms ?? [],
    accumulations: accumulationList, page_proposal: pageProposal, blocked: blockedItems.map((item) => [item.item_id, item.reasons]),
    price_rules_ignored: priceRulesIgnored.map((rule) => [rule.takeoff_item_id, rule.action]), blocker,
  });

  const response: TakeoffSendPreviewResponse = {
    job_id: job.id, fingerprint,
    destinations: options.map((entry) => ({ destination: entry.destination, label: entry.label, blocked: entry.blocked })),
    destination: destination ?? null, destination_label: option?.label ?? null,
    section: destination ? (sectionChoice.kind === "existing" ? { kind: "existing", id: sectionChoice.id, title: sectionTitle }
      : { kind: "new", title: newSectionTitle }) : null,
    section_options: destination?.kind === "existing_draft" ? ordered : [],
    new_section_title: newSectionTitle,
    blocked: blocker ? { reason: blocker, message: BLOCKER_MESSAGES[blocker] } : null,
    engine,
    lines, left_out: leftOut, price_rules_ignored: priceRulesIgnored, reservations,
    controls: { evaluated_for: destination?.kind ?? null,
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
  if (blocker || !destination || !rules?.jobStamp) return { response, command: null };
  return { response, command: {
    destination, section: sectionChoice.kind === "existing" ? sectionChoice : { kind: "new", title: newSectionTitle },
    expected: { versions: expectedVersions, job_stamp: rules.jobStamp, version_stamp: rules.versionStamp },
    mapping_plan: mappingPlan, rule_results: ruleWrites, rule_transforms: rules.transforms, accumulations: accumulationList,
    expected_impact: { sent: sentItems.length, accumulated: accumulations.size },
    write_plan: { format_version: 1, price_rules_ignored: priceRulesIgnored,
      parts: lines.map((line) => ({ takeoff_item_id: line.takeoff_item_id, designation: line.designation,
        item: null, target: line.target.kind === "existing_line"
          ? { kind: "existing_line", estimate_item_id: line.target.estimate_item_id, quantity_before: line.target.quantity_before }
          : { kind: "new_line" } })) },
    blocked_items: blockedItems, guard_items: guardItems, threshold, preview, engine,
  } };
}

async function contextOf(): Promise<Context> {
  const context = await getAuthenticatedTakeoffContext();
  return { ...context, tenantRole: context.tenantRole ?? "" } as Context;
}

/** POST /api/takeoff/jobs/[jobId]/send-to-estimate/preview: the destination and the impact of sending this takeoff; writes nothing. */
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
  estimate_changed: "Le devis a été modifié depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
  rules_changed: "Les contrôles du métré ont changé depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
  accumulation_changed: "Une ligne du devis qui devait recevoir ce métré a changé : vérifiez le nouvel aperçu puis confirmez.",
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

export function mapSendTakeoffRpcError(error: ApplyTakeoffRpcError, jobId: string): TakeoffError {
  const conflict = (message: string, guard: string, retryable = false) => new TakeoffError({ status: 409, code: TakeoffErrorCode.CONFLICT,
    message, details: { guard }, retryable, jobId });
  switch (error.message) {
    case "TAKEOFF_SEND_PREVIEW_STALE": return staleError(detailReason(error.details), jobId);
    case "ESTIMATE_CALC_POLICY_CONTEXT_CHANGED": return staleError("destination_changed", jobId);
    case "TAKEOFF_SEND_ALREADY_SENT": return conflict(BLOCKER_MESSAGES.already_sent, "send_already_sent");
    case "TAKEOFF_SEND_JOB_NOT_READY": return conflict(BLOCKER_MESSAGES.not_completed, "send_not_ready");
    case "TAKEOFF_SEND_REQUEST_CONFLICT":
      return conflict("Cette confirmation a déjà servi à un autre envoi : rouvrez l’aperçu puis confirmez.", "send_request_conflict");
    case "TAKEOFF_SEND_PROJECT_NOT_WRITABLE":
      return new TakeoffError({ status: 403, code: TakeoffErrorCode.FORBIDDEN, retryable: false, jobId,
        message: "Seul le propriétaire de l’affaire ou un administrateur envoie ce métré.", details: { guard: "send_project_not_writable" } });
    case "TAKEOFF_SEND_DPGF_RECONCILIATION_REQUIRED":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId,
        message: BLOCKER_MESSAGES.dpgf_reconciliation_required, details: { guard: "send_dpgf_reconciliation_required" } });
    case "TAKEOFF_SEND_COMMAND_INVALID":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.VALIDATION_ERROR, retryable: false, jobId,
        message: "Envoi au tableau de chiffrage invalide.", details: { guard: "send_command_invalid" } });
    case "TAKEOFF_SEND_PREPARATION_ALREADY_SENT":
      return new TakeoffError({ status: 422, code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED, retryable: false, jobId,
        message: BLOCKER_MESSAGES.preparation_already_sent, details: { guard: "send_preparation_already_sent" } });
    default: return mapApplyTakeoffRpcError(error, { jobId });
  }
}

/** An administrator's override of the blocked lines, each line's coded reason checked against the line as evaluated. */
function overrideMetadata(blocked: readonly GuardBlockedItem[], payload: { forced_items?: Array<{ item_id: string;
  reason_code: string; false_positive_rules?: string[]; justification_index: number }>; forced_justifications?: string[] },
  guardItems: Awaited<ReturnType<typeof listTakeoffApplyGuardItems>>, threshold: number, versionId: string, jobId: string) {
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
  const states = new Map(guardItems.map((item) => [item.id, item.override_state]));
  const metadata = takeoffAuditMetadataBuilders["takeoff.apply.override"]({ estimate_version_id: versionId, threshold,
    blocked_item_ids: blocked.map((item) => item.item_id), blocked_items_count: blocked.length,
    blocked_items_state: blocked.flatMap((item) => { const state = states.get(item.item_id); return state ? [state] : []; }),
    ...packForcedItems(forced) });
  // The send command binds the audit to the version it creates or chooses (metadata.estimate_version_id included).
  return Object.fromEntries(Object.entries(metadata as Record<string, unknown>).filter(([key]) => key !== "estimate_version_id"));
}

type ReceiptRow = { id: string; job_id: string; request_id: string; target_version_id: string; result: Record<string, unknown>;
  replayed?: boolean };

function responseOf(receipt: ReceiptRow, replayed: boolean): TakeoffSendResponse {
  const result = receipt.result as { version_created?: boolean; created_count?: number; updated_count?: number; ignored_count?: number;
    lines_created?: string[]; lines_updated?: string[]; sections_changed?: string[] };
  return { job_id: receipt.job_id, receipt_id: receipt.id, request_id: receipt.request_id, replayed,
    version_id: receipt.target_version_id, version_created: result.version_created === true,
    created_count: result.created_count ?? 0, updated_count: result.updated_count ?? 0, ignored_count: result.ignored_count ?? 0,
    lines_created: result.lines_created ?? [], lines_updated: result.lines_updated ?? [], sections_changed: result.sections_changed ?? [] };
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
  // Committed already (a timeout after commit): the command compares this confirmation with the receipt's.
  const replay = async () => {
    const { data, error } = await send({});
    if (error) throw mapSendTakeoffRpcError(error, normalizedJobId);
    return responseOf(data as unknown as ReceiptRow, true);
  };
  if (await committed()) return replay();

  const job = await readSendJob(ctx, normalizedJobId);
  const { response, command } = await computeSendPreview(ctx, job, { destination: payload.destination, section: payload.section });
  // A retry whose first attempt committed while this preview was computed reads a takeoff already sent: it gets the
  // receipt, never « rien n’a été écrit ».
  if ((response.fingerprint !== payload.fingerprint || response.blocked || !command) && await committed()) return replay();
  if (response.fingerprint !== payload.fingerprint) throw staleError(null, normalizedJobId);
  if (response.blocked || !command) {
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

  let destination: Record<string, unknown>;
  let knownVersionId: string;
  if (command.destination.kind === "first_draft") {
    // The first draft is the one « Créer un devis » creates: same defaults, same engine and settings.
    const { data: project } = await createServiceRoleClient().from("estimate_projects").select("user_id").eq("id", job.project_id).single();
    await ensureDefaultEstimateCategories({ supabase: ctx.supabase, tenantId: ctx.tenantId, userId: ctx.userId });
    await ensureDefaultLaborRoles({ supabase: ctx.supabase, tenantId: ctx.tenantId, ownerUserId: project?.user_id ?? ctx.userId });
    const prepared = await prepareCanonicalEstimateCreation({ supabase: ctx.supabase, tenantId: ctx.tenantId, actorUserId: ctx.userId,
      project: { kind: "existing", id: job.project_id }, source: { kind: "blank", importId: null }, expectedCalcEngineVersion: command.engine });
    destination = { kind: "first_draft", version_payload: prepared.versionPayload };
    knownVersionId = String(prepared.versionPayload.id);
  } else if (command.destination.kind === "existing_draft") {
    destination = { kind: "existing_draft", version_id: command.destination.version_id };
    knownVersionId = command.destination.version_id;
  } else {
    destination = { kind: "version_copy", source_version_id: command.destination.source_version_id };
    knownVersionId = command.destination.source_version_id;
  }
  const section = command.section.kind === "existing" ? command.section
    : { kind: "new", id: randomUUID(), title: command.section.title };
  const override = payload.override === true
    ? overrideMetadata(command.blocked_items, payload, command.guard_items, command.threshold, knownVersionId, normalizedJobId) : null;

  // The server stages what it computed (the rules evaluated for the destination, the plan, the expected impact) and the
  // user's session sends it: the command never takes them from the browser.
  const { data, error } = await send({ format_version: 1, destination, section, expected: command.expected,
    mapping_plan: command.mapping_plan, page_decisions: payload.page_decisions, rule_results: command.rule_results,
    rule_transforms: command.rule_transforms, accumulations: command.accumulations, expected_impact: command.expected_impact,
    override, write_plan: command.write_plan });
  if (error) throw mapSendTakeoffRpcError(error, normalizedJobId);
  const receipt = data as unknown as ReceiptRow;
  // The same request committed by an attempt in flight: its own call wrote the audit and recomputed the rules.
  if (receipt.replayed === true) return responseOf(receipt, true);

  // After commit: the other takeoffs of the draft have a new peer; their rules are computed again (their stale state
  // blocks them meanwhile). A copy holds no other takeoff (those of the copied version stay on it): its rules, evaluated
  // against them by the send, are kept. The audit of the application, as « Envoyer au tableau de chiffrage » writes it.
  if (command.destination.kind !== "version_copy") {
    await recomputeTakeoffRulesQuietly({ tenantId: ctx.tenantId, estimateVersionId: receipt.target_version_id, context: "applied" });
  }
  await logTakeoffAuditEvent({ supabase: ctx.supabase, tenantId: ctx.tenantId, userId: ctx.userId, jobId: normalizedJobId,
    estimateVersionId: receipt.target_version_id, action: "takeoff.apply.completed",
    metadata: takeoffAuditMetadataBuilders["takeoff.apply.completed"]({ estimate_version_id: receipt.target_version_id,
      applied_items_count: Number((receipt.result as { created_count?: number }).created_count ?? 0)
        + Number((receipt.result as { updated_count?: number }).updated_count ?? 0),
      excluded_items_count: Number((receipt.result as { ignored_count?: number }).ignored_count ?? 0) }),
    mode: "non-blocking" });
  if (command.preview.items.some((item) => !item.original.is_excluded && item.action !== "none")) {
    const links = ((receipt.result as { item_links?: Array<{ takeoff_item_id: string; estimate_item_id: string }> }).item_links ?? []);
    try {
      await logTakeoffMappingApplyAuditEvents({ supabase: ctx.supabase, tenantId: ctx.tenantId, userId: ctx.userId, jobId: normalizedJobId,
        estimateVersionId: receipt.target_version_id, previewItems: command.preview.items,
        estimateLineByItemId: new Map(links.map((link) => [link.takeoff_item_id, link.estimate_item_id])) });
    } catch (auditError) {
      console.error("takeoff.send.mapping_audit_failed", { job_id: normalizedJobId,
        message: auditError instanceof Error ? auditError.message.slice(0, 300) : "unknown" });
    }
  }
  return responseOf(receipt, false);
}
