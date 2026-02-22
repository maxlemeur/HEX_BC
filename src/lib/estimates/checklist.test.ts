import { describe, expect, it } from "vitest";

import { computeEstimateChecklist } from "@/lib/estimates/checklist";
import type { EstimateQualityFlagsByItemId } from "@/lib/estimate-quality";
import type { Database } from "@/types/database";

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createLine(id: string): EstimateItem {
  return {
    id,
    item_type: "line",
  } as EstimateItem;
}

function createSection(id: string): EstimateItem {
  return {
    id,
    item_type: "section",
  } as EstimateItem;
}

describe("estimate checklist", () => {
  it("computes criterion statuses and progression from quality flags", () => {
    const items: EstimateItem[] = [
      createSection("section-1"),
      createLine("line-1"),
      createLine("line-2"),
      createLine("line-3"),
    ];

    const qualityFlagsByItemId: EstimateQualityFlagsByItemId = {
      "line-1": ["missing_price", "missing_quantity"],
      "line-2": ["missing_labor_role"],
      "line-3": [],
    };

    const checklist = computeEstimateChecklist({
      items,
      qualityFlagsByItemId,
      settings: {
        margin_multiplier: 1.2,
        date_devis: "2026-02-20",
        validite_jours: 30,
      },
    });

    expect(checklist.progressPercent).toBe(40);
    expect(checklist.completedCount).toBe(2);
    expect(checklist.blockingCount).toBe(2);
    expect(checklist.warningCount).toBe(1);
    expect(checklist.status).toBe("blocking");

    expect(
      checklist.criteria.find((criterion) => criterion.key === "prices")
    ).toMatchObject({
      status: "blocking",
      missingCount: 1,
      targetItemId: "line-1",
      qualityFlag: "missing_price",
    });

    expect(
      checklist.criteria.find((criterion) => criterion.key === "quantities")
    ).toMatchObject({
      status: "blocking",
      missingCount: 1,
      targetItemId: "line-1",
      qualityFlag: "missing_quantity",
    });

    expect(
      checklist.criteria.find((criterion) => criterion.key === "labor_roles")
    ).toMatchObject({
      status: "warning",
      missingCount: 1,
      targetItemId: "line-2",
      qualityFlag: "missing_labor_role",
    });
  });

  it("picks the first anomaly according to editor order", () => {
    const items: EstimateItem[] = [
      createSection("section-1"),
      createLine("line-a"),
      createLine("line-b"),
      createLine("line-c"),
    ];

    const qualityFlagsByItemId: EstimateQualityFlagsByItemId = {
      "line-a": ["missing_quantity"],
      "line-b": ["missing_price"],
      "line-c": ["missing_price"],
    };

    const checklist = computeEstimateChecklist({
      items,
      qualityFlagsByItemId,
      settings: {
        margin_multiplier: 1.1,
        date_devis: "2026-02-21",
        validite_jours: 30,
      },
    });

    expect(
      checklist.criteria.find((criterion) => criterion.key === "prices")?.targetItemId
    ).toBe("line-b");
    expect(
      checklist.criteria.find((criterion) => criterion.key === "quantities")
        ?.targetItemId
    ).toBe("line-a");
  });

  it("flags settings criteria when margin or validity data are missing", () => {
    const checklist = computeEstimateChecklist({
      items: [createLine("line-1")],
      qualityFlagsByItemId: {
        "line-1": [],
      },
      settings: {
        margin_multiplier: 0,
        margin_mode: "fixed",
        date_devis: "",
        validite_jours: 0,
      },
    });

    expect(
      checklist.criteria.find((criterion) => criterion.key === "margin_defined")
    ).toMatchObject({
      status: "blocking",
      isComplete: false,
      missingCount: 1,
      targetItemId: null,
    });

    expect(
      checklist.criteria.find((criterion) => criterion.key === "validity_dates")
    ).toMatchObject({
      status: "warning",
      isComplete: false,
      missingCount: 1,
      targetItemId: null,
    });
  });

  it("requires at least one tier when margin mode is tiered", () => {
    const checklist = computeEstimateChecklist({
      items: [createLine("line-1")],
      qualityFlagsByItemId: {
        "line-1": [],
      },
      settings: {
        margin_multiplier: 1,
        margin_mode: "tiered",
        margin_tiers: [],
        date_devis: "2026-02-21",
        validite_jours: 30,
      },
    });

    expect(
      checklist.criteria.find((criterion) => criterion.key === "margin_defined")
    ).toMatchObject({
      status: "blocking",
      isComplete: false,
      missingCount: 1,
    });
  });
});
