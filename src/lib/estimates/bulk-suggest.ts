import {
  rankSuggestions,
  type SuggestionMatchKind,
  type SuggestionScore,
} from "@/lib/estimates/suggestion-scoring";
import type { Database } from "@/types/database";

type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];
type EstimateItemUpdate = Database["public"]["Tables"]["estimate_items"]["Update"];
type SuggestionRuleRow =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateCategoryRow =
  Database["public"]["Tables"]["estimate_categories"]["Row"];

type BulkSuggestionField = "description" | "k_fo" | "k_mo" | "category_id";

type SuggestionTargetValues = Pick<
  EstimateItemRow,
  "description" | "k_fo" | "k_mo" | "category_id"
>;

type SuggestionUpdatePayload = Pick<
  EstimateItemUpdate,
  "description" | "k_fo" | "k_mo" | "category_id"
>;

type RankedSuggestion = SuggestionScore<SuggestionRuleRow>;

export type BulkSuggestPatch = SuggestionUpdatePayload;
type BulkSuggestPreviewField = BulkSuggestionField;

export type BulkSuggestPreviewChange = {
  field: BulkSuggestPreviewField;
  label: string;
  currentDisplay: string;
  proposedDisplay: string;
};

export type BulkSuggestPreviewItem = {
  itemId: string;
  itemTitle: string;
  ruleId: string;
  ruleName: string;
  score: number;
  patch: BulkSuggestPatch;
  changes: BulkSuggestPreviewChange[];
};

export type SuggestibleLine = {
  line: EstimateItemRow;
  rankedSuggestions: RankedSuggestion[];
};

export type BulkSuggestionDiffEntry = {
  field: BulkSuggestionField;
  currentValue: string | number | null;
  proposedValue: string | number | null;
};

export type BulkSuggestion = {
  lineId: string;
  line: EstimateItemRow;
  rule: SuggestionRuleRow;
  score: number;
  matchKind: SuggestionMatchKind;
  matchedKeyword: string;
  usageCount: number;
  current: SuggestionTargetValues;
  proposed: SuggestionTargetValues;
  updates: SuggestionUpdatePayload;
  diff: BulkSuggestionDiffEntry[];
};

export type BulkSuggestionsComputation = {
  scannedLineCount: number;
  suggestibleLineCount: number;
  suggestions: BulkSuggestion[];
};

export type AppliedBulkSuggestionLine = {
  lineId: string;
  ruleId: string;
  previous: SuggestionTargetValues;
  next: SuggestionTargetValues;
  updates: SuggestionUpdatePayload;
  diff: BulkSuggestionDiffEntry[];
};

export type RuleUsageIncrement = {
  ruleId: string;
  incrementBy: number;
  previousUsageCount: number;
  nextUsageCount: number;
};

export type BulkSuggestionSnapshot = {
  previousLines: EstimateItemRow[];
  nextItems: EstimateItemRow[];
  appliedLines: AppliedBulkSuggestionLine[];
};

export type ApplyBulkSuggestionsResult = {
  updates: Array<{
    id: string;
    updates: SuggestionUpdatePayload;
  }>;
  appliedLineIds: string[];
  ruleUsageByRuleId: Record<string, number>;
  ruleUsageIncrements: RuleUsageIncrement[];
  snapshot: BulkSuggestionSnapshot;
};

type FindSuggestibleLinesInput = {
  items: EstimateItemRow[];
  rules: SuggestionRuleRow[];
  suggestionLimit?: number;
};

type ComputeBulkSuggestionsInput = FindSuggestibleLinesInput & {
  lineIds?: string[];
};

type ApplyBulkSuggestionsInput = {
  items: EstimateItemRow[];
  suggestions: BulkSuggestion[];
  selectedLineIds?: string[];
};

const SUGGESTION_FIELDS: BulkSuggestionField[] = [
  "description",
  "k_fo",
  "k_mo",
  "category_id",
];

const PREVIEW_FIELD_LABELS: Record<BulkSuggestPreviewField, string> = {
  description: "Unite",
  category_id: "Categorie",
  k_fo: "K FO",
  k_mo: "K MO",
};

const PREVIEW_FIELD_ORDER: BulkSuggestPreviewField[] = [
  "description",
  "category_id",
  "k_fo",
  "k_mo",
];

function toNonEmptyText(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveLookupLabel(
  value: unknown,
  map: Map<string, EstimateCategoryRow>
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return "-";
  }

  const item = map.get(value);
  if (!item) return value;
  return item.name;
}

function formatPreviewDisplayValue(
  field: BulkSuggestPreviewField,
  value: unknown,
  categoryById: Map<string, EstimateCategoryRow>
): string {
  switch (field) {
    case "description": {
      const text = toNonEmptyText((value as string | null | undefined) ?? null);
      return text ?? "-";
    }
    case "category_id":
      return resolveLookupLabel(value, categoryById);
    case "k_fo":
    case "k_mo":
      if (typeof value === "number" && Number.isFinite(value)) {
        return `${value}`;
      }
      return "-";
    default:
      return "-";
  }
}

function buildPreviewChanges(
  suggestion: BulkSuggestion,
  categoryById: Map<string, EstimateCategoryRow>
): BulkSuggestPreviewChange[] {
  return PREVIEW_FIELD_ORDER
    .map((field) => {
      const diffEntry = suggestion.diff.find((entry) => entry.field === field);
      if (!diffEntry) return null;

      return {
        field,
        label: PREVIEW_FIELD_LABELS[field],
        currentDisplay: formatPreviewDisplayValue(
          field,
          diffEntry.currentValue,
          categoryById
        ),
        proposedDisplay: formatPreviewDisplayValue(
          field,
          diffEntry.proposedValue,
          categoryById
        ),
      } satisfies BulkSuggestPreviewChange;
    })
    .filter((entry): entry is BulkSuggestPreviewChange => entry !== null);
}

export function buildBulkSuggestPreview(input: {
  items: EstimateItemRow[];
  suggestionRules: SuggestionRuleRow[];
  categories: EstimateCategoryRow[];
  limit?: number;
}): BulkSuggestPreviewItem[] {
  const categoryById = new Map<string, EstimateCategoryRow>(
    input.categories.map((category) => [category.id, category])
  );

  const { suggestions } = computeBulkSuggestions({
    items: input.items,
    rules: input.suggestionRules,
    suggestionLimit: input.limit,
  });

  return suggestions.map((suggestion) => ({
    itemId: suggestion.lineId,
    itemTitle: suggestion.line.title,
    ruleId: suggestion.rule.id,
    ruleName: suggestion.rule.name,
    score: suggestion.score,
    patch: suggestion.updates,
    changes: buildPreviewChanges(suggestion, categoryById),
  }));
}

function isNeutralCoefficient(value: number | null | undefined) {
  if (value === null || value === undefined) return true;
  if (!Number.isFinite(value)) return true;
  return value === 1;
}

function isNeutralDescription(value: string | null | undefined) {
  return toNonEmptyText(value) === null;
}

function isNeutralCategoryId(value: string | null | undefined) {
  return toNonEmptyText(value) === null;
}

function isLineNeutralForSuggestion(line: EstimateItemRow) {
  return (
    line.item_type === "line" &&
    isNeutralCoefficient(line.k_fo) &&
    isNeutralCoefficient(line.k_mo) &&
    isNeutralDescription(line.description) &&
    isNeutralCategoryId(line.category_id)
  );
}

function toRulePatch(rule: SuggestionRuleRow): SuggestionUpdatePayload {
  const patch: SuggestionUpdatePayload = {};

  const unit = toNonEmptyText(rule.unit);
  if (unit) {
    patch.description = unit;
  }

  const categoryId = toNonEmptyText(rule.category_id);
  if (categoryId) {
    patch.category_id = categoryId;
  }

  if (typeof rule.k_fo === "number" && Number.isFinite(rule.k_fo)) {
    patch.k_fo = rule.k_fo;
  }

  if (typeof rule.k_mo === "number" && Number.isFinite(rule.k_mo)) {
    patch.k_mo = rule.k_mo;
  }

  return patch;
}

function hasPatchValue(patch: SuggestionUpdatePayload) {
  return SUGGESTION_FIELDS.some((field) => field in patch);
}

function toTargetValues(line: EstimateItemRow): SuggestionTargetValues {
  return {
    description: toNonEmptyText(line.description),
    k_fo: line.k_fo,
    k_mo: line.k_mo,
    category_id: toNonEmptyText(line.category_id),
  };
}

function buildApplicablePatchForLine(
  line: EstimateItemRow,
  suggestedPatch: SuggestionUpdatePayload
) {
  const patch: SuggestionUpdatePayload = {};

  if ("description" in suggestedPatch && isNeutralDescription(line.description)) {
    patch.description = toNonEmptyText(suggestedPatch.description ?? null);
  }

  if ("k_fo" in suggestedPatch && isNeutralCoefficient(line.k_fo)) {
    const value = suggestedPatch.k_fo;
    if (typeof value === "number" && Number.isFinite(value)) {
      patch.k_fo = value;
    }
  }

  if ("k_mo" in suggestedPatch && isNeutralCoefficient(line.k_mo)) {
    const value = suggestedPatch.k_mo;
    if (typeof value === "number" && Number.isFinite(value)) {
      patch.k_mo = value;
    }
  }

  if ("category_id" in suggestedPatch && isNeutralCategoryId(line.category_id)) {
    patch.category_id = toNonEmptyText(suggestedPatch.category_id ?? null);
  }

  return patch;
}

function applyPatchToValues(
  current: SuggestionTargetValues,
  patch: SuggestionUpdatePayload
): SuggestionTargetValues {
  return {
    description:
      "description" in patch
        ? toNonEmptyText(patch.description ?? null)
        : current.description,
    k_fo: "k_fo" in patch ? patch.k_fo ?? null : current.k_fo,
    k_mo: "k_mo" in patch ? patch.k_mo ?? null : current.k_mo,
    category_id:
      "category_id" in patch
        ? toNonEmptyText(patch.category_id ?? null)
        : current.category_id,
  };
}

function buildDiff(
  current: SuggestionTargetValues,
  proposed: SuggestionTargetValues
): BulkSuggestionDiffEntry[] {
  return SUGGESTION_FIELDS.reduce<BulkSuggestionDiffEntry[]>((acc, field) => {
    if (current[field] === proposed[field]) {
      return acc;
    }

    acc.push({
      field,
      currentValue: current[field],
      proposedValue: proposed[field],
    });
    return acc;
  }, []);
}

export function findSuggestibleLines(input: FindSuggestibleLinesInput): SuggestibleLine[] {
  const candidateRules = input.rules.filter((rule) => hasPatchValue(toRulePatch(rule)));
  if (candidateRules.length === 0) return [];

  const suggestionLimit = input.suggestionLimit ?? 5;

  return input.items.reduce<SuggestibleLine[]>((acc, item) => {
    if (!isLineNeutralForSuggestion(item)) {
      return acc;
    }

    const rankedSuggestions = rankSuggestions({
      title: item.title,
      rules: candidateRules,
      limit: suggestionLimit,
    }).filter((entry) => {
      const patch = buildApplicablePatchForLine(item, toRulePatch(entry.rule));
      return hasPatchValue(patch);
    });

    if (rankedSuggestions.length === 0) {
      return acc;
    }

    acc.push({
      line: item,
      rankedSuggestions,
    });
    return acc;
  }, []);
}

export function computeBulkSuggestions(
  input: ComputeBulkSuggestionsInput
): BulkSuggestionsComputation {
  const lineFilter =
    input.lineIds && input.lineIds.length > 0 ? new Set(input.lineIds) : null;
  const suggestibleLines = findSuggestibleLines(input);

  const suggestions = suggestibleLines.reduce<BulkSuggestion[]>((acc, entry) => {
    if (lineFilter && !lineFilter.has(entry.line.id)) {
      return acc;
    }

    const best = entry.rankedSuggestions[0];
    if (!best) {
      return acc;
    }

    const updates = buildApplicablePatchForLine(entry.line, toRulePatch(best.rule));
    if (!hasPatchValue(updates)) {
      return acc;
    }

    const current = toTargetValues(entry.line);
    const proposed = applyPatchToValues(current, updates);
    const diff = buildDiff(current, proposed);

    if (diff.length === 0) {
      return acc;
    }

    acc.push({
      lineId: entry.line.id,
      line: entry.line,
      rule: best.rule,
      score: best.score,
      matchKind: best.matchKind,
      matchedKeyword: best.matchedKeyword,
      usageCount: best.usageCount,
      current,
      proposed,
      updates,
      diff,
    });
    return acc;
  }, []);

  return {
    scannedLineCount: input.items.filter((item) => item.item_type === "line").length,
    suggestibleLineCount: suggestions.length,
    suggestions,
  };
}

export function applyBulkSuggestions(
  input: ApplyBulkSuggestionsInput
): ApplyBulkSuggestionsResult {
  const selectedLineIds =
    input.selectedLineIds && input.selectedLineIds.length > 0
      ? new Set(input.selectedLineIds)
      : null;

  const nextById = new Map(input.items.map((item) => [item.id, { ...item }]));
  const previousLines: EstimateItemRow[] = [];
  const appliedLines: AppliedBulkSuggestionLine[] = [];
  const updates: Array<{
    id: string;
    updates: SuggestionUpdatePayload;
  }> = [];

  const ruleUsageByRuleId: Record<string, number> = {};
  const rulePreviousUsageByRuleId = new Map<string, number>();

  input.suggestions.forEach((suggestion) => {
    if (selectedLineIds && !selectedLineIds.has(suggestion.lineId)) {
      return;
    }

    const currentItem = nextById.get(suggestion.lineId);
    if (!currentItem || currentItem.item_type !== "line") {
      return;
    }

    const lineUpdates = buildApplicablePatchForLine(currentItem, suggestion.updates);
    if (!hasPatchValue(lineUpdates)) {
      return;
    }

    const previousValues = toTargetValues(currentItem);
    const nextValues = applyPatchToValues(previousValues, lineUpdates);
    const diff = buildDiff(previousValues, nextValues);
    if (diff.length === 0) {
      return;
    }

    previousLines.push({ ...currentItem });
    const nextLine = {
      ...currentItem,
      ...lineUpdates,
    };
    nextById.set(currentItem.id, nextLine);

    updates.push({
      id: currentItem.id,
      updates: lineUpdates,
    });

    appliedLines.push({
      lineId: currentItem.id,
      ruleId: suggestion.rule.id,
      previous: previousValues,
      next: nextValues,
      updates: lineUpdates,
      diff,
    });

    if (!(suggestion.rule.id in ruleUsageByRuleId)) {
      ruleUsageByRuleId[suggestion.rule.id] = 0;
      rulePreviousUsageByRuleId.set(suggestion.rule.id, suggestion.usageCount);
    }
    ruleUsageByRuleId[suggestion.rule.id] += 1;
  });

  const nextItems = input.items.map((item) => nextById.get(item.id) ?? item);
  const ruleUsageIncrements = Object.entries(ruleUsageByRuleId).map(
    ([ruleId, incrementBy]) => {
      const previousUsageCount = rulePreviousUsageByRuleId.get(ruleId) ?? 0;
      return {
        ruleId,
        incrementBy,
        previousUsageCount,
        nextUsageCount: previousUsageCount + incrementBy,
      };
    }
  );

  return {
    updates,
    appliedLineIds: appliedLines.map((line) => line.lineId),
    ruleUsageByRuleId,
    ruleUsageIncrements,
    snapshot: {
      previousLines,
      nextItems,
      appliedLines,
    },
  };
}
