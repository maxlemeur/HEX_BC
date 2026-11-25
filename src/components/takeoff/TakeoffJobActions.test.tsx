import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { describeTakeoffTrackingStatus } from "@/lib/takeoff/job-list-labels";
import type { TakeoffActivityCenterJobRow } from "@/lib/takeoff/types";

const fetchTakeoffJob = vi.hoisted(() => vi.fn());
vi.mock("@/lib/takeoff/client", () => ({ fetchTakeoffJob }));

import { TakeoffJobActions, TakeoffJobResumeDetails, useTakeoffResumeRefresh } from "./TakeoffJobActions";

function row(patch: Partial<TakeoffActivityCenterJobRow>): TakeoffActivityCenterJobRow {
  return {
    jobId: "11111111-1111-4111-8111-111111111111", analysisCompletion: null, estimateVersionId: null, versionLabel: "Sans devis",
    lotLabel: null, planSetLabel: null, levelLabel: "Détaillé", processingStrategy: "sync", providerBatchState: null,
    providerBatchUpdatedAt: null, statusLabel: "Échec à corriger", statusRaw: "action_required", technicalStatusRaw: "failed",
    canCancel: false, canResubmit: false, resume: { action: "none", reason: "read_only", availableAt: null }, errorCode: "AI_PROVIDER",
    nextRetryAt: null, itemCount: 0, coveragePercent: null, exceptionCount: 0, confidenceLabel: "Faible", appliedCount: 0,
    createdAt: "2026-11-20T07:00:00.000Z", carriedOverFrom: null, neverApplied: false, retryCount: 1,
    ...patch,
  };
}

function renderRow(job: TakeoffActivityCenterJobRow) {
  const onAction = vi.fn(async () => undefined);
  render(<>
    <p>{describeTakeoffTrackingStatus({ status: job.technicalStatusRaw, fallback: job.statusLabel, errorCode: job.errorCode })}</p>
    <TakeoffJobResumeDetails job={job} />
    <TakeoffJobActions job={job} projectId="project-1" onAction={onAction} />
  </>);
  return { onAction };
}

function RefreshHarness({ jobs, refresh }: { jobs: TakeoffActivityCenterJobRow[]; refresh: () => void }) {
  useTakeoffResumeRefresh(jobs, refresh);
  return null;
}

const waiting = (jobId: string, reason: "retry_delay" | "retry_scheduled", availableAt: string) =>
  row({ jobId, resume: { action: "wait_retry", reason, availableAt } });

describe("TakeoffJobActions", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the list's decision, its French reason and the retry it allows, without reading the job's detail", () => {
    const { onAction } = renderRow(row({ canResubmit: true, resume: { action: "retry_now", reason: "retry_available", availableAt: null } }));

    expect(screen.getByText("Échec : Le service d’analyse n’a pas pu terminer le métré.")).toBeVisible();
    expect(screen.getByText("Relances utilisées : 1 sur 3")).toBeVisible();
    expect(screen.getByText(/^Vous pouvez soumettre cette analyse à nouveau/)).toBeVisible();
    screen.getByRole("button", { name: "Relancer" }).click();
    expect(onAction).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111", "resubmit");
    expect(fetchTakeoffJob).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "new_analysis", reason: "analysis_closed" }, "Cette analyse est close. Préparez une nouvelle analyse depuis l’affaire."],
    [{ action: "none", reason: "read_only" }, "Ce profil ne peut pas relancer l’analyse. Contactez un ingénieur ou un administrateur."],
    [{ action: "new_analysis", reason: "launched_by_other" },
      "Seule la personne qui a lancé cette analyse peut la démarrer avec son forfait. Préparez une nouvelle analyse avec votre forfait."],
    [{ action: "new_analysis", reason: "legacy_provider" },
      "Ce fournisseur IA ne permet plus de relancer cette analyse. Préparez une nouvelle analyse depuis l’affaire."],
  ] as const)("offers no retry for %o", (decision, text) => {
    renderRow(row({ resume: { ...decision, availableAt: null } }));

    expect(screen.getByText(text)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Relancer" })).not.toBeInTheDocument();
  });

  it("never shows a diagnostic code", () => {
    renderRow(row({ errorCode: "SOME_FUTURE_CODE" }));
    renderRow(row({ errorCode: null }));

    expect(screen.getByText(/L’analyse a été interrompue pour une raison non répertoriée/)).toBeVisible();
    expect(screen.getByText(/Échec sans code disponible/)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/SOME_FUTURE_CODE|AI_PROVIDER|read_only|\(code /);
  });

  it("says how long a delay lasts and offers no retry meanwhile", () => {
    renderRow(row({ resume: { action: "wait_retry", reason: "retry_delay", availableAt: "2026-11-21T10:00:05.000Z" } }));

    expect(screen.getByText(/^Vous pourrez soumettre cette analyse à nouveau à partir du/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Relancer" })).not.toBeInTheDocument();
  });

  it("reads the list again once, when the first wait it announced is over", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T10:00:00.000Z"));
    const refresh = vi.fn();
    render(<RefreshHarness refresh={refresh} jobs={[
      waiting("a", "retry_delay", "2026-11-21T10:00:05.000Z"),
      waiting("b", "retry_delay", "2026-11-21T10:00:05.000Z"),
      waiting("c", "retry_scheduled", "2026-11-21T10:00:20.000Z"),
      row({ jobId: "d", resume: { action: "retry_now", reason: "retry_available", availableAt: null } }),
    ]} />);

    act(() => { vi.advanceTimersByTime(5_999); });
    expect(refresh).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("reads a delay the server still announces after its end again shortly, never an overdue scheduled retry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-21T10:00:10.000Z"));
    const refresh = vi.fn();
    const { rerender } = render(<RefreshHarness refresh={refresh} jobs={[waiting("a", "retry_scheduled", "2026-11-21T09:00:00.000Z")]} />);
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(refresh).not.toHaveBeenCalled();

    rerender(<RefreshHarness refresh={refresh} jobs={[waiting("a", "retry_delay", "2026-11-21T10:20:05.000Z")]} />);
    vi.setSystemTime(new Date("2026-11-21T10:20:10.000Z"));
    rerender(<RefreshHarness refresh={refresh} jobs={[waiting("a", "retry_delay", "2026-11-21T10:20:05.000Z")]} />);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("shows nothing to resume on an analysis that did not stop", () => {
    renderRow(row({ technicalStatusRaw: "processing", statusRaw: "processing", canCancel: true, errorCode: null,
      resume: { action: "none", reason: "not_stopped", availableAt: null } }));

    expect(screen.queryByText(/Relances utilisées/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeVisible();
  });

  // Fix round 1, point 1: the failure says what happened; the decision alone says what to do.
  it("does not tell to relaunch an analysis whose automatic retry is awaited", () => {
    renderRow(row({ errorCode: "AI_TIMEOUT", resume: { action: "wait_retry", reason: "retry_scheduled", availableAt: "2026-11-21T10:00:15.000Z" } }));

    expect(screen.getByText("Échec : Délai dépassé.")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/Relancez|restreignez/i);
    expect(screen.getByText(/^Une reprise automatique est programmée/)).toBeVisible();
  });

  // Fix round 1, point 5: an answer of an older server has no decision; the row offers nothing and asks for a reload.
  it("offers no action on a row without a decision and asks to reload", () => {
    const { resume: _resume, ...old } = row({ canResubmit: true, canCancel: true });
    void _resume;
    renderRow(old as TakeoffActivityCenterJobRow);

    expect(screen.getByText("Rechargez la page pour voir les actions possibles sur cette analyse.")).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("follows no wait and does not fail on rows without a decision", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { resume: _resume, ...old } = row({});
    void _resume;
    render(<RefreshHarness refresh={refresh} jobs={[old as TakeoffActivityCenterJobRow]} />);
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(refresh).not.toHaveBeenCalled();
  });
});
