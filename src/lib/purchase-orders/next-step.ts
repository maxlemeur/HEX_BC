import type { OrderStatus } from "@/lib/purchase-orders/lifecycle";

/**
 * What comes next on an order of an affaire (TI-691, the owner's walkthrough of 14/11/2026): the order page said where
 * it stood but never what to do. Its purchase runs in three steps — send it to the supplier, confirm it with the
 * supplier's confirmation as proof, receive it — and the page names the current one in a sentence.
 */
export const ORDER_STEP_KEYS = ["send", "confirm", "receive"] as const;
export type OrderStepKey = (typeof ORDER_STEP_KEYS)[number];
export const ORDER_STEP_LABELS: Record<OrderStepKey, string> = {
  send: "Envoyer",
  confirm: "Confirmer",
  receive: "Recevoir",
};

export type OrderStepState = "done" | "current" | "todo";
export type OrderNextStep = {
  /** Nothing is left to do: received, or canceled. */
  done: boolean;
  title: string;
  detail: string;
  steps: { key: OrderStepKey; label: string; state: OrderStepState }[];
};

function stepsAt(current: number): OrderNextStep["steps"] {
  return ORDER_STEP_KEYS.map((key, index) => ({
    key,
    label: ORDER_STEP_LABELS[key],
    state: index < current ? "done" : index === current ? "current" : "todo",
  }));
}

export function orderNextStep(
  status: OrderStatus,
  options: { sentAsTest?: boolean; remaining?: boolean } = {},
): OrderNextStep {
  switch (status) {
    case "draft":
      return {
        done: false,
        title: "Envoyer le bon au fournisseur",
        detail: "Envoyez-le par e-mail depuis cette page, ou transmettez-le autrement. Quand le fournisseur l’accepte, confirmez la commande avec sa confirmation pour preuve.",
        steps: stepsAt(0),
      };
    case "sent":
      return {
        done: false,
        title: "Confirmer la commande",
        detail: options.sentAsTest
          ? "Envoi de test : le fournisseur n’a rien reçu. Pour lui envoyer réellement ce bon, remettez-le en brouillon ; s’il est commandé autrement, confirmez la commande."
          : "Bon envoyé au fournisseur. À la réception de son accusé, confirmez la commande avec ses prix réels ; pour le corriger, remettez-le en brouillon.",
        steps: stepsAt(1),
      };
    case "confirmed":
      return {
        done: false,
        title: "Enregistrer la réception",
        detail: "À l’arrivée du matériel, enregistrez la réception datée, avec ce qui reste à venir s’il manque quelque chose.",
        steps: stepsAt(2),
      };
    case "received":
      return {
        done: true,
        title: "Commande reçue",
        detail: options.remaining
          ? "Reçue avec un reste à venir, noté ci-dessous : suivez-le avec le fournisseur."
          : "Rien d’autre à faire sur ce bon.",
        steps: stepsAt(ORDER_STEP_KEYS.length),
      };
    case "canceled":
      return {
        done: true,
        title: "Bon annulé",
        detail: "Ce bon n’est plus à envoyer ni à confirmer. Rouvrez-le en brouillon pour le reprendre.",
        steps: stepsAt(-1).map((step) => ({ ...step, state: "todo" })),
      };
  }
}
