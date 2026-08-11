import { z } from "zod";

import {
  readActiveTenantMembership,
  readAuthenticatedUser,
} from "@/lib/auth/tenant-context";
import {
  badRequest,
  forbidden,
  mapSupabaseError,
  notFound,
  unauthorized,
} from "@/lib/estimates/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type TenantMembershipRow = Pick<
  Database["public"]["Tables"]["tenant_memberships"]["Row"],
  "tenant_id" | "user_id" | "role"
>;

const SUPPORTED_CURRENCIES = ["EUR", "USD", "GBP"] as const;
const CURRENCY_RATE_SOURCES = ["manual", "api"] as const;
const CURRENCY_RATE_SELECT =
  "id, tenant_id, from_currency, to_currency, rate, effective_date, source, is_active, created_at, updated_at";

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];
export type CurrencyRateSource = (typeof CURRENCY_RATE_SOURCES)[number];

export type CurrencyRateRecord = {
  id: string;
  tenant_id: string;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  rate: number;
  effective_date: string;
  source: CurrencyRateSource;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type TenantScopedInput = {
  tenantId: string;
  userId: string;
  supabase?: Supabase;
};

type ListCurrencyRatesInput = TenantScopedInput & {
  fromCurrency?: string;
  toCurrency?: string;
  effectiveDate?: string;
  includeInactive?: boolean;
};

type CreateCurrencyRateInput = TenantScopedInput & {
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  effectiveDate?: string;
  source?: string;
  isActive?: boolean;
};

type UpdateCurrencyRateInput = TenantScopedInput & {
  rateId: string;
  rate?: number;
  effectiveDate?: string;
  source?: string;
  isActive?: boolean;
};

type DeleteCurrencyRateInput = TenantScopedInput & {
  rateId: string;
};

const tenantIdSchema = z.string().uuid("tenant_id invalide.");
const userIdSchema = z.string().uuid("user_id invalide.");
const rateIdSchema = z.string().uuid("rate_id invalide.");
const currencyCodeSchema = z.enum(SUPPORTED_CURRENCIES);
const sourceSchema = z.enum(CURRENCY_RATE_SOURCES);
const rateSchema = z.number().finite("rate invalide.").gt(0, "rate invalide.");
const dateOnlyRegex = /^\d{4}-\d{2}-\d{2}$/;
const effectiveDateSchema = z
  .string()
  .trim()
  .regex(dateOnlyRegex, "effective_date invalide.")
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.getTime())) return false;
    return parsed.toISOString().slice(0, 10) === value;
  }, "effective_date invalide.");

const currencyRateRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  from_currency: z.string(),
  to_currency: z.string(),
  rate: z.number(),
  effective_date: z.string(),
  source: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

function normalizeCurrencyCode(value: string) {
  return value.trim().toUpperCase();
}

function normalizeSource(value: string) {
  return value.trim().toLowerCase();
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

function parseRateIdOrThrow(value: string) {
  const parsed = rateIdSchema.safeParse(value);
  if (!parsed.success) {
    throw badRequest("rateId invalide.");
  }

  return parsed.data;
}

function parseCurrencyCodeOrThrow(value: string, fieldName: string): CurrencyCode {
  const normalized = normalizeCurrencyCode(value);
  const parsed = currencyCodeSchema.safeParse(normalized);

  if (!parsed.success) {
    throw badRequest(`${fieldName} invalide. Valeurs autorisees: EUR, USD, GBP.`);
  }

  return parsed.data;
}

function parseSourceOrThrow(value: string): CurrencyRateSource {
  const normalized = normalizeSource(value);
  const parsed = sourceSchema.safeParse(normalized);

  if (!parsed.success) {
    throw badRequest("source invalide. Valeurs autorisees: manual, api.");
  }

  return parsed.data;
}

function parseRateOrThrow(value: number): number {
  const parsed = rateSchema.safeParse(value);

  if (!parsed.success) {
    throw badRequest("rate invalide. Doit etre > 0.");
  }

  return parsed.data;
}

function parseEffectiveDateOrThrow(value: string): string {
  const parsed = effectiveDateSchema.safeParse(value.trim());

  if (!parsed.success) {
    throw badRequest("effective_date invalide.");
  }

  return parsed.data;
}

function parseCurrencyRateRow(value: unknown): CurrencyRateRecord | null {
  const parsed = currencyRateRowSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const fromCurrency = currencyCodeSchema.safeParse(
    normalizeCurrencyCode(parsed.data.from_currency)
  );
  const toCurrency = currencyCodeSchema.safeParse(
    normalizeCurrencyCode(parsed.data.to_currency)
  );
  const source = sourceSchema.safeParse(normalizeSource(parsed.data.source));
  const effectiveDate = effectiveDateSchema.safeParse(parsed.data.effective_date);

  if (
    !fromCurrency.success ||
    !toCurrency.success ||
    !source.success ||
    !effectiveDate.success
  ) {
    return null;
  }

  return {
    id: parsed.data.id,
    tenant_id: parsed.data.tenant_id,
    from_currency: fromCurrency.data,
    to_currency: toCurrency.data,
    rate: parsed.data.rate,
    effective_date: effectiveDate.data,
    source: source.data,
    is_active: parsed.data.is_active,
    created_at: parsed.data.created_at,
    updated_at: parsed.data.updated_at,
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
): Promise<TenantMembershipRow> {
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

function assertTenantAdmin(membership: TenantMembershipRow) {
  if (membership.role === "admin") return;
  throw forbidden("Acces reserve aux administrateurs du tenant.");
}

export async function getCurrencyRatesActorContext() {
  const { supabase, user, error } = await readAuthenticatedUser();

  if (error || !user) {
    throw unauthorized();
  }

  const { membership, error: membershipError } =
    await readActiveTenantMembership(supabase, user.id);

  if (membershipError) {
    throw badRequest("Impossible de charger le tenant courant.");
  }

  const defaultTenantId = membership?.tenant_id ?? null;

  if (!defaultTenantId) {
    throw unauthorized();
  }

  return {
    supabase,
    userId: user.id,
    defaultTenantId,
  };
}

export async function listCurrencyRatesForTenant(
  input: ListCurrencyRatesInput
): Promise<CurrencyRateRecord[]> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const supabase = await getSupabase(input.supabase);

  await getTenantMembershipOrThrow(supabase, tenantId, userId);

  let query = supabase
    .from("currency_rates")
    .select(CURRENCY_RATE_SELECT)
    .eq("tenant_id", tenantId);

  if (typeof input.fromCurrency === "string") {
    query = query.eq(
      "from_currency",
      parseCurrencyCodeOrThrow(input.fromCurrency, "from_currency")
    );
  }

  if (typeof input.toCurrency === "string") {
    query = query.eq(
      "to_currency",
      parseCurrencyCodeOrThrow(input.toCurrency, "to_currency")
    );
  }

  if (typeof input.effectiveDate === "string") {
    query = query.eq(
      "effective_date",
      parseEffectiveDateOrThrow(input.effectiveDate)
    );
  }

  if (input.includeInactive !== true) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query
    .order("effective_date", { ascending: false })
    .order("from_currency", { ascending: true })
    .order("to_currency", { ascending: true });

  if (error) {
    throw mapSupabaseError(error, "Impossible de charger les taux de change.");
  }

  return (data ?? [])
    .map((row) => parseCurrencyRateRow(row))
    .filter((row): row is CurrencyRateRecord => row !== null);
}

export async function createCurrencyRateForTenant(
  input: CreateCurrencyRateInput
): Promise<CurrencyRateRecord> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const supabase = await getSupabase(input.supabase);

  const membership = await getTenantMembershipOrThrow(supabase, tenantId, userId);
  assertTenantAdmin(membership);

  const fromCurrency = parseCurrencyCodeOrThrow(input.fromCurrency, "from_currency");
  const toCurrency = parseCurrencyCodeOrThrow(input.toCurrency, "to_currency");

  if (fromCurrency === toCurrency) {
    throw badRequest("from_currency et to_currency doivent etre differents.");
  }

  const payload: Database["public"]["Tables"]["currency_rates"]["Insert"] = {
    tenant_id: tenantId,
    from_currency: fromCurrency,
    to_currency: toCurrency,
    rate: parseRateOrThrow(input.rate),
    source:
      typeof input.source === "string"
        ? parseSourceOrThrow(input.source)
        : "manual",
  };

  if (typeof input.effectiveDate === "string") {
    payload.effective_date = parseEffectiveDateOrThrow(input.effectiveDate);
  }

  if (typeof input.isActive === "boolean") {
    payload.is_active = input.isActive;
  }

  const { data, error } = await supabase
    .from("currency_rates")
    .insert(payload)
    .select(CURRENCY_RATE_SELECT)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de creer le taux de change.");
  }

  const parsed = parseCurrencyRateRow(data);
  if (!parsed) {
    throw badRequest("Impossible de creer le taux de change.");
  }

  return parsed;
}

export async function updateCurrencyRateForTenant(
  input: UpdateCurrencyRateInput
): Promise<CurrencyRateRecord> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const rateId = parseRateIdOrThrow(input.rateId);
  const supabase = await getSupabase(input.supabase);

  const membership = await getTenantMembershipOrThrow(supabase, tenantId, userId);
  assertTenantAdmin(membership);

  const { data: existingData, error: existingError } = await supabase
    .from("currency_rates")
    .select(CURRENCY_RATE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", rateId)
    .maybeSingle();

  if (existingError) {
    throw mapSupabaseError(existingError, "Impossible de charger le taux de change.");
  }

  if (!parseCurrencyRateRow(existingData)) {
    throw notFound("Taux de change introuvable.");
  }

  const payload: Database["public"]["Tables"]["currency_rates"]["Update"] = {};

  if (typeof input.rate === "number") {
    payload.rate = parseRateOrThrow(input.rate);
  }

  if (typeof input.effectiveDate === "string") {
    payload.effective_date = parseEffectiveDateOrThrow(input.effectiveDate);
  }

  if (typeof input.source === "string") {
    payload.source = parseSourceOrThrow(input.source);
  }

  if (typeof input.isActive === "boolean") {
    payload.is_active = input.isActive;
  }

  if (Object.keys(payload).length === 0) {
    throw badRequest("Aucun champ a mettre a jour.");
  }

  const { data, error } = await supabase
    .from("currency_rates")
    .update(payload)
    .eq("tenant_id", tenantId)
    .eq("id", rateId)
    .select(CURRENCY_RATE_SELECT)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de mettre a jour le taux de change.");
  }

  const parsed = parseCurrencyRateRow(data);
  if (!parsed) {
    throw notFound("Taux de change introuvable.");
  }

  return parsed;
}

export async function deleteCurrencyRateForTenant(
  input: DeleteCurrencyRateInput
): Promise<CurrencyRateRecord> {
  const tenantId = parseTenantIdOrThrow(input.tenantId);
  const userId = parseUserIdOrThrow(input.userId);
  const rateId = parseRateIdOrThrow(input.rateId);
  const supabase = await getSupabase(input.supabase);

  const membership = await getTenantMembershipOrThrow(supabase, tenantId, userId);
  assertTenantAdmin(membership);

  const { data, error } = await supabase
    .from("currency_rates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", rateId)
    .select(CURRENCY_RATE_SELECT)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError(error, "Impossible de supprimer le taux de change.");
  }

  const parsed = parseCurrencyRateRow(data);
  if (!parsed) {
    throw notFound("Taux de change introuvable.");
  }

  return parsed;
}
