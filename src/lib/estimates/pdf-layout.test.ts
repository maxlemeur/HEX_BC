import { describe, expect, it } from "vitest";

import { DEFAULT_ESTIMATE_PDF_LAYOUT, applyEstimateTermsPolicy, parseEstimatePdfLayoutSearchParams, writeEstimatePdfLayoutSearchParams } from "@/lib/estimates/pdf-layout";

describe("estimate PDF layout", () => {

  it("keeps legacy max_level links compatible", () => {
    expect(
      parseEstimatePdfLayoutSearchParams({ max_level: "2" }).detailLevel
    ).toBe(2);
    expect(
      parseEstimatePdfLayoutSearchParams({ max_level: "all" }).detailLevel
    ).toBe("lines");
  });

  it("round-trips layout options through print search params", () => {
    const source = {
      ...DEFAULT_ESTIMATE_PDF_LAYOUT,
      detailLevel: 3 as const,
      priceMode: "fo_mo_and_total" as const,
      density: "comfortable" as const,
      conditionsPlacement: "new_page" as const,
      includeTerms: true,
    };
    const params = writeEstimatePdfLayoutSearchParams(source);
    const parsed = parseEstimatePdfLayoutSearchParams(
      Object.fromEntries(params.entries())
    );

    expect(parsed).toEqual(source);
  });

  it("enforces tenant terms policy over user preferences", () => {
    expect(
      applyEstimateTermsPolicy(
        { ...DEFAULT_ESTIMATE_PDF_LAYOUT, includeTerms: false },
        {
          available: true,
          policy: "required",
          title: "CGV",
          version: 2,
        }
      ).includeTerms
    ).toBe(true);
    expect(
      applyEstimateTermsPolicy(
        { ...DEFAULT_ESTIMATE_PDF_LAYOUT, includeTerms: true },
        {
          available: false,
          policy: "optional",
          title: null,
          version: null,
        }
      ).includeTerms
    ).toBe(false);
  });
});
