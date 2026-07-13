import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

  it("does not show a recovery panel before continuity data confirms one", () => {
    vi.mocked(fetchTakeoffActivityCenter).mockReturnValue(
      new Promise(() => undefined)
    );

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
      screen.queryByText("Analyse de reprise en cours…")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Reprise en attente")).not.toBeInTheDocument();
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
            label: "Analyse terminée",
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

  it("can hide the launch CTA when the flow hero already carries it", () => {
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
        hideLaunchAction
        onLaunchMetre={vi.fn()}
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
      screen.queryByRole("button", { name: "Analyser les plans" })
    ).not.toBeInTheDocument();
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
          statusLabel: "Échec à corriger",
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
          statusLabel: "Analyse terminée",
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
          confidenceLabel: "Élevée",
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
            label: "Échec à corriger",
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
          statusLabel: "Échec à corriger",
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
          statusLabel: "Analyse terminée",
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
          confidenceLabel: "Élevée",
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
            label: "Échec à corriger",
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

  it("does not keep a recovery CTA once the latest continuity job is completed", async () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 1,
        usableJobs: 2,
        blockingExceptionsJobs: 1,
      },
      jobs: [
        {
          jobId: "job-2",
          estimateVersionId: "version-target",
          versionLabel: "V4",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Analyse terminée",
          statusRaw: "completed",
          technicalStatusRaw: "completed",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: false,
          itemCount: 12,
          coveragePercent: 92,
          exceptionCount: 0,
          confidenceLabel: "Élevée",
          appliedCount: 1,
          createdAt: "2026-03-11T12:00:00.000Z",
          carriedOverFrom: "V3",
          neverApplied: false,
          retryCount: 0,
        },
        {
          jobId: "job-1",
          estimateVersionId: "version-previous",
          versionLabel: "V3",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "En attente provider",
          statusRaw: "provider_pending",
          technicalStatusRaw: "processing",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: false,
          itemCount: 0,
          coveragePercent: 0,
          exceptionCount: 0,
          confidenceLabel: "Moyenne",
          appliedCount: 0,
          createdAt: "2026-03-11T11:00:00.000Z",
          carriedOverFrom: null,
          neverApplied: true,
          retryCount: 1,
        },
        {
          jobId: "job-0",
          estimateVersionId: "version-old",
          versionLabel: "V2",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Échec à corriger",
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
      ],
      pagination: { limit: 6, offset: 0, total: 3 },
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
            jobId: "job-2",
            status: "completed",
            label: "Analyse terminée",
            reviewVersionId: "version-target",
            planSetId: "plan-set-1",
          },
          coveragePercent: 92,
          exceptionCount: 0,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(await screen.findByText("Statuts precedents conserves")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Reprendre l'analyse" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Suivre la reprise" })
    ).not.toBeInTheDocument();
  });

  it("derives the continuity CTA from the latest retry state", async () => {
    vi.mocked(fetchTakeoffActivityCenter).mockResolvedValue({
      counters: {
        technicalJobs: 1,
        usableJobs: 1,
        blockingExceptionsJobs: 1,
      },
      jobs: [
        {
          jobId: "job-2",
          estimateVersionId: "version-retry",
          versionLabel: "V4",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "En attente provider",
          statusRaw: "provider_pending",
          technicalStatusRaw: "processing",
          operatorState: "none",
          operatorStateLabel: null,
          canReconcile: false,
          canCancel: false,
          canResubmit: false,
          itemCount: 0,
          coveragePercent: 0,
          exceptionCount: 0,
          confidenceLabel: "Faible",
          appliedCount: 0,
          createdAt: "2026-03-11T11:00:00.000Z",
          carriedOverFrom: null,
          neverApplied: true,
          retryCount: 2,
        },
        {
          jobId: "job-1",
          estimateVersionId: "version-failed",
          versionLabel: "V3",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Échec à corriger",
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
          estimateVersionId: "version-ok",
          versionLabel: "V2",
          lotLabel: null,
          planSetLabel: "Plans principaux",
          levelLabel: "Standard",
          processingStrategy: "sync",
          providerBatchState: null,
          providerBatchUpdatedAt: null,
          providerReconcileDueAt: null,
          providerReconcileLeaseExpiresAt: null,
          statusLabel: "Analyse terminée",
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
          confidenceLabel: "Élevée",
          appliedCount: 1,
          createdAt: "2026-03-11T09:00:00.000Z",
          carriedOverFrom: "V1",
          neverApplied: false,
          retryCount: 0,
        },
      ],
      pagination: { limit: 50, offset: 0, total: 3 },
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
            jobId: "job-2",
            status: "provider_pending",
            label: "En attente provider",
            reviewVersionId: "version-retry",
          },
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(await screen.findByText("Reprise en attente")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Suivre la reprise" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/takeoff");
    expect(
      screen.queryByRole("link", { name: "Reprendre l'analyse" })
    ).not.toBeInTheDocument();
  });

  it("loads the full continuity history before counting acquired analyses", async () => {
    vi.mocked(fetchTakeoffActivityCenter).mockImplementation(
      async (_projectId, filters) => {
        if ((filters.offset ?? 0) === 0) {
          return {
            counters: {
              technicalJobs: 1,
              usableJobs: 1,
              blockingExceptionsJobs: 1,
            },
            jobs: [
              {
                jobId: "job-6",
                estimateVersionId: "version-6",
                versionLabel: "V7",
                lotLabel: null,
                planSetLabel: "Plans principaux",
                levelLabel: "Standard",
                processingStrategy: "sync",
                providerBatchState: null,
                providerBatchUpdatedAt: null,
                providerReconcileDueAt: null,
                providerReconcileLeaseExpiresAt: null,
                statusLabel: "Échec à corriger",
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
                createdAt: "2026-03-11T16:00:00.000Z",
                carriedOverFrom: null,
                neverApplied: true,
                retryCount: 1,
              },
              {
                jobId: "job-5",
                estimateVersionId: "version-5",
                versionLabel: "V6",
                lotLabel: null,
                planSetLabel: "Plans principaux",
                levelLabel: "Standard",
                processingStrategy: "sync",
                providerBatchState: null,
                providerBatchUpdatedAt: null,
                providerReconcileDueAt: null,
                providerReconcileLeaseExpiresAt: null,
                statusLabel: "En attente provider",
                statusRaw: "provider_pending",
                technicalStatusRaw: "processing",
                operatorState: "none",
                operatorStateLabel: null,
                canReconcile: false,
                canCancel: false,
                canResubmit: false,
                itemCount: 0,
                coveragePercent: 0,
                exceptionCount: 0,
                confidenceLabel: "Faible",
                appliedCount: 0,
                createdAt: "2026-03-11T15:00:00.000Z",
                carriedOverFrom: null,
                neverApplied: true,
                retryCount: 1,
              },
              {
                jobId: "job-4",
                estimateVersionId: "version-4",
                versionLabel: "V5",
                lotLabel: null,
                planSetLabel: "Plans principaux",
                levelLabel: "Standard",
                processingStrategy: "sync",
                providerBatchState: null,
                providerBatchUpdatedAt: null,
                providerReconcileDueAt: null,
                providerReconcileLeaseExpiresAt: null,
                statusLabel: "En file",
                statusRaw: "queued",
                technicalStatusRaw: "pending",
                operatorState: "none",
                operatorStateLabel: null,
                canReconcile: false,
                canCancel: false,
                canResubmit: false,
                itemCount: 0,
                coveragePercent: 0,
                exceptionCount: 0,
                confidenceLabel: "Faible",
                appliedCount: 0,
                createdAt: "2026-03-11T14:00:00.000Z",
                carriedOverFrom: null,
                neverApplied: true,
                retryCount: 1,
              },
              {
                jobId: "job-3",
                estimateVersionId: "version-3",
                versionLabel: "V4",
                lotLabel: null,
                planSetLabel: "Plans principaux",
                levelLabel: "Standard",
                processingStrategy: "sync",
                providerBatchState: null,
                providerBatchUpdatedAt: null,
                providerReconcileDueAt: null,
                providerReconcileLeaseExpiresAt: null,
                statusLabel: "Échec à corriger",
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
                createdAt: "2026-03-11T13:00:00.000Z",
                carriedOverFrom: null,
                neverApplied: true,
                retryCount: 1,
              },
              {
                jobId: "job-2",
                estimateVersionId: "version-2",
                versionLabel: "V3",
                lotLabel: null,
                planSetLabel: "Plans principaux",
                levelLabel: "Standard",
                processingStrategy: "sync",
                providerBatchState: null,
                providerBatchUpdatedAt: null,
                providerReconcileDueAt: null,
                providerReconcileLeaseExpiresAt: null,
                statusLabel: "En traitement",
                statusRaw: "processing",
                technicalStatusRaw: "processing",
                operatorState: "none",
                operatorStateLabel: null,
                canReconcile: false,
                canCancel: false,
                canResubmit: false,
                itemCount: 0,
                coveragePercent: 0,
                exceptionCount: 0,
                confidenceLabel: "Faible",
                appliedCount: 0,
                createdAt: "2026-03-11T12:00:00.000Z",
                carriedOverFrom: null,
                neverApplied: true,
                retryCount: 1,
              },
              {
                jobId: "job-1",
                estimateVersionId: "version-1",
                versionLabel: "V2",
                lotLabel: null,
                planSetLabel: "Plans principaux",
                levelLabel: "Standard",
                processingStrategy: "sync",
                providerBatchState: null,
                providerBatchUpdatedAt: null,
                providerReconcileDueAt: null,
                providerReconcileLeaseExpiresAt: null,
                statusLabel: "Échec à corriger",
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
                createdAt: "2026-03-11T11:00:00.000Z",
                carriedOverFrom: null,
                neverApplied: true,
                retryCount: 1,
              },
            ],
            pagination: { limit: 50, offset: 0, total: 7 },
          };
        }

        return {
          counters: {
            technicalJobs: 1,
            usableJobs: 1,
            blockingExceptionsJobs: 1,
          },
          jobs: [
            {
              jobId: "job-0",
              estimateVersionId: "version-0",
              versionLabel: "V1",
              lotLabel: null,
              planSetLabel: "Plans principaux",
              levelLabel: "Standard",
              processingStrategy: "sync",
              providerBatchState: null,
              providerBatchUpdatedAt: null,
              providerReconcileDueAt: null,
              providerReconcileLeaseExpiresAt: null,
              statusLabel: "Analyse terminée",
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
              confidenceLabel: "Élevée",
              appliedCount: 1,
              createdAt: "2026-03-11T10:00:00.000Z",
              carriedOverFrom: null,
              neverApplied: false,
              retryCount: 0,
            },
          ],
          pagination: { limit: 50, offset: 6, total: 7 },
        };
      }
    );

    renderWithSWR(
      <PlansMetresCard
        projectId="project-1"
        plans={{
          defaultPlanSetId: "plan-set-1",
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-6",
            status: "action_required",
            label: "Échec à corriger",
            reviewVersionId: "version-6",
          },
          coveragePercent: null,
          exceptionCount: null,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(await screen.findByText("Reprise apres echec partiel")).toBeInTheDocument();
    expect(screen.getByText("1 acquis")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchTakeoffActivityCenter).toHaveBeenCalledTimes(2);
    });
    expect(fetchTakeoffActivityCenter).toHaveBeenNthCalledWith(
      2,
      "project-1",
      expect.objectContaining({
        planSetId: "plan-set-1",
        limit: 50,
        offset: 6,
      })
    );
  });

  it("falls back to the default plan set when the latest job omits planSetId", async () => {
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
        plans={{
          defaultPlanSetId: "plan-set-default",
          planSetCount: 2,
          planFileCount: 3,
          totalSizeBytes: 4096,
          latestJob: {
            jobId: "job-legacy",
            status: "completed",
            label: "Analyse terminée",
            reviewVersionId: "version-target",
            planSetId: null,
          },
          coveragePercent: 80,
          exceptionCount: 1,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    await waitFor(() => {
      expect(fetchTakeoffActivityCenter).toHaveBeenCalledWith("project-1", {
        planSetId: "plan-set-default",
        limit: 50,
        offset: 0,
      });
    });
  });
});
