import { describe, expect, it } from "vitest";

import { buildManualLinkCandidates } from "@/components/takeoff/TakeoffDpgfCompareView";

describe("buildManualLinkCandidates", () => {
  it("keeps already matched takeoff items available for manual reassignment", () => {
    const row = {
      line_id: "line-a",
      line_label: "Cloison BA13",
      linked_takeoff_items: [
        {
          item_id: "item-a",
          designation: "Cloison BA13 zone A",
          quantity: 4,
          unit: "m2",
          source_page: 3,
          source_file_name: "plans.pdf",
          confidence: 0.91,
          evidence: "Zone A",
          metadata: {},
        },
      ],
    };
    const rows = [
      {
        ...row,
      },
      {
        line_id: "line-b",
        line_label: "Cloison BA13 reserve",
        linked_takeoff_items: [
          {
            item_id: "item-b",
            designation: "Cloison BA13 zone B",
            quantity: 6,
            unit: "m2",
            source_page: 4,
            source_file_name: "plans.pdf",
            confidence: 0.87,
            evidence: "Zone B",
            metadata: {},
          },
        ],
      },
    ] as const;

    const candidates = buildManualLinkCandidates({
      row: row as never,
      rows: rows as never,
      manualLinkCandidates: [
        {
          item_id: "item-a",
          designation: "Cloison BA13 zone A",
          quantity: 4,
          unit: "m2",
          source_file_name: "plans.pdf",
          source_page: 3,
          confidence_score: 0.91,
          evidence: "Zone A",
        },
        {
          item_id: "item-b",
          designation: "Cloison BA13 zone B",
          quantity: 6,
          unit: "m2",
          source_file_name: "plans.pdf",
          source_page: 4,
          confidence_score: 0.87,
          evidence: "Zone B",
        },
        {
          item_id: "item-c",
          designation: "Cloison BA13 zone C",
          quantity: 2,
          unit: "m2",
          source_file_name: "plans.pdf",
          source_page: 5,
          confidence_score: 0.7,
          evidence: "Zone C",
        },
      ],
    });

    expect(candidates.map((candidate) => candidate.item_id)).toEqual([
      "item-a",
      "item-b",
      "item-c",
    ]);
    expect(candidates[1]).toMatchObject({
      item_id: "item-b",
      linked_line_label: "Cloison BA13 reserve",
      is_current: false,
    });
  });
});
