import type {
  TakeoffDiffAddedEntry,
  TakeoffDiffChangedEntry,
  TakeoffDiffField,
  TakeoffDiffMatchStrategy,
  TakeoffDiffRemovedEntry,
  TakeoffDiffUnchangedEntry,
  TakeoffJobCompareSummary,
  TakeoffJobItem,
} from "@/lib/takeoff/types";

export const TAKEOFF_COMPARE_DEFAULT_THRESHOLD = 0.8;
export const TAKEOFF_COMPARE_MIN_THRESHOLD = 0.5;
export const TAKEOFF_COMPARE_MAX_THRESHOLD = 0.99;

const EPSILON = 1e-9;

type TakeoffFieldConfig = {
  field: TakeoffDiffField["field"];
  label: string;
  kind: TakeoffDiffField["kind"];
};

type MatchedPair = {
  otherIndex: number;
  score: number;
  strategy: TakeoffDiffMatchStrategy;
};

type CandidateMatch = {
  baseIndex: number;
  otherIndex: number;
  score: number;
  strategy: TakeoffDiffMatchStrategy;
  pageDistance: number;
};

export type BuildTakeoffDiffInput = {
  baseItems: TakeoffJobItem[];
  otherItems: TakeoffJobItem[];
  threshold?: number;
};

export type BuildTakeoffDiffResult = {
  threshold: number;
  summary: TakeoffJobCompareSummary;
  added: TakeoffDiffAddedEntry[];
  removed: TakeoffDiffRemovedEntry[];
  changed: TakeoffDiffChangedEntry[];
  unchanged: TakeoffDiffUnchangedEntry[];
};

const TAKEOFF_DIFF_FIELDS: readonly TakeoffFieldConfig[] = [
  {
    field: "designation",
    label: "Designation",
    kind: "text",
  },
  {
    field: "quantity",
    label: "Quantite",
    kind: "number",
  },
  {
    field: "unit",
    label: "Unite",
    kind: "text",
  },
  {
    field: "source_page",
    label: "Page source",
    kind: "number",
  },
  {
    field: "confidence",
    label: "Confiance",
    kind: "number",
  },
  {
    field: "evidence",
    label: "Evidence",
    kind: "text",
  },
] as const;

export function normalizeTakeoffCompareText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDiffThreshold(value: number | undefined) {
  if (!Number.isFinite(value)) return TAKEOFF_COMPARE_DEFAULT_THRESHOLD;
  if ((value ?? 0) < TAKEOFF_COMPARE_MIN_THRESHOLD) return TAKEOFF_COMPARE_MIN_THRESHOLD;
  if ((value ?? 0) > TAKEOFF_COMPARE_MAX_THRESHOLD) return TAKEOFF_COMPARE_MAX_THRESHOLD;
  return Number((value ?? TAKEOFF_COMPARE_DEFAULT_THRESHOLD).toFixed(2));
}

function normalizeTextValue(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeNumberValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Object.is(value, -0) ? 0 : value;
}

function getPageDistance(left: TakeoffJobItem, right: TakeoffJobItem) {
  if (
    typeof left.source_page === "number" &&
    Number.isFinite(left.source_page) &&
    typeof right.source_page === "number" &&
    Number.isFinite(right.source_page)
  ) {
    return Math.abs(left.source_page - right.source_page);
  }

  return Number.MAX_SAFE_INTEGER;
}

function getNormalizedDesignation(item: TakeoffJobItem): string {
  return normalizeTakeoffCompareText(item.designation);
}

function getNormalizedDesignationWithPage(item: TakeoffJobItem): string | null {
  const normalizedDesignation = getNormalizedDesignation(item);
  const sourcePage = normalizeNumberValue(item.source_page);

  if (!normalizedDesignation || sourcePage === null) {
    return null;
  }

  return `${normalizedDesignation} p${sourcePage}`;
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const distances = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let i = 1; i <= left.length; i += 1) {
    let previous = i - 1;
    distances[0] = i;

    for (let j = 1; j <= right.length; j += 1) {
      const temp = distances[j];
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      distances[j] = Math.min(
        distances[j] + 1,
        distances[j - 1] + 1,
        previous + substitutionCost
      );
      previous = temp;
    }
  }

  return distances[right.length];
}

export function computeTakeoffSimilarityRatio(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;

  const distance = levenshteinDistance(left, right);
  return 1 - distance / maxLength;
}

function buildCandidates(input: {
  baseItems: TakeoffJobItem[];
  otherItems: TakeoffJobItem[];
  threshold: number;
  strategy: TakeoffDiffMatchStrategy;
  baseIndexes: number[];
  otherIndexes: number[];
}): CandidateMatch[] {
  const candidates: CandidateMatch[] = [];

  for (const baseIndex of input.baseIndexes) {
    const baseItem = input.baseItems[baseIndex];
    if (!baseItem) continue;

    const baseToken =
      input.strategy === "designation_fuzzy"
        ? getNormalizedDesignation(baseItem)
        : getNormalizedDesignationWithPage(baseItem);

    if (!baseToken) continue;

    for (const otherIndex of input.otherIndexes) {
      const otherItem = input.otherItems[otherIndex];
      if (!otherItem) continue;

      const otherToken =
        input.strategy === "designation_fuzzy"
          ? getNormalizedDesignation(otherItem)
          : getNormalizedDesignationWithPage(otherItem);

      if (!otherToken) continue;

      const score = computeTakeoffSimilarityRatio(baseToken, otherToken);
      if (score + EPSILON < input.threshold) continue;

      candidates.push({
        baseIndex,
        otherIndex,
        score,
        strategy: input.strategy,
        pageDistance: getPageDistance(baseItem, otherItem),
      });
    }
  }

  candidates.sort((left, right) => {
    if (Math.abs(right.score - left.score) > EPSILON) {
      return right.score - left.score;
    }

    if (left.pageDistance !== right.pageDistance) {
      return left.pageDistance - right.pageDistance;
    }

    if (left.baseIndex !== right.baseIndex) {
      return left.baseIndex - right.baseIndex;
    }

    return left.otherIndex - right.otherIndex;
  });

  return candidates;
}

function assignGreedyMatches(input: {
  candidates: CandidateMatch[];
  matchedByBase: Map<number, MatchedPair>;
  matchedOtherIndexes: Set<number>;
}) {
  for (const candidate of input.candidates) {
    if (input.matchedByBase.has(candidate.baseIndex)) continue;
    if (input.matchedOtherIndexes.has(candidate.otherIndex)) continue;

    input.matchedByBase.set(candidate.baseIndex, {
      otherIndex: candidate.otherIndex,
      score: candidate.score,
      strategy: candidate.strategy,
    });
    input.matchedOtherIndexes.add(candidate.otherIndex);
  }
}

function getFieldComparableValue(
  item: TakeoffJobItem,
  field: TakeoffDiffField["field"]
): string | number | null {
  if (field === "designation") {
    return normalizeTextValue(item.designation);
  }

  if (field === "unit") {
    return normalizeTextValue(item.unit);
  }

  if (field === "evidence") {
    return normalizeTextValue(item.evidence);
  }

  if (field === "quantity") {
    return normalizeNumberValue(item.quantity);
  }

  if (field === "source_page") {
    return normalizeNumberValue(item.source_page);
  }

  return normalizeNumberValue(item.confidence);
}

function buildFieldDelta(baseItem: TakeoffJobItem, otherItem: TakeoffJobItem) {
  const delta: TakeoffDiffField[] = [];

  for (const fieldConfig of TAKEOFF_DIFF_FIELDS) {
    const beforeValue = getFieldComparableValue(baseItem, fieldConfig.field);
    const afterValue = getFieldComparableValue(otherItem, fieldConfig.field);

    if (fieldConfig.kind === "number") {
      if (beforeValue === afterValue) {
        continue;
      }
    } else {
      const normalizedBefore =
        typeof beforeValue === "string" ? normalizeTakeoffCompareText(beforeValue) : "";
      const normalizedAfter =
        typeof afterValue === "string" ? normalizeTakeoffCompareText(afterValue) : "";

      if (normalizedBefore === normalizedAfter) {
        continue;
      }
    }

    if (beforeValue === afterValue) {
      continue;
    }

    delta.push({
      field: fieldConfig.field,
      label: fieldConfig.label,
      kind: fieldConfig.kind,
      before_value: beforeValue,
      after_value: afterValue,
    });
  }

  return delta;
}

function toStableScore(score: number) {
  return Number(score.toFixed(4));
}

export function buildTakeoffDiff(input: BuildTakeoffDiffInput): BuildTakeoffDiffResult {
  const threshold = normalizeDiffThreshold(input.threshold);
  const baseItems = [...input.baseItems];
  const otherItems = [...input.otherItems];

  const baseIndexes = baseItems.map((_, index) => index);
  const otherIndexes = otherItems.map((_, index) => index);

  const matchedByBase = new Map<number, MatchedPair>();
  const matchedOtherIndexes = new Set<number>();

  const primaryCandidates = buildCandidates({
    baseItems,
    otherItems,
    threshold,
    strategy: "designation_fuzzy",
    baseIndexes,
    otherIndexes,
  });

  assignGreedyMatches({
    candidates: primaryCandidates,
    matchedByBase,
    matchedOtherIndexes,
  });

  const unmatchedBaseIndexes = baseIndexes.filter((index) => !matchedByBase.has(index));
  const unmatchedOtherIndexes = otherIndexes.filter(
    (index) => !matchedOtherIndexes.has(index)
  );

  const secondaryCandidates = buildCandidates({
    baseItems,
    otherItems,
    threshold,
    strategy: "designation_plus_page_fuzzy",
    baseIndexes: unmatchedBaseIndexes,
    otherIndexes: unmatchedOtherIndexes,
  });

  assignGreedyMatches({
    candidates: secondaryCandidates,
    matchedByBase,
    matchedOtherIndexes,
  });

  const added: TakeoffDiffAddedEntry[] = [];
  const removed: TakeoffDiffRemovedEntry[] = [];
  const changed: TakeoffDiffChangedEntry[] = [];
  const unchanged: TakeoffDiffUnchangedEntry[] = [];

  for (let baseIndex = 0; baseIndex < baseItems.length; baseIndex += 1) {
    const baseItem = baseItems[baseIndex];
    if (!baseItem) continue;

    const matched = matchedByBase.get(baseIndex);
    if (!matched) {
      removed.push({
        key: `removed:${baseItem.id}`,
        change_type: "removed",
        base_item: baseItem,
      });
      continue;
    }

    const otherItem = otherItems[matched.otherIndex];
    if (!otherItem) {
      removed.push({
        key: `removed:${baseItem.id}`,
        change_type: "removed",
        base_item: baseItem,
      });
      continue;
    }

    const delta = buildFieldDelta(baseItem, otherItem);

    if (delta.length === 0) {
      unchanged.push({
        key: `unchanged:${baseItem.id}:${otherItem.id}`,
        change_type: "unchanged",
        base_item: baseItem,
        other_item: otherItem,
        match_score: toStableScore(matched.score),
        match_strategy: matched.strategy,
      });
      continue;
    }

    changed.push({
      key: `changed:${baseItem.id}:${otherItem.id}`,
      change_type: "changed",
      base_item: baseItem,
      other_item: otherItem,
      match_score: toStableScore(matched.score),
      match_strategy: matched.strategy,
      delta,
    });
  }

  for (let otherIndex = 0; otherIndex < otherItems.length; otherIndex += 1) {
    if (matchedOtherIndexes.has(otherIndex)) continue;

    const otherItem = otherItems[otherIndex];
    if (!otherItem) continue;

    added.push({
      key: `added:${otherItem.id}`,
      change_type: "added",
      other_item: otherItem,
    });
  }

  return {
    threshold,
    summary: {
      added: added.length,
      removed: removed.length,
      changed: changed.length,
      unchanged: unchanged.length,
      total_base: baseItems.length,
      total_other: otherItems.length,
    },
    added,
    removed,
    changed,
    unchanged,
  };
}
