import { describe, expect, it } from "vitest";
import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

import {
  filterAffaireHubCommandBarSuggestions,
  getAffaireHubDominantIntent,
  isAffaireFreshStartState,
  shouldShowAffaireCreatedOnboardingBanner,
} from "./AffaireHub";

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

describe("isAffaireFreshStartState", () => {
  it("returns true when the affaire has no documents, no linked DPGF and no devis lines", () => {
    expect(
      isAffaireFreshStartState({
        intakeWorkspace: {
          documents: [],
        },
        dpgfSource: null,
        lineCount: 0,
      }),
    ).toBe(true);
  });

  it("returns false once the affair already has a source of work", () => {
    expect(
      isAffaireFreshStartState({
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
        lineCount: 0,
      }),
    ).toBe(false);
  });
});

describe("getAffaireHubDominantIntent", () => {
  it("prioritises the same dominant action as the flow hero", () => {
    expect(
      getAffaireHubDominantIntent([
        {
          actionId: "add-files",
          label: "Ajouter des fichiers",
          intent: "add_files",
          preview: "",
          target: { kind: "open_surface", surfaceId: "intake-upload" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 100,
          isPinned: false,
          isHidden: false,
        },
        {
          actionId: "missing",
          label: "Ajouter 2 pieces manquantes",
          intent: "add_missing_pieces",
          preview: "",
          target: { kind: "open_surface", surfaceId: "intake-upload" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 200,
          isPinned: false,
          isHidden: false,
        },
      ]),
    ).toBe("add_missing_pieces");
  });

  it("prioritises review before missing pieces when both exist", () => {
    expect(
      getAffaireHubDominantIntent([
        {
          actionId: "missing",
          label: "Ajouter 2 pieces manquantes",
          intent: "add_missing_pieces",
          preview: "",
          target: { kind: "open_surface", surfaceId: "intake-upload" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 200,
          isPinned: false,
          isHidden: false,
        },
        {
          actionId: "review",
          label: "Confirmer 1 piece a revoir",
          intent: "review_intake",
          preview: "",
          target: { kind: "navigate", href: "/dashboard/affaires/project?intakeFilter=a_revoir#intake" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 250,
          isPinned: false,
          isHidden: false,
        },
      ]),
    ).toBe("review_intake");
  });
});

describe("filterAffaireHubCommandBarSuggestions", () => {
  it("removes the dominant CTA and generic add-files from the command bar", () => {
    const suggestions: CockpitSuggestion[] = [
      {
        actionId: "add-files",
        label: "Ajouter des fichiers",
        intent: "add_files",
        preview: "",
        target: { kind: "open_surface", surfaceId: "intake-upload" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 100,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "confirm-brief",
        label: "Confirmer le brief affaire",
        intent: "confirm_brief",
        preview: "",
        target: { kind: "open_surface", surfaceId: "brief-confirm" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 200,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "view-exceptions",
        label: "Voir les ecarts",
        intent: "view_exceptions",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/affaires/project/plans" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 50,
        isPinned: false,
        isHidden: false,
      },
    ];

    expect(
      filterAffaireHubCommandBarSuggestions(suggestions, "confirm_brief").map(
        (suggestion) => suggestion.intent,
      ),
    ).toEqual(["view_exceptions"]);
  });

  it("removes competing progression CTAs when review is dominant", () => {
    const suggestions: CockpitSuggestion[] = [
      {
        actionId: "review",
        label: "Confirmer 1 piece a revoir",
        intent: "review_intake",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/affaires/project?intakeFilter=a_revoir#intake" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 250,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "missing",
        label: "Ajouter 3 pieces manquantes",
        intent: "add_missing_pieces",
        preview: "",
        target: { kind: "open_surface", surfaceId: "intake-upload" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 200,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "generate-structure",
        label: "Generer la structure du devis",
        intent: "generate_structure",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/estimates/version-1/edit?openVersionZero=1" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 150,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "legacy",
        label: "Ouvrir le fallback legacy",
        intent: "legacy_fallback",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/estimates/version-1/takeoff" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 50,
        isPinned: false,
        isHidden: false,
      },
    ];

    expect(
      filterAffaireHubCommandBarSuggestions(suggestions, "review_intake").map(
        (suggestion) => suggestion.intent,
      ),
    ).toEqual(["legacy_fallback"]);
  });
});
