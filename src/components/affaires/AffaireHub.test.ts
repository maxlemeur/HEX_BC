import { describe, expect, it } from "vitest";

import { shouldShowAffaireCreatedOnboardingBanner } from "./AffaireHub";

describe("shouldShowAffaireCreatedOnboardingBanner", () => {
  it("shows the onboarding banner when no dossier or linked DPGF exists yet", () => {
    expect(
      shouldShowAffaireCreatedOnboardingBanner({
        showOnboardingBanner: true,
        intakeWorkspace: null,
        dpgfSource: null,
      }),
    ).toBe(true);
  });

  it("suppresses the onboarding banner when a DPGF is already linked", () => {
    expect(
      shouldShowAffaireCreatedOnboardingBanner({
        showOnboardingBanner: true,
        intakeWorkspace: {
          documents: [],
        },
        dpgfSource: {
          importId: "import-1",
          filename: "import-dpgf.xlsx",
          sourceFormat: "xlsx",
          importStatus: "completed",
          mappingStatus: "mapped",
          importedAt: "2026-03-11T08:00:00.000Z",
          mappingUpdatedAt: "2026-03-11T08:05:00.000Z",
          parseMode: "spreadsheet",
          rowCount: 42,
        },
      }),
    ).toBe(false);
  });
});
