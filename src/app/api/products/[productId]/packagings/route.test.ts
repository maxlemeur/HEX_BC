import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as packagingRoute from "@/app/api/products/[productId]/packagings/[packagingId]/route";
import * as packagingsRoute from "@/app/api/products/[productId]/packagings/route";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the sale packagings of an article (« conditionnements de vente »), as the catalogue dialog calls
 * them. Fictional members and articles. The database proves the same rights (product-packagings.test.sql); these
 * guard what the routes add on top:
 *  1. a member of another tenant reads or writes them, or learns the article exists (404, not 403);
 *  2. the screen is told a member may edit when they may not (can_edit), or the reverse, so it shows controls
 *     that the server then refuses, or hides controls from an editor;
 *  3. a member who may not change the article writes a packaging, or gets a silent success;
 *  4. a quantity of zero, negative, with more than three decimals, or an empty label reaches the database;
 *  5. the same packaging (label folded, same quantity) is stored twice, or is refused without the sentence;
 *  6. marking a packaging usual leaves another one marked in the answer the screen keeps;
 *  7. a packaging is changed or removed through the URL of another article;
 *  8. an article without a unit gets a packaging, or the refusal does not say why;
 *  9. the screen is not told the unit each packaging is expressed in;
 * 10. a packaging added while the article's unit changes is refused with a bare 400 instead of a sentence.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const AUTHOR = "20000000-0000-4000-8000-000000000002";
const ENGINEER = "20000000-0000-4000-8000-000000000003";
const VIEWER = "20000000-0000-4000-8000-000000000004";
const DIRECTOR = "20000000-0000-4000-8000-000000000005";
const OUTSIDER = "20000000-0000-4000-8000-000000000006";
const SHARED_PRODUCT = "90000000-0000-4000-8000-000000000001";
const AUTHOR_PRODUCT = "90000000-0000-4000-8000-000000000002";
const FOREIGN_PRODUCT = "90000000-0000-4000-8000-000000000009";
const DRAFT_PRODUCT = "90000000-0000-4000-8000-000000000003";
const BAR = "c0000000-0000-4000-8000-000000000001";
const REEL = "c0000000-0000-4000-8000-000000000002";
const BOX = "c0000000-0000-4000-8000-000000000003";

type Role = "admin" | "engineer" | "viewer" | "director";

function seed(
  actor: string,
  role: Role,
  options: { sharedOpen?: boolean; refuseInsert?: Parameters<typeof createFakeSupabase>[0]["refuseInsert"] } = {},
) {
  const fake = createFakeSupabase({
    userId: actor,
    refuseInsert: options.refuseInsert,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      tenant_catalogue_policies: options.sharedOpen ? [{ tenant_id: TENANT, engineers_can_edit_shared: true }] : [],
      products: [
        { id: SHARED_PRODUCT, tenant_id: TENANT, designation: "Tube DN40 48,3x2 fictif", unit: "ml", created_by: null },
        { id: AUTHOR_PRODUCT, tenant_id: TENANT, designation: "Coude fictif", unit: "u", created_by: AUTHOR },
        { id: FOREIGN_PRODUCT, tenant_id: OTHER_TENANT, designation: "Tube d'ailleurs", unit: "ml", created_by: null },
        { id: DRAFT_PRODUCT, tenant_id: TENANT, designation: "Brouillon sans unité", unit: "", created_by: null },
      ],
      product_packagings: [
        // Out of order on purpose: the answer follows the positions.
        { id: REEL, tenant_id: TENANT, product_id: SHARED_PRODUCT, label: "Touret", quantity: 100, is_usual: false, unit: "ml", position: 2, created_at: "2026-11-20T09:00:00.000Z" },
        { id: BAR, tenant_id: TENANT, product_id: SHARED_PRODUCT, label: "Barre", quantity: 6, is_usual: true, unit: "ml", position: 1, created_at: "2026-11-20T08:00:00.000Z" },
        { id: BOX, tenant_id: TENANT, product_id: AUTHOR_PRODUCT, label: "Boîte", quantity: 10, is_usual: false, unit: "u", position: 1, created_at: "2026-11-20T08:00:00.000Z" },
      ],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>, body?: unknown) {
  const response = await (handler as Handler)(
    new Request("http://localhost/api/test", {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve(params as never) },
  );
  const payload = (await response.json()) as { data?: never; error?: { message: string; code?: string } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

function packagingsOf(fake: ReturnType<typeof seed>, productId: string): FakeRow[] {
  return fake.tables.product_packagings.filter((row) => row.product_id === productId);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sale packagings of an article", () => {
  it.each<[string, string, Role, boolean, boolean]>([
    ["an admin", ADMIN, "admin", false, true],
    ["an engineer, shared base closed", ENGINEER, "engineer", false, false],
    ["an engineer, shared base open", ENGINEER, "engineer", true, true],
    ["a viewer", VIEWER, "viewer", true, false],
    ["a director", DIRECTOR, "director", true, false],
  ])("%s reads them in the order they were added, in their unit, told whether they may change them", async (_label, actor, role, sharedOpen, canEdit) => {
    seed(actor, role, { sharedOpen });
    const listed = await call(packagingsRoute.GET, "GET", { productId: SHARED_PRODUCT });
    expect(listed.status).toBe(200);
    expect(listed.data).toEqual({
      items: [
        { id: BAR, label: "Barre", quantity: 6, is_usual: true, unit: "ml" },
        { id: REEL, label: "Touret", quantity: 100, is_usual: false, unit: "ml" },
      ],
      can_edit: canEdit,
    });
  });

  it("an engineer may change the packagings of an article they added", async () => {
    seed(AUTHOR, "engineer");
    const listed = await call(packagingsRoute.GET, "GET", { productId: AUTHOR_PRODUCT });
    expect(listed.data).toMatchObject({ can_edit: true });
  });

  it("a member of another tenant neither reads nor writes them, nor learns the article exists", async () => {
    const fake = seed(OUTSIDER, "admin");
    expect((await call(packagingsRoute.GET, "GET", { productId: SHARED_PRODUCT })).status).toBe(404);
    expect((await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "Couronne", quantity: 50 })).status).toBe(404);
    expect((await call(packagingRoute.PATCH, "PATCH", { productId: SHARED_PRODUCT, packagingId: BAR }, { quantity: 12 })).status).toBe(404);
    expect((await call(packagingRoute.DELETE, "DELETE", { productId: SHARED_PRODUCT, packagingId: BAR })).status).toBe(404);
    expect(fake.writes).toEqual([]);
  });

  it("an admin adds one; the tenant is the article's and the answer is the whole list", async () => {
    const fake = seed(ADMIN, "admin");
    const created = await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "  Couronne ", quantity: 2.5 });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({
      items: [
        { id: BAR, label: "Barre", quantity: 6, is_usual: true },
        { id: REEL, label: "Touret", quantity: 100, is_usual: false },
        { label: "Couronne", quantity: 2.5, is_usual: false, unit: "ml" },
      ],
      can_edit: true,
    });
    // Neither the tenant, the unit, the key nor the position is sent: the database gives them.
    expect(fake.writes).toEqual([
      { table: "product_packagings", operation: "insert", values: { product_id: SHARED_PRODUCT, label: "Couronne", quantity: 2.5, is_usual: false }, ids: [expect.any(String)] },
    ]);
  });

  it.each<[string, string, Role, string, boolean, string]>([
    ["a viewer", VIEWER, "viewer", SHARED_PRODUCT, true, "L'ajout et la modification d'articles sont réservés aux administrateurs et aux ingénieurs."],
    ["a director", DIRECTOR, "director", SHARED_PRODUCT, true, "L'ajout et la modification d'articles sont réservés aux administrateurs et aux ingénieurs."],
    ["an engineer on the shared base while it is closed", ENGINEER, "engineer", SHARED_PRODUCT, false, "Cet article fait partie de la base commune : vous modifiez seulement les articles que vous avez ajoutés. Un administrateur peut ouvrir la base commune aux ingénieurs."],
    ["an engineer on another engineer's article while the base is closed", ENGINEER, "engineer", AUTHOR_PRODUCT, false, "Cet article fait partie de la base commune : vous modifiez seulement les articles que vous avez ajoutés. Un administrateur peut ouvrir la base commune aux ingénieurs."],
  ])("%s is refused with a sentence before any write", async (_label, actor, role, productId, sharedOpen, message) => {
    const fake = seed(actor, role, { sharedOpen });
    const packagingId = productId === SHARED_PRODUCT ? BAR : BOX;
    for (const attempt of [
      call(packagingsRoute.POST, "POST", { productId }, { label: "Couronne", quantity: 50 }),
      call(packagingRoute.PATCH, "PATCH", { productId, packagingId }, { quantity: 12 }),
      call(packagingRoute.DELETE, "DELETE", { productId, packagingId }),
    ]) {
      const refused = await attempt;
      expect(refused.status).toBe(403);
      expect(refused.error?.message).toBe(message);
    }
    expect(fake.writes).toEqual([]);
  });

  it("an engineer writes them once the shared base is open, and on an article they added", async () => {
    const open = seed(ENGINEER, "engineer", { sharedOpen: true });
    expect((await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "Couronne", quantity: 50 })).status).toBe(201);
    expect(packagingsOf(open, SHARED_PRODUCT)).toHaveLength(3);

    const own = seed(AUTHOR, "engineer");
    expect((await call(packagingRoute.PATCH, "PATCH", { productId: AUTHOR_PRODUCT, packagingId: BOX }, { label: "Carton", quantity: 12 })).status).toBe(200);
    expect(packagingsOf(own, AUTHOR_PRODUCT)).toMatchObject([{ label: "Carton", quantity: 12 }]);
  });

  it.each<[string, unknown]>([
    ["a quantity of zero", { label: "Barre", quantity: 0 }],
    ["a negative quantity", { label: "Barre", quantity: -6 }],
    ["a quantity with four decimals", { label: "Barre", quantity: 1.2345 }],
    ["a quantity sent as text", { label: "Barre", quantity: "6" }],
    ["a blank label", { label: "   ", quantity: 6 }],
    ["a label over 80 characters", { label: "x".repeat(81), quantity: 6 }],
    ["an unknown key", { label: "Barre", quantity: 6, tenant_id: OTHER_TENANT }],
  ])("%s is refused before the database", async (_label, body) => {
    const fake = seed(ADMIN, "admin");
    const refused = await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, body);
    expect(refused.status).toBe(400);
    expect(fake.writes).toEqual([]);
  });

  it("an update that changes nothing is refused", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await call(packagingRoute.PATCH, "PATCH", { productId: SHARED_PRODUCT, packagingId: BAR }, {})).status).toBe(400);
    expect((await call(packagingRoute.PATCH, "PATCH", { productId: SHARED_PRODUCT, packagingId: BAR }, { quantity: 0 })).status).toBe(400);
    expect(fake.writes).toEqual([]);
  });

  it("the same packaging, label folded for case and accents, is refused with its sentence", async () => {
    const fake = seed(ADMIN, "admin");
    const refused = await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "BARRE", quantity: 6 });
    expect(refused.status).toBe(409);
    expect(refused.error?.message).toBe("Ce conditionnement existe déjà pour cet article.");
    expect(packagingsOf(fake, SHARED_PRODUCT)).toHaveLength(2);
    // Another quantity is another packaging.
    expect((await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "Barre", quantity: 3 })).status).toBe(201);
  });

  it("marking a packaging usual moves the mark, as the answer says", async () => {
    seed(ADMIN, "admin");
    const marked = await call(packagingRoute.PATCH, "PATCH", { productId: SHARED_PRODUCT, packagingId: REEL }, { is_usual: true });
    expect(marked.status).toBe(200);
    expect(marked.data).toEqual({
      items: [
        { id: BAR, label: "Barre", quantity: 6, is_usual: false, unit: "ml" },
        { id: REEL, label: "Touret", quantity: 100, is_usual: true, unit: "ml" },
      ],
      can_edit: true,
    });
    const added = await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "Couronne", quantity: 50, is_usual: true });
    expect((added.data as { items: Array<{ label: string; is_usual: boolean }> }).items.filter((item) => item.is_usual)).toEqual([
      expect.objectContaining({ label: "Couronne" }),
    ]);
  });

  it("an admin removes one and is answered the list without it", async () => {
    const fake = seed(ADMIN, "admin");
    const removed = await call(packagingRoute.DELETE, "DELETE", { productId: SHARED_PRODUCT, packagingId: BAR });
    expect(removed.status).toBe(200);
    expect(removed.data).toEqual({ items: [{ id: REEL, label: "Touret", quantity: 100, is_usual: false, unit: "ml" }], can_edit: true });
    expect(packagingsOf(fake, SHARED_PRODUCT).map((row) => row.id)).toEqual([REEL]);
  });

  it("a packaging is not reached through the URL of another article", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await call(packagingRoute.PATCH, "PATCH", { productId: AUTHOR_PRODUCT, packagingId: BAR }, { quantity: 12 })).status).toBe(404);
    expect((await call(packagingRoute.DELETE, "DELETE", { productId: AUTHOR_PRODUCT, packagingId: BAR })).status).toBe(404);
    expect((await call(packagingRoute.DELETE, "DELETE", { productId: FOREIGN_PRODUCT, packagingId: BAR })).status).toBe(404);
    expect(packagingsOf(fake, SHARED_PRODUCT)).toHaveLength(2);
    expect(fake.writes.filter((write) => write.ids.length > 0)).toEqual([]);
  });

  it("an article without a unit gets no packaging, and the refusal says why", async () => {
    const fake = seed(ADMIN, "admin");
    const refused = await call(packagingsRoute.POST, "POST", { productId: DRAFT_PRODUCT }, { label: "Barre", quantity: 6 });
    expect(refused.status).toBe(422);
    expect(refused.error).toMatchObject({
      code: "PRODUCT_PACKAGING_UNIT_REQUIRED",
      message: "Renseignez et enregistrez l’unité de l’article avant d’ajouter ses conditionnements de vente.",
    });
    expect(fake.writes).toEqual([]);
  });

  it("a packaging whose article changed unit meanwhile is refused with a sentence that says to reload", async () => {
    seed(ADMIN, "admin", {
      refuseInsert: (table) => table === "product_packagings" && {
        code: "23503",
        message: 'insert or update on table "product_packagings" violates foreign key constraint "product_packagings_article_unit_fkey"',
      },
    });
    const refused = await call(packagingsRoute.POST, "POST", { productId: SHARED_PRODUCT }, { label: "Couronne", quantity: 50 });
    expect(refused.status).toBe(409);
    expect(refused.error).toMatchObject({
      code: "PRODUCT_PACKAGING_UNIT_CHANGED",
      message: "L’unité de l’article vient de changer : rechargez l’article avant d’ajouter ce conditionnement.",
    });
  });
});
