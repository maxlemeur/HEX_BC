import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COCKPIT_OPEN_SURFACE_EVENT } from "@/lib/cockpit/events";

const { mockReplace, mockRefresh, mockSearchParams } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockRefresh: vi.fn(),
  mockSearchParams: new URLSearchParams(),
}));
const mockScrollIntoView = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires/project-1",
  useRouter: () => ({
    replace: mockReplace,
    refresh: mockRefresh,
  }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  reclassifyAffaireDocument: vi.fn(),
  setAffaireDocumentAsPrimary: vi.fn(),
}));

import { IntakeWorkspace } from "@/components/affaires/IntakeWorkspace";

describe("IntakeWorkspace", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockSearchParams.delete("intakeFilter");
    mockSearchParams.delete("intakeDocument");
    mockSearchParams.delete("briefBlock");
    mockSearchParams.delete("briefEntry");
    mockScrollIntoView.mockReset();
    Element.prototype.scrollIntoView = mockScrollIntoView;
    window.history.replaceState({}, "", "/dashboard/affaires/project-1");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("filters to documents needing review and updates the URL explicitly", async () => {
    const user = userEvent.setup();

    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-certain",
              fileName: "certain.pdf",
              detectedCategory: "plans",
              confidence: 1,
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
              documentId: "doc-review",
              fileName: "review.pdf",
              detectedCategory: "annexes",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: [],
              },
              issues: ["Faible confiance"],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
      />
    );

    expect(screen.getByText("certain.pdf")).toBeInTheDocument();
    expect(screen.getByText("review.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /A revoir/i }));

    expect(window.location.pathname + window.location.search).toBe(
      "/dashboard/affaires/project-1?intakeFilter=a_revoir"
    );
    expect(screen.queryByText("certain.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("review.pdf")).toBeInTheDocument();
  });

  it("shows progress bar with correct counters", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "classified.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
            {
              documentId: "doc-2",
              fileName: "review.pdf",
              detectedCategory: "annexes",
              confidence: 0.42,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
            {
              documentId: "doc-3",
              fileName: "processing.pdf",
              detectedCategory: "a_classer",
              confidence: 0,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
      />
    );

    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(screen.getByText("1 valide, 1 a confirmer, 1 en cours")).toBeInTheDocument();
  });

  it("keeps persisted classified documents out of the review bucket", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
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
          briefDraft: null,
        }}
      />
    );

    expect(screen.getByText("1 valide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /A revoir/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Documents a confirmer" })).not.toBeInTheDocument();
  });

  it("opens the dropzone when the cockpit requests intake upload", async () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
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
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: /Zone de dépôt multi-documents/i,
      }),
    ).not.toBeInTheDocument();

    document.dispatchEvent(
      new CustomEvent(COCKPIT_OPEN_SURFACE_EVENT, {
        detail: {
          projectId: "project-1",
          actionId: "add-files",
          surfaceId: "intake-upload",
        },
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: /Zone de dépôt multi-documents/i,
        }),
      ).toBeInTheDocument();
    });
  });

  it("hides the duplicate intake heading in entry mode when the affaire is still empty", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        entryMode
        workspace={{
          projectId: "project-1",
          uploadId: null,
          documents: [],
          missingPieces: [],
          briefDraft: null,
        }}
      />,
    );

    expect(screen.queryByText("Dossier de consultation")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /Zone de dépôt multi-documents/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("shows section headers for grouped documents", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "classified.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
            {
              documentId: "doc-2",
              fileName: "review.pdf",
              detectedCategory: "annexes",
              confidence: 0.42,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
      />
    );

    expect(screen.getByRole("region", { name: /Documents a confirmer/i })).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /Documents classés par catégorie/i }),
    ).toBeInTheDocument();
  });

  it("opens and highlights the source document targeted from the brief", async () => {
    mockSearchParams.set("intakeDocument", "doc-1");
    mockSearchParams.set("briefBlock", "scope");
    mockSearchParams.set("briefEntry", "0");

    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "source-brief.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
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
            summary: "Resume du projet",
            projectObject: "Construction d'un batiment",
            scope: ["Lot 1 - Gros oeuvre"],
            lots: [],
            receivedPieces: [],
            assumptions: [],
            vigilancePoints: [],
            missingElements: [],
            sources: [],
            uploadId: "upload-1",
            lastGeneratedAt: "2026-03-01T10:00:00+01:00",
            confirmedAt: null,
          },
        }}
      />,
    );

    expect(await screen.findAllByText("source-brief.pdf")).toHaveLength(2);
    expect(screen.getByText("Source du brief")).toBeInTheDocument();
    expect(screen.getByText("Perimetre detecte")).toBeInTheDocument();
    expect(screen.getByText("Element 1")).toBeInTheDocument();
    expect(screen.getAllByText("Plans").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Perimetre detecte s'appuie sur cette pièce du dossier/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Enonce cible/i)).toBeInTheDocument();
    expect(screen.getByText("Lot 1 - Gros oeuvre")).toBeInTheDocument();
    const documentCard = document.querySelector("[data-document-id='doc-1']");
    expect(documentCard).toHaveAttribute("data-highlighted", "true");

    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalled();
    });
    expect(mockScrollIntoView).toHaveBeenCalledWith({
      behavior: "auto",
      block: "center",
    });
  });

  it("does not re-scroll the focused source document on workspace refreshes", async () => {
    mockSearchParams.set("intakeDocument", "doc-1");
    mockSearchParams.set("briefBlock", "scope");
    mockSearchParams.set("briefEntry", "0");

    const initialWorkspace = {
      projectId: "project-1",
      uploadId: "upload-1",
      documents: [
        {
          documentId: "doc-1",
          fileName: "source-brief.pdf",
          detectedCategory: "plans" as const,
          confidence: 0.95,
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
        status: "a_confirmer" as const,
        summary: "Resume du projet",
        projectObject: "Construction d'un batiment",
        scope: ["Lot 1 - Gros oeuvre"],
        lots: [],
        receivedPieces: [],
        assumptions: [],
        vigilancePoints: [],
        missingElements: [],
        sources: [],
        uploadId: "upload-1",
        lastGeneratedAt: "2026-03-01T10:00:00+01:00",
        confirmedAt: null,
      },
    };

    const { rerender } = render(
      <IntakeWorkspace projectId="project-1" workspace={initialWorkspace} />,
    );

    await waitFor(() => {
      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
    });

    rerender(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          ...initialWorkspace,
          documents: initialWorkspace.documents.map((document) => ({
            ...document,
            issues: ["Classification rafraichie"],
          })),
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Source du brief")).toBeInTheDocument();
      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  it("can hide duplicate add-file actions when the flow hero already carries them", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        hideAddFilesAction
        hideMissingPiecesAction
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "classified.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
          ],
          missingPieces: [
            { code: "missing_cctp", label: "CCTP manquant", severity: "warning" },
          ],
          briefDraft: null,
        }}
      />,
    );

    expect(screen.queryByRole("button", { name: "Ajouter des fichiers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter les pieces manquantes" })).not.toBeInTheDocument();
  });

  it("displays detected variants in document card", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
              detectedCategory: "annexes",
              confidence: 0.42,
              extractedMetadata: {
                projectName: null,
                clientName: null,
                deadlineAt: null,
                detectedLots: [],
                detectedVariants: ["Variante 1", "Variante 2"],
              },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
      />
    );

    expect(screen.getByText("Variantes:")).toBeInTheDocument();
    expect(screen.getByText("Variante 1, Variante 2")).toBeInTheDocument();
  });

  it("shows triage complete CTA when all documents are classified", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
      />
    );

    expect(screen.getByText(/Triage termine/)).toBeInTheDocument();
    expect(screen.getByText(/valides/)).toBeInTheDocument();
  });

  it("shows in-progress CTA when documents need review", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
            {
              documentId: "doc-2",
              fileName: "review.pdf",
              detectedCategory: "a_classer",
              confidence: 0.30,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: ["Faible confiance"],
            },
          ],
          missingPieces: [],
          briefDraft: null,
        }}
      />
    );

    expect(screen.getByText(/Triage en cours/)).toBeInTheDocument();
    expect(screen.queryByText(/Triage termine/)).not.toBeInTheDocument();
  });

  it("does not show triage complete if critical missing pieces exist", () => {
    render(
      <IntakeWorkspace
        projectId="project-1"
        workspace={{
          projectId: "project-1",
          uploadId: "upload-1",
          documents: [
            {
              documentId: "doc-1",
              fileName: "plans.pdf",
              detectedCategory: "plans",
              confidence: 0.95,
              extractedMetadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
              issues: [],
            },
          ],
          missingPieces: [{ code: "missing_dpgf", label: "DPGF manquant", severity: "critical" }],
          briefDraft: null,
        }}
      />
    );

    expect(screen.queryByText(/Triage termine/)).not.toBeInTheDocument();
  });
});
