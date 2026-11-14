import type { MaterialRequestLine } from "@/lib/material-requests/contracts";
import type { MaterialRequestQuote } from "@/lib/material-requests/quote-contracts";

import { plural } from "./format";

/*
 * Where a material request stands, and what to do next (TI-691). The order of work is fixed: cut the message into
 * lines, give each line an article and a supplier, validate, have the suppliers quote, retain a quote, make the draft
 * purchase orders. The page shows one step at a time; this reads which one from what the page already holds. Nothing
 * here is stored, and nothing here decides what an action may do: the server still does.
 */

export const REQUEST_STEP_KEYS = ["lignes", "devis", "commande"] as const;
export type RequestStepKey = (typeof REQUEST_STEP_KEYS)[number];

export const REQUEST_STEP_LABELS: Record<RequestStepKey, string> = {
  lignes: "Lignes",
  devis: "Devis",
  commande: "Bons de commande",
};

/** `active`: something waits there now. `upcoming`: nothing to do there yet. */
export type RequestStepState = "done" | "active" | "upcoming";

export type RequestStep = { key: RequestStepKey; label: string; state: RequestStepState; status: string };

export type RequestNextAction = {
  step: RequestStepKey;
  title: string;
  detail: string;
  /** Every line is in a purchase order: nothing is left to do on the request. */
  done?: boolean;
};

export type RequestStepsInput = {
  hasSourceText: boolean;
  lines: ReadonlyArray<Pick<MaterialRequestLine, "id" | "status" | "product_id" | "supplier_id" | "price_quote_id">>;
  /** Draft lines that an alert keeps from validation. */
  blockingLineIds: ReadonlySet<string>;
  /** Null while the quotes are not read. */
  quotes: ReadonlyArray<Pick<MaterialRequestQuote, "status">> | null;
  /**
   * Lines ready to order and lines in a purchase order; null while the orders are not read. `canCreate`: the server
   * says the caller may create the purchase orders (a writer of the request who may also buy); true when left out.
   */
  orders: { ready: number; ordered: number; canCreate?: boolean } | null;
};

export type RequestSteps = { steps: RequestStep[]; next: RequestNextAction };

function linesStep(input: RequestStepsInput): { state: RequestStepState; status: string; next: RequestNextAction | null } {
  const { lines } = input;
  if (lines.length === 0) {
    return {
      state: "active",
      status: "Aucune ligne",
      next: input.hasSourceText
        ? {
            step: "lignes",
            title: "Découpez le message en lignes",
            detail: "Le message collé est lu article par article. Vous relisez ensuite chaque ligne : rien n’est validé sans vous.",
          }
        : {
            step: "lignes",
            title: "Collez le message du technicien, ou ajoutez les lignes",
            detail: "Le message collé se découpe en lignes d’un geste ; une demande dictée ou sur papier se recopie ligne par ligne.",
          },
    };
  }
  const drafts = lines.filter((line) => line.status === "draft");
  const validated = lines.length - drafts.length;
  // A line a retained quote prices no longer changes its article (the server refuses it): it is not asked for one.
  const unlinked = drafts.filter((line) => !line.product_id && !line.price_quote_id).length;
  // A retained quote prices a line from its own supplier: such a line waits for nothing here.
  const withoutSupplier = lines.filter((line) => !line.supplier_id && !line.price_quote_id).length;
  const status =
    drafts.length > 0
      ? `${plural(validated, "validée", "validées")} sur ${lines.length}`
      : withoutSupplier > 0
        ? `${plural(withoutSupplier, "ligne", "lignes")} sans fournisseur`
        : plural(lines.length, "ligne validée", "lignes validées");
  const blocked = drafts.filter((line) => input.blockingLineIds.has(line.id)).length;

  let next: RequestNextAction | null = null;
  if (unlinked > 0) {
    next = {
      step: "lignes",
      title: unlinked > 1 ? `Rattachez un article aux ${unlinked} lignes qui n’en ont pas` : "Rattachez un article à la ligne qui n’en a pas",
      detail: "L’article du catalogue apporte à la ligne sa matière, sa dimension et le fournisseur à proposer.",
    };
  } else if (withoutSupplier > 0) {
    next = {
      step: "lignes",
      title:
        withoutSupplier > 1
          ? `Choisissez le fournisseur des ${withoutSupplier} lignes qui n’en ont pas`
          : "Choisissez le fournisseur de la ligne qui n’en a pas",
      detail: "C’est le fournisseur à qui le prix de la ligne sera demandé.",
    };
  } else if (blocked > 0) {
    next = {
      step: "lignes",
      title: blocked > 1 ? `Réglez les alertes des ${blocked} lignes à compléter` : "Réglez l’alerte de la ligne à compléter",
      detail: "Les champs en jaune sont à compléter ou à vérifier avant la validation.",
    };
  } else if (drafts.length > 0) {
    next = {
      step: "lignes",
      title: drafts.length > 1 ? `Validez les ${drafts.length} lignes en brouillon` : "Validez la ligne en brouillon",
      detail: "Une ligne validée peut être chiffrée par un devis, puis mise dans un bon de commande.",
    };
  }
  return { state: next === null ? "done" : "active", status, next };
}

function quotesStep(
  input: RequestStepsInput,
  linesDone: boolean,
): { state: RequestStepState; status: string; next: RequestNextAction | null; waiting?: boolean } {
  const { lines, quotes } = input;
  if (lines.length === 0) return { state: "upcoming", status: "Après les lignes", next: null };
  const unpriced = lines.filter((line) => !line.price_quote_id).length;
  if (unpriced === 0) {
    return { state: "done", status: lines.length > 1 ? `Prix retenus pour les ${lines.length} lignes` : "Prix retenu", next: null };
  }
  const state: RequestStepState = linesDone || (quotes?.length ?? 0) > 0 ? "active" : "upcoming";
  if (quotes === null) {
    return {
      state,
      status: `${plural(unpriced, "ligne", "lignes")} sans prix retenu`,
      next: { step: "devis", title: "Faites chiffrer les lignes validées", detail: "Consultez les fournisseurs, saisissez leurs prix, puis retenez un devis." },
    };
  }
  const received = quotes.filter((quote) => quote.status === "received").length;
  const requested = quotes.filter((quote) => quote.status === "requested").length;
  if (received > 0) {
    return {
      state,
      status: `${received} devis ${received > 1 ? "reçus" : "reçu"}, à retenir`,
      next: {
        step: "devis",
        title: received > 1 ? `Retenez un des ${received} devis reçus` : "Retenez le devis reçu",
        detail: "Le devis retenu donne leur prix aux lignes ; les devis en concurrence sur les mêmes lignes sont clos.",
      },
    };
  }
  if (requested > 0) {
    return {
      state,
      status: `${requested} devis ${requested > 1 ? "attendus" : "attendu"}`,
      // Nothing to do here until a supplier answers: work that is possible elsewhere comes first.
      waiting: true,
      next: {
        step: "devis",
        title: requested > 1 ? `Saisissez les prix des ${requested} devis attendus, à leur réception` : "Saisissez les prix du devis attendu, à sa réception",
        detail: "Marquez le devis reçu, saisissez ses prix ligne par ligne, puis retenez-le.",
      },
    };
  }
  return {
    state,
    // Quotes retained or closed for other lines are not a consultation under way.
    status: quotes.length > 0 ? "Aucune consultation en cours" : "Aucun fournisseur consulté",
    next: {
      step: "devis",
      title: "Consultez les fournisseurs",
      detail: "Copiez le message préparé pour chaque fournisseur, envoyez-le, puis notez la consultation comme envoyée. MergeOne n’envoie rien.",
    },
  };
}

function ordersStep(input: RequestStepsInput): { state: RequestStepState; status: string; next: RequestNextAction | null } {
  const { lines, orders } = input;
  if (lines.length === 0) return { state: "upcoming", status: "Après les devis", next: null };
  if (orders === null) {
    const priced = lines.filter((line) => line.price_quote_id).length;
    return {
      state: priced > 0 ? "active" : "upcoming",
      status: priced > 0 ? `${plural(priced, "ligne chiffrée", "lignes chiffrées")}` : "Après les devis",
      next: priced > 0 ? { step: "commande", title: "Passez aux bons de commande", detail: "Un brouillon de bon de commande par fournisseur, au prix du devis retenu." } : null,
    };
  }
  if (orders.ready > 0) {
    return {
      state: "active",
      status: [plural(orders.ready, "ligne prête", "lignes prêtes"), orders.ordered > 0 ? `${orders.ordered} dans un bon` : null]
        .filter(Boolean)
        .join(" · "),
      next:
        orders.canCreate === false
          ? {
              step: "commande",
              title: "Faites créer les bons de commande",
              detail: `${plural(orders.ready, "ligne est prête", "lignes sont prêtes")}. Vos droits ne permettent pas de créer un bon de commande : une personne qui achète pour l’entreprise le fait depuis cette étape.`,
            }
          : {
              step: "commande",
              title: "Créez les brouillons de commande",
              detail: `${plural(orders.ready, "ligne est prête", "lignes sont prêtes")} : un brouillon de bon de commande par fournisseur, au prix du devis retenu. Rien n’est envoyé au fournisseur.`,
            },
    };
  }
  if (orders.ordered >= lines.length) {
    return {
      state: "done",
      status: "Toutes les lignes ont leur bon",
      next: {
        step: "commande",
        done: true,
        title: "Toutes les lignes ont leur bon de commande",
        detail: "La suite se passe sur chaque bon : confirmation avec la preuve du fournisseur, puis réception.",
      },
    };
  }
  if (orders.ordered > 0) {
    const left = lines.length - orders.ordered;
    return { state: "active", status: `${plural(left, "ligne", "lignes")} sans bon de commande`, next: null };
  }
  return { state: "upcoming", status: "Aucune ligne prête", next: null };
}

/** The three steps of a request with their state, and the one thing to do now. */
export function requestSteps(input: RequestStepsInput): RequestSteps {
  const linesPart = linesStep(input);
  const quotesPart = quotesStep(input, linesPart.state === "done");
  const ordersPart = ordersStep(input);
  // A quote only awaited is a wait on a supplier: lines ready to order are something to do now, and come first.
  const quotesNext = quotesPart.waiting && (input.orders?.ready ?? 0) > 0 ? null : quotesPart.next;
  const next =
    linesPart.next
    ?? quotesNext
    ?? ordersPart.next
    ?? quotesPart.next
    ?? ({ step: "commande", title: "Suivez les bons de commande", detail: "Les lignes restantes sont détaillées à l’étape Bons de commande." } satisfies RequestNextAction);
  return {
    steps: [
      { key: "lignes", label: REQUEST_STEP_LABELS.lignes, state: linesPart.state, status: linesPart.status },
      { key: "devis", label: REQUEST_STEP_LABELS.devis, state: quotesPart.state, status: quotesPart.status },
      { key: "commande", label: REQUEST_STEP_LABELS.commande, state: ordersPart.state, status: ordersPart.status },
    ],
    next,
  };
}
