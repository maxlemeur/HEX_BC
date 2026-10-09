import { describe, expect, it } from "vitest";

import { buildTakeoffRouteHierarchy } from "@/lib/takeoff/route-hierarchy";

describe("buildTakeoffRouteHierarchy", () => {

  it("preserves review query state when redirecting to the affair review flow", () => {
    expect(
      buildTakeoffRouteHierarchy({
        kind: "estimate_review_legacy",
        projectId: "project-1",
        versionId: "version-1",
        jobId: "job-1",
        searchParams: {
          versionId: "version-1",
          view: "compare",
          compareWith: "job-2",
          threshold: "0.9",
        },
      })
    ).toMatchObject({
      targetHref:
        "/dashboard/affaires/project-1/takeoff/job-1/review?versionId=version-1&view=compare&compareWith=job-2&threshold=0.9",
    });
  });
});
