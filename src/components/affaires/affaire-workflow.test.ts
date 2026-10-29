import { describe, expect, it } from "vitest";

import { shouldRenderPlansSection } from "@/components/affaires/affaire-workflow";

describe("shouldRenderPlansSection", () => {
  it("keeps the plans section mounted when loading the summary failed", () => {
    expect(
      shouldRenderPlansSection({
        takeoffEnabled: true,
        planSetCount: null,
        plansErrorMessage: "Impossible de charger le resume des plans.",
      })
    ).toBe(true);
  });
});
