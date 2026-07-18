import type {
  TakeoffApplyStrategy,
  TakeoffMappingPreviewItem,
} from "@/lib/takeoff/types";

export const TAKEOFF_APPLY_IMPACT_CHANGES = [
  "kept",
  "modified",
  "created",
  "deleted",
] as const;

export type TakeoffApplyImpactChange =
  (typeof TAKEOFF_APPLY_IMPACT_CHANGES)[number];

export type TakeoffApplyImpactEstimateItem = {
  id: string;
  parent_id: string | null;
  item_type: "section" | "line";
  position: number;
  title: string;
  description: string | null;
  quantity: number | null;
  unit_price_ht_cents: number | null;
  pu_ht_cents: number | null;
  tax_rate_bp: number | null;
  category_id: string | null;
  line_total_ht_cents: number | null;
  line_tax_cents: number | null;
  line_total_ttc_cents: number | null;
};

export type TakeoffApplyImpactVersion = {
  margin_multiplier: number;
  global_coefficient: number;
  discount_bp: number;
  discount_mode: "simple" | "cascade";
  discount_steps: number[];
  tax_rate_bp: number;
  rounding_mode: "none" | "nearest" | "up" | "down";
  rounding_step_cents: number;
  total_ht_cents: number;
  total_tax_cents: number;
  total_ttc_cents: number;
};

export type TakeoffApplyImpactState = {
  item_type: "section" | "line";
  designation: string;
  quantity: number | null;
  unit: string | null;
  amount_ht_cents: number;
  amount_tax_cents: number;
  amount_ttc_cents: number;
};

export type TakeoffApplyImpactItem = {
  id: string;
  change: TakeoffApplyImpactChange;
  existing_item_id: string | null;
  source_item_id: string | null;
  before: TakeoffApplyImpactState | null;
  after: TakeoffApplyImpactState | null;
  projection_note: string | null;
};

export type TakeoffApplyImpactAmounts = {
  before: {
    ht_cents: number;
    tax_cents: number;
    ttc_cents: number;
  };
  after: {
    ht_cents: number;
    tax_cents: number;
    ttc_cents: number;
  };
  delta: {
    ht_cents: number;
    tax_cents: number;
    ttc_cents: number;
  };
};

export type TakeoffApplyImpact = {
  counts: Record<TakeoffApplyImpactChange, number>;
  amounts: TakeoffApplyImpactAmounts;
  items: TakeoffApplyImpactItem[];
};

type ComputeTakeoffApplyImpactInput = {
  strategy: TakeoffApplyStrategy;
  targetSectionId: string | null;
  existingItems: TakeoffApplyImpactEstimateItem[];
  previewItems: TakeoffMappingPreviewItem[];
  version: TakeoffApplyImpactVersion;
};

const MAX_CENTS = 2_147_483_647;

function clampCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(Math.round(value), 0), MAX_CENTS);
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr-FR");
}

function buildMatchKey(input: { designation: string; unit: string | null }): string {
  return `${normalizeText(input.designation)}\u0000${normalizeText(input.unit)}`;
}

function toExistingState(
  item: TakeoffApplyImpactEstimateItem
): TakeoffApplyImpactState {
  return {
    item_type: item.item_type,
    designation: item.title,
    quantity: item.item_type === "line" ? item.quantity : null,
    unit: item.item_type === "line" ? item.description : null,
    amount_ht_cents:
      item.item_type === "line" ? clampCents(item.line_total_ht_cents ?? 0) : 0,
    amount_tax_cents:
      item.item_type === "line" ? clampCents(item.line_tax_cents ?? 0) : 0,
    amount_ttc_cents:
      item.item_type === "line" ? clampCents(item.line_total_ttc_cents ?? 0) : 0,
  };
}

function computeProjectedLineAmounts(input: {
  quantity: number;
  unitPriceCents: number;
  marginMultiplier: number;
  taxRateBp: number;
}) {
  const htCents = clampCents(
    input.quantity * input.unitPriceCents * Math.max(input.marginMultiplier, 0)
  );
  const taxCents = clampCents(
    (htCents * Math.max(input.taxRateBp, 0)) / 10_000
  );
  return {
    amount_ht_cents: htCents,
    amount_tax_cents: taxCents,
    amount_ttc_cents: clampCents(htCents + taxCents),
  };
}

function toCreatedState(input: {
  item: TakeoffMappingPreviewItem;
  version: TakeoffApplyImpactVersion;
}): TakeoffApplyImpactState {
  if (input.item.action === "apply_assembly") {
    return {
      item_type: "section",
      designation: input.item.transformed.designation,
      quantity: null,
      unit: null,
      amount_ht_cents: 0,
      amount_tax_cents: 0,
      amount_ttc_cents: 0,
    };
  }

  const quantity = Math.max(input.item.transformed.quantity, 0);
  const unitPriceCents = Math.max(
    input.item.transformed.unit_price_cents ?? 0,
    0
  );
  return {
    item_type: "line",
    designation: input.item.transformed.designation,
    quantity,
    unit: input.item.transformed.unit,
    ...computeProjectedLineAmounts({
      quantity,
      unitPriceCents,
      marginMultiplier: input.version.margin_multiplier,
      taxRateBp: input.version.tax_rate_bp,
    }),
  };
}

function toModifiedState(input: {
  existing: TakeoffApplyImpactEstimateItem;
  item: TakeoffMappingPreviewItem;
  version: TakeoffApplyImpactVersion;
}): TakeoffApplyImpactState {
  const quantity = Math.max(input.item.transformed.quantity, 0);
  const explicitUnitPrice = input.item.transformed.unit_price_cents;
  const unitPriceCents =
    explicitUnitPrice ?? input.existing.pu_ht_cents ?? input.existing.unit_price_ht_cents ?? 0;
  const marginMultiplier = explicitUnitPrice === null ? 1 : input.version.margin_multiplier;
  const taxRateBp = input.existing.tax_rate_bp ?? input.version.tax_rate_bp;

  return {
    item_type: "line",
    designation: input.item.transformed.designation,
    quantity,
    unit: input.item.transformed.unit,
    ...computeProjectedLineAmounts({
      quantity,
      unitPriceCents: Math.max(unitPriceCents, 0),
      marginMultiplier,
      taxRateBp,
    }),
  };
}

function isOutputItem(item: TakeoffMappingPreviewItem): boolean {
  if (item.original.is_excluded || item.action === "skip") return false;
  return item.action === "apply_assembly" || !item.transformed.is_excluded;
}

function buildReplaceDeletedIds(input: {
  existingItems: TakeoffApplyImpactEstimateItem[];
  targetSectionId: string | null;
}): Set<string> {
  if (!input.targetSectionId) {
    return new Set(input.existingItems.map((item) => item.id));
  }

  const childrenByParent = new Map<string, string[]>();
  for (const item of input.existingItems) {
    if (!item.parent_id) continue;
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item.id);
    childrenByParent.set(item.parent_id, siblings);
  }

  const deletedIds = new Set<string>();
  const pending = [...(childrenByParent.get(input.targetSectionId) ?? [])];
  while (pending.length > 0) {
    const id = pending.pop();
    if (!id || deletedIds.has(id)) continue;
    deletedIds.add(id);
    pending.push(...(childrenByParent.get(id) ?? []));
  }
  return deletedIds;
}

function applyRounding(
  value: number,
  mode: TakeoffApplyImpactVersion["rounding_mode"],
  step: number
): number {
  if (mode === "none") return clampCents(value);
  const safeStep = Math.max(Math.round(step), 1);
  const ratio = value / safeStep;
  if (mode === "up") return clampCents(Math.ceil(ratio) * safeStep);
  if (mode === "down") return clampCents(Math.floor(ratio) * safeStep);
  return clampCents(Math.round(ratio) * safeStep);
}

function computeAfterTotals(input: {
  states: TakeoffApplyImpactState[];
  version: TakeoffApplyImpactVersion;
}) {
  const rawHt = input.states.reduce(
    (sum, state) => sum + (state.item_type === "line" ? state.amount_ht_cents : 0),
    0
  );
  const rawTax = input.states.reduce(
    (sum, state) => sum + (state.item_type === "line" ? state.amount_tax_cents : 0),
    0
  );
  const coefficient = Math.max(input.version.global_coefficient, 0);
  const scaledHt = clampCents(rawHt * coefficient);
  const scaledTax = clampCents(rawTax * coefficient);
  const normalizedSteps = input.version.discount_steps.map((step) =>
    Math.min(Math.max(Math.round(step), 0), 10_000)
  );

  let discountCents = 0;
  if (input.version.discount_mode === "cascade") {
    let runningHt = scaledHt;
    for (const step of normalizedSteps) {
      const stepDiscount = Math.min(
        clampCents((runningHt * step) / 10_000),
        runningHt
      );
      discountCents += stepDiscount;
      runningHt -= stepDiscount;
      if (runningHt <= 0) break;
    }
  } else {
    const step = normalizedSteps[0] ?? input.version.discount_bp;
    discountCents = Math.min(
      clampCents((scaledHt * Math.min(Math.max(step, 0), 10_000)) / 10_000),
      scaledHt
    );
  }

  const htCents = clampCents(scaledHt - discountCents);
  const taxDiscount = clampCents(
    (discountCents * Math.max(input.version.tax_rate_bp, 0)) / 10_000
  );
  let taxCents = clampCents(scaledTax - taxDiscount);
  let ttcCents = applyRounding(
    htCents + taxCents,
    input.version.rounding_mode,
    input.version.rounding_step_cents
  );
  ttcCents = Math.max(ttcCents, htCents);
  taxCents = ttcCents - htCents;

  return {
    ht_cents: htCents,
    tax_cents: taxCents,
    ttc_cents: ttcCents,
  };
}

function makeExistingImpactItem(input: {
  item: TakeoffApplyImpactEstimateItem;
  change: "kept" | "deleted";
}): TakeoffApplyImpactItem {
  const state = toExistingState(input.item);
  return {
    id: `${input.change}:${input.item.id}`,
    change: input.change,
    existing_item_id: input.item.id,
    source_item_id: null,
    before: state,
    after: input.change === "kept" ? state : null,
    projection_note: null,
  };
}

function makeCreatedImpactItem(input: {
  item: TakeoffMappingPreviewItem;
  version: TakeoffApplyImpactVersion;
}): TakeoffApplyImpactItem {
  return {
    id: `created:${input.item.item_id}`,
    change: "created",
    existing_item_id: null,
    source_item_id: input.item.item_id,
    before: null,
    after: toCreatedState(input),
    projection_note:
      input.item.action === "apply_assembly"
        ? "L'ouvrage sera insere avec ses lignes; leurs montants initiaux sont nuls a l'apply."
        : null,
  };
}

export function computeTakeoffApplyImpact(
  input: ComputeTakeoffApplyImpactInput
): TakeoffApplyImpact {
  const outputItems = [...input.previewItems]
    .filter(isOutputItem)
    .sort((left, right) => left.source_order - right.source_order);
  const impacts: TakeoffApplyImpactItem[] = [];

  if (input.strategy === "replace") {
    const deletedIds = buildReplaceDeletedIds({
      existingItems: input.existingItems,
      targetSectionId: input.targetSectionId,
    });
    for (const existing of input.existingItems) {
      impacts.push(
        makeExistingImpactItem({
          item: existing,
          change: deletedIds.has(existing.id) ? "deleted" : "kept",
        })
      );
    }
    impacts.push(
      ...outputItems.map((item) =>
        makeCreatedImpactItem({ item, version: input.version })
      )
    );
  } else if (input.strategy === "append") {
    impacts.push(
      ...input.existingItems.map((item) =>
        makeExistingImpactItem({ item, change: "kept" })
      )
    );
    impacts.push(
      ...outputItems.map((item) =>
        makeCreatedImpactItem({ item, version: input.version })
      )
    );
  } else {
    const targetLines = input.existingItems
      .filter(
        (item) =>
          item.item_type === "line" &&
          item.parent_id === input.targetSectionId
      )
      .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
    const linesByKey = new Map<string, TakeoffApplyImpactEstimateItem[]>();
    for (const line of targetLines) {
      const key = buildMatchKey({
        designation: line.title,
        unit: line.description,
      });
      const candidates = linesByKey.get(key) ?? [];
      candidates.push(line);
      linesByKey.set(key, candidates);
    }

    const matchedExistingIds = new Set<string>();
    const keyOffsets = new Map<string, number>();
    for (const item of outputItems) {
      if (item.action === "apply_assembly") {
        impacts.push(makeCreatedImpactItem({ item, version: input.version }));
        continue;
      }

      const key = buildMatchKey({
        designation: item.transformed.designation,
        unit: item.transformed.unit,
      });
      const offset = keyOffsets.get(key) ?? 0;
      const existing = linesByKey.get(key)?.[offset] ?? null;
      keyOffsets.set(key, offset + 1);

      if (!existing) {
        impacts.push(makeCreatedImpactItem({ item, version: input.version }));
        continue;
      }

      matchedExistingIds.add(existing.id);
      impacts.push({
        id: `modified:${existing.id}:${item.item_id}`,
        change: "modified",
        existing_item_id: existing.id,
        source_item_id: item.item_id,
        before: toExistingState(existing),
        after: toModifiedState({ existing, item, version: input.version }),
        projection_note: null,
      });
    }

    impacts.push(
      ...input.existingItems
        .filter((item) => !matchedExistingIds.has(item.id))
        .map((item) => makeExistingImpactItem({ item, change: "kept" }))
    );
  }

  const counts: Record<TakeoffApplyImpactChange, number> = {
    kept: 0,
    modified: 0,
    created: 0,
    deleted: 0,
  };
  for (const impact of impacts) {
    counts[impact.change] += 1;
  }

  const after = computeAfterTotals({
    states: impacts.flatMap((impact) => (impact.after ? [impact.after] : [])),
    version: input.version,
  });
  const before = {
    ht_cents: clampCents(input.version.total_ht_cents),
    tax_cents: clampCents(input.version.total_tax_cents),
    ttc_cents: clampCents(input.version.total_ttc_cents),
  };

  return {
    counts,
    amounts: {
      before,
      after,
      delta: {
        ht_cents: after.ht_cents - before.ht_cents,
        tax_cents: after.tax_cents - before.tax_cents,
        ttc_cents: after.ttc_cents - before.ttc_cents,
      },
    },
    items: impacts,
  };
}
