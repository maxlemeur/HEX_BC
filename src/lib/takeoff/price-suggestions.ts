import { normalizeTakeoffCompareText } from "@/lib/takeoff/diff";
import type {
  TakeoffDpgfComparisonEvidenceKind,
  TakeoffPriceSuggestionConfidenceLabel,
  TakeoffPriceSuggestionFactor,
  TakeoffPriceSuggestionSource,
  TakeoffPriceSuggestionSourceKind,
} from "@/lib/takeoff/types";

export type TakeoffPriceSuggestionCandidate = {
  sourceKind: TakeoffPriceSuggestionSourceKind;
  kind: TakeoffDpgfComparisonEvidenceKind;
  label: string;
  sourceRef: string;
  priceCents: number;
  freshnessLabel: string | null;
  confidenceScore: number | null;
  sourceRecordTable: string | null;
  sourceRecordId: string | null;
  weight: number;
  metadata: Record<string, unknown>;
};

export type BuiltTakeoffPriceSuggestion = {
  lowCents: number;
  targetCents: number;
  highCents: number;
  confidenceScore: number;
  confidenceLabel: TakeoffPriceSuggestionConfidenceLabel;
  candidateCount: number;
  outlierCount: number;
  justification: string;
  factors: TakeoffPriceSuggestionFactor[];
  summary: Record<string, unknown>;
  sources: TakeoffPriceSuggestionSource[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

function weightedQuantile(
  values: Array<{ priceCents: number; weight: number }>,
  quantile: number
) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left.priceCents - right.priceCents);
  const totalWeight = sorted.reduce((sum, entry) => sum + Math.max(entry.weight, 0.001), 0);
  const targetWeight = totalWeight * clamp(quantile, 0, 1);
  let cumulative = 0;

  for (const entry of sorted) {
    cumulative += Math.max(entry.weight, 0.001);
    if (cumulative >= targetWeight) {
      return entry.priceCents;
    }
  }

  return sorted[sorted.length - 1]?.priceCents ?? 0;
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function computeOutlierBounds(values: number[]) {
  if (values.length < 4) {
    return {
      low: Number.NEGATIVE_INFINITY,
      high: Number.POSITIVE_INFINITY,
    };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const q1 = median(sorted.slice(0, Math.floor(sorted.length / 2)));
  const q3 = median(sorted.slice(Math.ceil(sorted.length / 2)));
  const iqr = q3 - q1;

  return {
    low: q1 - iqr * 1.5,
    high: q3 + iqr * 1.5,
  };
}

function uniqueSourceKinds(
  sources: Array<{ sourceKind: TakeoffPriceSuggestionSourceKind }>
) {
  return Array.from(new Set(sources.map((source) => source.sourceKind)));
}

function buildConfidence(input: {
  nonOutlierSources: TakeoffPriceSuggestionCandidate[];
  lowCents: number;
  targetCents: number;
  highCents: number;
}) {
  const diversityScore = uniqueSourceKinds(input.nonOutlierSources).length / 3;
  const volumeScore = Math.min(input.nonOutlierSources.length, 6) / 6;
  const spread =
    input.targetCents <= 0 ? 1 : (input.highCents - input.lowCents) / input.targetCents;
  const dispersionScore = 1 - clamp(spread, 0, 1);
  const score = clamp(
    volumeScore * 0.45 + diversityScore * 0.35 + dispersionScore * 0.2,
    0,
    1
  );

  let label: TakeoffPriceSuggestionConfidenceLabel = "low";
  if (score >= 0.75) {
    label = "high";
  } else if (score >= 0.5) {
    label = "medium";
  }

  return {
    score: Number(score.toFixed(4)),
    label,
  };
}

function buildQuantityFactor(quantity: number | null): TakeoffPriceSuggestionFactor | null {
  if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) {
    return null;
  }

  if (quantity <= 1) {
    return {
      key: "quantity_bucket",
      label: "Quantité",
      value: "Unitaire",
      kind: "fact",
    };
  }

  if (quantity <= 10) {
    return {
      key: "quantity_bucket",
      label: "Quantité",
      value: "Standard",
      kind: "fact",
    };
  }

  return {
    key: "quantity_bucket",
    label: "Quantité",
    value: "Volumique",
    kind: "fact",
  };
}

function buildFreshnessFactor(
  sources: TakeoffPriceSuggestionSource[]
): TakeoffPriceSuggestionFactor | null {
  const freshnessLabels = Array.from(
    new Set(
      sources
        .map((source) => source.freshness_label?.trim())
        .filter((label): label is string => Boolean(label))
    )
  );
  if (freshnessLabels.length === 0) return null;

  return {
    key: "date_freshness",
    label: "Fraicheur",
    value: freshnessLabels.slice(0, 2).join(" / "),
    kind: "fact",
  };
}

function buildHistoryFactor(
  sources: TakeoffPriceSuggestionSource[]
): TakeoffPriceSuggestionFactor | null {
  const sameProjectCount = sources.filter(
    (source) =>
      source.source_kind === "history" && source.metadata.same_project === true
  ).length;
  if (sameProjectCount === 0) return null;

  return {
    key: "same_project_history",
    label: "Historique projet",
    value: `${sameProjectCount} reference${sameProjectCount > 1 ? "s" : ""}`,
    kind: "fact",
  };
}

function buildCategoryFactor(
  sources: TakeoffPriceSuggestionSource[]
): TakeoffPriceSuggestionFactor | null {
  const categoryMatchCount = sources.filter(
    (source) => source.metadata.category_match === true
  ).length;
  if (categoryMatchCount === 0) return null;

  return {
    key: "category_match",
    label: "Categorie",
    value: `${categoryMatchCount} source${categoryMatchCount > 1 ? "s" : ""} coherente${categoryMatchCount > 1 ? "s" : ""}`,
    kind: "inference",
  };
}

function buildUnitFactor(
  sources: TakeoffPriceSuggestionSource[],
  currentUnit: string | null
): TakeoffPriceSuggestionFactor | null {
  if (!currentUnit) return null;

  const normalizedCurrentUnit = normalizeTakeoffCompareText(currentUnit);
  const unitMatchCount = sources.filter((source) => {
    const sourceUnit =
      typeof source.metadata.unit === "string"
        ? normalizeTakeoffCompareText(source.metadata.unit)
        : null;
    return sourceUnit !== null && sourceUnit === normalizedCurrentUnit;
  }).length;

  if (unitMatchCount === 0) return null;

  return {
    key: "unit_match",
    label: "Unite",
    value: `${currentUnit} confirme`,
    kind: "fact",
  };
}

function buildJustification(input: {
  sources: TakeoffPriceSuggestionSource[];
  outlierCount: number;
  confidenceLabel: TakeoffPriceSuggestionConfidenceLabel;
}) {
  const countsByKind = new Map<TakeoffPriceSuggestionSourceKind, number>();
  input.sources.forEach((source) => {
    countsByKind.set(source.source_kind, (countsByKind.get(source.source_kind) ?? 0) + 1);
  });

  const segments = [
    countsByKind.get("pricebook")
      ? `${countsByKind.get("pricebook")} source${countsByKind.get("pricebook")! > 1 ? "s" : ""} fournisseur`
      : null,
    countsByKind.get("history")
      ? `${countsByKind.get("history")} reference${countsByKind.get("history")! > 1 ? "s" : ""} interne${countsByKind.get("history")! > 1 ? "s" : ""}`
      : null,
    countsByKind.get("similar_item")
      ? `${countsByKind.get("similar_item")} ouvrage${countsByKind.get("similar_item")! > 1 ? "s" : ""} proche${countsByKind.get("similar_item")! > 1 ? "s" : ""}`
      : null,
  ].filter((segment): segment is string => Boolean(segment));

  const mainSentence =
    segments.length > 0
      ? `Fourchette calculee a partir de ${segments.join(", ")}.`
      : "Fourchette calculee a partir des sources disponibles.";
  const outlierSentence =
    input.outlierCount > 0
      ? `${input.outlierCount} prix atypique${input.outlierCount > 1 ? "s" : ""} reste${input.outlierCount > 1 ? "nt" : ""} visible${input.outlierCount > 1 ? "s" : ""} mais hors calcul principal.`
      : null;
  const confidenceSentence =
    input.confidenceLabel === "high"
      ? "Confiance elevee: plusieurs sources convergent sur une borne centrale stable."
      : input.confidenceLabel === "medium"
        ? "Confiance moyenne: les sources convergent partiellement et justifient une validation humaine."
        : "Confiance faible: la dispersion reste significative et la validation humaine est indispensable.";

  return [mainSentence, outlierSentence, confidenceSentence]
    .filter((sentence): sentence is string => Boolean(sentence))
    .join(" ");
}

function buildSummary(input: {
  nonOutlierSources: TakeoffPriceSuggestionSource[];
  outlierCount: number;
}) {
  const sourceKinds = uniqueSourceKinds(
    input.nonOutlierSources.map((source) => ({
      sourceKind: source.source_kind,
    }))
  );

  return {
    non_outlier_candidate_count: input.nonOutlierSources.length,
    outlier_count: input.outlierCount,
    source_kinds: sourceKinds,
    same_project_history_count: input.nonOutlierSources.filter(
      (source) => source.source_kind === "history" && source.metadata.same_project === true
    ).length,
  };
}

export function buildTakeoffPriceSuggestion(input: {
  currentPriceCents: number | null;
  currentUnit: string | null;
  quantity: number | null;
  sources: TakeoffPriceSuggestionCandidate[];
}): BuiltTakeoffPriceSuggestion {
  if (input.sources.length === 0) {
    throw new Error("Au moins une source de prix est requise.");
  }

  const outlierBounds = computeOutlierBounds(input.sources.map((source) => source.priceCents));
  const normalizedSources = input.sources
    .map<TakeoffPriceSuggestionSource>((source, index) => ({
      source_id: `${source.sourceKind}:${source.sourceRecordId ?? index}`,
      source_kind: source.sourceKind,
      kind: source.kind,
      label: source.label,
      source_ref: source.sourceRef,
      price_cents: source.priceCents,
      freshness_label: source.freshnessLabel,
      confidence_score: source.confidenceScore,
      rank: index + 1,
      is_outlier:
        source.priceCents < outlierBounds.low || source.priceCents > outlierBounds.high,
      source_record_table: source.sourceRecordTable,
      source_record_id: source.sourceRecordId,
      metadata: source.metadata,
    }))
    .sort((left, right) => {
      if (left.rank !== right.rank) return left.rank - right.rank;
      return left.price_cents - right.price_cents;
    });

  const nonOutlierSourceIds = new Set(
    normalizedSources.filter((source) => !source.is_outlier).map((source) => source.source_id)
  );
  const weightedSources = input.sources
    .map((source, index) => ({
      source,
      normalized: normalizedSources[index]!,
    }))
    .filter(({ normalized }) => nonOutlierSourceIds.has(normalized.source_id));

  const calculationSources = weightedSources.length > 0 ? weightedSources : input.sources.map((source, index) => ({
    source,
    normalized: normalizedSources[index]!,
  }));

  const weightedValues = calculationSources.map(({ source }) => ({
    priceCents: source.priceCents,
    weight: Math.max(source.weight, 0.001),
  }));

  const lowCents = roundMoney(weightedQuantile(weightedValues, 0.2));
  const targetCents = roundMoney(weightedQuantile(weightedValues, 0.5));
  const highCents = roundMoney(weightedQuantile(weightedValues, 0.8));
  const confidence = buildConfidence({
    nonOutlierSources: calculationSources.map(({ source }) => source),
    lowCents,
    targetCents,
    highCents,
  });
  const outlierCount = normalizedSources.filter((source) => source.is_outlier).length;
  const factors = [
    buildQuantityFactor(input.quantity),
    buildFreshnessFactor(normalizedSources),
    buildHistoryFactor(normalizedSources),
    buildCategoryFactor(normalizedSources),
    buildUnitFactor(normalizedSources, input.currentUnit),
  ].filter((factor): factor is TakeoffPriceSuggestionFactor => factor !== null);

  return {
    lowCents,
    targetCents,
    highCents,
    confidenceScore: confidence.score,
    confidenceLabel: confidence.label,
    candidateCount: normalizedSources.length,
    outlierCount,
    justification: buildJustification({
      sources: normalizedSources,
      outlierCount,
      confidenceLabel: confidence.label,
    }),
    factors,
    summary: buildSummary({
      nonOutlierSources: normalizedSources.filter((source) => !source.is_outlier),
      outlierCount,
    }),
    sources: normalizedSources,
  };
}
