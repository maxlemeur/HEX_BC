import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CostingWorkbookImportReport,
  CostingWorkbookSupplierReferenceReport,
} from "@/lib/catalogue/costing-workbook-contract";

import { CostingWorkbookImport } from "./CostingWorkbookImport";

/**
 * Failure modes of the proposals of the import screen (TI-711), written before the code. A proposal comes from
 * the rules, or from the AI source the office chose (its ChatGPT plan, its API key, the Decisions API); the
 * network is the only stub, and every name is invented.
 *  1. An AI source is asked, or even its availability read, without the office asking for it; an unavailable
 *     source can be chosen; the source chosen is not the one the request names.
 *  2. A proposal is applied by itself: nothing may change before the office retains it. « Retenir les
 *     propositions » retains one the model is not sure of.
 *  3. What the provider says of its answer (partial, unavailable, failed) is not shown.
 *  4. A proposal retained does not reach what it is about: the supplier's name, the column's header, the rows of
 *     a type of article, the row of a duplicate, the cells of a doubtful code.
 *  5. The search for duplicates sends more than the contract's 100 lines at once, or loses its result when the
 *     preview is computed again.
 */

const HEADERS = ["ID", "Caractéristique", "Matériau", "Unité", "PR FO", "Type FO", "F1_nom", "F1_ref", "Type_ligne"];
const SHEET_ROWS = [
  HEADERS,
  ["TUBE-20", "Tube", "Inox 304L soudé", "ml", 12.5, "I4L", "Pt.P", "Réf interne", "Art"],
  ["COQ-25", "Coquille porteuse", "Kooltherm", "ml", 4, "CAL", "pt.p", "P-25", "Art"],
];
const TUBE_TYPE = "a0000000-0000-4000-8000-000000000001";
const SUPPORT_TYPE = "a0000000-0000-4000-8000-000000000002";
const CATALOGUE_TUBE = "90000000-0000-4000-8000-000000000007";

const articleReport = (): CostingWorkbookImportReport => ({
  confirmed: false, articles: 2, new_articles: 2,
  proposed_articles: [{ row: 2, without_supply_type: false }, { row: 3, without_supply_type: true }],
  supply_types: [{ id: SUPPORT_TYPE, code: "support", name: "Support" }, { id: TUBE_TYPE, code: "tube", name: "Tube" }],
  catalogue_differences: [], already_in_catalogue: 0, without_supply_type: 1, supplier_references_not_imported: 2,
  issues: [], issue_count: 0, sections: 0,
});

function supplierReport(overrides: Partial<CostingWorkbookSupplierReferenceReport> = {}): CostingWorkbookSupplierReferenceReport {
  return {
    confirmed: false, to_import: 0, imported: 0, already_registered: 0, duplicates: 0, preview_token: "a".repeat(64), proposed: [],
    for_decision: [{ row: 2, slot: 1, reason: "supplier_not_found" }, { row: 3, slot: 1, reason: "supplier_not_found" }],
    ...overrides,
  };
}

function workbook() {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(SHEET_ROWS), "All_data");
  const bytes = XLSX.write(book, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const file = new File([bytes], "bible-chiffrage.xlsx");
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(bytes) });
  return file;
}

function respond(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}
const ok = (data: unknown, status = 200) => respond(status, { ok: true, data });

type Body = Record<string, unknown> & { rows?: unknown[][] };
type Sent = { url: string; method: string; body: Body | null };
const sent: Sent[] = [];
const SUGGESTIONS = "/api/catalogue/workbook-import/suggestions";
const answers = {
  suppliers: () => ok(supplierReport()),
  /** What the suggestions route answers to a task, from its request. */
  suggest: (body: Body): unknown => ({ task: body.task, provider: body.provider ?? null, model: null, status: "deterministic", message: "", items: [] }),
};
const fetchMock = vi.fn<typeof fetch>((input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  const body = init?.body ? JSON.parse(String(init.body)) as Body : null;
  sent.push({ url, method, body });
  if (url === SUGGESTIONS) {
    return method === "GET"
      ? ok({ providers: {
        chatgpt_plan: { available: false, message: "L’analyse IA est indisponible sur cette instance." },
        personal_api_key: { available: false, message: "Configurez votre clé API OpenAI dans Mon profil." },
        decisions: { available: true, message: "Decisions configuré : consommation API distincte du forfait ChatGPT." },
      } })
      : ok(answers.suggest(body!));
  }
  if (url.startsWith("/api/catalogue/supplier-aliases")) {
    return method === "GET" ? ok({ items: [] }) : ok({ item: { id: "alias-1", ...body, supplier_name: "Point P Matériaux", created_at: "2026-11-25T10:00:00.000Z" } }, 201);
  }
  if (url === "/api/suppliers") return ok({ items: [{ id: "s1", name: "Point P Matériaux" }] });
  return url.endsWith("/supplier-references") ? answers.suppliers() : ok(articleReport());
});

const posted = (path: string) => sent.filter((call) => call.url === path && call.method === "POST");
const previews = () => posted("/api/catalogue/workbook-import");
const supplierPreviews = () => posted("/api/catalogue/workbook-import/supplier-references");
const suggestions = () => posted(SUGGESTIONS).map((call) => call.body!);

async function openImport(user: ReturnType<typeof userEvent.setup>) {
  render(<CostingWorkbookImport catalogueHref="/dashboard/products" draftsHref="/dashboard/products?catalogue_status=draft" onImported={vi.fn()} />);
  await user.upload(screen.getByLabelText("Fichier Excel"), workbook());
  await screen.findByRole("table", { name: "Articles proposés en brouillon" });
}

async function chooseDecisions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Propositions avec l’IA" }));
  await user.selectOptions(await screen.findByLabelText("Propositions"), "API Decisions");
}

async function openSupplierReferences(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Références fournisseur" }));
  await waitFor(() => expect(supplierPreviews()).toHaveLength(1));
}

describe("CostingWorkbookImport, proposals", () => {
  beforeEach(() => {
    sent.length = 0;
    answers.suppliers = () => ok(supplierReport());
    answers.suggest = (body) => ({ task: body.task, provider: body.provider ?? null, model: null, status: "deterministic", message: "", items: [] });
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the AI sources only when asked, and lets the office choose an available one (1)", async () => {
    const user = userEvent.setup();
    await openImport(user);
    expect(sent.some((call) => call.url === SUGGESTIONS)).toBe(false);

    await user.click(screen.getByRole("button", { name: "Propositions avec l’IA" }));
    const select = await screen.findByLabelText("Propositions");
    expect(sent.filter((call) => call.url === SUGGESTIONS).map((call) => call.method)).toEqual(["GET"]);
    expect(within(select).getByRole("option", { name: "Forfait ChatGPT (indisponible)" })).toBeDisabled();
    expect(within(select).getByRole("option", { name: "Clé API OpenAI (indisponible)" })).toBeDisabled();
    await user.selectOptions(select, "API Decisions");
    expect(screen.getByText("Decisions configuré : consommation API distincte du forfait ChatGPT.")).toBeVisible();
  });

  it("proposes a supplier by the rules, then by the source chosen, and applies nothing by itself (1, 2, 3, 4)", async () => {
    const user = userEvent.setup();
    const candidates = [{ supplier_id: "s1", label: "Point P Matériaux", score: 0.75 }];
    answers.suggest = (body) => ({
      task: "suppliers", provider: body.provider ?? null, model: body.provider ? "gpt-6-luna" : null,
      status: body.provider ? "partial" : "deterministic",
      message: body.provider ? "Classement partiel : les réponses manquantes restent à revoir." : "",
      items: [{ name: "Pt.P", candidates, suggestion: body.provider ? { supplier_id: "s1", confidence: 0.55, source: "ai" } : null }],
    });
    await openImport(user);
    await openSupplierReferences(user);
    await user.click(await screen.findByRole("button", { name: "Fournisseur actif introuvable" }));

    // The rules alone: no source is named, and an undecided name gets no proposal.
    await user.click(screen.getByRole("button", { name: "Proposer des fournisseurs" }));
    await waitFor(() => expect(suggestions()).toEqual([{ task: "suppliers", names: ["Pt.P"] }]));
    expect(screen.queryByText(/^Proposition :/)).not.toBeInTheDocument();

    await chooseDecisions(user);
    await user.click(screen.getByRole("button", { name: "Proposer des fournisseurs avec l’IA" }));
    await waitFor(() => expect(suggestions()).toHaveLength(2));
    expect(suggestions()[1]).toEqual({ task: "suppliers", provider: "decisions", names: ["Pt.P"] });
    expect(await screen.findByText("Proposition : Point P Matériaux (IA, confiance 55 %)")).toBeVisible();
    expect(screen.getByText("Classement partiel : les réponses manquantes restent à revoir.")).toBeVisible();
    // Nothing is written: the office retains it, and a proposal the model is not sure of is not retained in bulk.
    expect(posted("/api/catalogue/supplier-aliases")).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Retenir \d+ proposition/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retenir Point P Matériaux pour Pt.P" }));
    await waitFor(() => expect(posted("/api/catalogue/supplier-aliases").map((call) => call.body)).toEqual([{ supplier_id: "s1", alias: "Pt.P" }]));
    await waitFor(() => expect(supplierPreviews()).toHaveLength(2));
  });

  it("retains together the proposals the rules found (2, 4)", async () => {
    const user = userEvent.setup();
    answers.suggest = () => ({
      task: "suppliers", provider: null, model: null, status: "deterministic", message: "",
      items: [{ name: "Pt.P", candidates: [{ supplier_id: "s1", label: "Point P Matériaux", score: 1 }], suggestion: { supplier_id: "s1", confidence: 1, source: "match" } }],
    });
    await openImport(user);
    await openSupplierReferences(user);
    await user.click(await screen.findByRole("button", { name: "Fournisseur actif introuvable" }));
    await user.click(screen.getByRole("button", { name: "Proposer des fournisseurs" }));
    expect(await screen.findByText("Proposition : Point P Matériaux (même nom)")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Retenir 1 proposition" }));
    await waitFor(() => expect(posted("/api/catalogue/supplier-aliases")).toHaveLength(1));
    await waitFor(() => expect(supplierPreviews()).toHaveLength(2));
  });

  it("points a missing column to the header proposed, once the office uses it (2, 4)", async () => {
    const user = userEvent.setup();
    answers.suggest = () => ({
      task: "columns", provider: null, model: null, status: "deterministic", message: "",
      items: [{ column: "PR. FO", suggestion: { index: 4, confidence: 1, source: "match" } }],
    });
    await openImport(user);
    await user.click(screen.getByRole("button", { name: "Colonnes du classeur" }));
    await user.click(screen.getByRole("button", { name: "Proposer les colonnes" }));

    await waitFor(() => expect(suggestions()).toHaveLength(1));
    expect(suggestions()[0]).toMatchObject({ task: "columns", headers: [{ index: 4, text: "PR FO", samples: ["12.5", "4"] }] });
    expect(suggestions()[0].missing).toContain("PR. FO");
    expect(await screen.findByText("Proposition : E · PR FO")).toBeVisible();
    expect(previews()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Lire PR FO comme PR. FO" }));
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body?.rows?.[0]?.[4]).toBe("PR. FO");
  });

  it("gives the drafts of a type of article the supply type retained (2, 4)", async () => {
    const user = userEvent.setup();
    answers.suggest = (body) => ({
      task: "supply_types", provider: null, model: null, status: "deterministic", message: "",
      items: (body.groups as Array<{ key: string }>).map(({ key }) => ({ key, suggestion: { supply_type_id: SUPPORT_TYPE, confidence: null, source: "catalogue" } })),
    });
    await openImport(user);
    await user.click(screen.getByRole("button", { name: "Types de fourniture" }));
    const groups = within(screen.getByRole("table", { name: "Brouillons à classer par type d’article" }));
    expect(groups.getByLabelText("Coquille porteuse")).toHaveDisplayValue("Celui de sa famille");

    await user.click(screen.getByRole("button", { name: "Proposer des types" }));
    await waitFor(() => expect(suggestions()).toEqual([{
      task: "supply_types",
      groups: [{ key: "0", family_code: "CAL", product_type: "Coquille porteuse", material: "Kooltherm", samples: ["Coquille porteuse — Kooltherm"], count: 1 }],
    }]));
    expect(await groups.findByText("Support, comme les articles validés de ce type")).toBeVisible();
    expect(previews()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Retenir 1 proposition" }));
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body).toMatchObject({ confirm: false, supply_type_rows: [{ row: 3, supply_type_id: SUPPORT_TYPE }] });
    // The view stays in place while the preview is computed again: the office keeps its list.
    expect(await groups.findByLabelText("Coquille porteuse")).toHaveDisplayValue("Support");
  });

  it("finds the drafts the catalogue may already hold, and writes the catalogue's reference when the office says so (2, 4, 5)", async () => {
    const user = userEvent.setup();
    answers.suggest = (body) => ({
      task: "articles", provider: null, model: null, status: "deterministic", message: "",
      items: (body.lines as Array<{ key: string }>).map(({ key }) => ({
        key,
        candidates: key === "2" ? [{
          product_id: CATALOGUE_TUBE, reference: "CAT-TUBE-20", designation: "Tube inox 304L DN20", score: 82,
          reasons: ["même type d’article", "même matière"], warnings: ["unité différente"],
        }] : [],
        suggestion: null,
      })),
    });
    await openImport(user);
    await user.click(screen.getByRole("button", { name: "Doublons possibles" }));
    await user.click(screen.getByRole("button", { name: "Chercher les doublons" }));

    expect(await screen.findByRole("heading", { name: "1 brouillon ressemble à un article du catalogue" })).toBeVisible();
    expect(suggestions()).toHaveLength(1);
    expect((suggestions()[0].lines as Array<{ key: string; reference: string }>).map(({ key, reference }) => [key, reference]))
      .toEqual([["2", "TUBE-20"], ["3", "COQ-25"]]);
    const duplicates = within(screen.getByRole("list", { name: "Doublons possibles" }));
    expect(duplicates.getByText("même type d’article · même matière")).toBeVisible();
    expect(duplicates.getByText("unité différente")).toBeVisible();
    expect(previews()).toHaveLength(1);

    await user.click(duplicates.getByRole("button", { name: "Ne pas créer TUBE-20 : c’est CAT-TUBE-20" }));
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews()[1].body?.rows?.[1]?.[0]).toBe("CAT-TUBE-20");
    // One search serves the whole review: it is not asked again after a correction.
    expect(suggestions()).toHaveLength(1);
  });

  it("has doubtful codes read by the source chosen, and sets one aside when the office says so (1, 2, 4)", async () => {
    const user = userEvent.setup();
    answers.suppliers = () => ok(supplierReport({
      to_import: 2, for_decision: [],
      proposed: [
        { row: 2, slot: 1, article_reference: "TUBE-20", supplier_name: "Point P Matériaux" },
        { row: 3, slot: 1, article_reference: "COQ-25", supplier_name: "Point P Matériaux" },
      ],
    }));
    answers.suggest = (body) => ({
      task: "supplier_codes", provider: body.provider, model: "gpt-6-luna", status: "available", message: "Propositions à confirmer.",
      items: [{ value: "Réf interne", suggestion: { kind: "none", confidence: 0.9, source: "ai" } }],
    });
    await openImport(user);
    await openSupplierReferences(user);
    // Only the code without a digit is doubtful, and nothing is asked without a source.
    expect(await screen.findByText("1 code proposé ressemble à une note plus qu’à un code (un espace, ou aucun chiffre).")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Vérifier ces codes/ })).not.toBeInTheDocument();

    await chooseDecisions(user);
    await user.click(screen.getByRole("button", { name: "Vérifier ces codes avec l’IA" }));
    await waitFor(() => expect(suggestions()).toEqual([{ task: "supplier_codes", provider: "decisions", values: ["Réf interne"] }]));
    expect(await screen.findByText("Propositions à confirmer.")).toBeVisible();
    expect(supplierPreviews()).toHaveLength(1);

    await user.click(within(screen.getByRole("list", { name: "Codes à écarter" })).getByRole("button", { name: "Écarter Réf interne" }));
    await waitFor(() => expect(supplierPreviews()).toHaveLength(2));
    expect(supplierPreviews()[1].body?.rows?.[1]?.[7]).toBeNull();
    expect(supplierPreviews()[1].body?.rows?.[2]?.[7]).toBe("P-25");
  });
});
