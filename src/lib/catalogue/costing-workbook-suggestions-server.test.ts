import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
// The arbiter boundary: no test reaches a provider.
vi.mock("@/lib/ai/choice-questions", () => ({
  askChoiceQuestions: vi.fn(),
  readChoiceProviderOptions: vi.fn(),
}));

import {
  askChoiceQuestions,
  readChoiceProviderOptions,
  type ChoiceArbitration,
  type ChoiceProvider,
  type ChoiceQuestion,
} from "@/lib/ai/choice-questions";
import type { CostingWorkbookColumn } from "@/lib/catalogue/costing-workbook";
import {
  costingWorkbookSuggestionsRequestSchema,
  costingWorkbookSuggestionsResponseSchema,
  type CostingWorkbookSuggestionsRequest,
} from "@/lib/catalogue/costing-workbook-suggestions-contract";
import {
  COSTING_WORKBOOK_SUGGESTION_TASKS,
  readWorkbookSuggestionProviders,
  suggestForWorkbook,
} from "@/lib/catalogue/costing-workbook-suggestions-server";
import { PRODUCT_WRITE_REFUSAL } from "@/lib/catalogue/product-writes";
import { createFakeSupabase, fakeMembership, type FakeRow } from "@/lib/material-requests/server.test-utils";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Failure modes of the workbook suggestions. Companies, suppliers, articles and references are invented.
 *  1. Rights: a member who may not import the workbook (viewer, director) reads the company's suppliers or
 *     articles through the proposals, or spends an AI source.
 *  2. A provider is called although none was asked for, or for an item the matching already decided, or for an
 *     item with nothing to choose from.
 *  3. The arbiter's answer is not reported as its own (`source: "ai"`, its confidence), « aucun » is confused
 *     with « no answer », or an answer that is not a choice of the question becomes a proposal.
 *  4. A provider that is unavailable or fails loses the deterministic proposals, or its status and message.
 *  5. Scope: a supplier, an article, a supplier code, a usual name or a supply type of another company is a
 *     candidate, a choice sent to the provider, or weighs on a proposal.
 *  6. A proposal is made on a doubt: two suppliers of the same name, a reference with a warning, a supply type
 *     carried by one article or by a minority, two headers that fit one column, a header given to two columns.
 *  7. Something is written.
 */

const TENANT = "10000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "10000000-0000-4000-8000-000000000002";
const ADMIN = "20000000-0000-4000-8000-000000000001";
const ENGINEER = "20000000-0000-4000-8000-000000000002";
const VIEWER = "20000000-0000-4000-8000-000000000003";
const DIRECTOR = "20000000-0000-4000-8000-000000000004";

const supplierId = (n: number) => `40000000-0000-4000-8000-00000000000${n}`;
const ALPHA = supplierId(1);
const POINT_P = supplierId(2);
const DURAND_LYON = supplierId(3);
const DURAND_NANTES = supplierId(4);
const ALPHA_ARCHIVED = supplierId(5);
const FOREIGN_ALPHA = supplierId(9);

const productId = (n: number) => `90000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const TUBE_20 = productId(1);
const ELBOW_20 = productId(2);
const ELBOW_25 = productId(3);
const VALVE_50 = productId(4);
const FLANGE_50 = productId(5);
const FLANGE_65 = productId(6);
const FLANGE_80 = productId(7);
const DRAFT_TUBE = productId(8);
const ARCHIVED_TUBE = productId(9);
const FOREIGN_VALVE = productId(20);

const KINDS = ["tube", "raccord", "vanne", "divers"] as const;
const supplyTypeId = (tenant: string, code: (typeof KINDS)[number]) =>
  `a${tenant === TENANT ? "0" : "9"}000000-0000-4000-8000-00000000000${KINDS.indexOf(code) + 1}`;
const NAMES = { tube: "Tubes", raccord: "Raccords", vanne: "Vannes", divers: "Divers" } as const;

function supplier(id: string, name: string, extra: FakeRow = {}): FakeRow {
  return { id, tenant_id: TENANT, name, city: null, email: null, siret: null, created_at: "2026-10-01T09:00:00.000Z", is_active: true, ...extra };
}

function product(id: string, extra: FakeRow): FakeRow {
  return {
    id, tenant_id: TENANT, reference: null, designation: "Article fictif", product_type: null, material: null, grade: null,
    dimensions: null, standard: null, unit: "u", is_active: true, catalogue_status: "validated", supply_type_id: null, ...extra,
  };
}

const TABLES = (): Record<string, FakeRow[]> => ({
  suppliers: [
    supplier(ALPHA, "Fournisseur Alpha SAS"),
    supplier(POINT_P, "Point P Matériaux"),
    supplier(DURAND_LYON, "Durand Robinetterie", { city: "Lyon" }),
    supplier(DURAND_NANTES, "Durand Robinetterie", { city: "Nantes" }),
    // Neither an archived supplier nor another company's is a candidate.
    supplier(ALPHA_ARCHIVED, "Fournisseur Alpha", { is_active: false }),
    supplier(FOREIGN_ALPHA, "Fournisseur Alpha", { tenant_id: OTHER_TENANT, city: "Ailleurs" }),
  ],
  supply_types: [TENANT, OTHER_TENANT].flatMap((tenant) => KINDS.map((code) => ({
    id: supplyTypeId(tenant, code), tenant_id: tenant, code, name: tenant === TENANT ? NAMES[code] : `${NAMES[code]} d’ailleurs`,
  }))),
  products: [
    product(TUBE_20, {
      reference: "TUB-304-20", designation: "Tube inox 304L DN20", product_type: "Tube", material: "Inox 304L", grade: "304L",
      dimensions: "DN20", unit: "ml", supply_type_id: supplyTypeId(TENANT, "tube"),
    }),
    product(ELBOW_20, {
      reference: "COU-304-20", designation: "Coude 90° inox 304L DN20", product_type: "Coude 90°", material: "Inox 304L",
      dimensions: "DN20", supply_type_id: supplyTypeId(TENANT, "raccord"),
    }),
    product(ELBOW_25, {
      reference: "COU-304-25", designation: "Coude 90° inox 304L DN25", product_type: "Coude 90°", material: "Inox 304L",
      dimensions: "DN25", supply_type_id: supplyTypeId(TENANT, "raccord"),
    }),
    product(VALVE_50, {
      reference: "VAN-50", designation: "Vanne à boisseau sphérique DN50", product_type: "Vanne à boisseau sphérique", material: "Laiton",
      dimensions: "DN50", supply_type_id: supplyTypeId(TENANT, "vanne"),
    }),
    // Three flanges: two fittings and one « divers », so no type is shared by 80 % of them.
    product(FLANGE_50, { reference: "BRI-50", designation: "Bride plate DN50", product_type: "Bride plate", dimensions: "DN50", supply_type_id: supplyTypeId(TENANT, "raccord") }),
    product(FLANGE_65, { reference: "BRI-65", designation: "Bride plate DN65", product_type: "Bride plate", dimensions: "DN65", supply_type_id: supplyTypeId(TENANT, "raccord") }),
    product(FLANGE_80, { reference: "BRI-80", designation: "Bride plate DN80", product_type: "Bride plate", dimensions: "DN80", supply_type_id: supplyTypeId(TENANT, "divers") }),
    // A draft and an archived tube say nothing of the type validated tubes carry, and an archived article is no candidate.
    product(DRAFT_TUBE, { reference: "TUB-304-25", designation: "Tube inox 304L DN25", product_type: "Tube", material: "Inox 304L", dimensions: "DN25", unit: "ml", catalogue_status: "draft", supply_type_id: supplyTypeId(TENANT, "tube") }),
    product(ARCHIVED_TUBE, { reference: "TUB-304-32", designation: "Tube inox 304L DN32", product_type: "Tube", material: "Inox 304L", dimensions: "DN32", unit: "ml", is_active: false, supply_type_id: supplyTypeId(TENANT, "tube") }),
    // Another company's articles: one bears a reference the workbook gives, and its tubes carry this company's type.
    product(FOREIGN_VALVE, { tenant_id: OTHER_TENANT, reference: "ETR-999", designation: "Vanne d’ailleurs DN50", product_type: "Vanne", dimensions: "DN50", supply_type_id: supplyTypeId(OTHER_TENANT, "vanne") }),
    ...[21, 22, 23].map((n) => product(productId(n), {
      tenant_id: OTHER_TENANT, reference: `ETR-TUB-${n}`, designation: "Tube d’ailleurs", product_type: "Tube", supply_type_id: supplyTypeId(TENANT, "tube"),
    })),
  ],
  supplier_catalog_items: [
    { id: "c0000000-0000-4000-8000-000000000001", tenant_id: TENANT, product_id: VALVE_50, supplier_sku: "NB-50", reference_needs_review: false },
    // A code still to review, and another company's code for this company's article: neither names an article.
    { id: "c0000000-0000-4000-8000-000000000002", tenant_id: TENANT, product_id: FLANGE_50, supplier_sku: "DOUTE-50", reference_needs_review: true },
    { id: "c0000000-0000-4000-8000-000000000003", tenant_id: OTHER_TENANT, product_id: FLANGE_65, supplier_sku: "ETR-SKU-65", reference_needs_review: false },
  ],
  product_aliases: [
    { id: "d0000000-0000-4000-8000-000000000001", tenant_id: TENANT, product_id: VALVE_50, alias: "robinet d'arrêt" },
    { id: "d0000000-0000-4000-8000-000000000002", tenant_id: OTHER_TENANT, product_id: FLANGE_80, alias: "galette" },
  ],
});

const FOREIGN_MARKS = [
  FOREIGN_ALPHA, FOREIGN_VALVE, productId(21), "ETR-999", "ailleurs", "Ailleurs", ...KINDS.map((code) => supplyTypeId(OTHER_TENANT, code)),
];
/** Nothing of another company, by identifier or by wording, in what is answered or sent to the arbiter. */
function expectNothingForeign(...values: unknown[]) {
  const text = JSON.stringify(values);
  for (const mark of FOREIGN_MARKS) expect(text).not.toContain(mark);
}

type Role = "admin" | "engineer" | "viewer" | "director";

function seed(actor = ADMIN, role: Role = "admin") {
  const fake = createFakeSupabase({ userId: actor, tables: { tenant_memberships: [fakeMembership(actor, TENANT, role)], ...TABLES() } });
  vi.mocked(createSupabaseServerClient).mockResolvedValue(fake.supabase as never);
  return fake;
}

type Decision = { choice: string | null; confidence?: number | null };
/** Scripts the arbiter: what it answers to a question, by its identifier; nothing by default. */
function arbiter(decide: (question: ChoiceQuestion) => Decision | undefined, outcome: Partial<ChoiceArbitration> = {}) {
  vi.mocked(askChoiceQuestions).mockImplementation(async (input) => ({
    provider: input.provider, status: "available", message: "Propositions de l’IA à confirmer.", model: "modele-fictif",
    answers: input.questions.map((question) => ({ id: question.id, choice: null, confidence: null, ...decide(question) })),
    ...outcome,
  }));
}
const byId = (decisions: Record<string, Decision>) => (question: ChoiceQuestion): Decision | undefined => decisions[question.id];
const asked = () => vi.mocked(askChoiceQuestions).mock.calls.map(([input]) => input);
const choicesOf = (question: ChoiceQuestion) => question.choices.map((choice) => choice.value);

/** Through the contract, as the route does; the answer must be one the screen can parse. */
async function suggest(body: CostingWorkbookSuggestionsRequest) {
  const result = await suggestForWorkbook(costingWorkbookSuggestionsRequestSchema.parse(body));
  expect(costingWorkbookSuggestionsResponseSchema.safeParse(result).success).toBe(true);
  return result;
}

const DETERMINISTIC = { provider: null, model: null, status: "deterministic", message: "Propositions du rapprochement automatique, sans IA." };
const AI = { provider: "chatgpt_plan", model: "modele-fictif", status: "available", message: "Propositions de l’IA à confirmer." };

beforeEach(() => {
  vi.resetAllMocks();
});

describe("suppliers", () => {
  const names = ["Fournisseur Alpha", "Pt.P", "Durand Robinetterie", "Chaudronnerie Zorglub", "Fournisseur Alpha"];
  const candidates = {
    alpha: [{ supplier_id: ALPHA, label: "Fournisseur Alpha SAS", score: 1 }],
    pointP: [{ supplier_id: POINT_P, label: "Point P Matériaux", score: 0.75 }],
    durand: [
      { supplier_id: DURAND_LYON, label: "Durand Robinetterie · Lyon", score: 1 },
      { supplier_id: DURAND_NANTES, label: "Durand Robinetterie · Nantes", score: 1 },
    ],
  };

  it("proposes the one supplier of the same name, and leaves the rest to the office, without any provider (2, 5, 6)", async () => {
    const fake = seed();

    const result = await suggest({ task: "suppliers", names });

    expect(result).toEqual({
      task: "suppliers", ...DETERMINISTIC,
      items: [
        { name: "Fournisseur Alpha", candidates: candidates.alpha, suggestion: { supplier_id: ALPHA, confidence: 1, source: "match" } },
        { name: "Pt.P", candidates: candidates.pointP, suggestion: null },
        // Two suppliers of that name: neither is proposed.
        { name: "Durand Robinetterie", candidates: candidates.durand, suggestion: null },
        { name: "Chaudronnerie Zorglub", candidates: [], suggestion: null },
        { name: "Fournisseur Alpha", candidates: candidates.alpha, suggestion: { supplier_id: ALPHA, confidence: 1, source: "match" } },
      ],
    });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expectNothingForeign(result);
    expect(JSON.stringify(result)).not.toContain(ALPHA_ARCHIVED);
    expect(fake.writes).toEqual([]);
  });

  it("keeps contact details of homonymous suppliers out of the model choices", async () => {
    const fake = seed(ENGINEER, "engineer");
    Object.assign(fake.tables.suppliers.find((supplier) => supplier.id === DURAND_LYON)!, { city: "Lyon", email: "contact@example.test" });
    Object.assign(fake.tables.suppliers.find((supplier) => supplier.id === DURAND_NANTES)!, { city: "Lyon", siret: "00000000000001" });
    arbiter(() => ({ choice: "aucun", confidence: 0.3 }));
    const result = await suggest({ task: "suppliers", provider: "chatgpt_plan", names: ["Durand Robinetterie"] });
    const [question] = asked()[0].questions;
    if (result.task !== "suppliers") throw new Error("Unexpected suggestion task");
    expect(question.choices.slice(0, 2).map(({ description }) => description)).toEqual([
      "Durand Robinetterie · Lyon", "Durand Robinetterie · Lyon",
    ]);
    expect(result.items[0].candidates.map(({ label }) => label)).toEqual(expect.arrayContaining([
      "Durand Robinetterie · contact@example.test", "Durand Robinetterie · SIRET 00000000000001",
    ]));
  });

  it("asks the arbiter only for the names left undecided that have candidates, and reports its answers as its own (2, 3, 5)", async () => {
    const fake = seed(ENGINEER, "engineer");
    arbiter((question) => (question.id === "Pt.P" ? { choice: POINT_P, confidence: 0.82 } : { choice: "aucun", confidence: 0.6 }));

    const result = await suggest({ task: "suppliers", provider: "chatgpt_plan", names });

    expect(asked()).toHaveLength(1);
    const [call] = asked();
    expect(call).toMatchObject({
      provider: "chatgpt_plan", owner: { userId: ENGINEER, tenantId: TENANT },
      task: "catalogue-workbook-suppliers", promptVersion: "catalogue-workbook-suppliers-v1",
      instructions: COSTING_WORKBOOK_SUGGESTION_TASKS.suppliers.instructions,
    });
    expect(call.instructions).toContain("En cas de doute, réponds « aucun ».");
    expect(call.questions).toEqual([
      { id: "Pt.P", subject: { nom_dans_le_classeur: "Pt.P" }, choices: [
        { value: POINT_P, description: "Point P Matériaux" }, { value: "aucun", description: "Aucun de ces fournisseurs n’est la même société." },
      ] },
      { id: "Durand Robinetterie", subject: { nom_dans_le_classeur: "Durand Robinetterie" }, choices: [
        { value: DURAND_LYON, description: "Durand Robinetterie · Lyon" }, { value: DURAND_NANTES, description: "Durand Robinetterie · Nantes" },
        { value: "aucun", description: "Aucun de ces fournisseurs n’est la même société." },
      ] },
    ]);
    expect(result).toMatchObject({ task: "suppliers", ...AI });
    expect(result.items.map((item) => item.suggestion)).toEqual([
      { supplier_id: ALPHA, confidence: 1, source: "match" },
      { supplier_id: POINT_P, confidence: 0.82, source: "ai" },
      // « aucun »: the arbiter answered that none of the candidates is the supplier.
      { supplier_id: null, confidence: 0.6, source: "ai" },
      null,
      { supplier_id: ALPHA, confidence: 1, source: "match" },
    ]);
    expectNothingForeign(result, asked());
    expect(fake.writes).toEqual([]);
  });

  it.each([
    ["unavailable", "Connectez votre forfait ChatGPT dans Mon profil pour analyser les documents."],
    ["failed", "ChatGPT n’a pas terminé la demande."],
  ] as const)("keeps the deterministic proposals when the provider is %s, with its status and message (4)", async (status, message) => {
    seed();
    arbiter(() => undefined, { status, message, model: null });

    const result = await suggest({ task: "suppliers", provider: "chatgpt_plan", names });

    expect(result).toMatchObject({ provider: "chatgpt_plan", model: null, status, message });
    expect(result.items.map((item) => item.suggestion)).toEqual([
      { supplier_id: ALPHA, confidence: 1, source: "match" }, null, null, null, { supplier_id: ALPHA, confidence: 1, source: "match" },
    ]);
    expect(result.items[2]).toMatchObject({ candidates: candidates.durand });
  });

  it("calls no provider when the matching left nothing to choose (2)", async () => {
    seed();

    const result = await suggest({ task: "suppliers", provider: "decisions", names: ["Fournisseur Alpha", "Chaudronnerie Zorglub"] });

    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      provider: "decisions", model: null, status: "available",
      message: "Rien à départager par l’IA : le rapprochement automatique a suffi, ou n’a trouvé aucun candidat.",
    });
  });

  it("ignores an answer that is not a choice of its question (3)", async () => {
    seed();
    // The supplier of another name, an archived one, another company's one.
    arbiter((question) => ({ choice: question.id === "Pt.P" ? ALPHA : FOREIGN_ALPHA, confidence: 0.9 }));

    const result = await suggest({ task: "suppliers", provider: "personal_api_key", names });

    expect(result.items.map((item) => item.suggestion?.source ?? null)).toEqual(["match", null, null, null, "match"]);
  });
});

describe("articles", () => {
  const line = (key: string, extra: Partial<Record<"reference" | "wording" | "material" | "dimension" | "unit", string>>) =>
    ({ key, reference: "", wording: "", material: "", dimension: "", unit: "", ...extra });
  const lines = [
    line("by-reference", { reference: "tub 304 20", wording: "Tube", material: "Inox 304L", dimension: "DN20", unit: "ml" }),
    line("by-supplier-code", { reference: "NB-50", wording: "Vanne", dimension: "DN50", unit: "u" }),
    line("by-usual-name", { wording: "Robinet d’arrêt", material: "Laiton", dimension: "DN50", unit: "u" }),
    line("ranked", { wording: "Coude 90°", material: "Inox 304L", dimension: "DN25", unit: "u" }),
    line("reference-of-another-size", { reference: "COU-304-20", wording: "Coude 90°", material: "Inox 304L", dimension: "DN25", unit: "u" }),
    line("unknown", { reference: "ETR-999", wording: "Zorglub quantique" }),
    line("pending-code", { reference: "DOUTE-50", wording: "Zorglub quantique" }),
    line("archived", { reference: "TUB-304-32", wording: "Zorglub quantique" }),
    line("foreign-code", { reference: "ETR-SKU-65", wording: "Zorglub quantique" }),
    line("foreign-usual-name", { wording: "Galette", dimension: "DN80" }),
  ];
  /** Lines that name nothing in this company's catalogue. */
  const NOTHING = ["unknown", "pending-code", "archived", "foreign-code", "foreign-usual-name"];

  it("proposes an article found by reference or usual name without a warning, without any provider (2, 5, 6)", async () => {
    const fake = seed();

    const result = await suggest({ task: "articles", lines });

    expect(result).toMatchObject({ task: "articles", ...DETERMINISTIC });
    const items = new Map(result.task === "articles" ? result.items.map((item) => [item.key, item]) : []);
    expect([...items.keys()]).toEqual(lines.map((entry) => entry.key));
    expect(items.get("by-reference")).toMatchObject({
      candidates: [{ product_id: TUBE_20, reference: "TUB-304-20", designation: "Tube inox 304L DN20", score: 100, warnings: [] }],
      suggestion: { product_id: TUBE_20, confidence: 1, source: "match" },
    });
    expect(items.get("by-reference")?.candidates[0].reasons).toContain("Même référence");
    expect(items.get("by-supplier-code")?.suggestion).toEqual({ product_id: VALVE_50, confidence: 1, source: "match" });
    expect(items.get("by-usual-name")).toMatchObject({
      candidates: [{ product_id: VALVE_50, score: 95, warnings: [] }],
      suggestion: { product_id: VALVE_50, confidence: 0.95, source: "match" },
    });
    // Closest by words, material and size: a proposal to read, not a match. The elbow of another size is not proposed.
    expect(items.get("ranked")).toMatchObject({ candidates: [{ product_id: ELBOW_25 }], suggestion: null });
    expect(items.get("ranked")?.candidates).toHaveLength(1);
    // The reference names the DN20 elbow and the line says DN25: a warning, so no proposal.
    expect(items.get("reference-of-another-size")?.candidates[0]).toMatchObject({ product_id: ELBOW_20 });
    expect(items.get("reference-of-another-size")?.candidates[0].warnings).not.toEqual([]);
    expect(items.get("reference-of-another-size")?.suggestion).toBeNull();
    // Another company's reference, supplier code or usual name, a code still to review and an archived article name nothing.
    for (const key of NOTHING) expect(items.get(key)).toEqual({ key, candidates: [], suggestion: null });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expectNothingForeign(result);
    expect(fake.writes).toEqual([]);
  });

  it("asks the arbiter only for the lines left undecided that have candidates (2, 3, 5)", async () => {
    seed();
    arbiter((question) => (question.id === "ranked" ? { choice: ELBOW_25, confidence: 0.9 } : { choice: "aucun", confidence: 0.7 }));

    const result = await suggest({ task: "articles", provider: "decisions", lines });

    const [call] = asked();
    expect(asked()).toHaveLength(1);
    expect(call).toMatchObject({ provider: "decisions", owner: { userId: ADMIN, tenantId: TENANT }, task: "catalogue-workbook-articles", promptVersion: "catalogue-workbook-articles-v1" });
    expect(call.instructions).toContain("Une dimension, une matière ou une nuance différente exclut l’article.");
    expect(call.questions.map((question) => question.id)).toEqual(["ranked", "reference-of-another-size"]);
    expect(call.questions[0].subject).toEqual({ reference: "", libelle: "Coude 90°", matiere: "Inox 304L", dimension: "DN25", unite: "u" });
    expect(choicesOf(call.questions[0])).toEqual([ELBOW_25, "aucun"]);
    // The arbiter reads the article and what the matcher found for and against it.
    expect(call.questions[0].choices[0].description).toContain("réf. COU-304-25 | Coude 90° inox 304L DN25 | matière : Inox 304L | dimensions : DN25 | unité : u | indices : ");
    expect(call.questions[1].choices[0].description).toContain("à vérifier : La référence désigne une autre dimension");
    expect(result).toMatchObject({ provider: "decisions", model: "modele-fictif", status: "available" });
    const suggestions = Object.fromEntries(result.task === "articles" ? result.items.map((item) => [item.key, item.suggestion]) : []);
    expect(suggestions).toEqual({
      "by-reference": { product_id: TUBE_20, confidence: 1, source: "match" },
      "by-supplier-code": { product_id: VALVE_50, confidence: 1, source: "match" },
      "by-usual-name": { product_id: VALVE_50, confidence: 0.95, source: "match" },
      ranked: { product_id: ELBOW_25, confidence: 0.9, source: "ai" },
      "reference-of-another-size": { product_id: null, confidence: 0.7, source: "ai" },
      ...Object.fromEntries(NOTHING.map((key) => [key, null])),
    });
    expectNothingForeign(result, asked());
  });

  it("keeps the deterministic proposals when the provider fails (4)", async () => {
    seed();
    arbiter(() => undefined, { status: "failed", message: "La demande Decisions a échoué. Continuez manuellement.", model: null });

    const result = await suggest({ task: "articles", provider: "decisions", lines });

    expect(result).toMatchObject({ provider: "decisions", status: "failed", message: "La demande Decisions a échoué. Continuez manuellement." });
    expect(result.task === "articles" && result.items.map((item) => item.suggestion?.source ?? null)).toEqual(["match", "match", "match", null, null, ...NOTHING.map(() => null)]);
  });
});

describe("supply types", () => {
  const group = (key: string, productType: string, extra: Partial<{ family_code: string | null; material: string | null; samples: string[]; count: number }> = {}) =>
    ({ key, family_code: null, product_type: productType, material: null, samples: [], count: 1, ...extra });
  const groups = [
    group("elbows", "coude 90°", { family_code: "I4L", material: "Inox 304L soudé", samples: ["Coude 90° — Inox 304L soudé DN32"], count: 12 }),
    group("tubes", "Tube", { family_code: "I4L", count: 30 }),
    group("flanges", "Bride plate", { count: 4 }),
    group("unknown", "Vase d’expansion", { family_code: "DIV", samples: ["Vase expansion à membrane 50 L"] }),
    group("untyped", ""),
  ];
  const types = (["divers", "raccord", "tube", "vanne"] as const).map((code) => supplyTypeId(TENANT, code));

  it("proposes the type the company's validated articles of the same kind share, without any provider (2, 5, 6)", async () => {
    const fake = seed();

    const result = await suggest({ task: "supply_types", groups });

    expect(result).toEqual({
      task: "supply_types", ...DETERMINISTIC,
      items: [
        { key: "elbows", suggestion: { supply_type_id: supplyTypeId(TENANT, "raccord"), confidence: 1, source: "catalogue" } },
        // One validated tube only (the draft, the archived one and another company's do not count).
        { key: "tubes", suggestion: null },
        // Two flanges out of three are fittings: below 80 %.
        { key: "flanges", suggestion: null },
        { key: "unknown", suggestion: null },
        { key: "untyped", suggestion: null },
      ],
    });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(fake.writes).toEqual([]);
  });

  it("proposes a type shared by 80 % of the articles that carry one", async () => {
    const fake = seed();
    fake.tables.products.push(
      product(productId(30), { product_type: "BRIDE  PLATE", supply_type_id: supplyTypeId(TENANT, "raccord") }),
      product(productId(31), { product_type: "bride plate", supply_type_id: supplyTypeId(TENANT, "raccord") }),
      // Without a type, or with a type that is not the company's: says nothing.
      product(productId(32), { product_type: "Bride plate", supply_type_id: null }),
      product(productId(33), { product_type: "Bride plate", supply_type_id: supplyTypeId(OTHER_TENANT, "divers") }),
    );

    const result = await suggest({ task: "supply_types", groups });

    expect(result.items[2]).toEqual({ key: "flanges", suggestion: { supply_type_id: supplyTypeId(TENANT, "raccord"), confidence: 0.8, source: "catalogue" } });
  });

  it("asks the arbiter for the groups left undecided, among the company's own types (2, 3, 5)", async () => {
    seed();
    arbiter(byId({
      tubes: { choice: supplyTypeId(TENANT, "tube"), confidence: 0.97 },
      flanges: { choice: "aucun", confidence: 0.5 },
      unknown: { choice: supplyTypeId(OTHER_TENANT, "divers"), confidence: 0.9 },
    }));

    const result = await suggest({ task: "supply_types", provider: "personal_api_key", groups });

    const [call] = asked();
    expect(call).toMatchObject({ provider: "personal_api_key", task: "catalogue-workbook-supply-types", promptVersion: "catalogue-workbook-supply-types-v1" });
    expect(call.instructions).toContain("fixe le coefficient FO automatique du devis");
    expect(call.questions.map((question) => question.id)).toEqual(["tubes", "flanges", "unknown", "untyped"]);
    expect(call.questions[2].subject).toEqual({
      code_famille: "DIV", type: "Vase d’expansion", matiere: null, exemples: ["Vase expansion à membrane 50 L"], articles: 1,
    });
    for (const question of call.questions) expect(choicesOf(question)).toEqual([...types, "aucun"]);
    expect(call.questions[0].choices.map((choice) => choice.description)).toEqual([
      "Divers (code divers)", "Raccords (code raccord)", "Tubes (code tube)", "Vannes (code vanne)",
      "Aucun de ces types de fourniture ne nomme ce genre de fourniture.",
    ]);
    expect(result.items).toEqual([
      { key: "elbows", suggestion: { supply_type_id: supplyTypeId(TENANT, "raccord"), confidence: 1, source: "catalogue" } },
      { key: "tubes", suggestion: { supply_type_id: supplyTypeId(TENANT, "tube"), confidence: 0.97, source: "ai" } },
      { key: "flanges", suggestion: { supply_type_id: null, confidence: 0.5, source: "ai" } },
      // Another company's type is not a choice: the answer is ignored.
      { key: "unknown", suggestion: null },
      { key: "untyped", suggestion: null },
    ]);
    expectNothingForeign(result, call.questions);
  });

  it("keeps the catalogue's proposals when the provider is unavailable (4)", async () => {
    seed();
    arbiter(() => undefined, { status: "unavailable", message: "Configurez votre clé API OpenAI et son modèle dans Mon profil.", model: null });

    const result = await suggest({ task: "supply_types", provider: "personal_api_key", groups });

    expect(result).toMatchObject({ provider: "personal_api_key", status: "unavailable", message: "Configurez votre clé API OpenAI et son modèle dans Mon profil." });
    expect(result.items[0]).toEqual({ key: "elbows", suggestion: { supply_type_id: supplyTypeId(TENANT, "raccord"), confidence: 1, source: "catalogue" } });
    expect(result.items.slice(1).every((item) => item.suggestion === null)).toBe(true);
  });
});

describe("columns", () => {
  const header = (index: number, text: string, samples: string[] = []) => ({ index, text, samples });
  const missing: CostingWorkbookColumn[] = ["PR. FO", "Unité", "F1_nom", "Dimension", "Type FO", "Fiabilité (/10)"];
  const headers = [
    header(8, "PR FO", ["12,59", "45,10"]),
    header(7, " u ", ["ml", "U"]),
    header(10, "Fournisseur 1", ["Fournisseur Alpha"]),
    // Two headers that are both a synonym of « Dimension ».
    header(3, "DN", ["20", "25"]),
    header(4, "Diamètre", ["26,9"]),
    header(9, "Catégorie", ["I4L", "ROB", "CAL"]),
    header(27, "Note prix", ["8", "6"]),
    header(30, "   "),
  ];
  const request = (provider?: ChoiceProvider): CostingWorkbookSuggestionsRequest => ({ task: "columns", missing, headers, provider });

  it("matches a header by the column's name or a synonym, and proposes nothing on a tie, without a read or a provider (2, 6)", async () => {
    const fake = seed();

    const result = await suggest(request());

    expect(result).toEqual({
      task: "columns", ...DETERMINISTIC,
      items: [
        { column: "PR. FO", suggestion: { index: 8, confidence: 1, source: "match" } },
        { column: "Unité", suggestion: { index: 7, confidence: 0.9, source: "match" } },
        { column: "F1_nom", suggestion: { index: 10, confidence: 0.9, source: "match" } },
        { column: "Dimension", suggestion: null },
        { column: "Type FO", suggestion: null },
        { column: "Fiabilité (/10)", suggestion: null },
      ],
    });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    // The member's rights, and nothing of the catalogue.
    expect(fake.reads).toEqual(["tenant_memberships"]);
  });

  it("prefers the column's own name to a synonym", async () => {
    seed();

    const result = await suggest({ task: "columns", missing: ["Unité", "ID"], headers: [header(5, "U"), header(6, "unite"), header(0, "Réf."), header(1, "Code article")] });

    expect(result.items).toEqual([
      { column: "Unité", suggestion: { index: 6, confidence: 1, source: "match" } },
      // « Réf. » and « Code article » both name the identifier.
      { column: "ID", suggestion: null },
    ]);
  });

  it("asks the arbiter for the columns left, among the headers no column took, and gives a header to one column only (2, 3, 6)", async () => {
    seed();
    arbiter(byId({
      Dimension: { choice: "3", confidence: 0.7 },
      "Type FO": { choice: "9", confidence: 0.9 },
      "Fiabilité (/10)": { choice: "9", confidence: 0.5 },
    }));

    const result = await suggest(request("chatgpt_plan"));

    const [call] = asked();
    expect(call).toMatchObject({ task: "catalogue-workbook-columns", promptVersion: "catalogue-workbook-columns-v1" });
    expect(call.questions.map((question) => question.id)).toEqual(["Dimension", "Type FO", "Fiabilité (/10)"]);
    expect(call.questions[1].subject).toEqual({ colonne_attendue: "Type FO", contenu_attendu: "code de famille de fourniture du classeur (I4L, ROB, CAL…)" });
    // Headers 8, 7 and 10 are taken, the blank one says nothing.
    for (const question of call.questions) expect(choicesOf(question)).toEqual(["3", "4", "9", "27", "aucun"]);
    expect(call.questions[0].choices.map((choice) => choice.description)).toEqual([
      "colonne D : « DN » ; premières valeurs : « 20 », « 25 »",
      "colonne E : « Diamètre » ; premières valeurs : « 26,9 »",
      "colonne J : « Catégorie » ; premières valeurs : « I4L », « ROB », « CAL »",
      "colonne AB : « Note prix » ; premières valeurs : « 8 », « 6 »",
      "Aucun de ces en-têtes ne porte cette information.",
    ]);
    expect(result.items).toEqual([
      { column: "PR. FO", suggestion: { index: 8, confidence: 1, source: "match" } },
      { column: "Unité", suggestion: { index: 7, confidence: 0.9, source: "match" } },
      { column: "F1_nom", suggestion: { index: 10, confidence: 0.9, source: "match" } },
      { column: "Dimension", suggestion: { index: 3, confidence: 0.7, source: "ai" } },
      { column: "Type FO", suggestion: { index: 9, confidence: 0.9, source: "ai" } },
      // The same header as « Type FO », less surely: not proposed twice.
      { column: "Fiabilité (/10)", suggestion: null },
    ]);
  });

  it("leaves a header the arbiter gives to two columns equally to neither, and keeps « aucun » (3, 6)", async () => {
    seed();
    arbiter((question) => (question.id === "Dimension" ? { choice: "aucun", confidence: 0.8 } : { choice: "9", confidence: 0.6 }));

    const result = await suggest(request("decisions"));

    expect(result.items.slice(3)).toEqual([
      { column: "Dimension", suggestion: { index: null, confidence: 0.8, source: "ai" } },
      { column: "Type FO", suggestion: null },
      { column: "Fiabilité (/10)", suggestion: null },
    ]);
  });

  it("asks nothing when no header is left to choose from, and keeps the matches when the provider fails (2, 4)", async () => {
    seed();
    const nothingLeft = await suggest({ task: "columns", provider: "decisions", missing: ["PR. FO", "Type FO"], headers: [header(8, "Prix de revient FO")] });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(nothingLeft.items).toEqual([
      { column: "PR. FO", suggestion: { index: 8, confidence: 0.9, source: "match" } }, { column: "Type FO", suggestion: null },
    ]);

    arbiter(() => undefined, { status: "failed", message: "L’IA n’a pas répondu dans le délai prévu.", model: null });
    const failed = await suggest(request("chatgpt_plan"));
    expect(failed).toMatchObject({ provider: "chatgpt_plan", status: "failed", message: "L’IA n’a pas répondu dans le délai prévu." });
    expect(failed.items.map((item) => item.suggestion?.source ?? null)).toEqual(["match", "match", "match", null, null, null]);
  });
});

describe("supplier codes", () => {
  const values = ["Devis 2024-118 Alpha", "NB-50", "néant", "NB-50"];

  it("proposes nothing without a provider, and calls none (2)", async () => {
    const fake = seed();

    const result = await suggest({ task: "supplier_codes", values });

    expect(result).toEqual({ task: "supplier_codes", ...DETERMINISTIC, items: values.map((value) => ({ value, suggestion: null })) });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(fake.reads).toEqual(["tenant_memberships"]);
  });

  it("asks the arbiter what each distinct value holds, among three kinds (3)", async () => {
    seed();
    arbiter(byId({
      "Devis 2024-118 Alpha": { choice: "price_source", confidence: 0.93 },
      "NB-50": { choice: "code", confidence: 0.8 },
      // Not one of the three kinds.
      "néant": { choice: "aucun", confidence: 0.9 },
    }));

    const result = await suggest({ task: "supplier_codes", provider: "chatgpt_plan", values });

    const [call] = asked();
    expect(call).toMatchObject({ task: "catalogue-workbook-supplier-codes", promptVersion: "catalogue-workbook-supplier-codes-v1" });
    expect(call.questions.map((question) => [question.id, question.subject, choicesOf(question)])).toEqual([
      ["Devis 2024-118 Alpha", { texte_de_la_cellule: "Devis 2024-118 Alpha" }, ["code", "price_source", "none"]],
      ["NB-50", { texte_de_la_cellule: "NB-50" }, ["code", "price_source", "none"]],
      ["néant", { texte_de_la_cellule: "néant" }, ["code", "price_source", "none"]],
    ]);
    expect(result).toEqual({
      task: "supplier_codes", ...AI,
      items: [
        { value: "Devis 2024-118 Alpha", suggestion: { kind: "price_source", confidence: 0.93, source: "ai" } },
        { value: "NB-50", suggestion: { kind: "code", confidence: 0.8, source: "ai" } },
        { value: "néant", suggestion: null },
        { value: "NB-50", suggestion: { kind: "code", confidence: 0.8, source: "ai" } },
      ],
    });
  });

  it("reports « no code » as its own kind, and a provider failure with nothing proposed (3, 4)", async () => {
    seed();
    arbiter(() => ({ choice: "none", confidence: 0.75 }));
    expect((await suggest({ task: "supplier_codes", provider: "decisions", values: ["néant"] })).items).toEqual([
      { value: "néant", suggestion: { kind: "none", confidence: 0.75, source: "ai" } },
    ]);

    arbiter(() => undefined, { status: "failed", message: "La demande Decisions a échoué. Continuez manuellement.", model: null });
    expect(await suggest({ task: "supplier_codes", provider: "decisions", values })).toEqual({
      task: "supplier_codes", provider: "decisions", model: null, status: "failed",
      message: "La demande Decisions a échoué. Continuez manuellement.", items: values.map((value) => ({ value, suggestion: null })),
    });
  });
});

describe("rights (1)", () => {
  const requests: CostingWorkbookSuggestionsRequest[] = [
    { task: "suppliers", provider: "chatgpt_plan", names: ["Pt.P"] },
    { task: "articles", provider: "chatgpt_plan", lines: [{ key: "a", reference: "", wording: "Coude 90°", material: "", dimension: "DN25", unit: "" }] },
    { task: "supply_types", provider: "chatgpt_plan", groups: [{ key: "a", family_code: null, product_type: "Tube", material: null, samples: [], count: 1 }] },
    { task: "columns", provider: "chatgpt_plan", missing: ["Type FO"], headers: [{ index: 9, text: "Catégorie", samples: [] }] },
    { task: "supplier_codes", provider: "chatgpt_plan", values: ["NB-50"] },
  ];

  it.each([["viewer", VIEWER], ["director", DIRECTOR]] as const)("refuses a %s before any read of the catalogue or any provider", async (role, actor) => {
    const fake = seed(actor, role);
    arbiter(() => ({ choice: "aucun" }));

    for (const request of requests) {
      await expect(suggestForWorkbook(request)).rejects.toMatchObject({ status: 403, message: PRODUCT_WRITE_REFUSAL });
    }
    await expect(readWorkbookSuggestionProviders()).rejects.toMatchObject({ status: 403, message: PRODUCT_WRITE_REFUSAL });

    expect(new Set(fake.reads)).toEqual(new Set(["tenant_memberships"]));
    expect(askChoiceQuestions).not.toHaveBeenCalled();
    expect(readChoiceProviderOptions).not.toHaveBeenCalled();
  });

  it("lets an engineer ask, for every task", async () => {
    seed(ENGINEER, "engineer");
    arbiter(() => ({ choice: "aucun", confidence: 0.5 }));

    for (const request of requests) expect((await suggest(request)).status).toBe("available");
    expect(asked().every((call) => call.owner.userId === ENGINEER && call.owner.tenantId === TENANT)).toBe(true);
  });

  it("reads the availability of the providers for the member, without asking any", async () => {
    seed(ENGINEER, "engineer");
    const options = {
      defaultProvider: "personal_api_key" as const,
      providers: {
        chatgpt_plan: { available: false, message: "Connectez votre forfait ChatGPT dans Mon profil.", models: [], preferences: null },
        personal_api_key: { available: false, message: "Configurez votre clé API OpenAI et son modèle dans Mon profil.", models: [], preferences: null },
        decisions: { available: false, message: "Le classement Decisions est désactivé." },
      },
    };
    vi.mocked(readChoiceProviderOptions).mockResolvedValue(options);

    expect(await readWorkbookSuggestionProviders()).toEqual(options);
    expect(readChoiceProviderOptions).toHaveBeenCalledWith({ userId: ENGINEER, tenantId: TENANT });
    expect(askChoiceQuestions).not.toHaveBeenCalled();
  });
});
