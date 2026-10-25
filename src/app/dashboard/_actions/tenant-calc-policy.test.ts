import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/estimates/calc-policy-server", () => ({
  writeTenantCalcDefaults: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import { saveTenantCalcDefaults } from "@/app/dashboard/_actions/tenant-calc-policy";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { writeTenantCalcDefaults } from "@/lib/estimates/calc-policy-server";
import { badRequest, unauthorized } from "@/lib/estimates/errors";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const SUPABASE = { marker: "user-client" };

const FORM = {
  saleCoefficientFo: "1,35",
  saleCoefficientMo: "1,25",
  allowedTaxRates: "20 ; 10 ; 5,5",
  changeReason: "Nouveaux coefficients 2027",
};

function signIn(tenantRole: "admin" | "engineer" | "viewer") {
  vi.mocked(getAuthenticatedContext).mockResolvedValue({
    supabase: SUPABASE,
    tenantId: TENANT_ID,
    tenantRole,
  } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
}

describe("saveTenantCalcDefaults (lot 3.2, entrée 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the parsed values for an admin and returns the stored fields", async () => {
    signIn("admin");
    vi.mocked(writeTenantCalcDefaults).mockResolvedValue({
      engine: 3,
      defaultSaleCoefficientFo: 1.35,
      defaultSaleCoefficientMo: 1.25,
      allowedTaxRatesBp: [2000, 1000, 550],
    });

    await expect(saveTenantCalcDefaults(FORM)).resolves.toEqual({
      ok: true,
      form: { saleCoefficientFo: "1,35", saleCoefficientMo: "1,25", allowedTaxRates: "20 ; 10 ; 5,5" },
    });
    expect(writeTenantCalcDefaults).toHaveBeenCalledWith(SUPABASE, TENANT_ID, {
      defaultSaleCoefficientFo: 1.35,
      defaultSaleCoefficientMo: 1.25,
      allowedTaxRatesBp: [2000, 1000, 550],
      changeReason: "Nouveaux coefficients 2027",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/admin/calc-policy");
  });

  it("refuses an invalid form before any read or write", async () => {
    const result = await saveTenantCalcDefaults({ ...FORM, saleCoefficientFo: "12" });
    expect(result).toMatchObject({ ok: false, errors: { saleCoefficientFo: expect.stringContaining("invalide") } });
    expect(getAuthenticatedContext).not.toHaveBeenCalled();
    expect(writeTenantCalcDefaults).not.toHaveBeenCalled();
  });

  it.each(["engineer", "viewer"] as const)("refuses a %s without writing", async (role) => {
    signIn(role);
    await expect(saveTenantCalcDefaults(FORM)).resolves.toEqual({
      ok: false,
      message: "Seul un administrateur de l'entreprise modifie ces réglages.",
    });
    expect(writeTenantCalcDefaults).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("shows the database refusal message and keeps unknown errors generic", async () => {
    signIn("admin");
    vi.mocked(writeTenantCalcDefaults).mockRejectedValueOnce(badRequest("Motif obligatoire : 5 à 500 caractères."));
    await expect(saveTenantCalcDefaults(FORM)).resolves.toEqual({
      ok: false,
      message: "Motif obligatoire : 5 à 500 caractères.",
    });

    vi.mocked(writeTenantCalcDefaults).mockRejectedValueOnce(new Error("socket hang up"));
    await expect(saveTenantCalcDefaults(FORM)).resolves.toEqual({
      ok: false,
      message: "Impossible d'enregistrer les réglages. Réessayez.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers in French when the session has expired, and refuses a malformed call", async () => {
    vi.mocked(getAuthenticatedContext).mockRejectedValueOnce(unauthorized());
    await expect(saveTenantCalcDefaults(FORM)).resolves.toEqual({
      ok: false,
      message: "Session expirée. Reconnectez-vous pour enregistrer les réglages.",
    });

    const malformed = { ...FORM, saleCoefficientFo: 1.35 } as unknown as typeof FORM;
    await expect(saveTenantCalcDefaults(malformed)).resolves.toEqual({
      ok: false,
      message: "Saisie illisible. Rechargez la page.",
    });
    expect(writeTenantCalcDefaults).not.toHaveBeenCalled();
  });
});
