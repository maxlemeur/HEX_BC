import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/affaires/project-1",
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

vi.mock("@/lib/takeoff/client", () => ({
  listTakeoffJobs: vi.fn(),
  fetchTakeoffRiskRadar: vi.fn(),
}));

import TakeoffExceptionsTab from "@/components/takeoff/TakeoffExceptionsTab";
import {
  fetchTakeoffRiskRadar,
  listTakeoffJobs,
} from "@/lib/takeoff/client";
import type { TakeoffJobListResponse, TakeoffJobSummary } from "@/lib/takeoff/types";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

function createJob(overrides: Partial<TakeoffJobSummary>): TakeoffJobSummary {
  return {
    id: overrides.id ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    estimate_version_id: overrides.estimate_version_id ?? VERSION_ID,
    status: overrides.status ?? "completed",
    level: overrides.level ?? "A",
    processing_strategy: overrides.processing_strategy ?? "sync",
    provider_batch_id: overrides.provider_batch_id ?? null,
    provider_batch_state: overrides.provider_batch_state ?? null,
    provider_batch_updated_at: overrides.provider_batch_updated_at ?? null,
    source_file_name: overrides.source_file_name ?? "source.pdf",
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
    started_at: overrides.started_at ?? null,
    completed_at: overrides.completed_at ?? "2026-03-06T10:00:00.000Z",
    created_at: overrides.created_at ?? "2026-03-06T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-03-06T10:00:00.000Z",
    items_count: overrides.items_count ?? 3,
    metrics: {
      token_count: overrides.metrics?.token_count ?? 120,
      cost_cents: overrides.metrics?.cost_cents ?? 12,
      duration_ms: overrides.metrics?.duration_ms ?? 1100,
    },
    version_number: overrides.version_number ?? 4,
  };
}

function createJobListResponse(jobs: TakeoffJobSummary[]): TakeoffJobListResponse {
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

function createRadarResponse(jobId: string) {
  return {
    version_id: VERSION_ID,
    job_id: jobId,
    summary: {
      to_process_count: 1,
      assumed_count: 0,
      false_positive_count: 0,
      critical_count: 1,
      warning_count: 0,
      info_count: 0,
      top_causes: ["Preuve absente"],
      project_score: 35,
      project_severity: "warning" as const,
    },
    project: {
      scope_type: "project" as const,
      scope_id: PROJECT_ID,
      scope_label: "Affaire",
      score: 35,
      severity: "warning" as const,
      open_alerts_count: 1,
      critical_alerts_count: 1,
      top_causes: ["Preuve absente"],
    },
    lots: [],
    items: [
      {
        alert_id: "risk-1",
        scope_type: "line" as const,
        scope_id: "line-1",
        scope_label: "Doublage acoustique",
        line_id: "line-1",
        lot_id: null,
        cause_code: "missing_proof" as const,
        cause_label: "Preuve absente",
        severity: "critical" as const,
        risk_score: 80,
        status: "to_process" as const,
        margin_bucket: "unknown" as const,
        reason_labels: ["Aucune preuve active"],
        provenance: [
          {
            kind: "fact" as const,
            label: "DPGF",
            source: "dpgf.xlsx",
            confidence_score: null,
            note: null,
          },
        ],
        review_note: null,
        reviewed_at: null,
        reviewed_by: null,
        created_at: "2026-03-06T10:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        metadata: {},
      },
    ],
  };
}

function renderTab() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <TakeoffExceptionsTab projectId={PROJECT_ID} versionId={VERSION_ID} />
    </SWRConfig>
  );
}

describe("TakeoffExceptionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads the newest reviewable job even when the latest job is applied", async () => {
    const appliedJob = createJob({
      id: "applied-job",
      status: "applied",
      created_at: "2026-03-06T12:00:00.000Z",
      updated_at: "2026-03-06T12:00:00.000Z",
    });
    const olderCompletedJob = createJob({
      id: "completed-job",
      status: "completed",
      created_at: "2026-03-05T12:00:00.000Z",
      updated_at: "2026-03-05T12:00:00.000Z",
    });

    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createJobListResponse([appliedJob, olderCompletedJob])
    );
    vi.mocked(fetchTakeoffRiskRadar).mockResolvedValue(createRadarResponse(appliedJob.id));

    renderTab();

    await screen.findByText("Doublage acoustique");

    expect(listTakeoffJobs).toHaveBeenCalledWith({
      estimate_version_id: VERSION_ID,
      limit: 20,
    });
    expect(fetchTakeoffRiskRadar).toHaveBeenCalledWith(appliedJob.id, {
      version_id: appliedJob.estimate_version_id,
      severity: null,
      status: "to_process",
    });
    expect(screen.getByRole("link", { name: "Revoir" })).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}/takeoff/${appliedJob.id}/review?versionId=${appliedJob.estimate_version_id}&line=line-1`
    );
  });

  it("skips newer non-reviewable jobs and falls back to the latest completed one", async () => {
    const processingJob = createJob({
      id: "processing-job",
      status: "processing",
      created_at: "2026-03-06T13:00:00.000Z",
      updated_at: "2026-03-06T13:00:00.000Z",
    });
    const completedJob = createJob({
      id: "completed-job",
      status: "completed",
      created_at: "2026-03-06T12:00:00.000Z",
      updated_at: "2026-03-06T12:00:00.000Z",
    });

    vi.mocked(listTakeoffJobs).mockResolvedValue(
      createJobListResponse([processingJob, completedJob])
    );
    vi.mocked(fetchTakeoffRiskRadar).mockResolvedValue(createRadarResponse(completedJob.id));

    renderTab();

    await waitFor(() => {
      expect(fetchTakeoffRiskRadar).toHaveBeenCalledWith(completedJob.id, {
        version_id: completedJob.estimate_version_id,
        severity: null,
        status: "to_process",
      });
    });
  });
});
