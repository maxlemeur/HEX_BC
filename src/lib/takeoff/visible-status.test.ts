import { describe, expect, it } from "vitest";

import {
  getTakeoffFailureReasonLabel,
  resolveTakeoffVisibleJobStatus,
} from "@/lib/takeoff/visible-status";

describe("resolveTakeoffVisibleJobStatus", () => {
  it("maps pending jobs to queued", () => {
    expect(resolveTakeoffVisibleJobStatus({ status: "pending" })).toEqual({
      status: "queued",
      label: "En file",
    });
  });

  it("maps sync processing jobs to processing", () => {
    expect(
      resolveTakeoffVisibleJobStatus({
        status: "processing",
        processingStrategy: "sync",
      })
    ).toEqual({
      status: "processing",
      label: "En traitement",
    });
  });

  it("maps batch processing jobs to provider_pending when provider is still running", () => {
    expect(
      resolveTakeoffVisibleJobStatus({
        status: "processing",
        processingStrategy: "batch",
        providerBatchState: "running",
      })
    ).toEqual({
      status: "provider_pending",
      label: "En attente provider",
    });
  });

  it("maps completed jobs with exceptions to review_required", () => {
    expect(
      resolveTakeoffVisibleJobStatus({
        status: "completed",
        exceptionCount: 2,
      })
    ).toEqual({
      status: "review_required",
      label: "Revue requise",
    });
  });

  it("maps completed jobs without exceptions to completed", () => {
    expect(
      resolveTakeoffVisibleJobStatus({
        status: "completed",
        exceptionCount: 0,
      })
    ).toEqual({
      status: "completed",
      label: "Analyse terminée",
    });
  });

  it("maps failed jobs to action_required", () => {
    expect(resolveTakeoffVisibleJobStatus({ status: "failed" })).toEqual({
      status: "action_required",
      label: "Échec à corriger",
    });
  });
});

describe("getTakeoffFailureReasonLabel", () => {
  it("returns an actionable business message for known errors", () => {
    expect(
      getTakeoffFailureReasonLabel({ errorCode: "TAKEOFF_LEVEL_C_BUDGET_EXCEEDED" })
    ).toBe(
      "Le niveau détaillé dépasse le budget prévu. Changez de niveau ou ciblez un document plus simple."
    );
  });

  it("returns null for unknown error codes", () => {
    expect(
      getTakeoffFailureReasonLabel({ errorCode: "UNKNOWN_ERROR" })
    ).toBeNull();
  });

  it("returns a generic remediation when only a fallback error message exists", () => {
    expect(
      getTakeoffFailureReasonLabel({ fallbackMessage: "provider exploded" })
    ).toBe(
      "Analyse interrompue. Relancez l'analyse ou importez un autre document."
    );
  });
});
