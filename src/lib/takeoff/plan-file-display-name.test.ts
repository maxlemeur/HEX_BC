import { describe, expect, it } from "vitest";

import {
  getPlanFileDisplayName,
  normalizePlanFileOriginalName,
  withPlanFileOriginalName,
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

  it("replaces a caller-supplied label with the received name and keeps other metadata", () => {
    expect(
      withPlanFileOriginalName({ revision: "B", original_file_name: "Plan R-1.pdf" }, "Plan R+1.pdf")
    ).toEqual({ revision: "B", original_file_name: "Plan R+1.pdf" });
    expect(withPlanFileOriginalName({ original_file_name: "Plan R-1.pdf" }, " ")).toEqual({});
  });

  it("displays the original name, or the stored name when there is none", () => {
    expect(
      getPlanFileDisplayName({ file_name: "Plan-R-1.pdf", metadata: { original_file_name: "Plan R+1.pdf" } })
    ).toBe("Plan R+1.pdf");
    expect(getPlanFileDisplayName({ file_name: "Plan-R-1.pdf", metadata: {} })).toBe("Plan-R-1.pdf");
    expect(getPlanFileDisplayName({ file_name: "Plan-R-1.pdf", metadata: null })).toBe("Plan-R-1.pdf");
    expect(
      getPlanFileDisplayName({ file_name: "Plan-R-1.pdf", metadata: { original_file_name: 12 } })
    ).toBe("Plan-R-1.pdf");
    expect(
      getPlanFileDisplayName({ file_name: "Plan-R-1.pdf", metadata: { original_file_name: "  " } })
    ).toBe("Plan-R-1.pdf");
  });
});
