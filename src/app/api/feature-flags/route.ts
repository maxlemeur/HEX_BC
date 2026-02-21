import { z } from "zod";

import { badRequest, ok, toErrorResponse, unauthorized } from "@/lib/estimates/errors";
import {
  listFeatureFlagsForTenant,
  normalizeFeatureFlagKey,
  toggleFeatureFlagForTenant,
} from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const tenantQuerySchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
  include_inactive: z.boolean().optional(),
});

const patchFeatureFlagSchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
  flag_key: z.string().trim().min(1, "flag_key invalide.").max(64, "flag_key invalide."),
  enabled: z.boolean(),
});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

async function getActorContext() {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw unauthorized();
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("tenant_memberships")
    .select("tenant_id, is_default, created_at")
    .eq("user_id", user.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1);

  if (membershipError) {
    throw badRequest("Impossible de charger le tenant courant.");
  }

  const defaultTenantId =
    memberships?.[0] && typeof memberships[0].tenant_id === "string"
      ? memberships[0].tenant_id
      : null;

  if (!defaultTenantId) {
    throw unauthorized();
  }

  return {
    supabase,
    userId: user.id,
    defaultTenantId,
  };
}

function parseBooleanQueryParam(value: string | null) {
  if (!value) return undefined;

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true") return true;
  if (normalized === "0" || normalized === "false") return false;

  throw badRequest("include_inactive invalide.");
}

function parseFeatureFlagQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const parsed = tenantQuerySchema.safeParse({
    tenant_id: searchParams.get("tenant_id") ?? undefined,
    include_inactive: parseBooleanQueryParam(searchParams.get("include_inactive")),
  });

  if (!parsed.success) {
    throw badRequest("tenant_id invalide.");
  }

  return parsed.data;
}

export async function GET(request: Request) {
  try {
    const query = parseFeatureFlagQuery(request);
    const { supabase, userId, defaultTenantId } = await getActorContext();
    const tenantId = query.tenant_id ?? defaultTenantId;
    const flags = await listFeatureFlagsForTenant({
      tenantId,
      userId,
      includeInactive: query.include_inactive === true,
      supabase,
    });

    return ok({
      tenant_id: tenantId,
      flags,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = patchFeatureFlagSchema.parse(await parseJsonBody(request));
    const { supabase, userId, defaultTenantId } = await getActorContext();
    const tenantId = payload.tenant_id ?? defaultTenantId;
    const flag = await toggleFeatureFlagForTenant({
      tenantId,
      userId,
      key: normalizeFeatureFlagKey(payload.flag_key),
      enabled: payload.enabled,
      supabase,
    });

    return ok({
      tenant_id: tenantId,
      flag,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
