import { computeVersionBreakdown } from "@/lib/estimates/engine/compute";
import { EstimateV3Error } from "@/lib/estimates/engine-v3";
import {
  buildEstimateV3Input,
  type EstimateV3LineRecord,
  type EstimateV3VersionConfig,
} from "@/lib/estimates/v3-persistence";

/**
 * Lot 2, sous-lot 2.5 - analyse de marge d'affaire d'une version v3 (conception F19) : la façade
 * calcule la v3 par le moteur pur 2.4, jamais par le moteur v2 supposé. Vente = HT net de ligne
 * (Σ = HT), coût = déboursé D de ligne (§4.5), agrégés par section racine. Lecture seule.
 */

type V3MarginItem = EstimateV3LineRecord & { title: string; position: number };

export type V3MarginAnalysis = {
  global: {
    costCents: number;
    saleCents: number;
    marginPercent: number;
    marginEurCents: number;
    marginMultiplier: number;
    globalCoefficient: number;
    discountCents: number;
  };
  sections: Array<{
    sectionId: string;
    sectionTitle: string;
    sectionPosition: number;
    costCents: number;
    saleCents: number;
    marginPercent: number;
    marginEurCents: number;
  }>;
};

function markupPercent(saleCents: number, costCents: number) {
  return costCents > 0 ? ((saleCents - costCents) / costCents) * 100 : 0;
}

/** `null` si l'entrée v3 est illisible (analyse indisponible plutôt que fausse). */
export function computeV3MarginAnalysis(input: {
  version: EstimateV3VersionConfig;
  items: readonly V3MarginItem[];
  laborRatesById: ReadonlyMap<string, number>;
  laborSplitEnabled: boolean;
}): V3MarginAnalysis | null {
  let breakdown;
  try {
    breakdown = computeVersionBreakdown({
      calcEngineVersion: 3,
      v3: buildEstimateV3Input({
        version: input.version,
        lines: input.items,
        laborRatesById: input.laborRatesById,
        laborSplitEnabled: input.laborSplitEnabled,
      }),
    });
  } catch (error) {
    if (error instanceof EstimateV3Error) return null;
    throw error;
  }
  const parentById = new Map(input.items.map((item) => [item.id, item.parent_id ?? null]));
  const rootOf = (id: string) => {
    let current = id;
    const seen = new Set<string>();
    for (let parent = parentById.get(current); parent; parent = parentById.get(current)) {
      if (seen.has(parent)) break;
      seen.add(parent);
      current = parent;
    }
    return current;
  };
  const totalsByRoot = new Map<string, { cost: number; sale: number }>();
  for (const line of breakdown.lines) {
    const root = rootOf(line.id);
    const entry = totalsByRoot.get(root) ?? { cost: 0, sale: 0 };
    entry.cost += line.cost_ht_cents;
    entry.sale += line.line_total_ht_cents;
    totalsByRoot.set(root, entry);
  }
  const { totals } = breakdown;
  return {
    global: {
      costCents: totals.cost_subtotal_cents,
      saleCents: totals.total_ht_cents,
      marginPercent: markupPercent(totals.total_ht_cents, totals.cost_subtotal_cents),
      marginEurCents: totals.total_ht_cents - totals.cost_subtotal_cents,
      marginMultiplier: totals.realized_sale_coefficient === null ? 1 : Number(totals.realized_sale_coefficient),
      globalCoefficient: 1,
      discountCents: totals.discount_applied_cents,
    },
    sections: input.items
      .filter((item) => item.item_type === "section" && !item.parent_id)
      .sort((left, right) => left.position - right.position)
      .map((section) => {
        const entry = totalsByRoot.get(section.id) ?? { cost: 0, sale: 0 };
        return {
          sectionId: section.id,
          sectionTitle: section.title,
          sectionPosition: section.position,
          costCents: entry.cost,
          saleCents: entry.sale,
          marginPercent: markupPercent(entry.sale, entry.cost),
          marginEurCents: entry.sale - entry.cost,
        };
      }),
  };
}
