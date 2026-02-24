import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/feature-flags", () => ({
  isFeatureEnabled: vi.fn(),
}));

import { isFeatureEnabled } from "@/lib/feature-flags";
import { assertTakeoffEnabled, isTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

describe("takeoff feature flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates read access to the generic feature flag helper", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(true);

    await expect(isTakeoffEnabled(TENANT_ID)).resolves.toBe(true);
    expect(vi.mocked(isFeatureEnabled)).toHaveBeenCalledWith(
      TENANT_ID,
      "TAKEOFF_MODULE_ENABLED",
      undefined
    );
  });

  it("throws a normalized forbidden error when takeoff is disabled", async () => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);

    await expect(assertTakeoffEnabled(TENANT_ID)).rejects.toMatchObject({
      status: 403,
      code: "TAKEOFF_MODULE_DISABLED",
      message: "Le module Takeoff est desactive pour ce tenant.",
    });
  });
});
