import { describe, expect, it } from "vitest";

import { normalizePlanFileOriginalName } from "@/lib/takeoff/plan-file-display-name";

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
