import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PurchaseOrderDocument, type OrderItemData } from "@/components/PurchaseOrderDocument";
import { formatEUR } from "@/lib/money";

/** The amount as the document writes it, spaces as the queries read them (no-break spaces normalised). */
const euros = (cents: number) => formatEUR(cents).replace(/\s/g, " ");

/**
 * Failure modes, written before the document changed (TI-691, lot 2 « l'achat », delivery 3a « bons de commande
 * depuis les demandes »). A draft made from a material request has no delivery site, prices given for a lot, and
 * may carry the supplier's shipping and a global discount. Each of these would mislead the supplier or the office:
 *  1. without a site, the delivery box shows an empty address or a site to choose instead of the delivery mode in
 *     words (with the affaire's address when it goes to the site);
 *  2. a price given for 100 reads as a unit price, or its line total multiplies without dividing;
 *  3. a « Port » or « Remise » line looks like an article, or a discount reads as an amount added;
 *  4. on screen, a line does not say which request line it comes from and what it is imputed to; on paper, the
 *     supplier reads it;
 *  5. the affaire of the order is not named;
 *  6. an existing order (from an estimate, with a site) reads differently than before.
 */

const HEADER = {
  issuerName: "Camille Martin",
  issuerRole: "Acheteuse",
  orderDate: "2026-11-12",
  reference: "C-2026-0041",
  supplier: { name: "Négoce Alpha", address: "12 rue des Forges", postal_code: "69007", city: "Lyon" },
  expectedDeliveryDate: null,
  notes: null,
};

function item(partial: Partial<OrderItemData>): OrderItemData {
  return {
    key: "line-1",
    designation: "Coude 90° inox 316L DN 50",
    reference: null,
    quantity: 20,
    unit: "u",
    priceUnit: "u",
    unitPriceHtCents: 1150,
    lineTotalHtCents: 23000,
    ...partial,
  };
}

/** A draft from a request: elbows for the affaire, screws for 100, gloves for overhead, shipping and a discount. */
const FROM_REQUEST: OrderItemData[] = [
  item({
    key: "elbows",
    origin: { href: "/dashboard/affaires/p-1/demandes-materiel/r-1", label: "Demande du 12/11, ligne 1" },
    imputation: "Affaire",
  }),
  item({
    key: "screws",
    designation: "Vis tête hexagonale M10",
    quantity: 250,
    unitPriceHtCents: 340,
    pricePer: 100,
    lineTotalHtCents: 850,
    origin: { href: "/dashboard/affaires/p-1/demandes-materiel/r-1", label: "Demande du 12/11, ligne 2" },
    imputation: "Affaire",
  }),
  item({
    key: "gloves",
    designation: "Gants de manutention",
    quantity: 10,
    unit: "paire",
    priceUnit: "paire",
    unitPriceHtCents: 420,
    lineTotalHtCents: 4200,
    origin: { href: "/dashboard/affaires/p-1/demandes-materiel/r-1", label: "Demande du 12/11, ligne 3" },
    imputation: "Frais généraux · EPI",
  }),
  item({ key: "shipping", designation: "Frais de port", quantity: 1, unit: null, priceUnit: null, unitPriceHtCents: 1500, lineTotalHtCents: 1500, lineKind: "shipping", imputation: "Affaire" }),
  item({ key: "discount", designation: "Remise de fin d’année", quantity: 1, unit: null, priceUnit: null, unitPriceHtCents: 1000, lineTotalHtCents: -1000, lineKind: "discount", imputation: "Affaire" }),
];

function rowOf(designation: string): HTMLElement {
  return screen.getByText(designation, { exact: false }).closest("tr") as HTMLElement;
}

function deliveryBox(): HTMLElement {
  return screen.getByRole("heading", { name: "informations livraison" }).closest("div") as HTMLElement;
}

describe("purchase order document", () => {
  afterEach(cleanup);

  it("says how an order without a site is delivered, and names its affaire (1, 5)", () => {
    const { rerender } = render(
      <PurchaseOrderDocument
        {...HEADER}
        deliverySite={null}
        deliveryMode="site"
        affaire={{ name: "Résidence des Tilleuls", address: "4 allée des Tilleuls\n69100 Villeurbanne" }}
        items={FROM_REQUEST}
        totalHtCents={28550}
        totalTaxCents={5710}
        totalTtcCents={34260}
      />,
    );

    expect(within(deliveryBox()).getByText("Livraison sur chantier")).toBeVisible();
    expect(within(deliveryBox()).getByText("Résidence des Tilleuls")).toBeVisible();
    expect(within(deliveryBox()).getByText(/4 allée des Tilleuls/)).toBeVisible();

    for (const [mode, words] of [["office", "Livraison au bureau"], ["counter", "Retrait au comptoir"]] as const) {
      rerender(
        <PurchaseOrderDocument
          {...HEADER}
          deliverySite={null}
          deliveryMode={mode}
          affaire={{ name: "Résidence des Tilleuls", address: "4 allée des Tilleuls" }}
          items={FROM_REQUEST}
          totalHtCents={28550}
          totalTaxCents={5710}
          totalTtcCents={34260}
        />,
      );
      expect(within(deliveryBox()).getByText(words)).toBeVisible();
      // Not delivered to the site: its address would send the driver there.
      expect(within(deliveryBox()).queryByText(/4 allée des Tilleuls/)).not.toBeInTheDocument();
    }
  });

  it("keeps the delivery mode in place of the site choice while a draft without a site is edited (1)", () => {
    render(
      <PurchaseOrderDocument
        {...HEADER}
        editable
        deliverySite={null}
        deliveryMode="counter"
        siteOptions={[{ id: "s-1", name: "Dépôt central" }]}
        items={FROM_REQUEST}
        totalHtCents={28550}
        totalTaxCents={5710}
        totalTtcCents={34260}
      />,
    );

    expect(within(deliveryBox()).getByText("Retrait au comptoir")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Chantier de livraison" })).not.toBeInTheDocument();
  });

  it("writes a price for a lot as such, and tells port and remise apart, the discount subtracted (2, 3)", () => {
    render(
      <PurchaseOrderDocument
        {...HEADER}
        deliverySite={null}
        deliveryMode="office"
        items={FROM_REQUEST}
        totalHtCents={28550}
        totalTaxCents={5710}
        totalTtcCents={34260}
      />,
    );

    const screws = rowOf("Vis tête hexagonale M10");
    expect(within(screws).getByText(`${euros(340)} les 100`)).toBeVisible();
    expect(within(screws).getByText(euros(850))).toBeVisible();
    expect(within(screws).queryByText("par u")).not.toBeInTheDocument();

    const shipping = rowOf("Frais de port");
    expect(within(shipping).getByText("Port")).toBeVisible();
    // One time its amount: price and total.
    expect(within(shipping).getAllByText(euros(1500))).toHaveLength(2);
    const discount = rowOf("Remise de fin d’année");
    expect(within(discount).getByText("Remise")).toBeVisible();
    expect(within(discount).getAllByText(euros(-1000))).toHaveLength(2);
    expect(within(discount).queryByText(euros(1000))).not.toBeInTheDocument();
    // Port and remise are amounts, not articles: no unit to confirm.
    expect(within(shipping).queryByText("Unité du prix à confirmer")).not.toBeInTheDocument();
    expect(within(discount).queryByText("Unité à confirmer")).not.toBeInTheDocument();
  });

  it("shows the request line and the imputation of each line on screen, never on paper (4)", () => {
    render(
      <PurchaseOrderDocument
        {...HEADER}
        deliverySite={null}
        deliveryMode="office"
        items={FROM_REQUEST}
        totalHtCents={28550}
        totalTaxCents={5710}
        totalTtcCents={34260}
      />,
    );

    const gloves = rowOf("Gants de manutention");
    const link = within(gloves).getByRole("link", { name: "Demande du 12/11, ligne 3" });
    expect(link).toHaveAttribute("href", "/dashboard/affaires/p-1/demandes-materiel/r-1");
    expect(within(gloves).getByText("Frais généraux · EPI")).toBeVisible();
    expect(within(rowOf("Coude 90° inox 316L DN 50")).getByText("Affaire")).toBeVisible();
    // The browser's print of the detail page drops them: the supplier's copy says nothing of our imputation.
    expect(link.closest(".no-print")).not.toBeNull();
    expect(within(gloves).getByText("Frais généraux · EPI").closest(".no-print")).not.toBeNull();
  });

  it("reads an existing order from an estimate exactly as before (6)", () => {
    render(
      <PurchaseOrderDocument
        {...HEADER}
        deliverySite={{
          name: "Chantier Les Acacias",
          project_code: "AC-12",
          address: "8 rue des Acacias",
          postal_code: "38000",
          city: "Grenoble",
          contact_name: "Paul Durand",
          contact_phone: "06 00 00 00 00",
        }}
        items={[
          item({ key: "a", reference: "CD-50", unitPriceHtCents: 1150, lineTotalHtCents: 23000 }),
          item({ key: "b", designation: "Manchon PVC DN 100", quantity: 2.5, unit: "m", priceUnit: "m", unitPriceHtCents: 399, lineTotalHtCents: 998 }),
        ]}
        totalHtCents={23998}
        totalTaxCents={4800}
        totalTtcCents={28798}
      />,
    );

    const box = deliveryBox();
    expect(within(box).getByText("8 rue des Acacias")).toBeVisible();
    expect(within(box).getByText("contact sur site")).toBeVisible();
    expect(within(box).getByText("Paul Durand : 06 00 00 00 00")).toBeVisible();
    for (const words of ["Livraison sur chantier", "Livraison au bureau", "Retrait au comptoir", "affaire"]) {
      expect(within(box).queryByText(words)).not.toBeInTheDocument();
    }
    const elbows = rowOf("Coude 90° inox 316L DN 50");
    expect(within(elbows).getByText(euros(1150))).toBeVisible();
    expect(within(elbows).getByText("par u")).toBeVisible();
    expect(within(elbows).getByText("Réf. CD-50")).toBeVisible();
    expect(within(elbows).getByText(euros(23000))).toBeVisible();
    const sleeves = rowOf("Manchon PVC DN 100");
    expect(within(sleeves).getByText("2,5")).toBeVisible();
    expect(within(sleeves).getByText("par m")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    for (const words of [/^Port$/, /^Remise$/, /Demande du/, /les 100/, /Frais généraux/]) {
      expect(screen.queryByText(words)).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Désignation",
      "Qté",
      "Unité",
      "P.U. HT",
      "Total HT",
    ]);
  });
});
