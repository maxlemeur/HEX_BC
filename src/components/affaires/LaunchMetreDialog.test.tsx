import { cleanup,render,screen,waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import { LaunchMetreDialog } from "./LaunchMetreDialog";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());
const launchTakeoffFromSourceVersionPlanSetMock = vi.hoisted(() => vi.fn());
const loadChatGptConnectionMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchPreparedTakeoffFromPlanSetAction: launchTakeoffFromPlanSetMock,
  launchPreparedTakeoffFromSourceVersionPlanSetAction: launchTakeoffFromSourceVersionPlanSetMock,
}));

vi.mock("@/components/takeoff/TakeoffPreparationPanel", async () => {
  const { useState } = await import("react");
  return {
    TakeoffPreparationPanel: (props: import("@/components/takeoff/TakeoffPreparationPanel").TakeoffPreparationPanelProps) => {
      const [processing, setProcessing] = useState<import("@/lib/takeoff/preparation").TakeoffPreparation["processing"]>({ level: props.recommendedLevel ?? "B", provider: "auto" });
      const controls = typeof props.advancedControls === "function" ? props.advancedControls({ processing, onProcessingChange: (patch) => setProcessing((current) => ({ ...current, ...patch })), isConfirmed: false }) : props.advancedControls;
      return <div>{props.documentControls}{props.destinationControls}{controls}<button type="button" disabled={props.disabled || props.launchDisabled} onClick={() => void props.onLaunch(7, processing)}>Confirmer et lancer le métré</button></div>;
    },
  };
});
vi.mock("@/app/dashboard/_actions/chatgpt", () => ({ loadChatGptConnection: loadChatGptConnectionMock }));

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
    loadChatGptConnectionMock.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not promise recovery when its persistence is unconfirmed", async () => {
    const user = userEvent.setup();
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: true, data: {
      jobId: "job-unconfirmed",
      dispatch: {
        status: "persistence_unconfirmed",
        correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        persisted: false,
      },
    } });

    render(<LaunchMetreDialog {...defaultProps} />);
    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));

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
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: true, data: { jobId: "job-usable" } });

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

    const planSetSelect = await screen.findByRole("combobox", {
      name: "Jeu de plans à analyser",
    });
    await waitFor(() => {
      expect(planSetSelect).toHaveValue(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );
    });

    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith(
        expect.objectContaining({
          planSetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          versionId: "33333333-3333-4333-8333-333333333333",
          preparationRevision: 7,
        }),
      );
    });
  });

  it("shows an actionable guardrail when no version exists yet", async () => {
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
    expect(await screen.findByRole("button", { name: "Confirmer et lancer le métré" })).toBeDisabled();
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
      screen.queryByRole("button", { name: "Confirmer et lancer le métré" })
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voir les plans" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/11111111-1111-1111-1111-111111111111/plans"
    );
  });
  it("uses the provider selected after opening the common preparation", async () => {
    const user = userEvent.setup();
    loadChatGptConnectionMock.mockResolvedValue({ enabled: true, selectedId: "profile", model: "plan-model", sharing: true, profiles: [] });
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: true, data: { jobId: "job-gemini" } });
    render(<LaunchMetreDialog {...defaultProps} />);
    await user.selectOptions(await screen.findByLabelText("Fournisseur IA"), "gemini");
    await user.click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    await waitFor(() => expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith(expect.objectContaining({ provider: "gemini", preparationRevision: 7 })));
  });

  it("shows the safe launch conflict without reporting a successful analysis", async () => {
    const message = "Les plans ont changé depuis la confirmation. Vérifiez les sources avant de relancer.";
    launchTakeoffFromPlanSetMock.mockResolvedValue({ ok: false, error: { status: 409, code: "TAKEOFF_CONFLICT", message, retryable: false } });
    render(<LaunchMetreDialog {...defaultProps} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Confirmer et lancer le métré" }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(toastSuccessMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Analyse transmise au traitement")).not.toBeInTheDocument();
  });

});
