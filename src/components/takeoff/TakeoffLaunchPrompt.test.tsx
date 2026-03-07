import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchTakeoffFromPlanSetMock = vi.hoisted(() => vi.fn());

vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({
  launchTakeoffFromPlanSet: launchTakeoffFromPlanSetMock,
}));

vi.mock("@/components/ui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

import {
  TakeoffLaunchPrompt,
  shouldShowTakeoffPrompt,
} from "@/components/takeoff/TakeoffLaunchPrompt";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_SET_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";

describe("shouldShowTakeoffPrompt", () => {
  const BASE = {
    takeoffEnabled: true,
    planSetCount: 1,
    latestJob: null,
    draftVersionId: VERSION_ID,
    permanentlyDismissed: false,
    temporarilyDismissed: false,
  };

  it("returns true when all conditions met", () => {
    expect(shouldShowTakeoffPrompt(BASE)).toBe(true);
  });

  it("returns false when takeoffEnabled is false", () => {
    expect(shouldShowTakeoffPrompt({ ...BASE, takeoffEnabled: false })).toBe(
      false,
    );
  });

  it("returns false when planSetCount is 0", () => {
    expect(shouldShowTakeoffPrompt({ ...BASE, planSetCount: 0 })).toBe(false);
  });

  it("returns false when latestJob is not null (done)", () => {
    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        latestJob: { status: "done" },
      }),
    ).toBe(false);
  });

  it("returns false when latestJob is not null (failed)", () => {
    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        latestJob: { status: "failed" },
      }),
    ).toBe(false);
  });

  it("returns false when latestJob is not null (canceled)", () => {
    expect(
      shouldShowTakeoffPrompt({
        ...BASE,
        latestJob: { status: "canceled" },
      }),
    ).toBe(false);
  });

  it("returns false when draftVersionId is null", () => {
    expect(
      shouldShowTakeoffPrompt({ ...BASE, draftVersionId: null }),
    ).toBe(false);
  });

  it("returns false when permanentlyDismissed is true", () => {
    expect(
      shouldShowTakeoffPrompt({ ...BASE, permanentlyDismissed: true }),
    ).toBe(false);
  });

  it("returns false when temporarilyDismissed is true", () => {
    expect(
      shouldShowTakeoffPrompt({ ...BASE, temporarilyDismissed: true }),
    ).toBe(false);
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
    planFileCount: 3,
    onLaunched: vi.fn(),
    onDismissTemporary: vi.fn(),
    onDismissPermanent: vi.fn(),
  };

  it("renders explanation (recommended level, version target, benefit)", () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    expect(
      screen.getByText("Lancer une premiere analyse"),
    ).toBeInTheDocument();
    expect(screen.getByText("Rapide")).toBeInTheDocument();
    expect(screen.getByText("V1 (brouillon)")).toBeInTheDocument();
    expect(screen.getByText(/3 plans pour alimenter/)).toBeInTheDocument();
  });

  it("falls back to a generic draft label when versionLabel is omitted", () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} versionLabel={undefined} />);

    expect(screen.getByText("Brouillon en cours")).toBeInTheDocument();
  });

  it('"Lancer maintenant" calls server action and shows success', async () => {
    launchTakeoffFromPlanSetMock.mockResolvedValue({ jobId: JOB_ID });

    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Lancer maintenant" }));

    await waitFor(() => {
      expect(screen.getByText("Analyse lancee")).toBeInTheDocument();
    });

    expect(launchTakeoffFromPlanSetMock).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      planSetId: PLAN_SET_ID,
      versionId: VERSION_ID,
    });
    expect(DEFAULT_PROPS.onLaunched).toHaveBeenCalledWith(JOB_ID);
  });

  it('"Plus tard" calls onDismissTemporary', () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Plus tard" }));
    expect(DEFAULT_PROPS.onDismissTemporary).toHaveBeenCalledOnce();
  });

  it('"Ne plus proposer" calls onDismissPermanent', () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Ne plus proposer sur cette affaire",
      }),
    );
    expect(DEFAULT_PROPS.onDismissPermanent).toHaveBeenCalledOnce();
  });

  it("shows error state with retry on server action failure", async () => {
    launchTakeoffFromPlanSetMock.mockRejectedValue(
      new Error("Network error"),
    );

    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByRole("button", { name: "Lancer maintenant" }));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("button", { name: "Reessayer" }),
    ).toBeInTheDocument();
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

  it("buttons are keyboard-accessible", () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);

    const launchBtn = screen.getByRole("button", {
      name: "Lancer maintenant",
    });
    const laterBtn = screen.getByRole("button", { name: "Plus tard" });
    const dismissBtn = screen.getByRole("button", {
      name: "Ne plus proposer sur cette affaire",
    });

    expect(launchBtn).not.toBeDisabled();
    expect(laterBtn).not.toBeDisabled();
    expect(dismissBtn).not.toBeDisabled();
  });
});
