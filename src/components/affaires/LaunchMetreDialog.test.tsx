import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());
const launchTakeoffFromSourceVersionPlanSetMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchTakeoffFromPlanSet: launchTakeoffFromPlanSetMock,
  launchTakeoffFromSourceVersionPlanSet: launchTakeoffFromSourceVersionPlanSetMock,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    error: vi.fn(),
  }),
}));

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  projectId: "11111111-1111-1111-1111-111111111111",
  currentVersion: {
    id: "33333333-3333-4333-8333-333333333333",
    status: "draft",
    versionNumber: 3,
  },
  availableVersions: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      versionNumber: 3,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      versionNumber: 2,
    },
  ],
  plansContext: {
    defaultPlanSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    defaultPlanSetName: "Plans import",
    defaultPlanSetSource: "affaire-intake",
    defaultPlanSetFileCount: 5,
    launchRecommendation: {
      documentClass: "tabular_pdf" as const,
      recommendedLevel: "B" as const,
      compatibleLevels: ["B", "C"] as Array<"B" | "C">,
      recommendationStrength: "high" as const,
      warningCode: null,
      warningMessage: null,
      signals: {
        mimeType: "application/pdf",
        extension: "pdf",
        fileCount: 5,
        totalPageCount: 2,
        matchedTableHints: ["dpgf"],
        matchedPlanHints: [],
      },
    },
  },
};

describe("LaunchMetreDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders affair-first context with provenance and explicit target version choices", () => {
    render(<LaunchMetreDialog {...defaultProps} />);

    expect(screen.getByText("Analyser les plans")).toBeInTheDocument();
    expect(screen.getByText("Plans import")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Plans synchronisés depuis le dossier de l'affaire. Seuls les plans confirmés sont repris ici."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Version cible" })).toHaveValue(
      "33333333-3333-4333-8333-333333333333"
    );
    expect(screen.getByText("V3 (brouillon)")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Rapide" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Détaillé" })).toBeInTheDocument();
  });

  it("does not render content when closed", () => {
    render(<LaunchMetreDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("launches directly on the selected draft version", async () => {
    const user = userEvent.setup();
    const onLaunched = vi.fn();
    const onOpenChange = vi.fn();
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: "job-1" });

    render(
      <LaunchMetreDialog
        {...defaultProps}
        onLaunched={onLaunched}
        onOpenChange={onOpenChange}
      />
    );

    await user.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
        projectId: "11111111-1111-1111-1111-111111111111",
        planSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        versionId: "33333333-3333-4333-8333-333333333333",
        level: "B",
      });
    });

    expect(launchTakeoffFromSourceVersionPlanSetMock).not.toHaveBeenCalled();
    expect(toastSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Analyse lancée",
        durationMs: 6000,
      })
    );
    expect(screen.getByText("Analyse lancée avec succès")).toBeInTheDocument();
    expect(onLaunched).toHaveBeenCalledWith("job-1");

    await user.click(screen.getByRole("link", { name: "Centre d'activité" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("creates a draft from the selected source version before launching", async () => {
    const user = userEvent.setup();
    launchTakeoffFromSourceVersionPlanSetMock.mockResolvedValue({
      jobId: "job-2",
      versionId: "44444444-4444-4444-8444-444444444444",
    });

    render(<LaunchMetreDialog {...defaultProps} />);

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Version cible" }),
      "22222222-2222-4222-8222-222222222222"
    );

    expect(
      screen.getByRole("button", { name: "Créer un brouillon et analyser" })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Créer un brouillon et analyser" })
    );

    await waitFor(() => {
      expect(launchTakeoffFromSourceVersionPlanSetMock).toHaveBeenCalledWith({
        projectId: "11111111-1111-1111-1111-111111111111",
        planSetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        sourceVersionId: "22222222-2222-4222-8222-222222222222",
        level: "B",
      });
    });

    expect(launchTakeoffFromPlanSetMock).not.toHaveBeenCalled();
    expect(
      screen.getByText("Nouveau brouillon depuis V2 — 5 fichiers.")
    ).toBeInTheDocument();
  });

  it("shows an actionable guardrail when no version exists yet", () => {
    render(
      <LaunchMetreDialog
        {...defaultProps}
        currentVersion={null}
        availableVersions={[]}
      />
    );

    expect(
      screen.getByText(/Créez d'abord une première version/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Créer une première version/i })
    ).toHaveAttribute(
      "href",
      "/dashboard/estimates/new?projectId=11111111-1111-1111-1111-111111111111"
    );
    expect(screen.getByRole("button", { name: "Analyser maintenant" })).toBeDisabled();
  });

  it("does not offer analysis for an empty plan set", () => {
    render(
      <LaunchMetreDialog
        {...defaultProps}
        plansContext={{
          ...defaultProps.plansContext,
          defaultPlanSetFileCount: 0,
        }}
      />
    );

    expect(
      screen.getByText("Aucun jeu de plans exploitable n'est disponible pour cette affaire.")
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Analyser maintenant" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir les plans" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/11111111-1111-1111-1111-111111111111/plans"
    );
  });
});
