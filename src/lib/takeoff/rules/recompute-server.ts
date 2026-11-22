import "server-only";
import { readDefaultOnTakeoffFlag } from "@/lib/takeoff/default-on-flags";

import { isUnselectedVectorReading } from "@/lib/takeoff/vectors/alternatives";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { IN_FILTER_CHUNK_SIZE } from "@/lib/supabase/in-chunks";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { takeoffLinePageIdentity, type PageDocumentSource } from "@/lib/takeoff/page-contributions";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { prepareRuleResultWrite } from "@/lib/takeoff/rules/result-identity";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import { ruleLinePage, type RulePageCandidate } from "@/lib/takeoff/rules/recompute-pages";
import type { TakeoffFrameTransform, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { VectorItemGeometrySchema, VectorPageRecordSchema } from "@/lib/takeoff/vectors/persistence";
import type { Database } from "@/types/database";
import { withQuantityLineGroups, type QuantityTargetLine, type QuantityLineLink } from "@/lib/takeoff/rules/quantity-line-groups";

// Computes the fixed rules of one estimate version and writes them (TI-664
// step 2), with the service role: after a job's reading (worker), after a
// review's edit (PATCH), before an application (apply). Every completed or
// applied job of the version is read: an applied job's lines are frozen
// partners, never written. Lines without rule inputs (written by the worker,
// metadata.rule_inputs) get no result: a version read before TI-664 is never
// touched. write_takeoff_rule_results writes a line only as it was read (its
// updated_at), and nothing when the version changed since this computation
// read its stamp (takeoff_rule_version_stamp): a line edited meanwhile keeps
// its stale results, and the edit's own computation writes them. Results are
// bounded before they are written (boundRuleResults: fields, then 64 KiB of
// jsonb text, TI-677), so every read accepts them and the column stores them.

type ServiceClient = SupabaseClient<Database>;

export const TAKEOFF_RULES_WRITE_CHUNK = 400;
const GEOMETRY_PAGE = 500;

/** An explicit MERGEONE_TAKEOFF_RULES=0 disables rule inputs on new jobs. */
export function isTakeoffRulesEnabled() {
  return readDefaultOnTakeoffFlag("MERGEONE_TAKEOFF_RULES", process.env.MERGEONE_TAKEOFF_RULES);
}

const AnchorsSchema: z.ZodType<PageAnchors> = z.object({
  version: z.number().int().positive(),
  texts: z.array(z.tuple([z.string(), z.number().finite(), z.number().finite()])),
  lines: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])),
});

type JobRow = { id: string; status: string; created_at: string; sources?: unknown };
type ItemRow = {
  id: string; job_id: string; designation: string; unit: string; quantity: number; is_excluded: boolean; exclusion_reason: string | null; updated_at: string;
  metadata: unknown; source_file_name: string | null; source_page: number | null; rule_results: unknown; rules_stale: boolean;
  rules_stale_at: string | null;
  rules_evaluated_at: string | null; quantity_entry_category: string | null; is_verified: boolean;
};
type PageRow = { id: string; job_id: string; plan_file_id: string | null; source_file_name: string | null; source_page: number; reading: unknown;
  rule_anchors: unknown };
type GeometryRow = { takeoff_item_id: string; job_id: string; vector_page_id: string; geometry: unknown };

/** The documents of a takeoff's preparation (content hash, plan reference), as the page decision reads them. */
const SourcesSchema = z.array(z.object({
  document_id: z.string(), document_name: z.string().nullish(), kind: z.string().nullish(), active: z.boolean().nullish(),
  content_hash: z.string().nullish(), logical_document_id: z.string().nullish(),
}));

function failed(message: string, error: { message?: string } | null): never {
  throw new Error(`${message} (${error?.message ?? "erreur inconnue"})`);
}

async function readGeometries(supabase: ServiceClient, tenantId: string, jobIds: readonly string[]) {
  const rows: GeometryRow[] = [];
  for (let start = 0; start < jobIds.length; start += IN_FILTER_CHUNK_SIZE) {
    const chunk = jobIds.slice(start, start + IN_FILTER_CHUNK_SIZE);
    for (let offset = 0; ; offset += GEOMETRY_PAGE) {
      const { data, error } = await supabase.from("takeoff_item_geometries" as never)
        .select("takeoff_item_id, job_id, vector_page_id, geometry" as never)
        .eq("tenant_id" as never, tenantId as never).in("job_id" as never, chunk as never)
        .order("takeoff_item_id" as never, { ascending: true }).range(offset, offset + GEOMETRY_PAGE - 1);
      if (error) failed("Impossible de lire la géométrie des lignes pour les règles.", error);
      rows.push(...((data ?? []) as unknown as GeometryRow[]));
      if ((data ?? []).length < GEOMETRY_PAGE) break;
    }
  }
  return rows;
}

/** JSON with object keys sorted: stored jsonb comes back with its keys in another order than the code builds them. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function sameJson(left: unknown, right: unknown) {
  return canonical(left) === canonical(right);
}

/**
 * lines: the lines the rules read; written: the lines whose results were written; skipped: the lines the writer left
 * (changed since read); reopened: the verified lines among the writes whose new results bring a failure they did not
 * have (TI-677 PR D) — the writer withdraws their verification, by the same keys (takeoff_rule_failures_reopen).
 */
export type TakeoffRulesRecomputation = { lines: number; written: number; skipped: number; reopened: number };

/**
 * Computes and writes the rules of a version. Never throws for a version without rule inputs; any read or write
 * error is thrown to the caller, who decides whether it may go on (the stored results, or their stale state, still
 * block in the apply trigger).
 */
type TakeoffRuleScope = { estimateVersionId: string; jobId?: never; projectId?: never }
  | { estimateVersionId?: never; jobId: string; projectId: string };
type TakeoffRuleRecomputeInput = TakeoffRuleScope & { tenantId: string; supabase?: ServiceClient };

export function recomputeTakeoffRulesForVersion(input: Extract<TakeoffRuleRecomputeInput, { estimateVersionId: string }>) {
  return recomputeTakeoffRules(input);
}

export function recomputeTakeoffRulesForJob(input: Extract<TakeoffRuleRecomputeInput, { jobId: string }>) {
  return recomputeTakeoffRules(input);
}

const EMPTY_RECOMPUTATION = { lines: 0, written: 0, skipped: 0, reopened: 0 };

async function recomputeTakeoffRules(input: TakeoffRuleRecomputeInput): Promise<TakeoffRulesRecomputation> {
  const supabase = input.supabase ?? createServiceRoleClient();
  const { tenantId, estimateVersionId } = input;
  const scope = estimateVersionId === undefined
    ? { p_tenant_id: tenantId, p_project_id: input.projectId, p_job_id: input.jobId }
    : { p_tenant_id: tenantId, p_estimate_version_id: estimateVersionId };
  if (estimateVersionId !== undefined) {
    // Existing inputs stay protected after the worker flag is off.
    const { data: hasInputs, error } = await supabase.rpc("takeoff_rule_version_has_inputs" as never, scope as never);
    if (error || typeof hasInputs !== "boolean") failed("Impossible de vérifier la présence de règles.", error);
    if (!hasInputs) return EMPTY_RECOMPUTATION;
  }
  const { data: stamp, error: stampError } = await supabase.rpc(
    (estimateVersionId === undefined ? "takeoff_rule_job_stamp" : "takeoff_rule_version_stamp") as never, scope as never);
  if (stampError) failed("Impossible de lire l’état du métré pour les règles.", stampError);
  if (estimateVersionId === undefined && stamp === null) return EMPTY_RECOMPUTATION;
  if (typeof stamp !== "string") failed("Impossible de lire l’état du métré pour les règles.", null);

  let jobs: JobRow[];
  let carried = new Set<string>();
  if (estimateVersionId === undefined) {
    const { data: jobData, error: jobError } = await supabase.from("takeoff_jobs" as never).select(JOB_SELECT as never)
      .eq("tenant_id" as never, tenantId as never).eq("id" as never, input.jobId as never)
      .eq("project_id" as never, input.projectId as never).is("estimate_version_id" as never, null)
      .in("status" as never, ["completed", "applied"] as never).order("created_at" as never, { ascending: true });
    if (jobError) failed("Impossible de lire les jobs de la version pour les règles.", jobError);
    jobs = (jobData ?? []) as unknown as JobRow[];
  } else {
    ({ jobs, carried } = await readVersionPeerJobs(supabase, tenantId, estimateVersionId));
  }
  const evaluated = await evaluateRulesOfJobs({ supabase, tenantId, jobs, surfaceVersionId: estimateVersionId ?? null });
  if (!evaluated) return EMPTY_RECOMPUTATION;
  const { items, geometries, evaluation, status, lines } = evaluated;

  // Each line as read: its updated_at and when it was last made stale (a partner's later edit keeps it stale).
  const writes: RuleResultWrite[] = [];
  const transforms: Array<{ item_id: string; transform: TakeoffFrameTransform | null }> = [];
  let unbounded = 0;
  for (const { item, inputs } of items) {
    // A takeoff carried over from the version this one copies is a partner, written by its own version only.
    if (inputs === null || status.get(item.job_id) !== "completed" || carried.has(item.job_id)) continue;
    const stored = geometries.get(item.id);
    if (stored) {
      const transform = evaluation.transforms.get(stored.page) ?? null;
      if (!sameJson(stored.geometry.transform, transform)) transforms.push({ item_id: item.id, transform });
    }
    // Results that cannot be bounded to the column (TI-677; schema-valid results always are) are not written: the line
    // keeps its stored state, and the rest of the version is written.
    let payload: ReturnType<typeof prepareRuleResultWrite>;
    try {
      const results = evaluation.results.get(item.id) ?? [];
      payload = prepareRuleResultWrite(estimateVersionId === undefined ? results.map((result) => {
        if (result.rule !== "zone_overlap" && result.rule !== "zone_coverage") return result;
        return { ...result, reason: `Dans ce métré : ${result.reason}`,
          details: { ...result.details, evaluation_scope: "job", cross_job_comparison: "deferred" } };
      }) : results);
    } catch {
      unbounded += 1;
      continue;
    }
    if (item.rules_stale || item.rules_evaluated_at === null || !sameJson(item.rule_results, payload.results)) {
      writes.push({ id: item.id, ...payload, expected_updated_at: item.updated_at, expected_stale_at: item.rules_stale_at });
    }
  }
  if (unbounded > 0) {
    console.error("takeoff.rules.results_unbounded", { tenant_id: input.tenantId, estimate_version_id: input.estimateVersionId, lines: unbounded });
  }
  const { written, reopened } = await writeTakeoffRuleResultChunks({
    ...input, supabase, writes, transforms, stamp });
  if (reopened > 0) {
    console.info("takeoff.rules.reopened", { tenant_id: input.tenantId, estimate_version_id: input.estimateVersionId, lines: reopened });
  }
  return { lines: lines.length, written, skipped: writes.length - written, reopened };
}

const JOB_SELECT = "id, status, created_at, sources:preparation_snapshot->preparation->sources";

/**
 * The takeoffs a version's lines come from, completed or applied, oldest first: those attached to it and those a copy
 * carried over to it (takeoff_version_links), still attached to the version they were applied to. `carried` names the
 * latter: their lines are read as partners and never written from this version.
 */
async function readVersionPeerJobs(supabase: ServiceClient, tenantId: string, versionId: string) {
  // Read in full, page by page: beyond PostgREST's ceiling of rows a peer left out would never be compared, while the
  // send's stamp (takeoff_send_peers_stamp) covers them all.
  const attached = await readAllRows(() => supabase.from("takeoff_jobs" as never).select(JOB_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, tenantId as never).eq("estimate_version_id" as never, versionId as never)
    .in("status" as never, ["completed", "applied"] as never));
  if (attached.error) failed("Impossible de lire les métrés du devis pour les règles.", attached.error);
  const links = await readAllRows(() => supabase.from("takeoff_version_links" as never).select("id, takeoff_job_id" as never, { count: "exact" })
    .eq("tenant_id" as never, tenantId as never).eq("target_version_id" as never, versionId as never));
  if (links.error) failed("Impossible de lire les métrés reportés sur le devis.", links.error);
  const own = (attached.data ?? []) as unknown as JobRow[];
  const linkedIds = [...new Set(((links.data ?? []) as unknown as Array<{ takeoff_job_id: string }>).map((link) => link.takeoff_job_id))]
    .filter((id) => !own.some((job) => job.id === id));
  let linked: JobRow[] = [];
  if (linkedIds.length > 0) {
    const read = await readAllRowsInChunks(linkedIds, (chunk) => supabase.from("takeoff_jobs" as never)
      .select(JOB_SELECT as never, { count: "exact" }).eq("tenant_id" as never, tenantId as never).in("id" as never, chunk as never)
      .in("status" as never, ["completed", "applied"] as never));
    if (read.error) failed("Impossible de lire les métrés reportés sur le devis.", read.error);
    linked = (read.data ?? []) as unknown as JobRow[];
  }
  const jobs = [...own, ...linked].sort((left, right) => (left.created_at < right.created_at ? -1 : left.created_at > right.created_at ? 1
    : left.id < right.id ? -1 : 1));
  return { jobs, carried: new Set(linked.map((job) => job.id)) };
}

/**
 * Reads the lines, vector pages and geometries of these jobs (and, for a version, its DPGF lines for the surface
 * control) and evaluates the fixed rules on them together. Null when no line carries rule inputs. `planLevels`: the
 * level an operator set for a plan revision a job read (`${job_id}|${plan_file_id}`), the level of a page whose own
 * reading gives none (lot 3, migration C: a send's evaluation only); a page's own level always comes first.
 */
async function evaluateRulesOfJobs(input: { supabase: ServiceClient; tenantId: string; jobs: JobRow[]; surfaceVersionId: string | null;
  planLevels?: ReadonlyMap<string, string> }) {
  const { supabase, tenantId, jobs } = input;
  if (jobs.length === 0) return null;
  const jobIds = jobs.map((job) => job.id);

  // By chunks of identifiers: the peers of a destination can be a thousand, more than one request's URL holds.
  const { data: itemData, error: itemError } = await readAllRowsInChunks(jobIds, (chunk) => supabase.from("takeoff_items" as never)
    .select(("id, job_id, designation, unit, quantity, is_excluded, exclusion_reason, updated_at, metadata, source_file_name, source_page, "
      + "rule_results, rules_stale, rules_stale_at, rules_evaluated_at, quantity_entry_category, is_verified") as never, { count: "exact" })
    .eq("tenant_id" as never, tenantId as never).in("job_id" as never, chunk as never));
  if (itemError) failed("Impossible de lire les lignes de la version pour les règles.", itemError as { message?: string });
  const items = ((itemData ?? []) as unknown as ItemRow[]).map((item) => ({ item, inputs: readRuleInputs(item.metadata) }));
  if (!items.some(({ inputs }) => inputs !== null)) return null;

  const jobOrder = new Map(jobs.map((job, index) => [job.id, index]));
  const status = new Map(jobs.map((job) => [job.id, job.status]));
  const sources = new Map(jobs.map((job): [string, PageDocumentSource[] | null] => {
    const parsed = SourcesSchema.safeParse(job.sources);
    return [job.id, parsed.success ? parsed.data : null];
  }));
  const vectorJobs = [...new Set(items.filter(({ inputs }) => inputs !== null).map(({ item }) => item.job_id))];
  const { data: pageData, error: pageError } = await readAllRowsInChunks(vectorJobs, (chunk) => supabase.from("takeoff_vector_pages" as never)
    .select("id, job_id, plan_file_id, source_file_name, source_page, reading, rule_anchors" as never, { count: "exact" })
    .eq("tenant_id" as never, tenantId as never).in("job_id" as never, chunk as never));
  if (pageError) failed("Impossible de lire les pages vectorielles pour les règles.", pageError as { message?: string });
  const geometries = new Map((await readGeometries(supabase, tenantId, vectorJobs)).flatMap((row) => {
    const geometry = VectorItemGeometrySchema.safeParse(row.geometry);
    return geometry.success ? [[row.takeoff_item_id, { page: row.vector_page_id, geometry: geometry.data }] as const] : [];
  }));

  const pages: RulePage[] = [];
  const candidates: RulePageCandidate[] = [];
  for (const row of (pageData ?? []) as unknown as PageRow[]) {
    const reading = VectorPageRecordSchema.safeParse(row.reading);
    const anchors = AnchorsSchema.safeParse(row.rule_anchors);
    const planLevel = row.plan_file_id ? input.planLevels?.get(`${row.job_id}|${row.plan_file_id}`) ?? null : null;
    pages.push({
      key: row.id, job_id: row.job_id, order: (jobOrder.get(row.job_id) ?? 0) * 10_000 + row.source_page,
      level: (reading.success ? reading.data.location.level : null) ?? planLevel,
      zone: reading.success ? reading.data.location.zone : null,
      scale: reading.success ? { status: reading.data.scale.status, reason: reading.data.scale.reason } : null,
      denominator: reading.success ? reading.data.scale.denominator : null, anchors: anchors.success ? anchors.data : null,
      // TI-682 (lot D): the plan page it reads, by its document (a plan file, or the job's upload) and its job's preparation.
      identity: takeoffLinePageIdentity({ source_file_name: row.source_file_name, source_page: row.source_page,
        source_document: row.plan_file_id ? { kind: "plan_file", plan_file_id: row.plan_file_id } : { kind: "job_upload", job_id: row.job_id } },
      sources.get(row.job_id)),
    });
    candidates.push({ id: row.id, job_id: row.job_id, plan_file_id: row.plan_file_id ?? null, source_file_name: row.source_file_name,
      source_page: row.source_page, scale_mismatch: reading.success && reading.data.scale.reason === "dimension_mismatch" });
  }

  const lines: RuleLine[] = items.filter(({ inputs }) => inputs !== null).map(({ item, inputs }) => {
    const stored = geometries.get(item.id);
    return {
      id: item.id, job_id: item.job_id, designation: item.designation, unit: item.unit, quantity: Number(item.quantity),
      is_excluded: item.is_excluded, unselected_vector: Boolean(stored) && isUnselectedVectorReading(item), frozen: status.get(item.job_id) === "applied",
      // TI-686 D12: an entry is a quantity attested with its category, which survives the deletion of its author.
      quantity_entered: item.quantity_entry_category != null,
      inputs,
      // A line read by the model belongs to the vector page of its own document and page, when the job read one (scale rule).
      page_key: stored?.page ?? ruleLinePage(item, candidates),
      geometry: stored ? { segments_m: stored.geometry.segments_m, polygon_m: stored.geometry.polygon_m, holes_m: stored.geometry.holes_m ?? null,
        length_m: stored.geometry.length_m, area_m2: stored.geometry.area_m2 } : null,
    };
  });
  let quantityLines = lines;
  const estimateVersionId = input.surfaceVersionId;
  if (estimateVersionId !== null && lines.some(line => line.inputs?.kind === "surface")) {
    const [targets, links] = await Promise.all([
      readAllRows(() => supabase.from("estimate_items").select("id,title,description,source_metadata", { count: "exact" })
        .eq("tenant_id", tenantId).eq("version_id", estimateVersionId).eq("source_provider", "dpgf").eq("item_type", "line")),
      readAllRows(() => supabase.from("takeoff_dpgf_links").select("takeoff_item_id,estimate_item_id", { count: "exact" })
        .eq("tenant_id", tenantId).eq("version_id", estimateVersionId)),
    ]);
    if (targets.error) failed("Impossible de lire les lignes de prix pour le contrôle des surfaces.", targets.error);
    if (links.error) failed("Impossible de lire les rattachements des surfaces.", links.error);
    quantityLines = withQuantityLineGroups(lines, (targets.data ?? []) as QuantityTargetLine[], (links.data ?? []) as QuantityLineLink[]);
  }
  const evaluation = evaluateTakeoffRules({ lines: quantityLines, pages });

  return { items, geometries, evaluation, status, lines };
}

export type RuleResultWrite = { id: string; results: TakeoffRuleResult[]; complete_failure_keys?: string[]; expected_updated_at: string; expected_stale_at: string | null };

/**
 * Writes a computation's results by chunks. A chunk whose write moves a line (a verified line reopened, failures that
 * grow: TI-677 PR D) moves the version's stamp: the writer returns the stamp after its own writes, and the next chunk
 * checks that one (with the stamp read before the computation it would write nothing). Returns the lines written.
 */
export async function writeTakeoffRuleResultChunks(input: TakeoffRuleScope & {
  supabase: ServiceClient;
  tenantId: string;
  writes: readonly RuleResultWrite[];
  transforms: ReadonlyArray<{ item_id: string; transform: TakeoffFrameTransform | null }>;
  stamp: string;
  chunk?: number;
}) {
  const forJob = input.estimateVersionId === undefined;
  const size = Math.min(input.chunk ?? TAKEOFF_RULES_WRITE_CHUNK, forJob ? 250 : TAKEOFF_RULES_WRITE_CHUNK);
  const scope = forJob
    ? { p_tenant_id: input.tenantId, p_project_id: input.projectId, p_job_id: input.jobId }
    : { p_tenant_id: input.tenantId, p_estimate_version_id: input.estimateVersionId };
  let stamp = input.stamp;
  let written = 0;
  let reopened = 0;
  let offset = 0;
  let transformOffset = 0;
  while (offset < input.writes.length || transformOffset < input.transforms.length) {
    // A dense overlap can have thousands of partners per item. Split unusually large proof payloads
    // (ASCII keys plus quotes/separators) without imposing a limit on the identities of a single item.
    let end = offset;
    let proofBytes = 0;
    while (end < input.writes.length && end - offset < size) {
      const bytes = input.writes[end].complete_failure_keys?.reduce((sum, key) => sum + key.length + 3, 0) ?? 0;
      if (end > offset && proofBytes + bytes > 1024 * 1024) break;
      proofBytes += bytes;
      end++;
    }
    const { data, error } = await input.supabase.rpc((forJob ? "write_takeoff_job_rule_results" : "write_takeoff_rule_results") as never, {
      ...scope,
      p_items: input.writes.slice(offset, end), p_transforms: input.transforms.slice(transformOffset, transformOffset + size), p_stamp: stamp,
    } as never);
    if (error) failed("Impossible d’enregistrer les résultats des règles.", error);
    const rows = Array.isArray(data) ? (data as Array<{ version_stamp?: unknown; reopened?: boolean }>) : [];
    written += rows.length;
    reopened += rows.filter((row) => row.reopened === true).length;
    const next = rows[0]?.version_stamp;
    if (typeof next === "string") stamp = next;
    offset = end;
    transformOffset += size;
  }
  return { written, reopened };
}

/** The same computation, never throwing: logged, for callers that go on without it (the stored state still blocks). */
export async function recomputeTakeoffRulesQuietly(input: TakeoffRuleRecomputeInput & { context: string }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const outcome = await recomputeTakeoffRules(input);
      if (outcome.skipped === 0 || attempt === 2) return outcome;
    } catch (error) {
      console.error("takeoff.rules.recompute_failed", {
        tenant_id: input.tenantId, estimate_version_id: input.estimateVersionId, context: input.context, attempt,
        message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
      });
    }
  }
  return null;
}

const uuidString = z.string().uuid();

/**
 * What a send's controls read besides the takeoff and its destination (lot 3, migration C), as the database computes it
 * (public.read_takeoff_send_context), never computed here: for an analysis of one plan, the readable analyses of the
 * affaire's other plans (its peers); each plan revision read with the operator's location; the two stamps the send
 * compares again under its locks; and what the preview shows of it (a request's plans not read yet, by name and state).
 */
export const TakeoffSendContextSchema = z.object({
  peers: z.array(z.object({ job_id: uuidString, stamp: z.string().nullable() })),
  plans: z.array(z.object({
    job_id: uuidString, plan_file_id: uuidString.nullable(), content_hash: z.string(),
    location: z.object({ id: uuidString, revision: z.number().int().positive(), building_choice: z.string(), building: z.string().nullable(),
      level_choice: z.string(), level: z.string().nullable() }).nullable(),
  })),
  stamps: z.object({ peers: z.string(), locations: z.string() }),
  display: z.object({
    request_id: uuidString,
    plan_name: z.string().nullable(),
    peers: z.array(z.object({ job_id: uuidString, plan_name: z.string().nullable() })),
    unread: z.array(z.object({ plan_name: z.string().nullable(), state: z.enum(["queued", "running", "failed", "canceled", "not_started"]) })),
    never_read: z.array(z.string().nullable()),
    uncompared_readings: z.number().int().nonnegative(),
  }).nullable(),
});
export type TakeoffSendContext = z.infer<typeof TakeoffSendContextSchema>;

/** The level an operator set for each plan revision of the context (`${job_id}|${plan_file_id}`): « À préciser » sets none. */
export function takeoffSendPlanLevels(context: Pick<TakeoffSendContext, "plans">) {
  const levels = new Map<string, string>();
  for (const plan of context.plans) {
    if (plan.plan_file_id && plan.location?.level_choice === "value" && plan.location.level) {
      levels.set(`${plan.job_id}|${plan.plan_file_id}`, plan.location.level);
    }
  }
  return levels;
}

/**
 * Lot 2 M2: the rules of a takeoff of an affaire evaluated against the destination it is about to be sent to, without
 * writing anything. The cross-job controls (zone overlap, coverage) read the takeoffs the destination version already
 * holds, the surface control its DPGF lines; a first draft holds none, so the evaluation is complete, never deferred.
 * Lot 3 (migration C): they also read, for an analysis of one plan, the readable analyses of the affaire's other plans
 * (its peers, never written from here), and a page without a level of its own takes the level an operator set for its
 * plan revision. The stamps are read before the lines: the send command compares them again under its locks, so a change
 * after this reading refuses the send instead of writing results computed from an older state. Every line with rule
 * inputs gets its results (written by the send command in its transaction), whether or not they differ from the stored
 * ones.
 */
export async function evaluateTakeoffRulesForDestination(input: {
  tenantId: string;
  projectId: string;
  jobId: string;
  destinationVersionId: string | null;
  supabase?: ServiceClient;
}): Promise<{
  jobStamp: string | null;
  /** The destination's takeoffs, attached or carried over (takeoff_send_peers_stamp), as the send checks them again. */
  peersStamp: string | null;
  /** The plans read besides the destination's, and their locations, with the stamps the send checks them again by. */
  context: TakeoffSendContext;
  writes: RuleResultWrite[];
  transforms: Array<{ item_id: string; transform: TakeoffFrameTransform | null }>;
  /** The results of this takeoff's lines that carry rule inputs; empty when none does (nothing was evaluated). */
  results: Map<string, TakeoffRuleResult[]>;
}> {
  const supabase = input.supabase ?? createServiceRoleClient();
  const { data: jobStamp, error: jobStampError } = await supabase.rpc("takeoff_rule_job_stamp" as never,
    { p_tenant_id: input.tenantId, p_project_id: input.projectId, p_job_id: input.jobId } as never);
  if (jobStampError || (jobStamp !== null && typeof jobStamp !== "string")) {
    failed("Impossible de lire l’état du métré pour les règles.", jobStampError);
  }
  let peersStamp: string | null = null;
  if (input.destinationVersionId) {
    const { data, error } = await supabase.rpc("takeoff_send_peers_stamp" as never,
      { p_tenant_id: input.tenantId, p_version_id: input.destinationVersionId } as never);
    if (error || typeof data !== "string") failed("Impossible de lire l’état du devis pour les règles.", error);
    peersStamp = data;
  }
  const { data: contextData, error: contextError } = await supabase.rpc("read_takeoff_send_context" as never, {
    p_tenant_id: input.tenantId, p_project_id: input.projectId, p_job_id: input.jobId,
    p_version_id: input.destinationVersionId } as never);
  const parsedContext = TakeoffSendContextSchema.safeParse(contextData);
  if (contextError || !parsedContext.success) failed("Impossible de lire les autres plans de l’affaire pour les règles.", contextError);
  const context = parsedContext.data;
  const empty = { jobStamp: jobStamp as string | null, peersStamp, context, writes: [], transforms: [], results: new Map() };
  if (jobStamp === null) return empty;

  const own = await supabase.from("takeoff_jobs" as never).select(JOB_SELECT as never)
    .eq("tenant_id" as never, input.tenantId as never).eq("id" as never, input.jobId as never)
    .eq("project_id" as never, input.projectId as never).is("estimate_version_id" as never, null)
    .eq("status" as never, "completed" as never);
  if (own.error) failed("Impossible de lire le métré pour les règles.", own.error);
  // The destination's peers: the takeoffs its lines come from, attached to it or carried over by the copy it is (or will
  // be, for a copy: those of the version it copies).
  const peers = input.destinationVersionId ? (await readVersionPeerJobs(supabase, input.tenantId, input.destinationVersionId)).jobs : [];
  // The affaire's other plans already read (a per-plan analysis only), as the context named them: each completed, without
  // a version; one that was sent or changed meanwhile is no longer what the stamp says, and the send refuses.
  const planPeerIds = context.peers.map((peer) => peer.job_id);
  let planPeers: JobRow[] = [];
  if (planPeerIds.length > 0) {
    const read = await readAllRowsInChunks(planPeerIds, (chunk) => supabase.from("takeoff_jobs" as never)
      .select(JOB_SELECT as never, { count: "exact" }).eq("tenant_id" as never, input.tenantId as never)
      .eq("project_id" as never, input.projectId as never).in("id" as never, chunk as never)
      .is("estimate_version_id" as never, null).eq("status" as never, "completed" as never));
    if (read.error) failed("Impossible de lire les autres plans de l’affaire pour les règles.", read.error);
    planPeers = ((read.data ?? []) as unknown as JobRow[]).sort((left, right) => (left.created_at < right.created_at ? -1
      : left.created_at > right.created_at ? 1 : left.id < right.id ? -1 : 1));
  }
  const jobs = [...peers, ...planPeers, ...((own.data ?? []) as unknown as JobRow[])];
  const evaluated = await evaluateRulesOfJobs({ supabase, tenantId: input.tenantId, jobs, surfaceVersionId: input.destinationVersionId,
    planLevels: takeoffSendPlanLevels(context) });
  if (!evaluated) return empty;
  const { items, geometries, evaluation } = evaluated;
  const writes: RuleResultWrite[] = [];
  const transforms: Array<{ item_id: string; transform: TakeoffFrameTransform | null }> = [];
  const results = new Map<string, TakeoffRuleResult[]>();
  for (const { item, inputs } of items) {
    if (inputs === null || item.job_id !== input.jobId) continue;
    const stored = geometries.get(item.id);
    if (stored) {
      const transform = evaluation.transforms.get(stored.page) ?? null;
      if (!sameJson(stored.geometry.transform, transform)) transforms.push({ item_id: item.id, transform });
    }
    // Unlike a recomputation, a line whose results cannot be bounded is not left as it was: its stored, deferred
    // results would then pass for an evaluation of this destination. The send is refused instead.
    const payload = prepareRuleResultWrite(evaluation.results.get(item.id) ?? []);
    results.set(item.id, payload.results);
    writes.push({ id: item.id, ...payload, expected_updated_at: item.updated_at, expected_stale_at: item.rules_stale_at });
  }
  return { jobStamp: jobStamp as string, peersStamp, context, writes, transforms, results };
}
