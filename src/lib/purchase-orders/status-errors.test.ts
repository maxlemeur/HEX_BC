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

  it("says that an order of an affaire is confirmed, received and kept through its own actions (TI-691 3b-1)", () => {
    expect(purchaseOrderStatusErrorMessage("PURCHASE_ORDER_CONFIRM_THROUGH_FUNCTION")).toBe(
      "Un bon d’affaire se confirme depuis sa page, avec ses prix réels et la confirmation du fournisseur.",
    );
    expect(purchaseOrderStatusErrorMessage("PURCHASE_ORDER_RECEIVE_THROUGH_FUNCTION")).toBe(
      "Un bon d’affaire se reçoit depuis sa page, avec la date de réception.",
    );
    expect(purchaseOrderStatusErrorMessage("PURCHASE_ORDER_STATUS_TRANSITION_INVALID")).toBe(
      "Un bon d’affaire commandé ne change plus de statut : il ne peut être ni annulé ni remis en brouillon.",
    );
  });

  it("never shows a database message it does not know", () => {
    expect(purchaseOrderStatusErrorMessage('new row violates row-level security policy for table "purchase_orders"')).toBe(
      "Le statut n’a pas pu être enregistré. Réessayez.",
    );
  });
});
