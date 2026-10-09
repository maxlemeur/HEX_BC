import { cleanup,render,screen,waitFor } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";


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
    expect(screen.queryByRole("heading", { name: "Documents à confirmer" })).not.toBeInTheDocument();
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
