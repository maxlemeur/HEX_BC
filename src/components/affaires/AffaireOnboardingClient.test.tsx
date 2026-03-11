import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  initializeAffaireDraftMock,
  routerPushMock,
  routerRefreshMock,
  onboardingDropzoneProps,
  importSectionProps,
} = vi.hoisted(() => ({
  initializeAffaireDraftMock: vi.fn(),
  routerPushMock: vi.fn(),
  routerRefreshMock: vi.fn(),
  onboardingDropzoneProps: [] as Array<Record<string, unknown>>,
  importSectionProps: [] as Array<Record<string, unknown>>,
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

vi.mock("@/components/affaires/OnboardingIntakeDropzone", () => ({
  OnboardingIntakeDropzone: (props: Record<string, unknown>) => {
    onboardingDropzoneProps.push(props);
    return (
      <button
        type="button"
        onClick={() => void (props.onMissingProjectName as () => void)?.()}
      >
        Trigger dossier validation
      </button>
    );
  },
}));

vi.mock("@/components/affaires/AffaireImportBootstrapSection", () => ({
  AffaireImportBootstrapSection: (props: Record<string, unknown>) => {
    importSectionProps.push(props);
    return <div data-testid="import-bootstrap-section" />;
  },
}));

import { AffaireOnboardingClient } from "@/components/affaires/AffaireOnboardingClient";

describe("AffaireOnboardingClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onboardingDropzoneProps.length = 0;
    importSectionProps.length = 0;
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

    expect(screen.getByRole("heading", { name: /nouvelle affaire/i })).toBeInTheDocument();
    expect(initializeAffaireDraftMock).not.toHaveBeenCalled();
    expect(importSectionProps.at(-1)).toEqual(
      expect.objectContaining({
        metadata: {
          projectName: "",
          clientName: "",
          reference: "",
        },
      })
    );
  });

  it("requires a project name before save", async () => {
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    await user.click(screen.getByRole("button", { name: /enregistrer l'affaire/i }));

    expect(await screen.findAllByText(/le nom du projet est obligatoire/i)).not.toHaveLength(0);
    expect(initializeAffaireDraftMock).not.toHaveBeenCalled();
  });

  it("creates a draft and redirects on save", async () => {
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    await user.type(screen.getByLabelText(/nom du projet/i), "Residence Horizon");
    await user.type(screen.getByLabelText(/^client$/i), "Client Demo");
    await user.click(screen.getByRole("button", { name: /enregistrer l'affaire/i }));

    await waitFor(() => {
      expect(initializeAffaireDraftMock).toHaveBeenCalledWith({
        projectName: "Residence Horizon",
        clientName: "Client Demo",
        reference: null,
      });
    });
    expect(routerPushMock).toHaveBeenCalledWith(
      "/dashboard/affaires/project-1?created=1"
    );
    expect(routerRefreshMock).toHaveBeenCalled();
  });

  it("surfaces project-name validation when dossier upload is attempted too early", async () => {
    const user = userEvent.setup();
    render(<AffaireOnboardingClient />);

    await user.click(
      screen.getByRole("button", { name: /trigger dossier validation/i })
    );

    expect(await screen.findAllByText(/le nom du projet est obligatoire/i)).not.toHaveLength(0);
    expect(initializeAffaireDraftMock).not.toHaveBeenCalled();
  });
});
