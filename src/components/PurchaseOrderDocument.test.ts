import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe,expect,it,vi } from "vitest";

import { PurchaseOrderDocument } from "@/components/PurchaseOrderDocument";

vi.mock("next/image", () => ({
  default: function NextImageMock() {
    return null;
  },
}));

describe("PurchaseOrderDocument", () => {

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
