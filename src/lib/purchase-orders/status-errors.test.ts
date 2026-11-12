import { describe, expect, it } from "vitest";

import { purchaseOrderStatusErrorMessage } from "./status-errors";

describe("purchase order status change refusals", () => {
  it("says in words why a canceled order made from a request is not reopened (review of TI-691 3a)", () => {
    expect(purchaseOrderStatusErrorMessage("MATERIAL_REQUEST_LINE_ALREADY_ORDERED")).toBe(
      "Une ligne de ce bon a été commandée de nouveau depuis son annulation : il ne peut pas être rouvert.",
    );
    expect(purchaseOrderStatusErrorMessage("MATERIAL_REQUEST_ORDER_LINES_CHANGED")).toBe(
      "Une ligne de la demande de matériel a changé depuis l’annulation de ce bon : il ne peut pas être rouvert. Commandez-la de nouveau depuis la demande.",
    );
  });

  it("never shows a database message it does not know", () => {
    expect(purchaseOrderStatusErrorMessage('new row violates row-level security policy for table "purchase_orders"')).toBe(
      "Le statut n’a pas pu être enregistré. Réessayez.",
    );
  });
});
