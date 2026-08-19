// Golden regime: moteur v2 et replay immuable du snapshot.

import { describe, expect, it } from "vitest";

import {
  computeEstimateBreakdown,
  buildEstimateV2SnapshotProjection,
  buildStoredEstimateBreakdown,
} from "@/lib/estimate-calculations";
import { type MarginTier } from "@/lib/estimates/margin-tiers";
import {
  LABOR_RATES,
  makeLine,
  makeSection,
  makeVersion,
} from "./fixtures";

describe("Fixture J - golden couple v1/v2 + snapshot contractuel", () => {
  it("préserve v1 et rejoue exactement lignes, sections et pied v2 figés", () => {
    const items = [
      makeSection({ id: "sec-v2", position: 0 }),
      makeLine({
        id: "v2-l1",
        parent_id: "sec-v2",
        position: 1,
        quantity: 2,
        unit_price_ht_cents: 10_000,
        h_mo: 1,
        tax_rate_bp: 1_000,
      }),
      makeLine({
        id: "v2-l2",
        parent_id: null,
        position: 2,
        quantity: 1,
        unit_price_ht_cents: 6_000,
        h_mo: 2,
        tax_rate_bp: 2_000,
      }),
    ];
    const common = {
      items,
      marginMultiplier: 1.25,
      marginMode: "fixed" as const,
      marginTiers: [] as MarginTier[],
      globalCoefficient: 1.1,
      discountMode: "simple" as const,
      discountCents: 1_337,
      discountStepsBp: [] as number[],
      taxRateBp: 2_000,
      roundingMode: "nearest" as const,
      roundingStepCents: 100,
      isLaborSplitEnabled: false,
      laborRateById: LABOR_RATES,
      laborRateAtelierById: LABOR_RATES,
      laborRateChantierById: LABOR_RATES,
    };

    const v1 = computeEstimateBreakdown({ ...common, calcEngineVersion: 1 });
    const v2 = computeEstimateBreakdown({ ...common, calcEngineVersion: 2 });

    expect({
      v1: {
        totals: [
          v1.totals.saleTotalCents,
          v1.totals.adjustedTaxCents,
          v1.totals.roundedTtcCents,
        ],
        lineHt: [...v1.lineById].map(([id, line]) => [id, line.saleNetHtCents]),
        sectionHt: [...v1.sectionById].map(([id, section]) => [
          id,
          section.totalHtCents,
        ]),
        invariant: v1.invariants,
      },
      v2: {
        totals: [
          v2.totals.saleTotalCents,
          v2.totals.adjustedTaxCents,
          v2.totals.roundedTtcCents,
        ],
        lineHt: [...v2.lineById].map(([id, line]) => [id, line.saleNetHtCents]),
        sectionHt: [...v2.sectionById].map(([id, section]) => [
          id,
          section.totalHtCents,
        ]),
        rootLineIds: v2.rootLineIds,
        invariant: v2.invariants,
      },
    }).toEqual({
        "v1": {
          "invariant": {
            "matchesFooter": false,
            "sumAllocatedHtCents": 49375,
          },
          "lineHt": [
            [
              "v2-l1",
              30625,
            ],
            [
              "v2-l2",
              18750,
            ],
          ],
          "sectionHt": [
            [
              "sec-v2",
              29796,
            ],
          ],
          "totals": [
            52975,
            10625,
            63600,
          ],
        },
        "v2": {
          "invariant": {
            "matchesFooter": true,
            "sumAllocatedHtCents": 52975,
          },
          "lineHt": [
            [
              "v2-l1",
              32858,
            ],
            [
              "v2-l2",
              20117,
            ],
          ],
          "rootLineIds": [
            "v2-l2",
          ],
          "sectionHt": [
            [
              "sec-v2",
              32858,
            ],
          ],
          "totals": [
            52975,
            7325,
            60300,
          ],
        },
      });

    const projection = buildEstimateV2SnapshotProjection({ items, breakdown: v2 });
    const snapshotById = new Map(projection.items.map((line) => [line.id, line]));
    const frozenItems = items.map((item) => ({
      ...item,
      ...(snapshotById.get(item.id) ?? {}),
    }));
    const replayA = buildStoredEstimateBreakdown({
      items: frozenItems,
      version: {
        ...makeVersion({
          status: "sent",
          total_ht_cents: projection.totals.total_ht_cents,
          total_tax_cents: projection.totals.total_tax_cents,
          total_ttc_cents: projection.totals.total_ttc_cents,
        }),
      },
    });
    const replayB = buildStoredEstimateBreakdown({
      items: frozenItems,
      version: {
        ...makeVersion({
          status: "sent",
          margin_multiplier: 9,
          total_ht_cents: projection.totals.total_ht_cents,
          total_tax_cents: projection.totals.total_tax_cents,
          total_ttc_cents: projection.totals.total_ttc_cents,
        }),
      },
    });

    const summarizeReplay = (breakdown: typeof replayA) => ({
      totals: [
        breakdown.totals.saleTotalCents,
        breakdown.totals.adjustedTaxCents,
        breakdown.totals.roundedTtcCents,
      ],
      lines: [...breakdown.lineById].map(([id, line]) => [
        id,
        line.puNetHtCents,
        line.foNetCents,
        line.moNetCents,
        line.saleNetHtCents,
        line.taxCents,
      ]),
      sections: [...breakdown.sectionById].map(([id, section]) => [
        id,
        section.foTotalCents,
        section.moTotalCents,
        section.totalHtCents,
        section.totalTtcCents,
      ]),
      rootLineIds: breakdown.rootLineIds,
      invariant: breakdown.invariants,
    });

    expect(summarizeReplay(replayA)).toEqual(summarizeReplay(replayB));
    expect(summarizeReplay(replayA)).toEqual({
        "invariant": {
          "matchesFooter": true,
          "sumAllocatedHtCents": 52975,
        },
        "lines": [
          [
            "v2-l1",
            16429,
            26823,
            6035,
            32858,
            3293,
          ],
          [
            "v2-l2",
            20117,
            8047,
            12070,
            20117,
            4032,
          ],
        ],
        "rootLineIds": [
          "v2-l2",
        ],
        "sections": [
          [
            "sec-v2",
            26823,
            6035,
            32858,
            36151,
          ],
        ],
        "totals": [
          52975,
          7325,
          60300,
        ],
      });
  });
});
