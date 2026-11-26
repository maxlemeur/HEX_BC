import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
// The arbiter boundary: no test reaches a provider.
vi.mock("@/lib/ai/choice-questions", () => ({
  askChoiceQuestions: vi.fn(),
  readChoiceProviderOptions: vi.fn(),
}));
vi.mock("next/headers", async (importOriginal) => ({
  ...await importOriginal<typeof import("next/headers")>(), headers: async () => new Headers({ host: "127.0.0.1:3000" }),
}));
vi.mock("@/lib/ai/chatgpt-local-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/chatgpt-local-auth")>(), getLocalChatGptCredential: vi.fn(),
}));
vi.mock("@/lib/ai/access/openai-api", () => ({ openAiApiKeyAccess: () => ({ state: async () => ({ status: "empty" }) }) }));
vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn(), getStructuredAiAvailability: vi.fn() }));

import { GET, maxDuration, POST } from "@/app/api/catalogue/workbook-import/suggestions/route";
import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { askChoiceQuestions, readChoiceProviderOptions } from "@/lib/ai/choice-questions";
import { callStructuredAi, getStructuredAiAvailability } from "@/lib/ai/structured-ai";
import {
  COSTING_WORKBOOK_SUGGESTION_PROVIDERS,
  COSTING_WORKBOOK_SUGGESTIONS_MAX_BODY_BYTES,
  costingWorkbookSuggestionProvidersResponseSchema,
  costingWorkbookSuggestionsRequestSchema,
  costingWorkbookSuggestionsResponseSchema,
  type CostingWorkbookSuggestionProvidersResponse,
  type CostingWorkbookSuggestionsResponse,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { unprocessableEntity } from "@/lib/http/api-error";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the suggestions route (the proposals themselves are in costing-workbook-suggestions-server.test.ts).
 * Everything is invented.
 *  1. Rights: a member who may not import the workbook reads the providers or the proposals; a visitor without a
 *     session is answered.
 *  2. A body outside the contract (another task, a key in excess, a list beyond its bound, a column the reader does
 *     not know), not JSON, or too large reaches the catalogue or a provider.
 *  3. The answer is not the one the screen parses, or is not in the envelope of the other routes.
 *  4. GET calls a provider; POST without `provider` calls one; something is written.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const VIEWER = "20000000-0000-4000-8000-000000000003";
const ALPHA = "40000000-0000-4000-8000-000000000001";
const POINT_P = "40000000-0000-4000-8000-000000000002";
const TUBE = "90000000-0000-4000-8000-000000000001";
const TUBE_TYPE = "a0000000-0000-4000-8000-000000000001";

const OPTIONS = {
  defaultProvider: "chatgpt_plan",
  providers: {
    chatgpt_plan: {
      available: true, message: "Connexion ChatGPT configurée.",
      models: [{ id: "plan-a", name: "Modèle A", reasoningEfforts: ["high"], defaultReasoningEffort: "high" }],
      preferences: { model: "plan-a", reasoningEffort: "high" },
    },
    personal_api_key: { available: false, message: "Configurez votre clé API OpenAI et son modèle dans Mon profil.", models: [], preferences: null },
    decisions: { available: false, message: "Le classement Decisions est désactivé." },
  },
} satisfies CostingWorkbookSuggestionProvidersResponse;

function seed(actor: string | null = ADMIN, role: "admin" | "viewer" = "admin") {
  const supplier = (id: string, tenant: string, name: string): FakeRow =>
    ({ id, tenant_id: tenant, name, city: null, email: null, siret: null, created_at: "2026-10-01T09:00:00.000Z", is_active: true });
  const fake = createFakeSupabase({
    userId: actor,
    tables: {
      tenant_memberships: actor ? [fakeMembership(actor, TENANT, role)] : [],
      suppliers: [
        supplier(ALPHA, TENANT, "Fournisseur Alpha SAS"), supplier(POINT_P, TENANT, "Point P Matériaux"),
        supplier("40000000-0000-4000-8000-000000000009", OTHER_TENANT, "Fournisseur Alpha"),
      ],
      supply_types: [{ id: TUBE_TYPE, tenant_id: TENANT, code: "tube", name: "Tubes" }],
      products: [{
        id: TUBE, tenant_id: TENANT, reference: "TUB-304-20", designation: "Tube inox 304L DN20", product_type: "Tube", material: "Inox 304L",
        grade: "304L", dimensions: "DN20", standard: null, unit: "ml", is_active: true, catalogue_status: "validated", supply_type_id: TUBE_TYPE,
      }],
      supplier_catalog_items: [],
      product_aliases: [],
    },
  });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Answer<Data> = { status: number; ok?: boolean; data?: Data; error?: { code: string; message: string } };

async function read<Data>(response: Response): Promise<Answer<Data>> {
  const payload = (await response.json()) as { ok: boolean; data?: Data; error?: Answer<Data>["error"] };
  return { status: response.status, ok: payload.ok, data: payload.data, error: payload.error };
}

const URL = "http://localhost/api/catalogue/workbook-import/suggestions";
const send = async (body: unknown, raw?: string) => read<CostingWorkbookSuggestionsResponse>(await POST(new Request(URL, {
  method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body),
})));

const BODIES = {
  suppliers: { task: "suppliers", names: ["Fournisseur Alpha", "Pt.P"] },
  articles: { task: "articles", lines: [{ key: "l1", reference: "TUB-304-20", wording: "Tube", material: "Inox 304L", dimension: "DN20", unit: "ml" }] },
  supply_types: { task: "supply_types", groups: [{ key: "g1", family_code: "I4L", product_type: "Tube", material: null, samples: ["Tube DN20"], count: 3 }] },
  columns: { task: "columns", missing: ["PR. FO"], headers: [{ index: 8, text: "PR FO", samples: ["12,59"] }] },
  supplier_codes: { task: "supplier_codes", values: ["Devis 2024-118"] },
} as const;

const many = <T>(count: number, make: (index: number) => T) => Array.from({ length: count }, (_, index) => make(index));
const line = (key: string) => ({ key, reference: "", wording: "Tube", material: "", dimension: "", unit: "" });
const group = (key: string) => ({ key, family_code: null, product_type: "Tube", material: null, samples: [], count: 1 });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(readChoiceProviderOptions).mockResolvedValue(OPTIONS);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/catalogue/workbook-import/suggestions", () => {
  it("answers the providers the member can ask, without asking any (3, 4)", async () => {
    const fake = seed();

    const answer = await read(await GET());

    expect(answer).toEqual({ status: 200, ok: true, data: OPTIONS, error: undefined });
    expect(costingWorkbookSuggestionProvidersResponseSchema.safeParse(answer.data).success).toBe(true);
    expect(readChoiceProviderOptions).toHaveBeenCalledWith({ userId: ADMIN, tenantId: TENANT });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(fake.reads).toEqual(["tenant_memberships"]);
  });

  it("refuses a viewer, and a visitor without a session (1)", async () => {
    seed(VIEWER, "viewer");
    expect(await read(await GET())).toMatchObject({ status: 403, ok: false, error: { message: PRODUCT_WRITE_REFUSAL } });

    seed(null);
    expect((await read(await GET())).status).toBe(401);
    expect(readChoiceProviderOptions).not.toHaveBeenCalled();
  });
});

describe("POST /api/catalogue/workbook-import/suggestions", () => {
  it("lets the arbiter answer for up to 120 s", () => {
    expect(maxDuration).toBe(120);
  });

  it.each(Object.entries(BODIES))("answers the deterministic proposals of « %s » in the envelope, as the screen parses them (3, 4)", async (task, body) => {
    const fake = seed();

    const answer = await send(body);

    expect(answer).toMatchObject({ status: 200, ok: true, data: { task, provider: null, model: null, status: "deterministic" } });
    expect(costingWorkbookSuggestionsResponseSchema.safeParse(answer.data).success).toBe(true);
    expect(answer.data?.items).toHaveLength(task === "suppliers" ? 2 : 1);
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("proposes from the company's own records", async () => {
    seed();

    expect((await send(BODIES.suppliers)).data?.items).toEqual([
      { name: "Fournisseur Alpha", candidates: [{ supplier_id: ALPHA, label: "Fournisseur Alpha SAS", score: 1 }], suggestion: { supplier_id: ALPHA, confidence: 1, source: "match" } },
      { name: "Pt.P", candidates: [{ supplier_id: POINT_P, label: "Point P Matériaux", score: 0.75 }], suggestion: null },
    ]);
    expect((await send(BODIES.articles)).data?.items).toMatchObject([{ key: "l1", suggestion: { product_id: TUBE, confidence: 1, source: "match" } }]);
    expect((await send(BODIES.columns)).data?.items).toEqual([{ column: "PR. FO", suggestion: { index: 8, confidence: 1, source: "match" } }]);
  });

  it("asks the provider named in the body, and answers its status (3)", async () => {
    seed();
    vi.mocked(askChoiceQuestions).mockImplementation(async (input) => ({
      provider: input.provider, status: "partial", message: "Réponse partielle de l’IA.", model: "modele-fictif",
      answers: input.questions.map((question) => ({ id: question.id, choice: POINT_P, confidence: 0.8 })),
    }));

    const selection = { provider: "personal_api_key", model: "modele-fictif", reasoning_effort: "medium" };
    const answer = await send({ ...BODIES.suppliers, ...selection });

    expect(answer).toMatchObject({ status: 200, data: { provider: "personal_api_key", model: "modele-fictif", status: "partial", message: "Réponse partielle de l’IA." } });
    expect(answer.data?.items[1]).toMatchObject({ suggestion: { supplier_id: POINT_P, confidence: 0.8, source: "ai" } });
    expect(costingWorkbookSuggestionsResponseSchema.safeParse(answer.data).success).toBe(true);
    expect(vi.mocked(askChoiceQuestions).mock.calls[0][0]).toMatchObject({ ...selection, owner: { userId: ADMIN, tenantId: TENANT } });
  });

  it.each([null, "plan-retired"])("uses the same ChatGPT defaults for GET and POST with omitted settings when the saved model is %s", async (savedModel) => {
    seed();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PORT", "3000");
    vi.stubEnv("MERGEONE_DEV_HOSTS", "");
    vi.stubEnv("MERGEONE_DEV_SUPABASE_TARGET", "");
    vi.mocked(getLocalChatGptCredential).mockResolvedValue({
      model: savedModel, reasoningEffort: "low", accessToken: "fictional-token", profileId: "fictional-plan", authorizationId: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ models: [{
      slug: "gpt-6.2-sol", display_name: "Modèle proposé", visibility: "list", supported_reasoning_levels: ["high"],
    }] })));
    vi.mocked(getStructuredAiAvailability).mockImplementation(async (_owner, options) => ({
      available: options?.allowUnselectedModel === true || savedModel !== null, message: "Connexion ChatGPT configurée.",
    }));
    vi.mocked(callStructuredAi).mockImplementation(async (options, _owner, preferences) => ({
      data: options.schema.parse({ reponses: [{ question: "q1", choix: "c1", confiance: 0.9 }] }),
      model: preferences?.model ?? savedModel ?? "modele-par-defaut-fictif", provider: "chatgpt",
      tokenCount: 0, tokenUsage: { inputTokens: 0, reasoningTokens: 0, outputTokens: 0, totalTokens: 0 },
      costCents: 0, durationMs: 0, promptVersion: options.context?.promptVersion ?? "fixture",
    }));
    const arbiter = await vi.importActual<typeof import("@/lib/ai/choice-questions")>("@/lib/ai/choice-questions");
    vi.mocked(readChoiceProviderOptions).mockImplementation(arbiter.readChoiceProviderOptions);
    vi.mocked(askChoiceQuestions).mockImplementation(arbiter.askChoiceQuestions);

    const sources = await read<CostingWorkbookSuggestionProvidersResponse>(await GET());
    expect(sources).toMatchObject({ status: 200, data: { providers: { chatgpt_plan: {
      available: true, preferences: { model: "gpt-6.2-sol", reasoningEffort: "high" },
    } } } });
    expect(callStructuredAi).not.toHaveBeenCalled();

    const suggestion = await send({ ...BODIES.suppliers, provider: "chatgpt_plan" });
    const expected = sources.data?.providers.chatgpt_plan.preferences;
    expect(suggestion).toMatchObject({ status: 200, data: { status: "available", provider: "chatgpt_plan", model: expected?.model } });
    expect(callStructuredAi).toHaveBeenCalledWith(expect.anything(), { userId: ADMIN, tenantId: TENANT }, expected);
  });

  it("returns the French 422 even when deterministic matching finds an answer", async () => {
    seed();
    const message = "Ce niveau de raisonnement n’est pas proposé pour le modèle choisi.";
    vi.mocked(askChoiceQuestions).mockRejectedValue(unprocessableEntity(message));

    expect(await send({ ...BODIES.articles, provider: "chatgpt_plan", reasoning_effort: "niveau-inconnu" }))
      .toMatchObject({ status: 422, ok: false, error: { message } });
    expect(askChoiceQuestions).toHaveBeenCalledWith(expect.objectContaining({ questions: [], reasoning_effort: "niveau-inconnu" }));
  });

  it("refuses a model when the request is rules-only", async () => {
    seed();
    expect(await send({ ...BODIES.suppliers, model: "plan-a" })).toMatchObject({ status: 422, ok: false });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
  });

  it("refuses a viewer before any read of the catalogue (1)", async () => {
    const fake = seed(VIEWER, "viewer");

    for (const body of Object.values(BODIES)) {
      expect(await send({ ...body, provider: "chatgpt_plan" })).toMatchObject({ status: 403, ok: false, error: { message: PRODUCT_WRITE_REFUSAL } });
    }
    expect(new Set(fake.reads)).toEqual(new Set(["tenant_memberships"]));
    expect(askChoiceQuestions).not.toHaveBeenCalled();
  });

  it.each([
    ["no task", { names: ["Alpha"] }],
    ["an unknown task", { task: "prices", names: ["Alpha"] }],
    ["an unknown provider", { ...BODIES.suppliers, provider: "gemini" }],
    ["a key outside the contract", { ...BODIES.suppliers, tenant_id: OTHER_TENANT }],
    ["the list of another task", { task: "suppliers", values: ["Alpha"] }],
    ["no name", { task: "suppliers", names: [] }],
    ["an empty name", { task: "suppliers", names: [""] }],
    ["a name of 256 characters", { task: "suppliers", names: ["x".repeat(256)] }],
    ["201 names", { task: "suppliers", names: many(201, (index) => `Fournisseur ${index}`) }],
    ["101 lines", { task: "articles", lines: many(101, (index) => line(`l${index}`)) }],
    ["two lines of the same key", { task: "articles", lines: [line("l1"), line("l1")] }],
    ["a line key of 41 characters", { task: "articles", lines: [line("k".repeat(41))] }],
    ["a line with a key in excess", { task: "articles", lines: [{ ...line("l1"), product_id: TUBE }] }],
    ["a line without its unit", { task: "articles", lines: [{ key: "l1", reference: "", wording: "Tube", material: "", dimension: "" }] }],
    ["201 groups", { task: "supply_types", groups: many(201, (index) => group(`g${index}`)) }],
    ["two groups of the same key", { task: "supply_types", groups: [group("g1"), group("g1")] }],
    ["a group with four samples", { task: "supply_types", groups: [{ ...group("g1"), samples: ["a", "b", "c", "d"] }] }],
    ["a group with a negative count", { task: "supply_types", groups: [{ ...group("g1"), count: -1 }] }],
    ["a column the reader does not know", { task: "columns", missing: ["Prix"], headers: [] }],
    ["a column named twice", { task: "columns", missing: ["PR. FO", "PR. FO"], headers: [] }],
    ["no missing column", { task: "columns", missing: [], headers: [] }],
    ["61 headers", { task: "columns", missing: ["PR. FO"], headers: many(61, (index) => ({ index, text: `En-tête ${index}`, samples: [] })) }],
    ["two headers at the same position", { task: "columns", missing: ["PR. FO"], headers: [{ index: 1, text: "A", samples: [] }, { index: 1, text: "B", samples: [] }] }],
    ["a header with four samples", { task: "columns", missing: ["PR. FO"], headers: [{ index: 1, text: "A", samples: ["1", "2", "3", "4"] }] }],
    ["a header at a negative position", { task: "columns", missing: ["PR. FO"], headers: [{ index: -1, text: "A", samples: [] }] }],
    ["301 values", { task: "supplier_codes", values: many(301, (index) => `REF-${index}`) }],
    ["a value that is not a text", { task: "supplier_codes", values: [42] }],
    ["a body that is a list", [BODIES.suppliers]],
  ])("answers 400 to a body with %s, before any read or provider (2)", async (_label, body) => {
    const fake = seed();

    const answer = await send(body);

    expect(answer).toMatchObject({ status: 400, ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(fake.reads).toEqual([]);
    expect(askChoiceQuestions).not.toHaveBeenCalled();
  });

  it("accepts each list at its bound", async () => {
    seed();

    for (const body of [
      { task: "suppliers", names: many(200, (index) => `Fournisseur ${index}`) },
      { task: "articles", lines: many(100, (index) => line(`l${index}`)) },
      { task: "supply_types", groups: many(200, (index) => group(`g${index}`)) },
      { task: "columns", missing: ["PR. FO"], headers: many(60, (index) => ({ index, text: `En-tête ${index}`, samples: ["1", "2", "3"] })) },
      { task: "supplier_codes", values: many(300, (index) => `REF-${index}`) },
    ]) {
      expect((await send(body)).status).toBe(200);
    }
  });

  it("answers 400 to a body that is not JSON, and 413 to one above 512 KiB, before any read (2)", async () => {
    const fake = seed();

    expect((await send(null, "{\"task\": ")).status).toBe(400);
    const tooLarge = await send(null, " ".repeat(COSTING_WORKBOOK_SUGGESTIONS_MAX_BODY_BYTES + 1));
    expect(tooLarge).toMatchObject({
      status: 413,
      error: { message: "Cette demande de propositions est trop volumineuse (512 Ko au plus). Envoyez moins d’éléments à la fois." },
    });
    expect(COSTING_WORKBOOK_SUGGESTIONS_MAX_BODY_BYTES).toBe(512 * 1024);
    expect(fake.reads).toEqual([]);
  });
});

describe("contract", () => {
  it("names the arbiter's providers, in its order", async () => {
    const { CHOICE_PROVIDERS } = await vi.importActual<typeof import("@/lib/ai/choice-questions")>("@/lib/ai/choice-questions");

    expect(COSTING_WORKBOOK_SUGGESTION_PROVIDERS).toEqual(CHOICE_PROVIDERS);
  });

  it("is written with schemas a JSON schema can represent whole, for the API description", () => {
    const request = z.toJSONSchema(costingWorkbookSuggestionsRequestSchema, { io: "input", unrepresentable: "throw" });
    expect(JSON.stringify(request)).toContain("\"PR. FO\"");
    for (const schema of [costingWorkbookSuggestionsResponseSchema, costingWorkbookSuggestionProvidersResponseSchema]) {
      expect(() => z.toJSONSchema(schema, { io: "output", unrepresentable: "throw" })).not.toThrow();
    }
  });
});
