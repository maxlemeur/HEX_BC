"use client";

import { useMemo } from "react";

import type { EstimateSectionCalculation } from "@/components/estimates/hooks/useEstimateVisibility";
import { computeAllSectionTotals, type SectionTotals } from "@/lib/estimate-calculations";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];
type Input = {
  items: EstimateItem[];
  itemsByParent: Map<string, EstimateItem[]>;
  getSectionTotals: (id: string) => SectionTotals | null;
  marginMultiplier: number;
  discountCents: number;
  taxRateBp: number;
  laborRateById: Map<string, number>;
  isLaborSplitEnabled: boolean;
  sectionCalculation: EstimateSectionCalculation;
};

export function useEstimateTableTotals({
  items, itemsByParent, getSectionTotals, marginMultiplier, discountCents,
  taxRateBp, laborRateById, isLaborSplitEnabled, sectionCalculation,
}: Input) {
  // The footer describes the full version; table subtotals keep following the quick filter.
  const versionSaleSplit = useMemo(() => {
    const totalsBySection = computeAllSectionTotals({
      items, marginMultiplier, discountCents, taxRateBp,
      laborRateById, isLaborSplitEnabled, ...sectionCalculation,
    });
    let foTotal = 0;
    let moTotal = 0;
    for (const item of items) {
      if (item.parent_id !== null || item.item_type !== "section") continue;
      const totals = totalsBySection.get(item.id);
      foTotal += totals?.foTotalCents ?? 0;
      moTotal += totals?.moTotalCents ?? 0;
    }
    return { foTotal, moTotal };
  }, [items, marginMultiplier, discountCents, taxRateBp, laborRateById, isLaborSplitEnabled, sectionCalculation]);

  const grandTotals = useMemo(() => {
    const rootItems = itemsByParent.get("root") ?? [];
    let foTotal = 0;
    let moTotal = 0;
    let htTotal = 0;
    for (const item of rootItems) {
      if (item.item_type !== "section") continue;
      const totals = getSectionTotals(item.id);
      if (!totals) continue;
      foTotal += totals.foTotalCents;
      moTotal += totals.moTotalCents;
      htTotal += totals.totalHtCents;
    }
    return { foTotal, moTotal, htTotal };
  }, [itemsByParent, getSectionTotals]);

  return { grandTotals, versionSaleSplit };
}
