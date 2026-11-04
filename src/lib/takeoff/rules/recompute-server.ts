import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { readAllRows } from "@/lib/supabase/read-all";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { boundRuleResults, readRuleInputs } from "@/lib/takeoff/rules/contracts";
import { evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import type { PageAnchors } from "@/lib/takeoff/rules/registration";
import { ruleLinePage, type RulePageCandidate } from "@/lib/takeoff/rules/recompute-pages";
import type { TakeoffFrameTransform, TakeoffRuleResult } from "@/lib/takeoff/rules/types";
import { VectorItemGeometrySchema, VectorPageRecordSchema } from "@/lib/takeoff/vectors/persistence";
import type { Database } from "@/types/database";

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
// bounded before they are written (boundRuleResults), so every read accepts them.

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
  rules_evaluated_at: string | null; quantity_entered_by: string | null;
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

export type TakeoffRulesRecomputation = { lines: number; written: number; skipped: number };

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
  if (jobs.length === 0) return { lines: 0, written: 0, skipped: 0 };
  const jobIds = jobs.map((job) => job.id);

  const { data: itemData, error: itemError } = await readAllRows(() => supabase.from("takeoff_items" as never)
    .select(("id, job_id, designation, unit, quantity, is_excluded, updated_at, metadata, source_file_name, source_page, "
      + "rule_results, rules_stale, rules_stale_at, rules_evaluated_at, quantity_entered_by") as never, { count: "exact" })
    .eq("tenant_id" as never, input.tenantId as never).in("job_id" as never, jobIds as never));
  if (itemError) failed("Impossible de lire les lignes de la version pour les règles.", itemError as { message?: string });
  const items = ((itemData ?? []) as unknown as ItemRow[]).map((item) => ({ item, inputs: readRuleInputs(item.metadata) }));
  if (!items.some(({ inputs }) => inputs !== null)) return { lines: 0, written: 0, skipped: 0 };

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
  const evaluation = evaluateTakeoffRules({ lines, pages });

  // Each line as read: its updated_at and when it was last made stale (a partner's later edit keeps it stale).
  const writes: Array<{ id: string; results: TakeoffRuleResult[]; expected_updated_at: string; expected_stale_at: string | null }> = [];
  const transforms: Array<{ item_id: string; transform: TakeoffFrameTransform | null }> = [];
  for (const { item, inputs } of items) {
    if (inputs === null || status.get(item.job_id) !== "completed") continue;
    const results = boundRuleResults(evaluation.results.get(item.id) ?? []);
    if (item.rules_stale || item.rules_evaluated_at === null || !sameJson(item.rule_results, results)) {
      writes.push({ id: item.id, results, expected_updated_at: item.updated_at, expected_stale_at: item.rules_stale_at });
    }
    const stored = geometries.get(item.id);
    if (stored) {
      const transform = evaluation.transforms.get(stored.page) ?? null;
      if (!sameJson(stored.geometry.transform, transform)) transforms.push({ item_id: item.id, transform });
    }
  }
  let written = 0;
  for (let offset = 0; offset < Math.max(writes.length, transforms.length); offset += TAKEOFF_RULES_WRITE_CHUNK) {
    const { data, error } = await supabase.rpc("write_takeoff_rule_results" as never, {
      p_tenant_id: input.tenantId, p_estimate_version_id: input.estimateVersionId,
      p_items: writes.slice(offset, offset + TAKEOFF_RULES_WRITE_CHUNK),
      p_transforms: transforms.slice(offset, offset + TAKEOFF_RULES_WRITE_CHUNK), p_stamp: stamp,
    } as never);
    if (error) failed("Impossible d’enregistrer les résultats des règles.", error);
    written += Array.isArray(data) ? (data as unknown[]).length : 0;
  }
  return { lines: lines.length, written, skipped: writes.length - written };
}

/** The same computation, never throwing: logged, for callers that go on without it (the stored state still blocks). */
export async function recomputeTakeoffRulesQuietly(input: { tenantId: string; estimateVersionId: string; context: string;
  supabase?: ServiceClient }) {
  try {
    return await recomputeTakeoffRulesForVersion(input);
  } catch (error) {
    console.error("takeoff.rules.recompute_failed", {
      tenant_id: input.tenantId, estimate_version_id: input.estimateVersionId, context: input.context,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 500),
    });
    return null;
  }
}
