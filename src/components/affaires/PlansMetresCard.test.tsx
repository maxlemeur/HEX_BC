import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";

import { fetchTakeoffActivityCenter } from "@/lib/takeoff/client";
import { PlansMetresCard } from "@/components/affaires/PlansMetresCard";

vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffActivityCenter: vi.fn(),
}));

function renderWithSWR(ui: ReactNode) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      {ui}
    </SWRConfig>
  );
}

describe("PlansMetresCard", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(fetchTakeoffActivityCenter).mockReset();
  });

  it("uses reviewVersionId for the exceptions CTA", () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 0,
        usableJobs: 1,
        blockingExceptionsJobs: 1,
      },
      jobs: [],
      pagination: { limit: 6, offset: 0, total: 0 },
    });

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        plans={{
          defaultPlanSetId: "plan-set-1",
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-1",
            status: "review_required",
            label: "Revue requise",
            reviewVersionId: "version-target",
          },
          coveragePercent: 75,
          exceptionCount: 2,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(screen.getByRole("link", { name: "Revoir l'analyse" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-target&view=dpgf&dpgfView=exceptions_only"
    );
    expect(
      screen.queryByRole("button", { name: "Analyser les plans" })
    ).not.toBeInTheDocument();
  });

  it("does not show dismiss CTA in empty state", () => {
    renderWithSWR(<PlansMetresCard projectId="project-1" plans={null} />);

    expect(
      screen.queryByRole("button", { name: "Continuer sans plans" })
    ).not.toBeInTheDocument();
  });

  it("keeps register signals visible and exposes a register CTA even when coverage is unavailable", () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 0,
        usableJobs: 1,
        blockingExceptionsJobs: 0,
      },
      jobs: [],
      pagination: { limit: 6, offset: 0, total: 0 },
    });

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        plans={{
          defaultPlanSetId: "plan-set-1",
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-1",
            status: "completed",
            label: "Analyse terminee",
            reviewVersionId: "version-target",
          },
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 2,
          failureReasonLabel: null,
        }}
      />
    );

    expect(screen.getByText("2 points registre ouverts")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ouvrir le registre" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1"
    );
  });

  it("surfaces intake provenance and confirms that no reupload is needed", () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 0,
        usableJobs: 0,
        blockingExceptionsJobs: 0,
      },
      jobs: [],
      pagination: { limit: 6, offset: 0, total: 0 },
    });

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        plans={{
          defaultPlanSetId: "plan-set-1",
          defaultPlanSetSource: "affaire-intake",
          defaultPlanSetFileCount: 2,
          planSetCount: 1,
          planFileCount: 2,
          totalSizeBytes: 2048,
          latestJob: null,
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(
      screen.getByText("Synchronise depuis le dossier")
    ).toBeInTheDocument();
    expect(
      screen.getByText("2 plans confirmes repris depuis l'intake affaire.")
    ).toBeInTheDocument();
    expect(
      screen.getByText("Aucun reupload n'est necessaire pour lancer le metre sur ces plans.")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Analyser les plans" })
    ).toBeInTheDocument();
  });

  it("exposes retry and remediation CTAs when the latest job needs action", () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 1,
        usableJobs: 1,
        blockingExceptionsJobs: 1,
      },
      jobs: [
        {
          jobId: "job-1",
          estimateVersionId: "version-target",
          versionLabel: "V3",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Echec a corriger",
          statusRaw: "action_required",
          technicalStatusRaw: "failed",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: true,
          itemCount: 0,
          coveragePercent: 0,
          exceptionCount: 0,
          confidenceLabel: "Faible",
          appliedCount: 0,
          createdAt: "2026-03-11T10:00:00.000Z",
          carriedOverFrom: null,
          neverApplied: true,
          retryCount: 1,
        },
        {
          jobId: "job-0",
          estimateVersionId: "version-previous",
          versionLabel: "V2",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Analyse terminee",
          statusRaw: "completed",
          technicalStatusRaw: "completed",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: false,
          itemCount: 12,
          coveragePercent: 84,
          exceptionCount: 0,
          confidenceLabel: "Elevee",
          appliedCount: 1,
          createdAt: "2026-03-11T09:00:00.000Z",
          carriedOverFrom: "V1",
          neverApplied: false,
          retryCount: 0,
        },
      ],
      pagination: { limit: 6, offset: 0, total: 2 },
    });

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        onLaunchMetre={vi.fn()}
        plans={{
          defaultPlanSetId: "plan-set-1",
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-1",
            status: "action_required",
            label: "Echec a corriger",
            reviewVersionId: "version-target",
          },
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel:
            "Delai depasse. Relancez l'analyse ou essayez un niveau plus rapide.",
        }}
      />
    );

    expect(screen.getByText(/Delai depasse/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Relancer l'analyse" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Changer de niveau" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Verifier les plans" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/plans");
    expect(
      screen.queryByRole("button", { name: "Analyser les plans" })
    ).not.toBeInTheDocument();
  });

  it("replaces the launch CTA with a follow CTA while an analysis is already running", () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 1,
        usableJobs: 1,
        blockingExceptionsJobs: 0,
      },
      jobs: [],
      pagination: { limit: 6, offset: 0, total: 0 },
    });

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        onLaunchMetre={vi.fn()}
        plans={{
          defaultPlanSetId: "plan-set-1",
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-1",
            status: "provider_pending",
            label: "En attente provider",
            reviewVersionId: "version-target",
          },
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(
      screen.getByRole("link", { name: "Suivre l'analyse" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/takeoff");
    expect(
      screen.queryByRole("button", { name: "Analyser les plans" })
    ).not.toBeInTheDocument();
  });

  it("keeps prior statuses visible when resuming after a partial failure", async () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 1,
        usableJobs: 1,
        blockingExceptionsJobs: 1,
      },
      jobs: [
        {
          jobId: "job-1",
          estimateVersionId: "version-target",
          versionLabel: "V3",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Echec a corriger",
          statusRaw: "action_required",
          technicalStatusRaw: "failed",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: true,
          itemCount: 0,
          coveragePercent: 0,
          exceptionCount: 0,
          confidenceLabel: "Faible",
          appliedCount: 0,
          createdAt: "2026-03-11T10:00:00.000Z",
          carriedOverFrom: null,
          neverApplied: true,
          retryCount: 1,
        },
        {
          jobId: "job-0",
          estimateVersionId: "version-previous",
          versionLabel: "V2",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Analyse terminee",
          statusRaw: "completed",
          technicalStatusRaw: "completed",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: false,
          itemCount: 12,
          coveragePercent: 84,
          exceptionCount: 0,
          confidenceLabel: "Elevee",
          appliedCount: 1,
          createdAt: "2026-03-11T09:00:00.000Z",
          carriedOverFrom: "V1",
          neverApplied: false,
          retryCount: 0,
        },
      ],
      pagination: { limit: 6, offset: 0, total: 2 },
    });

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        onLaunchMetre={vi.fn()}
        plans={{
          defaultPlanSetId: "plan-set-1",
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-1",
            status: "action_required",
            label: "Echec a corriger",
            reviewVersionId: "version-target",
          },
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel:
            "Delai depasse. Relancez l'analyse ou essayez un niveau plus rapide.",
        }}
      />
    );

    expect(await screen.findByText("Reprise apres echec partiel")).toBeInTheDocument();
    expect(screen.getByText("1 acquis")).toBeInTheDocument();
    expect(screen.getByText("0 en attente")).toBeInTheDocument();
    expect(screen.getByText("1 a corriger")).toBeInTheDocument();
    expect(screen.getByText("V3")).toBeInTheDocument();
    expect(screen.getByText("V2")).toBeInTheDocument();
    expect(screen.getByText("Carry-over depuis V1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reprendre l'analyse" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff"
    );
  });
});
