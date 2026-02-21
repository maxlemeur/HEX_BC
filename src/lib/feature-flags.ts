import { z } from "zod";

import { badRequest, forbidden, mapSupabaseError } from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "user_id" | "role"
>;

export type FeatureFlagRecord = {
  tenant_id: string;
  flag_key: string;
  enabled: boolean;
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
};

const FEATURE_FLAGS_TABLE = "feature_flags";
const featureFlagSelect = "tenant_id, flag_key, enabled";

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
  };
}

async function getSupabase(inputSupabase?: Supabase) {
  if (inputSupabase) return inputSupabase;
  return createSupabaseServerClient();
}

async function getTenantMembershipOrThrow(
  supabase: Supabase,
  tenantId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, user_id, role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de verifier le tenant courant.");
  }

  if (!data) {
    throw forbidden("Aucun acces a ce tenant.");
  }

  return data as TenantMembershipRow;
}

export async function listFeatureFlagsForTenant(
  input: TenantScopedInput
): Promise<FeatureFlagRecord[]> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const supabase = await getSupabase(input.supabase);

  await getTenantMembershipOrThrow(supabase, tenantId, userId);

  let query = supabase
    .from(FEATURE_FLAGS_TABLE)
    .select(featureFlagSelect)
    .eq("tenant_id", tenantId);

  if (!input.includeInactive) {
    query = query.eq("enabled", true);
  }

  const { data, error } = await query.order("flag_key", { ascending: true });

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
  const supabase = await getSupabase(input.supabase);

  const membership = await getTenantMembershipOrThrow(supabase, tenantId, userId);
  if (membership.role !== "admin") {
    throw forbidden("Acces reserve aux administrateurs du tenant.");
  }

  const { data, error } = await supabase
    .from(FEATURE_FLAGS_TABLE)
    .upsert(
      {
        tenant_id: tenantId,
        flag_key: key,
        enabled,
      } as never,
      { onConflict: "tenant_id,flag_key" }
    )
    .select(featureFlagSelect)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le feature flag.");
  }

  const parsed = parseFeatureFlagRow(data);
  if (parsed) {
    return parsed;
  }

  return {
    tenant_id: tenantId,
    flag_key: key,
    enabled,
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
