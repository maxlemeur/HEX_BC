import { allocateProRata } from "@/lib/estimate-allocation";
import { bankersRound } from "@/lib/money";
import type {
  DiscountMode,
  EstimateBreakdown,
  EstimateItemRecord,
  EstimateLineBreakdown,
  EstimateVersionForCalc,
  SectionTotals,
} from "@/lib/estimate-calculations";

export const UNASSIGNED_SUPPLY_TYPE_KEY = "__unassigned__";

export type EstimateV2SnapshotLine = {
  id: string;
  snapshot_pu_ht_cents: number;
  line_total_ht_cents: number;
  line_tax_cents: number;
  line_total_ttc_cents: number;
  snapshot_fo_ht_cents: number;
  snapshot_mo_ht_cents: number;
  snapshot_mo_atelier_ht_cents: number;
  snapshot_mo_chantier_ht_cents: number;
};

export type EstimateV2SnapshotProjection = {
  items: EstimateV2SnapshotLine[];
  totals: {
    total_ht_cents: number;
    total_tax_cents: number;
    total_ttc_cents: number;
    rounding_adjustment_cents: number;
  };
};

type NetSectionAccumulator = {
  foNetCents: number;
  moNetCents: number;
  moAtelierNetCents: number;
  moChantierNetCents: number;
  htNetCents: number;
  taxCents: number;
  supplyTypeFoNetCents: Map<string, number>;
};

function toSafeNumber(
  value: number | null | undefined,
  fallback: number
): number {
  return Number.isFinite(value ?? Number.NaN) ? (value ?? fallback) : fallback;
}

function clampMarginMultiplier(value: number | null | undefined): number {
  return Math.min(Math.max(toSafeNumber(value, 1), 0), 100);
}

function clampGlobalCoefficient(value: number | null | undefined): number {
  return Math.max(toSafeNumber(value, 1), 0);
}

function createNetSectionAccumulator(): NetSectionAccumulator {
  return {
    foNetCents: 0,
    moNetCents: 0,
    moAtelierNetCents: 0,
    moChantierNetCents: 0,
    htNetCents: 0,
    taxCents: 0,
    supplyTypeFoNetCents: new Map<string, number>(),
  };
}

/**
 * Agrege les montants nets deja reconcilies dans l'arbre de sections v2.
 * Le moteur et la relecture d'un snapshot passent par la meme interface.
 */
export function aggregateEstimateV2Sections(
  items: EstimateItemRecord[],
  lineById: Map<string, EstimateLineBreakdown>
): { sectionById: Map<string, SectionTotals>; rootLineIds: string[] } {
  const sectionSet = new Set<string>();
  const childrenByParent = new Map<string, EstimateItemRecord[]>();
  items.forEach((item) => {
    if (item.item_type === "section") sectionSet.add(item.id);
    if (!item.parent_id) return;
    const siblings = childrenByParent.get(item.parent_id) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parent_id, siblings);
  });

  const rootLineIds = items
    .filter(
      (item) =>
        item.item_type === "line" &&
        (!item.parent_id || !sectionSet.has(item.parent_id))
    )
    .map((item) => item.id);
  const accumulators = new Map<string, NetSectionAccumulator>();
  const visited = new Set<string>();
  const sectionIds = items
    .filter((item) => item.item_type === "section")
    .map((item) => item.id);

  sectionIds.forEach((rootId) => {
    if (visited.has(rootId)) return;
    const stack: Array<{ id: string; visitedChildren: boolean }> = [
      { id: rootId, visitedChildren: false },
    ];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (!current.visitedChildren) {
        if (visited.has(current.id)) continue;
        stack.push({ id: current.id, visitedChildren: true });
        const children = childrenByParent.get(current.id) ?? [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
          if (children[index].item_type === "section") {
            stack.push({ id: children[index].id, visitedChildren: false });
          }
        }
        continue;
      }

      const accumulator = createNetSectionAccumulator();
      (childrenByParent.get(current.id) ?? []).forEach((child) => {
        if (child.item_type === "line") {
          const line = lineById.get(child.id);
          if (!line) return;
          accumulator.foNetCents += line.foNetCents;
          accumulator.moNetCents += line.moNetCents;
          accumulator.moAtelierNetCents += line.moAtelierNetCents;
          accumulator.moChantierNetCents += line.moChantierNetCents;
          accumulator.htNetCents += line.saleNetHtCents;
          accumulator.taxCents += line.taxCents;
          if (line.foNetCents > 0) {
            const key = child.supply_type_id ?? UNASSIGNED_SUPPLY_TYPE_KEY;
            accumulator.supplyTypeFoNetCents.set(
              key,
              (accumulator.supplyTypeFoNetCents.get(key) ?? 0) + line.foNetCents
            );
          }
          return;
        }

        const childAccumulator = accumulators.get(child.id);
        if (!childAccumulator) return;
        accumulator.foNetCents += childAccumulator.foNetCents;
        accumulator.moNetCents += childAccumulator.moNetCents;
        accumulator.moAtelierNetCents += childAccumulator.moAtelierNetCents;
        accumulator.moChantierNetCents += childAccumulator.moChantierNetCents;
        accumulator.htNetCents += childAccumulator.htNetCents;
        accumulator.taxCents += childAccumulator.taxCents;
        childAccumulator.supplyTypeFoNetCents.forEach((value, key) => {
          accumulator.supplyTypeFoNetCents.set(
            key,
            (accumulator.supplyTypeFoNetCents.get(key) ?? 0) + value
          );
        });
      });
      accumulators.set(current.id, accumulator);
      visited.add(current.id);
    }
  });

  const sectionById = new Map<string, SectionTotals>();
  sectionIds.forEach((sectionId) => {
    const accumulator =
      accumulators.get(sectionId) ?? createNetSectionAccumulator();
    sectionById.set(sectionId, {
      foTotalCents: accumulator.foNetCents,
      moTotalCents: accumulator.moNetCents,
      moAtelierTotalCents: accumulator.moAtelierNetCents,
      moChantierTotalCents: accumulator.moChantierNetCents,
      totalHtCents: accumulator.htNetCents,
      totalTtcCents: accumulator.htNetCents + accumulator.taxCents,
      supplyTypeFoTotalsCents: Object.fromEntries(
        accumulator.supplyTypeFoNetCents
      ),
    });
  });

  return { sectionById, rootLineIds };
}

/**
 * Reconstruit le contrat chiffre d'une version v2 finalisee exclusivement a
 * partir de ses colonnes figees, sans tarif, bareme ni feature flag courant.
 */
export function buildStoredEstimateBreakdown({
  items,
  version,
}: {
  items: EstimateItemRecord[];
  version?: Pick<
    EstimateVersionForCalc,
    | "margin_multiplier"
    | "discount_mode"
    | "global_coefficient"
    | "total_ht_cents"
    | "total_tax_cents"
    | "total_ttc_cents"
    | "rounding_adjustment_cents"
  >;
}): EstimateBreakdown {
  const lines = items.filter((item) => item.item_type === "line");
  const lineById = new Map<string, EstimateLineBreakdown>();
  let sumHtCents = 0;
  let sumTaxCents = 0;

  lines.forEach((item) => {
    const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
    const saleNetHtCents = Math.max(
      toSafeNumber(item.line_total_ht_cents, 0),
      0
    );
    const taxCents = Math.max(toSafeNumber(item.line_tax_cents, 0), 0);
    const puNetHtCents = Number.isFinite(item.snapshot_pu_ht_cents ?? Number.NaN)
      ? Math.max(item.snapshot_pu_ht_cents ?? 0, 0)
      : quantity > 0
        ? bankersRound(saleNetHtCents / quantity)
        : 0;
    const storedFo = Number.isFinite(item.snapshot_fo_ht_cents ?? Number.NaN)
      ? Math.max(item.snapshot_fo_ht_cents ?? 0, 0)
      : 0;
    const storedMo = Number.isFinite(item.snapshot_mo_ht_cents ?? Number.NaN)
      ? Math.max(item.snapshot_mo_ht_cents ?? 0, 0)
      : saleNetHtCents;
    const foNetCents = Math.min(storedFo, saleNetHtCents);
    const moNetCents = Math.min(storedMo, saleNetHtCents - foNetCents);
    const storedAtelier = Number.isFinite(
      item.snapshot_mo_atelier_ht_cents ?? Number.NaN
    )
      ? Math.max(item.snapshot_mo_atelier_ht_cents ?? 0, 0)
      : 0;
    const storedChantier = Number.isFinite(
      item.snapshot_mo_chantier_ht_cents ?? Number.NaN
    )
      ? Math.max(item.snapshot_mo_chantier_ht_cents ?? 0, 0)
      : moNetCents;
    const moAtelierNetCents = Math.min(storedAtelier, moNetCents);
    const moChantierNetCents = Math.min(
      storedChantier,
      moNetCents - moAtelierNetCents
    );

    sumHtCents += saleNetHtCents;
    sumTaxCents += taxCents;
    lineById.set(item.id, {
      costLineCents: 0,
      saleGrossCents: saleNetHtCents,
      coefficientShareCents: saleNetHtCents,
      discountShareCents: 0,
      saleNetHtCents,
      foNetCents,
      moNetCents,
      moAtelierNetCents,
      moChantierNetCents,
      puNetHtCents,
      taxCents,
    });
  });

  const storedHtCents = Number.isFinite(version?.total_ht_cents ?? Number.NaN)
    ? (version?.total_ht_cents ?? sumHtCents)
    : sumHtCents;
  const storedTaxCents = Number.isFinite(version?.total_tax_cents ?? Number.NaN)
    ? (version?.total_tax_cents ?? sumTaxCents)
    : sumTaxCents;
  const storedTtcCents = Number.isFinite(version?.total_ttc_cents ?? Number.NaN)
    ? (version?.total_ttc_cents ?? storedHtCents + storedTaxCents)
    : storedHtCents + storedTaxCents;
  const storedRoundingAdjustmentCents = Number.isFinite(
    version?.rounding_adjustment_cents ?? Number.NaN
  )
    ? (version?.rounding_adjustment_cents ?? 0)
    : 0;
  const actualTaxCents = Math.max(
    storedTaxCents - storedRoundingAdjustmentCents,
    0
  );
  if (actualTaxCents !== sumTaxCents && lines.length > 0) {
    const currentTaxWeights = lines.map(
      (item) => lineById.get(item.id)?.taxCents ?? 0
    );
    const htWeights = lines.map(
      (item) => lineById.get(item.id)?.saleNetHtCents ?? 0
    );
    const effectiveWeights = currentTaxWeights.some((value) => value > 0)
      ? currentTaxWeights
      : htWeights.some((value) => value > 0)
        ? htWeights
        : lines.map(() => 1);
    const allocatedActualTax = allocateProRata(actualTaxCents, effectiveWeights);
    lines.forEach((item, index) => {
      const line = lineById.get(item.id);
      if (!line) return;
      lineById.set(item.id, {
        ...line,
        taxCents: allocatedActualTax[index],
      });
    });
    sumTaxCents = actualTaxCents;
  }
  const { sectionById, rootLineIds } = aggregateEstimateV2Sections(
    items,
    lineById
  );
  const discountMode: DiscountMode =
    version?.discount_mode === "cascade" ? "cascade" : "simple";

  return {
    totals: {
      costSubtotalCents: 0,
      saleSubtotalBeforeCoefficientCents: storedHtCents,
      saleSubtotalCents: storedHtCents,
      discountCents: 0,
      appliedMarginMultiplier: clampMarginMultiplier(
        version?.margin_multiplier ?? 1
      ),
      globalCoefficient: clampGlobalCoefficient(version?.global_coefficient),
      discountMode,
      discountStepTotals: [],
      saleTotalCents: storedHtCents,
      taxCents: actualTaxCents,
      ttcCents: storedHtCents + actualTaxCents,
      roundedTtcCents: storedTtcCents,
      roundingAdjustmentCents: storedRoundingAdjustmentCents,
      adjustedTaxCents: storedTaxCents,
    },
    lineById,
    sectionById,
    rootLineIds,
    invariants: {
      sumAllocatedHtCents: sumHtCents,
      matchesFooter:
        sumHtCents === storedHtCents &&
        sumTaxCents === actualTaxCents &&
        sumHtCents + sumTaxCents + storedRoundingAdjustmentCents ===
          storedTtcCents,
    },
  };
}

/**
 * Redescend le pied v2 sur les colonnes contractuelles a figer. Les sommes des
 * lignes sont verifiees contre le pied avant de franchir le seam PostgreSQL.
 */
export function buildEstimateV2SnapshotProjection({
  items,
  breakdown,
}: {
  items: EstimateItemRecord[];
  breakdown: EstimateBreakdown;
}): EstimateV2SnapshotProjection {
  const lines = items.filter((item) => item.item_type === "line");
  const lineBreakdowns = lines.map((item) => breakdown.lineById.get(item.id));
  if (lineBreakdowns.some((line) => !line)) {
    throw new Error("ESTIMATE_V2_SNAPSHOT_LINE_MISSING");
  }

  const htWeights = lineBreakdowns.map((line) => line?.saleNetHtCents ?? 0);
  const taxWeights = lineBreakdowns.map((line) => line?.taxCents ?? 0);
  const effectiveTaxWeights = taxWeights.some((value) => value > 0)
    ? taxWeights
    : htWeights.some((value) => value > 0)
      ? htWeights
      : lines.map(() => 1);
  const allocatedTax = allocateProRata(
    breakdown.totals.adjustedTaxCents,
    effectiveTaxWeights
  );
  const projectedItems = lines.map((item, index) => {
    const line = lineBreakdowns[index]!;
    const quantity = Math.max(toSafeNumber(item.quantity, 0), 0);
    return {
      id: item.id,
      snapshot_pu_ht_cents:
        quantity > 0 ? bankersRound(line.saleNetHtCents / quantity) : 0,
      line_total_ht_cents: line.saleNetHtCents,
      line_tax_cents: allocatedTax[index],
      line_total_ttc_cents: line.saleNetHtCents + allocatedTax[index],
      snapshot_fo_ht_cents: line.foNetCents,
      snapshot_mo_ht_cents: line.moNetCents,
      snapshot_mo_atelier_ht_cents: line.moAtelierNetCents,
      snapshot_mo_chantier_ht_cents: line.moChantierNetCents,
    };
  });
  const totals = {
    total_ht_cents: breakdown.totals.saleTotalCents,
    total_tax_cents: breakdown.totals.adjustedTaxCents,
    total_ttc_cents: breakdown.totals.roundedTtcCents,
    rounding_adjustment_cents: breakdown.totals.roundingAdjustmentCents,
  };
  const summed = projectedItems.reduce(
    (accumulator, item) => ({
      total_ht_cents:
        accumulator.total_ht_cents + item.line_total_ht_cents,
      total_tax_cents: accumulator.total_tax_cents + item.line_tax_cents,
      total_ttc_cents:
        accumulator.total_ttc_cents + item.line_total_ttc_cents,
    }),
    { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 }
  );
  if (
    summed.total_ht_cents !== totals.total_ht_cents ||
    summed.total_tax_cents !== totals.total_tax_cents ||
    summed.total_ttc_cents !== totals.total_ttc_cents
  ) {
    throw new Error("ESTIMATE_V2_SNAPSHOT_TOTALS_MISMATCH");
  }

  return { items: projectedItems, totals };
}
