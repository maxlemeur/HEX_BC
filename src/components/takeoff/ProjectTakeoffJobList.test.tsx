import { cleanup, render, screen } from "@testing-library/react";
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

vi.mock("@/components/takeoff/TakeoffExceptionsTab", () => ({
  __esModule: true,
  default: () => null,
}));

import ProjectTakeoffJobList from "@/components/takeoff/ProjectTakeoffJobList";
import { listTakeoffJobs } from "@/lib/takeoff/client";
import type { TakeoffJobListResponse, TakeoffJobSummary } from "@/lib/takeoff/types";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

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
    source_file_name: overrides.source_file_name ?? "plan.pdf",
    source_file_type: overrides.source_file_type ?? "application/pdf",
    source_file_size_bytes: overrides.source_file_size_bytes ?? 1024,
    prompt_version: overrides.prompt_version ?? "takeoff-a-v1",
    schema_version: overrides.schema_version ?? "v1",
    model: overrides.model ?? "gemini-3-flash-preview",
    thinking_level: overrides.thinking_level ?? "high",
    media_resolution: overrides.media_resolution ?? null,
    retry_count: overrides.retry_count ?? 0,
    error_code: overrides.error_code ?? null,
    error_message: overrides.error_message ?? null,
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
    created_at: overrides.created_at ?? "2026-03-06T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-06T10:00:00.000Z",
    items_count: overrides.items_count ?? 3,
    version_number: overrides.version_number ?? 4,
    metrics: {
      token_count: overrides.metrics?.token_count ?? 120,
      cost_cents: overrides.metrics?.cost_cents ?? 12,
      duration_ms: overrides.metrics?.duration_ms ?? 1100,
    },
  };
}

function createResponse(jobs: TakeoffJobSummary[]): TakeoffJobListResponse {
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
      limit: 20,
      offset: 0,
      total: jobs.length,
    },
  };
}

function renderProjectTakeoffJobList() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProjectTakeoffJobList
        projectId={PROJECT_ID}
        versions={[{ id: VERSION_ID, version_number: 4 }]}
      />
    </SWRConfig>
  );
}

describe("ProjectTakeoffJobList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
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
          can_cancel: false,
        }),
      ])
    );

    renderProjectTakeoffJobList();

    expect((await screen.findAllByText("plan.pdf")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Relancer" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler" })).not.toBeInTheDocument();
  });
});
