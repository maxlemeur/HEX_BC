type SuggestionRuleForScoring = {
  id: string;
  name?: string;
  match_type?: string;
  match_value: string;
  is_active: boolean;
  position?: number | null;
} & Record<string, unknown>;

export type SuggestionMatchKind = "exact" | "partial" | "fuzzy";
export type SuggestionScoringRule = SuggestionRuleForScoring;

export type SuggestionScore<TRule extends SuggestionRuleForScoring> = {
  rule: TRule;
  score: number;
  matchKind: SuggestionMatchKind;
  matchedKeyword: string;
  similarity: number;
  usageCount: number;
};

const EXACT_BASE_SCORE = 100;
const PARTIAL_BASE_SCORE = 72;
const FUZZY_BASE_SCORE = 46;
const MIN_FUZZY_SIMILARITY = 0.65;
const MAX_FREQUENCY_BONUS = 15;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularizeWord(value: string) {
  if (value.length <= 3) return value;
  if (value.endsWith("ies") && value.length > 4) {
    return `${value.slice(0, -3)}y`;
  }
  if (value.endsWith("x")) {
    return value.slice(0, -1);
  }
  if (value.endsWith("s") && !value.endsWith("ss")) {
    return value.slice(0, -1);
  }
  return value;
}

function normalizeWord(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) return "";
  return normalized
    .split(" ")
    .map((token) => singularizeWord(token))
    .join(" ")
    .trim();
}

function splitKeywords(matchValue: string) {
  return matchValue
    .split(",")
    .map((part) => normalizeWord(part))
    .filter((part) => part.length > 0);
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

function similarityRatio(left: string, right: string) {
  const maxLength = Math.max(left.length, right.length);
  if (maxLength === 0) return 1;
  const distance = levenshteinDistance(left, right);
  return 1 - distance / maxLength;
}

function parseUsageCount(rule: Record<string, unknown>) {
  const value = rule.usage_count;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}

function parseLastUsedAt(rule: Record<string, unknown>) {
  const value = rule.last_used_at;
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function getFrequencyBonus(rule: Record<string, unknown>) {
  const usageCount = parseUsageCount(rule);
  if (usageCount <= 0) return 0;
  return Math.min(MAX_FREQUENCY_BONUS, Math.log10(usageCount + 1) * 8);
}

function getRecencyBonus(rule: Record<string, unknown>) {
  const timestamp = parseLastUsedAt(rule);
  if (!timestamp) return 0;
  const ageInDays = Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24));
  if (ageInDays <= 7) return 3;
  if (ageInDays <= 30) return 1.5;
  return 0;
}

function resolveKeywordMatch(title: string, keyword: string) {
  if (!title || !keyword) return null;
  if (title === keyword) {
    return {
      matchKind: "exact" as const,
      score: EXACT_BASE_SCORE,
      similarity: 1,
    };
  }

  if (title.includes(keyword)) {
    return {
      matchKind: "partial" as const,
      score: PARTIAL_BASE_SCORE,
      similarity: 0.85,
    };
  }

  const titleTokens = title.split(" ").filter(Boolean);
  const keywordTokens = keyword.split(" ").filter(Boolean);
  if (
    titleTokens.some((token) => token === keyword) ||
    keywordTokens.some((token) => token === title)
  ) {
    return {
      matchKind: "partial" as const,
      score: PARTIAL_BASE_SCORE,
      similarity: 0.85,
    };
  }

  let bestSimilarity = similarityRatio(title, keyword);
  titleTokens.forEach((token) => {
    bestSimilarity = Math.max(bestSimilarity, similarityRatio(token, keyword));
  });
  keywordTokens.forEach((token) => {
    bestSimilarity = Math.max(bestSimilarity, similarityRatio(title, token));
  });

  if (bestSimilarity < MIN_FUZZY_SIMILARITY) return null;
  return {
    matchKind: "fuzzy" as const,
    score: FUZZY_BASE_SCORE + bestSimilarity * 20,
    similarity: bestSimilarity,
  };
}

export function fuzzyMatch(input: { title: string; keyword: string }) {
  const title = normalizeWord(input.title);
  const keyword = normalizeWord(input.keyword);
  if (!title || !keyword) {
    return {
      matched: false,
      similarity: 0,
    };
  }

  const similarity = similarityRatio(title, keyword);
  return {
    matched: similarity >= MIN_FUZZY_SIMILARITY,
    similarity,
  };
}

export function scoreSuggestion<TRule extends SuggestionRuleForScoring>(input: {
  title: string;
  rule: TRule;
}): SuggestionScore<TRule> | null {
  const { rule } = input;
  if (!rule.is_active) return null;
  if ((rule.match_type ?? "keyword") !== "keyword") return null;

  const normalizedTitle = normalizeWord(input.title);
  if (!normalizedTitle) return null;

  const keywords = splitKeywords(rule.match_value);
  if (keywords.length === 0) return null;

  let bestMatch:
    | {
        score: number;
        matchKind: SuggestionMatchKind;
        keyword: string;
        similarity: number;
      }
    | null = null;

  for (const keyword of keywords) {
    const match = resolveKeywordMatch(normalizedTitle, keyword);
    if (!match) continue;

    if (!bestMatch || match.score > bestMatch.score) {
      bestMatch = {
        score: match.score,
        matchKind: match.matchKind,
        keyword,
        similarity: match.similarity,
      };
    }
  }

  if (!bestMatch) return null;

  const ruleRecord = rule as Record<string, unknown>;
  const usageCount = parseUsageCount(ruleRecord);
  const score =
    bestMatch.score + getFrequencyBonus(ruleRecord) + getRecencyBonus(ruleRecord);

  return {
    rule,
    score: Number(score.toFixed(3)),
    matchKind: bestMatch.matchKind,
    matchedKeyword: bestMatch.keyword,
    similarity: bestMatch.similarity,
    usageCount,
  };
}

export function rankSuggestions<TRule extends SuggestionRuleForScoring>(input: {
  title: string;
  rules: TRule[];
  limit?: number;
}) {
  const limit = input.limit ?? 5;
  if (limit <= 0) return [] as SuggestionScore<TRule>[];

  return input.rules
    .map((rule) => scoreSuggestion({ title: input.title, rule }))
    .filter((score): score is SuggestionScore<TRule> => score !== null)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;

      if (left.usageCount === 0 && right.usageCount > 0) return 1;
      if (right.usageCount === 0 && left.usageCount > 0) return -1;
      if (right.usageCount !== left.usageCount) {
        return right.usageCount - left.usageCount;
      }

      const leftPosition = Number((left.rule.position ?? 0) || 0);
      const rightPosition = Number((right.rule.position ?? 0) || 0);
      if (leftPosition !== rightPosition) return leftPosition - rightPosition;

      return (left.rule.name ?? "").localeCompare(right.rule.name ?? "");
    })
    .slice(0, limit);
}

export function scoreSuggestionRule<TRule extends SuggestionRuleForScoring>(
  title: string,
  rule: TRule
) {
  return scoreSuggestion({ title, rule });
}

export function rankSuggestionRules<TRule extends SuggestionRuleForScoring>(
  title: string,
  rules: TRule[],
  options?: { limit?: number }
) {
  return rankSuggestions({
    title,
    rules,
    limit: options?.limit,
  });
}
