import { cleanup,render,screen } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";

vi.mock("@/lib/takeoff/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/takeoff/client")>(
    "@/lib/takeoff/client"
  );

  return {
    ...actual,
    listTakeoffJobs: vi.fn(),
    retryTakeoffJob: vi.fn(),
    cancelTakeoffJob: vi.fn(),
  };
});

import TakeoffJobList from "@/components/takeoff/TakeoffJobList";
import {
resolveTakeoffJobsRefreshInterval,
resolveTakeoffMaxNavigablePagesByOffset,
} from "@/components/takeoff/takeoff-job-list-shared";
import {
TakeoffApiError,
listTakeoffJobs
} from "@/lib/takeoff/client";
import type { TakeoffJobListResponse,TakeoffJobSummary } from "@/lib/takeoff/types";

const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createJob(overrides: Partial<TakeoffJobSummary> = {}): TakeoffJobSummary {
  const status = overrides.status ?? "failed";

  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    estimate_version_id: overrides.estimate_version_id ?? VERSION_ID,
    status,
    level: overrides.level ?? "A",
    processing_strategy: overrides.processing_strategy ?? "sync",
    provider_batch_id: overrides.provider_batch_id ?? null,
    provider_batch_state: overrides.provider_batch_state ?? null,
    provider_batch_updated_at: overrides.provider_batch_updated_at ?? null,
    source_file_name: overrides.source_file_name ?? "niveau-a.csv",
    source_file_type: overrides.source_file_type ?? "text/csv",
    source_file_size_bytes: overrides.source_file_size_bytes ?? 1024,
    plan_set_id: overrides.plan_set_id ?? null,
    prompt_version: overrides.prompt_version ?? "takeoff-a-v1",
    schema_version: overrides.schema_version ?? "v1",
    model: overrides.model ?? "gemini-3-flash-preview",
    thinking_level: overrides.thinking_level ?? "high",
    media_resolution: overrides.media_resolution ?? null,
    retry_count: overrides.retry_count ?? 1,
    error_code: overrides.error_code ?? "AI_TIMEOUT",
    error_message: overrides.error_message ?? "Timed out",
    next_retry_at: overrides.next_retry_at ?? null,
    last_error_at: overrides.last_error_at ?? null,
    can_cancel:
      overrides.can_cancel ??
      (status === "pending" || status === "processing"),
    can_resubmit:
      overrides.can_resubmit ??
      (status === "failed" || status === "canceled"),
    started_at: overrides.started_at ?? null,
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? "2026-02-25T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-02-25T10:00:00.000Z",
    items_count: overrides.items_count ?? 3,
    metrics: {
      token_count: overrides.metrics?.token_count ?? 120,
      cost_cents: overrides.metrics?.cost_cents ?? 12,
      duration_ms: overrides.metrics?.duration_ms ?? 1100,
    },
  };
}

function createResponse(
  jobs: TakeoffJobSummary[],
  overrides?: Partial<TakeoffJobListResponse["pagination"]>
): TakeoffJobListResponse {
  return {
    jobs,
    counters: {
      total: jobs.length,
      processing: jobs.filter((job) => job.status === "processing").length,
      completed: jobs.filter((job) => job.status === "completed").length,
      failed: jobs.filter((job) => job.status === "failed").length,
      canceled: jobs.filter((job) => job.status === "canceled").length,
    },
    pagination: {
      limit: overrides?.limit ?? 20,
      offset: overrides?.offset ?? 0,
      total: overrides?.total ?? jobs.length,
    },
  };
}

function renderTakeoffJobList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TakeoffJobList versionId={VERSION_ID} />
    </SWRConfig>
  );
}

describe("TakeoffJobList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("hides retry and cancel actions when the backend marks them unavailable", async () => {
    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createResponse([
        createJob({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          status: "failed",
          can_resubmit: false,
        }),
        createJob({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          status: "processing",
          retry_count: 0,
          error_code: null,
          error_message: null,
          can_cancel: false,
        }),
      ])
    );

    renderTakeoffJobList();

    expect((await screen.findAllByText("niveau-a.csv")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Relancer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
  });

  // M1b : « Plan R+1.pdf » et « Plan R-1.pdf » ont le même nom nettoyé ; la comparaison suit le
  // jeu de plans, ou le libellé d'un fichier téléversé, comme le serveur.
  it("offers to compare jobs of the same document only", async () => {
    const planSetId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const otherPlanSetId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const done = { status: "completed" as const, error_code: null, error_message: null };
    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createResponse([
        createJob({ ...done, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", plan_set_id: planSetId, source_file_name: "Plan R+1.pdf" }),
        createJob({ ...done, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", plan_set_id: planSetId, source_file_name: "Plan-R-1.pdf" }),
        createJob({ ...done, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3", plan_set_id: otherPlanSetId, source_file_name: "Plan-R-1.pdf" }),
        createJob({ ...done, id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4", source_file_name: "Plan R+1.pdf" }),
      ])
    );

    renderTakeoffJobList();

    const links = await screen.findAllByRole("link", { name: "Comparer" });
    expect(
      links.map((link) => {
        const href = new URL(link.getAttribute("href") ?? "", "http://localhost");
        return [href.pathname.split("/").at(-2), href.searchParams.get("compareWith")];
      })
    ).toEqual([
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"],
      ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
    ]);
  });

  it("renders a dedicated message for 403/404 errors", async () => {
    vi.mocked(listTakeoffJobs).mockRejectedValue(
      new TakeoffApiError(
        "Acces interdit.",
        403,
        null,
        "TAKEOFF_MODULE_DISABLED"
      )
    );

    renderTakeoffJobList();

    expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
    expect(screen.getByText("Acces interdit.")).toBeInTheDocument();
  });

  it("resolves backend offset ceiling deterministically", () => {
    const maxPages = resolveTakeoffMaxNavigablePagesByOffset(100);
    const maxOffset = (maxPages - 1) * 100;

    expect(maxPages).toBe(101);
    expect(maxOffset).toBe(10_000);
  });

  it("returns no polling interval when no in-flight jobs are present", () => {
    expect(
      resolveTakeoffJobsRefreshInterval({
        counters: { processing: 0 },
        jobs: [{ status: "completed" }],
      })
    ).toBe(0);
  });

  it("returns polling interval when jobs are in-flight", () => {
    expect(
      resolveTakeoffJobsRefreshInterval({
        counters: { processing: 1 },
        jobs: [{ status: "completed" }],
      })
    ).toBe(20_000);
    expect(
      resolveTakeoffJobsRefreshInterval({
        counters: { processing: 0 },
        jobs: [{ status: "pending" }],
      })
    ).toBe(20_000);
  });
});
