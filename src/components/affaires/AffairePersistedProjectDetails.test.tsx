import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { updateActionMock, toastSuccessMock } = vi.hoisted(() => ({
  updateActionMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("@/app/dashboard/affaires/_actions/project", () => ({
  updateAffaireProjectMetadataAction: updateActionMock,
}));

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
  }),
}));

import { AffairePersistedProjectDetails } from "@/components/affaires/AffairePersistedProjectDetails";

describe("AffairePersistedProjectDetails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateActionMock.mockResolvedValue({
      projectName: "Affaire mise à jour",
      clientName: "Client final",
      reference: "REF-002",
      siteAddress: "12 rue du Test\n75001 Paris",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("starts in read-only mode then saves inline edits", async () => {
    const user = userEvent.setup();

    render(
      <AffairePersistedProjectDetails
        projectId="project-1"
        initialValues={{
          projectName: "Affaire Alpha",
          clientName: "Client initial",
          reference: "REF-001",
        }}
      />
    );

    expect(screen.getByText("Affaire Alpha")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /modifier/i }));

    const projectNameInput = screen.getByLabelText(/nom du projet/i);
    await user.clear(projectNameInput);
    await user.type(projectNameInput, "Affaire mise à jour");
    await user.clear(screen.getByLabelText(/^client$/i));
    await user.type(screen.getByLabelText(/^client$/i), "Client final");
    await user.clear(screen.getByLabelText(/référence/i));
    await user.type(screen.getByLabelText(/référence/i), "REF-002");
    await user.type(screen.getByLabelText(/adresse du chantier/i), "12 rue du Test{enter}75001 Paris");
    await user.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(updateActionMock).toHaveBeenCalledWith({
        projectId: "project-1",
        projectName: "Affaire mise à jour",
        clientName: "Client final",
        reference: "REF-002",
      siteAddress: "12 rue du Test\n75001 Paris",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: "Affaire mise à jour",
    });
    expect(await screen.findByText("Affaire mise à jour")).toBeInTheDocument();
  });

  it("keeps the project toolbar responsive between mobile and desktop", () => {
    render(
      <AffairePersistedProjectDetails
        projectId="project-1"
        initialValues={{
          projectName: "Affaire Alpha",
          clientName: "",
          reference: "",
        }}
        toolbar={<span data-testid="project-toolbar">Actions</span>}
      />
    );

    const header = screen.getByRole("heading", { name: "Affaire Alpha" }).closest("section");
    expect(header).toContainElement(screen.getByTestId("project-toolbar"));
    // The toolbar's menus and previews must not be clipped by the header.
    expect(header).not.toHaveClass("overflow-hidden");
  });
});
