import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from "@/app/api/products/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PRODUCT_ID = "22222222-2222-4222-8222-222222222222";

const VALID_PRODUCT = {
  reference: "TUB-15",
  designation: "Tube DN15",
  product_type: "Tube",
  material: "Inox",
  grade: "304L",
  dimensions: "DN15",
  standard: "EN 10217-7",
  unit: "ml",
  unit_price_cents: 350,
  is_active: true,
};

type QueryResult = { data: unknown; error: { message: string; details?: string; code?: string } | null };

const TENANT_ID = "33333333-3333-4333-8333-333333333333";

function membershipBuilder(role: "admin" | "engineer" | "viewer") {
  const result = {
    data: [
      {
        id: "membership-1",
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        role,
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        tenants: { is_active: true },
      },
    ],
    error: null,
  };
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.then = (
    resolve: (value: typeof result) => unknown,
    reject: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createProductsSupabase(options: {
  authenticated?: boolean;
  role?: "admin" | "engineer" | "viewer";
  insertResult?: QueryResult;
  updateResult?: QueryResult;
  /** Row read back after an update that affected nothing (TI-689); null = not readable. */
  readableRow?: { id: string } | null;
  /** The company's stored reference naming; absent = it saved none. */
  naming?: unknown;
  /** The article as it is before an update that names a reference. */
  currentRow?: { id: string; reference: string | null } | null;
  /** The article that already holds a refused reference; null = not readable. */
  holder?: { id: string; reference: string; designation: string } | null;
  /** The read of the article before an update fails. */
  currentReadError?: { message: string; code?: string };
} = {}) {
  const inserted: unknown[] = [];
  const updated: Array<{ id: string; payload: unknown }> = [];
  const policyReads = { count: 0 };
  const holderFilters: Array<[string, unknown]> = [];
  const updateFilters: Array<[string, string, unknown]> = [];
  const insertSingle = vi.fn(async () => options.insertResult ?? {
    data: { id: PRODUCT_ID, ...VALID_PRODUCT },
    error: null,
  });
  const updateMaybeSingle = vi.fn(async () => options.updateResult ?? {
    data: { id: PRODUCT_ID, ...VALID_PRODUCT, is_active: false },
    error: null,
  });

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: options.authenticated === false ? null : { id: USER_ID },
        },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return membershipBuilder(options.role ?? "admin");
      }

      if (table === "tenant_catalogue_policies") {
        policyReads.count += 1;
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: options.naming === undefined ? null : { product_reference_naming: options.naming },
                error: null,
              })),
            })),
          })),
        };
      }

      if (table !== "products") {
        throw new Error(`Unexpected table: ${table}`);
      }

      return {
        select: vi.fn((columns: string) => {
          const row = columns === "id, reference" ? options.currentRow
            : columns === "id, reference, designation" ? options.holder
            : options.readableRow;
          const failed = columns === "id, reference" ? options.currentReadError : undefined;
          const read: Record<string, unknown> = {
            maybeSingle: vi.fn(async () => (failed ? { data: null, error: failed } : { data: row ?? null, error: null })),
          };
          read.eq = vi.fn((column: string, value: unknown) => {
            if (columns === "id, reference, designation") holderFilters.push([column, value]);
            return read;
          });
          return read;
        }),
        insert: vi.fn((payload: unknown) => {
          inserted.push(payload);
          return {
            select: vi.fn(() => ({
              single: insertSingle,
            })),
          };
        }),
        update: vi.fn((payload: unknown) => ({
          eq: vi.fn((_column: string, id: string) => {
            updated.push({ id, payload });
            const write: Record<string, unknown> = { select: vi.fn(() => ({ maybeSingle: updateMaybeSingle })) };
            // Further filters guard the write on the reference the article held when it was read.
            write.eq = vi.fn((column: string, value: unknown) => { updateFilters.push(["eq", column, value]); return write; });
            write.is = vi.fn((column: string, value: unknown) => { updateFilters.push(["is", column, value]); return write; });
            return write;
          }),
        })),
      };
    }),
  };

  return { supabase, inserted, updated, policyReads, holderFilters, updateFilters };
}

function membershipBuilderFor(table: string) {
  if (table !== "tenant_memberships") throw new Error(`Unexpected table: ${table}`);
  return membershipBuilder("engineer");
}

function postRequest(body: unknown) {
  return new Request("http://localhost/api/products", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("catalogue rights (TI-689)", () => {
    it("lets an engineer add an item", async () => {
      const { supabase, inserted } = createProductsSupabase({ role: "engineer" });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "create", item: VALID_PRODUCT }));

      expect(response.status).toBe(201);
      expect(inserted).toHaveLength(1);
    });

    it("refuses a viewer before any write", async () => {
      const { supabase, inserted, updated } = createProductsSupabase({ role: "viewer" });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const responses = await Promise.all([
        POST(postRequest({ action: "create", item: VALID_PRODUCT })),
        POST(postRequest({ action: "update", id: PRODUCT_ID, item: { is_active: false } })),
      ]);

      expect(responses.map((response) => response.status)).toEqual([403, 403]);
      expect([inserted, updated]).toEqual([[], []]);
    });

    it("tells an engineer that an item of the shared base is not theirs to change", async () => {
      const { supabase } = createProductsSupabase({
        role: "engineer",
        updateResult: { data: null, error: null },
        readableRow: { id: PRODUCT_ID },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { is_active: false } }));

      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).toContain("base commune");
    });

    it("keeps « introuvable » for an item nobody reads", async () => {
      const { supabase } = createProductsSupabase({
        role: "engineer",
        updateResult: { data: null, error: null },
        readableRow: null,
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { is_active: false } }));

      expect(response.status).toBe(404);
    });
  });

  it("archives a product with a partial update", async () => {
    const { supabase, updated } = createProductsSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({
        action: "update",
        id: PRODUCT_ID,
        item: { is_active: false },
      })
    );

    expect(response.status).toBe(200);
    expect(updated).toEqual([
      { id: PRODUCT_ID, payload: { is_active: false } },
    ]);
  });

  // TI-690. Failure modes: the database refusal of an incomplete draft reaches the operator as a raw code or a
  // generic 500; the status or the supply type is dropped on the way to the database; a creation that sets no
  // status sends one anyway and so overrides the database default.
  it("turns the refusal of an incomplete draft into a 422 naming the missing fields", async () => {
    const { supabase, updated } = createProductsSupabase({
      updateResult: {
        data: null,
        error: { code: "23514", message: "PRODUCT_VALIDATION_INCOMPLETE", details: "product_type,supply_type_id" },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "update", id: PRODUCT_ID, item: { catalogue_status: "validated" } })
    );

    expect(updated).toEqual([{ id: PRODUCT_ID, payload: { catalogue_status: "validated" } }]);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      ok: false,
      error: {
        code: "PRODUCT_VALIDATION_INCOMPLETE",
        message: "Pour valider cet article, renseignez : le type, la famille.",
        details: { missing: ["product_type", "supply_type_id"] },
      },
    });
  });

  // TI-689. Failure mode: the refusal of a validation by someone other than an admin reaches them as a 500.
  it("tells who is not an admin that validating a draft is an admin act", async () => {
    const { supabase } = createProductsSupabase({
      updateResult: { data: null, error: { code: "42501", message: "PRODUCT_VALIDATION_ADMIN_ONLY" } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "update", id: PRODUCT_ID, item: { catalogue_status: "validated" } })
    );

    expect(response.status).toBe(403);
    expect((await response.json()).error.message).toBe(
      "La validation d’un article en brouillon est réservée aux administrateurs."
    );
  });

  // Sale packagings carry their article's unit (foreign key ON UPDATE RESTRICT). Failure mode: changing the unit of an
  // article that has packagings reaches the office as a raw foreign key error, or as « Impossible de mettre à jour ».
  it("says to remove the packagings before changing the unit of an article that has some", async () => {
    const { supabase } = createProductsSupabase({
      updateResult: {
        data: null,
        error: {
          code: "23503",
          message: 'update or delete on table "products" violates foreign key constraint "product_packagings_article_unit_fkey" on table "product_packagings"',
        },
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { unit: "kg" } }));

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("PRODUCT_UNIT_HAS_PACKAGINGS");
    expect(body.error.message).toBe(
      "Retirez les conditionnements de vente avant de changer l’unité de l’article : leurs quantités sont exprimées dans l’unité actuelle."
    );
  });

  it("refuses a supply type that is not in the tenant's referential", async () => {
    const { supabase } = createProductsSupabase({
      updateResult: { data: null, error: { code: "23514", message: "PRODUCT_SUPPLY_TYPE_INVALID" } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({
        action: "update",
        id: PRODUCT_ID,
        item: { supply_type_id: "44444444-4444-4444-8444-444444444444" },
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe(
      "Cette famille n’existe pas dans votre référentiel."
    );
  });

  it("creates a draft with its supply type, and sends no status when none is given", async () => {
    const { supabase, inserted } = createProductsSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const supplyTypeId = "44444444-4444-4444-8444-444444444444";

    await POST(
      postRequest({
        action: "create",
        item: { ...VALID_PRODUCT, catalogue_status: "draft", supply_type_id: supplyTypeId },
      })
    );
    await POST(postRequest({ action: "create", item: VALID_PRODUCT }));

    expect(inserted).toEqual([
      { ...VALID_PRODUCT, catalogue_status: "draft", supply_type_id: supplyTypeId },
      VALID_PRODUCT,
    ]);
  });

  // The company's reference naming. Failure modes: a company that saved no naming receives built references; a
  // typed reference is replaced; a taken reference is refused without the article that holds it; the reference of
  // an existing article changes with an ordinary edit of its sheet.
  describe("reference naming", () => {
    const NAMING = {
      enabled: true,
      patterns: { tube: "TUB-{matiere}-{dimension}", coude: "COU-{dimension}", reduction: "RED-{dimension}", vanne: "VAN-{dimension}" },
      abbreviations: { inox: "IX" },
    };
    const BLANK = { ...VALID_PRODUCT, reference: "" };

    it("gives a blank reference the format the company saved", async () => {
      const { supabase, inserted } = createProductsSupabase({ naming: NAMING });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      await POST(postRequest({ action: "create", item: BLANK }));
      await POST(postRequest({ action: "create", item: { ...BLANK, grade: null } }));

      expect(inserted).toEqual([
        { ...VALID_PRODUCT, reference: "TUB-304L-DN15" },
        { ...VALID_PRODUCT, grade: null, reference: "TUB-IX-DN15" },
      ]);
    });

    it("leaves the automatic number to the database when the company saved no naming, switched it off, or the sheet lacks a field", async () => {
      for (const naming of [undefined, { ...NAMING, enabled: false }, { ...NAMING, patterns: { ...NAMING.patterns, tube: "TUB-{dimension}-{epaisseur}" } }]) {
        const { supabase, inserted } = createProductsSupabase({ naming });
        vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

        const response = await POST(postRequest({ action: "create", item: BLANK }));

        expect(response.status).toBe(201);
        expect(inserted).toEqual([{ ...VALID_PRODUCT, reference: null }]);
      }
    });

    it("keeps a typed reference as typed, without reading the naming", async () => {
      const { supabase, inserted, policyReads } = createProductsSupabase({ naming: NAMING });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      await POST(postRequest({ action: "create", item: VALID_PRODUCT }));

      expect(inserted).toEqual([VALID_PRODUCT]);
      expect(policyReads.count).toBe(0);
    });

    it("says which article already holds a refused reference", async () => {
      const { supabase, holderFilters } = createProductsSupabase({
        naming: NAMING,
        insertResult: { data: null, error: { code: "23505", message: "PRODUCT_REFERENCE_CONFLICT" } },
        holder: { id: PRODUCT_ID, reference: "TUB-304L-DN15", designation: "Tube inox 304L DN15" },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "create", item: BLANK }));

      expect(response.status).toBe(409);
      expect((await response.json()).error).toEqual({
        code: "PRODUCT_REFERENCE_TAKEN",
        message: "La référence « TUB-304L-DN15 » est déjà celle de l’article « Tube inox 304L DN15 ». S’il s’agit du même article, utilisez sa fiche ; sinon complétez la fiche ou saisissez une autre référence.",
        details: { product_id: PRODUCT_ID, reference: "TUB-304L-DN15" },
      });
      // The holder is looked for in the caller's company, under the reference as the database compares it.
      expect(holderFilters).toEqual([["tenant_id", TENANT_ID], ["reference_normalized", "tub-304l-dn15"]]);
    });

    it("keeps the plain refusal when the article that holds the reference cannot be read", async () => {
      const { supabase } = createProductsSupabase({
        insertResult: { data: null, error: { code: "23505", message: "PRODUCT_REFERENCE_CONFLICT" } },
        holder: null,
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "create", item: VALID_PRODUCT }));

      expect(response.status).toBe(409);
      expect((await response.json()).error.message).toBe(
        "Cette référence interne existe déjà. Choisissez une autre référence ou laissez le champ vide."
      );
    });

    it("refuses an engineer who changes the reference of an article that has one", async () => {
      const { supabase, updated } = createProductsSupabase({
        role: "engineer", currentRow: { id: PRODUCT_ID, reference: "TUB-15" },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(
        postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-16", designation: "Tube DN16" } })
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("PRODUCT_REFERENCE_LOCKED");
      expect(updated).toEqual([]);
    });

    it("does not write again the unchanged reference of a sheet an engineer saves", async () => {
      // Written again, a sheet opened before an administrator corrected the reference would undo the correction.
      const { supabase, updated, updateFilters } = createProductsSupabase({
        role: "engineer", currentRow: { id: PRODUCT_ID, reference: "TUB-15" },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(
        postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-15", designation: "Tube DN16" } })
      );

      expect(response.status).toBe(200);
      expect(updated).toEqual([{ id: PRODUCT_ID, payload: { designation: "Tube DN16" } }]);
      expect(updateFilters).toEqual([]);
    });

    it("has nothing to write when a save names only the unchanged reference", async () => {
      const { supabase, updated } = createProductsSupabase({
        role: "engineer", currentRow: { id: PRODUCT_ID, reference: "TUB-15" },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-15" } }));

      expect(response.status).toBe(400);
      expect(updated).toEqual([]);
    });

    it("writes nothing to an article the member does not read", async () => {
      const { supabase, updated } = createProductsSupabase({ role: "engineer", currentRow: null });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-16" } }));

      expect(response.status).toBe(404);
      expect(updated).toEqual([]);
    });

    it("lets an engineer give a reference only to an article that still has none", async () => {
      for (const [held, filter] of [[null, ["is", "reference", null]], ["  ", ["eq", "reference", "  "]]] as const) {
        const { supabase, updated, updateFilters } = createProductsSupabase({
          role: "engineer", currentRow: { id: PRODUCT_ID, reference: held },
        });
        vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

        const response = await POST(
          postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-16", designation: "Tube DN16" } })
        );

        expect(response.status).toBe(200);
        expect(updated).toEqual([{ id: PRODUCT_ID, payload: { reference: "TUB-16", designation: "Tube DN16" } }]);
        // The write holds only while the article still has no reference.
        expect(updateFilters).toEqual([filter]);
      }
    });

    it("does not apply a reference to an article that received one in the meantime", async () => {
      const { supabase } = createProductsSupabase({
        role: "engineer", updateResult: { data: null, error: null },
      });
      // No reference at the first read, one at the read that follows the empty write.
      let reads = 0;
      const products = supabase.from("products") as { select: (columns: string) => unknown };
      vi.mocked(supabase.from).mockImplementation(((table: string) => {
        if (table !== "products") return membershipBuilderFor(table);
        return {
          ...products,
          select: vi.fn(() => {
            const row = { id: PRODUCT_ID, reference: reads++ === 0 ? null : "TUB-99" };
            const read: Record<string, unknown> = { maybeSingle: vi.fn(async () => ({ data: row, error: null })) };
            read.eq = vi.fn(() => read);
            return read;
          }),
        };
      }) as never);
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-16" } }));

      expect(response.status).toBe(409);
      expect((await response.json()).error).toMatchObject({
        code: "PRODUCT_REFERENCE_LOCKED",
        message: "Cet article vient de recevoir une référence. Rechargez sa fiche avant de l’enregistrer.",
      });
    });

    it("writes nothing when the reference the article holds cannot be read", async () => {
      const { supabase, updated } = createProductsSupabase({
        role: "engineer", currentReadError: { message: "connection reset" },
      });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-16" } }));

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(updated).toEqual([]);
    });

    it("lets an administrator correct a reference", async () => {
      const { supabase, updated } = createProductsSupabase({ currentRow: { id: PRODUCT_ID, reference: "TUB-15" } });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

      const response = await POST(postRequest({ action: "update", id: PRODUCT_ID, item: { reference: "TUB-16" } }));

      expect(response.status).toBe(200);
      expect(updated).toEqual([{ id: PRODUCT_ID, payload: { reference: "TUB-16" } }]);
    });
  });

  it("refuses an unknown catalogue status", async () => {
    const { supabase, updated } = createProductsSupabase();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      postRequest({ action: "update", id: PRODUCT_ID, item: { catalogue_status: "approved" } })
    );

    expect(response.status).toBe(400);
    expect(updated).toEqual([]);
  });
});
