import { z } from "zod";

import type { EstimateEngineVersion } from "@/lib/estimates/engine/capabilities";
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
  mergeSources,
  proposePagePairs,
  replacementQuantities,
  unitKey,
  type ProposedPair,
  type ReplacementCandidate,
  type ReplacementNewLine,
  type ReplacementSourceLine,
  type RuleIdentity,
} from "@/lib/takeoff/page-replacement";
import type { TakeoffPageReplacementResponse, TakeoffPageReplacementRow } from "@/lib/takeoff/page-replacement-contracts";

// TI-682 lot D, PR 2: the proposal of the « Pages déjà au devis » step, computed from what the server read (no read
// here, so that it can be checked on its own). For each page of this takeoff the estimate already holds from another
// takeoff, the earlier estimate lines (what their sources give, whether the estimator changed the quantity by hand), the
// new lines and the pairs proposed between them. The database checks every decision again: this proposal decides nothing.

export type TakeoffLineRow = { id: string; job_id: string; designation: string; unit: string; quantity: number | string; is_excluded: boolean;
  created_at: string;
  source_file_name: string | null; source_page: number | null; source_document: unknown; rule_inputs: unknown };
export type EstimateLineRow = { id: string; title: string; unit_code: string | null; description: string | null; pricing_status: string;
  quantity: number | string | null; updated_at: string; unit_price_ht_cents: number | null; parent_id: string | null; position: number;
  item_type: string; source_provider: string | null; source_job_id: string | null; source_file_name: string | null; source_page: number | null;
  takeoff_item_id: unknown; rounding_item_ids: unknown; rounding_job_id: unknown; policy_item_ids: unknown; policy_job_id: unknown;
  replacement_item_ids: unknown; replacement_job_id: unknown; mapping_action: unknown };
export type JobRow = { id: string; created_at: string; level: string | null; source_file_name: string | null; sources: unknown };

const sourcesSchema = z.array(z.object({ document_id: z.string(), document_name: z.string().nullish(), kind: z.string().nullish(), active: z.boolean().nullish(),
  content_hash: z.string().nullish(), logical_document_id: z.string().nullish() }));

const number = (value: number | string | null) => (value === null ? null : Number(value));
const ruleIdentity = (value: unknown): RuleIdentity => (value && typeof value === "object" && !Array.isArray(value) ? value as RuleIdentity : null);

const provenanceOf = (line: EstimateLineRow): EstimateLineProvenance => ({
  id: line.id, source_provider: line.source_provider, source_job_id: line.source_job_id, source_file_name: line.source_file_name,
  source_page: line.source_page,
  source_metadata: { takeoff_item_id: line.takeoff_item_id,
    takeoff_length_rounding: { job_id: line.rounding_job_id, item_ids: line.rounding_item_ids },
    takeoff_quantity_policy: { job_id: line.policy_job_id, item_ids: line.policy_item_ids },
    takeoff_page_replacement: { job_id: line.replacement_job_id, item_ids: line.replacement_item_ids } },
});

/** The earlier takeoff lines the estimate's lines name (their sources), to read beside this takeoff's own. */
export function sourceItemIdsOf(estimateRows: readonly EstimateLineRow[]) {
  return new Map(estimateRows.filter((line) => line.source_job_id !== null)
    .map((line) => [line.id, estimateLineTakeoffItemIds(provenanceOf(line).source_metadata, line.source_job_id)]));
}

export type PageReplacementInput = {
  jobId: string;
  versionId: string;
  mergeRequired: boolean;
  /** This takeoff's lines; the earlier takeoff lines the estimate names; the version's lines; the takeoffs they name. */
  ownLines: readonly TakeoffLineRow[];
  referencedLines: readonly TakeoffLineRow[];
  estimateRows: readonly EstimateLineRow[];
  jobs: readonly JobRow[];
  /** The lines the mapping plan leaves out (skipped, folded into an ouvrage, out of the DPGF scope). */
  leftOut: ReadonlySet<string>;
  /** « Fusionner » on a DPGF version: what its writer is handed, to replay its matches. */
  merge: { mappingItems: Parameters<typeof mergeSources>[1]; targetSectionId: string | null; engine: EstimateEngineVersion } | null;
  /** The DPGF target each of this takeoff's lines feeds (its reconciliation). */
  fedTargets: ReadonlyMap<string, string>;
};

/** What applying this takeoff would replace, page by page. */
export function buildPageReplacementProposal(input: PageReplacementInput): TakeoffPageReplacementResponse {
  const { ownLines, estimateRows, mergeRequired } = input;
  const normalizedJobId = input.jobId;
  const leftOut = input.leftOut;
  const sourceIdsOf = sourceItemIdsOf(estimateRows);
  const provenance = new Map(estimateRows.filter((line) => line.source_job_id !== null).map((line) => [line.id, provenanceOf(line)]));
  const sourceRows = [...ownLines, ...input.referencedLines];
  const jobs = new Map(input.jobs.map((row) => [row.id, row]));
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
    estimateLines: [...provenance.values()], earlierItems,
    jobSources: new Map([...jobs.values()].map((row) => [row.id.toLowerCase(), sourcesOf(row)])) });

  // « Fusionner » on a DPGF version: the lines its writer matches by title in the target section are imposed, replayed
  // from the writer of the version's engine on what it is handed (renamed designations, its source order).
  const merged = input.merge
    ? mergeMatches(mergeSources(ownLines, input.merge.mappingItems),
      estimateRows.filter((line) => (line.parent_id ?? null) === (input.merge!.targetSectionId ?? null)), input.merge.engine)
    : new Map<string, string>();
  // The DPGF targets this takeoff's lines feed (its reconciliation), to refuse keeping both where one is fed again (D-6).
  const fedTargets = input.fedTargets;
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
          pricing_status: line.pricing_status, source_provider: line.source_provider, assembly: line.mapping_action === "apply_assembly",
          sources, job_id: earlier.job_id, item_ids: onPage });
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
        candidate_ids: [...candidates.values()].filter((candidate) => candidate.source_provider !== "dpgf" && !candidate.assembly
          && unitKey(line.unit) !== null
          && estimateLineUnitKey(candidate) === unitKey(line.unit)
          && candidate.sources.every((source) => mayReplaceAcrossDocuments(line, source, pageSources))).map((candidate) => candidate.id) })),
      earlier_lines: [...candidates.values()].map((candidate) => {
        const line = estimateById.get(candidate.id)!;
        const allSources = (sourceIdsOf.get(candidate.id) ?? []).flatMap((id) => (lines.get(id) ? [{ id, quantity: lines.get(id)!.quantity }] : []));
        const quantities = replacementQuantities({ quantity: number(line.quantity), factor: lengthFactor(line), sources: allSources,
          removedSourceIds: new Set(candidate.item_ids), added: [] });
        const measuredLine = line.source_provider !== "dpgf" && !candidate.assembly;
        return { id: line.id, title: line.title, unit_key: estimateLineUnitKey(line), quantity: number(line.quantity),
          measured_quantity: measuredLine ? quantities.measured : null,
          changed_by_hand: measuredLine && quantities.changedByHand,
          updated_at: line.updated_at, unit_price_ht_cents: line.unit_price_ht_cents, job_id: candidate.job_id,
          dpgf_target: line.source_provider === "dpgf",
          fed_again: line.source_provider === "dpgf" && newLines.some((newLine) => fedTargets.get(newLine.id) === line.id),
          assembly: Boolean(candidate.assembly),
          other_pages: (sourceIdsOf.get(candidate.id) ?? []).some((id) => !candidate.item_ids.includes(id)),
          item_ids: candidate.item_ids, sources: allSources, length_factor: lengthFactor(line) };
      }),
      pairs: pairs.map((pair) => ({ ...pair, locked: pair.reason === "merge" })),
      ambiguous_document: nameOnly && identifiedDocuments.size > 1,
      keep_both_refused: dpgfFedAgain ? "dpgf_target" as const : forced.length > 0 ? "merge_match" as const : null,
    };
  });

  const named = new Set(rows.flatMap((row) => row.earlier_job_ids));
  return {
    job_id: normalizedJobId,
    version_id: input.versionId,
    rows,
    jobs: [...named].flatMap((id) => {
      const row = jobs.get(id);
      return row ? [{ id: row.id, created_at: row.created_at, level: row.level, source_file_name: row.source_file_name }] : [];
    }).sort((left, right) => left.created_at.localeCompare(right.created_at)),
    unidentified_count: result.unidentified_item_ids.length,
    merge_required: mergeRequired,
  };
}
