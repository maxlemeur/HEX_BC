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

vi.mock("@/components/ui/Toast", () => ({
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
      projectName: "Affaire mise a jour",
      clientName: "Client final",
      reference: "REF-002",
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
    await user.type(projectNameInput, "Affaire mise a jour");
    await user.clear(screen.getByLabelText(/^client$/i));
    await user.type(screen.getByLabelText(/^client$/i), "Client final");
    await user.clear(screen.getByLabelText(/reference/i));
    await user.type(screen.getByLabelText(/reference/i), "REF-002");
    await user.click(screen.getByRole("button", { name: /enregistrer/i }));

    await waitFor(() => {
      expect(updateActionMock).toHaveBeenCalledWith({
        projectId: "project-1",
        projectName: "Affaire mise a jour",
        clientName: "Client final",
        reference: "REF-002",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith({
      title: "Affaire mise a jour",
    });
    expect(await screen.findByText("Affaire mise a jour")).toBeInTheDocument();
  });
});
