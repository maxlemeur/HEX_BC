import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

const dialogProps = vi.hoisted(() => vi.fn());
vi.mock("@/components/affaires/LaunchMetreDialog", () => ({
  LaunchMetreDialog: (props: { open: boolean; onLaunched: (jobId: string, versionId: string) => void }) => { dialogProps(props); return props.open ? <div role="dialog" aria-label="Préparer le métré"><button onClick={() => props.onLaunched("job", "new-draft")}>Confirmation commune</button></div> : null; },
}));

import {
TakeoffLaunchPrompt,
shouldShowTakeoffPrompt,
} from "@/components/takeoff/TakeoffLaunchPrompt";
import { classifyTakeoffPlanSetSource } from "@/lib/takeoff/document-classifier";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const PLAN_SET_ID = "33333333-3333-4333-8333-333333333333";
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

  it("opens the common preparation without duplicating a draft before confirmation", () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} versionId={null} versionLabel={undefined} sourceVersionId={VERSION_ID} sourceVersionLabel="V3" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Préparer le métré" }));
    expect(screen.getByRole("dialog", { name: "Préparer le métré" })).toBeInTheDocument();
    expect(dialogProps).toHaveBeenLastCalledWith(expect.objectContaining({
      projectId: PROJECT_ID,
      initialPlanSetId: PLAN_SET_ID,
      currentVersion: { id: VERSION_ID, status: "sent", versionNumber: 3 },
    }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmation commune" }));
    expect(DEFAULT_PROPS.onLaunched).toHaveBeenCalledWith("job", "new-draft");
    expect(screen.getByText("Demande d’analyse créée")).toBeInTheDocument();
  });

  it("delegates the current draft and recommendation to the common preparation", () => {
    render(<TakeoffLaunchPrompt {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button", { name: "Préparer le métré" }));
    expect(dialogProps).toHaveBeenLastCalledWith(expect.objectContaining({
      currentVersion: { id: VERSION_ID, status: "draft", versionNumber: 1 },
      plansContext: expect.objectContaining({ launchRecommendation: DEFAULT_RECOMMENDATION }),
    }));
    expect(screen.queryByRole("button", { name: "Analyser maintenant" })).not.toBeInTheDocument();
  });
});
