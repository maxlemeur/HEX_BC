import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TakeoffJobDetailResponse } from "@/lib/takeoff/client";
import TakeoffJobMonitor from "@/components/takeoff/TakeoffJobMonitor";

const useTakeoffJobPollingMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/takeoff/use-takeoff-job-polling", () => ({
  useTakeoffJobPolling: useTakeoffJobPollingMock,
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
});
