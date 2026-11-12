import { measurementUnitToken, normalizeMeasurementUnit } from "@/lib/units/normalize";
import { canRetainDpgfQuantity } from "@/lib/takeoff/dpgf-review-guards";
import { earlierDpgfParts, type DpgfComposedLinePlace, type DpgfContribution } from "@/lib/takeoff/dpgf-composition";
import { dpgfQuantityPolicy } from "@/lib/takeoff/dpgf-quantity-policy";
import { haveSameQuantityIdentity, quantityIdentity, type QuantityIdentity } from "@/lib/takeoff/quantity-compatibility";
import { dpgfReviewQuantitySnapshot, sameQuantitySnapshot } from "@/lib/takeoff/dpgf-review-quantity";
import {
  TAKEOFF_COMPARE_DEFAULT_THRESHOLD,
  TAKEOFF_COMPARE_MAX_THRESHOLD,
  TAKEOFF_COMPARE_MIN_THRESHOLD,
  computeTakeoffSimilarityRatio,
  normalizeTakeoffCompareText,
} from "@/lib/takeoff/diff";
import type {
  TakeoffDpgfComparisonDpgfLine,
  TakeoffDpgfComparisonEvidenceKind,
  TakeoffDpgfComparisonProof,
  TakeoffDpgfComparisonResponse,
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonSummary,
  TakeoffDpgfComparisonTakeoffLine,
  TakeoffDpgfComparisonUnusedTakeoffItem,
  TakeoffDpgfComparisonView,
  TakeoffDpgfManualLinkRecord,
  TakeoffDpgfReviewDecision,
  TakeoffDpgfReviewDecisionRecord,
  TakeoffDpgfReviewStatus,
} from "@/lib/takeoff/types";

export const TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE = 50;
import { TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE } from "@/lib/takeoff/limits";

export { TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE };

export { hasBlockingTakeoffDpgfExceptions } from "@/lib/takeoff/dpgf-review-guards";

type BuildTakeoffDpgfComparisonInput = {
  versionId: string;
  jobId: string;
  dpgfLines: TakeoffDpgfComparisonDpgfLine[];
  takeoffLines: TakeoffDpgfComparisonTakeoffLine[];
  manualLinks?: TakeoffDpgfManualLinkRecord[];
  reviewDecisions?: TakeoffDpgfReviewDecisionRecord[];
  carriedReviewDecisions?: ReadonlyMap<string, TakeoffDpgfReviewDecisionRecord>;
  threshold?: number;
  cursor?: string | null;
  pageSize?: number;
  view?: TakeoffDpgfComparisonView;
  /**
   * TI-682 D4: what each DPGF target holds of the takeoffs applied (dpgf-composition-server), the earlier takeoff lines
   * on pages this takeoff reads again, and per line of this takeoff the duplicates the zone rules found.
   */
  dpgfCompositions?: {
    targets: ReadonlyMap<string, { contributions: DpgfContribution[] }>;
    lines: ReadonlyMap<string, DpgfComposedLinePlace>;
    jobs: ReadonlyMap<string, { created_at: string; level: string | null }>;
  };
  readAgainItemIds?: ReadonlySet<string>;
  overlapPartners?: ReadonlyMap<string, ReadonlyArray<{ item_id: string; job_id: string; overlap_m: number; resolved: boolean }>>;
};

type CompositionContext = Pick<BuildTakeoffDpgfComparisonInput, "jobId" | "dpgfCompositions" | "readAgainItemIds" | "overlapPartners">;

type NormalizedDpgfLine = TakeoffDpgfComparisonDpgfLine & {
  quantityIdentity: QuantityIdentity;
  searchText: string;
  normalizedUnit: string | null;
};

type NormalizedTakeoffLine = TakeoffDpgfComparisonTakeoffLine & {
  quantityIdentity: QuantityIdentity;
  searchText: string;
  normalizedUnit: string | null;
};

type MatchedTakeoffCandidate = {
  line: NormalizedTakeoffLine;
  score: number;
};

type AggregatedTakeoffMetrics = {
  quantity: number | null;
  quantityUnit: string | null;
  averageConfidence: number | null;
  hasUnitConflict: boolean;
};

const RELIABLE_MATCH_MIN_SCORE = 0.9;
const TO_CONFIRM_MIN_CONFIDENCE = 0.72;
const EXCEPTION_STATUSES = new Set<TakeoffDpgfReviewStatus>([
  "to_confirm",
  "significant_gap",
  "unlinked",
  "forced_manual",
]);

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function toStableNumber(value: number | null, digits = 4) {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function normalizeThreshold(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return TAKEOFF_COMPARE_DEFAULT_THRESHOLD;
  }

  if ((value ?? 0) < TAKEOFF_COMPARE_MIN_THRESHOLD) {
    return TAKEOFF_COMPARE_MIN_THRESHOLD;
  }

  if ((value ?? 0) > TAKEOFF_COMPARE_MAX_THRESHOLD) {
    return TAKEOFF_COMPARE_MAX_THRESHOLD;
  }

  return Number((value ?? TAKEOFF_COMPARE_DEFAULT_THRESHOLD).toFixed(2));
}

function normalizePageSize(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE;
  }

  return Math.min(
    TAKEOFF_DPGF_COMPARE_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(value ?? TAKEOFF_DPGF_COMPARE_DEFAULT_PAGE_SIZE))
  );
}

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return 0;

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const offset = parsed?.offset;
    if (typeof offset !== "number" || !Number.isFinite(offset)) {
      return 0;
    }

    return Math.max(0, Math.trunc(offset));
  } catch {
    return 0;
  }
}

export function normalizeTakeoffDpgfUnit(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;

  const known = normalizeMeasurementUnit(value).unitCode;
  if (known) return known;
  const token = measurementUnitToken(value);
  const takeoffAliases: Record<string, string> = { un: "u", unit: "u", mlt: "ml", lm: "ml", sqm: "m2", for: "fft" };
  return token ? takeoffAliases[token] ?? token : null;
}

function areUnitsCompatible(left: string | null, right: string | null) {
  if (!left || !right) return true;
  return left === right;
}

function buildDpgfSearchText(line: TakeoffDpgfComparisonDpgfLine) {
  return normalizeTakeoffCompareText(
    [line.title, line.description].filter(Boolean).join(" ")
  );
}

function buildTakeoffSearchText(line: TakeoffDpgfComparisonTakeoffLine) {
  return normalizeTakeoffCompareText(line.designation);
}

export function buildTakeoffDpgfReviewReference(input: {
  sourceFileName: string | null;
  sourcePage: number | null;
  position: number;
  title: string;
  unit: string | null;
}) {
  if (input.sourceFileName && input.sourcePage !== null) {
    return normalizeTakeoffCompareText(
      `${input.sourceFileName} row ${input.sourcePage}`
    );
  }

  return normalizeTakeoffCompareText(
    `${input.position} ${input.title} ${input.sourcePage === null ? "" : input.unit ?? ""}`
  );
}

function computeMatchScore(input: {
  dpgf: NormalizedDpgfLine;
  takeoff: NormalizedTakeoffLine;
}) {
  if (!areUnitsCompatible(input.dpgf.normalizedUnit, input.takeoff.normalizedUnit)) {
    return null;
  }
  if (!haveSameQuantityIdentity(input.dpgf.quantityIdentity, input.takeoff.quantityIdentity)) return null;

  if (!input.dpgf.searchText || !input.takeoff.searchText) {
    return null;
  }

  let score = computeTakeoffSimilarityRatio(
    input.dpgf.searchText,
    input.takeoff.searchText
  );

  if (
    input.dpgf.normalizedUnit &&
    input.takeoff.normalizedUnit &&
    input.dpgf.normalizedUnit === input.takeoff.normalizedUnit
  ) {
    score += 0.05;
  }

  if (
    input.dpgf.searchText.includes(input.takeoff.searchText) ||
    input.takeoff.searchText.includes(input.dpgf.searchText)
  ) {
    score += 0.03;
  }

  return Math.min(0.9999, Number(score.toFixed(4)));
}

function aggregateTakeoffMetrics(input: {
  items: NormalizedTakeoffLine[];
  dpgfUnit: string | null;
  dpgf: NormalizedDpgfLine;
}): AggregatedTakeoffMetrics {
  if (input.items.length === 0) {
    return {
      quantity: null,
      quantityUnit: input.dpgfUnit,
      averageConfidence: null,
      hasUnitConflict: false,
    };
  }

  const normalizedUnits = [...new Set(input.items.map((item) => item.normalizedUnit))].filter(
    (unit): unit is string => Boolean(unit)
  );
  const hasUnitConflict = normalizedUnits.length > 1 || input.items.some(item => !areUnitsCompatible(input.dpgf.normalizedUnit, item.normalizedUnit)
    || !haveSameQuantityIdentity(input.dpgf.quantityIdentity, item.quantityIdentity));
  const quantity = hasUnitConflict
    ? null
    : toStableNumber(
        input.items.reduce((sum, item) => sum + item.quantity, 0),
        4
      );
  const confidenceValues = input.items
    .map((item) => item.confidence)
    .filter((confidence): confidence is number => typeof confidence === "number");
  const averageConfidence =
    confidenceValues.length > 0
      ? toStableNumber(
          confidenceValues.reduce((sum, confidence) => sum + confidence, 0) /
            confidenceValues.length
        )
      : null;

  return {
    quantity,
    quantityUnit:
      (hasUnitConflict ? input.dpgfUnit : input.items[0]?.unit ?? input.dpgfUnit) ??
      null,
    averageConfidence,
    hasUnitConflict,
  };
}

function computeDelta(input: {
  dpgfQuantity: number | null;
  takeoffQuantity: number | null;
}) {
  if (input.dpgfQuantity === null || input.takeoffQuantity === null) {
    return {
      deltaAbsolute: null,
      deltaPercent: null,
    };
  }

  const deltaAbsolute = Math.abs(input.takeoffQuantity - input.dpgfQuantity);
  const deltaPercent =
    input.dpgfQuantity > 0
      ? (deltaAbsolute / input.dpgfQuantity) * 100
      : null;

  return {
    deltaAbsolute: toStableNumber(deltaAbsolute),
    deltaPercent: toStableNumber(deltaPercent),
  };
}

function hasMeaningfulReason(reason: string | null | undefined) {
  return typeof reason === "string" && reason.trim().length > 0;
}

function buildProofs(input: {
  dpgf: NormalizedDpgfLine;
  linkedTakeoffItems: NormalizedTakeoffLine[];
  aggregatedMetrics: AggregatedTakeoffMetrics;
  appliedDecision: TakeoffDpgfReviewDecisionRecord | null;
}): TakeoffDpgfComparisonProof[] {
  const proofs: TakeoffDpgfComparisonProof[] = [
    {
      proof_id: `dpgf:${input.dpgf.estimate_item_id}`,
      type: "dpgf",
      kind: "fact",
      label: input.dpgf.title,
      source: input.dpgf.source_file_name
        ? `DPGF ${input.dpgf.source_file_name}`
        : "DPGF importé",
      confidence_score: null,
      note:
        input.dpgf.source_page !== null
          ? `Ligne source ${input.dpgf.source_page}`
          : null,
    },
  ];

  for (const item of input.linkedTakeoffItems) {
    proofs.push({
      proof_id: `takeoff:${item.item_id}`,
      type: "takeoff",
      kind: "fact",
      label: item.designation,
      source: item.source_file_name
        ? `${item.source_file_name}${item.source_page ? ` p.${item.source_page}` : ""}`
        : item.source_page
          ? `Plan p.${item.source_page}`
          : "Item takeoff",
      confidence_score: item.confidence,
      note: item.evidence,
    });

    if (item.source_page !== null || item.source_file_name) {
      proofs.push({
        proof_id: `plan:${item.item_id}`,
        type: "plan_zone",
        kind: "fact",
        label:
          item.source_page !== null ? `Zone / page ${item.source_page}` : "Zone plan",
        source: item.source_file_name ?? "Plan source",
        confidence_score: item.confidence,
        note: item.evidence,
      });
    }
  }

  if (input.linkedTakeoffItems.length > 1 && input.aggregatedMetrics.quantity !== null) {
    proofs.push({
      proof_id: `formula:${input.dpgf.estimate_item_id}`,
      type: "formula",
      kind: "inference",
      label: `Somme de ${input.linkedTakeoffItems.length} items takeoff`,
      source: "Agrégation manuelle",
      confidence_score: input.aggregatedMetrics.averageConfidence,
      note: "La quantité takeoff agrégée provient de plusieurs items reliés.",
    });
  }

  if (input.appliedDecision && hasMeaningfulReason(input.appliedDecision.reason)) {
    const decisionKind: TakeoffDpgfComparisonEvidenceKind =
      input.appliedDecision.decision === "manual_fix" ||
      input.appliedDecision.decision === "out_of_scope"
        ? "hypothesis"
        : "inference";

    proofs.push({
      proof_id: `décision:${input.appliedDecision.id}`,
      type: "comment",
      kind: decisionKind,
      label:
        input.appliedDecision.decision === "manual_fix"
          ? "Hypothèse manuelle"
          : "Arbitrage de revue",
      source:
        input.appliedDecision.source === "carried_over"
          ? "Décision reprise depuis une version précédente"
          : "Décision de revue humaine",
      confidence_score: null,
      note: input.appliedDecision.reason,
    });
  }

  return proofs;
}

function computeConfidenceScore(input: {
  matchingScore: number | null;
  aggregatedMetrics: AggregatedTakeoffMetrics;
  linkedTakeoffItems: NormalizedTakeoffLine[];
  proofs: TakeoffDpgfComparisonProof[];
  appliedDecision: TakeoffDpgfReviewDecisionRecord | null;
}): number {
  const proofBonus = Math.min(
    0.16,
    input.proofs.filter((proof) => proof.kind === "fact").length * 0.04
  );
  const hypothesisPenalty = input.proofs.some((proof) => proof.kind === "hypothesis")
    ? 0.14
    : 0;
  const conflictPenalty = input.aggregatedMetrics.hasUnitConflict ? 0.18 : 0;
  const carriedPenalty =
    input.appliedDecision?.source === "carried_over" ? 0.04 : 0;
  const fallbackMatch = input.linkedTakeoffItems.length > 0 ? 0.45 : 0.1;
  const fallbackTakeoffConfidence = input.linkedTakeoffItems.length > 0 ? 0.5 : 0.1;
  const rawScore =
    (input.matchingScore ?? fallbackMatch) * 0.45 +
    (input.aggregatedMetrics.averageConfidence ?? fallbackTakeoffConfidence) * 0.4 +
    proofBonus -
    hypothesisPenalty -
    conflictPenalty -
    carriedPenalty;

  return Number(clamp(rawScore, 0.05, 0.99).toFixed(4));
}

function deriveReviewStatus(input: {
  linkedTakeoffItems: NormalizedTakeoffLine[];
  manualLinkCount: number;
  appliedDecision: TakeoffDpgfReviewDecisionRecord | null;
  matchingScore: number | null;
  confidenceScore: number;
  deltaPercent: number | null;
  dpgfQuantity: number | null;
  aggregatedMetrics: AggregatedTakeoffMetrics;
  threshold: number;
}): TakeoffDpgfReviewStatus {
  if (input.appliedDecision || input.manualLinkCount > 0) {
    return "forced_manual";
  }

  if (input.linkedTakeoffItems.length === 0) {
    return "unlinked";
  }

  if (
    input.aggregatedMetrics.hasUnitConflict ||
    (input.dpgfQuantity === 0 && (input.aggregatedMetrics.quantity ?? 0) > 0) ||
    (input.deltaPercent !== null && input.deltaPercent > 1 + 1e-9)
  ) {
    return "significant_gap";
  }

  if (
    // Without a reference quantity nothing confirms the measurement, even when the DPGF cell is known to be blank.
    input.dpgfQuantity === null ||
    input.confidenceScore < TO_CONFIRM_MIN_CONFIDENCE ||
    (input.matchingScore ?? 0) < Math.max(input.threshold, RELIABLE_MATCH_MIN_SCORE)
  ) {
    return "to_confirm";
  }

  return "reliable_match";
}

function suggestDecision(input: {
  status: TakeoffDpgfReviewStatus;
  dpgfQuantity: number | null;
  takeoffQuantity: number | null;
  confidenceScore: number;
  appliedDecision: TakeoffDpgfReviewDecisionRecord | null;
}): TakeoffDpgfReviewDecision | null {
  if (input.appliedDecision) {
    return input.appliedDecision.decision;
  }

  if (input.status === "reliable_match") {
    return (input.dpgfQuantity ?? 0) > (input.takeoffQuantity ?? 0) ? "keep_dpgf" : "keep_takeoff";
  }

  if (input.status === "forced_manual") {
    return "manual_fix";
  }

  if (input.status === "unlinked") {
    return null;
  }

  if (input.status === "significant_gap") {
    if (input.takeoffQuantity !== null && input.dpgfQuantity !== null && input.takeoffQuantity > input.dpgfQuantity) {
      return "keep_takeoff";
    }

    return "keep_dpgf";
  }

  return null;
}

/**
 * Affectation automatique métré <-> DPGF par meilleur score GLOBAL.
 *
 * L'ancienne version était gloutonne dans l'ordre de lecture du DPGF : la
 * première ligne dépassant le seuil consommait définitivement un item de métré,
 * même si une ligne DPGF ultérieure lui correspondait bien mieux (ex. « Cloisons »
 * à 0,91 capturait l'item avant « Cloison BA13 ep.72mm » à 0,99, qui se
 * retrouvait alors en exception « non rapproché »).
 *
 * On construit désormais toutes les paires au-dessus du seuil, on les trie par
 * score décroissant, puis on affecte dans cet ordre — chaque ligne DPGF et
 * chaque item de métré n'étant retenus qu'une fois. Le tri est totalement
 * déterministe (score, puis confiance, puis identifiants).
 */
function resolveGlobalAutoMatches(input: {
  dpgfLines: NormalizedDpgfLine[];
  takeoffLines: NormalizedTakeoffLine[];
  threshold: number;
}): Map<string, MatchedTakeoffCandidate> {
  const pairs: Array<{
    dpgfId: string;
    line: NormalizedTakeoffLine;
    score: number;
  }> = [];

  for (const dpgf of input.dpgfLines) {
    for (const candidate of input.takeoffLines) {
      const score = computeMatchScore({ dpgf, takeoff: candidate });
      if (score === null || score < input.threshold) {
        continue;
      }
      pairs.push({
        dpgfId: dpgf.estimate_item_id,
        line: candidate,
        score,
      });
    }
  }

  pairs.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    const confidenceDelta =
      (right.line.confidence ?? 0) - (left.line.confidence ?? 0);
    if (confidenceDelta !== 0) {
      return confidenceDelta;
    }
    if (left.dpgfId !== right.dpgfId) {
      return left.dpgfId.localeCompare(right.dpgfId);
    }
    return left.line.item_id.localeCompare(right.line.item_id);
  });

  const matchByDpgfId = new Map<string, MatchedTakeoffCandidate>();
  const assignedTakeoffIds = new Set<string>();

  for (const pair of pairs) {
    if (
      matchByDpgfId.has(pair.dpgfId) ||
      assignedTakeoffIds.has(pair.line.item_id)
    ) {
      continue;
    }
    matchByDpgfId.set(pair.dpgfId, { line: pair.line, score: pair.score });
    assignedTakeoffIds.add(pair.line.item_id);
  }

  return matchByDpgfId;
}

/**
 * TI-682 D4: what the DPGF line holds of the other takeoffs, by takeoff and page, and the total it will hold with this
 * takeoff's measure (the pages it reads again replaced). Null when no other takeoff feeds it.
 */
function buildComposition(dpgfId: string, linkedTakeoffItems: readonly NormalizedTakeoffLine[], measured: number | null,
  context: CompositionContext) {
  const target = context.dpgfCompositions?.targets.get(dpgfId);
  if (!target || !context.dpgfCompositions) return null;
  const parts = earlierDpgfParts(target.contributions, { jobId: context.jobId,
    readAgainItemIds: context.readAgainItemIds ?? new Set(), lines: context.dpgfCompositions.lines });
  if (parts.entries.length === 0) return null;
  const kept = new Set(parts.kept.flatMap((entry) => entry.item_ids));
  const jobs = context.dpgfCompositions.jobs;
  return {
    earlier: { measured: parts.measured, protective: parts.protective, printed_gap: parts.printed_gap },
    row: {
      earlier: parts.entries.map((entry) => ({ ...entry, job_created_at: jobs.get(entry.job_id)?.created_at ?? null,
        job_level: jobs.get(entry.job_id)?.level ?? null })),
      earlier_quantity: parts.measured,
      earlier_protective: parts.protective,
      earlier_printed_gap: parts.printed_gap,
      total_quantity: toStableNumber((measured ?? 0) + parts.measured, 4) ?? parts.measured,
      double_counted: linkedTakeoffItems.flatMap((item) => (context.overlapPartners?.get(item.item_id) ?? [])
        .filter((partner) => !partner.resolved && kept.has(partner.item_id))
        .map((partner) => ({ item_id: item.item_id, partner_item_id: partner.item_id, partner_job_id: partner.job_id,
          overlap_m: partner.overlap_m }))),
    },
  };
}

function buildRow(input: {
  dpgf: NormalizedDpgfLine;
  linkedTakeoffItems: NormalizedTakeoffLine[];
  manualLinkCount: number;
  matchingScore: number | null;
  threshold: number;
  appliedDecision: TakeoffDpgfReviewDecisionRecord | null;
  composition: CompositionContext;
}): TakeoffDpgfComparisonRow {
  const aggregatedMetrics = aggregateTakeoffMetrics({
    items: input.linkedTakeoffItems,
    dpgfUnit: input.dpgf.unit,
    dpgf: input.dpgf,
  });
  // TI-682 D4: the line sums the measures it keeps. Its gap, its review status and the quantity a decision retains are
  // judged on that total; a decision goes stale when what the line keeps of the other takeoffs changes.
  const composition = buildComposition(input.dpgf.estimate_item_id, input.linkedTakeoffItems, aggregatedMetrics.quantity,
    input.composition);
  const totalQuantity = aggregatedMetrics.quantity === null ? null : composition?.row.total_quantity ?? aggregatedMetrics.quantity;
  const snapshot = dpgfReviewQuantitySnapshot({ dpgf_quantity: input.dpgf.quantity, dpgf: input.dpgf,
    linked_takeoff_items: input.linkedTakeoffItems, composition: composition?.row ?? null });
  const decisionCurrent = input.appliedDecision && (input.appliedDecision.decision === "out_of_scope"
    || sameQuantitySnapshot(input.appliedDecision.quantity_snapshot, snapshot));
  const appliedDecision = !aggregatedMetrics.hasUnitConflict && decisionCurrent && input.appliedDecision &&
    canRetainDpgfQuantity(input.appliedDecision.decision, input.dpgf.quantity, totalQuantity)
    ? input.appliedDecision : null;
  const delta = computeDelta({
    dpgfQuantity: input.dpgf.quantity,
    takeoffQuantity: totalQuantity,
  });
  // Judge the unrounded total of this line. Display rounding cannot move a gap below the boundary.
  const quantityPolicy = dpgfQuantityPolicy({ dpgf_quantity: input.dpgf.quantity, takeoff_quantity: aggregatedMetrics.quantity,
    linked_takeoff_items: input.linkedTakeoffItems }, composition?.earlier);
  const provisionalProofs = buildProofs({
    dpgf: input.dpgf,
    linkedTakeoffItems: input.linkedTakeoffItems,
    aggregatedMetrics,
    // A past human note remains evidence even when its quantitative acceptance needs a fresh review.
    appliedDecision: input.appliedDecision,
  });
  const confidenceScore = computeConfidenceScore({
    matchingScore: input.matchingScore,
    aggregatedMetrics,
    linkedTakeoffItems: input.linkedTakeoffItems,
    proofs: provisionalProofs,
    appliedDecision,
  });
  const ruleStatus = deriveReviewStatus({
    linkedTakeoffItems: input.linkedTakeoffItems,
    manualLinkCount: input.manualLinkCount,
    appliedDecision,
    matchingScore: input.matchingScore,
    confidenceScore,
    deltaPercent: quantityPolicy?.percentGap ?? delta.deltaPercent,
    dpgfQuantity: input.dpgf.quantity,
    aggregatedMetrics,
    threshold: input.threshold,
  });
  // A line of this takeoff drawn again in a line the target keeps (zone rules): to check, never blocking (TI-681).
  const reviewStatus = ruleStatus === "reliable_match" && (composition?.row.double_counted.length ?? 0) > 0 ? "to_confirm" : ruleStatus;
  const suggestedDecision = suggestDecision({
    status: reviewStatus,
    dpgfQuantity: input.dpgf.quantity,
    takeoffQuantity: totalQuantity,
    confidenceScore,
    appliedDecision,
  });

  return {
    line_id: input.dpgf.estimate_item_id,
    line_label: input.dpgf.title,
    dpgf: {
      estimate_item_id: input.dpgf.estimate_item_id,
      title: input.dpgf.title,
      description: input.dpgf.description,
      quantity: input.dpgf.quantity,
      unit: input.dpgf.unit,
      source_page: input.dpgf.source_page,
      source_file_name: input.dpgf.source_file_name,
      position: input.dpgf.position,
    },
    linked_takeoff_items: input.linkedTakeoffItems.map((item) => ({
      item_id: item.item_id,
      designation: item.designation,
      quantity: item.quantity,
      unit: item.unit,
      source_page: item.source_page,
      source_file_name: item.source_file_name,
      confidence: item.confidence,
      evidence: item.evidence,
      metadata: item.metadata,
    })),
    dpgf_quantity: input.dpgf.quantity,
    takeoff_quantity: aggregatedMetrics.quantity,
    quantity_unit: aggregatedMetrics.quantityUnit,
    matching_score: Number((input.matchingScore ?? 0).toFixed(4)),
    confidence_score: confidenceScore,
    review_status: reviewStatus,
    proofs: provisionalProofs,
    suggested_decision: suggestedDecision,
    applied_decision: appliedDecision,
    delta_absolute: quantityPolicy ? toStableNumber(quantityPolicy.absoluteGap) : delta.deltaAbsolute,
    delta_percent: quantityPolicy ? toStableNumber(quantityPolicy.percentGap) : delta.deltaPercent,
    is_exception: EXCEPTION_STATUSES.has(reviewStatus),
    manual_link_count: input.manualLinkCount,
    matched_by:
      input.manualLinkCount > 0
        ? "manual"
        : input.linkedTakeoffItems.length > 0
          ? "auto"
          : null,
    risk: null,
    ...(composition ? { composition: composition.row } : {}),
  };
}

export function buildTakeoffDpgfComparisonSummary(input: {
  rows: TakeoffDpgfComparisonRow[];
  unusedTakeoffItems: TakeoffDpgfComparisonUnusedTakeoffItem[];
}): TakeoffDpgfComparisonSummary {
  return input.rows.reduce<TakeoffDpgfComparisonSummary>(
    (summary, row) => {
      if (row.review_status === "reliable_match") {
        summary.reliable_matches += 1;
      }
      if (row.review_status === "to_confirm") {
        summary.to_confirm += 1;
      }
      if (row.review_status === "significant_gap") {
        summary.significant_gaps += 1;
      }
      if (row.review_status === "forced_manual" && !row.applied_decision) {
        summary.forced_manual += 1;
      }
      if (
        !row.applied_decision &&
        row.proofs.every((proof) => proof.type === "dpgf")
      ) {
        summary.lines_without_proof += 1;
      }

      summary.total_lines += 1;
      return summary;
    },
    {
      reliable_matches: 0,
      to_confirm: 0,
      significant_gaps: 0,
      forced_manual: 0,
      lines_without_proof: 0,
      unused_takeoff_items: input.unusedTakeoffItems.length,
      total_lines: 0,
    }
  );
}

function buildUnusedTakeoffItems(
  takeoffLines: NormalizedTakeoffLine[],
  usedTakeoffIds: Set<string>
): TakeoffDpgfComparisonUnusedTakeoffItem[] {
  return takeoffLines
    .filter((line) => !usedTakeoffIds.has(line.item_id))
    .map((line) => ({
      item_id: line.item_id,
      designation: line.designation,
      quantity: line.quantity,
      unit: line.unit,
      source_file_name: line.source_file_name,
      source_page: line.source_page,
      confidence_score: line.confidence,
      evidence: line.evidence,
    }));
}

function buildManualLinkCandidates(
  takeoffLines: NormalizedTakeoffLine[]
): TakeoffDpgfComparisonUnusedTakeoffItem[] {
  return takeoffLines.map((line) => ({
    item_id: line.item_id,
    designation: line.designation,
    quantity: line.quantity,
    unit: line.unit,
    source_file_name: line.source_file_name,
    source_page: line.source_page,
    confidence_score: line.confidence,
    evidence: line.evidence,
  }));
}

function normalizeView(view: TakeoffDpgfComparisonView | undefined) {
  return view === "exceptions_only" ? "exceptions_only" : "all";
}

export function computeTakeoffDpgfRows(input: BuildTakeoffDpgfComparisonInput) {
  const threshold = normalizeThreshold(input.threshold);
  const normalizedDpgfLines: NormalizedDpgfLine[] = input.dpgfLines.map((line) => ({
    ...line,
    searchText: buildDpgfSearchText(line),
    normalizedUnit: normalizeTakeoffDpgfUnit(line.unit),
    quantityIdentity: quantityIdentity({ designation: line.title, description: line.description, unit: line.unit ?? "", quantity: line.quantity ?? 0 }),
  }));
  const normalizedTakeoffLines: NormalizedTakeoffLine[] = input.takeoffLines.map((line) => ({
    ...line,
    searchText: buildTakeoffSearchText(line),
    normalizedUnit: normalizeTakeoffDpgfUnit(line.unit),
    quantityIdentity: quantityIdentity(line),
  }));

  const takeoffById = new Map(
    normalizedTakeoffLines.map((line) => [line.item_id, line] as const)
  );
  const manualLinksByEstimateItemId = new Map<string, TakeoffDpgfManualLinkRecord[]>();
  for (const link of input.manualLinks ?? []) {
    if (!takeoffById.has(link.takeoff_item_id)) continue;
    const links = manualLinksByEstimateItemId.get(link.estimate_item_id) ?? [];
    links.push(link);
    manualLinksByEstimateItemId.set(link.estimate_item_id, links);
  }

  const decisionByEstimateItemId = new Map(
    (input.reviewDecisions ?? []).map((decision) => [decision.estimate_item_id, decision] as const)
  );
  const usedTakeoffIds = new Set<string>();

  // Les liens manuels sont prioritaires : leurs items de métré sont retirés du
  // pool avant l'affectation automatique, et les lignes DPGF concernées n'y
  // participent pas.
  const manuallyUsedTakeoffIds = new Set<string>();
  for (const dpgfLine of normalizedDpgfLines) {
    const links = manualLinksByEstimateItemId.get(dpgfLine.estimate_item_id) ?? [];
    for (const link of links) {
      const item = takeoffById.get(link.takeoff_item_id);
      if (item) {
        manuallyUsedTakeoffIds.add(item.item_id);
      }
    }
  }

  const autoMatchByDpgfId = resolveGlobalAutoMatches({
    dpgfLines: normalizedDpgfLines.filter(
      (line) =>
        (manualLinksByEstimateItemId.get(line.estimate_item_id) ?? []).length === 0
    ),
    takeoffLines: normalizedTakeoffLines.filter(
      (line) => !manuallyUsedTakeoffIds.has(line.item_id)
    ),
    threshold,
  });
  // Several plan pages can contribute to the same homogeneous price line. Only an exact, unique label
  // extends an automatic match; fuzzy competitors keep the global one-to-one allocation above.
  const automaticallyUsed = new Set([...autoMatchByDpgfId.values()].map(match => match.line.item_id));
  const additionalMatches = new Map<string, NormalizedTakeoffLine[]>();
  for (const candidate of normalizedTakeoffLines) {
    if (automaticallyUsed.has(candidate.item_id) || manuallyUsedTakeoffIds.has(candidate.item_id)) continue;
    const eligible = normalizedDpgfLines.filter(dpgf => autoMatchByDpgfId.has(dpgf.estimate_item_id)
      && normalizeTakeoffCompareText(dpgf.title) === candidate.searchText && computeMatchScore({ dpgf, takeoff: candidate }) !== null);
    if (eligible.length !== 1) continue;
    const id = eligible[0].estimate_item_id;
    additionalMatches.set(id, [...(additionalMatches.get(id) ?? []), candidate]);
  }
  const rows: TakeoffDpgfComparisonRow[] = [];

  for (const dpgfLine of normalizedDpgfLines) {
    const manualLinks = manualLinksByEstimateItemId.get(dpgfLine.estimate_item_id) ?? [];
    const manuallyLinkedTakeoffItems = manualLinks
      .map((link) => takeoffById.get(link.takeoff_item_id) ?? null)
      .filter((item): item is NormalizedTakeoffLine => item !== null);
    const current = decisionByEstimateItemId.get(dpgfLine.estimate_item_id);
    const explicitDecision = current && current.line_label === dpgfLine.title &&
      current.source_file_name === dpgfLine.source_file_name && current.source_page === dpgfLine.source_page
      ? current : null;
    const carriedDecision = explicitDecision ?? input.carriedReviewDecisions?.get(dpgfLine.estimate_item_id) ?? null;

    if (manuallyLinkedTakeoffItems.length > 0) {
      manuallyLinkedTakeoffItems.forEach((item) => usedTakeoffIds.add(item.item_id));
      const matchingScores = manuallyLinkedTakeoffItems
        .map((item) =>
          computeMatchScore({
            dpgf: dpgfLine,
            takeoff: item,
          }) ?? 0.45
        )
        .filter((score) => Number.isFinite(score));
      const averageMatchingScore =
        matchingScores.length > 0
          ? matchingScores.reduce((sum, score) => sum + score, 0) /
            matchingScores.length
          : 0.45;

      rows.push(
        buildRow({
          dpgf: dpgfLine,
          linkedTakeoffItems: manuallyLinkedTakeoffItems,
          manualLinkCount: manualLinks.length,
          matchingScore: averageMatchingScore,
          threshold,
          appliedDecision: carriedDecision,
          composition: input,
        })
      );
      continue;
    }

    const bestMatch =
      autoMatchByDpgfId.get(dpgfLine.estimate_item_id) ?? null;

    if (bestMatch) {
      const matches = [bestMatch.line, ...(additionalMatches.get(dpgfLine.estimate_item_id) ?? [])];
      matches.forEach(item => usedTakeoffIds.add(item.item_id));
      rows.push(
        buildRow({
          dpgf: dpgfLine,
          linkedTakeoffItems: matches,
          manualLinkCount: 0,
          matchingScore: bestMatch.score,
          threshold,
          appliedDecision: carriedDecision,
          composition: input,
        })
      );
      continue;
    }

    rows.push(
      buildRow({
        dpgf: dpgfLine,
        linkedTakeoffItems: [],
        manualLinkCount: 0,
        matchingScore: null,
        threshold,
        appliedDecision: carriedDecision,
        composition: input,
      })
    );
  }

  return { rows, normalizedTakeoffLines, usedTakeoffIds, threshold };
}

export function buildTakeoffDpgfComparison(input: BuildTakeoffDpgfComparisonInput): TakeoffDpgfComparisonResponse {
  const { rows, normalizedTakeoffLines, usedTakeoffIds, threshold } = computeTakeoffDpgfRows(input);
  const pageSize = normalizePageSize(input.pageSize);
  const offset = decodeCursor(input.cursor);
  const view = normalizeView(input.view);
  const unusedTakeoffItems = buildUnusedTakeoffItems(normalizedTakeoffLines, usedTakeoffIds);
  const summary = buildTakeoffDpgfComparisonSummary({ rows, unusedTakeoffItems });
  const visibleRows =
    view === "exceptions_only"
      ? rows.filter((row) => row.is_exception)
      : rows;
  const paginatedRows = visibleRows.slice(offset, offset + pageSize);
  const nextOffset = offset + paginatedRows.length;

  return {
    version_id: input.versionId,
    job_id: input.jobId,
    view,
    threshold,
    summary,
    rows: paginatedRows,
    manual_link_candidates: buildManualLinkCandidates(normalizedTakeoffLines),
    unused_takeoff_items: unusedTakeoffItems,
    pagination: {
      page_size: pageSize,
      next_cursor: nextOffset < visibleRows.length ? encodeCursor(nextOffset) : null,
      total: visibleRows.length,
    },
  };
}
