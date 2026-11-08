import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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

/** Rule inputs are written on new jobs' lines only when the worker runs with MERGEONE_TAKEOFF_RULES=1. */
export function isTakeoffRulesEnabled() {
  return process.env.MERGEONE_TAKEOFF_RULES === "1";
}

const AnchorsSchema: z.ZodType<PageAnchors> = z.object({
  version: z.number().int().positive(),
  texts: z.array(z.tuple([z.string(), z.number().finite(), z.number().finite()])),
  lines: z.array(z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()])),
});

type JobRow = { id: string; status: string; created_at: string };
type ItemRow = {
  id: string; job_id: string; designation: string; unit: string; quantity: number; is_excluded: boolean; updated_at: string;
  metadata: unknown; source_file_name: string | null; source_page: number | null; rule_results: unknown; rules_stale: boolean;
  rules_stale_at: string | null;
  rules_evaluated_at: string | null; quantity_entered_by: string | null; is_verified: boolean;
};
type PageRow = { id: string; job_id: string; plan_file_id: string | null; source_file_name: string | null; source_page: number; reading: unknown;
  rule_anchors: unknown };
type GeometryRow = { takeoff_item_id: string; job_id: string; vector_page_id: string; geometry: unknown };

function failed(message: string, error: { message?: string } | null): never {
  throw new Error(`${message} (${error?.message ?? "erreur inconnue"})`);
}

async function readGeometries(supabase: ServiceClient, tenantId: string, jobIds: readonly string[]) {
  const rows: GeometryRow[] = [];
  for (let offset = 0; ; offset += GEOMETRY_PAGE) {
    const { data, error } = await supabase.from("takeoff_item_geometries" as never)
      .select("takeoff_item_id, job_id, vector_page_id, geometry" as never)
      .eq("tenant_id" as never, tenantId as never).in("job_id" as never, jobIds as never)
      .order("takeoff_item_id" as never, { ascending: true }).range(offset, offset + GEOMETRY_PAGE - 1);
    if (error) failed("Impossible de lire la géométrie des lignes pour les règles.", error);
    rows.push(...((data ?? []) as unknown as GeometryRow[]));
    if ((data ?? []).length < GEOMETRY_PAGE) return rows;
  }
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
export async function recomputeTakeoffRulesForVersion(input: {
  tenantId: string;
  estimateVersionId: string;
  supabase?: ServiceClient;
}): Promise<TakeoffRulesRecomputation> {
  const supabase = input.supabase ?? createServiceRoleClient();
  // Independent of the worker flag: existing rule inputs stay protected after it is off.
  const { data: hasInputs, error: presenceError } = await supabase.rpc("takeoff_rule_version_has_inputs" as never, {
    p_tenant_id: input.tenantId, p_estimate_version_id: input.estimateVersionId,
  } as never);
  if (presenceError || typeof hasInputs !== "boolean") failed("Impossible de vérifier la présence de règles.", presenceError);
  if (!hasInputs) return { lines: 0, written: 0, skipped: 0, reopened: 0 };
  // The version as this computation reads it: the writer writes nothing if it changed meanwhile.
  const { data: stamp, error: stampError } = await supabase.rpc("takeoff_rule_version_stamp" as never, {
    p_tenant_id: input.tenantId, p_estimate_version_id: input.estimateVersionId,
  } as never);
  if (stampError || typeof stamp !== "string") failed("Impossible de lire l’état de la version pour les règles.", stampError);
  const { data: jobData, error: jobError } = await supabase.from("takeoff_jobs" as never)
    .select("id, status, created_at" as never)
    .eq("tenant_id" as never, input.tenantId as never).eq("estimate_version_id" as never, input.estimateVersionId as never)
    .in("status" as never, ["completed", "applied"] as never).order("created_at" as never, { ascending: true });
  if (jobError) failed("Impossible de lire les jobs de la version pour les règles.", jobError);
  const jobs = (jobData ?? []) as unknown as JobRow[];
  if (jobs.length === 0) return { lines: 0, written: 0, skipped: 0, reopened: 0 };
  const jobIds = jobs.map((job) => job.id);

  const { data: itemData, error: itemError } = await readAllRows(() => supabase.from("takeoff_items" as never)
    .select(("id, job_id, designation, unit, quantity, is_excluded, updated_at, metadata, source_file_name, source_page, "
      + "rule_results, rules_stale, rules_stale_at, rules_evaluated_at, quantity_entered_by, is_verified") as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never).in("job_id" as never, jobIds as never));
  if (itemError) failed("Impossible de lire les lignes de la version pour les règles.", itemError as { message?: string });
  const items = ((itemData ?? []) as unknown as ItemRow[]).map((item) => ({ item, inputs: readRuleInputs(item.metadata) }));
  if (!items.some(({ inputs }) => inputs !== null)) return { lines: 0, written: 0, skipped: 0, reopened: 0 };

  const jobOrder = new Map(jobs.map((job, index) => [job.id, index]));
  const status = new Map(jobs.map((job) => [job.id, job.status]));
  const vectorJobs = [...new Set(items.filter(({ inputs }) => inputs !== null).map(({ item }) => item.job_id))];
  const { data: pageData, error: pageError } = await readAllRows(() => supabase.from("takeoff_vector_pages" as never)
    .select("id, job_id, plan_file_id, source_file_name, source_page, reading, rule_anchors" as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never).in("job_id" as never, vectorJobs as never));
  if (pageError) failed("Impossible de lire les pages vectorielles pour les règles.", pageError as { message?: string });
  const geometries = new Map((await readGeometries(supabase, input.tenantId, vectorJobs)).flatMap((row) => {
    const geometry = VectorItemGeometrySchema.safeParse(row.geometry);
    return geometry.success ? [[row.takeoff_item_id, { page: row.vector_page_id, geometry: geometry.data }] as const] : [];
  }));

  const pages: RulePage[] = [];
  const candidates: RulePageCandidate[] = [];
  for (const row of (pageData ?? []) as unknown as PageRow[]) {
    const reading = VectorPageRecordSchema.safeParse(row.reading);
    const anchors = AnchorsSchema.safeParse(row.rule_anchors);
    pages.push({
      key: row.id, job_id: row.job_id, order: (jobOrder.get(row.job_id) ?? 0) * 10_000 + row.source_page,
      level: reading.success ? reading.data.location.level : null, zone: reading.success ? reading.data.location.zone : null,
      scale: reading.success ? { status: reading.data.scale.status, reason: reading.data.scale.reason } : null,
      denominator: reading.success ? reading.data.scale.denominator : null, anchors: anchors.success ? anchors.data : null,
    });
    candidates.push({ id: row.id, job_id: row.job_id, plan_file_id: row.plan_file_id ?? null, source_file_name: row.source_file_name,
      source_page: row.source_page, scale_mismatch: reading.success && reading.data.scale.reason === "dimension_mismatch" });
  }

  const lines: RuleLine[] = items.filter(({ inputs }) => inputs !== null).map(({ item, inputs }) => {
    const stored = geometries.get(item.id);
    return {
      id: item.id, job_id: item.job_id, designation: item.designation, unit: item.unit, quantity: Number(item.quantity),
      is_excluded: item.is_excluded, frozen: status.get(item.job_id) === "applied", quantity_entered: item.quantity_entered_by !== null,
      inputs,
      // A line read by the model belongs to the vector page of its own document and page, when the job read one (scale rule).
      page_key: stored?.page ?? ruleLinePage(item, candidates),
      geometry: stored ? { segments_m: stored.geometry.segments_m, polygon_m: stored.geometry.polygon_m, holes_m: stored.geometry.holes_m ?? null,
        length_m: stored.geometry.length_m, area_m2: stored.geometry.area_m2 } : null,
    };
  });
  let quantityLines = lines;
  if (lines.some(line => line.inputs?.kind === "surface")) {
    const [targets, links] = await Promise.all([
      readAllRows(() => supabase.from("estimate_items").select("id,title,description,source_metadata", { count: "exact" })
        .eq("tenant_id", input.tenantId).eq("version_id", input.estimateVersionId).eq("source_provider", "dpgf").eq("item_type", "line")),
      readAllRows(() => supabase.from("takeoff_dpgf_links").select("takeoff_item_id,estimate_item_id", { count: "exact" })
        .eq("tenant_id", input.tenantId).eq("version_id", input.estimateVersionId)),
    ]);
    if (targets.error) failed("Impossible de lire les lignes de prix pour le contrôle des surfaces.", targets.error);
    if (links.error) failed("Impossible de lire les rattachements des surfaces.", links.error);
    quantityLines = withQuantityLineGroups(lines, (targets.data ?? []) as QuantityTargetLine[], (links.data ?? []) as QuantityLineLink[]);
  }
  const evaluation = evaluateTakeoffRules({ lines: quantityLines, pages });

  // Each line as read: its updated_at and when it was last made stale (a partner's later edit keeps it stale).
  const writes: RuleResultWrite[] = [];
  const transforms: Array<{ item_id: string; transform: TakeoffFrameTransform | null }> = [];
  let unbounded = 0;
  for (const { item, inputs } of items) {
    if (inputs === null || status.get(item.job_id) !== "completed") continue;
    const stored = geometries.get(item.id);
    if (stored) {
      const transform = evaluation.transforms.get(stored.page) ?? null;
      if (!sameJson(stored.geometry.transform, transform)) transforms.push({ item_id: item.id, transform });
    }
    // Results that cannot be bounded to the column (TI-677; schema-valid results always are) are not written: the line
    // keeps its stored state, and the rest of the version is written.
    let payload: ReturnType<typeof prepareRuleResultWrite>;
    try {
      payload = prepareRuleResultWrite(evaluation.results.get(item.id) ?? []);
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
  const { written, reopened } = await writeTakeoffRuleResultChunks({ supabase, tenantId: input.tenantId,
    estimateVersionId: input.estimateVersionId, writes, transforms, stamp });
  if (reopened > 0) {
    console.info("takeoff.rules.reopened", { tenant_id: input.tenantId, estimate_version_id: input.estimateVersionId, lines: reopened });
  }
  return { lines: lines.length, written, skipped: writes.length - written, reopened };
}

type RuleResultWrite = { id: string; results: TakeoffRuleResult[]; complete_failure_keys?: string[]; expected_updated_at: string; expected_stale_at: string | null };

/**
 * Writes a computation's results by chunks. A chunk whose write moves a line (a verified line reopened, failures that
 * grow: TI-677 PR D) moves the version's stamp: the writer returns the stamp after its own writes, and the next chunk
 * checks that one (with the stamp read before the computation it would write nothing). Returns the lines written.
 */
export async function writeTakeoffRuleResultChunks(input: {
  supabase: ServiceClient;
  tenantId: string;
  estimateVersionId: string;
  writes: readonly RuleResultWrite[];
  transforms: ReadonlyArray<{ item_id: string; transform: TakeoffFrameTransform | null }>;
  stamp: string;
  chunk?: number;
}) {
  const size = input.chunk ?? TAKEOFF_RULES_WRITE_CHUNK;
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
    const { data, error } = await input.supabase.rpc("write_takeoff_rule_results" as never, {
      p_tenant_id: input.tenantId, p_estimate_version_id: input.estimateVersionId,
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
export async function recomputeTakeoffRulesQuietly(input: { tenantId: string; estimateVersionId: string; context: string;
  supabase?: ServiceClient }) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const outcome = await recomputeTakeoffRulesForVersion(input);
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
