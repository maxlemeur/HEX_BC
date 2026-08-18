import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const RESPONSE_WITH_JOB: TakeoffActivityCenterResponse = {
  counters: {
    technicalJobs: 0,
    usableJobs: 1,
    blockingExceptionsJobs: 0,
  },
  jobs: [
    {
      jobId: "job-1",
      estimateVersionId: "version-1",
      versionLabel: "V1",
      lotLabel: null,
      planSetLabel: "Plans architecte",
      levelLabel: "Standard",
      processingStrategy: "sync",
      providerBatchState: null,
      providerBatchUpdatedAt: null,
      statusLabel: "Terminée",
      statusRaw: "completed",
      technicalStatusRaw: "completed",
      itemCount: 12,
      coveragePercent: 80,
      exceptionCount: 0,
      confidenceLabel: "Élevée",
      appliedCount: 0,
      createdAt: "2026-07-10T08:00:00.000Z",
      carriedOverFrom: null,
      neverApplied: true,
      retryCount: 0,
      dispatchStatus: null,
      dispatchOutcome: null,
      dispatchCorrelationId: null,
      dispatchUpdatedAt: null,
    },
  ],
  pagination: { limit: 20, offset: 0, total: 1 },
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

  it("guides an initial empty project to its plan sets without showing filters or counters", () => {
    renderCenter();

    expect(
      screen.getByRole("heading", { name: "Ajoutez vos plans pour commencer" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ajouter un jeu de plans" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/plans");
    expect(screen.queryByLabelText("Version")).not.toBeInTheDocument();
    expect(screen.queryByText("Analyses en cours")).not.toBeInTheDocument();
  });

  it("opens the existing launch flow when a plan set is ready", async () => {
    const user = userEvent.setup();
    renderCenter({ withPlanSet: true });

    expect(
      screen.getByRole("heading", { name: "Prêt pour votre premier métré" })
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Lancer le premier métré" })
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Lancement du premier métré"
    );
  });

  it("opens a deep-linked plan set directly from the plans page", () => {
    searchParams = new URLSearchParams(
      "launch=1&launchPlanSet=plan-set-1",
    );

    renderCenter({ withPlanSet: true });

    expect(screen.getByRole("dialog")).toHaveTextContent("plan-set-1");
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
      screen.getByRole("heading", { name: "Prêt pour votre premier métré" })
    ).toBeInTheDocument();
    expect(screen.getByText(/Plans plomberie/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lancer le premier métré" })
    ).toBeInTheDocument();
  });

  it("keeps a filtered empty state distinct and lets the user reset it", async () => {
    const user = userEvent.setup();
    searchParams = new URLSearchParams("status=completed");
    renderCenter();

    expect(
      screen.getByRole("heading", { name: "Aucune analyse ne correspond" })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Statut")).toBeInTheDocument();
    expect(screen.queryByText("Analyses en cours")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Réinitialiser les filtres" })
    );

    expect(routerPushMock).toHaveBeenCalledWith(
      "/dashboard/affaires/project-1/takeoff",
      {
        scroll: false,
      }
    );
  });

  it("shows filters and counters once analyses exist", () => {
    renderCenter({ response: RESPONSE_WITH_JOB, withPlanSet: true });

    expect(
      screen.getByRole("button", { name: "Filtres" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("takeoff-analysis-filters")).toHaveClass(
      "hidden"
    );
    expect(screen.getByLabelText("Version")).toBeInTheDocument();
    expect(screen.getByText("Analyses en cours")).toBeInTheDocument();
    expect(screen.getByText("Analyses exploitables")).toBeInTheDocument();
    expect(screen.getAllByText("Plans architecte").length).toBeGreaterThan(0);
  });

  it("shows persisted automatic recovery for a delayed start", () => {
    renderCenter({
      response: {
        ...RESPONSE_WITH_JOB,
        jobs: [
          {
            ...RESPONSE_WITH_JOB.jobs[0],
            dispatchStatus: "trigger_failed",
            dispatchOutcome: "timeout",
            dispatchCorrelationId: "dispatch-follow-up-456",
          },
        ],
      },
      withPlanSet: true,
    });

    expect(screen.getAllByText("Reprise automatique")).toHaveLength(2);
    expect(screen.getByText(/dispatch-follow-up-456/)).toBeInTheDocument();
  });

  it("shows an unavailable DPGF coverage without an error alert", () => {
    renderCenter({
      response: {
        ...RESPONSE_WITH_JOB,
        jobs: [
          {
            ...RESPONSE_WITH_JOB.jobs[0],
            coveragePercent: null,
          },
        ],
      },
      withPlanSet: true,
    });

    const coverageValues = screen.getAllByText("Aucun DPGF");
    expect(coverageValues).toHaveLength(2);
    for (const value of coverageValues) {
      expect(value).not.toHaveClass("text-[var(--error)]");
    }
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("expands analysis filters on demand and keeps them out of Exceptions", async () => {
    const user = userEvent.setup();
    renderCenter({ response: RESPONSE_WITH_JOB, withPlanSet: true });

    const filterToggle = screen.getByRole("button", { name: "Filtres" });
    await user.click(filterToggle);

    expect(filterToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("takeoff-analysis-filters")).toHaveClass("grid");

    cleanup();
    searchParams = new URLSearchParams("tab=exceptions");
    renderCenter({ response: RESPONSE_WITH_JOB, withPlanSet: true });

    expect(screen.getByRole("tab", { name: "Exceptions" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.queryByLabelText("Version")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Filtres" })
    ).not.toBeInTheDocument();
  });

  it("gives every activity tab a mobile-sized touch target", () => {
    renderCenter();

    for (const label of ["Analyses", "Exceptions", "Historique"]) {
      expect(screen.getByRole("tab", { name: label })).toHaveClass("min-h-11");
    }
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
