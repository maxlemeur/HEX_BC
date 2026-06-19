import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PurchaseOrderDocument } from "@/components/PurchaseOrderDocument";

vi.mock("next/image", () => ({
  default: function NextImageMock() {
    return null;
  },
}));

function renderPurchaseOrderDocument(editable = false) {
  return renderToStaticMarkup(
    createElement(PurchaseOrderDocument, {
      editable,
      issuerName: "Jean Dupont",
      issuerRole: "Conducteur de travaux",
      orderDate: "2026-01-01",
      reference: "BC-001",
      supplier: {
        name: "Fournisseur test",
      },
      deliverySite: {
        name: "Site test",
      },
      items: [
        {
          key: "line-1",
          designation: "Tube acier",
          quantity: 2,
          unitPriceHtCents: 1000,
          lineTotalHtCents: 2000,
        },
      ],
      totalHtCents: 2000,
      totalTaxCents: 400,
      totalTtcCents: 2400,
    })
  );
}

describe("PurchaseOrderDocument", () => {
  it("applique nowrap et align-middle sur les entetes d'impression", () => {
    const markup = renderPurchaseOrderDocument(false);

    expect(markup).toMatch(
      /<th class="[^"]*align-middle[^"]*whitespace-nowrap[^"]*">Designation<\/th>/
    );
    expect(markup).toMatch(
      /<th class="[^"]*align-middle[^"]*whitespace-nowrap[^"]*">Qte<\/th>/
    );
    expect(markup).toMatch(
      /<th class="[^"]*align-middle[^"]*whitespace-nowrap[^"]*">P\.U\. HT<\/th>/
    );
    expect(markup).toMatch(
      /<th class="[^"]*align-middle[^"]*whitespace-nowrap[^"]*">Total HT<\/th>/
    );
  });

  it("garde la cellule d'action alignee en mode editable", () => {
    const markup = renderPurchaseOrderDocument(true);

    expect(markup).toContain('<th class="w-12 px-4 py-4 align-middle"></th>');
  });

  it("affiche un emetteur lisible quand le profil contient seulement un email", () => {
    const markup = renderToStaticMarkup(
      createElement(PurchaseOrderDocument, {
        editable: true,
        issuerName: "maxime.michel@hydroexpress.fr",
        issuerRole: "maxime.michel@hydroexpress.fr",
        orderDate: "2026-05-20",
        reference: undefined,
        supplier: null,
        deliverySite: null,
        items: [],
        totalHtCents: 0,
        totalTaxCents: 0,
        totalTtcCents: 0,
      })
    );

    expect(markup).toContain("Maxime MICHEL");
    expect(markup.match(/maxime\.michel@hydroexpress\.fr/g)).toHaveLength(1);
  });
});
