import { cleanup,render,screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

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

  it("surfaces initialization errors and allows a retry", async () => {
    initializeAffaireDraftMock.mockRejectedValueOnce(
      new Error("Impossible de creer ce projet.")
    );
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    await user.type(screen.getByLabelText(/nom du projet/i), "Projet invalide");
    await user.click(screen.getByRole("button", { name: /cr[ée]er l'affaire/i }));

    expect(await screen.findByText("Impossible de creer ce projet.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cr[ée]er l'affaire/i })
    ).toBeEnabled();
  });
});
