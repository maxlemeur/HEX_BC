import { cleanup,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import type { TakeoffActivityCenterResponse } from "@/lib/takeoff/types";

const useSWRMock = vi.hoisted(() => vi.fn());
const routerPushMock = vi.hoisted(() => vi.fn());
let searchParams = new URLSearchParams();

vi.mock("swr", () => ({
  default: useSWRMock,
  useSWRConfig: () => ({ mutate: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires/project-1/takeoff",
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => searchParams,
}));

vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffActivityCenter: vi.fn(),
  isTakeoffApiError: () => false,
  cancelTakeoffJob: vi.fn(),
  resubmitTakeoffJob: vi.fn(),
}));

vi.mock("@/components/affaires/LaunchMetreDialog", () => ({
  LaunchMetreDialog: ({
    open,
    initialPlanSetId,
  }: {
    open: boolean;
    initialPlanSetId?: string | null;
  }) =>
    open ? (
      <div role="dialog">
        Lancement du premier métré · {initialPlanSetId ?? "défaut"}
      </div>
    ) : null,
}));

vi.mock("./TakeoffExceptionsTab", () => ({
  default: () => <div>Exceptions</div>,
}));

vi.mock("./TakeoffApplicationHistoryTab", () => ({
  default: () => <div>Historique</div>,
}));

import TakeoffActivityCenter from "./TakeoffActivityCenter";

const EMPTY_RESPONSE: TakeoffActivityCenterResponse = {
  analysisCompletions: [],
  counters: {
    technicalJobs: 0,
    usableJobs: 0,
    blockingExceptionsJobs: 0,
  },
  jobs: [],
  pagination: { limit: 20, offset: 0, total: 0 },
};

function renderCenter(input?: {
  response?: TakeoffActivityCenterResponse;
  withPlanSet?: boolean;
  secondaryPlanFileCount?: number;
  defaultPlanSetId?: string | null;
}) {
  useSWRMock.mockReturnValue({
    data: input?.response ?? EMPTY_RESPONSE,
    error: undefined,
    isLoading: false,
  });

  const withPlanSet = input?.withPlanSet ?? false;

  return render(
    <TakeoffActivityCenter
      projectId="project-1"
      versions={[{ id: "version-1", version_number: 1 }]}
      planSets={withPlanSet
        ? [
            {
              id: "plan-set-1",
              name: "Plans architecte",
              metadata: {},
              fileCount: 2,
            },
            ...(input?.secondaryPlanFileCount === undefined
              ? []
              : [
                  {
                    id: "plan-set-2",
                    name: "Plans plomberie",
                    metadata: {},
                    fileCount: input.secondaryPlanFileCount,
                  },
                ]),
          ]
        : []}
      launchContext={
        withPlanSet
          ? {
              currentVersion: {
                id: "version-1",
                status: "draft",
                versionNumber: 1,
              },
              plansContext: {
                defaultPlanSetId:
                  input?.defaultPlanSetId === undefined
                    ? "plan-set-1"
                    : input.defaultPlanSetId,
                defaultPlanSetName: "Plans architecte",
                defaultPlanSetFileCount: 2,
              },
              availableVersions: [{ id: "version-1", versionNumber: 1 }],
            }
          : null
      }
    />
  );
}

describe("TakeoffActivityCenter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchParams = new URLSearchParams();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows the shared end when the reader has no access to the underlying job", () => {
    renderCenter({ response: { ...EMPTY_RESPONSE, analysisCompletions: [{
      eventId: "event-1", outcome: "success", finishedAt: "2026-11-20T08:00:00.000Z",
    }] } });
    expect(screen.getByRole("list", { name: "Fins d’analyse de l’affaire" })).toHaveTextContent("Analyse terminée");
    expect(screen.queryByRole("link", { name: "Revue" })).not.toBeInTheDocument();
  });

  it("opens a usable non-default plan set from a deep link", () => {
    searchParams = new URLSearchParams(
      "launch=1&launchPlanSet=plan-set-2"
    );

    renderCenter({
      withPlanSet: true,
      defaultPlanSetId: null,
      secondaryPlanFileCount: 3,
    });

    expect(screen.getByRole("dialog")).toHaveTextContent("plan-set-2");
  });

  // Fix round 1, point 3, then round 2: a row that waits keeps the list read until what it waits for happened. The page
  // passes SWR an interval set from the data it has (TakeoffActivityCenter.polling.test.tsx runs the real hook).
  it("asks for polling while a stopped analysis waits for its retry, and not after", () => {
    const waiting = { ...EMPTY_RESPONSE, jobs: [{ jobId: "job-1", statusRaw: "action_required", technicalStatusRaw: "failed",
      resume: { action: "wait_retry", reason: "retry_scheduled", availableAt: "2020-01-01T00:00:00.000Z" } }] } as unknown as TakeoffActivityCenterResponse;
    const final = { ...EMPTY_RESPONSE, jobs: [{ jobId: "job-1", statusRaw: "action_required", technicalStatusRaw: "failed",
      resume: { action: "new_analysis", reason: "analysis_closed", availableAt: null } }] } as unknown as TakeoffActivityCenterResponse;
    const lastIntervals = () => useSWRMock.mock.calls.slice(-2).map(([, , options]) => (options as { refreshInterval: number }).refreshInterval);

    const { rerender } = renderCenter({ response: waiting });
    expect(lastIntervals()).toEqual([20_000, 20_000]);

    useSWRMock.mockReturnValue({ data: final, error: undefined, isLoading: false });
    rerender(<TakeoffActivityCenter projectId="project-1" versions={[{ id: "version-1", version_number: 1 }]} planSets={[]} launchContext={null} />);
    expect(lastIntervals()).toEqual([0, 0]);
  });
});
