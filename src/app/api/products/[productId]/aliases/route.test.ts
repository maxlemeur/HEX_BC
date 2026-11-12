import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as aliasRoute from "@/app/api/products/[productId]/aliases/[aliasId]/route";
import * as aliasesRoute from "@/app/api/products/[productId]/aliases/route";
import { createFakeSupabase, fakeMembership } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the usual names of an article on the catalogue screen (TI-690, delivery 3). Fictional.
 *  1. A member of another tenant lists or deletes the usual names of this tenant's article, or learns it
 *     exists (404, not 403).
 *  2. A member who is neither an admin nor the one who taught a name deletes it.
 *  3. A name is deleted through the URL of another article.
 *  4. A member of the tenant cannot read the names (every member reads the catalogue).
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const AUTHOR = "20000000-0000-4000-8000-000000000002";
const ENGINEER = "20000000-0000-4000-8000-000000000003";
const VIEWER = "20000000-0000-4000-8000-000000000004";
const OUTSIDER = "20000000-0000-4000-8000-000000000006";
const PRODUCT = "90000000-0000-4000-8000-000000000001";
const OTHER_PRODUCT = "90000000-0000-4000-8000-000000000002";
const FOREIGN_PRODUCT = "90000000-0000-4000-8000-000000000009";
const ALIAS = "c0000000-0000-4000-8000-000000000001";
const OLDER_ALIAS = "c0000000-0000-4000-8000-000000000002";

type Role = "admin" | "engineer" | "viewer" | "director";

function seed(actor: string, role: Role) {
  const fake = createFakeSupabase({
    userId: actor,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      products: [
        { id: PRODUCT, tenant_id: TENANT, designation: "Coude 90° inox DN 50" },
        { id: OTHER_PRODUCT, tenant_id: TENANT, designation: "Té égal inox DN 50" },
        { id: FOREIGN_PRODUCT, tenant_id: OTHER_TENANT, designation: "Coude d'ailleurs" },
      ],
      product_aliases: [
        { id: ALIAS, tenant_id: TENANT, product_id: PRODUCT, alias: "coude 90", alias_key: "coude", created_by: AUTHOR, created_at: "2026-11-12T08:00:00.000Z" },
        { id: OLDER_ALIAS, tenant_id: TENANT, product_id: PRODUCT, alias: "coudé", alias_key: "coude", created_by: ADMIN, created_at: "2026-11-01T08:00:00.000Z" },
      ],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request, context: { params: Promise<never> }) => Promise<Response>;

async function call(handler: unknown, method: string, params: Record<string, string>) {
  const response = await (handler as Handler)(new Request("http://localhost/api/test", { method }), {
    params: Promise.resolve(params as never),
  });
  const payload = (await response.json()) as { data?: never; error?: { message: string } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usual names of an article", () => {
  it.each<[string, string, Role]>([
    ["a viewer", VIEWER, "viewer"],
    ["an engineer", ENGINEER, "engineer"],
    ["an admin", ADMIN, "admin"],
  ])("%s reads them, oldest first, without their author", async (_label, actor, role) => {
    seed(actor, role);
    const listed = await call(aliasesRoute.GET, "GET", { productId: PRODUCT });
    expect(listed.status).toBe(200);
    expect(listed.data).toEqual({
      items: [
        { id: OLDER_ALIAS, alias: "coudé", created_at: "2026-11-01T08:00:00.000Z" },
        { id: ALIAS, alias: "coude 90", created_at: "2026-11-12T08:00:00.000Z" },
      ],
    });
  });

  it("a member of another tenant neither reads nor deletes them", async () => {
    const fake = seed(OUTSIDER, "admin");
    expect((await call(aliasesRoute.GET, "GET", { productId: PRODUCT })).status).toBe(404);
    expect((await call(aliasRoute.DELETE, "DELETE", { productId: PRODUCT, aliasId: ALIAS })).status).toBe(404);
    expect(fake.writes).toEqual([]);
  });

  it.each<[string, string, Role, number]>([
    ["an admin deletes any", ADMIN, "admin", 200],
    ["the member who taught it deletes it", AUTHOR, "engineer", 200],
    ["another engineer is refused", ENGINEER, "engineer", 403],
    ["a viewer is refused", VIEWER, "viewer", 403],
  ])("%s", async (_label, actor, role, status) => {
    const fake = seed(actor, role);
    const deleted = await call(aliasRoute.DELETE, "DELETE", { productId: PRODUCT, aliasId: ALIAS });
    expect(deleted.status).toBe(status);
    expect(fake.tables.product_aliases.some((alias) => alias.id === ALIAS)).toBe(status !== 200);
    if (status === 200) expect(deleted.data).toEqual({ deleted: true });
    else expect(deleted.error?.message).toBe("Un nom usuel est retiré par un administrateur ou par le membre qui l’a appris.");
  });

  it("a name is not reached through the URL of another article", async () => {
    const fake = seed(ADMIN, "admin");
    expect((await call(aliasRoute.DELETE, "DELETE", { productId: OTHER_PRODUCT, aliasId: ALIAS })).status).toBe(404);
    expect((await call(aliasRoute.DELETE, "DELETE", { productId: FOREIGN_PRODUCT, aliasId: ALIAS })).status).toBe(404);
    expect(fake.writes).toEqual([]);
  });
});
