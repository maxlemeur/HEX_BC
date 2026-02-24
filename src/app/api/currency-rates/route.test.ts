import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/currency-rates", () => ({
  createCurrencyRateForTenant: vi.fn(),
  getCurrencyRatesActorContext: vi.fn(),
  listCurrencyRatesForTenant: vi.fn(),
}));

import { GET, POST } from "@/app/api/currency-rates/route";
import { forbidden } from "@/lib/estimates/errors";
import {
  createCurrencyRateForTenant,
  getCurrencyRatesActorContext,
  listCurrencyRatesForTenant,
} from "@/lib/currency-rates";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const DEFAULT_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const EXPLICIT_TENANT_ID = "33333333-3333-4333-8333-333333333333";

describe("currency-rates route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrencyRatesActorContext).mockResolvedValue({
      supabase: {} as never,
      userId: USER_ID,
      defaultTenantId: DEFAULT_TENANT_ID,
    });
  });

  it("GET falls back to actor default tenant and forwards filters", async () => {
    vi.mocked(listCurrencyRatesForTenant).mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        tenant_id: DEFAULT_TENANT_ID,
        from_currency: "EUR",
        to_currency: "USD",
        rate: 1.1,
        effective_date: "2026-02-24",
        source: "manual",
        is_active: true,
        created_at: "2026-02-24T10:00:00.000Z",
        updated_at: "2026-02-24T10:00:00.000Z",
      },
    ] as never);

    const response = await GET(
      new Request(
        "http://localhost/api/currency-rates?from_currency=usd&to_currency=gbp"
      )
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(listCurrencyRatesForTenant)).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      userId: USER_ID,
      fromCurrency: "usd",
      toCurrency: "gbp",
      effectiveDate: undefined,
      includeInactive: false,
      supabase: {},
    });

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        items: [
          {
            id: "44444444-4444-4444-8444-444444444444",
          },
        ],
      },
    });
  });

  it("GET forwards include_inactive=true to service", async () => {
    vi.mocked(listCurrencyRatesForTenant).mockResolvedValue([] as never);

    const response = await GET(
      new Request("http://localhost/api/currency-rates?include_inactive=true")
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(listCurrencyRatesForTenant)).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      userId: USER_ID,
      fromCurrency: undefined,
      toCurrency: undefined,
      effectiveDate: undefined,
      includeInactive: true,
      supabase: {},
    });
  });

  it("GET returns 400 on invalid tenant_id", async () => {
    const response = await GET(
      new Request("http://localhost/api/currency-rates?tenant_id=invalid")
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(listCurrencyRatesForTenant)).not.toHaveBeenCalled();
  });

  it("POST uses explicit tenant_id and returns 201", async () => {
    vi.mocked(createCurrencyRateForTenant).mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      tenant_id: EXPLICIT_TENANT_ID,
      from_currency: "EUR",
      to_currency: "GBP",
      rate: 0.9,
      effective_date: "2026-02-24",
      source: "api",
      is_active: true,
      created_at: "2026-02-24T10:00:00.000Z",
      updated_at: "2026-02-24T10:00:00.000Z",
    } as never);

    const response = await POST(
      new Request("http://localhost/api/currency-rates", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tenant_id: EXPLICIT_TENANT_ID,
          from_currency: "eur",
          to_currency: "gbp",
          rate: 1.24,
          source: "api",
        }),
      })
    );

    expect(response.status).toBe(201);
    expect(vi.mocked(createCurrencyRateForTenant)).toHaveBeenCalledWith({
      tenantId: EXPLICIT_TENANT_ID,
      userId: USER_ID,
      fromCurrency: "eur",
      toCurrency: "gbp",
      rate: 1.24,
      effectiveDate: undefined,
      source: "api",
      isActive: undefined,
      supabase: {},
    });

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant_id: EXPLICIT_TENANT_ID,
        currency_rate: {
          id: "44444444-4444-4444-8444-444444444444",
        },
      },
    });
  });

  it("POST returns 403 when actor is not admin", async () => {
    vi.mocked(createCurrencyRateForTenant).mockRejectedValue(
      forbidden("Acces reserve aux administrateurs du tenant.")
    );

    const response = await POST(
      new Request("http://localhost/api/currency-rates", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from_currency: "EUR",
          to_currency: "USD",
          rate: 1.1,
        }),
      })
    );

    expect(response.status).toBe(403);
  });
});
