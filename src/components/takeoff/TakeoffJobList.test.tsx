import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

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

import TakeoffJobList, {
  resolveTakeoffMaxNavigablePagesByOffset,
  resolveTakeoffJobsRefreshInterval,
} from "@/components/takeoff/TakeoffJobList";
import {
  TakeoffApiError,
  cancelTakeoffJob,
  listTakeoffJobs,
  retryTakeoffJob,
} from "@/lib/takeoff/client";
import type { TakeoffJobListResponse, TakeoffJobSummary } from "@/lib/takeoff/types";

const VERSION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createJob(overrides: Partial<TakeoffJobSummary> = {}): TakeoffJobSummary {
  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    estimate_version_id: overrides.estimate_version_id ?? VERSION_ID,
    status: overrides.status ?? "failed",
    level: overrides.level ?? "A",
    source_file_name: overrides.source_file_name ?? "niveau-a.csv",
    source_file_type: overrides.source_file_type ?? "text/csv",
    source_file_size_bytes: overrides.source_file_size_bytes ?? 1024,
    prompt_version: overrides.prompt_version ?? "takeoff-a-v1",
    schema_version: overrides.schema_version ?? "v1",
    model: overrides.model ?? "gemini-2.5-flash",
    thinking_level: overrides.thinking_level ?? "high",
    media_resolution: overrides.media_resolution ?? null,
    retry_count: overrides.retry_count ?? 1,
    error_code: overrides.error_code ?? "AI_TIMEOUT",
    error_message: overrides.error_message ?? "Timed out",
    next_retry_at: overrides.next_retry_at ?? null,
    last_error_at: overrides.last_error_at ?? null,
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

  it("loads and displays jobs list with counters", async () => {
    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createResponse([createJob({ status: "failed" })])
    );

    renderTakeoffJobList();

    expect(
      await screen.findByText("niveau-a.csv")
    ).toBeInTheDocument();
    expect(screen.getByText("Relancer")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    expect(vi.mocked(listTakeoffJobs)).toHaveBeenCalledWith(
      expect.objectContaining({
        estimate_version_id: VERSION_ID,
        limit: 20,
        offset: 0,
      })
    );
  });

  it("applies filters and pagination on API query", async () => {
    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createResponse(
        [createJob({ status: "failed" })],
        {
          total: 25,
          limit: 20,
          offset: 0,
        }
      )
    );

    const user = userEvent.setup();
    renderTakeoffJobList();

    expect((await screen.findAllByText("niveau-a.csv")).length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Statut"), "failed");
    await waitFor(() => {
      expect(vi.mocked(listTakeoffJobs)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "failed",
          limit: 20,
          offset: 0,
        })
      );
    });

    await user.click(screen.getByRole("button", { name: "Suivant" }));
    await waitFor(() => {
      expect(vi.mocked(listTakeoffJobs)).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "failed",
          limit: 20,
          offset: 20,
        })
      );
    });
  });

  it("triggers retry and cancel quick actions", async () => {
    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createResponse([
        createJob({
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          status: "failed",
        }),
        createJob({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          status: "processing",
          retry_count: 0,
          error_code: null,
          error_message: null,
        }),
      ])
    );
    vi.mocked(retryTakeoffJob).mockResolvedValue({
      job: createJob({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "pending",
      }),
    });
    vi.mocked(cancelTakeoffJob).mockResolvedValue({
      job: createJob({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "canceled",
      }),
    });

    const user = userEvent.setup();
    renderTakeoffJobList();

    expect((await screen.findAllByText("niveau-a.csv")).length).toBeGreaterThan(0);

    const actionButtons = screen.getAllByRole("button", { name: "Relancer" });
    await user.click(actionButtons[0]!);
    await waitFor(() => {
      expect(retryTakeoffJob).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      );
    });

    const cancelButtons = screen.getAllByRole("button", { name: "Annuler" });
    await user.click(cancelButtons[1]!);
    await waitFor(() => {
      expect(cancelTakeoffJob).toHaveBeenCalledWith(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      );
    });
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

    expect(await screen.findByText("Acces refuse")).toBeInTheDocument();
    expect(screen.getByText("Acces interdit.")).toBeInTheDocument();
  });

  it("resolves backend offset ceiling deterministically", () => {
    const maxPages = resolveTakeoffMaxNavigablePagesByOffset(100);
    const maxOffset = (maxPages - 1) * 100;

    expect(maxPages).toBe(101);
    expect(maxOffset).toBe(10_000);
  });

  it("falls back to a safe value when page size is invalid", () => {
    expect(resolveTakeoffMaxNavigablePagesByOffset(0)).toBe(10_001);
    expect(resolveTakeoffMaxNavigablePagesByOffset(Number.NaN)).toBe(10_001);
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
