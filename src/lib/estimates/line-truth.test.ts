import { describe, expect, it } from "vitest";

import { resolveEstimateLineTruth } from "@/lib/estimates/line-truth";

describe("resolveEstimateLineTruth", () => {
  it("marks imported DPGF quantities as imported and not verified", () => {
    const truth = resolveEstimateLineTruth({
      item_type: "line",
      quantity: 24,
      source_provider: "dpgf",
      source_file_name: "client-dpgf.xlsx",
    });

    expect(truth).toMatchObject({
      source: {
        kind: "dpgf",
        label: "DPGF importee",
      },
      qtyStatus: {
        code: "imported_unverified",
        label: "Qte importee non verifiee",
      },
      confidence: {
        label: "moyenne",
        score: 0.6,
      },
      needsReview: true,
    });
  });

  it("marks takeoff quantities as measured with level-based confidence", () => {
    const truth = resolveEstimateLineTruth({
      item_type: "line",
      quantity: 12,
      source_provider: "takeoff",
      source_file_name: "plans-rdc.pdf",
      source_level: "A",
    });

    expect(truth).toMatchObject({
      source: {
        kind: "plan",
        label: "Plan / metre",
      },
      qtyStatus: {
        code: "measured",
        label: "Qte metree",
      },
      confidence: {
        label: "forte",
        score: 0.92,
      },
      needsReview: false,
    });
  });

  it("keeps the brief and CCTP provenance visible on ai structure rows", () => {
    const truth = resolveEstimateLineTruth({
      item_type: "line",
      quantity: 8,
      source_provider: "ai_structure",
      source_metadata: {
        applications: [
          {
            confidence: 0.81,
            provenance: [
              { type: "brief", label: "Brief confirme", excerpt: null },
              { type: "cctp", label: "CCTP principal", excerpt: "cctp.pdf" },
            ],
          },
        ],
      },
    });

    expect(truth).toMatchObject({
      source: {
        kind: "mixed",
        label: "Brief + CCTP",
      },
      qtyStatus: {
        code: "assumed",
      },
      confidence: {
        label: "forte",
        score: 0.81,
      },
      needsReview: true,
    });
  });

  it("keeps generated ouvrage quantities provisional and confidence-driven", () => {
    const truth = resolveEstimateLineTruth({
      item_type: "line",
      quantity: 3,
      source_provider: "generated_ouvrage",
      source_metadata: {
        confidence: 0.37,
      },
    });

    expect(truth).toMatchObject({
      source: {
        kind: "assembly",
        label: "Ouvrage",
      },
      qtyStatus: {
        code: "provisional",
        label: "Qte provisionnelle",
      },
      confidence: {
        label: "faible",
        score: 0.37,
      },
      needsReview: true,
    });
  });

  it("degrades missing manual quantities instead of overstating certainty", () => {
    const truth = resolveEstimateLineTruth({
      item_type: "line",
      quantity: null,
      source_provider: "manual",
    });

    expect(truth).toMatchObject({
      source: {
        kind: "manual",
        label: "Saisie manuelle",
      },
      qtyStatus: {
        code: "missing",
        label: "Qte manquante",
      },
      confidence: {
        label: "faible",
        score: null,
      },
      needsReview: true,
    });
  });
});
