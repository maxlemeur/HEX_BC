import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CockpitSuggestion } from "@/lib/cockpit/suggestions";

const { mockRouterRefresh, reclassifyAffaireDocumentMock, setAffaireDocumentAsPrimaryMock } = vi.hoisted(() => ({
  mockRouterRefresh: vi.fn(),
  reclassifyAffaireDocumentMock: vi.fn(),
  setAffaireDocumentAsPrimaryMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: mockRouterRefresh,
  }),
}));

vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  reclassifyAffaireDocument: reclassifyAffaireDocumentMock,
  setAffaireDocumentAsPrimary: setAffaireDocumentAsPrimaryMock,
}));

import { AffaireFlowHierarchyPanel } from "./AffaireFlowHierarchyPanel";

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.restoreAllMocks();
  mockRouterRefresh.mockReset();
  reclassifyAffaireDocumentMock.mockReset();
  reclassifyAffaireDocumentMock.mockResolvedValue({ ok: true });
  setAffaireDocumentAsPrimaryMock.mockReset();
  setAffaireDocumentAsPrimaryMock.mockResolvedValue({ ok: true, documentPriority: "primary" });
});

function buildSuggestion(input: Partial<CockpitSuggestion> & Pick<CockpitSuggestion, "actionId" | "label" | "intent" | "preview" | "target">): CockpitSuggestion {
  return {
    requiresConfirmation: false,
    confirmTone: "info",
    priority: 100,
    isPinned: false,
    isHidden: false,
    ...input,
  };
}

describe("AffaireFlowHierarchyPanel", () => {
  it("renders a dedicated upload card for a newly created affaire and opens intake upload", () => {
    const dispatchEventSpy = vi.spyOn(document, "dispatchEvent");

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-empty"
        currentVersion={null}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [],
          missingPieces: [],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getByText("Affaire neuve")).toBeInTheDocument();
    expect(screen.getByText("Prochaine etape")).toBeInTheDocument();
    expect(screen.queryByText("Deposez les pieces pour lancer l'analyse")).not.toBeInTheDocument();
    expect(screen.queryByText("CCTP, DPGF, plans, courriers.")).not.toBeInTheDocument();
    expect(screen.getByText("Deposez vos pieces ici")).toBeInTheDocument();
    expect(screen.getByText("Selectionner les fichiers")).toBeInTheDocument();
    expect(screen.queryByText("Blocages a traiter")).not.toBeInTheDocument();
    expect(screen.queryByText("Outils utiles si besoin")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deposer les pieces pour lancer l'analyse" }));

    expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
    const event = dispatchEventSpy.mock.calls[0]?.[0] as CustomEvent<{
      projectId: string;
      actionId: string;
      surfaceId: string;
      triggerFilePicker?: boolean;
    }>;
    expect(event.type).toBe("cockpit-open-surface");
    expect(event.detail).toMatchObject({
      projectId: "project-empty",
      actionId: "flow-empty-upload",
      surfaceId: "intake-upload",
      triggerFilePicker: true,
    });
  });

  it("surfaces the next action, blockers, optional aids and legacy fallback", () => {
    const dispatchEventSpy = vi.spyOn(document, "dispatchEvent");
    const addMissingPieces = buildSuggestion({
      actionId: "add-missing-pieces",
      label: "Ajouter 2 pieces manquantes",
      intent: "add_missing_pieces",
      preview: "Completer le dossier avec les pieces critiques manquantes.",
      target: { kind: "open_surface", surfaceId: "intake-upload" },
      priority: 800,
    });
    const generateStructure = buildSuggestion({
      actionId: "generate-structure",
      label: "Ouvrir V0 IA",
      intent: "generate_structure",
      preview: "Preparer une structure IA si vous avez besoin d'un cadrage rapide.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-1/edit?openVersionZero=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-1"
        currentVersion={{
          id: "version-1",
          projectId: "project-1",
          versionNumber: 3,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-1",
          projectId: "project-1",
          hasConfirmedBrief: true,
          confirmedBriefId: "brief-1",
          isVersionEmpty: false,
          canGenerate: true,
          availableLots: [],
          activeDraft: null,
        }}
        takeoffEnabled
        plansSummary={{
          planSetCount: 2,
          planFileCount: 4,
          totalSizeBytes: 2048,
          hasLegacyFallback: true,
          defaultPlanSetId: "set-1",
          defaultPlanSetName: "Plans confirmes",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 4,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: {
            jobId: "job-1",
            status: "review_required",
            label: "Revue requise",
            reviewVersionId: "version-1",
            planSetId: "set-1",
            estimateVersionId: "version-1",
            createdAt: "2026-03-11T12:00:00.000Z",
          },
          coveragePercent: 90,
          exceptionCount: 1,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf",
              fileName: "dpgf-electricite.xlsx",
              detectedCategory: "dpgf",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [
            { code: "missing_plans", label: "Plans manquants", severity: "critical" },
            { code: "missing_cctp", label: "CCTP manquant", severity: "warning" },
          ],
        }}
        finishLineSummary={{
          versionId: "version-1",
          readyToSend: {
            status: "blocked",
            blockingFlags: [
              {
                key: "no_pdf_generated",
                severity: "blocking",
                count: 1,
                item_ids: ["version-1"],
                label: "PDF absent",
                description: "Le PDF doit etre genere avant envoi.",
              },
            ],
            warningFlags: [],
            checkedAt: "2026-03-11T12:00:00.000Z",
            stalePriceDays: 90,
            errorMessage: null,
          },
          readyToOrder: {
            status: "waiting",
            orderableLinesCount: 0,
            coveredLinesCount: 0,
            ambiguousLinesCount: 0,
            missingPriceLinesCount: 0,
            staleLinesCount: 0,
            errorMessage: null,
          },
        }}
        cockpitSuggestions={[addMissingPieces, generateStructure]}
      />,
    );

    expect(screen.getByText("Prochaine etape")).toBeInTheDocument();
    expect(screen.getByText("Dossier incomplet")).toBeInTheDocument();
    expect(screen.getByText("Pieces deja recues")).toBeInTheDocument();
    expect(screen.queryByText("Pieces manquantes au dossier")).not.toBeInTheDocument();
    expect(screen.getByText("Blocages a traiter")).toBeInTheDocument();
    expect(screen.getAllByText("dpgf-electricite.xlsx").length).toBeGreaterThan(1);
    expect(screen.getByText("Deja dans le dossier")).toBeInTheDocument();
    expect(screen.getByText("PLAN MANQUANT")).toBeInTheDocument();
    expect(screen.getByText("Critique")).toBeInTheDocument();
    expect(screen.getByText("Attention")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter DPGF" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter Plans" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter CCTP" })).toBeInTheDocument();
    expect(screen.queryByText("Action attendue : ajouter les pieces manquantes")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter les pieces manquantes" })).not.toBeInTheDocument();
    expect(screen.queryByText("Triage termine")).not.toBeInTheDocument();
    expect(screen.getByText("1 ecart majeur sur les metres")).toBeInTheDocument();
    expect(screen.getByText("Outils utiles si besoin")).toBeInTheDocument();
    expect(screen.getByText("Reprise legacy")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ouvrir le fallback legacy" }),
    ).toHaveAttribute("href", "/dashboard/estimates/version-1/takeoff");

    fireEvent.click(screen.getByRole("button", { name: "Ajouter Plans" }));

    expect(dispatchEventSpy).toHaveBeenCalledTimes(1);
    const event = dispatchEventSpy.mock.calls[0]?.[0] as CustomEvent<{
      projectId: string;
      actionId: string;
      surfaceId: string;
      triggerFilePicker?: boolean;
    }>;
    expect(event.type).toBe("cockpit-open-surface");
    expect(event.detail).toMatchObject({
      projectId: "project-1",
      actionId: "flow-empty-upload",
      surfaceId: "intake-upload",
      triggerFilePicker: true,
    });
  });

  it("falls back to a simple affair-first action and hides unused sections", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-2"
        currentVersion={{
          id: "version-2",
          projectId: "project-2",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={{
          planSetCount: 1,
          planFileCount: 2,
          totalSizeBytes: 1024,
          hasLegacyFallback: false,
          defaultPlanSetId: "set-2",
          defaultPlanSetName: "Plans affaire",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 2,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: null,
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Ouvrir les plans" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir les plans" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-2/plans",
    );
    expect(screen.queryByText("Blocages a traiter")).not.toBeInTheDocument();
    expect(screen.queryByText("Outils utiles si besoin")).not.toBeInTheDocument();
    expect(screen.queryByText("Reprise legacy")).not.toBeInTheDocument();
  });

  it("returns to the compact next-step panel as soon as documents exist", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-2"
        currentVersion={{
          id: "version-2",
          projectId: "project-2",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={{
          planSetCount: 1,
          planFileCount: 2,
          totalSizeBytes: 1024,
          hasLegacyFallback: false,
          defaultPlanSetId: "set-2",
          defaultPlanSetName: "Plans affaire",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 2,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: null,
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-1",
              fileName: "cctp.pdf",
              detectedCategory: "cctp",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(
      screen.queryByText("Deposez vos pieces ici")
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ouvrir les plans" })).toBeInTheDocument();
  });

  it("does not enter review mode for low-confidence documents already persisted as classified", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-persisted-classified"
        currentVersion={{
          id: "version-persisted-classified",
          projectId: "project-persisted-classified",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={{
          planSetCount: 1,
          planFileCount: 2,
          totalSizeBytes: 1024,
          hasLegacyFallback: false,
          defaultPlanSetId: "set-persisted-classified",
          defaultPlanSetName: "Plans affaire",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 2,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: null,
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-plans-classified",
              fileName: "plans-classe.pdf",
              detectedCategory: "plans",
              classificationStatus: "classified",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Faible confiance initiale"],
            },
          ],
          missingPieces: [],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.queryByText("Documents a confirmer")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ouvrir les plans" })).toBeInTheDocument();
  });

  it("shows a result card asking to confirm the brief when the dossier is exploitable", () => {
    const onExecuteSuggestion = vi.fn();
    const confirmBrief = buildSuggestion({
      actionId: "confirm-brief",
      label: "Confirmer le brief affaire",
      intent: "confirm_brief",
      preview: "Valider le cadrage du dossier pour debloquer la suite du chiffrage assiste.",
      target: { kind: "open_surface", surfaceId: "brief-confirm" },
      requiresConfirmation: true,
      priority: 750,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-brief"
        currentVersion={{
          id: "version-brief",
          projectId: "project-brief",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf",
              fileName: "dpgf.xlsx",
              detectedCategory: "dpgf",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-plans",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "a_confirmer",
            summary: "Consultation electricite avec plans et DPGF recus.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts", "Courants faibles"],
            lots: ["Electricite", "SSI"],
            receivedPieces: ["DPGF", "Plans", "CCTP"],
            assumptions: ["Tarifs a confirmer."],
            vigilancePoints: ["Verifier la variante SSI en option."],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: null,
          },
        }}
        finishLineSummary={null}
        cockpitSuggestions={[confirmBrief]}
        onExecuteSuggestion={onExecuteSuggestion}
      />,
    );

    expect(screen.getAllByText("Dossier exploitable").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Les pieces critiques sont presentes. Confirmez le cadrage metier avant de chiffrer.").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("DPGF detecte")).toBeInTheDocument();
    expect(screen.getByText("Plans detectes")).toBeInTheDocument();
    expect(screen.getByText("Chiffrage CFO/CFA d'un batiment tertiaire.")).toBeInTheDocument();
    expect(screen.getByText("Lots: Electricite, SSI")).toBeInTheDocument();
    expect(screen.getByText("Point de vigilance: Verifier la variante SSI en option.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirmer le brief affaire" }));
    expect(onExecuteSuggestion).toHaveBeenCalledWith(confirmBrief);
  });

  it("infers the brief state from the intake brief draft even when no cockpit suggestion is provided", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-brief-fallback"
        currentVersion={{
          id: "version-brief-fallback",
          projectId: "project-brief-fallback",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf",
              fileName: "dpgf.xlsx",
              detectedCategory: "dpgf",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-plans",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "a_confirmer",
            summary: "Consultation electricite avec plans et DPGF recus.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts", "Courants faibles"],
            lots: ["Electricite", "SSI"],
            receivedPieces: ["DPGF", "Plans"],
            assumptions: ["Tarifs a confirmer."],
            vigilancePoints: ["Verifier la variante SSI en option."],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: null,
          },
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getAllByText("Dossier exploitable").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Confirmer le brief" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-brief-fallback#brief",
    );
  });

  it("surfaces an explicit structure action once the brief is confirmed", () => {
    const onExecuteSuggestion = vi.fn();
    const generateStructure = buildSuggestion({
      actionId: "generate-structure",
      label: "Generer la structure du devis",
      intent: "generate_structure",
      preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-brief-confirmed/edit?openVersionZero=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-brief-confirmed"
        currentVersion={{
          id: "version-brief-confirmed",
          projectId: "project-brief-confirmed",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-brief-confirmed",
          projectId: "project-brief-confirmed",
          hasConfirmedBrief: true,
          confirmedBriefId: "brief-1",
          isVersionEmpty: true,
          canGenerate: true,
          availableLots: [],
          activeDraft: null,
        }}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf",
              fileName: "dpgf.xlsx",
              detectedCategory: "dpgf",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-plans",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "confirme",
            summary: "Consultation electricite avec plans et DPGF recus.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts", "Courants faibles"],
            lots: ["Electricite", "SSI"],
            receivedPieces: ["DPGF", "Plans"],
            assumptions: ["Tarifs a confirmer."],
            vigilancePoints: ["Verifier la variante SSI en option."],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        finishLineSummary={null}
        cockpitSuggestions={[generateStructure]}
        onExecuteSuggestion={onExecuteSuggestion}
      />,
    );

    expect(screen.getAllByText("Generer la structure du devis").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Structure a generer").length).toBeGreaterThan(0);
    expect(screen.getByText("Brief confirme")).toBeInTheDocument();
    expect(
      screen.getAllByText("Le brief est confirme. Generez la structure du devis pour lancer le chiffrage.").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Aide disponible")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generer la structure du devis" }));
    expect(onExecuteSuggestion).toHaveBeenCalledWith(generateStructure);
  });

  it("surfaces the intake evidence when a document must be reviewed and allows quick reclassification", async () => {
    const user = userEvent.setup();
    const onExecuteSuggestion = vi.fn();
    const reviewIntake = buildSuggestion({
      actionId: "review-intake",
      label: "Confirmer 1 piece a revoir",
      intent: "review_intake",
      preview: "Verifier les documents ambigus ou mal classes avant de poursuivre le cadrage du dossier.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-review?intakeFilter=a_revoir#intake",
      },
      priority: 850,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-review"
        currentVersion={{
          id: "version-review",
          projectId: "project-review",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-review",
              fileName: "piece-inconnue.pdf",
              detectedCategory: "a_classer",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[reviewIntake]}
        onExecuteSuggestion={onExecuteSuggestion}
      />,
    );

    expect(screen.getAllByText("piece-inconnue.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("TIMAX hesite entre")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pourquoi TIMAX hesite" })).toBeInTheDocument();
    expect(
      screen.queryByText(
        "TIMAX hesite car le document ne contient pas assez d'indices pour trancher automatiquement."
      )
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Action attendue : confirmer la categorie")).not.toBeInTheDocument();
    expect(screen.getByText("Plans")).toBeInTheDocument();
    expect(screen.getByText("CCTP")).toBeInTheDocument();
    expect(screen.getByText("Annexes")).toBeInTheDocument();
    expect(
      screen.queryByText("La piece integrera le centre plans et pourra nourrir le metre.")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("A verifier (42%)")).not.toBeInTheDocument();
    expect(screen.queryByText("Classification a confirmer")).not.toBeInTheDocument();
    expect(screen.queryByText("Piece a confirmer")).not.toBeInTheDocument();
    expect(screen.queryByText("Detail de la piece active a confirmer")).not.toBeInTheDocument();
    expect(screen.queryByText("1 document a revoir dans le dossier.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter des fichiers" })).not.toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: /Plans/i }));

    expect(
      screen.getByText("La piece integrera le centre plans et pourra nourrir le metre.")
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pourquoi TIMAX hesite" }));

    expect(
      screen.getByText(
        "TIMAX hesite car le document ne contient pas assez d'indices pour trancher automatiquement."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("PDF recu")).toBeInTheDocument();
    expect(screen.getByText("42% de confiance")).toBeInTheDocument();
    expect(screen.getByText("Aucune categorie certaine")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Plans/i }));

    expect(reclassifyAffaireDocumentMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirmer la categorie" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirmer la categorie" }));

    expect(reclassifyAffaireDocumentMock).toHaveBeenCalledWith({
      projectId: "project-review",
      documentId: "doc-review",
      category: "plans",
    });
    await waitFor(() => {
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    });
  });

  it("prioritises review over missing pieces when both states coexist", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-review-missing"
        currentVersion={{
          id: "version-review-missing",
          projectId: "project-review-missing",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-review-missing",
              fileName: "piece-inconnue.pdf",
              detectedCategory: "a_classer",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
          ],
          missingPieces: [
            { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
          ],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "review-intake",
            label: "Confirmer 1 piece a revoir",
            intent: "review_intake",
            preview: "Verifier les documents ambigus ou mal classes avant de poursuivre le cadrage du dossier.",
            target: {
              kind: "navigate",
              href: "/dashboard/affaires/project-review-missing?intakeFilter=a_revoir#intake",
            },
            priority: 850,
          }),
          buildSuggestion({
            actionId: "add-missing-pieces",
            label: "Ajouter 2 pieces manquantes",
            intent: "add_missing_pieces",
            preview: "Completer le dossier avec les pieces manquantes detectees pendant l'intake.",
            target: { kind: "open_surface", surfaceId: "intake-upload" },
            priority: 800,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Documents a confirmer")).toBeInTheDocument();
    expect(screen.getByText("TIMAX hesite entre")).toBeInTheDocument();
    expect(screen.queryByText("Dossier incomplet")).not.toBeInTheDocument();
    expect(screen.getByText("DPGF NON DETECTE")).toBeInTheDocument();
    expect(screen.getByText("Critique")).toBeInTheDocument();
    expect(screen.queryByText("Blocages a traiter")).not.toBeInTheDocument();
  });

  it("uses the ambiguous document as the review source even when another document is already classified", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-cctp-review-missing"
        currentVersion={{
          id: "version-cctp-review-missing",
          projectId: "project-cctp-review-missing",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-cctp",
              fileName: "cctp-lot-electricite.docx",
              detectedCategory: "cctp",
              documentPriority: "primary",
              confidence: 0.97,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-review-mixed",
              fileName: "piece-inconnue.pdf",
              detectedCategory: "a_classer",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
          ],
          missingPieces: [
            { code: "missing_dpgf", label: "DPGF manquant", severity: "critical" },
          ],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "review-intake",
            label: "Confirmer 1 piece a revoir",
            intent: "review_intake",
            preview: "Verifier les documents ambigus ou mal classes avant de poursuivre le cadrage du dossier.",
            target: {
              kind: "navigate",
              href: "/dashboard/affaires/project-cctp-review-missing?intakeFilter=a_revoir#intake",
            },
            priority: 850,
          }),
          buildSuggestion({
            actionId: "add-missing-pieces",
            label: "Ajouter 1 piece manquante",
            intent: "add_missing_pieces",
            preview: "Completer le dossier avec les pieces manquantes detectees pendant l'intake.",
            target: { kind: "open_surface", surfaceId: "intake-upload" },
            priority: 800,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("piece-inconnue.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("CCTP PRINCIPAL")).toBeInTheDocument();
    expect(screen.getByText("cctp-lot-electricite.docx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CCTPComplementaire" })).toBeInTheDocument();
    expect(screen.getByText("DPGF NON DETECTE")).toBeInTheDocument();
  });

  it("explains that DPGF becomes complementary when a principal already exists", async () => {
    const user = userEvent.setup();

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-dpgf-secondary-review"
        currentVersion={{
          id: "version-dpgf-secondary-review",
          projectId: "project-dpgf-secondary-review",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf-primary",
              fileName: "dpgf-lot-a.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "primary",
              confidence: 0.98,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-review-dpgf",
              fileName: "piece-inconnue.xlsx",
              detectedCategory: "a_classer",
              confidence: 0.44,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
          ],
          missingPieces: [{ code: "missing_plans", label: "Plans manquants", severity: "critical" }],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "review-intake-dpgf-secondary",
            label: "Confirmer 1 piece a revoir",
            intent: "review_intake",
            preview: "Verifier les documents ambigus ou mal classes avant de poursuivre.",
            target: {
              kind: "navigate",
              href: "/dashboard/affaires/project-dpgf-secondary-review?intakeFilter=a_revoir#intake",
            },
            priority: 850,
          }),
        ]}
      />,
    );

    await user.hover(screen.getByRole("button", { name: /DPGF/i }));

    expect(
      screen.getByText("La piece sera ajoutee comme DPGF complementaire sans remplacer le principal.")
    ).toBeInTheDocument();
  });

  it("surfaces a no-primary alert when multiple DPGF exist without a primary reference", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-no-primary"
        currentVersion={{
          id: "version-no-primary",
          projectId: "project-no-primary",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf-a",
              fileName: "dpgf-a.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "secondary",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-dpgf-b",
              fileName: "dpgf-b.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "secondary",
              confidence: 0.98,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [
            { code: "missing_plans", label: "Plans manquants", severity: "critical" },
          ],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getByText("DPGF SANS PRINCIPAL")).toBeInTheDocument();
    expect(screen.getByText("2 DPGF")).toBeInTheDocument();
    expect(screen.getByText("Principal a definir")).toBeInTheDocument();
    expect(screen.getByText("Choisir le document principal")).toBeInTheDocument();
    expect(screen.getByText("Choix principal")).toBeInTheDocument();
    expect(screen.queryByText("Autres DPGF (2)")).not.toBeInTheDocument();
  });

  it("summarises additional review documents in the hero and lower panel", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-review-multi"
        currentVersion={{
          id: "version-review-multi",
          projectId: "project-review-multi",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf-primary",
              fileName: "dpgf-principal.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "primary",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-review-1",
              fileName: "piece-inconnue-1.pdf",
              detectedCategory: "a_classer",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
            {
              documentId: "doc-review-2",
              fileName: "piece-inconnue-2.docx",
              detectedCategory: "a_classer",
              confidence: 0.47,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
            {
              documentId: "doc-review-3",
              fileName: "piece-inconnue-3.docx",
              detectedCategory: "a_classer",
              confidence: 0.49,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
          ],
          missingPieces: [
            { code: "missing_plans", label: "Plans manquants", severity: "critical" },
          ],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getByText("Autres pieces a confirmer (2)")).toBeInTheDocument();
    expect(screen.getByText("Autres pieces a confirmer")).toBeInTheDocument();
    expect(screen.getByText("piece-inconnue-2.docx")).toBeInTheDocument();
    expect(screen.getByText("piece-inconnue-3.docx")).toBeInTheDocument();
    expect(screen.queryByText("Contexte deja classe")).not.toBeInTheDocument();
  });

  it("compresses crowded heroes with overflow summaries instead of listing every document", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-crowded"
        currentVersion={{
          id: "version-crowded",
          projectId: "project-crowded",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={null}
        takeoffEnabled
        plansSummary={null}
        intakeWorkspace={{
          documents: [
            {
              documentId: "doc-dpgf-primary",
              fileName: "dpgf-principal.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "primary",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-cctp-primary",
              fileName: "cctp-principal.docx",
              detectedCategory: "cctp",
              documentPriority: "primary",
              confidence: 0.98,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-bpu",
              fileName: "bpu-electricite.xlsx",
              detectedCategory: "bpu_dqe",
              confidence: 0.96,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-annexe",
              fileName: "annexe-variantes.pdf",
              detectedCategory: "annexes",
              confidence: 0.94,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-mail",
              fileName: "courrier-client.eml",
              detectedCategory: "emails",
              confidence: 0.92,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: [],
            },
            {
              documentId: "doc-review-active",
              fileName: "piece-inconnue-1.pdf",
              detectedCategory: "a_classer",
              confidence: 0.39,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
            {
              documentId: "doc-review-2",
              fileName: "piece-inconnue-2.docx",
              detectedCategory: "a_classer",
              confidence: 0.45,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
            {
              documentId: "doc-review-3",
              fileName: "piece-inconnue-3.png",
              detectedCategory: "a_classer",
              confidence: 0.51,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Classification a confirmer"],
            },
          ],
          missingPieces: [
            { code: "missing_plans", label: "Plans manquants", severity: "critical" },
          ],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getByText("Autres valides (3)")).toBeInTheDocument();
    expect(screen.getByText("Autres pieces a confirmer (2)")).toBeInTheDocument();
    expect(screen.getByText("Autres pieces a confirmer")).toBeInTheDocument();
    expect(screen.queryByText("Contexte deja classe")).not.toBeInTheDocument();
  });
});
