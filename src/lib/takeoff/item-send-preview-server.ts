import "server-only";

import { createHash } from "node:crypto";

import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { requireEstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
import { DEFAULT_MAX_SECTION_DEPTH } from "@/lib/estimates/hierarchy";
import { mapSupabaseError } from "@/lib/http/api-response";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { readDpgfMappedFacts } from "@/lib/takeoff/dpgf-comparison-repository";
import { readStoredDpgfComposition } from "@/lib/takeoff/dpgf-composition";
import { TakeoffError, TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import {
  itemSendPreviewRequestSchema,
  type ItemSendPreviewRequest,
  type ItemSendPreviewResponse,
} from "@/lib/takeoff/item-send-contracts";
import { readItemSendEarlierState, readItemSendFacts } from "@/lib/takeoff/item-send-facts-server";
import {
  itemSendEngineFits,
  planTakeoffItemSend,
  type ItemSendBlockerReason,
  type ItemSendBreakdown,
  type ItemSendChoice,
  type ItemSendDestinationState,
  type ItemSendDraftLine,
  type ItemSendLocationField,
  type ItemSendNotSentReason,
  type ItemSendOption,
  type ItemSendPlanLocation,
  type ItemSendToResolveKind,
} from "@/lib/takeoff/item-send-plan";
import { projectItemSendRules, type ItemSendRuleEffectKind } from "@/lib/takeoff/item-send-rules";
import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type { AnyTakeoffLaunchManifest, TakeoffPlanLaunchManifest } from "@/lib/takeoff/launch-request";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";
import { readPlanPagesAlreadyInEstimate } from "@/lib/takeoff/page-contributions-server";
import { readTakeoffJobPlanLocations } from "@/lib/takeoff/plan-location-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { resolveTakeoffSendDestinations, type TakeoffSendVersion } from "@/lib/takeoff/send-plan";
import { parseWithSchema, TAKEOFF_TENANT_ADMIN_ROLE } from "@/lib/takeoff/server-helpers";

// Lot 4, PR 5a: POST /api/takeoff/jobs/{jobId}/item-send/preview — what the send of one plan's answers by item would make
// of the estimate, read only: the first draft it would create, its sections, the lines it would create or feed, the
// quantities before and after, what it leaves out and why, and what the member must resolve first. It writes nothing:
// no version, no section, no line, no receipt, no staged command. Its confirmation (and the writer that checks every
// fact again under its locks) comes with a later pull request; the send of today's takeoffs is unchanged.

type Context = AuthenticatedTakeoffContext & { tenantRole: string };
type Service = ReturnType<typeof createServiceRoleClient>;

const BLOCKER_MESSAGES: Record<ItemSendBlockerReason, string> = {
  not_completed: "La lecture de ce plan doit être terminée pour que ses postes soient envoyés au devis.",
  already_sent: "Les postes de ce plan ont déjà été envoyés au devis.",
  read_only: "Ce métré est accessible en lecture seule.",
  choose_destination: "Plusieurs brouillons peuvent recevoir ces postes : choisissez la destination.",
  issued_only: "Les versions de cette affaire sont émises et restent intactes : créez un brouillon depuis le devis, puis revenez à "
    + "cet aperçu. Rien n’est écrit.",
  engine_not_v3: "Ce brouillon utilise un autre moteur de calcul que le moteur 3 : l’envoi par poste n’écrit que dans un devis du "
    + "moteur 3, sans conversion. Choisissez un brouillon du moteur 3 ; rien n’est écrit.",
  engine_policy_v2: "Les nouveaux devis de l’entreprise sont créés avec le moteur de calcul 2 : l’envoi par poste n’écrit que dans un "
    + "devis du moteur 3. Rien n’est écrit.",
  dpgf_import_required: "La liste des postes vient du DPGF, mais ce devis n’en contient aucune ligne : confirmez d’abord l’import du DPGF "
    + "depuis les documents de l’affaire, puis revenez à cet aperçu. Rien n’est importé ici.",
  no_line: "Aucun poste de ce plan n’est à envoyer : chacun est écarté, non trouvé ou à compléter.",
};

const NOT_SENT_MESSAGES: Record<ItemSendNotSentReason, string> = {
  set_aside: "Écarté dans le tableau des postes.",
  not_found: "Non trouvé sur ce plan : rien n’est envoyé, jamais zéro.",
  uncertain: "Incertain : à compléter par une saisie ou à remesurer.",
  empty: "Aucune quantité mesurée à envoyer.",
  unit_incompatible: "Unité ou base de mesure incompatible avec le poste.",
  hypothesis_not_included: "Hypothèse saisie, pas encore retenue par sa propre décision.",
  rule_skip: "Ignoré par une règle de correspondance.",
  affaire_entry: "Une quantité est saisie pour toute l’affaire : la mesure d’un plan ne s’y ajoute jamais.",
  no_answer: "Aucune réponse enregistrée pour ce poste sur ce plan.",
  left_out: "Laissé de côté par votre choix.",
  entry_suspended: "La quantité saisie est inférieure à la quantité retenue : la ligne n’est pas écrite tant qu’une décision ne la tranche pas.",
};

const TO_RESOLVE_MESSAGES: Record<ItemSendToResolveKind, string> = {
  review_required: "Ce poste porte une anomalie que personne n’a tranchée : acceptez-le dans le tableau des postes ou laissez-le de côté.",
  target_missing: "La ligne du devis de ce poste est introuvable (supprimée, déliée ou d’un import antérieur sans filiation prouvée) : "
    + "choisissez la ligne, ou laissez le poste de côté.",
  target_multiple: "Plusieurs lignes du devis viennent de la même ligne du DPGF : choisissez celle qui reçoit le métré.",
  unit_conflict: "L’unité de la ligne du devis diffère de celle de la mesure : la ligne n’est pas alimentée.",
  entered_quantity: "La quantité de cette ligne a été saisie à la main : conservez la saisie ou retenez la quantité du métré.",
  breakdown_mixed: "Ce poste est déjà envoyé dans ce devis avec un autre découpage : envoyez ce plan avec le même découpage.",
  page_decision: "Cette page est déjà au devis par une autre analyse : elle ne compte pas deux fois. Sa décision (remplacer ou garder "
    + "les deux) se prend à la confirmation ; d’ici là ses apports attendent.",
  section_depth: "La section de ce poste dépasse la profondeur des sections du devis : choisissez « Ensemble » ou laissez-le de côté.",
};

const RULE_MESSAGES: Record<ItemSendRuleEffectKind, string> = {
  none: "",
  renamed: "Renommé par une règle de correspondance pour la ligne créée.",
  categorized: "Catégorie donnée par une règle de correspondance à la ligne créée.",
  skipped: "Ignoré par une règle de correspondance.",
  price_ignored: "Règle « Fixer le prix » sans effet ici : les prix ne sont jamais modifiés par le métré.",
  assembly_indicated: "Règle « Remplacer par un ouvrage » : la quantité du poste est gardée, l’ouvrage n’est qu’indiqué.",
};

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function failed(error: { message?: string } | null, message: string, jobId: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

const conflict = (jobId: string, guard: string, message: string, retryable = false) => new TakeoffError({ status: 409,
  code: TakeoffErrorCode.CONFLICT, message, details: { guard }, retryable, jobId });

type PreviewJob = { id: string; project_id: string; estimate_version_id: string | null; status: string; launch_request_id: string | null;
  launch_unit_key: string | null };

async function readPreviewJob(ctx: Context, jobId: string): Promise<PreviewJob> {
  const { data, error } = await ctx.supabase.from("takeoff_jobs")
    .select("id, project_id, estimate_version_id, status, launch_request_id, launch_unit_key")
    .eq("tenant_id", ctx.tenantId).eq("id", jobId).maybeSingle();
  if (error) failed(error, "Impossible de charger le métré.", jobId);
  if (!data) {
    throw new TakeoffError({ status: 404, code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND, message: "Job takeoff introuvable.",
      details: { job_id: jobId }, retryable: false, jobId });
  }
  return data as PreviewJob;
}

/** The plan this job read and the list it was asked about, from its request's sealed manifest (lot 3 format 2, lot 4 order). */
async function readSealedOrder(service: Service, tenantId: string, job: PreviewJob) {
  const notItemList = () => conflict(job.id, "item_send_not_item_list", "Ce métré n’a pas été lu contre la liste des postes : "
    + "envoyez-le au tableau de chiffrage comme aujourd’hui.");
  if (!job.launch_request_id || !job.launch_unit_key) throw notItemList();
  const { data, error } = await service.from("takeoff_launch_requests").select("manifest")
    .eq("tenant_id", tenantId).eq("id", job.launch_request_id).maybeSingle();
  if (error) failed(error, "Impossible de lire la demande d’analyse du métré.", job.id);
  const manifest = (data?.manifest ?? null) as AnyTakeoffLaunchManifest | null;
  if (!manifest || manifest.format_version !== 2 || manifest.order?.kind !== "item_list") throw notItemList();
  const plans = manifest as TakeoffPlanLaunchManifest;
  const unit = plans.units.find((candidate) => candidate.key === job.launch_unit_key);
  const plan = unit ? plans.plans.find((candidate) => candidate.entry_key === unit.plans[0]) : undefined;
  if (!plan) {
    throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId: job.id,
      message: "La demande de ce métré ne décrit pas le plan qu’il a lu.", details: { guard: "item_send_unit_missing" } });
  }
  return { list: manifest.order.list, plan };
}

type PreviewVersion = TakeoffSendVersion & { calc_engine_version: number; max_section_depth: number };

async function readVersions(service: Service, tenantId: string, projectId: string, jobId: string): Promise<PreviewVersion[]> {
  const { data, error } = await readAllRows(() => service.from("estimate_versions")
    .select("id, version_number, status, title, variant_label, updated_at, calc_engine_version, max_section_depth", { count: "exact" })
    .eq("tenant_id", tenantId).eq("project_id", projectId));
  if (error) failed(error as { message?: string }, "Impossible de lire les versions de l’affaire.", jobId);
  const versions = (data ?? []) as Array<Omit<PreviewVersion, "holds_dpgf_lines">>;
  // One answer per version (does it hold a DPGF line?), as the send of today reads it.
  return Promise.all(versions.map(async (version) => {
    const { data: line, error: lineError } = await service.from("estimate_items").select("id").eq("tenant_id", tenantId)
      .eq("version_id", version.id).eq("item_type", "line").eq("source_provider", "dpgf").limit(1);
    if (lineError) failed(lineError, "Impossible de lire les lignes DPGF de l’affaire.", jobId);
    return { ...version, holds_dpgf_lines: (line ?? []).length > 0 };
  }));
}

type DraftRow = { id: string; parent_id: string | null; item_type: string; position: number | null; title: string | null;
  unit_code: string | null; pricing_status: string | null; quantity: number | string | null; updated_at: string; source_provider: string | null;
  mapped_row_id: string | null; import_id: string | null; dpgf_source_quantity: unknown; quantity_policy: unknown };

/** The draft's sections and lines, read with the member's session: only the columns the plan reads, never a price. */
async function readDraft(ctx: Context, projectId: string, versionId: string, jobId: string) {
  const { data, error } = await readAllRows(() => ctx.supabase.from("estimate_items")
    .select("id, parent_id, item_type, position, title, unit_code, pricing_status, quantity, updated_at, source_provider, "
      + "mapped_row_id:source_metadata->>mapped_row_id, import_id:source_metadata->>import_id, "
      + "dpgf_source_quantity:source_metadata->dpgf_source_quantity, quantity_policy:source_metadata->takeoff_quantity_policy",
    { count: "exact" })
    .eq("tenant_id", ctx.tenantId).eq("version_id", versionId), { pageSize: 1000 });
  if (error) failed(error as { message?: string }, "Impossible de lire le brouillon de devis.", jobId);
  const rows = (data ?? []) as unknown as DraftRow[];
  const dpgfRows = rows.filter((row) => row.item_type === "line" && row.source_provider === "dpgf");
  const mappedIds = [...new Set(dpgfRows.flatMap((row) => (row.mapped_row_id ? [row.mapped_row_id] : [])))];
  // The raw row of each DPGF line, proven by its mapped row of the same import of this affaire: a remapping renews the
  // mapped row, never the raw one.
  const lineage = new Map<string, { import_id: string; raw_row_id: string | null }>();
  if (mappedIds.length > 0) {
    const { data: mapped, error: mappedError } = await readAllRowsInChunks(mappedIds, (chunk) => ctx.supabase.from("dpgf_rows_mapped")
      .select("id, import_id, raw_row_id, dpgf_imports!inner(project_id)", { count: "exact" })
      .eq("tenant_id", ctx.tenantId).eq("dpgf_imports.project_id", projectId).in("id", chunk));
    if (mappedError) failed(mappedError as { message?: string }, "Impossible de lire la provenance des lignes du DPGF.", jobId);
    for (const row of (mapped ?? []) as Array<{ id: string; import_id: string; raw_row_id: string | null }>) lineage.set(row.id, row);
  }
  const facts = mappedIds.length > 0
    ? await readDpgfMappedFacts({ supabase: ctx.supabase, tenantId: ctx.tenantId, projectId, mappedIds }) : new Map();
  const sections = rows.filter((row) => row.item_type === "section").map((row) => ({ id: row.id, parentId: row.parent_id,
    position: row.position, title: row.title }));
  const lines: ItemSendDraftLine[] = rows.filter((row) => row.item_type === "line").map((row) => {
    const mapped = row.mapped_row_id ? lineage.get(row.mapped_row_id) : undefined;
    const importId = row.import_id ?? mapped?.import_id ?? null;
    const stated = typeof row.dpgf_source_quantity === "number" && Number.isFinite(row.dpgf_source_quantity) ? row.dpgf_source_quantity : null;
    return {
      id: row.id, parentId: row.parent_id, title: row.title, unitCode: row.unit_code, pricingStatus: row.pricing_status,
      quantity: Number(row.quantity ?? 0), updatedAt: row.updated_at,
      dpgf: row.source_provider === "dpgf" ? {
        importId,
        mappedRowId: row.mapped_row_id,
        // Proven only when the mapped row belongs to the import the line names.
        rawRowId: mapped && mapped.import_id === importId ? mapped.raw_row_id : null,
        reference: row.dpgf_source_quantity !== undefined && row.dpgf_source_quantity !== null ? stated
          : (row.mapped_row_id ? facts.get(row.mapped_row_id)?.quantity ?? null : null),
        composition: readStoredDpgfComposition({ takeoff_quantity_policy: row.quantity_policy }),
      } : null,
    };
  });
  return { sections, lines };
}

const LOCATION_STATES = new Set<ItemSendLocationField["state"]>(["proposed", "confirmed", "corrected", "unknown", "multiple"]);

/** The plan revision's location as lot 3 resolves it for this analysis, at the generation of its correction. */
async function readPlanLocation(jobId: string, planFileId: string): Promise<ItemSendPlanLocation | null> {
  const { plans } = await readTakeoffJobPlanLocations(jobId);
  const plan = plans.find((candidate) => candidate.plan_file_id.toLowerCase() === planFileId.toLowerCase());
  if (!plan) return null;
  const field = (view: { value: string | null; state: string }): ItemSendLocationField => ({ value: view.value,
    state: LOCATION_STATES.has(view.state as ItemSendLocationField["state"]) ? view.state as ItemSendLocationField["state"] : "unknown" });
  return { building: field(plan.location.building), level: field(plan.location.level), generation: plan.annotation?.revision ?? null };
}

const toChoice = (choice: NonNullable<ItemSendPreviewRequest["resolutions"]>[number]["choice"]): ItemSendChoice =>
  choice.kind === "line" ? { kind: "line", estimateItemId: choice.estimate_item_id } : choice;
const toOption = (option: ItemSendOption) => (option.kind === "line"
  ? { kind: "line" as const, estimate_item_id: option.estimateItemId, title: option.title } : option);

export async function previewTakeoffItemSend(jobId: string, body: unknown): Promise<ItemSendPreviewResponse> {
  const context = await getAuthenticatedTakeoffContext();
  const ctx: Context = { ...context, tenantRole: context.tenantRole ?? "" };
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const request = parseWithSchema(itemSendPreviewRequestSchema, body ?? {}, "Aperçu d’envoi par poste invalide.");
  return computeItemSendPreview(ctx, normalizedJobId, request);
}

async function computeItemSendPreview(ctx: Context, jobId: string, request: ItemSendPreviewRequest): Promise<ItemSendPreviewResponse> {
  const service = createServiceRoleClient();
  const job = await readPreviewJob(ctx, jobId);
  const { list, plan } = await readSealedOrder(service, ctx.tenantId, job);
  const facts = await readItemSendFacts(ctx, { jobId, projectId: job.project_id,
    list: { revisionId: list.revision_id, revision: list.revision, itemCount: list.item_count } });
  if (facts.state === "not_stored") {
    throw conflict(jobId, "item_send_answers_not_stored", "Les réponses par poste de ce plan ne sont pas encore enregistrées : "
      + "leur envoi au devis arrive avec une prochaine version. Rien n’est écrit.");
  }
  const reading = facts.reading;

  const { data: project, error: projectError } = await service.from("estimate_projects")
    .select("id, user_id, is_archived").eq("tenant_id", ctx.tenantId).eq("id", job.project_id).maybeSingle();
  if (projectError || !project) failed(projectError, "Impossible de lire l’affaire du métré.", jobId);
  const canEdit = !project.is_archived && (ctx.tenantRole === TAKEOFF_TENANT_ADMIN_ROLE
    || (ctx.tenantRole === "engineer" && project.user_id === ctx.userId));
  const jobFacts = { id: jobId, status: job.status, sent: job.status === "applied" || job.estimate_version_id !== null, canEdit };
  const scopeItems = reading.items.filter((item) => reading.scope.includes(item.id));
  const base = {
    job: jobFacts, plan: { key: plan.logical_id, name: plan.name, location: null as ItemSendPlanLocation | null },
    list: { revisionId: list.revision_id, revision: list.revision }, items: reading.items, scope: reading.scope, answers: reading.answers,
    affaireEntries: reading.affaireEntries, earlier: { targets: [], sections: [] }, pagesInEstimate: [], rules: new Map(),
    breakdown: request.breakdown ?? "together" as ItemSendBreakdown,
    resolutions: (request.resolutions ?? []).map((resolution) => ({ key: resolution.key, choice: toChoice(resolution.choice) })),
  };

  // A takeoff that cannot be sent from here gets its reason only: nothing of the affaire's estimates is read for it.
  if (jobFacts.sent || job.status !== "completed" || !canEdit) {
    const blocked = planTakeoffItemSend({ ...base, destination: { kind: "unresolved", reason: "choose_destination" } });
    return respond(jobId, plan, list, blocked, { destinations: [], destination: null, label: null, versionCreated: false, projectId: job.project_id });
  }

  const versions = await readVersions(service, ctx.tenantId, job.project_id, jobId);
  const { options, preferred } = resolveTakeoffSendDestinations(versions);
  const destinations = options.map((option) => option.destination.kind === "version_copy"
    ? { destination: null, label: option.label, blocked: "issued_only" as const }
    : { destination: option.destination.kind === "first_draft" ? { kind: "first_draft" as const }
      : { kind: "existing_draft" as const, version_id: option.destination.version_id }, label: option.label, blocked: null });
  const asked = request.destination;
  if (asked && !destinations.some((option) => option.destination?.kind === asked.kind
    && (asked.kind === "first_draft" || (option.destination?.kind === "existing_draft"
      && option.destination.version_id.toLowerCase() === asked.version_id.toLowerCase())))) {
    throw conflict(jobId, "item_send_preview_stale", "Les versions de l’affaire ont changé depuis l’aperçu : vérifiez la destination "
      + "proposée.", true);
  }
  const chosen = asked ?? (preferred && preferred.kind !== "version_copy"
    ? (preferred.kind === "first_draft" ? { kind: "first_draft" as const } : { kind: "existing_draft" as const, version_id: preferred.version_id })
    : null);
  const label = chosen ? destinations.find((option) => option.destination?.kind === chosen.kind
    && (chosen.kind === "first_draft" || (option.destination?.kind === "existing_draft"
      && option.destination.version_id.toLowerCase() === chosen.version_id.toLowerCase())))?.label ?? null : null;

  let destination: ItemSendDestinationState;
  let earlier = base.earlier as { targets: Awaited<ReturnType<typeof readItemSendEarlierState>>["targets"];
    sections: Awaited<ReturnType<typeof readItemSendEarlierState>>["sections"] };
  let pagesInEstimate: Array<{ page: number | null; earlierJobIds: string[]; estimateItemIds: string[] }> = [];
  if (!chosen) {
    destination = { kind: "unresolved", reason: options.some((option) => option.destination.kind === "version_copy") ? "issued_only" : "choose_destination" };
  } else if (chosen.kind === "first_draft") {
    const policy = await readTenantCalcPolicy(ctx.supabase, ctx.tenantId);
    destination = { kind: "first_draft", engine: policy.engine, maxSectionDepth: DEFAULT_MAX_SECTION_DEPTH };
  } else {
    const version = versions.find((candidate) => candidate.id.toLowerCase() === chosen.version_id.toLowerCase())!;
    const engine = requireEstimateEngineVersion(version);
    const draft = await readDraft(ctx, job.project_id, version.id, jobId);
    destination = { kind: "existing_draft", versionId: version.id, engine, maxSectionDepth: version.max_section_depth,
      sections: draft.sections, lines: draft.lines };
    if (itemSendEngineFits(engine)) {
      earlier = await readItemSendEarlierState(ctx, { projectId: job.project_id, versionId: version.id });
      const pages = [...new Set(reading.answers.flatMap((answer) => answer.observations.flatMap((observation) =>
        (observation.role === "contribution" && observation.page !== null ? [observation.page] : []))))];
      if (pages.length > 0) {
        const found = await readPlanPagesAlreadyInEstimate(ctx, { jobId, versionId: version.id, pages,
          document: { plan_file_id: plan.plan_file_id, content_hash: plan.content_sha256, logical_document_id: null, file_name: plan.name } });
        pagesInEstimate = found.map((page) => ({ page: page.page, earlierJobIds: page.earlier.map((entry) => entry.job_id),
          estimateItemIds: page.earlier.flatMap((entry) => entry.estimate_item_ids) }));
      }
    }
  }

  // The breakdown asked, else the one this draft already holds for these items, else « Ensemble ».
  const earlierBreakdowns = new Set(earlier.targets.map((target) => target.breakdown));
  const breakdown: ItemSendBreakdown = request.breakdown ?? (earlierBreakdowns.size === 1 ? [...earlierBreakdowns][0] : "together");
  const rules = projectItemSendRules(scopeItems, await listActiveTakeoffMappingRules({ supabase: ctx.supabase, tenantId: ctx.tenantId }));
  const location = breakdown === "together" ? null : await readPlanLocation(jobId, plan.plan_file_id);
  const computed = planTakeoffItemSend({ ...base, plan: { ...base.plan, location }, destination, earlier, pagesInEstimate, rules, breakdown });
  return respond(jobId, plan, list, computed, { destinations, destination: chosen, label,
    versionCreated: chosen?.kind === "first_draft", projectId: job.project_id });
}

function respond(jobId: string, plan: { logical_id: string; name: string }, list: { revision_id: string; revision: number },
  computed: ReturnType<typeof planTakeoffItemSend>, shown: {
    destinations: ItemSendPreviewResponse["destinations"]; destination: ItemSendPreviewResponse["destination"]; label: string | null;
    versionCreated: boolean; projectId: string;
  }): ItemSendPreviewResponse {
  // The first line written in document order, when it exists already; a line to create is named once created.
  const first = computed.targets[0];
  return {
    job_id: jobId,
    plan: { key: plan.logical_id, name: plan.name },
    list: { revision_id: list.revision_id, revision: list.revision },
    destinations: shown.destinations,
    destination: shown.destination,
    destination_label: shown.label,
    version_created: shown.versionCreated,
    engine: computed.engine,
    breakdown: computed.breakdown,
    blocked: computed.blocker ? { reason: computed.blocker.reason, message: BLOCKER_MESSAGES[computed.blocker.reason],
      href: computed.blocker.reason === "dpgf_import_required" ? `/dashboard/affaires/${encodeURIComponent(shown.projectId)}#intake` : null } : null,
    sections: computed.sections.map((section) => ({ key: section.key, title: section.title, parent_key: section.parentKey, depth: section.depth,
      homonym_in_draft: section.homonymInDraft })),
    lines: computed.targets.map((target) => ({
      key: target.key, item_id: target.itemId, label: target.label,
      change: target.line.kind === "new_line" ? "created" as const : "fed" as const,
      target: target.line.kind,
      estimate_item_id: target.line.kind === "new_line" ? null : target.line.estimateItemId,
      title: target.line.title,
      section_key: target.line.kind === "new_line" ? target.line.sectionKey : null,
      compartment: target.compartment,
      unit: target.unit,
      quantity_before: target.quantity.before, quantity_after: target.quantity.after, reference: target.quantity.reference,
      entered: target.quantity.entered, earlier: target.quantity.earlier, added: target.quantity.added, measured: target.quantity.measured,
      retained: target.quantity.retained, rounded_from: target.quantity.roundedFrom,
      gap: target.quantity.gap ? { absolute: target.quantity.gap.absolute, percent: target.quantity.gap.percent,
        requires_review: target.quantity.gap.requiresReview } : null,
      kept_entry: target.quantity.keptEntry,
      pages: [...new Set(target.contributions.flatMap((contribution) => contribution.pages))].sort((left, right) => left - right),
      rule: target.rule && target.rule.effect !== "none" ? { name: target.rule.ruleName, effect: target.rule.effect } : null,
    })),
    not_sent: computed.notSent.map((entry) => ({ item_id: entry.itemId, label: entry.label, reason: entry.reason,
      message: entry.reason === "rule_skip" && entry.ruleName ? `Ignoré par la règle de correspondance « ${entry.ruleName} ».`
        : NOT_SENT_MESSAGES[entry.reason] })),
    to_resolve: computed.toResolve.map((entry) => ({ key: entry.key, kind: entry.kind, item_id: entry.itemId, label: entry.label,
      page: entry.page, held_item_ids: entry.heldItemIds, message: TO_RESOLVE_MESSAGES[entry.kind], options: entry.options.map(toOption),
      facts: entry.facts })),
    not_added: computed.notAdded.map((entry) => ({ item_id: entry.itemId, role: entry.role, quantity: entry.quantity, unit: entry.unit,
      page: entry.page })),
    page_contributions: computed.pageContributions.map((page) => ({ page: page.page, item_ids: page.itemIds })),
    rules: computed.rules.map((rule) => ({ item_id: rule.itemId, label: rule.label, rule_name: rule.ruleName, action: rule.action,
      effect: rule.effect, message: RULE_MESSAGES[rule.effect] })),
    confirmable: computed.confirmable,
    focus_item_id: first && first.line.kind !== "new_line" ? first.line.estimateItemId : null,
    plan_digest: computed.writePlan ? createHash("sha256").update(canonicalJson(computed.writePlan), "utf8").digest("hex") : null,
  };
}
