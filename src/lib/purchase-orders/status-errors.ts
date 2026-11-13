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
  // TI-691, delivery 3b-1: an order of an affaire is confirmed and received through its own actions, and stays ordered.
  PURCHASE_ORDER_CONFIRM_THROUGH_FUNCTION:
    "Un bon d’affaire se confirme depuis sa page, avec ses prix réels et la confirmation du fournisseur.",
  PURCHASE_ORDER_RECEIVE_THROUGH_FUNCTION: "Un bon d’affaire se reçoit depuis sa page, avec la date de réception.",
  PURCHASE_ORDER_STATUS_TRANSITION_INVALID:
    "Un bon d’affaire commandé ne change plus de statut : il ne peut être ni annulé ni remis en brouillon.",
};

export function purchaseOrderStatusErrorMessage(message: string): string {
  return STATUS_REFUSALS[message] ?? "Le statut n’a pas pu être enregistré. Réessayez.";
}
