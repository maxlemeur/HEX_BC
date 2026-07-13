import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());
const duplicateEstimateVersionMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchTakeoffFromPlanSet: launchTakeoffFromPlanSetMock,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/estimates/client", () => ({
  duplicateEstimateVersion: duplicateEstimateVersionMock,
}));

import {
  TakeoffLaunchPrompt,
  shouldShowTakeoffPrompt,
} from "@/components/takeoff/TakeoffLaunchPrompt";
import { classifyTakeoffPlanSetSource } from "@/lib/takeoff/document-classifier";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_SET_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const DUPLICATED_VERSION_ID = "55555555-5555-4555-8555-555555555555";
const DEFAULT_RECOMMENDATION = classifyTakeoffPlanSetSource({
  files: [
    {
      file_name: "lot-cvc-dpgf.pdf",
      file_type: "application/pdf",
      page_count: 2,
    },
  ],
});

describe("shouldShowTakeoffPrompt", () => {
  const BASE = {
    takeoffEnabled: true,
    planFileCount: 3,
    defaultPlanSetId: PLAN_SET_ID,
    defaultPlanSetUpdatedAt: "2026-03-10T09:00:00.000Z",
    latestJob: null,
    targetVersionId: VERSION_ID,
    hasLaunchableVersionTarget: true,
    permanentlyDismissed: false,
    temporarilyDismissed: false,
  };

  it("returns true when all conditions met", () => {
    expect(shouldShowTakeoffPrompt(BASE)).toBe(true);
  });

  it("returns false when a temporary dismissal exists", () => {
    expect(
      shouldShowTakeoffPrompt({ ...BASE, temporarilyDismissed: true }),
    ).toBe(false);
  });

  it("returns false when no plan file is available yet", () => {
    expect(
      shouldShowTakeoffPrompt({ ...BASE, planFileCount: 0 }),
    ).toBe(false);
  });

  it("returns false for a recent job on the same plan set and unchanged files", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));

    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        latestJob: {
          status: "completed",
          planSetId: PLAN_SET_ID,
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(false);

    vi.useRealTimers();
  });

  it("returns true when the same plan set changed after the last job", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));

    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        defaultPlanSetUpdatedAt: "2026-03-10T11:00:00.000Z",
        latestJob: {
          status: "completed",
          planSetId: PLAN_SET_ID,
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(true);

    vi.useRealTimers();
  });

  it("returns true when the latest job targets another plan set", () => {
    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        latestJob: {
          status: "completed",
          planSetId: "other-set",
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(true);
  });

  it("returns true when the latest job used another source version", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));

    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        targetVersionId: "99999999-9999-4999-8999-999999999999",
        latestJob: {
          status: "completed",
          planSetId: PLAN_SET_ID,
          estimateVersionId: VERSION_ID,
          createdAt: "2026-03-10T10:00:00.000Z",
        },
      }),
    ).toBe(true);

    vi.useRealTimers();
  });
});

describe("TakeoffLaunchPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const DEFAULT_PROPS = {
    projectId: PROJECT_ID,
    versionId: VERSION_ID,
    versionLabel: "V1 (brouillon)",
    planSetId: PLAN_SET_ID,
    planSetName: "Plans import",
    planFileCount: 3,
    launchRecommendation: DEFAULT_RECOMMENDATION,
    onLaunched: vi.fn(),
    onDismissTemporary: vi.fn(),
    onDismissPermanent: vi.fn(),
  };

  it("renders business-friendly explanation", () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    expect(screen.getByText("Lancer une première analyse")).toBeInTheDocument();
    expect(screen.getByText(/Jeu de plans :/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeChecked();
    expect(screen.getByText("V1 (brouillon)")).toBeInTheDocument();
    expect(
      screen.getByText(/Résultats disponibles dans le centre d'activité des métrés/i),
    ).toBeInTheDocument();
  });

  it('"Analyser maintenant" calls server action and shows success', async () => {
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: JOB_ID });

    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    await waitFor(() => {
      expect(screen.getByText("Analyse lancée")).toBeInTheDocument();
    });

    expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      versionId: VERSION_ID,
      level: "B",
    });
    expect(DEFAULT_PROPS.onLaunched).toHaveBeenCalledWith(JOB_ID, VERSION_ID);
  });

  it('allows overriding to level C before launch', async () => {
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: JOB_ID });

    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("radio", { name: "Détaillé" }));
    fireEvent.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        versionId: VERSION_ID,
        level: "C",
      });
    });
  });

  it("creates a draft before launching when only a source version is available", async () => {
    duplicateEstimateVersionMock.mockResolvedValue(DUPLICATED_VERSION_ID);
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: JOB_ID });

    render(
      <TakeoffLaunchPrompt
        {...DEFAULT_PROPS}
        versionId={null}
        versionLabel={undefined}
        sourceVersionId={VERSION_ID}
        sourceVersionLabel="V3"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Créer un brouillon et analyser" }),
    );

    await waitFor(() => {
      expect(duplicateEstimateVersionMock).toHaveBeenCalledWith(VERSION_ID);
      expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        versionId: DUPLICATED_VERSION_ID,
        level: "B",
      });
    });
  });

  it("reuses the duplicated draft when retrying after launch creation fails", async () => {
    duplicateEstimateVersionMock.mockResolvedValue(DUPLICATED_VERSION_ID);
    launchTakeoffFromPlanSetMock
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({ jobId: JOB_ID });

    render(
      <TakeoffLaunchPrompt
        {...DEFAULT_PROPS}
        versionId={null}
        versionLabel={undefined}
        sourceVersionId={VERSION_ID}
        sourceVersionLabel="V3"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Créer un brouillon et analyser" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));

    await waitFor(() => {
      expect(launchTakeoffFromPlanSetMock).toHaveBeenNthCalledWith(2, {
        projectId: PROJECT_ID,
        planSetId: PLAN_SET_ID,
        versionId: DUPLICATED_VERSION_ID,
        level: "B",
      });
    });

    expect(duplicateEstimateVersionMock).toHaveBeenCalledTimes(1);
  });

  it('"Me rappeler plus tard" calls onDismissTemporary', () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Me rappeler plus tard" }));
    expect(DEFAULT_PROPS.onDismissTemporary).toHaveBeenCalledOnce();
  });

  it('"Ne pas proposer" calls onDismissPermanent', () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ne pas proposer pour cette affaire",
      }),
    );
    expect(DEFAULT_PROPS.onDismissPermanent).toHaveBeenCalledOnce();
  });

  it("shows error state with retry on server action failure", async () => {
    launchTakeoffFromPlanSetMock.mockRejectedValue(new Error("Network error"));

    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Analyser maintenant" }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });

  it('has aria-live="polite" region for async feedback', () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    const liveRegion = screen.getByRole("region", {
      name: "Proposition d'analyse automatique",
    });
    expect(liveRegion).toBeInTheDocument();

    const politeRegion = liveRegion.querySelector('[aria-live="polite"]');
    expect(politeRegion).toBeTruthy();
  });
});
