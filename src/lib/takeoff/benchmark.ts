export type TakeoffBenchmarkItem = {
  id?: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence?: number | null;
  evidence?: string | null;
  source_page?: number | null;
};

export type TakeoffBenchmarkThresholds = {
  minDesignationSimilarity: number;
  minPrecision: number;
  minRecall: number;
  minQuantityAccuracy: number;
  minLocalizedProofCoverage: number;
  maxHighConfidenceErrorRate: number;
  highConfidenceThreshold: number;
  quantityRelativeTolerance: number;
  quantityAbsoluteTolerance: number;
};

export type TakeoffBenchmarkFailedCheck =
  | "precision"
  | "recall"
  | "quantity_accuracy"
  | "localized_proof_coverage"
  | "high_confidence_error_rate";

export type TakeoffBenchmarkMatch = {
  expectedIndex: number;
  candidateIndex: number;
  designationSimilarity: number;
  quantityMatches: boolean;
};

export type TakeoffBenchmarkReport = {
  passed: boolean;
  failedChecks: TakeoffBenchmarkFailedCheck[];
  expectedCount: number;
  candidateCount: number;
  matchedCount: number;
  falsePositiveCount: number;
  missingCount: number;
  quantityMatchCount: number;
  localizedProofCount: number;
  highConfidenceCount: number;
  highConfidenceErrorCount: number;
  precision: number;
  recall: number;
  quantityAccuracy: number;
  localizedProofCoverage: number;
  highConfidenceErrorRate: number;
  matches: TakeoffBenchmarkMatch[];
  unmatchedExpectedIndexes: number[];
  unmatchedCandidateIndexes: number[];
  thresholds: TakeoffBenchmarkThresholds;
};

export const DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS: TakeoffBenchmarkThresholds = {
  minDesignationSimilarity: 0.8,
  minPrecision: 0.95,
  minRecall: 0.95,
  minQuantityAccuracy: 0.98,
  minLocalizedProofCoverage: 1,
  maxHighConfidenceErrorRate: 0,
  highConfidenceThreshold: 0.8,
  quantityRelativeTolerance: 0.005,
  quantityAbsoluteTolerance: 0.01,
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/œ/g, "oe")
    .toLowerCase()
    .replace(/\bsalles? de bains?\b/g, "sdb")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeUnit(value: string) {
  const normalized = normalizeText(value).replace(/\s+/g, "");
  if (["m2", "mcarre", "metrecarre", "metrescarres"].includes(normalized)) {
    return "m2";
  }
  if (
    ["ml", "mlineaire", "metrelineaire", "metreslineaires"].includes(normalized)
  ) {
    return "ml";
  }
  if (["u", "unite", "unites", "piece", "pieces", "pcs"].includes(normalized)) {
    return "u";
  }
  return normalized;
}

function designationSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (normalizedLeft === normalizedRight) return 1;
  if (!normalizedLeft || !normalizedRight) return 0;

  const leftTokens = new Set(normalizedLeft.split(" "));
  const rightTokens = new Set(normalizedRight.split(" "));
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  return (2 * intersection) / (leftTokens.size + rightTokens.size);
}

function quantityMatches(
  expected: number,
  candidate: number,
  thresholds: TakeoffBenchmarkThresholds
) {
  if (!Number.isFinite(expected) || !Number.isFinite(candidate)) return false;
  const tolerance = Math.max(
    thresholds.quantityAbsoluteTolerance,
    Math.abs(expected) * thresholds.quantityRelativeTolerance
  );
  return Math.abs(expected - candidate) <= tolerance;
}

function ratio(numerator: number, denominator: number, emptyValue: number) {
  return denominator > 0 ? numerator / denominator : emptyValue;
}

export function evaluateTakeoffBenchmark(
  expectedItems: TakeoffBenchmarkItem[],
  candidateItems: TakeoffBenchmarkItem[],
  thresholdOverrides: Partial<TakeoffBenchmarkThresholds> = {}
): TakeoffBenchmarkReport {
  const thresholds = {
    ...DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS,
    ...thresholdOverrides,
  };
  const possibleMatches: Array<{
    expectedIndex: number;
    candidateIndex: number;
    designationSimilarity: number;
  }> = [];

  for (const [expectedIndex, expected] of expectedItems.entries()) {
    for (const [candidateIndex, candidate] of candidateItems.entries()) {
      if (normalizeUnit(expected.unit) !== normalizeUnit(candidate.unit)) continue;
      const similarity = designationSimilarity(
        expected.designation,
        candidate.designation
      );
      if (similarity < thresholds.minDesignationSimilarity) continue;
      possibleMatches.push({
        expectedIndex,
        candidateIndex,
        designationSimilarity: similarity,
      });
    }
  }

  possibleMatches.sort(
    (left, right) => right.designationSimilarity - left.designationSimilarity
  );
  const usedExpectedIndexes = new Set<number>();
  const usedCandidateIndexes = new Set<number>();
  const matches: TakeoffBenchmarkMatch[] = [];

  for (const possibleMatch of possibleMatches) {
    if (
      usedExpectedIndexes.has(possibleMatch.expectedIndex) ||
      usedCandidateIndexes.has(possibleMatch.candidateIndex)
    ) {
      continue;
    }
    usedExpectedIndexes.add(possibleMatch.expectedIndex);
    usedCandidateIndexes.add(possibleMatch.candidateIndex);
    matches.push({
      ...possibleMatch,
      quantityMatches: quantityMatches(
        expectedItems[possibleMatch.expectedIndex].quantity,
        candidateItems[possibleMatch.candidateIndex].quantity,
        thresholds
      ),
    });
  }

  const unmatchedExpectedIndexes = expectedItems
    .map((_, index) => index)
    .filter((index) => !usedExpectedIndexes.has(index));
  const unmatchedCandidateIndexes = candidateItems
    .map((_, index) => index)
    .filter((index) => !usedCandidateIndexes.has(index));
  const quantityMatchCount = matches.filter((match) => match.quantityMatches).length;
  const localizedProofCount = candidateItems.filter(
    (item) =>
      Boolean(item.evidence?.trim()) &&
      typeof item.source_page === "number" &&
      item.source_page >= 1
  ).length;
  const highConfidenceCandidateIndexes = new Set(
    candidateItems
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          typeof item.confidence === "number" &&
          item.confidence >= thresholds.highConfidenceThreshold
      )
      .map(({ index }) => index)
  );
  const incorrectMatchedCandidateIndexes = new Set(
    matches
      .filter((match) => !match.quantityMatches)
      .map((match) => match.candidateIndex)
  );
  const highConfidenceErrorCount = Array.from(highConfidenceCandidateIndexes).filter(
    (index) =>
      !usedCandidateIndexes.has(index) || incorrectMatchedCandidateIndexes.has(index)
  ).length;

  const precision = ratio(matches.length, candidateItems.length, expectedItems.length === 0 ? 1 : 0);
  const recall = ratio(matches.length, expectedItems.length, candidateItems.length === 0 ? 1 : 0);
  const quantityAccuracy = ratio(quantityMatchCount, matches.length, expectedItems.length === 0 ? 1 : 0);
  const localizedProofCoverage = ratio(
    localizedProofCount,
    candidateItems.length,
    expectedItems.length === 0 ? 1 : 0
  );
  const highConfidenceErrorRate = ratio(
    highConfidenceErrorCount,
    highConfidenceCandidateIndexes.size,
    0
  );
  const failedChecks: TakeoffBenchmarkFailedCheck[] = [];
  if (precision < thresholds.minPrecision) failedChecks.push("precision");
  if (recall < thresholds.minRecall) failedChecks.push("recall");
  if (quantityAccuracy < thresholds.minQuantityAccuracy) {
    failedChecks.push("quantity_accuracy");
  }
  if (localizedProofCoverage < thresholds.minLocalizedProofCoverage) {
    failedChecks.push("localized_proof_coverage");
  }
  if (highConfidenceErrorRate > thresholds.maxHighConfidenceErrorRate) {
    failedChecks.push("high_confidence_error_rate");
  }

  return {
    passed: failedChecks.length === 0,
    failedChecks,
    expectedCount: expectedItems.length,
    candidateCount: candidateItems.length,
    matchedCount: matches.length,
    falsePositiveCount: unmatchedCandidateIndexes.length,
    missingCount: unmatchedExpectedIndexes.length,
    quantityMatchCount,
    localizedProofCount,
    highConfidenceCount: highConfidenceCandidateIndexes.size,
    highConfidenceErrorCount,
    precision,
    recall,
    quantityAccuracy,
    localizedProofCoverage,
    highConfidenceErrorRate,
    matches,
    unmatchedExpectedIndexes,
    unmatchedCandidateIndexes,
    thresholds,
  };
}
