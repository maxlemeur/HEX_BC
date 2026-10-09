import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());
const launchTakeoffFromSourceVersionPlanSetMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchTakeoffFromPlanSet: launchTakeoffFromPlanSetMock,
  launchTakeoffFromSourceVersionPlanSet: launchTakeoffFromSourceVersionPlanSetMock,
}));

vi.mock("@/components/ui-legacy/Toast", () => ({
  useToast: () => ({
    success: toastSuccessMock,
    warning: toastWarningMock,
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
  availablePlanSets: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Plans import",
      source: "affaire-intake",
      fileCount: 5,
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

  it("does not promise recovery when its persistence is unconfirmed", async () => {
    const user = userEvent.setup();
    launchTakeoffFromPlanSetMock.mockResolvedValue({
      jobId: "job-unconfirmed",
      dispatch: {
        status: "persistence_unconfirmed",
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        persisted: false,
      },
    });

    render(<LaunchMetreDialog {...defaultProps} />);
    await user.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    expect(
      await screen.findByText("Analyse créée, reprise à vérifier")
    ).toBeInTheDocument();
    expect(screen.getByText(/reprise automatique n'a pas pu être confirmée/i)).toBeInTheDocument();
    expect(toastWarningMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Analyse créée, reprise à vérifier" })
    );
  });

  it("prefers an exploitable plan set when the default set is empty", async () => {
    const user = userEvent.setup();
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: "job-usable" });

    render(
      <LaunchMetreDialog
        {...defaultProps}
        plansContext={{
          ...defaultProps.plansContext,
          defaultPlanSetFileCount: 0,
        }}
        availablePlanSets={[
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Jeu vide récent",
            fileCount: 0,
          },
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Plans plomberie",
            fileCount: 3,
          },
        ]}
      />
    );

    const planSetSelect = screen.getByRole("combobox", {
      name: "Jeu de plans à analyser",
    });
    await waitFor(() => {
      expect(planSetSelect).toHaveValue(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );
    });

    await user.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          planSetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          versionId: "33333333-3333-4333-8333-333333333333",
        }),
      );
    });
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
        availablePlanSets={[
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Plans import",
            fileCount: 0,
          },
        ]}
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
