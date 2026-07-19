import { describe, expect, it } from "vitest";

import {
  buildEstimatePdfFilename,
  formatEstimateReference,
} from "@/lib/estimates/reference";

describe("estimate references", () => {
  it("omits the version suffix for the first version", () => {
    expect(formatEstimateReference("HEX_D26001MM", 1)).toBe("HEX_D26001MM");
  });

  it("adds the version suffix from the second version", () => {
    expect(formatEstimateReference("HEX_D26001MM", 2)).toBe(
      "HEX_D26001MM_V2"
    );
  });

  it("uses the official reference for the PDF filename", () => {
    expect(
      buildEstimatePdfFilename({
        baseReference: "HEX_D26001MM",
        versionNumber: 3,
        fallback: "Projet plomberie",
      })
    ).toBe("HEX_D26001MM_V3.pdf");
  });

  it("keeps a safe fallback for legacy estimates", () => {
    expect(
      buildEstimatePdfFilename({
        baseReference: null,
        versionNumber: 1,
        fallback: "Projet / plomberie",
      })
    ).toBe("Projet_-_plomberie.pdf");
  });
});
