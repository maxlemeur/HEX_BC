import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/feature-flags", () => ({
  getFeatureFlagValueForTenant: vi.fn(),
  isFeatureEnabled: vi.fn(),
}));

import { getFeatureFlagValueForTenant, isFeatureEnabled } from "@/lib/feature-flags";
import {
  TAKEOFF_C_MAX_COST_CENTS_DEFAULT,
  TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT,
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
  TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY,
  TAKEOFF_C_TIMEOUT_MS_DEFAULT,
  TAKEOFF_C_TIMEOUT_MS_MAX,
  TAKEOFF_C_TIMEOUT_MS_MIN,
} from "@/lib/takeoff/constants";
import { DEFAULT_LOW_CONFIDENCE_THRESHOLD } from "@/lib/takeoff/guards";
import {
  assertTakeoffEnabled,
  getTakeoffChunkingConfigForTenant,
  getTakeoffLowConfidenceThresholdForTenant,
  getTakeoffLevelCProcessingConfigForTenant,
  isTakeoffEnabled,
} from "@/lib/takeoff/feature-flags";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const LEVEL_C_TIMEOUT_ENV_KEY = "TAKEOFF_LEVEL_C_TIMEOUT_MS";
const LEVEL_C_MAX_TOTAL_TOKENS_ENV_KEY = "TAKEOFF_LEVEL_C_MAX_TOTAL_TOKENS";
const LEVEL_C_MAX_COST_CENTS_ENV_KEY = "TAKEOFF_LEVEL_C_MAX_COST_CENTS";

const originalLevelCTimeoutEnv = process.env[LEVEL_C_TIMEOUT_ENV_KEY];
const originalLevelCMaxTotalTokensEnv = process.env[LEVEL_C_MAX_TOTAL_TOKENS_ENV_KEY];
const originalLevelCMaxCostCentsEnv = process.env[LEVEL_C_MAX_COST_CENTS_ENV_KEY];

function restoreLevelCRuntimeEnv() {
  if (typeof originalLevelCTimeoutEnv === "string") {
    process.env[LEVEL_C_TIMEOUT_ENV_KEY] = originalLevelCTimeoutEnv;
  } else {
    delete process.env[LEVEL_C_TIMEOUT_ENV_KEY];
  }

  if (typeof originalLevelCMaxTotalTokensEnv === "string") {
    process.env[LEVEL_C_MAX_TOTAL_TOKENS_ENV_KEY] = originalLevelCMaxTotalTokensEnv;
  } else {
    delete process.env[LEVEL_C_MAX_TOTAL_TOKENS_ENV_KEY];
  }

  if (typeof originalLevelCMaxCostCentsEnv === "string") {
    process.env[LEVEL_C_MAX_COST_CENTS_ENV_KEY] = originalLevelCMaxCostCentsEnv;
  } else {
    delete process.env[LEVEL_C_MAX_COST_CENTS_ENV_KEY];
  }
}

describe("takeoff feature flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    restoreLevelCRuntimeEnv();
  });

  afterEach(() => {
    restoreLevelCRuntimeEnv();
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

  it("returns complete Level C processing config from tenant flags", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => {
      if (key === "TAKEOFF_C_CHUNK_THRESHOLD_PAGES") return "25";
      if (key === "TAKEOFF_C_CHUNK_SIZE_PAGES") return "8";
      if (key === "TAKEOFF_C_CHUNK_OVERLAP_PAGES") return "1";
      if (key === "TAKEOFF_C_MAX_PDF_PAGES") return "300";
      if (key === "TAKEOFF_C_TIMEOUT_MS") return "240000";
      if (key === "TAKEOFF_C_MAX_TOTAL_TOKENS") return "550000";
      if (key === "TAKEOFF_C_MAX_COST_CENTS") return "3200";
      return null;
    });

    await expect(getTakeoffLevelCProcessingConfigForTenant(TENANT_ID)).resolves.toEqual({
      thresholdPages: 25,
      chunkSizePages: 8,
      overlapPages: 1,
      maxPdfPages: 300,
      timeoutMs: 240000,
      maxTotalTokens: 550000,
      maxCostCents: 3200,
    });
  });

  it("uses env fallback for runtime values when tenant flags are missing", async () => {
    process.env[LEVEL_C_TIMEOUT_ENV_KEY] = "180000";
    process.env[LEVEL_C_MAX_TOTAL_TOKENS_ENV_KEY] = "450000";
    process.env[LEVEL_C_MAX_COST_CENTS_ENV_KEY] = "2100";
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue(null);

    await expect(getTakeoffLevelCProcessingConfigForTenant(TENANT_ID)).resolves.toEqual({
      thresholdPages: TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
      chunkSizePages: TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
      overlapPages: TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
      maxPdfPages: TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
      timeoutMs: 180000,
      maxTotalTokens: 450000,
      maxCostCents: 2100,
    });
  });

  it("falls back to defaults when Level C runtime values are invalid", async () => {
    process.env[LEVEL_C_TIMEOUT_ENV_KEY] = "invalid";
    process.env[LEVEL_C_MAX_TOTAL_TOKENS_ENV_KEY] = "invalid";
    process.env[LEVEL_C_MAX_COST_CENTS_ENV_KEY] = "invalid";
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue("invalid");

    await expect(getTakeoffLevelCProcessingConfigForTenant(TENANT_ID)).resolves.toEqual({
      thresholdPages: TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
      chunkSizePages: TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
      overlapPages: TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
      maxPdfPages: TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
      timeoutMs: TAKEOFF_C_TIMEOUT_MS_DEFAULT,
      maxTotalTokens: TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT,
      maxCostCents: TAKEOFF_C_MAX_COST_CENTS_DEFAULT,
    });
  });

  it("clamps Level C timeout between min and max boundaries", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => {
      if (key === "TAKEOFF_C_TIMEOUT_MS") return "1000";
      return null;
    });

    const minTimeoutConfig = await getTakeoffLevelCProcessingConfigForTenant(TENANT_ID);
    const expectedMinTimeout = Math.max(TAKEOFF_C_TIMEOUT_MS_MIN, 120_000);
    const expectedMaxTimeout = Math.max(expectedMinTimeout, TAKEOFF_C_TIMEOUT_MS_MAX);

    expect(minTimeoutConfig.timeoutMs).toBe(expectedMinTimeout);

    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => {
      if (key === "TAKEOFF_C_TIMEOUT_MS") return "999999999";
      return null;
    });

    const maxTimeoutConfig = await getTakeoffLevelCProcessingConfigForTenant(TENANT_ID);
    expect(maxTimeoutConfig.timeoutMs).toBe(expectedMaxTimeout);
  });

  it("returns low-confidence threshold from tenant flag", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockImplementation(async (_tenantId, key) => {
      if (key === TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY) {
        return "0.35";
      }
      return null;
    });

    await expect(
      getTakeoffLowConfidenceThresholdForTenant(TENANT_ID)
    ).resolves.toBe(0.35);
  });

  it("falls back to default low-confidence threshold for invalid values", async () => {
    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue("1.2");
    await expect(
      getTakeoffLowConfidenceThresholdForTenant(TENANT_ID)
    ).resolves.toBe(DEFAULT_LOW_CONFIDENCE_THRESHOLD);

    vi.mocked(getFeatureFlagValueForTenant).mockResolvedValue("invalid");
    await expect(
      getTakeoffLowConfidenceThresholdForTenant(TENANT_ID)
    ).resolves.toBe(DEFAULT_LOW_CONFIDENCE_THRESHOLD);
  });
});
