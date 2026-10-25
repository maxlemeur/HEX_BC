import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  ABSENT_TENANT_CALC_POLICY,
  readTenantCalcPolicySettings,
  writeTenantCalcDefaults,
} from "@/lib/estimates/calc-policy-server";
import { ApiError } from "@/lib/estimates/errors";
import type { Database } from "@/types/database";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";

const VALUES = {
  defaultSaleCoefficientFo: 1.35,
  defaultSaleCoefficientMo: 1.25,
  allowedTaxRatesBp: [2000, 1000, 550],
  changeReason: "Nouveaux coefficients 2027",
};

function rpcClient(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

function selectClient(result: { data: unknown; error: unknown }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient<Database>, from, eq };
}

async function rejection(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ApiError);
  return error as ApiError;
}

describe("tenant calc defaults writer (lot 3.2, entrée 5)", () => {
  it("calls the admin RPC and returns the stored policy", async () => {
    const { client, rpc } = rpcClient({
      data: {
        new_estimate_calc_engine: 3,
        default_sale_coefficient_fo: "1.3500",
        default_sale_coefficient_mo: "1.2500",
        allowed_tax_rates_bp: [2000, 1000, 550],
      },
      error: null,
    });

    await expect(writeTenantCalcDefaults(client, TENANT_ID, VALUES)).resolves.toEqual({
      engine: 3,
      defaultSaleCoefficientFo: 1.35,
      defaultSaleCoefficientMo: 1.25,
      allowedTaxRatesBp: [2000, 1000, 550],
    });
    expect(rpc).toHaveBeenCalledWith("set_tenant_calc_defaults", {
      p_tenant_id: TENANT_ID,
      p_default_sale_coefficient_fo: 1.35,
      p_default_sale_coefficient_mo: 1.25,
      p_allowed_tax_rates_bp: [2000, 1000, 550],
      p_change_reason: "Nouveaux coefficients 2027",
    });
  });

  it("names the admin-only refusal", async () => {
    const { client } = rpcClient({ data: null, error: { code: "42501", message: "TENANT_CALC_DEFAULTS_ADMIN_ONLY" } });
    const error = await rejection(writeTenantCalcDefaults(client, TENANT_ID, VALUES));
    expect(error).toMatchObject({ status: 403, code: "TENANT_CALC_DEFAULTS_ADMIN_ONLY" });
  });

  it.each(["TENANT_CALC_DEFAULTS_REQUIRED", "TENANT_CALC_POLICY_INVALID", "TENANT_CALC_POLICY_REASON_REQUIRED"])(
    "turns the database refusal %s into a readable bad request",
    async (code) => {
      const { client } = rpcClient({ data: null, error: { code: "22023", message: code } });
      const error = await rejection(writeTenantCalcDefaults(client, TENANT_ID, VALUES));
      expect(error.status).toBe(400);
      expect(error.code).toBe(code);
      expect(error.message).not.toContain(code);
    },
  );

  it("falls back to the generic mapping for any other error", async () => {
    const { client } = rpcClient({ data: null, error: { code: "22023", message: "something else" } });
    const error = await rejection(writeTenantCalcDefaults(client, TENANT_ID, VALUES));
    expect(error).toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: "Impossible d'enregistrer les réglages de calcul de l'entreprise.",
    });
  });
});

describe("tenant calc policy settings reader (lot 3.2, entrée 5)", () => {
  it("reads an absent policy as engine 3 at 1,30 / 1,20 without a last change", async () => {
    const { client, from, eq } = selectClient({ data: null, error: null });
    await expect(readTenantCalcPolicySettings(client, TENANT_ID)).resolves.toEqual({
      ...ABSENT_TENANT_CALC_POLICY,
      lastChange: null,
    });
    expect(from).toHaveBeenCalledWith("tenant_calc_policies");
    expect(eq).toHaveBeenCalledWith("tenant_id", TENANT_ID);
  });

  it("keeps an explicit engine 2 row and exposes its last change", async () => {
    const { client } = selectClient({
      data: {
        new_estimate_calc_engine: 2,
        default_sale_coefficient_fo: null,
        default_sale_coefficient_mo: null,
        allowed_tax_rates_bp: [2000],
        change_reason: "Moteur 2 gardé",
        updated_at: "2026-10-24T10:00:00.000Z",
      },
      error: null,
    });
    await expect(readTenantCalcPolicySettings(client, TENANT_ID)).resolves.toEqual({
      engine: 2,
      defaultSaleCoefficientFo: null,
      defaultSaleCoefficientMo: null,
      allowedTaxRatesBp: [2000],
      lastChange: { reason: "Moteur 2 gardé", updatedAt: "2026-10-24T10:00:00.000Z" },
    });
  });
});
