import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/currency-rates", () => ({
  deleteCurrencyRateForTenant: vi.fn(),
  getCurrencyRatesActorContext: vi.fn(),
  updateCurrencyRateForTenant: vi.fn(),
}));

import { DELETE, PATCH } from "@/app/api/currency-rates/[rateId]/route";
import { forbidden } from "@/lib/estimates/errors";
import {
  deleteCurrencyRateForTenant,
  getCurrencyRatesActorContext,
  updateCurrencyRateForTenant,
} from "@/lib/currency-rates";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const RATE_ID = "44444444-4444-4444-8444-444444444444";
const DEFAULT_TENANT_ID = "22222222-2222-4222-8222-222222222222";
const EXPLICIT_TENANT_ID = "33333333-3333-4333-8333-333333333333";

describe("currency-rates [rateId] route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrencyRatesActorContext).mockResolvedValue({
      supabase: {} as never,
      userId: USER_ID,
      defaultTenantId: DEFAULT_TENANT_ID,
    });
  });

  it("PATCH forwards payload with default tenant", async () => {
    vi.mocked(updateCurrencyRateForTenant).mockResolvedValue({
      id: RATE_ID,
      tenant_id: DEFAULT_TENANT_ID,
      from_currency: "EUR",
      to_currency: "USD",
      rate: 1.12,
      effective_date: "2026-02-24",
      source: "manual",
      is_active: true,
      created_at: "2026-02-24T10:00:00.000Z",
      updated_at: "2026-02-24T11:00:00.000Z",
    } as never);

    const response = await PATCH(
      new Request(`http://localhost/api/currency-rates/${RATE_ID}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rate: 1.12,
          source: "manual",
        }),
      }),
      {
        params: Promise.resolve({ rateId: RATE_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(updateCurrencyRateForTenant)).toHaveBeenCalledWith({
      tenantId: DEFAULT_TENANT_ID,
      userId: USER_ID,
      rateId: RATE_ID,
      rate: 1.12,
      effectiveDate: undefined,
      source: "manual",
      isActive: undefined,
      supabase: {},
    });

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant_id: DEFAULT_TENANT_ID,
        currency_rate: {
          id: RATE_ID,
        },
      },
    });
  });

  it("PATCH rejects invalid rateId params", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/currency-rates/invalid", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rate: 1.2,
        }),
      }),
      {
        params: Promise.resolve({ rateId: "invalid" }),
      }
    );

    expect(response.status).toBe(400);
    expect(vi.mocked(updateCurrencyRateForTenant)).not.toHaveBeenCalled();
  });

  it("DELETE supports explicit tenant_id query", async () => {
    vi.mocked(deleteCurrencyRateForTenant).mockResolvedValue({
      id: RATE_ID,
      tenant_id: EXPLICIT_TENANT_ID,
      from_currency: "USD",
      to_currency: "GBP",
      rate: 0.8,
      effective_date: "2026-02-24",
      source: "api",
      is_active: true,
      created_at: "2026-02-24T10:00:00.000Z",
      updated_at: "2026-02-24T11:00:00.000Z",
    } as never);

    const response = await DELETE(
      new Request(
        `http://localhost/api/currency-rates/${RATE_ID}?tenant_id=${EXPLICIT_TENANT_ID}`,
        {
          method: "DELETE",
        }
      ),
      {
        params: Promise.resolve({ rateId: RATE_ID }),
      }
    );

    expect(response.status).toBe(200);
    expect(vi.mocked(deleteCurrencyRateForTenant)).toHaveBeenCalledWith({
      tenantId: EXPLICIT_TENANT_ID,
      userId: USER_ID,
      rateId: RATE_ID,
      supabase: {},
    });

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      data: {
        tenant_id: EXPLICIT_TENANT_ID,
        deleted_id: RATE_ID,
      },
    });
  });

  it("PATCH returns 403 when actor is not admin", async () => {
    vi.mocked(updateCurrencyRateForTenant).mockRejectedValue(
      forbidden("Acces reserve aux administrateurs du tenant.")
    );

    const response = await PATCH(
      new Request(`http://localhost/api/currency-rates/${RATE_ID}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          rate: 1.05,
        }),
      }),
      {
        params: Promise.resolve({ rateId: RATE_ID }),
      }
    );

    expect(response.status).toBe(403);
  });
});
