import type { SupabaseClient } from "@supabase/supabase-js";

import { forbidden } from "@/lib/estimates/errors";
import { getFeatureFlagValueForTenant, isFeatureEnabled } from "@/lib/feature-flags";
import { DEFAULT_LOW_CONFIDENCE_THRESHOLD } from "@/lib/takeoff/guards";
import {
  TAKEOFF_C_MAX_COST_CENTS_DEFAULT,
  TAKEOFF_C_MAX_COST_CENTS_FLAG_KEY,
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_FLAG_KEY,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_FLAG_KEY,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_FLAG_KEY,
  TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT,
  TAKEOFF_C_MAX_TOTAL_TOKENS_FLAG_KEY,
  TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
  TAKEOFF_C_MAX_PDF_PAGES_FLAG_KEY,
  TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY,
  TAKEOFF_C_TIMEOUT_MS_DEFAULT,
  TAKEOFF_C_TIMEOUT_MS_FLAG_KEY,
  TAKEOFF_C_TIMEOUT_MS_MAX,
  TAKEOFF_C_TIMEOUT_MS_MIN,
  TAKEOFF_MODULE_ENABLED_FLAG_KEY,
} from "@/lib/takeoff/constants";
import type { Database } from "@/types/database";

type Supabase = SupabaseClient<Database>;

export type TakeoffChunkingConfig = {
  thresholdPages: number;
  chunkSizePages: number;
  overlapPages: number;
  maxPdfPages: number;
};

export type TakeoffLevelCProcessingConfig = TakeoffChunkingConfig & {
  timeoutMs: number;
  maxTotalTokens: number;
  maxCostCents: number;
};

function parseBooleanEnvFlag(value: string | undefined): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parsePositiveIntegerOrFallback(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized <= 0) return fallback;
  return normalized;
}

function parseNonNegativeIntegerOrFallback(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.trunc(parsed);
  if (normalized < 0) return fallback;
  return normalized;
}

function parseConfidenceThresholdOrFallback(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < 0 || parsed > 1) return fallback;
  return parsed;
}

function parseChunkingConfig(input: {
  thresholdRaw: string | null;
  chunkSizeRaw: string | null;
  overlapRaw: string | null;
  maxPagesRaw: string | null;
}): TakeoffChunkingConfig {
  const thresholdPages = parsePositiveIntegerOrFallback(
    input.thresholdRaw,
    TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT
  );
  const chunkSizePages = parsePositiveIntegerOrFallback(
    input.chunkSizeRaw,
    TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT
  );
  const maxPdfPages = parsePositiveIntegerOrFallback(
    input.maxPagesRaw,
    TAKEOFF_C_MAX_PDF_PAGES_DEFAULT
  );
  const overlapCandidate = parseNonNegativeIntegerOrFallback(
    input.overlapRaw,
    TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT
  );
  const overlapPages = Math.max(0, Math.min(overlapCandidate, chunkSizePages - 1));

  return {
    thresholdPages,
    chunkSizePages,
    overlapPages,
    maxPdfPages,
  };
}

function resolvePositiveIntegerFromFlagOrEnv(
  flagValue: string | null,
  envVarKey: string,
  fallback: number
) {
  const envFallback = parsePositiveIntegerOrFallback(process.env[envVarKey] ?? null, fallback);
  return parsePositiveIntegerOrFallback(flagValue, envFallback);
}

export async function isTakeoffEnabled(
  tenantId: string,
  input?: { supabase?: Supabase }
) {
  // Local/E2E escape hatch to avoid hard dependency on tenant-level flag setup.
  if (parseBooleanEnvFlag(process.env.TAKEOFF_MODULE_FORCE_ENABLED) === true) {
    return true;
  }

  if (parseBooleanEnvFlag(process.env.TAKEOFF_MODULE_ENABLED_BY_DEFAULT) === true) {
    return true;
  }

  return isFeatureEnabled(tenantId, TAKEOFF_MODULE_ENABLED_FLAG_KEY, input);
}

export async function getTakeoffChunkingConfigForTenant(
  tenantId: string,
  input?: { supabase?: Supabase }
): Promise<TakeoffChunkingConfig> {
  const [thresholdRaw, chunkSizeRaw, overlapRaw, maxPagesRaw] = await Promise.all([
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_CHUNK_THRESHOLD_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_CHUNK_SIZE_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_CHUNK_OVERLAP_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_MAX_PDF_PAGES_FLAG_KEY, input),
  ]);

  return parseChunkingConfig({
    thresholdRaw,
    chunkSizeRaw,
    overlapRaw,
    maxPagesRaw,
  });
}

export async function getTakeoffLevelCProcessingConfigForTenant(
  tenantId: string,
  input?: { supabase?: Supabase }
): Promise<TakeoffLevelCProcessingConfig> {
  const [
    thresholdRaw,
    chunkSizeRaw,
    overlapRaw,
    maxPagesRaw,
    timeoutRaw,
    maxTotalTokensRaw,
    maxCostCentsRaw,
  ] = await Promise.all([
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_CHUNK_THRESHOLD_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_CHUNK_SIZE_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_CHUNK_OVERLAP_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_MAX_PDF_PAGES_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_TIMEOUT_MS_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_MAX_TOTAL_TOKENS_FLAG_KEY, input),
    getFeatureFlagValueForTenant(tenantId, TAKEOFF_C_MAX_COST_CENTS_FLAG_KEY, input),
  ]);

  const chunkingConfig = parseChunkingConfig({
    thresholdRaw,
    chunkSizeRaw,
    overlapRaw,
    maxPagesRaw,
  });

  const timeoutCandidate = resolvePositiveIntegerFromFlagOrEnv(
    timeoutRaw,
    "TAKEOFF_LEVEL_C_TIMEOUT_MS",
    TAKEOFF_C_TIMEOUT_MS_DEFAULT
  );
  const timeoutMinMs = Math.max(TAKEOFF_C_TIMEOUT_MS_MIN, 120_000);
  const timeoutMaxMs = Math.max(timeoutMinMs, TAKEOFF_C_TIMEOUT_MS_MAX);
  const timeoutMs = Math.max(timeoutMinMs, Math.min(timeoutCandidate, timeoutMaxMs));

  const maxTotalTokens = resolvePositiveIntegerFromFlagOrEnv(
    maxTotalTokensRaw,
    "TAKEOFF_LEVEL_C_MAX_TOTAL_TOKENS",
    TAKEOFF_C_MAX_TOTAL_TOKENS_DEFAULT
  );
  const maxCostCents = resolvePositiveIntegerFromFlagOrEnv(
    maxCostCentsRaw,
    "TAKEOFF_LEVEL_C_MAX_COST_CENTS",
    TAKEOFF_C_MAX_COST_CENTS_DEFAULT
  );

  return {
    ...chunkingConfig,
    timeoutMs,
    maxTotalTokens,
    maxCostCents,
  };
}

export async function getTakeoffLowConfidenceThresholdForTenant(
  tenantId: string,
  input?: { supabase?: Supabase }
): Promise<number> {
  const thresholdRaw = await getFeatureFlagValueForTenant(
    tenantId,
    TAKEOFF_LOW_CONFIDENCE_THRESHOLD_FLAG_KEY,
    input
  );

  return parseConfidenceThresholdOrFallback(
    thresholdRaw,
    DEFAULT_LOW_CONFIDENCE_THRESHOLD
  );
}

export async function assertTakeoffEnabled(
  tenantId: string,
  input?: { supabase?: Supabase }
) {
  const enabled = await isTakeoffEnabled(tenantId, input);

  if (!enabled) {
    throw forbidden(
      "Le module Takeoff est desactive pour ce tenant.",
      undefined,
      "TAKEOFF_MODULE_DISABLED"
    );
  }
}
