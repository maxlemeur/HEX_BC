import { z } from "zod";

import {
  createCurrencyRateForTenant,
  getCurrencyRatesActorContext,
  listCurrencyRatesForTenant,
} from "@/lib/currency-rates";
import { badRequest, ok, toErrorResponse } from "@/lib/estimates/errors";

const listCurrencyRatesQuerySchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
  from_currency: z.string().trim().min(1, "from_currency invalide.").optional(),
  to_currency: z.string().trim().min(1, "to_currency invalide.").optional(),
  effective_date: z.string().trim().min(1, "effective_date invalide.").optional(),
  include_inactive: z.enum(["true", "false"]).optional(),
});

const createCurrencyRateSchema = z.object({
  tenant_id: z.string().uuid("tenant_id invalide.").optional(),
  from_currency: z.string().trim().min(1, "from_currency invalide."),
  to_currency: z.string().trim().min(1, "to_currency invalide."),
  rate: z.number().finite("rate invalide."),
  effective_date: z.string().trim().min(1, "effective_date invalide.").optional(),
  source: z.string().trim().min(1, "source invalide.").optional(),
  is_active: z.boolean().optional(),
});

async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Payload JSON invalide.");
  }
}

function parseQuery(request: Request) {
  const searchParams = new URL(request.url).searchParams;

  return listCurrencyRatesQuerySchema.parse({
    tenant_id: searchParams.get("tenant_id") ?? undefined,
    from_currency: searchParams.get("from_currency") ?? undefined,
    to_currency: searchParams.get("to_currency") ?? undefined,
    effective_date: searchParams.get("effective_date") ?? undefined,
    include_inactive: searchParams.get("include_inactive") ?? undefined,
  });
}

export async function GET(request: Request) {
  try {
    const query = parseQuery(request);
    const { supabase, userId, defaultTenantId } = await getCurrencyRatesActorContext();
    const tenantId = query.tenant_id ?? defaultTenantId;
    const rates = await listCurrencyRatesForTenant({
      tenantId,
      userId,
      fromCurrency: query.from_currency,
      toCurrency: query.to_currency,
      effectiveDate: query.effective_date,
      includeInactive: query.include_inactive === "true",
      supabase,
    });

    return ok({
      tenant_id: tenantId,
      items: rates,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const payload = createCurrencyRateSchema.parse(await parseJsonBody(request));
    const { supabase, userId, defaultTenantId } = await getCurrencyRatesActorContext();
    const tenantId = payload.tenant_id ?? defaultTenantId;
    const rate = await createCurrencyRateForTenant({
      tenantId,
      userId,
      fromCurrency: payload.from_currency,
      toCurrency: payload.to_currency,
      rate: payload.rate,
      effectiveDate: payload.effective_date,
      source: payload.source,
      isActive: payload.is_active,
      supabase,
    });

    return ok(
      {
        tenant_id: tenantId,
        currency_rate: rate,
      },
      201
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
