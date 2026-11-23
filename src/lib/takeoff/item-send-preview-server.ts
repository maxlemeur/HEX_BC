import "server-only";

import { createHash } from "node:crypto";

import { readTenantCalcPolicy } from "@/lib/estimates/calc-policy-server";
import { prepareCanonicalEstimateCreation } from "@/lib/estimates/canonical-v2-creation";
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
import { takeoffItemSendLandingHref } from "@/lib/takeoff/apply-landing";
import { readItemSendEarlierState, readItemSendFacts } from "@/lib/takeoff/item-send-facts-server";
import {
  itemSendCanonical,
  itemSendEngineFits,
  itemSendPlanCanonical,
  itemSendWireChoice,
  planTakeoffItemSend,
  type ItemSendBlockerReason,
  type ItemSendBreakdown,
  type ItemSendChoice,
  type ItemSendDecisionInvalidReason,
  type ItemSendDestinationState,
  type ItemSendDraftLine,
  type ItemSendInput,
  type ItemSendLocationField,
  type ItemSendCountTotal,
  type ItemSendHeldQuantity,
  type ItemSendNotSentReason,
  type ItemSendOption,
  type ItemSendPageDecision,
  type ItemSendPartNotSent,
  type ItemSendPlanLocation,
  type ItemSendStamps,
  type ItemSendToResolveKind,
  type ItemSendWritePlan,
} from "@/lib/takeoff/item-send-plan";
import { projectItemSendRules, type ItemSendRuleEffectKind } from "@/lib/takeoff/item-send-rules";
import { getAuthenticatedTakeoffContext, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import type { AnyTakeoffLaunchManifest, TakeoffPlanLaunchManifest } from "@/lib/takeoff/launch-request";
import { listActiveTakeoffMappingRules } from "@/lib/takeoff/mapping-rules-server";
import { readTakeoffJobPlanLocations } from "@/lib/takeoff/plan-location-server";
import { TakeoffSendContextSchema } from "@/lib/takeoff/rules/recompute-server";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { firstDraftSettings } from "@/lib/takeoff/send-server";
import { resolveTakeoffSendDestinations, type TakeoffSendVersion } from "@/lib/takeoff/send-plan";
import { parseWithSchema, TAKEOFF_TENANT_ADMIN_ROLE } from "@/lib/takeoff/server-helpers";

// Lot 4, PR 5a/5b: POST /api/takeoff/jobs/{jobId}/item-send/preview — what the send of one plan's answers by item would
// make of the estimate, read only: the first draft it would create, its sections, the lines it would create or feed, the
// quantities before and after, what it leaves out and why, and what the member must resolve first. It writes nothing:
// no version, no section, no line, no receipt. Its confirmation (item-send-confirm-server.ts) computes the same plan
// again from the same facts (computeItemSendState) and hands it to the writer, which checks every fact again under its
// locks. The facts are read through the database's readers the writer reads (item-send-facts-server.ts).
// The right to write the affaire is checked first: without it, the member reads its reason and nothing else.

export type Context = AuthenticatedTakeoffContext & { tenantRole: string };
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
  no_line: "Aucun poste de ce plan n’est à envoyer : chacun est écarté, à accepter, non trouvé ou à compléter.",
};

const NOT_SENT_MESSAGES: Record<ItemSendNotSentReason, string> = {
  set_aside: "Écarté dans le tableau des postes.",
  not_accepted: "Mesure à accepter dans le tableau des postes : seul ce qui est retenu part au devis.",
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
  superseded: "Une lecture plus récente de ce plan remplace cette réponse : envoyez la plus récente.",
};

const PART_MESSAGES: Record<ItemSendPartNotSent["reason"], string> = {
  ...NOT_SENT_MESSAGES,
  page_held: "Sur une page déjà au devis par une autre analyse : en attente de sa décision de page.",
};

const TO_RESOLVE_MESSAGES: Record<ItemSendToResolveKind, string> = {
  target_missing: "La ligne du devis de ce poste est introuvable (supprimée, déliée, d’un import antérieur sans filiation prouvée, ou déjà "
    + "alimentée pour un autre poste) : choisissez la ligne, ou laissez le poste de côté.",
  target_multiple: "Plusieurs lignes du devis viennent de la même ligne du DPGF : choisissez celle qui reçoit le métré.",
  identity_conflict: "La ligne du devis porte une autre identité quantitative (unité, base, réseau, matière ou diamètre) que cette "
    + "mesure : elle n’est pas alimentée.",
  entered_quantity: "La quantité de cette ligne a été saisie à la main : conservez la saisie ou retenez la quantité du métré.",
  verified_total_indivisible: "Il faut une lecture qui couvre tout le plan pour remplacer le total précédent.",
  breakdown_mixed: "Ce poste est déjà envoyé dans ce devis avec un autre découpage : envoyez ce plan avec le même découpage.",
  page_decision: "Cette page est déjà au devis par une autre analyse : elle ne compte pas deux fois. Sa décision (remplacer ou garder "
    + "les deux) se prend à la confirmation ; d’ici là ses apports attendent.",
  section_depth: "La section de ce poste dépasse la profondeur des sections du devis : choisissez « Ensemble » ou laissez-le de côté.",
  quantity_unwritable: "Le devis ne peut pas porter cette quantité telle quelle (trois décimales au plus, sous son plafond) : corrigez la "
    + "saisie ou laissez le poste de côté ; rien n’est arrondi en silence.",
  compartment_changed: "Ce plan a déjà alimenté ce poste sur une autre ligne du devis (sa localisation a changé depuis) : sa part y "
    + "resterait comptée à côté de la nouvelle. Laissez le poste de côté, ou envoyez ce plan avec la localisation de son premier envoi.",
};

export const ITEM_SEND_INVALID_DECISION_MESSAGES: Record<ItemSendDecisionInvalidReason, string> = {
  page_not_held: "Cette page n’est pas au devis par une autre analyse : elle n’attend aucune décision.",
  replace_not_cuttable: "Cette page vient d’un envoi d’aujourd’hui, lu sans part par poste : « Remplacer » ne peut pas la découper. "
    + "Gardez les deux avec sa raison, ou laissez ses apports de côté.",
  keep_both_same_line: "« Garder les deux » sur cette page ajouterait sa lecture à une ligne qui la tient déjà d’une autre analyse : "
    + "elle compterait deux fois. Remplacez, ou laissez ses apports de côté.",
  part_indivisible: "Une part d’un envoi précédent porte aussi sur une page que cette confirmation ne remplace pas : elle ne peut pas "
    + "être coupée. Décidez aussi de ses autres pages, ou laissez ces apports de côté.",
  part_elsewhere: "La page remplacée retirerait une part d’une ligne que cet envoi n’alimente pas : elle y resterait comptée. "
    + "Gardez les deux, ou laissez ces apports de côté.",
};

const RULE_MESSAGES: Record<ItemSendRuleEffectKind, string> = {
  none: "",
  renamed: "Renommé par une règle de correspondance pour la ligne créée.",
  categorized: "Catégorie donnée par une règle de correspondance à la ligne créée.",
  skipped: "Ignoré par une règle de correspondance.",
  price_ignored: "Règle « Fixer le prix » sans effet ici : les prix ne sont jamais modifiés par le métré.",
  assembly_indicated: "Règle « Remplacer par un ouvrage » : la quantité du poste est gardée, l’ouvrage n’est qu’indiqué.",
};

function failed(error: { message?: string } | null, message: string, jobId: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

const conflict = (jobId: string, guard: string, message: string, retryable = false) => new TakeoffError({ status: 409,
  code: TakeoffErrorCode.CONFLICT, message, details: { guard }, retryable, jobId });

type PreviewJob = { id: string; project_id: string; estimate_version_id: string | null; status: string; launch_request_id: string | null;
  launch_unit_key: string | null; sources: unknown };

async function readPreviewJob(ctx: Context, jobId: string): Promise<PreviewJob> {
  const { data, error } = await ctx.supabase.from("takeoff_jobs")
    .select("id, project_id, estimate_version_id, status, launch_request_id, launch_unit_key, "
      + "sources:preparation_snapshot->preparation->sources" as never)
    .eq("tenant_id", ctx.tenantId).eq("id", jobId).maybeSingle();
  if (error) failed(error, "Impossible de charger le métré.", jobId);
  if (!data) {
    throw new TakeoffError({ status: 404, code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND, message: "Job takeoff introuvable.",
      details: { job_id: jobId }, retryable: false, jobId });
  }
  return data as unknown as PreviewJob;
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
  if (!unit || !plan) {
    throw new TakeoffError({ status: 500, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId: job.id,
      message: "La demande de ce métré ne décrit pas le plan qu’il a lu.", details: { guard: "item_send_unit_missing" } });
  }
  return { list: manifest.order.list, plan, unit };
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

/**
 * The draft's sections and lines, read with the member's session: only the columns the plan reads, never a price. The
 * raw row of each DPGF line comes from the database's lineage reader (public.read_estimate_dpgf_raw_rows): a live mapped
 * row of the import the line names, or the lineage recorded when a remapping deleted it. No lineage, no proof.
 */
async function readDraft(ctx: Context, service: Service, projectId: string, versionId: string, jobId: string) {
  const { data, error } = await readAllRows(() => ctx.supabase.from("estimate_items")
    .select(("id, parent_id, item_type, position, title, unit_code, pricing_status, quantity, updated_at, source_provider, "
      + "mapped_row_id:source_metadata->>mapped_row_id, import_id:source_metadata->>import_id, "
      + "dpgf_source_quantity:source_metadata->dpgf_source_quantity, "
      + "quantity_policy:source_metadata->takeoff_quantity_policy") as never, { count: "exact" })
    .eq("tenant_id", ctx.tenantId).eq("version_id", versionId), { pageSize: 1000 });
  if (error) failed(error as { message?: string }, "Impossible de lire le brouillon de devis.", jobId);
  const rows = (data ?? []) as unknown as DraftRow[];
  const proven = new Map((await readLineage(service, ctx.tenantId, versionId, jobId)).map((row) => [row.estimate_item_id, row]));
  const mappedIds = [...new Set(rows.flatMap((row) => (row.item_type === "line" && row.source_provider === "dpgf" && row.mapped_row_id
    && (row.dpgf_source_quantity === undefined || row.dpgf_source_quantity === null) ? [row.mapped_row_id] : [])))];
  const facts = mappedIds.length > 0
    ? await readDpgfMappedFacts({ supabase: ctx.supabase, tenantId: ctx.tenantId, projectId, mappedIds }) : new Map();
  const sections = rows.filter((row) => row.item_type === "section").map((row) => ({ id: row.id, parentId: row.parent_id,
    position: row.position, title: row.title }));
  const lines: ItemSendDraftLine[] = rows.filter((row) => row.item_type === "line").map((row) => {
    const lineageRow = proven.get(row.id);
    const stated = typeof row.dpgf_source_quantity === "number" && Number.isFinite(row.dpgf_source_quantity) ? row.dpgf_source_quantity : null;
    return {
      id: row.id, parentId: row.parent_id, title: row.title, unitCode: row.unit_code, pricingStatus: row.pricing_status,
      quantity: Number(row.quantity ?? 0), updatedAt: row.updated_at,
      dpgf: row.source_provider === "dpgf" ? {
        importId: lineageRow?.import_id ?? null,
        metadataImportId: row.import_id,
        mappedRowId: row.mapped_row_id,
        rawRowId: lineageRow?.raw_row_id ?? null,
        reference: row.dpgf_source_quantity !== undefined && row.dpgf_source_quantity !== null ? stated
          : (row.mapped_row_id ? facts.get(row.mapped_row_id)?.quantity ?? null : null),
        composition: readStoredDpgfComposition({ takeoff_quantity_policy: row.quantity_policy }),
      } : null,
    };
  });
  // The DPGF imports the draft's lines come from, each as the database identifies its reviewed generation (its latest
  // mapping and the digest of its rows): a change of one refuses the confirmation.
  const importIds = [...new Set(lines.flatMap((line) => (line.dpgf?.importId ? [line.dpgf.importId] : [])))];
  const dpgf: Array<ItemSendStamps["dpgf"][number]> = [];
  if (importIds.length > 0) {
    const { data: imports, error: importsError } = await readAllRowsInChunks(importIds, (chunk) => ctx.supabase.from("dpgf_imports")
      .select("id, updated_at, status, row_count", { count: "exact" }).eq("tenant_id", ctx.tenantId).eq("project_id", projectId).in("id", chunk));
    if (importsError) failed(importsError as { message?: string }, "Impossible de lire les imports du DPGF.", jobId);
    for (const row of (imports ?? []) as Array<{ id: string; updated_at: string; status: string; row_count: number }>) {
      const { data: review, error: reviewError } = await service.rpc("dpgf_import_review_state" as never,
        { p_tenant_id: ctx.tenantId, p_import_id: row.id } as never);
      if (reviewError) failed(reviewError, "Impossible de lire l’état revu du DPGF.", jobId);
      const state = ((review ?? []) as Array<{ mapping_id: string | null; rows_sha256: string | null }>)[0] ?? null;
      dpgf.push({ importId: row.id, mappingId: state?.mapping_id ?? null, rowsSha256: state?.rows_sha256 ?? null, updatedAt: row.updated_at,
        status: row.status, rowCount: row.row_count });
    }
  }
  return { sections, lines, dpgf };
}

type LineageRow = { estimate_item_id: string; import_id: string; mapped_row_id: string; raw_row_id: string };
const LINEAGE_PAGE = 1000;

/**
 * Every row of the DPGF lineage of a version (public.read_estimate_dpgf_raw_rows), page by page in a stable order and
 * checked against its exact count: a proof read in part never chooses a target (the API cuts an answer at 1,000 rows).
 */
async function readLineage(service: Service, tenantId: string, versionId: string, jobId: string): Promise<LineageRow[]> {
  const rows: LineageRow[] = [];
  let expected: number | null = null;
  const incomplete = () => new TakeoffError({ status: 503, code: TakeoffErrorCode.INTERNAL_ERROR, retryable: true, jobId,
    message: "La provenance des lignes du DPGF a changé pendant sa lecture : rouvrez l’aperçu.", details: { guard: "item_send_lineage_incomplete" } });
  for (;;) {
    const { data, error, count } = await (service.rpc("read_estimate_dpgf_raw_rows" as never,
      { p_tenant_id: tenantId, p_version_id: versionId } as never, { count: "exact" } as never) as unknown as {
      order: (column: string) => { order: (column: string) => { range: (from: number, to: number) => PromiseLike<{
        data: LineageRow[] | null; error: { message?: string } | null; count: number | null }> } };
    }).order("estimate_item_id").order("mapped_row_id").range(rows.length, rows.length + LINEAGE_PAGE - 1);
    if (error) failed(error, "Impossible de lire la provenance des lignes du DPGF.", jobId);
    if (count === null || (expected !== null && count !== expected)) throw incomplete();
    expected = count;
    rows.push(...(data ?? []));
    if (rows.length >= expected || (data ?? []).length === 0) break;
  }
  if (rows.length !== expected || new Set(rows.map((row) => `${row.estimate_item_id}|${row.mapped_row_id}`)).size !== rows.length) {
    throw incomplete();
  }
  return rows;
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

/**
 * Whether some location of the affaire an operator confirmed names a building: a building lot 3 stores as a value
 * (`building_choice = 'value'`). A field left to its reading follows an unconfirmed reading and names none.
 */
async function affaireNamesBuilding(ctx: Context, projectId: string, jobId: string) {
  const { data, error } = await ctx.supabase.from("takeoff_plan_locations").select("id").eq("tenant_id", ctx.tenantId)
    .eq("project_id", projectId).eq("building_choice", "value").limit(1);
  if (error) failed(error, "Impossible de lire les localisations de l’affaire.", jobId);
  return (data ?? []).length > 0;
}

/** The stamps the writer compares again under its locks: the job's, the draft's peers and lot 3's send context. */
async function readStamps(service: Service, ctx: Context, input: { projectId: string; jobId: string; versionId: string | null }) {
  const { data: job, error: jobError } = await service.rpc("takeoff_rule_job_stamp" as never,
    { p_tenant_id: ctx.tenantId, p_project_id: input.projectId, p_job_id: input.jobId } as never);
  if (jobError || (job !== null && typeof job !== "string")) failed(jobError, "Impossible de lire l’état du métré.", input.jobId);
  let peers: string | null = null;
  if (input.versionId) {
    const { data, error } = await service.rpc("takeoff_send_peers_stamp" as never,
      { p_tenant_id: ctx.tenantId, p_version_id: input.versionId } as never);
    if (error || typeof data !== "string") failed(error, "Impossible de lire l’état du devis.", input.jobId);
    peers = data;
  }
  const { data: context, error: contextError } = await service.rpc("read_takeoff_send_context" as never, { p_tenant_id: ctx.tenantId,
    p_project_id: input.projectId, p_job_id: input.jobId, p_version_id: input.versionId } as never);
  const parsed = TakeoffSendContextSchema.safeParse(context);
  if (contextError || !parsed.success) failed(contextError, "Impossible de lire les autres plans de l’affaire.", input.jobId);
  return { job: job as string | null, peers, context: parsed.data.stamps };
}

/** The ouvrages the rules point to, by name. */
async function assemblyNames(ctx: Context, ids: readonly string[], jobId: string) {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data, error } = await readAllRowsInChunks([...new Set(ids)], (chunk) => ctx.supabase.from("estimate_assemblies")
    .select("id, name", { count: "exact" }).eq("tenant_id", ctx.tenantId).in("id", chunk));
  if (error) failed(error as { message?: string }, "Impossible de lire les ouvrages des règles.", jobId);
  for (const row of (data ?? []) as Array<{ id: string; name: string }>) names.set(row.id, row.name);
  return names;
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
  return (await computeItemSendState(ctx, normalizedJobId, request)).response;
}

/** A preview that says its reason and nothing else of the takeoff, its list or the affaire's estimates. */
function reasonOnly(jobId: string, reason: ItemSendBlockerReason, engine: number | null = null): ItemSendPreviewResponse {
  return { job_id: jobId, plan: null, list: null, destinations: [], destination: null, destination_label: null, version_created: false,
    engine, breakdown: "together", blocked: { reason, message: BLOCKER_MESSAGES[reason], href: null }, sections: [], lines: [], not_sent: [],
    parts_not_sent: [], to_resolve: [], not_added: [], page_contributions: [], invalid_page_decisions: [], rules: [], confirmable: false,
    focus_item_id: null, plan_digest: null };
}

const toDecision = (decision: NonNullable<ItemSendPreviewRequest["page_decisions"]>[number]): ItemSendPageDecision =>
  decision.decision === "replace" ? { page: decision.page, decision: "replace" }
    : { page: decision.page, decision: "keep_both", reasonCode: decision.reason_code, note: decision.note?.trim() || null };

/** The digest a confirmation sends back: the write plan in its one spelling. */
export const itemSendPlanDigest = (plan: ItemSendWritePlan) => createHash("sha256").update(itemSendPlanCanonical(plan), "utf8").digest("hex");

/**
 * The member's choices a plan was computed from, normalised (each list in one order, a note trimmed, absent choices
 * null): the plan carries their digest, so that a replay under the same intention key answers only the same choices.
 */
export function itemSendChoicesDigest(request: ItemSendPreviewRequest): string {
  const choices = {
    destination: request.destination ?? null,
    breakdown: request.breakdown ?? null,
    resolutions: [...(request.resolutions ?? [])].map((resolution) => ({ key: resolution.key,
      choice: itemSendWireChoice(toChoice(resolution.choice)) })).sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
    page_decisions: [...(request.page_decisions ?? [])].map((decision) => decision.decision === "replace"
      ? { page: decision.page, decision: "replace", reason_code: null, note: null }
      : { page: decision.page, decision: "keep_both", reason_code: decision.reason_code, note: decision.note?.trim() || null })
      .sort((left, right) => (left.page ?? Number.MAX_SAFE_INTEGER) - (right.page ?? Number.MAX_SAFE_INTEGER)),
  };
  return createHash("sha256").update(itemSendCanonical(choices), "utf8").digest("hex");
}

/**
 * Whether the member may write the affaire now (its owner engineer or an administrator, not archived), read with the
 * member's own session: the preview's first check, and a replay's.
 */
export async function itemSendMemberMayWrite(ctx: Context, projectId: string, jobId: string): Promise<boolean> {
  const { data: project, error } = await ctx.supabase.from("estimate_projects")
    .select("id, user_id, is_archived").eq("tenant_id", ctx.tenantId).eq("id", projectId).maybeSingle();
  if (error) failed(error, "Impossible de lire l’affaire du métré.", jobId);
  return Boolean(project) && !project!.is_archived && (ctx.tenantRole === TAKEOFF_TENANT_ADMIN_ROLE
    || (ctx.tenantRole === "engineer" && project!.user_id === ctx.userId));
}

/**
 * What the preview shows and the confirmation writes, computed once from the stored facts and the member's choices: the
 * answer, the write plan (null until confirmable) and, for a first draft, the payload « Créer un devis » prepares for
 * it (prepareCanonicalEstimateCreation, as today's send: the server's settings, never a member's).
 */
export type ItemSendState = { response: ItemSendPreviewResponse; writePlan: ItemSendWritePlan | null;
  versionPayload: Record<string, unknown> | null; blocker: ItemSendBlockerReason | null };

export async function computeItemSendState(ctx: Context, jobId: string, request: ItemSendPreviewRequest): Promise<ItemSendState> {
  const service = createServiceRoleClient();
  const job = await readPreviewJob(ctx, jobId);
  const only = (response: ItemSendPreviewResponse): ItemSendState => ({ response, writePlan: null, versionPayload: null,
    blocker: response.blocked?.reason ?? null });
  // The right to write the affaire first, read with the member's session: a member without it learns its reason, not
  // the kind of its takeoff.
  const canEdit = await itemSendMemberMayWrite(ctx, job.project_id, jobId);
  if (!canEdit) return only(reasonOnly(jobId, "read_only"));

  const { list, plan, unit } = await readSealedOrder(service, ctx.tenantId, job);
  const facts = await readItemSendFacts(ctx, { jobId, projectId: job.project_id,
    list: { revisionId: list.revision_id, revision: list.revision, itemCount: list.item_count } });
  if (facts.state === "not_stored") {
    throw conflict(jobId, "item_send_answers_not_stored", "Les réponses par poste de ce plan ne sont pas encore enregistrées : "
      + "attendez la fin de sa lecture. Rien n’est écrit.");
  }
  const reading = facts.reading;
  const jobFacts = { id: jobId, status: job.status, sent: job.status === "applied" || job.estimate_version_id !== null, canEdit };
  const scopeItems = reading.items.filter((item) => reading.scope.includes(item.id));
  // The pages the plan's unit reads (all of them when it names none): where an entry of this plan stands.
  const unitPages = unit.pages.length > 0 ? [...unit.pages]
    : unit.page_count ? Array.from({ length: unit.page_count }, (_, index) => index + 1) : [];
  const base: Omit<ItemSendInput, "destination"> = {
    job: jobFacts, plan: { key: plan.logical_id, name: plan.name, pages: unitPages, pageCount: plan.page_count, location: null },
    list: { revisionId: list.revision_id, revision: list.revision }, items: reading.items, scope: reading.scope, answers: reading.answers,
    affaireEntries: reading.affaireEntries, earlier: { targets: [], sections: [], displaced: [] }, pagesInEstimate: [], rules: new Map(),
    breakdown: request.breakdown ?? "together", affaireNamesBuilding: false,
    stamps: { job: null, peers: null, context: null, dpgf: [], firstDraftSettings: null, destination: null, mapping: null },
    resolutions: (request.resolutions ?? []).map((resolution) => ({ key: resolution.key, choice: toChoice(resolution.choice) })),
    pageDecisions: (request.page_decisions ?? []).map(toDecision),
  };
  const shown = { plan: { key: plan.logical_id, name: plan.name }, list: { revision_id: list.revision_id, revision: list.revision },
    projectId: job.project_id };

  // A takeoff already sent or not finished gets its reason: nothing of the affaire's estimates is read for it. A plan already
  // sent by item gives the way to what it wrote (its receipt's landing), also to a screen that lost the answer.
  if (jobFacts.sent || job.status !== "completed") {
    const blocked = planTakeoffItemSend({ ...base, destination: { kind: "unresolved", reason: "choose_destination" } });
    const landing = blocked.blocker?.reason === "already_sent" ? await readSentLanding(ctx, jobId) : null;
    return only(respond(jobId, shown, blocked, { destinations: [], destination: null, label: null, versionCreated: false }, new Map(), null,
      landing));
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
  let earlier: ItemSendInput["earlier"] = base.earlier;
  let pagesInEstimate: ItemSendInput["pagesInEstimate"] = [];
  let stamps: ItemSendStamps = base.stamps;
  let versionId: string | null = null;
  let versionPayload: Record<string, unknown> | null = null;
  if (!chosen) {
    destination = { kind: "unresolved", reason: options.some((option) => option.destination.kind === "version_copy") ? "issued_only" : "choose_destination" };
  } else if (chosen.kind === "first_draft") {
    const policy = await readTenantCalcPolicy(ctx.supabase, ctx.tenantId);
    let settings: Record<string, unknown> | null = null;
    let maxSectionDepth = DEFAULT_MAX_SECTION_DEPTH;
    if (itemSendEngineFits(policy.engine)) {
      // The first draft as « Créer un devis » would create it: its settings are part of what a confirmation compares, its
      // payload is the one the writer creates the draft from.
      const prepared = await prepareCanonicalEstimateCreation({ supabase: ctx.supabase, tenantId: ctx.tenantId, actorUserId: ctx.userId,
        project: { kind: "existing", id: job.project_id }, source: { kind: "blank", importId: null }, expectedCalcEngineVersion: policy.engine });
      versionPayload = prepared.versionPayload as Record<string, unknown>;
      settings = firstDraftSettings(versionPayload, policy);
      if (typeof versionPayload.max_section_depth === "number") maxSectionDepth = versionPayload.max_section_depth;
    }
    destination = { kind: "first_draft", engine: policy.engine, maxSectionDepth };
    stamps = { ...stamps, firstDraftSettings: settings };
  } else {
    const version = versions.find((candidate) => candidate.id.toLowerCase() === chosen.version_id.toLowerCase())!;
    versionId = version.id;
    const engine = requireEstimateEngineVersion(version);
    const draft = await readDraft(ctx, service, job.project_id, version.id, jobId);
    destination = { kind: "existing_draft", versionId: version.id, engine, maxSectionDepth: version.max_section_depth,
      sections: draft.sections, lines: draft.lines };
    stamps = { ...stamps, dpgf: draft.dpgf, destination: { versionId: version.id, status: version.status, updatedAt: version.updated_at } };
    if (itemSendEngineFits(engine)) {
      // What earlier sends by item wrote here and the pages of this plan the draft already holds, as the writer's page
      // guard reads them (today's provenance and the parts of earlier sends by item).
      const state = await readItemSendEarlierState(ctx, { projectId: job.project_id, versionId: version.id, jobId,
        incomingCountItems: reading.answers.filter((answer) => answer.quantitySource === "verified_count").map((answer) => answer.itemId) });
      earlier = { targets: state.targets, sections: state.sections, displaced: state.displaced };
      pagesInEstimate = state.pagesInEstimate;
    }
  }

  // The breakdown asked, else the one this draft already holds for these items, else « Ensemble ».
  const earlierBreakdowns = new Set(earlier.targets.flatMap((target) => (target.breakdown === "dpgf" ? [] : [target.breakdown])));
  const breakdown: ItemSendBreakdown = request.breakdown ?? (earlierBreakdowns.size === 1 ? [...earlierBreakdowns][0] : "together");
  const fits = destination.kind !== "unresolved" && itemSendEngineFits(destination.engine);
  if (fits) stamps = { ...stamps, ...await readStamps(service, ctx, { projectId: job.project_id, jobId, versionId }) };
  // The mapping rules' state, read before the rules themselves: a rule changed after it refuses the confirmation.
  const { data: mappingStamp, error: mappingStampError } = await service.rpc("takeoff_mapping_rules_stamp" as never,
    { p_tenant_id: ctx.tenantId } as never);
  if (mappingStampError || typeof mappingStamp !== "string") failed(mappingStampError, "Impossible de lire les règles de correspondance.", jobId);
  stamps = { ...stamps, mapping: mappingStamp };
  const ruleList = await listActiveTakeoffMappingRules({ supabase: ctx.supabase, tenantId: ctx.tenantId });
  const rules = projectItemSendRules(scopeItems, ruleList);
  const location = breakdown === "together" ? null : await readPlanLocation(jobId, plan.plan_file_id);
  const namesBuilding = breakdown === "by_level" ? await affaireNamesBuilding(ctx, job.project_id, jobId) : false;
  const computed = planTakeoffItemSend({ ...base, plan: { ...base.plan, location }, destination, earlier, pagesInEstimate, rules, breakdown,
    affaireNamesBuilding: namesBuilding, stamps });
  const assemblies = await assemblyNames(ctx, computed.rules.flatMap((rule) => (rule.assemblyId ? [rule.assemblyId] : [])), jobId);
  // The plan names the member's choices it was computed from (their digest), which a replay compares.
  const writePlan = computed.writePlan ? { ...computed.writePlan, choices_sha256: itemSendChoicesDigest(request) } : null;
  const response = respond(jobId, shown, computed, { destinations, destination: chosen, label, versionCreated: chosen?.kind === "first_draft" },
    assemblies, writePlan ? itemSendPlanDigest(writePlan) : null);
  return { response, writePlan, versionPayload: chosen?.kind === "first_draft" ? versionPayload : null,
    blocker: computed.blocker?.reason ?? null };
}

/** Where a plan already sent by item landed: the first line its receipt wrote, in its version's editor; null without one. */
async function readSentLanding(ctx: Context, jobId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase.from("takeoff_item_send_receipts" as never)
    .select("version_id, result" as never).eq("tenant_id" as never, ctx.tenantId as never).eq("job_id" as never, jobId as never)
    .order("created_at" as never).limit(1);
  if (error) failed(error, "Impossible de lire l’envoi déjà fait de ce plan.", jobId);
  const receipt = ((data ?? []) as Array<{ version_id: string | null; result: { focus_item_id?: unknown; version_id?: unknown } | null }>)[0];
  const version = receipt?.version_id ?? (typeof receipt?.result?.version_id === "string" ? receipt.result.version_id : null);
  if (!version) return null;
  const focus = typeof receipt?.result?.focus_item_id === "string" ? receipt.result.focus_item_id : null;
  return takeoffItemSendLandingHref(version, { lines_written: focus ? [focus] : [], sections_created: [] });
}

function countOnWire(total: ItemSendCountTotal) {
  return { job_id: total.jobId, answer_id: total.answerId, reading_revision: total.readingRevision, marks_revision: total.marksRevision,
    quantity: total.quantity, unit: total.unit, pages: [...total.pages] };
}

function heldOnWire(part: ItemSendHeldQuantity) {
  return { job_id: part.jobId, answer_id: part.answerId, reading_revision: part.readingRevision, source: part.source,
    quantity: part.quantity, unit: part.unit, pages: [...part.pages] };
}

export function heldCountMessage(total: ReturnType<typeof countOnWire>, jobId: string, held?: ReturnType<typeof heldOnWire>) {
  const reading = total.reading_revision === null ? `l’analyse ${total.job_id}` : `la lecture n° ${total.reading_revision}`;
  const pages = `${total.pages.length === 1 ? "page" : "pages"} ${total.pages.join(", ")}`;
  const origin = total.job_id === jobId ? "La lecture propose un comptage" : "Le devis conserve le comptage";
  let retained = "";
  if (held) {
    const source = held.source === "measured" ? "la mesure" : "la saisie";
    const from = held.reading_revision === null ? `l’analyse ${held.job_id}` : `la lecture n° ${held.reading_revision}`;
    const scope = held.pages.length ? `${held.pages.length === 1 ? "page" : "pages"} ${held.pages.join(", ")}` : "pages inconnues";
    retained = `Le devis conserve ${source} de ${held.quantity.toLocaleString("fr-FR")} ${held.unit} de ${from} (${scope}). `;
  }
  return retained + `${origin} de ${total.quantity} ${total.unit}, issu de ${reading} (repères ${pages}). `
    + "Pour remplacer le total précédent, retenez une quantité sur une lecture qui couvre tout le plan. "
    + "Vous pouvez aussi conserver le total précédent.";
}

function respond(jobId: string, shown: { plan: { key: string; name: string }; list: { revision_id: string; revision: number }; projectId: string },
  computed: ReturnType<typeof planTakeoffItemSend>, chosen: {
    destinations: ItemSendPreviewResponse["destinations"]; destination: ItemSendPreviewResponse["destination"]; label: string | null;
    versionCreated: boolean;
  }, assemblies: ReadonlyMap<string, string>, digest: string | null, landing: string | null = null): ItemSendPreviewResponse {
  // The first line written in document order, when it exists already; a line to create is named once created.
  const first = computed.targets[0];
  return {
    job_id: jobId,
    plan: shown.plan,
    list: shown.list,
    destinations: chosen.destinations,
    destination: chosen.destination,
    destination_label: chosen.label,
    version_created: chosen.versionCreated,
    engine: computed.engine,
    breakdown: computed.breakdown,
    blocked: computed.blocker ? { reason: computed.blocker.reason, message: BLOCKER_MESSAGES[computed.blocker.reason],
      href: computed.blocker.reason === "dpgf_import_required" ? `/dashboard/affaires/${encodeURIComponent(shown.projectId)}#intake`
        : computed.blocker.reason === "already_sent" ? landing : null } : null,
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
      ...(target.replacedVerifiedTotal || target.contributions[0]?.kind === "verified_count"
        ? { quantity_source: target.contributions[0].kind } : {}),
      ...(target.replacedVerifiedTotal ? { replaced_verified_total: countOnWire(target.replacedVerifiedTotal) } : {}),
      quantity_before: target.quantity.before, quantity_after: target.quantity.after, reference: target.quantity.reference,
      entered: target.quantity.entered, earlier: target.quantity.earlier, replaced: target.quantity.replaced, added: target.quantity.added,
      measured: target.quantity.measured,
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
    parts_not_sent: computed.partsNotSent.map((part) => ({ item_id: part.itemId, kind: part.kind, observation_ids: part.observationIds,
      pages: part.pages, quantity: part.quantity, unit: part.unit, reason: part.reason, message: PART_MESSAGES[part.reason] })),
    to_resolve: computed.toResolve.map((entry) => ({ key: entry.key, kind: entry.kind, item_id: entry.itemId, label: entry.label,
      page: entry.page, held_item_ids: entry.heldItemIds,
      earlier_lines: entry.earlierLines.map((line) => ({ estimate_item_id: line.estimateItemId, title: line.title, quantity: line.quantity })),
      ...(entry.verifiedTotal ? { verified_total: countOnWire(entry.verifiedTotal) } : {}),
      ...(entry.heldPart ? { held_part: heldOnWire(entry.heldPart) } : {}),
      message: entry.verifiedTotal ? heldCountMessage(countOnWire(entry.verifiedTotal), jobId, entry.heldPart && heldOnWire(entry.heldPart))
        : TO_RESOLVE_MESSAGES[entry.kind],
      options: entry.options.map(toOption), facts: entry.facts })),
    not_added: computed.notAdded.map((entry) => ({ item_id: entry.itemId, role: entry.role, quantity: entry.quantity, unit: entry.unit,
      page: entry.page })),
    page_contributions: computed.pageContributions.map((page) => ({ page: page.page, item_ids: page.itemIds })),
    invalid_page_decisions: computed.invalidDecisions.map((entry) => ({ page: entry.page, reason: entry.reason,
      message: ITEM_SEND_INVALID_DECISION_MESSAGES[entry.reason] })),
    rules: computed.rules.map((rule) => ({ item_id: rule.itemId, label: rule.label, rule_name: rule.ruleName, action: rule.action,
      effect: rule.effect, message: RULE_MESSAGES[rule.effect],
      assembly: rule.assemblyId ? { id: rule.assemblyId, name: assemblies.get(rule.assemblyId) ?? null } : null })),
    confirmable: computed.confirmable,
    focus_item_id: first && first.line.kind !== "new_line" ? first.line.estimateItemId : null,
    plan_digest: digest,
  };
}
