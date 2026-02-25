import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlagValueForTenant: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

import { getFeatureFlagValueForTenant, isFeatureEnabled } from "@/lib/feature-flags";
import {
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
} from "@/lib/takeoff/constants";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  isTakeoffEnabled,
} from "@/lib/takeoff/feature-flags";

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

  it("returns chunking config values from tenant flags", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => {
      if (key === "TAKEOFF_C_CHUNK_THRESHOLD_PAGES") return "20";
      if (key === "TAKEOFF_C_CHUNK_SIZE_PAGES") return "12";
      if (key === "TAKEOFF_C_CHUNK_OVERLAP_PAGES") return "3";
      if (key === "TAKEOFF_C_MAX_PDF_PAGES") return "250";
      return null;
    });

    await expect(getTakeoffChunkingConfigForTenant(TENANT_ID)).resolves.toEqual({
      thresholdPages: 20,
      chunkSizePages: 12,
      overlapPages: 3,
      maxPdfPages: 250,
    });
  });

  it("falls back to defaults for invalid chunking values", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue("invalid");

    await expect(getTakeoffChunkingConfigForTenant(TENANT_ID)).resolves.toEqual({
      thresholdPages: TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
      chunkSizePages: TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
      overlapPages: TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
      maxPdfPages: TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
    });
  });

  it("clamps overlap below chunk size", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => {
      if (key === "TAKEOFF_C_CHUNK_THRESHOLD_PAGES") return "15";
      if (key === "TAKEOFF_C_CHUNK_SIZE_PAGES") return "5";
      if (key === "TAKEOFF_C_CHUNK_OVERLAP_PAGES") return "10";
      if (key === "TAKEOFF_C_MAX_PDF_PAGES") return "200";
      return null;
    });

    await expect(getTakeoffChunkingConfigForTenant(TENANT_ID)).resolves.toEqual({
      thresholdPages: 15,
      chunkSizePages: 5,
      overlapPages: 4,
      maxPdfPages: 200,
    });
  });
});
