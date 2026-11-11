import "server-only";

import { z } from "zod";

import { mapSupabaseError } from "@/lib/estimates/errors";
import { readAllRows, readAllRowsInChunks } from "@/lib/supabase/read-all";
import { excludeDpgfOutOfScope, plannedExclusions } from "@/lib/takeoff/apply-plan-exclusions";
import { loadTakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { hasTakeoffDpgfTargetLines } from "@/lib/takeoff/dpgf-comparison-repository";
import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import { TakeoffErrorCode, toTakeoffError } from "@/lib/takeoff/errors";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow, type AuthenticatedTakeoffContext } from "@/lib/takeoff/job-read-server";
import { buildTakeoffMappingPreviewForJob } from "@/lib/takeoff/mapping-preview-server";
import {
  estimateLineTakeoffItemIds,
  findPagesAlreadyInEstimate,
  takeoffLinePageIdentity,
  type EarlierTakeoffLine,
  type EstimateLineProvenance,
  type PageDocumentSource,
  type TakeoffPageDocument,
} from "@/lib/takeoff/page-contributions";
import {
  estimateLineUnitKey,
  lengthFactor,
  mayReplaceAcrossDocuments,
  mergeMatches,
  proposePagePairs,
  replacementQuantities,
  unitKey,
  type ProposedPair,
  type ReplacementCandidate,
  type ReplacementNewLine,
  type ReplacementSourceLine,
  type RuleIdentity,
} from "@/lib/takeoff/page-replacement";
import {
  takeoffPageReplacementRequestSchema,
  takeoffPageReplacementResponseSchema,
  type TakeoffPageReplacementResponse,
  type TakeoffPageReplacementRow,
} from "@/lib/takeoff/page-replacement-contracts";
import { parseApplyTakeoffPayload } from "@/lib/takeoff/query-parsers";
import { takeoffJobIdSchema } from "@/lib/takeoff/schemas";
import { parseWithSchema } from "@/lib/takeoff/server-helpers";

// TI-682 lot D, PR 2: the proposal of the « Pages déjà au devis » step. For each page of this takeoff the estimate
// already holds from another takeoff, the earlier estimate lines (what their sources give, whether the estimator changed
// the quantity by hand), the new lines and the pairs proposed between them. It reads the version the application writes
// into (the takeoff's own), with the lines the mapping plan leaves out set aside as the application sets them aside. Read
// with the user's session only (RLS of the version, its lines and the takeoffs); never the service role. The database
// checks every decision again under the version's lock: this proposal decides nothing.

type Context = Pick<AuthenticatedTakeoffContext, "supabase" | "tenantId">;

type TakeoffLineRow = { id: string; job_id: string; designation: string; unit: string; quantity: number | string; is_excluded: boolean;
  source_file_name: string | null; source_page: number | null; source_document: unknown; rule_inputs: unknown };
type EstimateLineRow = { id: string; title: string; unit_code: string | null; description: string | null; pricing_status: string;
  quantity: number | string | null; updated_at: string; unit_price_ht_cents: number | null; parent_id: string | null; position: number;
  item_type: string; source_provider: string | null; source_job_id: string | null; source_file_name: string | null; source_page: number | null;
  takeoff_item_id: unknown; rounding_item_ids: unknown; rounding_job_id: unknown; policy_item_ids: unknown; policy_job_id: unknown;
  replacement_item_ids: unknown; replacement_job_id: unknown };
type JobRow = { id: string; created_at: string; level: string | null; source_file_name: string | null; sources: unknown };

const TAKEOFF_LINE_SELECT = "id,job_id,designation,unit,quantity,is_excluded,source_file_name,source_page,"
  + "source_document:metadata->source_document,rule_inputs:metadata->rule_inputs";
const ESTIMATE_LINE_SELECT = "id,title,unit_code,description,pricing_status,quantity,updated_at,unit_price_ht_cents,parent_id,position,item_type,"
  + "source_provider,source_job_id,source_file_name,source_page,"
  + "takeoff_item_id:source_metadata->>takeoff_item_id,"
  + "rounding_item_ids:source_metadata->takeoff_length_rounding->item_ids,rounding_job_id:source_metadata->takeoff_length_rounding->>job_id,"
  + "policy_item_ids:source_metadata->takeoff_quantity_policy->item_ids,policy_job_id:source_metadata->takeoff_quantity_policy->>job_id,"
  + "replacement_item_ids:source_metadata->takeoff_page_replacement->item_ids,replacement_job_id:source_metadata->takeoff_page_replacement->>job_id";
const JOB_SELECT = "id,created_at,level,source_file_name,sources:preparation_snapshot->preparation->sources";

const sourcesSchema = z.array(z.object({ document_id: z.string(), kind: z.string().nullish(), active: z.boolean().nullish(),
  content_hash: z.string().nullish(), logical_document_id: z.string().nullish() }));

function readFailed(error: unknown, message: string, jobId?: string): never {
  throw toTakeoffError(mapSupabaseError(error as never, message), { fallbackCode: TakeoffErrorCode.INTERNAL_ERROR, retryable: false, jobId });
}

const number = (value: number | string | null) => (value === null ? null : Number(value));
const ruleIdentity = (value: unknown): RuleIdentity => (value && typeof value === "object" && !Array.isArray(value) ? value as RuleIdentity : null);

async function readTakeoffLines(context: Context, filter: { jobId?: string; ids?: readonly string[] }) {
  if (filter.ids) {
    if (!filter.ids.length) return [];
    const { data, error } = await readAllRowsInChunks(filter.ids, (chunk) => context.supabase.from("takeoff_items" as never)
      .select(TAKEOFF_LINE_SELECT as never, { count: "exact" })
      .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
    if (error) readFailed(error, "Impossible de lire les lignes des métrés déjà au devis.");
    return (data ?? []) as unknown as TakeoffLineRow[];
  }
  const { data, error } = await readAllRows(() => context.supabase.from("takeoff_items" as never)
    .select(TAKEOFF_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("job_id" as never, filter.jobId as never) as never, { pageSize: 1000 });
  if (error) readFailed(error, "Impossible de lire les lignes du métré.", filter.jobId);
  return (data ?? []) as unknown as TakeoffLineRow[];
}

async function readEstimateLines(context: Context, versionId: string) {
  const { data, error } = await readAllRows(() => context.supabase.from("estimate_items" as never)
    .select(ESTIMATE_LINE_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).eq("version_id" as never, versionId as never)
    .eq("item_type" as never, "line" as never) as never, { pageSize: 1000 });
  if (error) readFailed(error, "Impossible de lire les lignes du devis.");
  return (data ?? []) as unknown as EstimateLineRow[];
}

async function readJobs(context: Context, ids: readonly string[]) {
  if (!ids.length) return [];
  const { data, error } = await readAllRowsInChunks(ids, (chunk) => context.supabase.from("takeoff_jobs" as never)
    .select(JOB_SELECT as never, { count: "exact" })
    .eq("tenant_id" as never, context.tenantId as never).in("id" as never, chunk as never) as never);
  if (error) readFailed(error, "Impossible de lire les métrés déjà au devis.");
  return (data ?? []) as unknown as JobRow[];
}

const provenanceOf = (line: EstimateLineRow): EstimateLineProvenance => ({
  id: line.id, source_provider: line.source_provider, source_job_id: line.source_job_id, source_file_name: line.source_file_name,
  source_page: line.source_page,
  source_metadata: { takeoff_item_id: line.takeoff_item_id,
    takeoff_length_rounding: { job_id: line.rounding_job_id, item_ids: line.rounding_item_ids },
    takeoff_quantity_policy: { job_id: line.policy_job_id, item_ids: line.policy_item_ids },
    takeoff_page_replacement: { job_id: line.replacement_job_id, item_ids: line.replacement_item_ids } },
});

/**
 * POST /api/takeoff/jobs/[jobId]/page-replacement: what applying this takeoff would replace, page by page, with the
 * mapping overrides of the wizard (`{ strategy, target_section_id, overrides }`).
 */
export async function getTakeoffJobPageReplacement(jobId: string, body: unknown): Promise<TakeoffPageReplacementResponse> {
  const { supabase, tenantId, userId } = await getAuthenticatedTakeoffContext();
  const context = { supabase, tenantId };
  const normalizedJobId = parseWithSchema(takeoffJobIdSchema, jobId, "Identifiant job invalide.");
  const request = parseWithSchema(takeoffPageReplacementRequestSchema, body, "Proposition des pages déjà au devis invalide.");
  const applyRequest = parseApplyTakeoffPayload({ strategy: request.strategy, target_section_id: request.target_section_id ?? null,
    ...(request.overrides?.length ? { overrides: request.overrides } : {}) });
  const job = await getTakeoffJobDetailByIdOrThrow({ supabase, tenantId, jobId: normalizedJobId });
  // The application writes into the takeoff's own version (apply_takeoff_job_atomic reads takeoff_jobs.estimate_version_id).
  const versionId = job.estimate_version_id;

  // The lines that reach the estimate, as the application computes them: the plan's skips and assemblies, and on a DPGF
  // version the lines its reconciliation decided out of scope.
  const mergeRequired = await hasTakeoffDpgfTargetLines({ supabase, tenantId, versionId });
  const mappingPreview = await buildTakeoffMappingPreviewForJob({ supabase, tenantId, jobId: normalizedJobId, request: applyRequest });
  const comparisonContext = mergeRequired ? await loadTakeoffDpgfComparisonContext({
    auth: { supabase, tenantId, userId }, jobId: normalizedJobId, versionId }) : null;
  excludeDpgfOutOfScope(mappingPreview, comparisonContext);
  const leftOut = plannedExclusions(mappingPreview);

  const [ownLines, estimateRows] = await Promise.all([readTakeoffLines(context, { jobId: normalizedJobId }), readEstimateLines(context, versionId)]);
  const estimateLines = estimateRows.filter((line) => line.source_job_id !== null);
  const provenance = new Map(estimateLines.map((line) => [line.id, provenanceOf(line)]));
  const sourceIdsOf = new Map(estimateLines.map((line) => [line.id, estimateLineTakeoffItemIds(provenance.get(line.id)!.source_metadata, line.source_job_id)]));
  const own = new Set(ownLines.map((line) => line.id));
  const referenced = [...new Set([...sourceIdsOf.values()].flat())].filter((id) => !own.has(id));
  const sourceRows = [...ownLines, ...await readTakeoffLines(context, { ids: referenced })];
  const jobs = new Map((await readJobs(context, [...new Set([normalizedJobId, ...sourceRows.map((line) => line.job_id),
    ...estimateLines.flatMap((line) => (line.source_job_id ? [line.source_job_id] : []))])])).map((row) => [row.id, row]));
  const sourcesOf = (jobRow: JobRow | undefined): PageDocumentSource[] | null => {
    const parsed = sourcesSchema.safeParse(jobRow?.sources);
    return parsed.success ? parsed.data : null;
  };
  const lines = new Map(sourceRows.map((line) => [line.id, { ...line, quantity: Number(line.quantity),
    identity: takeoffLinePageIdentity(line, sourcesOf(jobs.get(line.job_id))) }]));
  const earlierItems = new Map<string, EarlierTakeoffLine>([...lines.values()].map((line) => [line.id, { id: line.id, job_id: line.job_id, identity: line.identity }]));
  const included = ownLines.filter((line) => !line.is_excluded && !leftOut.has(line.id));
  const result = findPagesAlreadyInEstimate({ jobId: normalizedJobId,
    newLines: included.map((line) => ({ id: line.id, identity: lines.get(line.id)!.identity })),
    estimateLines: [...provenance.values()], earlierItems });

  // « Fusionner » on a DPGF version: the lines it matches by title in the target section are imposed.
  const merged = mergeRequired && applyRequest.strategy === "merge"
    ? mergeMatches(included.map((line) => ({ id: line.id, designation: line.designation, unit: line.unit })),
      estimateRows.filter((line) => (line.parent_id ?? null) === (applyRequest.target_section_id ?? null)))
    : new Map<string, string>();
  // The DPGF targets this takeoff's lines feed (its reconciliation), to refuse keeping both where one is fed again (D-6).
  const fedTargets = comparisonContext ? new Map(computeTakeoffDpgfRows(comparisonContext.comparisonInput).rows
    .flatMap((row) => row.linked_takeoff_items.map((item) => [item.item_id, row.dpgf.estimate_item_id] as const))) : new Map<string, string>();
  const estimateById = new Map(estimateRows.map((line) => [line.id, line]));

  const rows: TakeoffPageReplacementRow[] = result.pages.map((page) => {
    const pageItems = new Set(page.earlier.flatMap((earlier) => earlier.takeoff_item_ids));
    const candidates = new Map<string, ReplacementCandidate & { job_id: string; item_ids: string[] }>();
    for (const earlier of page.earlier) {
      for (const estimateItemId of earlier.estimate_item_ids) {
        const line = estimateById.get(estimateItemId);
        if (!line) continue;
        const onPage = (sourceIdsOf.get(estimateItemId) ?? []).filter((id) => pageItems.has(id) && lines.get(id)?.job_id.toLowerCase() === earlier.job_id);
        const existing = candidates.get(estimateItemId);
        const sources: ReplacementSourceLine[] = onPage.map((id) => {
          const sourceLine = lines.get(id)!;
          return { id, job_id: sourceLine.job_id, designation: sourceLine.designation, unit: sourceLine.unit, quantity: sourceLine.quantity,
            rule_inputs: ruleIdentity(sourceLine.rule_inputs), identity: sourceLine.identity };
        });
        if (existing) {
          existing.sources.push(...sources.filter((source) => !existing.item_ids.includes(source.id)));
          existing.item_ids.push(...onPage.filter((id) => !existing.item_ids.includes(id)));
          continue;
        }
        candidates.set(estimateItemId, { id: line.id, title: line.title, unit_code: line.unit_code, description: line.description,
          pricing_status: line.pricing_status, source_provider: line.source_provider, sources, job_id: earlier.job_id, item_ids: onPage });
      }
    }
    const newLines: ReplacementNewLine[] = page.item_ids.flatMap((id) => {
      const line = lines.get(id);
      return line ? [{ id, designation: line.designation, unit: line.unit, quantity: line.quantity, rule_inputs: ruleIdentity(line.rule_inputs),
        identity: line.identity }] : [];
    });
    const forced: ProposedPair[] = newLines.flatMap((line) => {
      const target = merged.get(line.id);
      const candidate = target ? candidates.get(target) : undefined;
      if (!candidate || candidate.source_provider === "dpgf") return [];
      return [{ takeoff_item_id: line.id, estimate_item_id: candidate.id, source_item_id: candidate.item_ids[0] ?? null, reason: "merge" as const }];
    });
    // A new line « Fusionner » sends onto another line than an earlier one of this page is not paired here.
    const pairable = newLines.filter((line) => !merged.has(line.id) || forced.some((pair) => pair.takeoff_item_id === line.id));
    const pairs = proposePagePairs({ newLines: pairable, candidates: [...candidates.values()], forced });
    const pageSources = [...candidates.values()].filter((candidate) => candidate.source_provider !== "dpgf").flatMap((candidate) => candidate.sources);
    const identities = newLines.flatMap((line) => (line.identity ? [line.identity] : []));
    const document: TakeoffPageDocument = identities[0]?.document ?? { plan_file_id: null, content_hash: null, logical_document_id: null,
      file_name: page.file_name };
    const identifiedDocuments = new Set([...candidates.values()].flatMap((candidate) => candidate.sources.flatMap((source) =>
      source.identity && (source.identity.document.plan_file_id || source.identity.document.content_hash)
        ? [source.identity.document.plan_file_id ?? source.identity.document.content_hash!] : [])));
    const nameOnly = identities.some((identity) => !identity.document.plan_file_id && !identity.document.content_hash);
    const dpgfFedAgain = [...candidates.values()].some((candidate) => candidate.source_provider === "dpgf"
      && newLines.some((line) => fedTargets.get(line.id) === candidate.id));
    return {
      key: JSON.stringify([document, page.page]),
      document, file_name: page.file_name, page: page.page,
      earlier_job_ids: page.earlier.map((earlier) => earlier.job_id),
      new_lines: newLines.map((line) => ({ id: line.id, designation: line.designation, unit: line.unit, quantity: line.quantity,
        unit_key: unitKey(line.unit),
        candidate_ids: [...candidates.values()].filter((candidate) => candidate.source_provider !== "dpgf" && unitKey(line.unit) !== null
          && estimateLineUnitKey(candidate) === unitKey(line.unit)
          && candidate.sources.every((source) => mayReplaceAcrossDocuments(line, source, pageSources))).map((candidate) => candidate.id) })),
      earlier_lines: [...candidates.values()].map((candidate) => {
        const line = estimateById.get(candidate.id)!;
        const allSources = (sourceIdsOf.get(candidate.id) ?? []).flatMap((id) => (lines.get(id) ? [{ id, quantity: lines.get(id)!.quantity }] : []));
        const quantities = replacementQuantities({ quantity: number(line.quantity), factor: lengthFactor(line), sources: allSources,
          removedSourceIds: new Set(candidate.item_ids), added: [] });
        return { id: line.id, title: line.title, unit_key: estimateLineUnitKey(line), quantity: number(line.quantity),
          measured_quantity: line.source_provider === "dpgf" ? null : quantities.measured,
          changed_by_hand: line.source_provider !== "dpgf" && quantities.changedByHand,
          updated_at: line.updated_at, unit_price_ht_cents: line.unit_price_ht_cents, job_id: candidate.job_id,
          dpgf_target: line.source_provider === "dpgf", item_ids: candidate.item_ids, sources: allSources, length_factor: lengthFactor(line) };
      }),
      pairs: pairs.map((pair) => ({ ...pair, locked: pair.reason === "merge" })),
      ambiguous_document: nameOnly && identifiedDocuments.size > 1,
      keep_both_refused: dpgfFedAgain ? "dpgf_target" as const : forced.length > 0 ? "merge_match" as const : null,
    };
  });

  const named = new Set(rows.flatMap((row) => row.earlier_job_ids));
  return parseWithSchema(takeoffPageReplacementResponseSchema, {
    job_id: normalizedJobId,
    version_id: versionId,
    rows,
    jobs: [...named].flatMap((id) => {
      const row = jobs.get(id);
      return row ? [{ id: row.id, created_at: row.created_at, level: row.level, source_file_name: row.source_file_name }] : [];
    }).sort((left, right) => left.created_at.localeCompare(right.created_at)),
    unidentified_count: result.unidentified_item_ids.length,
    merge_required: mergeRequired,
  }, "Proposition des pages déjà au devis invalide.");
}
