import { describe, expect, it } from "vitest";

import {
  buildPlanFileStoragePath,
  normalizePlanFileOriginalName,
  sanitizePlanPdfFilename,
} from "@/lib/takeoff/plan-file-display-name";

describe("plan file original name", () => {
  it("keeps the received name, composed to NFC and trimmed", () => {
    expect(normalizePlanFileOriginalName("  Plan R+1.pdf ")).toBe("Plan R+1.pdf");
    expect(normalizePlanFileOriginalName("Électricité.pdf".normalize("NFD"))).toBe(
      "Électricité.pdf".normalize("NFC")
    );
    expect(normalizePlanFileOriginalName("   ")).toBeNull();
    expect(normalizePlanFileOriginalName(`${"a".repeat(300)}.pdf`)).toHaveLength(255);
  });
});

describe("plan file storage name", () => {
  it.each([
    ["Plan R+1.pdf", "Plan-R-1.pdf"],
    ["Plan R-1.PDF", "Plan-R-1.PDF"],
    ["dossier/sous dossier\\Plan.pdf", "dossier-sous-dossier-Plan.pdf"],
    ["Électricité RDC", "lectricit-RDC.pdf"],
    ["..plan..", "plan.pdf"],
    ["???", "plan.pdf"],
  ])("sanitizes %j to %j", (input, expected) => {
    expect(sanitizePlanPdfFilename(input)).toBe(expected);
  });

  it("builds the tenant/set/file/name key", () => {
    expect(
      buildPlanFileStoragePath({ tenantId: "t1", setId: "s1", fileId: "f1", fileName: "Plan-R-1.pdf" })
    ).toBe("t1/s1/f1/Plan-R-1.pdf");
  });
});
