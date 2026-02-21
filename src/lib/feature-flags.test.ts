import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  getStalePriceDaysForTenant,
  isFeatureEnabled,
} from "@/lib/feature-flags";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";

type QueryResult = {
  data: unknown;
  error: {
    code: string;
    message: string;
    details: string | null;
    hint: string | null;
  } | null;
};

function createSupabaseMock(result: QueryResult) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const secondEq = vi.fn(() => ({
    maybeSingle,
  }));
  const firstEq = vi.fn(() => ({
    eq: secondEq,
  }));
  const select = vi.fn(() => ({
    eq: firstEq,
  }));

  return {
    from: vi.fn((table: string) => {
      if (table !== "feature_flags") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select,
      };
    }),
  };
}

describe("isFeatureEnabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true when the tenant flag is active", async () => {
    const supabase = createSupabaseMock({
      data: {
        enabled: true,
      },
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(isFeatureEnabled(TENANT_ID, "stale_price_days")).resolves.toBe(true);
  });

  it("returns false when the tenant flag is inactive", async () => {
    const supabase = createSupabaseMock({
      data: {
        enabled: false,
      },
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(isFeatureEnabled(TENANT_ID, "STALE_PRICE_DAYS")).resolves.toBe(false);
  });

  it("returns false when the tenant flag does not exist", async () => {
    const supabase = createSupabaseMock({
      data: null,
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(isFeatureEnabled(TENANT_ID, "STALE_PRICE_DAYS")).resolves.toBe(false);
  });
});

describe("getStalePriceDaysForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns configured stale days when the flag value is valid", async () => {
    const supabase = createSupabaseMock({
      data: {
        value: "120",
      },
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getStalePriceDaysForTenant(TENANT_ID)).resolves.toBe(120);
  });

  it("falls back to default stale days when value is missing", async () => {
    const supabase = createSupabaseMock({
      data: null,
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getStalePriceDaysForTenant(TENANT_ID)).resolves.toBe(90);
  });
});
