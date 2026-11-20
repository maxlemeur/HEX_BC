import { z } from "zod";

import { getTenantSettingsActorContext } from "@/lib/auth/tenant-context";
import {
  deleteCurrencyRateForTenant,
  updateCurrencyRateForTenant,
} from "@/lib/currency-rates";
import { badRequest, ok, toErrorResponse } from "@/lib/http/api-response";
import { parseJsonBody } from "@/lib/http/request";

const paramsSchema = z.object({
  rateId: z.string().uuid("rateId invalide."),
});

const patchCurrencyRateSchema = z
  .object({
    tenant_id: z.string().uuid("tenant_id invalide.").optional(),
    rate: z.number().finite("rate invalide.").optional(),
    effective_date: z.string().trim().min(1, "effective_date invalide.").optional(),
    source: z.string().trim().min(1, "source invalide.").optional(),
    is_active: z.boolean().optional(),
  })
  .superRefine((payload, ctx) => {
    const hasField =
      typeof payload.rate === "number" ||
      typeof payload.effective_date === "string" ||
      typeof payload.source === "string" ||
      typeof payload.is_active === "boolean";

    if (hasField) return;

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Aucun champ à mettre à jour.",
      path: [],
    });
  });

const deleteCurrencyRateQuerySchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
});

async function getRateId(paramsPromise: Promise<{ rateId: string }>) {
  const params = await paramsPromise;
  return paramsSchema.parse(params).rateId;
}

function parseDeleteQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;

  return deleteCurrencyRateQuerySchema.parse({
    tenant_id: searchParams.get("tenant_id") ?? undefined,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ rateId: string }> }
) {
  try {
    const rateId = await getRateId(params);
    const payload = patchCurrencyRateSchema.parse(await parseJsonBody(request, badRequest));
    const { supabase, userId, defaultTenantId } = await getTenantSettingsActorContext();
    const tenantId = payload.tenant_id ?? defaultTenantId;

    const rate = await updateCurrencyRateForTenant({
      tenantId,
      userId,
      rateId,
      rate: payload.rate,
      effectiveDate: payload.effective_date,
      source: payload.source,
      isActive: payload.is_active,
      supabase,
    });

    return ok({
      tenant_id: tenantId,
      currency_rate: rate,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ rateId: string }> }
) {
  try {
    const rateId = await getRateId(params);
    const query = parseDeleteQuery(request);
    const { supabase, userId, defaultTenantId } = await getTenantSettingsActorContext();
    const tenantId = query.tenant_id ?? defaultTenantId;
    const rate = await deleteCurrencyRateForTenant({
      tenantId,
      userId,
      rateId,
      supabase,
    });

    return ok({
      tenant_id: tenantId,
      deleted_id: rate.id,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
