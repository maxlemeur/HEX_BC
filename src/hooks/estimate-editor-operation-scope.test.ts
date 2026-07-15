import { describe, expect, it } from "vitest";

import { isEstimateEditorOperationScopeCurrent } from "@/hooks/estimate-editor-operation-scope";

describe("isEstimateEditorOperationScopeCurrent", () => {
  const scope = {
    routeVersionId: "version-1",
    versionId: "version-1",
    generation: 7,
  };

  it("keeps an operation current only for the same route, version and generation", () => {
    expect(
      isEstimateEditorOperationScopeCurrent(scope, {
        routeVersionId: "version-1",
        versionId: "version-1",
        generation: 7,
      })
    ).toBe(true);
    expect(
      isEstimateEditorOperationScopeCurrent(scope, {
        routeVersionId: "version-2",
        versionId: "version-2",
        generation: 8,
      })
    ).toBe(false);
    expect(
      isEstimateEditorOperationScopeCurrent(scope, {
        routeVersionId: "version-1",
        versionId: "version-1",
        generation: 8,
      })
    ).toBe(false);
  });
});
