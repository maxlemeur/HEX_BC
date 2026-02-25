import type {
  TakeoffJobItem,
  TakeoffMappingOverride,
  TakeoffMappingOverrideAction,
  TakeoffMappingPreviewItem,
  TakeoffMappingRule,
  TakeoffPreviewConversionSummary,
} from "@/lib/takeoff/types";

type MappingPreviewState = TakeoffMappingPreviewItem["original"];

type ComputeTakeoffMappingPreviewInput = {
  items: TakeoffJobItem[];
  rules: TakeoffMappingRule[];
  overrides?: TakeoffMappingOverride[];
};

type MappingMatch = {
  rule_id: string;
  rule_name: string;
  action: Extract<TakeoffMappingOverrideAction, "rename" | "set_price" | "set_category" | "apply_assembly" | "skip">;
  action_params: Record<string, unknown>;
};

type MappingSelection = {
  action: TakeoffMappingOverrideAction;
  action_params: Record<string, unknown>;
  rule_id: string | null;
  rule_name: string | null;
  applied_by: "none" | "rule" | "override";
};

type CompiledRule = {
  rule: TakeoffMappingRule;
  regex: RegExp | null;
};

type CompiledRuleError = {
  ruleId: string;
};

const WHITESPACE_REGEX = /\s+/g;

function normalizeText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(WHITESPACE_REGEX, " ");
}

function normalizeForMatch(value: string | null | undefined): string {
  return normalizeText(value).toLocaleLowerCase("fr-FR");
}

function safeParseDate(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER;
}

function sortTakeoffItems(items: TakeoffJobItem[]): TakeoffJobItem[] {
  return [...items].sort((left, right) => {
    const byCreatedAt = safeParseDate(left.created_at) - safeParseDate(right.created_at);
    if (byCreatedAt !== 0) return byCreatedAt;
    return left.id.localeCompare(right.id);
  });
}

function sortActiveRules(rules: TakeoffMappingRule[]): CompiledRule[] {
  return rules
    .filter((rule) => rule.is_active)
    .sort((left, right) => {
      const byPriority = left.priority - right.priority;
      if (byPriority !== 0) return byPriority;

      const byCreatedAt = safeParseDate(left.created_at) - safeParseDate(right.created_at);
      if (byCreatedAt !== 0) return byCreatedAt;

      return left.id.localeCompare(right.id);
    })
    .map((rule) => {
      if (rule.match_type !== "regex") {
        return {
          rule,
          regex: null,
        };
      }

      try {
        return {
          rule,
          regex: new RegExp(rule.match_pattern, "i"),
        };
      } catch {
        const compiledRuleError: CompiledRuleError = {
          ruleId: rule.id,
        };
        throw compiledRuleError;
      }
    });
}

function isCompiledRuleError(value: unknown): value is CompiledRuleError {
  return (
    typeof value === "object" &&
    value !== null &&
    "ruleId" in value &&
    typeof (value as { ruleId?: unknown }).ruleId === "string"
  );
}

function findFirstMatchingRule(
  item: TakeoffJobItem,
  compiledRules: CompiledRule[]
): MappingMatch | null {
  const designation = normalizeText(item.designation);
  const normalizedDesignation = normalizeForMatch(item.designation);

  for (const { rule, regex } of compiledRules) {
    const normalizedPattern = normalizeForMatch(rule.match_pattern);

    let isMatch = false;
    switch (rule.match_type) {
      case "exact": {
        isMatch = normalizedDesignation === normalizedPattern;
        break;
      }
      case "contains": {
        isMatch =
          normalizedPattern.length > 0 &&
          normalizedDesignation.includes(normalizedPattern);
        break;
      }
      case "regex": {
        if (!regex) {
          isMatch = false;
          break;
        }
        regex.lastIndex = 0;
        isMatch = regex.test(designation);
        break;
      }
      default: {
        isMatch = false;
      }
    }

    if (!isMatch) {
      continue;
    }

    return {
      rule_id: rule.id,
      rule_name: rule.name,
      action: rule.action,
      action_params: rule.action_params as Record<string, unknown>,
    };
  }

  return null;
}

function buildOverridesMap(
  overrides: TakeoffMappingOverride[] | undefined
): Map<string, TakeoffMappingOverride> {
  const map = new Map<string, TakeoffMappingOverride>();
  if (!overrides) {
    return map;
  }

  for (const override of overrides) {
    map.set(override.item_id, override);
  }

  return map;
}

function toInitialState(item: TakeoffJobItem): MappingPreviewState {
  return {
    designation: normalizeText(item.designation),
    quantity: item.quantity,
    unit: normalizeText(item.unit),
    is_excluded: item.is_excluded,
    category_id: null,
    unit_price_cents: null,
    assembly_id: null,
  };
}

function resolveMappingSelection(input: {
  matchedRule: MappingMatch | null;
  override: TakeoffMappingOverride | undefined;
}): MappingSelection {
  const { matchedRule, override } = input;

  if (override) {
    return {
      action: override.action,
      action_params: (override.action_params ?? {}) as Record<string, unknown>,
      rule_id: matchedRule?.rule_id ?? null,
      rule_name: matchedRule?.rule_name ?? null,
      applied_by: "override",
    };
  }

  if (!matchedRule) {
    return {
      action: "none",
      action_params: {},
      rule_id: null,
      rule_name: null,
      applied_by: "none",
    };
  }

  return {
    action: matchedRule.action,
    action_params: matchedRule.action_params,
    rule_id: matchedRule.rule_id,
    rule_name: matchedRule.rule_name,
    applied_by: "rule",
  };
}

function applyMappingAction(
  state: MappingPreviewState,
  selection: MappingSelection
): MappingPreviewState {
  if (selection.action === "none") {
    return {
      ...state,
    };
  }

  if (state.is_excluded) {
    return {
      ...state,
    };
  }

  switch (selection.action) {
    case "rename": {
      return {
        ...state,
        designation:
          typeof selection.action_params.designation === "string"
            ? normalizeText(selection.action_params.designation)
            : state.designation,
      };
    }
    case "set_price": {
      return {
        ...state,
        unit_price_cents:
          typeof selection.action_params.unit_price_cents === "number"
            ? selection.action_params.unit_price_cents
            : state.unit_price_cents,
      };
    }
    case "set_category": {
      return {
        ...state,
        category_id:
          typeof selection.action_params.category_id === "string"
            ? selection.action_params.category_id
            : state.category_id,
      };
    }
    case "apply_assembly": {
      return {
        ...state,
        is_excluded: true,
        assembly_id:
          typeof selection.action_params.assembly_id === "string"
            ? selection.action_params.assembly_id
            : state.assembly_id,
      };
    }
    case "skip": {
      return {
        ...state,
        is_excluded: true,
      };
    }
    default: {
      return {
        ...state,
      };
    }
  }
}

function countSummary(items: TakeoffMappingPreviewItem[]): TakeoffPreviewConversionSummary {
  return {
    total_count: items.length,
    included_count: items.filter((item) => !item.original.is_excluded).length,
    transformed_count: items.filter(
      (item) => item.action !== "none" && !item.original.is_excluded
    ).length,
    overridden_count: items.filter(
      (item) => item.applied_by === "override" && !item.original.is_excluded
    ).length,
    excluded_by_mapping_count: items.filter(
      (item) =>
        !item.original.is_excluded &&
        item.transformed.is_excluded &&
        (item.action === "skip" || item.action === "apply_assembly")
    ).length,
    assembly_insertions_count: items.filter(
      (item) => !item.original.is_excluded && item.action === "apply_assembly"
    ).length,
  };
}

export function computeTakeoffMappingPreview(
  input: ComputeTakeoffMappingPreviewInput
): {
  items: TakeoffMappingPreviewItem[];
  summary: TakeoffPreviewConversionSummary;
} {
  let compiledRules: CompiledRule[] = [];
  try {
    compiledRules = sortActiveRules(input.rules);
  } catch (error) {
    if (isCompiledRuleError(error)) {
      throw new Error(
        `Regle de mapping invalide: regex non compilable (${error.ruleId}).`
      );
    }

    throw error;
  }

  const overridesByItemId = buildOverridesMap(input.overrides);
  const orderedItems = sortTakeoffItems(input.items);

  const previewItems = orderedItems.map((item, index) => {
    const matchedRule = item.is_excluded
      ? null
      : findFirstMatchingRule(item, compiledRules);
    const selection = resolveMappingSelection({
      matchedRule,
      override: overridesByItemId.get(item.id),
    });

    const original = toInitialState(item);
    const transformed = applyMappingAction(original, selection);

    return {
      item_id: item.id,
      source_order: index,
      rule_id: selection.rule_id,
      rule_name: selection.rule_name,
      action: selection.action,
      action_params: selection.action_params,
      applied_by: selection.applied_by,
      original,
      transformed,
    } satisfies TakeoffMappingPreviewItem;
  });

  return {
    items: previewItems,
    summary: countSummary(previewItems),
  };
}
