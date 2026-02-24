import { describe, expect, it } from "vitest";

import { resolveTakeoffEnabledStatus } from "@/hooks/useTakeoffEnabled";

describe("resolveTakeoffEnabledStatus", () => {
  it("returns loading while the feature flag request is pending", () => {
    expect(
      resolveTakeoffEnabledStatus({
        isLoading: true,
        error: null,
      })
    ).toBe("loading");
  });

  it("returns error when the feature flag request failed", () => {
    expect(
      resolveTakeoffEnabledStatus({
        isLoading: false,
        error: new Error("network"),
      })
    ).toBe("error");
  });

  it("returns ready when the feature flag state is available", () => {
    expect(
      resolveTakeoffEnabledStatus({
        isLoading: false,
        error: null,
      })
    ).toBe("ready");
  });
});
