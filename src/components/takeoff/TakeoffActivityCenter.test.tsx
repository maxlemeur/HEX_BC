import { cleanup,fireEvent,render,screen } from "@testing-library/react";
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

vi.mock("./TakeoffJobsTable", () => ({
  default: ({ data }: { data: TakeoffActivityCenterResponse }) => (
    <table><tbody>{data.jobs.map((job) => <tr key={job.jobId}><td>{job.jobId}</td></tr>)}</tbody></table>
  ),
}));

import TakeoffActivityCenter from "./TakeoffActivityCenter";

const SUMMARY_KEY = ["activity-center", "project-1", "all", "all", "all", "all", "all", "all", "all", 0, 0, 20];

const EMPTY_RESPONSE: TakeoffActivityCenterResponse = {
  analysisCompletions: [],
  analysisCompletionsHasOlder: false,
  counters: {
    technicalJobs: 0,
    usableJobs: 0,
    blockingExceptionsJobs: 0,
  },
  jobs: [],
  pagination: { limit: 20, offset: 0, total: 0 },
};

const FAILED_JOB_ID = "a1000000-0000-4000-8000-000000000006";

function renderCenter(input?: {
  response?: TakeoffActivityCenterResponse;
  /** The list request's answer, when it differs from the summary's. */
  listResponse?: TakeoffActivityCenterResponse;
  withPlanSet?: boolean;
  secondaryPlanFileCount?: number;
  defaultPlanSetId?: string | null;
}) {
  useSWRMock.mockImplementation((key: unknown[] | null) => ({
    // The summary is the unfiltered first page; the list is the request of the current view.
    data: key && JSON.stringify(key) !== JSON.stringify(SUMMARY_KEY) && input?.listResponse
      ? input.listResponse
      : input?.response ?? EMPTY_RESPONSE,
    error: undefined,
    isLoading: false,
  }));

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
      eventId: "event-1", outcome: "success", finishedAt: "2026-11-20T08:00:00.000Z", failureReason: null,
    }] } });
    expect(screen.getByRole("list", { name: "Fins d’analyse de l’affaire" })).toHaveTextContent("Analyse terminée");
    expect(screen.queryByRole("link", { name: "Revue" })).not.toBeInTheDocument();
  });

  it("shows the end a failure link names, with its French reason, to a reader the job is hidden from", () => {
    searchParams = new URLSearchParams(`job=${FAILED_JOB_ID}`);
    const failure = { eventId: "event-2", outcome: "failure" as const, finishedAt: "2026-11-19T08:00:00.000Z",
      failureReason: "Le service d’analyse n’a pas pu terminer le métré." };
    renderCenter({
      response: { ...EMPTY_RESPONSE, analysisCompletions: [{
        eventId: "event-1", outcome: "success", finishedAt: "2026-11-20T08:00:00.000Z", failureReason: null,
      }] },
      listResponse: { ...EMPTY_RESPONSE, analysisCompletions: [failure] },
    });
    // The list request names the job: an older failure is never off the first page.
    expect(useSWRMock.mock.calls.map(([key]) => key)).toContainEqual(
      ["activity-center", "project-1", "all", "all", "all", "all", "all", "all", FAILED_JOB_ID, 0, 0, 20],
    );
    const selected = screen.getByRole("list", { name: "Analyse sélectionnée" });
    expect(selected).toHaveTextContent("Analyse échouée");
    expect(selected).toHaveTextContent("Le service d’analyse n’a pas pu terminer le métré.");
    expect(screen.queryByRole("list", { name: "Fins d’analyse de l’affaire" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Voir toutes les analyses" }));
    expect(routerPushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1/takeoff", { scroll: false });
  });

  it("says so when the job a link names is not visible", () => {
    searchParams = new URLSearchParams(`job=${FAILED_JOB_ID}`);
    renderCenter({ listResponse: EMPTY_RESPONSE });
    expect(screen.getByText("Cette analyse n’est pas visible avec votre profil, ou elle n’existe plus.")).toBeInTheDocument();
  });

  it("pages the shared ends for a reader who sees no job", () => {
    const page = (ids: string[], hasOlder: boolean): TakeoffActivityCenterResponse => ({
      ...EMPTY_RESPONSE, analysisCompletionsHasOlder: hasOlder,
      analysisCompletions: ids.map((eventId) => ({ eventId, outcome: "failure" as const,
        finishedAt: "2026-11-20T08:00:00.000Z", failureReason: "Le service d’analyse n’a pas pu terminer le métré." })),
    });
    renderCenter({ response: page(["event-1"], true), listResponse: page(["event-1"], true) });
    const shared = screen.getByRole("list", { name: "Fins d’analyse de l’affaire" });
    expect(shared).toHaveTextContent("Le service d’analyse n’a pas pu terminer le métré.");
    expect(screen.queryByRole("button", { name: "Plus récentes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Plus anciennes" }));
    expect(routerPushMock).toHaveBeenCalledWith("/dashboard/affaires/project-1/takeoff?ends=20", { scroll: false });
    cleanup();

    searchParams = new URLSearchParams("ends=20");
    renderCenter({ response: page(["event-1"], true), listResponse: page(["event-21"], false) });
    expect(screen.getByRole("list", { name: "Fins d’analyse de l’affaire" })).toHaveTextContent("Analyse échouée");
    expect(screen.queryByRole("button", { name: "Plus anciennes" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Plus récentes" }));
    expect(routerPushMock).toHaveBeenLastCalledWith("/dashboard/affaires/project-1/takeoff", { scroll: false });
  });

  it("shows every end the reader may see beside the one job they can read", () => {
    const readable = { jobId: "a1000000-0000-4000-8000-000000000009" } as TakeoffActivityCenterResponse["jobs"][number];
    const ends: TakeoffActivityCenterResponse = {
      ...EMPTY_RESPONSE, jobs: [readable], pagination: { limit: 20, offset: 0, total: 1 }, analysisCompletionsHasOlder: true,
      analysisCompletions: [{ eventId: "event-hidden", outcome: "failure", finishedAt: "2026-11-18T08:00:00.000Z",
        failureReason: "Le service d’analyse n’a pas pu terminer le métré." }],
    };
    renderCenter({ response: ends, listResponse: ends });
    expect(screen.getByText(readable.jobId)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Fins d’analyse de l’affaire" }))
      .toHaveTextContent("Le service d’analyse n’a pas pu terminer le métré.");
    expect(screen.getByRole("button", { name: "Plus anciennes" })).toBeInTheDocument();
  });

  it("keeps the affaire's ends and their pager under a job filter", () => {
    searchParams = new URLSearchParams("status=failed");
    const matching = { jobId: "a1000000-0000-4000-8000-000000000010" } as TakeoffActivityCenterResponse["jobs"][number];
    const filtered: TakeoffActivityCenterResponse = {
      ...EMPTY_RESPONSE, jobs: [matching], pagination: { limit: 20, offset: 0, total: 1 }, analysisCompletionsHasOlder: true,
      analysisCompletions: [{ eventId: "event-older", outcome: "success", finishedAt: "2026-11-17T08:00:00.000Z", failureReason: null }],
    };
    renderCenter({ response: filtered, listResponse: filtered });
    expect(screen.getByText(matching.jobId)).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Fins d’analyse de l’affaire" })).toHaveTextContent("Analyse terminée");
    expect(screen.getByRole("button", { name: "Plus anciennes" })).toBeInTheDocument();
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
});
