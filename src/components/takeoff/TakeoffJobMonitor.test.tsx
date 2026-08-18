import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TakeoffJobDetailResponse } from "@/lib/takeoff/client";
import TakeoffJobMonitor from "@/components/takeoff/TakeoffJobMonitor";

const useTakeoffJobPollingMock = vi.hoisted(() => vi.fn());
const applyTakeoffJobMock = vi.hoisted(() => vi.fn());
const cancelTakeoffJobMock = vi.hoisted(() => vi.fn());
const reconcileTakeoffJobMock = vi.hoisted(() => vi.fn());
const resubmitTakeoffJobMock = vi.hoisted(() => vi.fn());
const acquireEstimateDraftLockMock = vi.hoisted(() => vi.fn());
const renewEstimateDraftLockMock = vi.hoisted(() => vi.fn());
const releaseEstimateDraftLockMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/takeoff/use-takeoff-job-polling", () => ({
  useTakeoffJobPolling: useTakeoffJobPollingMock,
}));

vi.mock("@/lib/takeoff/client", () => ({
  applyTakeoffJob: applyTakeoffJobMock,
  cancelTakeoffJob: cancelTakeoffJobMock,
  reconcileTakeoffJob: reconcileTakeoffJobMock,
  resubmitTakeoffJob: resubmitTakeoffJobMock,
  isTakeoffApiError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "__takeoffApiError" in error &&
        (error as { __takeoffApiError?: boolean }).__takeoffApiError
    ),
}));

vi.mock("@/lib/estimates/client", () => ({
  acquireEstimateDraftLock: acquireEstimateDraftLockMock,
  renewEstimateDraftLock: renewEstimateDraftLockMock,
  releaseEstimateDraftLock: releaseEstimateDraftLockMock,
  isEstimateApiError: (error: unknown) =>
    Boolean(
      error &&
        typeof error === "object" &&
        "__estimateApiError" in error &&
        (error as { __estimateApiError?: boolean }).__estimateApiError
    ),
}));

vi.mock("@/components/UserContext", () => ({
  useUserContext: () => ({
    userEmail: "admin@example.com",
    tenantId: "22222222-2222-4222-8222-222222222222",
    profile: {
      role: "admin",
      tenant_role: "admin",
    },
    setProfile: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({
    enabled: false,
    value: null,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock("@/components/takeoff/TakeoffApplyWizard", () => ({
  TakeoffApplyWizard: ({
    onConfirm,
    submitError,
  }: {
    onConfirm: (payload: {
      targetSectionId: string | null;
      targetSectionLabel: string;
      strategy: "append" | "replace" | "merge";
      overrides: Array<{
        item_id: string;
        action: "rename" | "set_price" | "set_category" | "apply_assembly" | "skip" | "none";
        action_params?: Record<string, unknown>;
      }>;
    }) => Promise<void>;
    submitError: string | null;
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          void onConfirm({
            targetSectionId: null,
            targetSectionLabel: "Racine du devis",
            strategy: "append",
            overrides: [],
          })
        }
      >
        confirmer-apply-test
      </button>
      {submitError ? <p>{submitError}</p> : null}
    </div>
  ),
}));

function createJobDetailResponse(
  status: "pending" | "processing" | "completed" | "failed" | "canceled" | "applied"
): TakeoffJobDetailResponse {
  return {
    job: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      estimate_version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      status,
      level: "A",
      processing_strategy: "sync",
      provider_batch_id: null,
      provider_batch_state: null,
      provider_batch_updated_at: null,
      source_file_name: "plan-lot-a.pdf",
      source_file_type: "application/pdf",
      source_file_size_bytes: 1024,
      prompt_version: null,
      schema_version: null,
      model: null,
      thinking_level: null,
      media_resolution: null,
      retry_count: 0,
      error_code: null,
      error_message: null,
      next_retry_at: null,
      last_error_at: null,
      dispatch_status: null,
      dispatch_outcome: null,
      dispatch_trigger: null,
      dispatch_correlation_id: null,
      dispatch_status_code: null,
      dispatch_updated_at: null,
      provider_reconcile_due_at: null,
      provider_reconcile_attempt_count: 0,
      provider_reconcile_lease_expires_at: null,
      operator_state: "none",
      operator_state_label: null,
      can_reconcile: false,
      can_cancel: status === "pending" || status === "processing",
      can_resubmit: status === "failed" || status === "canceled",
      started_at: "2026-02-25T10:00:00.000Z",
      completed_at: "2026-02-25T10:00:10.000Z",
      created_at: "2026-02-25T10:00:00.000Z",
      updated_at: "2026-02-25T10:00:10.000Z",
      metrics: {
        token_count: null,
        cost_cents: null,
        duration_ms: 10_000,
      },
    },
    result: null,
    items: {
      data: [],
      pagination: {
        limit: 100,
        offset: 0,
        total: 0,
      },
    },
  };
}

describe("TakeoffJobMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyTakeoffJobMock.mockResolvedValue({
      summary: {
        created_count: 1,
        updated_count: 0,
        ignored_count: 0,
      },
    });
    renewEstimateDraftLockMock.mockResolvedValue({
      renewed: true,
      lock: {
        isOwnedByCurrentUser: true,
      },
    });
    acquireEstimateDraftLockMock.mockResolvedValue({
      acquired: true,
      lock: {
        isOwnedByCurrentUser: true,
      },
    });
    releaseEstimateDraftLockMock.mockResolvedValue({
      released: true,
    });
    reconcileTakeoffJobMock.mockResolvedValue({ job: { id: "job" } });
    resubmitTakeoffJobMock.mockResolvedValue({ job: { id: "job" } });
  });

  afterEach(() => {
    cleanup();
  });

  it("links completed jobs to an existing estimate route", () => {
    useTakeoffJobPollingMock.mockReturnValue({
      data: createJobDetailResponse("completed"),
      error: null,
      errorStatus: null,
      isPolling: false,
      refetch: vi.fn(),
    });

    render(
      <TakeoffJobMonitor
        jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />
    );

    const resultLink = screen.getByRole("link", { name: /voir les resultats/i });
    const href = resultLink.getAttribute("href");

    expect(href).toBe("/dashboard/estimates/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(href).not.toContain("/review");
  });

  it("keeps estimate back navigation for non-completed jobs", () => {
    useTakeoffJobPollingMock.mockReturnValue({
      data: createJobDetailResponse("processing"),
      error: null,
      errorStatus: null,
      isPolling: true,
      refetch: vi.fn(),
    });

    render(
      <TakeoffJobMonitor
        jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />
    );

    const backLink = screen.getByRole("link", { name: /retour au chiffrage/i });
    expect(backLink.getAttribute("href")).toBe(
      "/dashboard/estimates/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    );
    expect(
      screen.queryByRole("link", { name: /voir les resultats/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the delayed-start recovery visible after a reload", () => {
    const detail = createJobDetailResponse("pending");
    detail.job.dispatch_status = "trigger_failed";
    detail.job.dispatch_outcome = "timeout";
    detail.job.dispatch_correlation_id = "dispatch-follow-up-123";

    useTakeoffJobPollingMock.mockReturnValue({
      data: detail,
      error: null,
      errorStatus: null,
      isPolling: true,
      refetch: vi.fn(),
    });

    render(
      <TakeoffJobMonitor
        jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />
    );

    expect(
      screen.getByText("Démarrage immédiat indisponible, reprise automatique active.")
    ).toBeInTheDocument();
    expect(screen.getByText(/dispatch-follow-up-123/)).toBeInTheDocument();
  });

  it("acquires a lock before apply when no active lock exists", async () => {
    const refetch = vi.fn();
    useTakeoffJobPollingMock.mockReturnValue({
      data: createJobDetailResponse("completed"),
      error: null,
      errorStatus: null,
      isPolling: false,
      refetch,
    });
    renewEstimateDraftLockMock.mockRejectedValue({
      __estimateApiError: true,
      status: 404,
      message: "Aucun verrou actif pour cette version.",
    });

    render(
      <TakeoffJobMonitor
        jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "confirmer-apply-test" }));

    await waitFor(() => {
      expect(renewEstimateDraftLockMock).toHaveBeenCalledWith(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      );
      expect(acquireEstimateDraftLockMock).toHaveBeenCalledWith(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      );
      expect(applyTakeoffJobMock).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        {
          target_section_id: null,
          strategy: "append",
          overrides: undefined,
        }
      );
      expect(releaseEstimateDraftLockMock).toHaveBeenCalledWith(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      );
    });
  });

  it("blocks apply when lock is held by another user", async () => {
    useTakeoffJobPollingMock.mockReturnValue({
      data: createJobDetailResponse("completed"),
      error: null,
      errorStatus: null,
      isPolling: false,
      refetch: vi.fn(),
    });
    renewEstimateDraftLockMock.mockResolvedValue({
      renewed: false,
      lock: {
        holderName: "Marie",
        isOwnedByCurrentUser: false,
      },
    });

    render(
      <TakeoffJobMonitor
        jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "confirmer-apply-test" }));

    await waitFor(() => {
      expect(applyTakeoffJobMock).not.toHaveBeenCalled();
    });
    expect(
      screen.getAllByText("La version cible est verrouillee par Marie.")
    ).not.toHaveLength(0);
  });

  it("uses operator remediation actions from the job contract", async () => {
    const refetch = vi.fn();
    const detail = createJobDetailResponse("processing");
    detail.job.processing_strategy = "batch";
    detail.job.provider_batch_id = "batch-123";
    detail.job.provider_batch_state = "running";
    detail.job.operator_state = "orphan_to_reconcile";
    detail.job.operator_state_label = "Reprise reconcile requise";
    detail.job.can_reconcile = true;
    detail.job.can_cancel = true;
    detail.job.can_resubmit = false;

    useTakeoffJobPollingMock.mockReturnValue({
      data: detail,
      error: null,
      errorStatus: null,
      isPolling: false,
      refetch,
    });

    render(
      <TakeoffJobMonitor
        jobId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        versionId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      />
    );

    expect(screen.getByText("Reprise reconcile requise")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /relancer reconcile/i }));

    await waitFor(() => {
      expect(reconcileTakeoffJobMock).toHaveBeenCalledWith(
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      );
      expect(refetch).toHaveBeenCalled();
    });
  });
});
