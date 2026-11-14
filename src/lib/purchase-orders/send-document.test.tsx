import { describe, expect, it } from "vitest";

import { extractPdfText } from "../../../scripts/tester-army/pdf-text";

import { purchaseOrderPdfFilename } from "./send";
import { renderPurchaseOrderPdf, type PurchaseOrderPdfData } from "./send-document";

/**
 * Failure modes of the purchase order a supplier receives attached to its e-mail, with a fictional order:
 *  1. the PDF does not say what is ordered, from whom, by whom, delivered where and when, at what price and total;
 *  2. a price given for a lot reads as a price for one unit; a discount reads as an amount to pay; the amounts are
 *     computed again instead of being the stored ones;
 *  3. an amount shows a missing glyph (the standard PDF fonts have no narrow no-break space);
 *  4. what is ours (the request link, the imputation of a line) is printed for the supplier;
 *  5. the file name carries a path or a character a mail client refuses;
 *  6. a long address or name is hyphenated or cut: the supplier would read an address that does not exist.
 */

const order: PurchaseOrderPdfData = {
  reference: "C-2611-007", orderDate: "2026-11-14", expectedDeliveryDate: "2026-11-20", notes: "Livrer avant 10 h, quai B.",
  issuer: { name: "Dominique Auteur", role: "Chargé d’affaires", phone: "01 00 00 00 00", email: "auteur@entreprise.invalid" },
  supplier: {
    name: "Fournisseur Alpha", address: "2 rue du Test", postalCode: "69000", city: "Lyon", contactName: "Camille Essai",
    phone: null, email: "commandes@alpha.invalid",
  },
  deliverySite: null,
  affaire: { name: "Affaire inventée", address: "1 rue de l’Essai, 75000 Paris" },
  deliveryMode: "site",
  lines: [
    { designation: "Coude 90° inox DN 50", reference: "ALP-501", quantity: 4, unit: "u", unitPriceHtCents: 1234, pricePer: 1, lineTotalHtCents: 4936, kind: "article" },
    { designation: "Vis inox M6x20", reference: null, quantity: 1500, unit: "u", unitPriceHtCents: 340, pricePer: 1000, lineTotalHtCents: 510, kind: "article" },
    { designation: "Port", reference: null, quantity: 1, unit: "forfait", unitPriceHtCents: 1500, pricePer: 1, lineTotalHtCents: 1500, kind: "shipping" },
    { designation: "Remise", reference: null, quantity: 1, unit: "forfait", unitPriceHtCents: 500, pricePer: 1, lineTotalHtCents: -500, kind: "discount" },
  ],
  // Deliberately not the sum of the lines: the document prints what is stored.
  totalHtCents: 123456, totalTaxCents: 24691, totalTtcCents: 148147,
};

async function textOf(data: PurchaseOrderPdfData): Promise<string> {
  const pdf = await renderPurchaseOrderPdf(data);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  return (await extractPdfText(pdf)).pages.join(" ").replace(/\s+/g, " ");
}

describe("purchase order PDF sent to the supplier", () => {
  it("1-4 says the order, its parties, its delivery, its lines and its stored totals, and nothing of ours", async () => {
    const text = await textOf(order);
    for (const expected of [
      "BON DE COMMANDE", "C-2611-007", "Date : 14/11/2026", "Livraison le : 20/11/2026",
      "Fournisseur Alpha", "2 rue du Test", "69000 Lyon", "Contact : Camille Essai", "commandes@alpha.invalid",
      "Livraison sur chantier", "Affaire : Affaire inventée", "1 rue de l’Essai, 75000 Paris",
      "Dominique Auteur", "auteur@entreprise.invalid",
      "Coude 90° inox DN 50", "Réf. ALP-501", "12,34 €", "49,36 €",
      "Vis inox M6x20", "1 500", "3,40 € les 1 000", "5,10 €",
      "Port", "15,00 €", "Remise", "-5,00 €",
      "Total HT 1 234,56 €", "TVA 246,91 €", "Total TTC 1 481,47 €",
      "INSTRUCTIONS COMPLÉMENTAIRES", "Livrer avant 10 h, quai B.",
    ]) expect(text).toContain(expected);
    expect(text).not.toMatch(/[  ]/);
    expect(text).not.toMatch(/Demande du|Frais généraux|Imputation/);
  });

  it("1 names a delivery site, and a delivery still to be determined", async () => {
    const text = await textOf({
      ...order, affaire: null, deliveryMode: null, expectedDeliveryDate: "TBD", notes: null,
      deliverySite: { name: "Chantier inventé", projectCode: "CH-12", address: "3 allée de l’Essai", postalCode: "13000", city: "Marseille",
        contactName: "Alex Chef", contactPhone: "06 00 00 00 00" },
    });
    for (const expected of ["Chantier inventé", "Code chantier : CH-12", "13000 Marseille", "Contact : Alex Chef", "Livraison le : À déterminer"]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain("INSTRUCTIONS COMPLÉMENTAIRES");
  });

  it("6 writes long addresses and names whole", async () => {
    const supplierEmail = "commandes@army-1794659898603-d40d9fc7.invalid";
    const issuerEmail = "army-ci-678b2c7d-2933-463e-9606-7444bcbab5ab@example.test";
    const designation = "Raccord-union-démontable-à-portée-conique-laiton-nickelé DN 50";
    const text = await textOf({
      ...order,
      supplier: { ...order.supplier, name: "ARMY-1794659898603-d40d9fc7 Négoce envoi", email: supplierEmail },
      issuer: { ...order.issuer, name: "Army CI 678B2C7D 2933 463E 9606 7444BCBAB5AB", email: issuerEmail },
      lines: [{ ...order.lines[0]!, designation }],
    });
    for (const expected of [supplierEmail, issuerEmail, designation, "ARMY-1794659898603-d40d9fc7 Négoce envoi"]) {
      expect(text).toContain(expected);
    }
  });

  it("5 names the file after the reference, without a path", () => {
    expect(purchaseOrderPdfFilename("C-2611-007")).toBe("Bon_de_commande_C-2611-007.pdf");
    expect(purchaseOrderPdfFilename("../C 26/11\\7")).toBe("Bon_de_commande_..-C-26-11-7.pdf");
    expect(purchaseOrderPdfFilename("  ")).toBe("Bon_de_commande_commande.pdf");
  });
});
