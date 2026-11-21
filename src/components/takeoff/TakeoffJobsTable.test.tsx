import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TakeoffActivityCenterJobRow, TakeoffActivityCenterResponse } from "@/lib/takeoff/types";

const mutate = vi.hoisted(() => vi.fn());
const resubmitTakeoffJob = vi.hoisted(() => vi.fn());
vi.mock("swr", () => ({ useSWRConfig: () => ({ mutate }) }));
vi.mock("@/lib/takeoff/client", () => {
  class TakeoffApiError extends Error {
    constructor(message: string, readonly status: number, readonly details: unknown, readonly code: string | null) { super(message); }
  }
  return {
    TakeoffApiError,
    isTakeoffApiError: (error: unknown) => error instanceof TakeoffApiError,
    cancelTakeoffJob: vi.fn(),
    resubmitTakeoffJob,
  };
});

import { TakeoffApiError } from "@/lib/takeoff/client";
import TakeoffJobsTable from "./TakeoffJobsTable";

function job(patch: Partial<TakeoffActivityCenterJobRow>): TakeoffActivityCenterJobRow {
  return {
    jobId: "11111111-1111-4111-8111-111111111111", analysisCompletion: null, estimateVersionId: null, versionLabel: "Sans devis",
    lotLabel: null, planSetLabel: null, levelLabel: "Détaillé", processingStrategy: "sync", providerBatchState: null,
    providerBatchUpdatedAt: null, statusLabel: "Échec à corriger", statusRaw: "action_required", technicalStatusRaw: "failed",
    canCancel: false, canResubmit: false, resume: { action: "none", reason: "read_only", availableAt: null }, errorCode: "AI_PROVIDER",
    nextRetryAt: null, itemCount: 0, coveragePercent: null, exceptionCount: 0, confidenceLabel: "Faible", appliedCount: 0,
    createdAt: "2026-11-20T07:00:00.000Z", carriedOverFrom: null, neverApplied: false, retryCount: 0,
    ...patch,
  };
}

function response(jobs: TakeoffActivityCenterJobRow[]): TakeoffActivityCenterResponse {
  return { counters: { technicalJobs: 0, usableJobs: 0, blockingExceptionsJobs: 0 }, jobs, analysisCompletions: [],
    pagination: { limit: 10, offset: 0, total: jobs.length } };
}

function renderTable(data: TakeoffActivityCenterResponse) {
  return render(<TakeoffJobsTable projectId="project-1" data={data} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} pageSize={10} />);
}

describe("TakeoffJobsTable", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Fix round 1, point 1: a deferred start is announced only while the decision expects one.
  it("announces no automatic start beside a final decision", () => {
    renderTable(response([job({ technicalStatusRaw: "canceled", statusLabel: "Échec à corriger", errorCode: null,
      dispatchStatus: "queued", dispatchCorrelationId: "22222222-2222-4222-8222-222222222222",
      resume: { action: "new_analysis", reason: "analysis_closed", availableAt: null } })]));
    expect(screen.queryByText("Reprise automatique")).not.toBeInTheDocument();
    expect(screen.queryByText("Démarrage différé")).not.toBeInTheDocument();
  });

  it("keeps announcing the deferred start of a queued analysis", () => {
    renderTable(response([job({ technicalStatusRaw: "pending", statusRaw: "queued", statusLabel: "En file", errorCode: null,
      dispatchStatus: "queued", dispatchCorrelationId: "22222222-2222-4222-8222-222222222222",
      resume: { action: "none", reason: "not_stopped", availableAt: null } })]));
    expect(screen.getAllByText("Reprise automatique").length).toBeGreaterThan(0);
  });

  // Fix round 1, point 3: a refusal carries the decision now in force; the row adopts it and the list is read again.
  it("adopts the decision a refusal carries and reads the list again", async () => {
    const before = response([job({ canResubmit: true, resume: { action: "retry_now", reason: "retry_available", availableAt: null } })]);
    resubmitTakeoffJob.mockRejectedValue(new TakeoffApiError("Ce profil ne peut pas relancer l’analyse.", 403,
      { resume: { action: "none", reason: "read_only", available_at: null } }, "FORBIDDEN"));
    const { rerender } = renderTable(before);

    fireEvent.click(screen.getAllByRole("button", { name: "Soumettre à nouveau" })[0]);
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    const adopt = mutate.mock.calls.find(([, data]) => typeof data === "function");
    if (!adopt) throw new Error("The refusal's decision was not adopted.");
    const [filter, update, options] = adopt as [(key: unknown) => boolean, (data: TakeoffActivityCenterResponse) => TakeoffActivityCenterResponse,
      { revalidate: boolean }];
    expect(filter(["activity-center", "project-1"])).toBe(true);
    expect(options).toMatchObject({ revalidate: true });
    const after = update(before);
    expect(after.jobs[0]).toMatchObject({ canResubmit: false, resume: { action: "none", reason: "read_only", availableAt: null } });
    rerender(<TakeoffJobsTable projectId="project-1" data={after} onPageChange={vi.fn()} onPageSizeChange={vi.fn()} pageSize={10} />);
    expect(screen.queryByRole("button", { name: "Soumettre à nouveau" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur.").length).toBeGreaterThan(0);
  });

  it("reads the list again after a refusal without a decision", async () => {
    resubmitTakeoffJob.mockRejectedValue(new TakeoffApiError("Refus.", 422, null, "AI_PROVIDER"));
    renderTable(response([job({ canResubmit: true, resume: { action: "retry_now", reason: "retry_available", availableAt: null } })]));

    fireEvent.click(screen.getAllByRole("button", { name: "Soumettre à nouveau" })[0]);
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls.some(([filter, data]) => typeof filter === "function" && data === undefined)).toBe(true);
  });

  // Fix round 2, point 1: the removed provider's batch badges say nothing about a stopped analysis.
  it("shows no batch progress or reconciliation beside a stopped analysis of the former provider", () => {
    renderTable(response([job({ processingStrategy: "batch", providerBatchState: "running", operatorState: "orphan_to_reconcile",
      errorCode: "AI_TIMEOUT", resume: { action: "new_analysis", reason: "legacy_provider", availableAt: null } })]));
    expect(screen.queryByText("Reprise à vérifier")).not.toBeInTheDocument();
    expect(screen.queryByText("Analyse en cours")).not.toBeInTheDocument();
    expect(screen.getAllByText(/^Ce fournisseur IA ne permet plus de relancer cette analyse\./).length).toBeGreaterThan(0);
  });
});
