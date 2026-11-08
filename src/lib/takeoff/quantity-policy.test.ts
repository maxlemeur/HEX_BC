import { describe, expect, it } from "vitest";

import { compareQuantityPairs, surfaceBasis, surfaceLineBasis } from "@/lib/takeoff/quantity-policy";

describe("TI-680 protective quantities", () => {
  it.each([[3000, 3020, 3020], [3000, 2980, 3000], [20, 19.85, 20]])(
    "preserves reference %s and measurement %s while pricing %s",
    (reference, measured, priced) => {
      expect(compareQuantityPairs([{ reference, measured }])).toMatchObject({ reference, measured, priced, requiresReview: false });
    }
  );

  it("checks accumulated absolute gaps, without cancelling opposite errors", () => {
    expect(compareQuantityPairs([{ reference: 50, measured: 51 }, { reference: 50, measured: 49 }]))
      .toMatchObject({ reference: 100, measured: 100, priced: 101, absoluteGap: 2, requiresReview: true });
    expect(compareQuantityPairs([{ reference: 50, measured: 50.2 }, { reference: 50, measured: 49.8 }]))
      .toMatchObject({ priced: 100.2, requiresReview: false });
  });

  it("judges small gaps against their own line, at the unrounded strict 1% boundary", () => {
    expect(compareQuantityPairs([{ reference: 3000, measured: 3000.03 }])!.requiresReview).toBe(false);
    expect(compareQuantityPairs([{ reference: 3000, measured: 3030 }])!.requiresReview).toBe(false);
    expect(compareQuantityPairs([{ reference: 3000, measured: 3030.001 }])!.requiresReview).toBe(true);
    expect(compareQuantityPairs([{ reference: 3000, measured: 3060 }])!.requiresReview).toBe(true);
  });

  it("does not fabricate a percentage for absent or zero references", () => {
    expect(compareQuantityPairs([])).toBeNull();
    expect(compareQuantityPairs([{ reference: 0, measured: 1 }])).toMatchObject({ percentGap: null, requiresReview: true });
    expect(compareQuantityPairs([{ reference: 0, measured: 0 }])).toMatchObject({ requiresReview: false });
  });

  it("distinguishes the default basis of floor work from the unknown basis of a plan label", () => {
    expect(surfaceLineBasis("Fourniture et pose de revêtement de sol")).toBe("net_floor");
    expect(surfaceLineBasis("Chape calculée sur la SHAB")).toBe("shab");
    expect(surfaceBasis("Bureau 20 m²")).toBeNull();
    expect(surfaceBasis("Bureau — sol net 20 m²")).toBe("net_floor");
    expect(surfaceBasis("Surface habitable 20 m²")).toBe("shab");
    expect(surfaceLineBasis("Plancher chauffant")).toBeNull();
  });
});
