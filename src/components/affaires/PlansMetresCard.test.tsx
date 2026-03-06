import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PlansMetresCard } from "@/components/affaires/PlansMetresCard";

describe("PlansMetresCard", () => {
  it("uses reviewVersionId for the exceptions CTA", () => {
    render(
      <PlansMetresCard
        projectId="project-1"
        plans={{
          planSetCount: 1,
          planFileCount: 1,
          totalSizeBytes: 1024,
          latestJob: {
            jobId: "job-1",
            status: "review_required",
            label: "Analyse a verifier",
            reviewVersionId: "version-target",
          },
          coveragePercent: 75,
          exceptionCount: 2,
          openQuestionsCount: 0,
          failureReasonLabel: null,
        }}
      />
    );

    expect(screen.getByRole("link", { name: "Voir les exceptions" })).toHaveAttribute(
      "href",
      "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-target&view=dpgf&dpgfView=exceptions_only"
    );
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
});
