import { z } from "zod";

import { getTenantSettingsActorContext } from "@/lib/auth/tenant-context";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { normalizeFeatureFlagKey } from "@/lib/feature-flag-keys";
import {
  listFeatureFlagsForTenant,
  toggleFeatureFlagForTenant,
} from "@/lib/feature-flags";
import { parseJsonBody } from "@/lib/http/request";

const tenantQuerySchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
  include_inactive: z.boolean().optional(),
});

const patchFeatureFlagSchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
  flag_key: z.string().trim().min(1, "flag_key invalide.").max(64, "flag_key invalide."),
  enabled: z.boolean(),
  value: z.union([z.string(), z.null()]).optional(),
});

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
    const { supabase, userId, defaultTenantId } = await getTenantSettingsActorContext();
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
    const payload = patchFeatureFlagSchema.parse(await parseJsonBody(request, badRequest));
    const { supabase, userId, defaultTenantId } = await getTenantSettingsActorContext();
    const tenantId = payload.tenant_id ?? defaultTenantId;
    const flag = await toggleFeatureFlagForTenant({
      tenantId,
      userId,
      key: normalizeFeatureFlagKey(payload.flag_key),
      enabled: payload.enabled,
      ...("value" in payload ? { value: payload.value ?? null } : {}),
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
