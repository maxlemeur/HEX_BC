import { z } from "zod";

import { getTenantMembershipOrThrow } from "@/lib/auth/tenant-context";
import {
  DEFAULT_STALE_PRICE_DAYS,
  parseStalePriceDays,
} from "@/lib/catalogue/stale-prices";
import { badRequest, forbidden, mapSupabaseError } from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { startConcurrentRead } from "@/lib/supabase/concurrent-read";
import { toNonEmptyString } from "@/lib/value-guards";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type FeatureFlagRecord = {
  tenant_id: string;
  flag_key: string;
  enabled: boolean;
  value: string | null;
};

type TenantScopedInput = {
  tenantId: string;
  userId: string;
  includeInactive?: boolean;
  supabase?: Supabase;
};

type ToggleFeatureFlagInput = TenantScopedInput & {
  key: string;
  enabled: boolean;
  value?: string | null;
};

const FEATURE_FLAGS_TABLE = "feature_flags";
const featureFlagSelect = "tenant_id, flag_key, enabled, value";

const tenantIdSchema = z.string().uuid("tenant_id invalide.");
const userIdSchema = z.string().uuid("user_id invalide.");
const normalizedFlagKeySchema = z
  .string()
  .trim()
  .min(1, "flag_key invalide.")
  .max(64, "flag_key invalide.")
  .regex(/^[A-Z0-9_]+$/, "flag_key invalide.");

const featureFlagRowSchema = z.object({
  tenant_id: z.string().uuid(),
  flag_key: z.string(),
  enabled: z.boolean(),
  value: z.union([z.string(), z.null()]).optional(),
});

export function normalizeFeatureFlagKey(value: string) {
  return value.trim().toUpperCase();
}

function parseTenantIdOrThrow(value: string) {
  const parsed = tenantIdSchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("tenant_id invalide.");
  }

  return parsed.data;
}

function parseUserIdOrThrow(value: string) {
  const parsed = userIdSchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("user_id invalide.");
  }

  return parsed.data;
}

function parseFeatureFlagKeyOrThrow(value: string) {
  const normalized = normalizeFeatureFlagKey(value);
  const parsed = normalizedFlagKeySchema.safeParse(normalized);
  if (!parsed.success) {
    throw badRequest("flag_key invalide.");
  }

  return parsed.data;
}
function parseFeatureFlagRow(value: unknown): FeatureFlagRecord | null {
  const parsed = featureFlagRowSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const normalizedKey = normalizedFlagKeySchema.safeParse(
    normalizeFeatureFlagKey(parsed.data.flag_key)
  );

  if (!normalizedKey.success) {
    return null;
  }

  return {
    tenant_id: parsed.data.tenant_id,
    flag_key: normalizedKey.data,
    enabled: parsed.data.enabled,
    value: toNonEmptyString(parsed.data.value ?? null),
  };
}

async function getSupabase(inputSupabase?: Supabase) {
  if (inputSupabase) return inputSupabase;
  return createSupabaseServerClient();
}

export async function listFeatureFlagsForTenant(
  input: TenantScopedInput
): Promise<FeatureFlagRecord[]> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const supabase = await getSupabase(input.supabase);

  let query = supabase
    .from(FEATURE_FLAGS_TABLE)
    .select(featureFlagSelect)
    .eq("tenant_id", tenantId);

  if (!input.includeInactive) {
    query = query.eq("enabled", true);
  }

  // Read the flags alongside the membership check; they are used only once access is confirmed.
  const flagsPromise = startConcurrentRead(query.order("flag_key", { ascending: true }));
  await getTenantMembershipOrThrow(supabase, tenantId, userId);
  const { data, error } = await flagsPromise;

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les feature flags.");
  }

  const rows = (data ?? []) as unknown[];
  return rows
    .map((row) => parseFeatureFlagRow(row))
    .filter((row): row is FeatureFlagRecord => row !== null);
}

export async function toggleFeatureFlagForTenant(
  input: ToggleFeatureFlagInput
): Promise<FeatureFlagRecord> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const key = parseFeatureFlagKeyOrThrow(input.key);
  const enabled = input.enabled === true;
  const hasExplicitValue = Object.prototype.hasOwnProperty.call(input, "value");
  const normalizedValue = toNonEmptyString(input.value);
  const supabase = await getSupabase(input.supabase);

  const membership = await getTenantMembershipOrThrow(supabase, tenantId, userId);
  if (membership.role !== "admin") {
    throw forbidden("Accès reserve aux administrateurs du tenant.");
  }

  const upsertPayload: {
    tenant_id: string;
    flag_key: string;
    enabled: boolean;
    value?: string | null;
  } = {
    tenant_id: tenantId,
    flag_key: key,
    enabled,
  };

  if (hasExplicitValue) {
    upsertPayload.value = normalizedValue;
  }

  const { data, error } = await supabase
    .from(FEATURE_FLAGS_TABLE)
    .upsert(upsertPayload as never, { onConflict: "tenant_id,flag_key" })
    .select(featureFlagSelect)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre à jour le feature flag.");
  }

  const parsed = parseFeatureFlagRow(data);
  if (parsed) {
    return parsed;
  }

  return {
    tenant_id: tenantId,
    flag_key: key,
    enabled,
    value: hasExplicitValue ? normalizedValue : null,
  };
}

export async function isFeatureEnabled(
  tenantId: string,
  key: string,
  input?: { supabase?: Supabase }
): Promise<boolean> {
  const parsedTenantId = tenantIdSchema.safeParse(tenantId);
  const parsedKey = normalizedFlagKeySchema.safeParse(normalizeFeatureFlagKey(key));

  if (!parsedTenantId.success || !parsedKey.success) {
    return false;
  }

  try {
    const supabase = await getSupabase(input?.supabase);
    const { data, error } = await supabase
      .from(FEATURE_FLAGS_TABLE)
      .select("enabled")
      .eq("tenant_id", parsedTenantId.data)
      .eq("flag_key", parsedKey.data)
      .maybeSingle();

    if (error || !data || typeof data !== "object") {
      return false;
    }

    const enabledValue = (data as { enabled?: unknown }).enabled;
    return enabledValue === true;
  } catch {
    return false;
  }
}

export async function getFeatureFlagValueForTenant(
  tenantId: string,
  key: string,
  input?: { supabase?: Supabase }
): Promise<string | null> {
  const parsedTenantId = tenantIdSchema.safeParse(tenantId);
  const parsedKey = normalizedFlagKeySchema.safeParse(normalizeFeatureFlagKey(key));

  if (!parsedTenantId.success || !parsedKey.success) {
    return null;
  }

  try {
    const supabase = await getSupabase(input?.supabase);
    const { data, error } = await supabase
      .from(FEATURE_FLAGS_TABLE)
      .select("enabled, value")
      .eq("tenant_id", parsedTenantId.data)
      .eq("flag_key", parsedKey.data)
      .maybeSingle();

    if (error || !data || typeof data !== "object") {
      return null;
    }

    const enabledValue = (data as { enabled?: unknown }).enabled;
    if (enabledValue !== true) {
      return null;
    }

    return toNonEmptyString((data as { value?: unknown }).value);
  } catch {
    return null;
  }
}

export async function getStalePriceDaysForTenant(
  tenantId: string,
  input?: { supabase?: Supabase }
): Promise<number> {
  const value = await getFeatureFlagValueForTenant(tenantId, "STALE_PRICE_DAYS", input);
  return parseStalePriceDays(value, DEFAULT_STALE_PRICE_DAYS);
}
