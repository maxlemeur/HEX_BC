import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlansMetresCard } from "@/components/affaires/PlansMetresCard";

describe("PlansMetresCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses reviewVersionId for the exceptions CTA", () => {
    render(
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

  it("calls onDismissEmpty from the empty state CTA", () => {
    const onDismissEmpty = vi.fn();

    render(
      <PlansMetresCard
        projectId="project-1"
        plans={null}
        onDismissEmpty={onDismissEmpty}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continuer sans plans" }));

    expect(onDismissEmpty).toHaveBeenCalledTimes(1);
  });

  it("hides the empty state dismiss CTA when no handler is provided", () => {
    render(<PlansMetresCard projectId="project-1" plans={null} />);

    expect(
      screen.queryByRole("button", { name: "Continuer sans plans" })
    ).not.toBeInTheDocument();
  });

  it("keeps register signals visible and exposes a register CTA even when coverage is unavailable", () => {
    render(
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

  it("exposes retry and remediation CTAs when the latest job needs action", () => {
    render(
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
      screen.getByRole("link", { name: "Importer un autre document" })
    ).toHaveAttribute("href", "/dashboard/affaires/project-1/plans");
    expect(
      screen.queryByRole("button", { name: "Analyser les plans" })
    ).not.toBeInTheDocument();
  });

  it("replaces the launch CTA with a follow CTA while an analysis is already running", () => {
    render(
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
});
