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
    expect(screen.getByRole("link", { name: "Continuer en manuel" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/new?projectId=project-empty",
    );
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

  it("prioritises documentary stabilisation over production aids and keeps the legacy fallback", () => {
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
    expect(screen.queryByText("Outils utiles si besoin")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ouvrir V0 IA" })).not.toBeInTheDocument();
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
    expect(screen.getByText("Outils utiles si besoin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuer en manuel" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-2/edit?entry=manual",
    );
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
    expect(screen.getByText("Dossier de consultation")).toBeInTheDocument();

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
    expect(screen.queryByText("Brief confirme")).not.toBeInTheDocument();
    expect(
      screen.getAllByText("Le brief est confirme. Generez la structure du devis pour lancer le chiffrage.").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Aide disponible")).not.toBeInTheDocument();
    expect(screen.getByText("Outils utiles si besoin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuer en manuel" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-brief-confirmed/edit?entry=manual",
    );
    expect(screen.queryByRole("link", { name: "Ouvrir V0 IA" })).not.toBeInTheDocument();
    expect(screen.queryByText("Dossier de consultation")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Generer la structure du devis" }));
    expect(onExecuteSuggestion).toHaveBeenCalledWith(generateStructure);
  });

  it("prioritises linked DPGF import as the base structure action", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-dpgf-base"
        dpgfSource={{
          importId: "import-1",
          filename: "dpgf-electricite.xlsx",
          sourceFormat: "xlsx",
          importStatus: "completed",
          mappingStatus: "validated",
          importedAt: "2026-03-11T12:00:00.000Z",
          mappingUpdatedAt: "2026-03-11T12:05:00.000Z",
          parseMode: "spreadsheet",
          rowCount: 42,
          mappedRowCount: 42,
        }}
        currentVersion={{
          id: "version-dpgf-base",
          projectId: "project-dpgf-base",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-dpgf-base",
          projectId: "project-dpgf-base",
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
              fileName: "dpgf-electricite.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "primary",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: ["Electricite"],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "confirme",
            summary: "Consultation avec DPGF principal valide.",
            projectObject: "Chiffrage CFO/CFA.",
            scope: ["Electricite"],
            lots: ["Electricite"],
            receivedPieces: ["DPGF"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111114",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        structureMode={{
          mode: "not_started",
          lineCount: 0,
          importedLineCount: 0,
          manualLineCount: 0,
          unsupportedLineCount: 0,
          hasImportableLinkedDpgfSource: true,
          canImportLinkedDpgfIntoCurrentStructure: false,
          linkedDpgfMappedRowCount: 42,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "generate-structure",
            label: "Generer la structure du devis",
            intent: "generate_structure",
            preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
            target: {
              kind: "navigate",
              href: "/dashboard/estimates/version-dpgf-base/edit?openVersionZero=1",
            },
            priority: 650,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Importer la DPGF")).toBeInTheDocument();
    expect(screen.getByText("Base DPGF")).toBeInTheDocument();
    expect(screen.getByText("Base DPGF prete a importer")).toBeInTheDocument();
    expect(screen.getByText("DPGF principal valide")).toBeInTheDocument();
    expect(screen.getByText("42 lignes importables")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importer la DPGF" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-dpgf-base/edit",
    );
    expect(screen.getByRole("link", { name: "Continuer en manuel" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-dpgf-base/edit?entry=manual",
    );
    expect(screen.queryByRole("button", { name: "Generer la structure du devis" })).not.toBeInTheDocument();
  });

  it("keeps the linked DPGF import CTA when mapped rows exist without a mapping record", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-dpgf-null-mapping"
        dpgfSource={{
          importId: "import-1",
          filename: "dpgf-electricite.xlsx",
          sourceFormat: "xlsx",
          importStatus: "completed",
          mappingStatus: null,
          importedAt: "2026-03-11T12:00:00.000Z",
          mappingUpdatedAt: null,
          parseMode: "spreadsheet",
          rowCount: 42,
          mappedRowCount: 42,
        }}
        currentVersion={{
          id: "version-dpgf-null-mapping",
          projectId: "project-dpgf-null-mapping",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-dpgf-null-mapping",
          projectId: "project-dpgf-null-mapping",
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
              fileName: "dpgf-electricite.xlsx",
              detectedCategory: "dpgf",
              documentPriority: "primary",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: ["Electricite"],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "confirme",
            summary: "Consultation avec DPGF principal valide.",
            projectObject: "Chiffrage CFO/CFA.",
            scope: ["Electricite"],
            lots: ["Electricite"],
            receivedPieces: ["DPGF"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111116",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        structureMode={{
          mode: "not_started",
          lineCount: 0,
          importedLineCount: 0,
          manualLineCount: 0,
          unsupportedLineCount: 0,
          hasImportableLinkedDpgfSource: true,
          canImportLinkedDpgfIntoCurrentStructure: false,
          linkedDpgfMappedRowCount: 42,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "generate-structure",
            label: "Generer la structure du devis",
            intent: "generate_structure",
            preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
            target: {
              kind: "navigate",
              href: "/dashboard/estimates/version-dpgf-null-mapping/edit?openVersionZero=1",
            },
            priority: 650,
          }),
        ]}
      />,
    );

    expect(screen.getByText("Importer la DPGF")).toBeInTheDocument();
    expect(screen.getByText("Base DPGF")).toBeInTheDocument();
    expect(screen.getByText("42 lignes importables")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importer la DPGF" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-dpgf-null-mapping/edit",
    );
    expect(screen.queryByRole("button", { name: "Generer la structure du devis" })).not.toBeInTheDocument();
  });

  it("makes a structure cleanup explicit when the visible mode needs an update", async () => {
    const user = userEvent.setup();

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-needs-update"
        currentVersion={{
          id: "version-needs-update",
          projectId: "project-needs-update",
          versionNumber: 2,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-needs-update",
          projectId: "project-needs-update",
          hasConfirmedBrief: true,
          confirmedBriefId: "brief-needs-update",
          isVersionEmpty: false,
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
              fileName: "dpgf-electricite.xlsx",
              detectedCategory: "dpgf",
              confidence: 0.99,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: ["Electricite"],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "confirme",
            summary: "Le brief est confirme, mais la structure doit etre reprise.",
            projectObject: "Chiffrage CFO/CFA.",
            scope: ["Electricite"],
            lots: ["Electricite"],
            receivedPieces: ["DPGF"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111115",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        structureMode={{
          mode: "needs_update",
          lineCount: 12,
          importedLineCount: 6,
          manualLineCount: 3,
          unsupportedLineCount: 3,
          hasImportableLinkedDpgfSource: false,
          canImportLinkedDpgfIntoCurrentStructure: false,
          linkedDpgfMappedRowCount: 0,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "generate-structure-needs-update",
            label: "Generer la structure du devis",
            intent: "generate_structure",
            preview: "Reprendre la structure a partir du brief confirme.",
            target: {
              kind: "navigate",
              href: "/dashboard/estimates/version-needs-update/edit?openVersionZero=1",
            },
            priority: 650,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Structure a remettre a jour").length).toBeGreaterThan(0);
    expect(screen.getByText("12 lignes deja saisies")).toBeInTheDocument();
    expect(screen.getByText("3 lignes a revoir")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Le devis contient deja une trame, mais certaines lignes doivent etre revues avant de poursuivre le chiffrage."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generer la structure du devis" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pourquoi Structure a remettre a jour" }));

    expect(
      screen.getByText(
        "Une partie de la structure existe deja, mais certaines lignes doivent encore etre revues avant de reprendre le chiffrage."
      )
    ).toBeInTheDocument();
  });

  it("explains the preliminary structure path from the brief and primary CCTP", () => {
    const onExecuteSuggestion = vi.fn();
    const preliminaryStructure = buildSuggestion({
      actionId: "open-structure-draft",
      label: "Ouvrir la structure preliminaire",
      intent: "generate_structure",
      preview:
        "Ouvrir une preview editable de structure a partir du brief confirme et des signaux documentaires deja arbitres.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-structure-draft/edit?openStructureDraft=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-structure-draft"
        currentVersion={{
          id: "version-structure-draft",
          projectId: "project-structure-draft",
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
              fileName: "cctp-principal.docx",
              detectedCategory: "cctp",
              classificationStatus: "classified",
              documentPriority: "primary",
              confidence: 0.94,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: ["Electricite", "SSI"],
                detectedVariants: [],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: {
            status: "confirme",
            summary: "Consultation electricite sans DPGF exploitable.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts", "Courants faibles"],
            lots: ["Electricite", "SSI"],
            receivedPieces: ["CCTP"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        finishLineSummary={null}
        cockpitSuggestions={[preliminaryStructure]}
        onExecuteSuggestion={onExecuteSuggestion}
      />,
    );

    expect(screen.getAllByText("Ouvrir la structure preliminaire").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Structure preliminaire").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(
        "Le brief est confirme. Ouvrez une trame editable du devis a partir du brief et du CCTP principal, sans import DPGF obligatoire.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("CCTP principal detecte")).toBeInTheDocument();
    expect(screen.getByText("Sans import DPGF obligatoire")).toBeInTheDocument();
    expect(screen.getAllByText("cctp-principal.docx").length).toBeGreaterThan(0);
    expect(screen.getByText("Lots CCTP: Electricite, SSI")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuer en manuel" })).toHaveAttribute(
      "href",
      "/dashboard/estimates/version-structure-draft/edit?entry=manual",
    );

    fireEvent.click(screen.getByRole("button", { name: "Ouvrir la structure preliminaire" }));
    expect(onExecuteSuggestion).toHaveBeenCalledWith(preliminaryStructure);
  });

  it("makes hybrid continuation the dominant structure action without keeping a competing manual CTA", () => {
    const onExecuteSuggestion = vi.fn();
    const continueHybrid = buildSuggestion({
      actionId: "continue-hybrid",
      label: "Passer le devis en hybride",
      intent: "continue_hybrid",
      preview:
        "Conserver les lignes deja saisies et importer explicitement 18 lignes DPGF dans la meme version.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-hybrid/edit",
      },
      priority: 645,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-hybrid"
        currentVersion={{
          id: "version-hybrid",
          projectId: "project-hybrid",
          versionNumber: 2,
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
            summary: "Affaire deja structuree en manuel.",
            projectObject: "Restructuration tertiaire.",
            scope: ["Electricite"],
            lots: ["Electricite"],
            receivedPieces: ["Plans", "DPGF"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111113",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        structureMode={{
          mode: "manual",
          lineCount: 4,
          importedLineCount: 0,
          manualLineCount: 4,
          unsupportedLineCount: 0,
          hasImportableLinkedDpgfSource: true,
          canImportLinkedDpgfIntoCurrentStructure: true,
          linkedDpgfMappedRowCount: 18,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[continueHybrid]}
        onExecuteSuggestion={onExecuteSuggestion}
      />,
    );

    expect(screen.getAllByText("Passer le devis en hybride").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Mode hybride").length).toBeGreaterThan(0);
    expect(screen.getByText("Passage en hybride recommande")).toBeInTheDocument();
    expect(screen.getByText("Mode manuel actif")).toBeInTheDocument();
    expect(screen.getByText("4 lignes manuelles deja saisies")).toBeInTheDocument();
    expect(screen.getByText("18 lignes DPGF importables")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continuer en manuel" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Passer le devis en hybride" }));
    expect(onExecuteSuggestion).toHaveBeenCalledWith(continueHybrid);
  });

  it("falls back to brief-only preliminary structure copy when the primary CCTP has no defendable lots", () => {
    const preliminaryStructure = buildSuggestion({
      actionId: "open-structure-draft",
      label: "Ouvrir la structure preliminaire",
      intent: "generate_structure",
      preview: "Ouvrir une preview editable de structure a partir du brief confirme.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-structure-draft-limited/edit?openStructureDraft=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-structure-draft-limited"
        currentVersion={{
          id: "version-structure-draft-limited",
          projectId: "project-structure-draft-limited",
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
              documentId: "doc-cctp-limited",
              fileName: "cctp-principal.docx",
              detectedCategory: "cctp",
              classificationStatus: "classified",
              documentPriority: "primary",
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
          ],
          missingPieces: [],
          briefDraft: {
            status: "confirme",
            summary: "Consultation electricite sans DPGF exploitable.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts", "Courants faibles"],
            lots: ["Electricite", "SSI"],
            receivedPieces: ["CCTP"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111112",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        finishLineSummary={null}
        cockpitSuggestions={[preliminaryStructure]}
      />,
    );

    expect(
      screen.getAllByText(
        "Le brief confirme permet d'ouvrir une trame editable du devis, sans import DPGF obligatoire.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("CCTP principal detecte")).not.toBeInTheDocument();
    expect(screen.queryByText(/Lots CCTP:/)).not.toBeInTheDocument();
  });

  it("keeps the structure wording under reservations when critical register documents remain open", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-brief-confirmed-reserved"
        currentVersion={{
          id: "version-brief-confirmed-reserved",
          projectId: "project-brief-confirmed-reserved",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-brief-confirmed-reserved",
          projectId: "project-brief-confirmed-reserved",
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
        registerSummary={{
          openQuestionsCount: 2,
          criticalOpenCount: 1,
          nonCriticalOpenCount: 1,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 1,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[
          buildSuggestion({
            actionId: "generate-structure-reserved",
            label: "Generer la structure du devis",
            intent: "generate_structure",
            preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
            target: {
              kind: "navigate",
              href: "/dashboard/estimates/version-brief-confirmed-reserved/edit?openVersionZero=1",
            },
          }),
        ]}
      />,
    );

    expect(
      screen.getByText(
        "Le brief est confirme. Generez la structure du devis, mais le dossier reste incomplet."
      )
    ).toBeInTheDocument();
    expect(screen.getByText("Base devis disponible sous reserves")).toBeInTheDocument();
    expect(screen.queryByText("Base devis prete")).not.toBeInTheDocument();
  });

  it("softens missing-piece guidance when canonical readiness already allows continuation", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-missing-reserved"
        hubReadiness={{
          status: "ready_with_reservations",
          workingBasis: "established",
          allowsContinuation: true,
          briefStatus: "confirme",
          drivers: [
            {
              code: "critical_missing_piece",
              source: "intake",
              severity: "critical",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 1,
            confirmedCriticalMissingPiecesCount: 1,
          },
          register: {
            criticalOpenCount: 1,
            clarifyWithClientCount: 0,
            continuedWithHypothesisCount: 0,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-missing-reserved",
          projectId: "project-missing-reserved",
          versionNumber: 2,
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
          ],
          missingPieces: [{ code: "missing_plans", label: "Plans manquants", severity: "critical" }],
          briefDraft: {
            status: "confirme",
            summary: "Brief confirme.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts"],
            lots: ["Electricite"],
            receivedPieces: ["DPGF"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: ["Plans"],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        registerSummary={{
          openQuestionsCount: 1,
          criticalOpenCount: 1,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 1,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.queryByText(/avant de lancer le metre/i)).not.toBeInTheDocument();
    expect(screen.getByText("Avancer sous reserves")).toBeInTheDocument();
  });

  it("keeps the brief hero aligned with canonical not-ready status", () => {
    const confirmBrief = buildSuggestion({
      actionId: "confirm-brief-not-ready",
      label: "Confirmer le brief affaire",
      intent: "confirm_brief",
      preview: "Valider le cadrage du dossier avant de debloquer la suite du chiffrage assiste.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-brief-not-ready#brief",
      },
      priority: 700,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-brief-not-ready"
        hubReadiness={{
          status: "not_ready",
          workingBasis: "insufficient",
          allowsContinuation: false,
          briefStatus: "a_confirmer",
          drivers: [
            {
              code: "brief_to_confirm",
              source: "brief",
              severity: "critical",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 0,
            continuedWithHypothesisCount: 0,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-brief-not-ready",
          projectId: "project-brief-not-ready",
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
            summary: "Brief a confirmer.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts"],
            lots: ["Electricite"],
            receivedPieces: ["DPGF", "Plans"],
            assumptions: [],
            vigilancePoints: ["Verifier les hypotheses de phasage."],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: null,
          },
        }}
        finishLineSummary={null}
        cockpitSuggestions={[confirmBrief]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Base de travail insuffisante" })).toBeInTheDocument();
    expect(screen.getAllByText("Brief a confirmer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Dossier exploitable")).not.toBeInTheDocument();
    expect(screen.getByText("Base insuffisante")).toBeInTheDocument();
  });

  it("shows the canonical hub readiness even when the local next step looks ready", () => {
    const analyzePlans = buildSuggestion({
      actionId: "analyze-plans",
      label: "Lancer le metre",
      intent: "analyze_plans",
      preview: "Analyser les plans pour extraire les quantites.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-hub-readiness/plans",
      },
      priority: 600,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-hub-readiness"
        hubReadiness={{
          status: "ready_with_reservations",
          workingBasis: "established",
          allowsContinuation: true,
          briefStatus: "confirme",
          drivers: [
            {
              code: "warning_missing_piece",
              source: "register",
              severity: "warning",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 0,
            continuedWithHypothesisCount: 1,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-hub-readiness",
          projectId: "project-hub-readiness",
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
          briefDraft: null,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[analyzePlans]}
      />,
    );

    expect(screen.getByRole("button", { name: "Lancer le metre" })).toBeInTheDocument();
    expect(screen.getByText("Analyse sous reserves")).toBeInTheDocument();
    expect(screen.getByText("Avancer sous reserves")).toBeInTheDocument();
    expect(screen.queryByText("Base de travail prete")).not.toBeInTheDocument();
    expect(screen.getByText("Base devis disponible sous reserves")).toBeInTheDocument();
    expect(screen.queryByText("Base devis prete")).not.toBeInTheDocument();
  });

  it("prioritises client clarification over takeoff continuation when both are available", () => {
    const clarificationSuggestion = buildSuggestion({
      actionId: "list-clarifications",
      label: "Traiter 1 clarification client",
      intent: "list_hypotheses",
      preview: "Des clarifications critiques restent a porter vers le client avant envoi.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-clarify?registerStatus=clarify_with_client#register",
      },
      priority: 720,
    });
    const analyzePlans = buildSuggestion({
      actionId: "analyze-plans",
      label: "Lancer le metre",
      intent: "analyze_plans",
      preview: "Analyser les plans pour extraire les quantites.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-clarify/plans",
      },
      priority: 600,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-clarify"
        hubReadiness={{
          status: "ready_with_reservations",
          workingBasis: "established",
          allowsContinuation: true,
          briefStatus: "confirme",
          drivers: [
            {
              code: "client_clarification",
              source: "register",
              severity: "critical",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 1,
            continuedWithHypothesisCount: 0,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-clarify",
          projectId: "project-clarify",
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
          briefDraft: null,
        }}
        registerSummary={{
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 1,
          criticalClarifyWithClientCount: 1,
          openAssumptionCount: 0,
          openMissingPieceCount: 0,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[clarificationSuggestion, analyzePlans]}
      />,
    );

    expect(screen.getByRole("button", { name: "Traiter 1 clarification client" })).toBeInTheDocument();
    expect(screen.getByText("Clarification client requise")).toBeInTheDocument();
    expect(screen.getByText("1 clarification client ouverte")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lancer le metre" })).not.toBeInTheDocument();
  });

  it("keeps the clarification CTA as the only visible next step when client clarifications remain", () => {
    const clarificationSuggestion = buildSuggestion({
      actionId: "list-clarifications",
      label: "Traiter 1 clarification client",
      intent: "list_hypotheses",
      preview: "Des clarifications critiques restent a porter vers le client avant envoi.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-clarify-only?registerStatus=clarify_with_client#register",
      },
      priority: 720,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-clarify-only"
        hubReadiness={{
          status: "ready_with_reservations",
          workingBasis: "established",
          allowsContinuation: true,
          briefStatus: "confirme",
          drivers: [
            {
              code: "client_clarification",
              source: "register",
              severity: "critical",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 1,
            continuedWithHypothesisCount: 0,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-clarify-only",
          projectId: "project-clarify-only",
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
          defaultPlanSetId: "set-clarify",
          defaultPlanSetName: "Plans dossier",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 2,
          defaultPlanSetUpdatedAt: "2026-03-11T12:00:00.000Z",
          latestJob: null,
          coveragePercent: null,
          exceptionCount: 0,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
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
          briefDraft: null,
        }}
        registerSummary={{
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 1,
          criticalClarifyWithClientCount: 1,
          openAssumptionCount: 0,
          openMissingPieceCount: 0,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[clarificationSuggestion]}
      />,
    );

    expect(screen.getByRole("button", { name: "Traiter 1 clarification client" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Ouvrir les plans" })).not.toBeInTheDocument();
  });

  it("prioritises revalidation when the canonical hub driver requires it", () => {
    const revalidationSuggestion = buildSuggestion({
      actionId: "review-revalidation",
      label: "Relancer 1 revalidation critique",
      intent: "list_hypotheses",
      preview: "Un additif ou une piece critique recue tardivement impose une revue ciblee: Revue documentaire + Readiness pre-remise.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-revalidation?registerRevalidation=required#register",
      },
      priority: 735,
    });
    const generateStructure = buildSuggestion({
      actionId: "generate-structure",
      label: "Generer la structure du devis",
      intent: "generate_structure",
      preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-revalidation/edit?openVersionZero=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-revalidation"
        hubReadiness={{
          status: "ready_with_reservations",
          workingBasis: "established",
          allowsContinuation: true,
          briefStatus: "confirme",
          drivers: [
            {
              code: "revalidation_required",
              source: "register",
              severity: "critical",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 0,
            continuedWithHypothesisCount: 0,
            revalidationRequiredCount: 1,
            criticalRevalidationRequiredCount: 1,
          },
        }}
        currentVersion={{
          id: "version-revalidation",
          projectId: "project-revalidation",
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
          briefDraft: null,
        }}
        registerSummary={{
          openQuestionsCount: 0,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 0,
          clarifyWithClientCount: 0,
          openAssumptionCount: 0,
          openMissingPieceCount: 0,
          revalidationRequired: true,
          revalidationRequiredCount: 1,
          criticalRevalidationRequiredCount: 1,
          revalidationImpactedStages: ["document_review", "submission_readiness"],
        }}
        finishLineSummary={null}
        cockpitSuggestions={[revalidationSuggestion, generateStructure]}
      />,
    );

    expect(screen.getByRole("button", { name: "Relancer 1 revalidation critique" })).toBeInTheDocument();
    expect(screen.getByText("Revalidation requise")).toBeInTheDocument();
    expect(screen.getByText("1 revalidation requise")).toBeInTheDocument();
    expect(screen.getByText("Revue documentaire")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generer la structure du devis" })).not.toBeInTheDocument();
  });

  it("keeps continuation hypotheses explicit in the dominant structure card", () => {
    const generateStructure = buildSuggestion({
      actionId: "generate-structure",
      label: "Generer la structure du devis",
      intent: "generate_structure",
      preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-hypothesis/edit?openVersionZero=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-hypothesis"
        hubReadiness={{
          status: "ready_with_reservations",
          workingBasis: "established",
          allowsContinuation: true,
          briefStatus: "confirme",
          drivers: [
            {
              code: "continued_with_hypothesis",
              source: "register",
              severity: "warning",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 0,
            continuedWithHypothesisCount: 1,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-hypothesis",
          projectId: "project-hypothesis",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-hypothesis",
          projectId: "project-hypothesis",
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
            summary: "Brief confirme.",
            projectObject: "Chiffrage CFO/CFA d'un batiment tertiaire.",
            scope: ["Courants forts"],
            lots: ["Electricite"],
            receivedPieces: ["DPGF", "Plans"],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "11111111-1111-4111-8111-111111111111",
            lastGeneratedAt: "2026-03-11T12:00:00.000Z",
            confirmedAt: "2026-03-11T13:00:00.000Z",
          },
        }}
        registerSummary={{
          openQuestionsCount: 1,
          criticalOpenCount: 0,
          nonCriticalOpenCount: 1,
          clarifyWithClientCount: 0,
          openAssumptionCount: 1,
          openMissingPieceCount: 0,
          continuedWithHypothesisCount: 1,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[generateStructure]}
      />,
    );

    expect(screen.getByText("1 hypothese de continuation active")).toBeInTheDocument();
    expect(
      screen.getByText("Le brief est confirme. Generez la structure du devis en gardant la trace d'hypothese active."),
    ).toBeInTheDocument();
  });

  it("blocks plan launch CTAs when canonical readiness is not ready", () => {
    const analyzePlans = buildSuggestion({
      actionId: "analyze-plans-not-ready",
      label: "Lancer le metre",
      intent: "analyze_plans",
      preview: "Analyser les plans pour extraire les quantites.",
      target: {
        kind: "navigate",
        href: "/dashboard/affaires/project-not-ready/plans",
      },
      priority: 600,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-not-ready"
        hubReadiness={{
          status: "not_ready",
          workingBasis: "insufficient",
          allowsContinuation: false,
          briefStatus: "missing",
          drivers: [
            {
              code: "brief_missing",
              source: "brief",
              severity: "critical",
              count: 1,
            },
          ],
          intake: {
            reviewDocumentsCount: 0,
            confirmedMissingPiecesCount: 0,
            confirmedCriticalMissingPiecesCount: 0,
          },
          register: {
            criticalOpenCount: 0,
            clarifyWithClientCount: 0,
            continuedWithHypothesisCount: 0,
            revalidationRequiredCount: 0,
            criticalRevalidationRequiredCount: 0,
          },
        }}
        currentVersion={{
          id: "version-not-ready",
          projectId: "project-not-ready",
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
          briefDraft: null,
        }}
        finishLineSummary={null}
        cockpitSuggestions={[analyzePlans]}
      />,
    );

    expect(screen.queryByRole("button", { name: "Lancer le metre" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Confirmer le brief" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-not-ready#brief",
    );
    expect(screen.getByText("Base insuffisante")).toBeInTheDocument();
  });

  it("prefers canonical submission readiness over the legacy ready-to-send alias", () => {
    render(
      <AffaireFlowHierarchyPanel
        projectId="project-finish-line-canonical"
        currentVersion={{
          id: "version-finish-line-canonical",
          projectId: "project-finish-line-canonical",
          versionNumber: 2,
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
          ],
          missingPieces: [],
          briefDraft: null,
        }}
        finishLineSummary={{
          versionId: "version-finish-line-canonical",
          submissionReadiness: {
            status: "warning",
            blockers: [],
            alerts: [
              {
                key: "supplier_price_outdated",
                severity: "warning",
                count: 2,
                item_ids: ["line-1", "line-2"],
                label: "2 prix a verifier avant envoi",
                description: "Les prix doivent etre rafraichis avant validation finale.",
                category: "estimate_quality",
              },
            ],
            groups: [],
            checkedAt: "2026-03-11T12:00:00.000Z",
            stalePriceDays: 45,
            errorMessage: null,
          },
          readyToSend: {
            status: "blocked",
            blockingFlags: [
              {
                key: "no_pdf_generated",
                severity: "blocking",
                count: 1,
                item_ids: ["version-finish-line-canonical"],
                label: "PDF absent",
                description: "Le PDF doit etre genere avant envoi.",
                category: "pdf",
              },
            ],
            warningFlags: [],
            checkedAt: "2026-03-11T12:00:00.000Z",
            stalePriceDays: 45,
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
        cockpitSuggestions={[]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Verifier la sortie devis" })).toBeInTheDocument();
    expect(screen.getByText("Sortie a finaliser")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir la sortie devis" })).toHaveAttribute(
      "href",
      "#finish-line-output",
    );
    expect(screen.queryByText("PDF absent")).not.toBeInTheDocument();
  });

  it("keeps the structure hero in review mode when a V0 draft already exists", async () => {
    const user = userEvent.setup();
    const reviewStructure = buildSuggestion({
      actionId: "generate-structure",
      label: "Revoir la structure du devis",
      intent: "generate_structure",
      preview: "Reprendre la revue de la V0 IA avant materialisation dans le devis.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-structure-review/edit?openVersionZero=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-structure-review"
        currentVersion={{
          id: "version-structure-review",
          projectId: "project-structure-review",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-structure-review",
          projectId: "project-structure-review",
          hasConfirmedBrief: true,
          confirmedBriefId: "brief-1",
          isVersionEmpty: true,
          canGenerate: true,
          availableLots: ["Electricite"],
          activeDraft: {
            id: "draft-1",
            status: "ia_a_revoir",
            createdAt: "2026-03-11T13:00:00.000Z",
            materializedAt: null,
            selectedLots: ["Electricite"],
            counts: {
              lots: 1,
              lines: 12,
              pending: 4,
              accepted: 6,
              edited: 2,
              rejected: 0,
              missingLots: 0,
              partialLots: 0,
              lowConfidenceLines: 1,
            },
            summaryText: "V0 IA prete pour revue.",
            state: "active",
          },
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
            lots: ["Electricite"],
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
        cockpitSuggestions={[reviewStructure]}
      />,
    );

    expect(screen.getAllByText("Revoir la structure du devis").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Structure a reprendre").length).toBeGreaterThan(0);
    expect(screen.queryByText("Structure a generer")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Le brief est confirme. Reprenez la structure du devis avant de materialiser le chiffrage."
      ).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Pourquoi Structure a reprendre" }));

    expect(
      screen.getByText(
        "Le brief est confirme. La prochaine action est de reprendre la structure du devis."
      )
    ).toBeInTheDocument();
  });

  it("keeps the lower panel only when the hero compresses additional validated context", () => {
    const generateStructure = buildSuggestion({
      actionId: "generate-structure-overflow",
      label: "Generer la structure du devis",
      intent: "generate_structure",
      preview: "Generer une V0 IA a partir du brief confirme et des lots detectes.",
      target: {
        kind: "navigate",
        href: "/dashboard/estimates/version-plans-ready/edit?openVersionZero=1",
      },
      priority: 650,
    });

    render(
      <AffaireFlowHierarchyPanel
        projectId="project-plans-ready"
        currentVersion={{
          id: "version-plans-ready",
          projectId: "project-plans-ready",
          versionNumber: 1,
          status: "draft",
          totalHtCents: 0,
          marginMultiplier: 1,
          marginPercent: 0,
          updatedAt: "2026-03-11T12:00:00.000Z",
        }}
        versionZeroSummary={{
          versionId: "version-plans-ready",
          projectId: "project-plans-ready",
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
            {
              documentId: "doc-cctp",
              fileName: "cctp.docx",
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
        cockpitSuggestions={[generateStructure]}
      />,
    );

    expect(screen.getByText("Autres valides (1)")).toBeInTheDocument();
    expect(screen.getByText("Dossier de consultation")).toBeInTheDocument();
  });

  it("surfaces the intake evidence when a document must be reviewed and allows quick reclassification", { timeout: 10000 }, async () => {
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
