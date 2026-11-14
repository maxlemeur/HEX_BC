import { describe, expect, it } from "vitest";

import { purchaseOrderWriteError } from "./write";

describe("purchase order write refusals", () => {
  // TI-691, delivery 3b-1 (review): a draft edit that changes the price of a request line reached a generic 500.
  it("says that a request line's price changes only at the confirmation", () => {
    expect(purchaseOrderWriteError({ message: "PURCHASE_ORDER_REQUEST_PRICE_AT_CONFIRMATION" })).toMatchObject({
      status: 400,
      message: "Le prix d’une ligne de la demande est celui du devis retenu : il ne change qu’à la confirmation de la commande.",
    });
  });
});
