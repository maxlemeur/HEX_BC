import type { CataloguePriceSuggestion } from "@/lib/estimates/catalogue-suggestions";
import { alternativePriceForLineUnit } from "@/lib/estimates/supplier-offer-purchase-unit";
import { computeTakeoffSimilarityRatio, normalizeTakeoffCompareText } from "@/lib/takeoff/diff";
import {
  type TakeoffPriceSuggestionAction,
  type TakeoffPriceSuggestionSnapshot,
  type TakeoffPriceSuggestionSourceKind,
} from "@/lib/takeoff/types";
import {
  buildTakeoffPriceSuggestion,
  type TakeoffPriceSuggestionCandidate,
} from "@/lib/takeoff/price-suggestions";
import { createHash } from "node:crypto";

export type EstimateItemPriceSuggestionRow = {
  id: string;
  version_id: string;
  position: number;
  title: string;
  description: string | null;
  quantity: number | null;
  selected_supplier_price_id: string | null;
  source_file_name: string | null;
  source_page: number | null;
  source_provider: string | null;
  item_type: "section" | "line";
  unit: string | null;
  category_id: string | null;
  unit_price_ht_cents: number | null;
  updated_at: string;
};

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (!isRecord(value)) {
    return JSON.stringify(String(value));
  }

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`);

  return `{${entries.join(",")}}`;
}

function formatPriceSuggestionFreshnessLabel(input: {
  updatedAt: string | null;
  isStale?: boolean;
  now: number;
}): string | null {
  if (input.isStale) return "ancienne";
  if (!input.updatedAt) return null;

  const updatedAtMs = Date.parse(input.updatedAt);
  if (!Number.isFinite(updatedAtMs)) return null;

  const ageDays = Math.floor((input.now - updatedAtMs) / (24 * 60 * 60 * 1000));
  if (ageDays <= 30) return "fraiche";
  if (ageDays <= 180) return "recente";
  return "historique";
}

export function buildPriceSuggestionFingerprint(input: {
  lineId: string;
  versionId: string;
  jobId: string;
  currentPriceCents: number | null;
  quantity: number | null;
  unit: string | null;
  suggestion: ReturnType<typeof buildTakeoffPriceSuggestion>;
}) {
  return toHexSha256(
    stableSerialize({
      line_id: input.lineId,
      version_id: input.versionId,
      job_id: input.jobId,
      current_price_cents: input.currentPriceCents,
      quantity: input.quantity,
      unit: input.unit,
      low_cents: input.suggestion.lowCents,
      target_cents: input.suggestion.targetCents,
      high_cents: input.suggestion.highCents,
      sources: input.suggestion.sources.map((source) => ({
        source_kind: source.source_kind,
        kind: source.kind,
        label: source.label,
        source_ref: source.source_ref,
        price_cents: source.price_cents,
        freshness_label: source.freshness_label,
        confidence_score: source.confidence_score,
        is_outlier: source.is_outlier,
        source_record_table: source.source_record_table,
        source_record_id: source.source_record_id,
        metadata: source.metadata,
      })),
    })
  );
}

export function getPriceSuggestionSelectedPriceCents(input: {
  action: TakeoffPriceSuggestionAction;
  suggestion: Pick<TakeoffPriceSuggestionSnapshot, "low_cents" | "target_cents" | "high_cents" | "current_price_cents">;
}) {
  if (input.action === "apply_low") return input.suggestion.low_cents;
  if (input.action === "apply_target") return input.suggestion.target_cents;
  if (input.action === "apply_high") return input.suggestion.high_cents;
  if (input.action === "keep_current") return input.suggestion.current_price_cents;
  return null;
}

export function buildPriceSuggestionStatus(
  action: TakeoffPriceSuggestionAction
): TakeoffPriceSuggestionSnapshot["status"] {
  if (action === "keep_current") return "kept_current";
  if (action === "reject") return "rejected";
  return "applied";
}

export function isTakeoffPriceSuggestionPending(
  suggestion: { status: string; reviewed_at: string | null }
) {
  return suggestion.status === "pending" && suggestion.reviewed_at === null;
}

export function buildPriceSuggestionQueryText(line: {
  title: string;
  description: string | null;
}) {
  const joined = [line.title, line.description ?? ""]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join(" ")
    .slice(0, 180)
    .trim();

  return joined.length >= 2 ? joined : line.title.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toHexSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Prepare all source evidence from one authorized read and one clock instant. */
export function prepareTakeoffPriceSuggestionSources(input: {
  line: EstimateItemPriceSuggestionRow;
  versionId: string;
  projectId: string;
  catalogueSuggestions: CataloguePriceSuggestion[];
  candidateRows: EstimateItemPriceSuggestionRow[];
  candidateVersionById: ReadonlyMap<string, { project_id: string; version_number: number | null }>;
  now: number;
}): TakeoffPriceSuggestionCandidate[] {
  const normalizedCurrentText = normalizeTakeoffCompareText(
    `${input.line.title} ${input.line.description ?? ""}`
  );
  const normalizedUnit =
    typeof input.line.unit === "string" && input.line.unit.trim().length > 0
      ? normalizeTakeoffCompareText(input.line.unit)
      : null;

  const pricebookSources: TakeoffPriceSuggestionCandidate[] =
    input.catalogueSuggestions.slice(0, 5).map((suggestion, index) => {
      // 2.9: a converted offer gives a takeoff line its price per estimate unit, or per bar for a line in bars.
      const linePrice = alternativePriceForLineUnit(suggestion, input.line.unit);
      const unitMatch =
        normalizedUnit !== null &&
        typeof linePrice.unit === "string" &&
        normalizeTakeoffCompareText(linePrice.unit) === normalizedUnit;
      const freshnessLabel = formatPriceSuggestionFreshnessLabel({
        updatedAt: suggestion.updated_at,
        now: input.now,
        isStale: suggestion.is_stale,
      });
      const confidenceScore = Math.max(
        0.3,
        Math.min(1, suggestion.relevance_score ?? 0.6)
      );

      return {
        sourceKind: "pricebook",
        kind: "fact",
        label: `${suggestion.supplier_name} - ${suggestion.product_designation}`,
        sourceRef: suggestion.supplier_reference
          ? `Pricebook ${suggestion.supplier_name} (${suggestion.supplier_reference})`
          : `Pricebook ${suggestion.supplier_name}`,
        priceCents: linePrice.priceCents,
        freshnessLabel,
        confidenceScore,
        sourceRecordTable: "supplier_pricebook",
        sourceRecordId: suggestion.supplier_price_id,
        weight:
          Math.max(0.25, suggestion.relevance_score) *
          (suggestion.is_stale ? 0.75 : 1.05) *
          (unitMatch ? 1.1 : 0.95) *
          (index === 0 ? 1.05 : 1),
        metadata: {
          fact_type: "catalogue_pricebook",
          product_id: suggestion.product_id,
          supplier_id: suggestion.supplier_id,
          supplier_name: suggestion.supplier_name,
          supplier_reference: suggestion.supplier_reference,
          currency: suggestion.currency,
          updated_at: suggestion.updated_at,
          is_stale: suggestion.is_stale,
          relevance_score: suggestion.relevance_score,
          unit: linePrice.unit,
          unit_match: unitMatch,
          category_match: false,
        },
      };
    });

  const internalCandidates = input.candidateRows
    .filter((row) => row.id !== input.line.id)
    .filter((row) => row.version_id !== input.versionId || row.id !== input.line.id)
    .filter((row) => typeof row.unit_price_ht_cents === "number" && row.unit_price_ht_cents > 0)
    .map((row) => {
      const normalizedCandidateText = normalizeTakeoffCompareText(
        `${row.title} ${row.description ?? ""}`
      );
      const similarity =
        normalizedCurrentText.length > 0 && normalizedCandidateText.length > 0
          ? computeTakeoffSimilarityRatio(normalizedCurrentText, normalizedCandidateText)
          : 0;
      const versionMeta = input.candidateVersionById.get(row.version_id) ?? null;
      const sameProject = versionMeta?.project_id === input.projectId;
      const categoryMatch =
        typeof input.line.category_id === "string" &&
        typeof row.category_id === "string" &&
        input.line.category_id === row.category_id;
      const unitMatch =
        normalizedUnit !== null &&
        typeof row.unit === "string" &&
        normalizeTakeoffCompareText(row.unit) === normalizedUnit;
      const freshnessLabel = formatPriceSuggestionFreshnessLabel({
        updatedAt: row.updated_at,
        now: input.now,
      });

      return {
        row,
        similarity,
        sameProject,
        categoryMatch,
        unitMatch,
        qualifiesAsSameProjectHistory:
          sameProject &&
          similarity >= 0.2 &&
          (categoryMatch || unitMatch || similarity >= 0.55),
        freshnessLabel,
        versionNumber: versionMeta?.version_number ?? null,
      };
    })
    .filter(
      (entry) => entry.qualifiesAsSameProjectHistory || entry.similarity >= 0.55
    )
    .sort((left, right) => {
      if (left.qualifiesAsSameProjectHistory !== right.qualifiesAsSameProjectHistory) {
        return left.qualifiesAsSameProjectHistory ? -1 : 1;
      }
      if (Math.abs(right.similarity - left.similarity) > 0.0001) {
        return right.similarity - left.similarity;
      }
      return right.row.updated_at.localeCompare(left.row.updated_at);
    });

  const historySources: TakeoffPriceSuggestionCandidate[] = [];
  const similarItemSources: TakeoffPriceSuggestionCandidate[] = [];

  for (const candidate of internalCandidates) {
    const sourceKind: TakeoffPriceSuggestionSourceKind =
      candidate.qualifiesAsSameProjectHistory || candidate.similarity >= 0.82
        ? "history"
        : "similar_item";
    const confidenceScore = Math.max(
      sourceKind === "history" ? 0.45 : 0.3,
      Math.min(1, candidate.similarity + (candidate.sameProject ? 0.15 : 0))
    );
    const targetCollection =
      sourceKind === "history" ? historySources : similarItemSources;

    if (
      (sourceKind === "history" && historySources.length >= 6) ||
      (sourceKind === "similar_item" && similarItemSources.length >= 6)
    ) {
      continue;
    }

    targetCollection.push({
      sourceKind,
      kind: sourceKind === "history" ? "fact" : "inference",
      label: candidate.row.title,
      sourceRef:
        sourceKind === "history"
          ? candidate.sameProject
            ? `Historique projet${
                typeof candidate.versionNumber === "number"
                  ? ` v${candidate.versionNumber}`
                  : ""
              }`
            : "Historique interne"
          : `Ouvrage proche${
              typeof candidate.versionNumber === "number"
                ? ` v${candidate.versionNumber}`
                : ""
            }`,
      priceCents: candidate.row.unit_price_ht_cents ?? 0,
      freshnessLabel: candidate.freshnessLabel,
      confidenceScore,
      sourceRecordTable: "estimate_items",
      sourceRecordId: candidate.row.id,
      weight:
        (sourceKind === "history" ? 1.1 : 0.8) *
        Math.max(0.2, candidate.similarity) *
        (candidate.sameProject ? 1.2 : 1) *
        (candidate.unitMatch ? 1.1 : 0.95) *
        (candidate.categoryMatch ? 1.05 : 1),
      metadata: {
        fact_type: sourceKind === "history" ? "internal_history" : "similar_internal_item",
        similarity_score: Number(candidate.similarity.toFixed(4)),
        same_project: candidate.sameProject,
        version_id: candidate.row.version_id,
        version_number: candidate.versionNumber,
        updated_at: candidate.row.updated_at,
        quantity: candidate.row.quantity,
        unit: candidate.row.unit,
        unit_match: candidate.unitMatch,
        category_id: candidate.row.category_id,
        category_match: candidate.categoryMatch,
      },
    });
  }

  return [...pricebookSources, ...historySources, ...similarItemSources];
}
