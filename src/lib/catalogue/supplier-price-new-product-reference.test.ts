import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

import { createSupplierPrice } from "@/lib/catalogue/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * A new article created with its supplier offer follows the rule of one created from the catalogue. Failure modes:
 * the offer form shows the reference of the company's format and the article is saved under an automatic number;
 * a typed reference is replaced; a company that saved no naming receives a built reference; a taken reference is
 * refused without the article that holds it, or another conflict of the offer is reported as a taken reference.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const SUPPLIER_ID = "77777777-7777-4777-8777-777777777777";
const HOLDER_ID = "22222222-2222-4222-8222-222222222222";

const NAMING = {
  enabled: true,
  patterns: {
    tube: "TUB-{matiere}-{dimension}-{variante}-{epaisseur}", coude: "COU-{dimension}",
    reduction: "RED-{dimension}", vanne: "VAN-{dimension}",
  },
  abbreviations: { multicouche: "MEC" },
};

const NEW_PRODUCT = { reference: null, designation: "Tube multicouche", dimensions: "16x2", unit: "ml", unit_price_cents: 0 };

function chain(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) builder[method] = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function supabaseWith(options: { naming?: unknown; rpcError?: { code: string; message: string }; holder?: unknown } = {}) {
  const payloads: Array<Record<string, unknown>> = [];
  const supabase = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }) },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return chain({
          data: [{
            id: "membership-1", tenant_id: TENANT_ID, user_id: USER_ID, role: "engineer", is_default: true,
            created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", tenants: { is_active: true },
          }],
          error: null,
        });
      }
      if (table === "tenant_catalogue_policies") {
        return chain({ data: options.naming === undefined ? null : { product_reference_naming: options.naming }, error: null });
      }
      if (table === "products") return chain({ data: options.holder ?? null, error: null });
      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (_name: string, args: { payload: Record<string, unknown> }) => {
      payloads.push(args.payload);
      return options.rpcError ? { data: null, error: options.rpcError } : { data: { id: "offer-1", unit_price_cents: 100 }, error: null };
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
  return { payloads, supabase };
}

const offer = (newProduct: Record<string, unknown>) =>
  ({ supplier_id: SUPPLIER_ID, new_product: newProduct, unit_price_cents: 100 }) as never;

describe("createSupplierPrice, reference of a new article", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gives a blank reference the format the company saved", async () => {
    const { payloads } = supabaseWith({ naming: NAMING });

    await createSupplierPrice(offer(NEW_PRODUCT));

    expect(payloads[0].new_product).toEqual({ ...NEW_PRODUCT, reference: "TUB-MEC-D16-E2" });
  });

  it("leaves the number to the database without a saved naming, and a typed reference as typed", async () => {
    const unsaved = supabaseWith();
    await createSupplierPrice(offer(NEW_PRODUCT));
    expect(unsaved.payloads[0].new_product).toEqual(NEW_PRODUCT);

    const typed = supabaseWith({ naming: NAMING });
    await createSupplierPrice(offer({ ...NEW_PRODUCT, reference: "Tub.MC.16" }));
    expect(typed.payloads[0].new_product).toEqual({ ...NEW_PRODUCT, reference: "Tub.MC.16" });
    expect(typed.supabase.from).not.toHaveBeenCalledWith("tenant_catalogue_policies");
  });

  it("says which article holds a taken reference, and leaves another conflict of the offer as it is", async () => {
    supabaseWith({
      naming: NAMING,
      rpcError: { code: "23505", message: "PRODUCT_REFERENCE_CONFLICT" },
      holder: { id: HOLDER_ID, reference: "TUB-MEC-D16-E2", designation: "Tube multicouche 16x2 barre" },
    });
    await expect(createSupplierPrice(offer(NEW_PRODUCT))).rejects.toMatchObject({
      status: 409,
      code: "PRODUCT_REFERENCE_TAKEN",
      message: expect.stringContaining("« Tube multicouche 16x2 barre »"),
      details: { product_id: HOLDER_ID, reference: "TUB-MEC-D16-E2" },
    });

    supabaseWith({ naming: NAMING, rpcError: { code: "23505", message: "duplicate key value violates unique constraint \"supplier_prices_key\"" } });
    await expect(createSupplierPrice(offer(NEW_PRODUCT))).rejects.not.toMatchObject({ code: "PRODUCT_REFERENCE_TAKEN" });
  });
});
