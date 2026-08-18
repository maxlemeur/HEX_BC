import { describe, expect, it } from "vitest";

import { buildTakeoffLaunchContext } from "@/lib/takeoff/launch-context";

describe("buildTakeoffLaunchContext", () => {
  it("keeps the launch workflow available without a default plan set", () => {
    expect(
      buildTakeoffLaunchContext({
        currentVersion: {
          id: "version-1",
          status: "draft",
          versionNumber: 1,
        },
        versions: [{ id: "version-1", version_number: 1 }],
        plansSummary: {
          defaultPlanSetId: null,
          defaultPlanSetName: null,
          defaultPlanSetFileCount: 0,
        },
      })
    ).toEqual({
      currentVersion: {
        id: "version-1",
        status: "draft",
        versionNumber: 1,
      },
      plansContext: {
        defaultPlanSetId: null,
        defaultPlanSetName: null,
        defaultPlanSetSource: undefined,
        defaultPlanSetFileCount: 0,
        launchRecommendation: null,
      },
      availableVersions: [{ id: "version-1", versionNumber: 1 }],
    });
  });

  it("returns a usable context even when hub summaries are unavailable", () => {
    expect(
      buildTakeoffLaunchContext({
        versions: [{ id: "version-2", version_number: 2 }],
      })
    ).toEqual({
      currentVersion: null,
      plansContext: null,
      availableVersions: [{ id: "version-2", versionNumber: 2 }],
    });
  });
});
