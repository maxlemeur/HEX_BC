import { describe, expect, it } from "vitest";

import { resolveEffectiveMarginBp } from "@/lib/estimates/effective-margin";

describe("resolveEffectiveMarginBp", () => {
  it("keeps the v1 stored margin before its multiplier fallback", () => {
    expect(
      resolveEffectiveMarginBp({
        calc_engine_version: 1,
        margin_bp: 1_450,
        margin_multiplier: 2,
      })
    ).toBe(1_450);
  });

  it("derives a fixed v2 margin from the configured multiplier", () => {
    expect(
      resolveEffectiveMarginBp({
        calc_engine_version: 2,
        margin_mode: "fixed",
        margin_bp: 0,
        margin_multiplier: 1.25,
      })
    ).toBe(2_000);
  });

  it.each([
    ["crosses upward into the higher-cost tier", 1.6, 1.4, 2_857],
    ["crosses downward into the lower-cost tier", 1.4, 1.6, 3_750],
  ])("%s", (_label, configuredMultiplier, effectiveMultiplier, expectedBp) => {
    expect(
      resolveEffectiveMarginBp({
        calc_engine_version: 2,
        margin_mode: "tiered",
        margin_bp: 0,
        margin_multiplier: configuredMultiplier,
        content_revision: 7,
        calc_snapshot_content_revision: 7,
        calc_snapshot_context: {
          effective_margin_multiplier: effectiveMultiplier,
          labor_split_enabled: false,
          labor_roles: [],
          margin_tiers: [],
        },
      })
    ).toBe(expectedBp);
  });

  it("does not invent a tiered v2 margin before an authoritative freeze", () => {
    expect(
      resolveEffectiveMarginBp({
        calc_engine_version: 2,
        margin_mode: "tiered",
        margin_bp: 0,
        margin_multiplier: 1.6,
        calc_snapshot_context: null,
      })
    ).toBeNull();
  });

  it("ignores a tiered snapshot from an older content revision", () => {
    expect(
      resolveEffectiveMarginBp({
        calc_engine_version: 2,
        margin_mode: "tiered",
        margin_bp: 0,
        margin_multiplier: 1.4,
        content_revision: 8,
        calc_snapshot_content_revision: 7,
        calc_snapshot_context: { effective_margin_multiplier: 1.6 },
      })
    ).toBeNull();
  });
});
