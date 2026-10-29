import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { getFeatureFlagValueForTenant, getStalePriceDaysForTenant } from "@/lib/feature-flags";
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

describe("getStalePriceDaysForTenant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns configured stale days when the flag value is valid", async () => {
    const supabase = createSupabaseMock({
      data: {
        enabled: true,
        value: "120",
      },
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getStalePriceDaysForTenant(TENANT_ID)).resolves.toBe(120);
  });

  it("ignores value-backed flags when the flag is disabled", async () => {
    const supabase = createSupabaseMock({
      data: {
        enabled: false,
        value: "120",
      },
      error: null,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(getFeatureFlagValueForTenant(TENANT_ID, "STALE_PRICE_DAYS")).resolves.toBe(
      null
    );
    await expect(getStalePriceDaysForTenant(TENANT_ID)).resolves.toBe(90);
  });
});
