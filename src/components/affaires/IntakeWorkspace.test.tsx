import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockReplace, mockRefresh, mockSearchParams } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockRefresh: vi.fn(),
  mockSearchParams: new URLSearchParams(),
}));

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
}));

import { IntakeWorkspace } from "@/components/affaires/IntakeWorkspace";

describe("IntakeWorkspace", () => {
  beforeEach(() => {
    mockReplace.mockReset();
    mockRefresh.mockReset();
    mockSearchParams.delete("intakeFilter");
    window.history.replaceState({}, "", "/dashboard/affaires/project-1");
  });

  afterEach(() => {
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
});
