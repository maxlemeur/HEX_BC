/**
 * The words a status change of a purchase order answers with. The status is written straight to the table (RLS and
 * triggers decide); only the refusals named here reach the screen, never another database message.
 */
const STATUS_REFUSALS: Record<string, string> = {
  // TI-691: a canceled order made from a material request is reopened only with its lines as they were ordered.
  MATERIAL_REQUEST_LINE_ALREADY_ORDERED:
    "Une ligne de ce bon a été commandée de nouveau depuis son annulation : il ne peut pas être rouvert.",
  MATERIAL_REQUEST_ORDER_LINES_CHANGED:
    "Une ligne de la demande de matériel a changé depuis l’annulation de ce bon : il ne peut pas être rouvert. Commandez-la de nouveau depuis la demande.",
};

export function purchaseOrderStatusErrorMessage(message: string): string {
  return STATUS_REFUSALS[message] ?? "Le statut n’a pas pu être enregistré. Réessayez.";
}
