import type { SupabaseClient } from "@supabase/supabase-js";

import { forbidden } from "@/lib/estimates/errors";
import { getFeatureFlagValueForTenant, isFeatureEnabled } from "@/lib/feature-flags";
import {
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_OVERLAP_PAGES_FLAG_KEY,
  TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_SIZE_PAGES_FLAG_KEY,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT,
  TAKEOFF_C_CHUNK_THRESHOLD_PAGES_FLAG_KEY,
  TAKEOFF_C_MAX_PDF_PAGES_DEFAULT,
  TAKEOFF_C_MAX_PDF_PAGES_FLAG_KEY,
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

export async function isTakeoffEnabled(
  tenantId: string,
  input?: { supabase?: Supabase }
) {
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

  const thresholdPages = parsePositiveIntegerOrFallback(
    thresholdRaw,
    TAKEOFF_C_CHUNK_THRESHOLD_PAGES_DEFAULT
  );
  const chunkSizePages = parsePositiveIntegerOrFallback(
    chunkSizeRaw,
    TAKEOFF_C_CHUNK_SIZE_PAGES_DEFAULT
  );
  const maxPdfPages = parsePositiveIntegerOrFallback(
    maxPagesRaw,
    TAKEOFF_C_MAX_PDF_PAGES_DEFAULT
  );
  const overlapCandidate = parseNonNegativeIntegerOrFallback(
    overlapRaw,
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
