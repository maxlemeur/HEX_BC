import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

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

    expect(screen.queryByText("Documents à confirmer")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ouvrir les plans" })).toBeInTheDocument();
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

    expect(screen.getAllByText("Structure à remettre à jour").length).toBeGreaterThan(0);
    expect(screen.getByText("12 lignes déjà saisies")).toBeInTheDocument();
    expect(screen.getByText("3 lignes à revoir")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Le devis contient déjà une trame, mais certaines lignes doivent être revues avant de poursuivre le chiffrage."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generer la structure du devis" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pourquoi Structure à remettre à jour" }));

    expect(
      screen.getByText(
        "Une partie de la structure existe déjà, mais certaines lignes doivent encore être revues avant de reprendre le chiffrage."
      )
    ).toBeInTheDocument();
  });

  it("falls back to brief-only preliminary structure copy when the primary CCTP has no defendable lots", () => {
    const preliminaryStructure = buildSuggestion({
      actionId: "open-structure-draft",
      label: "Ouvrir la structure préliminaire",
      intent: "generate_structure",
      preview: "Ouvrir une preview éditable de structure à partir du brief confirme.",
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
        "Le brief confirme permet d'ouvrir une trame éditable du devis, sans import DPGF obligatoire.",
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("CCTP principal detecte")).not.toBeInTheDocument();
    expect(screen.queryByText(/Lots CCTP:/)).not.toBeInTheDocument();
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
    expect(screen.getByText("Avancer sous réserves")).toBeInTheDocument();
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
            summary: "Brief à confirmer.",
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
    expect(screen.getAllByText("Brief à confirmer").length).toBeGreaterThan(0);
    expect(screen.queryByText("Dossier exploitable")).not.toBeInTheDocument();
    expect(screen.getByText("Base insuffisante")).toBeInTheDocument();
  });

  it("shows the canonical hub readiness even when the local next step looks ready", () => {
    const analyzePlans = buildSuggestion({
      actionId: "analyze-plans",
      label: "Lancer le métré",
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

    expect(screen.getByRole("button", { name: "Lancer le métré" })).toBeInTheDocument();
    expect(screen.getByText("Analyse sous réserves")).toBeInTheDocument();
    expect(screen.getByText("Avancer sous réserves")).toBeInTheDocument();
    expect(screen.queryByText("Base de travail prête")).not.toBeInTheDocument();
    expect(screen.getByText("Base devis disponible sous réserves")).toBeInTheDocument();
    expect(screen.queryByText("Base devis prête")).not.toBeInTheDocument();
  });

  it("keeps the clarification CTA as the only visible next step when client clarifications remain", () => {
    const clarificationSuggestion = buildSuggestion({
      actionId: "list-clarifications",
      label: "Traiter 1 clarification client",
      intent: "list_hypotheses",
      preview: "Des clarifications critiques restent à porter vers le client avant envoi.",
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
      preview: "Un additif ou une piece critique recue tardivement impose une revue ciblee: Revue documentaire + Readiness pré-remise.",
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

  it("blocks plan launch CTAs when canonical readiness is not ready", () => {
    const analyzePlans = buildSuggestion({
      actionId: "analyze-plans-not-ready",
      label: "Lancer le métré",
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

    expect(screen.queryByRole("button", { name: "Lancer le métré" })).not.toBeInTheDocument();
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

    expect(screen.getByRole("heading", { name: "Vérifier la sortie devis" })).toBeInTheDocument();
    expect(screen.getByText("Sortie à finaliser")).toBeInTheDocument();
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
    expect(screen.getAllByText("Structure à reprendre").length).toBeGreaterThan(0);
    expect(screen.queryByText("Structure à générer")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(
        "Le brief est confirmé. Reprenez la structure du devis avant de matérialiser le chiffrage."
      ).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Pourquoi Structure à reprendre" }));

    expect(
      screen.getByText(
        "Le brief est confirmé. La prochaine action est de reprendre la structure du devis."
      )
    ).toBeInTheDocument();
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
              issues: ["Classification à confirmer"],
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
            preview: "Compléter le dossier avec les pièces manquantes détectées pendant l'intake.",
            target: { kind: "open_surface", surfaceId: "intake-upload" },
            priority: 800,
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("piece-inconnue.pdf").length).toBeGreaterThan(0);
    expect(screen.getByText("CCTP PRINCIPAL")).toBeInTheDocument();
    expect(screen.getByText("cctp-lot-electricite.docx")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "CCTPComplémentaire" })).toBeInTheDocument();
    expect(screen.getByText("DPGF NON DÉTECTÉ")).toBeInTheDocument();
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
    expect(screen.getByText("Principal à définir")).toBeInTheDocument();
    expect(screen.getByText("Choisir le document principal")).toBeInTheDocument();
    expect(screen.getByText("Choix principal")).toBeInTheDocument();
    expect(screen.queryByText("Autres DPGF (2)")).not.toBeInTheDocument();
  });
});
