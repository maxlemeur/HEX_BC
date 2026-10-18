import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";
import { describe,expect,it } from "vitest";

import {
filterAffaireHubCommandBarSuggestions,
getAffaireHubDominantIntent,
getAffaireHubHiddenPilotageExceptionIds,
getAffaireHubIntakeWorkspacePresentation,
shouldHideAffaireHubTakeoffLaunchAction,
shouldPreferLinkedDpgfImportAction
} from "./AffaireHub";

describe("getAffaireHubDominantIntent", () => {

  it("keeps progression CTAs ahead of client clarifications", () => {
    expect(
      getAffaireHubDominantIntent([
        {
          actionId: "list-clarifications",
          label: "Traiter 1 clarification client",
          intent: "list_hypotheses",
          preview: "",
          target: { kind: "navigate", href: "/dashboard/affaires/project?registerStatus=clarify_with_client#register" },
          requiresConfirmation: false,
          confirmTone: "warning",
          priority: 300,
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
          priority: 200,
          isPinned: false,
          isHidden: false,
        },
      ]),
    ).toBe("generate_structure");
  });

  it("prioritises hybrid continuation ahead of plans and alternative structure actions", () => {
    expect(
      getAffaireHubDominantIntent([
        {
          actionId: "continue-hybrid",
          label: "Passer le devis en hybride",
          intent: "continue_hybrid",
          preview: "",
          target: { kind: "navigate", href: "/dashboard/estimates/version-1/edit" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 220,
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
          priority: 200,
          isPinned: false,
          isHidden: false,
        },
        {
          actionId: "analyze-plans",
          label: "Analyser les plans",
          intent: "analyze_plans",
          preview: "",
          target: { kind: "open_surface", surfaceId: "launch-metre" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 180,
          isPinned: false,
          isHidden: false,
        },
      ]),
    ).toBe("continue_hybrid");
  });

  it("still prioritises client clarifications when no progression CTA remains", () => {
    expect(
      getAffaireHubDominantIntent([
        {
          actionId: "list-clarifications",
          label: "Traiter 1 clarification client",
          intent: "list_hypotheses",
          preview: "",
          target: { kind: "navigate", href: "/dashboard/affaires/project?registerStatus=clarify_with_client#register" },
          requiresConfirmation: false,
          confirmTone: "warning",
          priority: 300,
          isPinned: false,
          isHidden: false,
        },
        {
          actionId: "legacy",
          label: "Ouvrir l’ancien parcours",
          intent: "view_exceptions",
          preview: "",
          target: { kind: "navigate", href: "/dashboard/estimates/version-1/takeoff" },
          requiresConfirmation: false,
          confirmTone: "info",
          priority: 50,
          isPinned: false,
          isHidden: false,
        },
      ]),
    ).toBe("list_hypotheses");
  });
});

describe("filterAffaireHubCommandBarSuggestions", () => {

  it("removes competing progression CTAs when a clarification is dominant", () => {
    const suggestions: CockpitSuggestion[] = [
      {
        actionId: "list-clarifications",
        label: "Traiter 1 clarification client",
        intent: "list_hypotheses",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/affaires/project?registerStatus=clarify_with_client#register" },
        requiresConfirmation: false,
        confirmTone: "warning",
        priority: 250,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "list-hypotheses",
        label: "Traiter 2 hypotheses ouvertes",
        intent: "list_hypotheses",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/affaires/project?registerStatus=open#register" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 240,
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
        label: "Ouvrir l’ancien parcours",
        intent: "view_exceptions",
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
      filterAffaireHubCommandBarSuggestions(suggestions, "list_hypotheses").map(
        (suggestion) => suggestion.intent,
      ),
    ).toEqual(["view_exceptions"]);
  });

  it("removes competing structure actions when hybrid continuation is dominant", () => {
    const suggestions: CockpitSuggestion[] = [
      {
        actionId: "continue-hybrid",
        label: "Passer le devis en hybride",
        intent: "continue_hybrid",
        preview: "",
        target: { kind: "navigate", href: "/dashboard/estimates/version-1/edit" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 220,
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
        priority: 200,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "analyze-plans",
        label: "Analyser les plans",
        intent: "analyze_plans",
        preview: "",
        target: { kind: "open_surface", surfaceId: "launch-metre" },
        requiresConfirmation: false,
        confirmTone: "info",
        priority: 180,
        isPinned: false,
        isHidden: false,
      },
      {
        actionId: "legacy",
        label: "Ouvrir l’ancien parcours",
        intent: "view_exceptions",
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
      filterAffaireHubCommandBarSuggestions(suggestions, "continue_hybrid").map(
        (suggestion) => suggestion.intent,
      ),
    ).toEqual(["view_exceptions"]);
  });
});

describe("linked DPGF import preference", () => {
  it("prefers the linked DPGF import path when the draft has no line yet", () => {
    expect(
      shouldPreferLinkedDpgfImportAction({
        summary: {
          project: {
            id: "project-1",
            name: "Affaire",
            clientName: null,
            reference: null,
          },
          currentVersion: {
            id: "version-1",
            projectId: "project-1",
            status: "draft",
            versionNumber: 1,
            totalHtCents: 0,
            marginMultiplier: 1,
            marginPercent: 0,
            updatedAt: "2026-03-11T08:00:00.000Z",
          },
          acceptedVersion: null,
          versionsCount: 1,
          lineCount: 0,
          affaireHasLines: false,
          structureMode: {
            mode: "not_started",
            lineCount: 0,
            importedLineCount: 0,
            manualLineCount: 0,
            unsupportedLineCount: 0,
            hasImportableLinkedDpgfSource: true,
            canImportLinkedDpgfIntoCurrentStructure: false,
            linkedDpgfMappedRowCount: 42,
          },
        },
        dpgfSource: {
          importId: "import-1",
          filename: "dpgf.xlsx",
          sourceFormat: "xlsx",
          importStatus: "completed",
          mappingStatus: "validated",
          importedAt: "2026-03-11T08:00:00.000Z",
          mappingUpdatedAt: "2026-03-11T08:05:00.000Z",
          parseMode: "spreadsheet",
          rowCount: 42,
          mappedRowCount: 42,
        },
      }),
    ).toBe(true);
  });

  it("prefers the linked DPGF import path when mapped rows exist without a mapping record", () => {
    expect(
      shouldPreferLinkedDpgfImportAction({
        summary: {
          project: {
            id: "project-1",
            name: "Affaire",
            clientName: null,
            reference: null,
          },
          currentVersion: {
            id: "version-1",
            projectId: "project-1",
            status: "draft",
            versionNumber: 1,
            totalHtCents: 0,
            marginMultiplier: 1,
            marginPercent: 0,
            updatedAt: "2026-03-11T08:00:00.000Z",
          },
          acceptedVersion: null,
          versionsCount: 1,
          lineCount: 0,
          affaireHasLines: false,
          structureMode: {
            mode: "not_started",
            lineCount: 0,
            importedLineCount: 0,
            manualLineCount: 0,
            unsupportedLineCount: 0,
            hasImportableLinkedDpgfSource: true,
            canImportLinkedDpgfIntoCurrentStructure: false,
            linkedDpgfMappedRowCount: 42,
          },
        },
        dpgfSource: {
          importId: "import-1",
          filename: "dpgf.xlsx",
          sourceFormat: "xlsx",
          importStatus: "completed",
          mappingStatus: null,
          importedAt: "2026-03-11T08:00:00.000Z",
          mappingUpdatedAt: null,
          parseMode: "spreadsheet",
          rowCount: 42,
          mappedRowCount: 42,
        },
      }),
    ).toBe(true);
  });
});

describe("getAffaireHubHiddenPilotageExceptionIds", () => {
  it("hides the takeoff launch exception when hybrid continuation is dominant", () => {
    expect(
      getAffaireHubHiddenPilotageExceptionIds({
        dominantIntent: "continue_hybrid",
        hasDominantClarificationSuggestion: false,
        hasDominantRevalidationSuggestion: false,
      }),
    ).toEqual(["takeoff-launch"]);
  });

  it("hides competing takeoff actions when clarification is dominant", () => {
    expect(
      getAffaireHubHiddenPilotageExceptionIds({
        dominantIntent: "list_hypotheses",
        hasDominantClarificationSuggestion: true,
        hasDominantRevalidationSuggestion: false,
      }),
    ).toEqual(["register-clarify", "register-open", "takeoff-launch"]);
  });

  it("hides competing takeoff actions when revalidation is dominant", () => {
    expect(
      getAffaireHubHiddenPilotageExceptionIds({
        dominantIntent: "list_hypotheses",
        hasDominantClarificationSuggestion: false,
        hasDominantRevalidationSuggestion: true,
      }),
    ).toEqual(["register-revalidation", "register-open", "takeoff-launch"]);
  });
});

describe("shouldHideAffaireHubTakeoffLaunchAction", () => {
  it("hides the plans launch CTA when hybrid continuation is dominant", () => {
    expect(
      shouldHideAffaireHubTakeoffLaunchAction({
        dominantIntent: "continue_hybrid",
        hasDominantClarificationSuggestion: false,
        hasDominantRevalidationSuggestion: false,
      }),
    ).toBe(true);
  });
});

describe("getAffaireHubIntakeWorkspacePresentation", () => {

  it("still hides write actions in read-only review mode", () => {
    expect(
      getAffaireHubIntakeWorkspacePresentation({
        dominantIntent: "generate_structure",
        isReadOnlyReview: true,
      }),
    ).toMatchObject({
      showBridgeDpgfImport: false,
    });
  });
});
