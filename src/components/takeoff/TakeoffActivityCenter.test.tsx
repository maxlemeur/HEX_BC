import { act,cleanup,render,screen } from "@testing-library/react";
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
  reconcileTakeoffJob: vi.fn(),
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
  isLoading?: boolean;
  withPlanSet?: boolean;
  planFileCount?: number;
  secondaryPlanFileCount?: number;
  defaultPlanSetId?: string | null;
}) {
  useSWRMock.mockReturnValue({
    data: input?.response ?? EMPTY_RESPONSE,
    error: undefined,
    isLoading: input?.isLoading ?? false,
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
              fileCount: input?.planFileCount ?? 2,
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
                defaultPlanSetFileCount: input?.planFileCount ?? 2,
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
    vi.useRealTimers();
    cleanup();
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

  it("routes an empty plan set back to plan preparation", () => {
    renderCenter({ withPlanSet: true, planFileCount: 0 });

    expect(
      screen.getByRole("heading", { name: "Ajoutez un PDF pour lancer le métré" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ajouter des plans" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/plans");
  });

  it("offers launch when the default set is empty but another set is ready", () => {
    renderCenter({
      withPlanSet: true,
      planFileCount: 0,
      secondaryPlanFileCount: 3,
    });

    expect(
      screen.getByRole("heading", { name: "Préparez votre premier métré" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Plans plomberie/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Préparer le métré" })
    ).toBeInTheDocument();
  });

  it("announces when analysis loading exceeds the normal delay", () => {
    vi.useFakeTimers();
    renderCenter({ isLoading: true });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Chargement des analyses"
    );
    act(() => vi.advanceTimersByTime(3_000));
    expect(screen.getByRole("status")).toHaveTextContent(
      "Le chargement prend plus de temps que prévu"
    );
  });
});
