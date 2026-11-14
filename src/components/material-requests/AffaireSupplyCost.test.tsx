import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AffaireSupplyCost as SupplyCost } from "@/lib/material-requests/supply-cost-contracts";

import { AffaireSupplyCost } from "./AffaireSupplyCost";

/**
 * Failure modes of the affaire's supply cost section (TI-691, delivery 4), written before its budget display was
 * reworked. The amounts come from the server (public.affaire_supply_cost); the screen only shows them:
 *  1. without accepted version, an empty budget is written 0,00 € (as if the budget were nothing) instead of « — »;
 *  2. « Reste » is not the budget less the ordered and the pending, or an overspend is written as a negative amount
 *     instead of « Dépassé de … »;
 *  3. shipping and discounts, which no estimate budgets, show as over budget on every affaire;
 *  4. several accepted versions are not said, or the one that makes the budget is not named;
 *  5. the orders made from the estimate, which are not counted, are not said.
 */

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const TUBES = "40404040-4040-4404-8404-404040404040";
const FITTINGS = "41414141-4141-4414-8414-414141414141";

/** Text as the queries read it: the no-break spaces of the French amounts normalised. */
const plain = (text: string | null) => (text ?? "").replace(/\s/g, " ").trim();

function mockCost(cost: SupplyCost) {
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true, status: 200, json: async () => ({ ok: true, data: cost }), blob: async () => new Blob([]),
  })));
}

function cells(rowName: string): string[] {
  const table = screen.getByRole("table", { name: "Budget et commandé par type de fourniture" });
  const row = within(table).getAllByRole("row").find((candidate) =>
    plain(within(candidate).queryByRole("rowheader")?.textContent ?? null) === rowName);
  if (!row) throw new Error(`Ligne absente : ${rowName}`);
  return within(row).getAllByRole("cell").map((cell) => plain(cell.textContent));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AffaireSupplyCost", () => {
  it("names the accepted variant that makes the budget, and shows what is left or overspent per supply type", async () => {
    mockCost({
      budget_version: { id: "51515151-5151-4515-8515-515151515151", version_number: 3, variant_label: "A",
        title: "Variante cuivre", accepted_count: 2 },
      rows: [
        { kind: "supply_type", supply_type_id: TUBES, code: "tube", name: "Tubes", budget_cents: 100_000,
          ordered_cents: 60_000, pending_cents: 15_000 },
        { kind: "supply_type", supply_type_id: FITTINGS, code: "raccord", name: "Raccords", budget_cents: 20_000,
          ordered_cents: 25_050, pending_cents: 0 },
        { kind: "unclassified", supply_type_id: null, code: null, name: null, budget_cents: 0, ordered_cents: 1_000,
          pending_cents: 0 },
        { kind: "shipping_discount", supply_type_id: null, code: null, name: null, budget_cents: 0,
          ordered_cents: 1_500, pending_cents: 0 },
      ],
      totals: { budget_cents: 120_000, ordered_cents: 87_550, pending_cents: 15_000 },
      not_counted: { estimate_orders: 2 },
    });
    render(<AffaireSupplyCost projectId={PROJECT_ID} />);

    expect(await screen.findByText(
      "Budget de la version 3, variante A, acceptée par le client. 2 versions sont acceptées : la plus haute fait le budget.",
    )).toBeTruthy();
    expect(cells("Tubes")).toEqual(["1 000,00 €", "600,00 €", "150,00 €", "250,00 €"]);
    expect(cells("Raccords")).toEqual(["200,00 €", "250,50 €", "0,00 €", "Dépassé de 50,50 €"]);
    expect(cells("Non classé")).toEqual(["0,00 €", "10,00 €", "0,00 €", "Dépassé de 10,00 €"]);
    // No estimate budgets shipping: neither a budget nor an overspend.
    expect(cells("Port et remises")).toEqual(["—", "15,00 €", "0,00 €", "—"]);
    expect(cells("Total HT")).toEqual(["1 200,00 €", "875,50 €", "150,00 €", "174,50 €"]);
    expect(plain(screen.getByText(/bons créés depuis le devis/).textContent)).toContain(
      "2 bons créés depuis le devis ne sont pas comptés : ils ne sont rattachés à aucune affaire.");
  });

  it("shows no budget at all while no version is accepted", async () => {
    mockCost({
      budget_version: null,
      rows: [{ kind: "unclassified", supply_type_id: null, code: null, name: null, budget_cents: null,
        ordered_cents: 0, pending_cents: 11_928 }],
      totals: { budget_cents: null, ordered_cents: 0, pending_cents: 11_928 },
      not_counted: { estimate_orders: 0 },
    });
    render(<AffaireSupplyCost projectId={PROJECT_ID} />);

    expect(await screen.findByText(
      "Budget en attente du devis accepté : le commandé et l’en-cours sont affichés sans budget.",
    )).toBeTruthy();
    expect(cells("Non classé")).toEqual(["—", "0,00 €", "119,28 €", "—"]);
    expect(cells("Total HT")).toEqual(["—", "0,00 €", "119,28 €", "—"]);
    expect(screen.queryByText(/créés? depuis le devis/)).toBeNull();
  });
});
