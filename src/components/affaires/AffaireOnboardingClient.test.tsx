import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  initializeAffaireDraftMock,
  routerPushMock,
  routerRefreshMock,
} = vi.hoisted(() => ({
  initializeAffaireDraftMock: vi.fn(),
  routerPushMock: vi.fn(),
  routerRefreshMock: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: function MockLink({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: routerPushMock,
    refresh: routerRefreshMock,
  }),
}));

vi.mock("@/app/dashboard/affaires/_actions/quick-create-affaire", () => ({
  initializeAffaireDraft: initializeAffaireDraftMock,
}));

vi.mock("@/components/affaires/BlueprintCreationAnimation", () => ({
  BlueprintCreationAnimation: ({
    projectName,
    onComplete,
  }: {
    projectName: string;
    onComplete: () => void;
  }) => (
    <div>
      <span>Creation de {projectName}</span>
      <button type="button" onClick={onComplete}>
        Terminer l&apos;animation
      </button>
    </div>
  ),
}));

import { AffaireOnboardingClient } from "@/components/affaires/AffaireOnboardingClient";

describe("AffaireOnboardingClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeAffaireDraftMock.mockResolvedValue({
      projectId: "project-1",
      versionId: "version-1",
      redirectUrl: "/dashboard/affaires/project-1?created=1",
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not create anything on initial render", () => {
    render(<AffaireOnboardingClient />);

    expect(screen.getByLabelText(/nom du projet/i)).toHaveValue("");
    expect(
      screen.getByRole("button", { name: /creer l'affaire/i })
    ).toBeDisabled();
    expect(initializeAffaireDraftMock).not.toHaveBeenCalled();
  });

  it("enables creation once a project name is entered", async () => {
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    const createButton = screen.getByRole("button", {
      name: /creer l'affaire/i,
    });
    expect(createButton).toBeDisabled();

    await user.type(screen.getByLabelText(/nom du projet/i), "Residence Horizon");

    expect(createButton).toBeEnabled();
    expect(initializeAffaireDraftMock).not.toHaveBeenCalled();
  });

  it("creates a draft and redirects on save", async () => {
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    await user.type(screen.getByLabelText(/nom du projet/i), "Residence Horizon");
    await user.type(screen.getByLabelText(/^client$/i), "Client Demo");
    await user.click(screen.getByRole("button", { name: /creer l'affaire/i }));

    await waitFor(() => {
      expect(initializeAffaireDraftMock).toHaveBeenCalledWith({
        projectName: "Residence Horizon",
        clientName: "Client Demo",
        reference: null,
      });
    });
    await user.click(
      screen.getByRole("button", { name: /terminer l'animation/i })
    );
    expect(routerPushMock).toHaveBeenCalledWith(
      "/dashboard/affaires/project-1?created=1"
    );
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("surfaces initialization errors and allows a retry", async () => {
    initializeAffaireDraftMock.mockRejectedValueOnce(
      new Error("Impossible de creer ce projet.")
    );
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    await user.type(screen.getByLabelText(/nom du projet/i), "Projet invalide");
    await user.click(screen.getByRole("button", { name: /creer l'affaire/i }));

    expect(await screen.findByText("Impossible de creer ce projet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /creer l'affaire/i })
    ).toBeEnabled();
  });
});
