import { cleanup,fireEvent,render,screen } from "@testing-library/react";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

import type { TakeoffRequestActivityResponse } from "@/lib/takeoff/request-activity-contracts";
import { fixtureActivityResponse, fixtureJob, fixtureThreePlans } from "@/lib/takeoff/request-activity.test-fixtures";
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

// The table of items has its own tests (item-table/TakeoffItemTable.test.tsx).
vi.mock("./item-table/TakeoffItemTable", () => ({ TakeoffItemTable: () => null }));

vi.mock("./TakeoffJobsTable", () => ({
  default: ({ data }: { data: TakeoffActivityCenterResponse }) => (
    <table><tbody>{data.jobs.map((job) => <tr key={job.jobId}><td>{job.jobId}</td></tr>)}</tbody></table>
  ),
}));

import TakeoffActivityCenter from "./TakeoffActivityCenter";

// The lists are keyed by the member (here none): another member never gets this answer (fix round 1, point 1).
const SUMMARY_KEY = ["activity-center", "", "project-1", "all", "all", "all", "all", "all", "all", "all", 0, 0, 20];

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
  requestActivity?: TakeoffRequestActivityResponse;
}) {
  useSWRMock.mockImplementation((key: unknown[] | null) => key?.[0] === "takeoff-request-activity" ? {
    // The launch requests of the affaire: none here (TakeoffRequestActivity.test.tsx covers them).
    data: input?.requestActivity, error: undefined, isLoading: false, mutate: vi.fn(),
  } : ({
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
      ["activity-center", "", "project-1", "all", "all", "all", "all", "all", "all", FAILED_JOB_ID, 0, 0, 20],
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

  // Fix round 1, point 4: a link to a job of the latest request keeps the step on that request's plans.
  it("follows the request of the job a link names when it is the latest execution", () => {
    searchParams = new URLSearchParams(`job=${fixtureJob("c")}`);
    renderCenter({ requestActivity: fixtureActivityResponse(fixtureThreePlans(), { view: "job", currentIsLatest: true }) });
    expect(screen.getByRole("heading", { name: "Premiers plans prêts à revoir" })).toBeVisible();
    cleanup();
    // An older request named by a link leaves the step to the affaire's own latest state.
    renderCenter({ requestActivity: fixtureActivityResponse(fixtureThreePlans(), { view: "job", currentIsLatest: false }) });
    expect(screen.queryByRole("heading", { name: "Premiers plans prêts à revoir" })).toBeNull();
  });

  // Lot 3 PR 4 changes this on purpose: the list of analyses no longer polls on its own (it was read every 20 s while a row
  // waited). The page's one poll is the light read of the launch requests, whose interval comes from its own answer; the
  // list is read again when that answer reports a transition (TakeoffActivityCenter.polling.test.tsx runs the real hook).
  it("never polls the list of analyses itself, even while a row waits; only the light read polls", () => {
    const waiting = { ...EMPTY_RESPONSE, jobs: [{ jobId: "job-1", statusRaw: "action_required", technicalStatusRaw: "failed",
      resume: { action: "wait_retry", reason: "retry_scheduled", availableAt: "2020-01-01T00:00:00.000Z" } }] } as unknown as TakeoffActivityCenterResponse;
    const lightWaiting = { view: "current", observedAt: "2026-11-21T10:00:00.000Z", live: true, signature: "a", current: null,
      history: [], historyHasOlder: false, historyOffset: 0, standalone: { running: 0, waiting: 1 }, elsewhere: { running: false, waiting: false }, currentIsLatest: false,
      inFlightJobIds: [], reused: { dossierPosition: null, dossier: false, actionKey: null, action: false } } satisfies TakeoffRequestActivityResponse;
    renderCenter({ response: waiting, requestActivity: lightWaiting });
    const intervals = (scope: string, view?: string) => useSWRMock.mock.calls
      .filter(([key]) => Array.isArray(key) && key[0] === scope && (view === undefined || key[3] === view))
      .map(([, , options]) => (options as { refreshInterval?: number }).refreshInterval ?? 0);
    // The counterexample of the former rule: a waiting row no longer gives the list an interval.
    expect(new Set(intervals("activity-center"))).toEqual(new Set([0]));
    expect(intervals("takeoff-request-activity", "current").at(-1)).toBe(30_000);
    // The older requests are never polled.
    expect(new Set(intervals("takeoff-request-activity", "history"))).toEqual(new Set([0]));
  });
});
