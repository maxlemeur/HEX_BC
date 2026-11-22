import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import * as companyRoute from "@/app/api/consultation-message-templates/company/route";
import * as personalRoute from "@/app/api/consultation-message-templates/personal/route";
import * as templatesRoute from "@/app/api/consultation-message-templates/route";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes, written before the routes (TI-691: the consultation message follows the member's own template,
 * else the company's, else today's message). Every text is invented:
 *  1. a member reads another member's template, or another tenant's company template, or its author;
 *  2. a member names the tenant or the member of the template they save (only the database sets them);
 *  3. a template without its lines or designation, with its lines twice, blank, over its bound or holding a NUL is
 *     stored (the refusal must say why, in words);
 *  4. a member who is not an admin of the active tenant writes the company template, or a refusal is not 403;
 *  5. resetting fails when there is nothing to reset, or resets someone else's template;
 *  6. a second save leaves two rows.
 * Review of PR #463:
 *  7. the tables are not installed yet (migration not applied where the server reads): the read fails and the
 *     devis step offers no message, instead of saying the templates are not available (none can exist there);
 *     or any other read failure is answered as a 400 the client caused;
 *  8. a field other than {lignes} written twice is refused.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const ENGINEER = "20000000-0000-4000-8000-000000000002";
const COLLEAGUE = "20000000-0000-4000-8000-000000000003";
const OUTSIDER = "20000000-0000-4000-8000-000000000004";

type Role = "admin" | "engineer" | "viewer" | "director";

const OWN = { message_template: "Bonjour {fournisseur}\n{lignes}", line_template: "- {désignation}" };

function seed(actor: string, role: Role, rpc: Record<string, unknown> = {}) {
  const fake = createFakeSupabase({
    userId: actor,
    tables: {
      tenant_memberships: [fakeMembership(actor, actor === OUTSIDER ? OTHER_TENANT : TENANT, role)],
      material_request_message_templates: [
        { tenant_id: TENANT, user_id: ENGINEER, ...OWN, created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z" },
        { tenant_id: TENANT, user_id: COLLEAGUE, message_template: "Collègue {lignes}", line_template: "* {désignation}" },
        { tenant_id: OTHER_TENANT, user_id: ENGINEER, message_template: "Ailleurs {lignes}", line_template: "{désignation}" },
      ],
      tenant_consultation_message_templates: [
        { tenant_id: TENANT, message_template: "Société {lignes}", line_template: "• {désignation}", updated_by: ADMIN },
        { tenant_id: OTHER_TENANT, message_template: "Autre société {lignes}", line_template: "{désignation}", updated_by: OUTSIDER },
      ],
    },
    rpc,
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Handler = (request: Request) => Promise<Response>;

async function call(handler: unknown, method: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json" };
  }
  const response = await (handler as Handler)(new Request("http://localhost/api/consultation-message-templates", init));
  const payload = (await response.json()) as { data?: never; error?: { code: string; message: string } };
  return { status: response.status, data: payload.data as never, error: payload.error };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("consultation message templates", () => {
  it("reads the caller's own template and their company's, never another's, nor the author (1)", async () => {
    seed(ENGINEER, "engineer");
    const read = await call(templatesRoute.GET, "GET");

    expect(read.status).toBe(200);
    expect(read.data).toEqual({
      personal: OWN,
      company: { message_template: "Société {lignes}", line_template: "• {désignation}" },
      can_edit_company: false,
      available: true,
    });
    seed(OUTSIDER, "admin");
    expect((await call(templatesRoute.GET, "GET")).data).toEqual({
      personal: null,
      company: { message_template: "Autre société {lignes}", line_template: "{désignation}" },
      can_edit_company: true,
      available: true,
    });
  });

  it("refuses an anonymous caller", async () => {
    seed(null as never, "viewer");
    expect((await call(templatesRoute.GET, "GET")).status).toBe(401);
  });

  it("saves the member's own template without naming the tenant or the member, once (2, 6)", async () => {
    // The admin has no template of their own yet: the first save adds it, the second replaces it.
    const fake = seed(ADMIN, "admin");
    const first = await call(personalRoute.PUT, "PUT", { message_template: "Salut\r\n{lignes}", line_template: "{quantité} {désignation}" });
    expect(first.status).toBe(200);
    expect(first.data).toEqual({ personal: { message_template: "Salut\n{lignes}", line_template: "{quantité} {désignation}" } });
    const second = await call(personalRoute.PUT, "PUT", { message_template: "Re {lignes}", line_template: "{désignation}" });
    expect(second.status).toBe(200);
    const mine = fake.tables.material_request_message_templates.filter((row: FakeRow) => row.user_id === ADMIN);
    expect(mine.map((row: FakeRow) => [row.tenant_id, row.message_template])).toEqual([[TENANT, "Re {lignes}"]]);
    for (const write of fake.writes.filter((entry) => entry.table === "material_request_message_templates")) {
      expect(Object.keys(write.values as FakeRow).sort()).toEqual(["line_template", "message_template"]);
    }

    const forged = await call(personalRoute.PUT, "PUT", { ...OWN, tenant_id: OTHER_TENANT, user_id: ENGINEER });
    expect(forged.status).toBe(400);
  });

  it.each<[string, Record<string, string>, RegExp]>([
    ["without its lines", { message_template: "Bonjour", line_template: "{désignation}" }, /doit contenir \{lignes\}/],
    ["without the designation", { message_template: "{lignes}", line_template: "{quantité}" }, /doit contenir \{désignation\}/],
    ["with its lines twice", { message_template: "{lignes}\n{lignes}", line_template: "{désignation}" }, /plusieurs fois/],
    ["blank", { message_template: " \n\t", line_template: "{désignation}" }, /vide/],
    ["over its bound", { message_template: `${"m".repeat(1993)}{lignes}`, line_template: "{désignation}" }, /2000 caractères/],
    ["over the line bound", { message_template: "{lignes}", line_template: `${"l".repeat(288)}{désignation}` }, /300 caractères/],
    ["holding a NUL", { message_template: "{lignes}\u0000", line_template: "{désignation}" }, /caractère/],
  ])("refuses a template %s, in words (3)", async (_label, body, sentence) => {
    const fake = seed(ENGINEER, "engineer");
    const refused = await call(personalRoute.PUT, "PUT", body);
    expect(refused.status).toBe(400);
    expect(JSON.stringify(refused.error)).toMatch(sentence);
    expect(fake.writes).toEqual([]);
  });

  it("resets the member's own template only, and again without error (5)", async () => {
    const fake = seed(ENGINEER, "engineer");
    expect(await call(personalRoute.DELETE, "DELETE")).toMatchObject({ status: 200, data: { personal: null } });
    expect(await call(personalRoute.DELETE, "DELETE")).toMatchObject({ status: 200, data: { personal: null } });
    expect(
      fake.tables.material_request_message_templates.map((row: FakeRow) => `${row.tenant_id}:${row.user_id}`),
    ).toEqual([`${TENANT}:${COLLEAGUE}`, `${OTHER_TENANT}:${ENGINEER}`]);
  });

  it.each<[string, string, Role]>([
    ["an engineer", ENGINEER, "engineer"],
    ["a viewer", COLLEAGUE, "viewer"],
    ["a director", COLLEAGUE, "director"],
  ])("refuses the company template to %s, before the database (4)", async (_label, actor, role) => {
    const fake = seed(actor, role);
    expect((await call(companyRoute.PUT, "PUT", OWN)).status).toBe(403);
    expect((await call(companyRoute.DELETE, "DELETE")).status).toBe(403);
    expect(fake.rpcCalls).toEqual([]);
  });

  it("lets an admin save and reset the company template through the database functions (4, 5)", async () => {
    const fake = seed(ADMIN, "admin", {
      save_tenant_consultation_message_template: (args: Record<string, unknown>) => ({
        data: [{ tenant_id: TENANT, message_template: args.p_message_template, line_template: args.p_line_template }],
      }),
      reset_tenant_consultation_message_template: () => ({ data: false }),
    });
    const saved = await call(companyRoute.PUT, "PUT", { message_template: "Entreprise\r\n{lignes}", line_template: "- {désignation}" });
    expect(saved).toMatchObject({
      status: 200,
      data: { company: { message_template: "Entreprise\n{lignes}", line_template: "- {désignation}" } },
    });
    expect(JSON.stringify(saved.data)).not.toMatch(/updated_by|tenant_id/);
    expect(fake.rpcArgs).toEqual([
      {
        name: "save_tenant_consultation_message_template",
        args: { p_message_template: "Entreprise\n{lignes}", p_line_template: "- {désignation}" },
      },
    ]);
    expect(await call(companyRoute.DELETE, "DELETE")).toMatchObject({ status: 200, data: { company: null } });
    expect((await call(companyRoute.PUT, "PUT", { message_template: "Entreprise", line_template: "{désignation}" })).status).toBe(400);
  });

  it("says a refusal of the database function in words (4)", async () => {
    seed(ADMIN, "admin", {
      save_tenant_consultation_message_template: () => ({
        data: null,
        error: { code: "42501", message: "TENANT_CONSULTATION_MESSAGE_TEMPLATE_ADMIN_ONLY" },
      }),
    });
    const refused = await call(companyRoute.PUT, "PUT", OWN);
    expect(refused.status).toBe(403);
    expect(refused.error?.message).toMatch(/administrateur/);
  });

  /** The two template tables answer this error to every read, as the database would. */
  function failReads(fake: ReturnType<typeof seed>, failure: { code: string; message: string | ((table: string) => string) }) {
    const from = fake.supabase.from.bind(fake.supabase);
    (fake.supabase as { from: unknown }).from = (table: string) => {
      if (table !== "material_request_message_templates" && table !== "tenant_consultation_message_templates") return from(table);
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: null,
          error: {
            details: null, hint: null, code: failure.code,
            message: typeof failure.message === "function" ? failure.message(table) : failure.message,
          },
        }),
      };
      return chain;
    };
  }

  it.each([
    ["PGRST205", "Could not find the table 'public.material_request_message_templates' in the schema cache"],
    ["42P01", (table: string) => `relation "public.${table}" does not exist`],
  ] as const)("says the templates are not installed yet when the tables are missing (%s) (7)", async (code, message) => {
    const fake = seed(ENGINEER, "engineer");
    failReads(fake, { code, message });
    const read = await call(templatesRoute.GET, "GET");
    expect(read.status).toBe(200);
    expect(read.data).toEqual({ personal: null, company: null, can_edit_company: false, available: false });
  });

  it("answers any other read failure as the server's, not the caller's (7)", async () => {
    const fake = seed(ENGINEER, "engineer");
    failReads(fake, { code: "XX000", message: "internal error" });
    const read = await call(templatesRoute.GET, "GET");
    expect(read.status).toBeGreaterThanOrEqual(500);
    failReads(fake, { code: "42P01", message: 'relation "public.estimate_items" does not exist' });
    expect((await call(templatesRoute.GET, "GET")).status).toBeGreaterThanOrEqual(500);
  });

  it("saves a template that writes a field twice (8)", async () => {
    seed(ENGINEER, "engineer");
    const body = { message_template: "Bonjour {fournisseur},\n{lignes}\nMerci pour {fournisseur} !", line_template: "{désignation} ({désignation})" };
    expect(await call(personalRoute.PUT, "PUT", body)).toMatchObject({ status: 200, data: { personal: body } });
  });
});
