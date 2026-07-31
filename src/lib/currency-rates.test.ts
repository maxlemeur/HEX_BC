import { describe, expect, it, vi } from "vitest";

import {
  createCurrencyRateForTenant,
  deleteCurrencyRateForTenant,
  listCurrencyRatesForTenant,
  updateCurrencyRateForTenant,
} from "@/lib/currency-rates";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const RATE_ID = "33333333-3333-4333-8333-333333333333";

const RATE_ROW = {
  id: RATE_ID,
  tenant_id: TENANT_ID,
  from_currency: "EUR",
  to_currency: "USD",
  rate: 1.08,
  effective_date: "2026-07-31",
  source: "manual",
  is_active: true,
  created_at: "2026-07-31T08:00:00.000Z",
  updated_at: "2026-07-31T08:00:00.000Z",
};

type CurrencyRole = "admin" | "engineer" | "viewer" | "director";
type QueryMode = "read" | "insert" | "update" | "delete";
type QueryResult = {
  data: unknown;
  error: null;
};

type CurrencyScenario = {
  membership: { tenant_id: string; user_id: string; role: CurrencyRole } | null;
  listRows: unknown[];
  existingRate: unknown | null;
  mutationRate: unknown | null;
};

class CurrencyQuery {
  mode: QueryMode = "read";
  readonly filters: Array<[string, unknown]> = [];
  payload: unknown = null;

  constructor(
    readonly table: string,
    private readonly scenario: CurrencyScenario
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push([column, value]);
    return this;
  }

  order() {
    return this;
  }

  insert(payload: unknown) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = "delete";
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.resolve(true));
  }

  then(
    onFulfilled: (value: QueryResult) => unknown,
    onRejected?: (reason: unknown) => unknown
  ) {
    return Promise.resolve(this.resolve(false)).then(onFulfilled, onRejected);
  }

  private resolve(single: boolean): QueryResult {
    if (this.table === "tenant_memberships") {
      return {
        data: this.scenario.membership,
        error: null,
      };
    }

    if (this.mode === "read") {
      return {
        data: single ? this.scenario.existingRate : this.scenario.listRows,
        error: null,
      };
    }

    return {
      data: this.scenario.mutationRate,
      error: null,
    };
  }
}

function createCurrencySupabase(
  overrides: Partial<CurrencyScenario> = {}
) {
  const scenario: CurrencyScenario = {
    membership: {
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role: "admin",
    },
    listRows: [RATE_ROW],
    existingRate: RATE_ROW,
    mutationRate: RATE_ROW,
    ...overrides,
  };
  const queries: CurrencyQuery[] = [];
  const client = {
    from: vi.fn((table: string) => {
      const query = new CurrencyQuery(table, scenario);
      queries.push(query);
      return query;
    }),
  };

  return {
    client,
    queries,
  };
}

function findQuery(
  queries: CurrencyQuery[],
  table: string,
  mode: QueryMode
) {
  const query = queries.find(
    (candidate) => candidate.table === table && candidate.mode === mode
  );
  expect(query).toBeDefined();
  return query as CurrencyQuery;
}

describe("currency rates service", () => {
  it("requires tenant membership before reading any currency rate", async () => {
    const { client, queries } = createCurrencySupabase({ membership: null });

    await expect(
      listCurrencyRatesForTenant({
        tenantId: TENANT_ID,
        userId: USER_ID,
        supabase: client as never,
      })
    ).rejects.toMatchObject({ status: 403 });

    expect(queries).toHaveLength(1);
    expect(queries[0]?.table).toBe("tenant_memberships");
  });

  it("normalizes list filters and keeps the query tenant-scoped and active-only", async () => {
    const invalidCurrencyRow = {
      ...RATE_ROW,
      id: "44444444-4444-4444-8444-444444444444",
      from_currency: "CHF",
    };
    const { client, queries } = createCurrencySupabase({
      listRows: [RATE_ROW, invalidCurrencyRow],
    });

    await expect(
      listCurrencyRatesForTenant({
        tenantId: TENANT_ID,
        userId: USER_ID,
        fromCurrency: " usd ",
        toCurrency: " gbp ",
        effectiveDate: " 2026-07-31 ",
        supabase: client as never,
      })
    ).resolves.toEqual([RATE_ROW]);

    const query = findQuery(queries, "currency_rates", "read");
    expect(query.filters).toEqual(
      expect.arrayContaining([
        ["tenant_id", TENANT_ID],
        ["from_currency", "USD"],
        ["to_currency", "GBP"],
        ["effective_date", "2026-07-31"],
        ["is_active", true],
      ])
    );
  });

  it.each([
    {
      label: "create",
      run: (client: unknown) =>
        createCurrencyRateForTenant({
          tenantId: TENANT_ID,
          userId: USER_ID,
          fromCurrency: "EUR",
          toCurrency: "USD",
          rate: 1.08,
          supabase: client as never,
        }),
    },
    {
      label: "update",
      run: (client: unknown) =>
        updateCurrencyRateForTenant({
          tenantId: TENANT_ID,
          userId: USER_ID,
          rateId: RATE_ID,
          rate: 1.09,
          supabase: client as never,
        }),
    },
    {
      label: "delete",
      run: (client: unknown) =>
        deleteCurrencyRateForTenant({
          tenantId: TENANT_ID,
          userId: USER_ID,
          rateId: RATE_ID,
          supabase: client as never,
        }),
    },
  ])("rejects a non-admin before the $label mutation", async ({ run }) => {
    const { client, queries } = createCurrencySupabase({
      membership: {
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role: "engineer",
      },
    });

    await expect(run(client)).rejects.toMatchObject({ status: 403 });
    expect(
      queries.filter((query) => query.mode !== "read")
    ).toHaveLength(0);
  });

  it("normalizes the create payload after the admin check", async () => {
    const createdRow = {
      ...RATE_ROW,
      from_currency: "GBP",
      to_currency: "USD",
      rate: 1.31,
      effective_date: "2026-08-01",
      source: "api",
      is_active: false,
    };
    const { client, queries } = createCurrencySupabase({
      mutationRate: createdRow,
    });

    await expect(
      createCurrencyRateForTenant({
        tenantId: TENANT_ID,
        userId: USER_ID,
        fromCurrency: " gbp ",
        toCurrency: " usd ",
        rate: 1.31,
        effectiveDate: " 2026-08-01 ",
        source: " API ",
        isActive: false,
        supabase: client as never,
      })
    ).resolves.toEqual(createdRow);

    const query = findQuery(queries, "currency_rates", "insert");
    expect(query.payload).toEqual({
      tenant_id: TENANT_ID,
      from_currency: "GBP",
      to_currency: "USD",
      rate: 1.31,
      effective_date: "2026-08-01",
      source: "api",
      is_active: false,
    });
  });

  it("scopes both the update precheck and mutation to the tenant", async () => {
    const updatedRow = {
      ...RATE_ROW,
      rate: 1.12,
      effective_date: "2026-08-02",
      source: "api",
      is_active: false,
    };
    const { client, queries } = createCurrencySupabase({
      mutationRate: updatedRow,
    });

    await expect(
      updateCurrencyRateForTenant({
        tenantId: TENANT_ID,
        userId: USER_ID,
        rateId: RATE_ID,
        rate: 1.12,
        effectiveDate: " 2026-08-02 ",
        source: " API ",
        isActive: false,
        supabase: client as never,
      })
    ).resolves.toEqual(updatedRow);

    const rateQueries = queries.filter(
      (query) => query.table === "currency_rates"
    );
    expect(rateQueries).toHaveLength(2);
    rateQueries.forEach((query) => {
      expect(query.filters).toEqual(
        expect.arrayContaining([
          ["tenant_id", TENANT_ID],
          ["id", RATE_ID],
        ])
      );
    });
    expect(findQuery(queries, "currency_rates", "update").payload).toEqual({
      rate: 1.12,
      effective_date: "2026-08-02",
      source: "api",
      is_active: false,
    });
  });

  it("scopes deletion to both the tenant and rate id", async () => {
    const { client, queries } = createCurrencySupabase();

    await expect(
      deleteCurrencyRateForTenant({
        tenantId: TENANT_ID,
        userId: USER_ID,
        rateId: RATE_ID,
        supabase: client as never,
      })
    ).resolves.toEqual(RATE_ROW);

    const query = findQuery(queries, "currency_rates", "delete");
    expect(query.filters).toEqual([
      ["tenant_id", TENANT_ID],
      ["id", RATE_ID],
    ]);
  });
});
