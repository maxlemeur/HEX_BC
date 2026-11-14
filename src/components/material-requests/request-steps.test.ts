import { describe, expect, it } from "vitest";

import { requestSteps, type RequestStepsInput } from "./request-steps";

type Line = RequestStepsInput["lines"][number];

function line(id: string, patch: Partial<Line> = {}): Line {
  return { id, status: "draft", product_id: null, supplier_id: null, price_quote_id: null, ...patch };
}

function input(patch: Partial<RequestStepsInput> = {}): RequestStepsInput {
  return { hasSourceText: true, lines: [], blockingLineIds: new Set(), quotes: [], orders: null, ...patch };
}

const ready = (id: string) => line(id, { status: "validated", product_id: "p", supplier_id: "s", price_quote_id: "q" });

describe("requestSteps", () => {
  it("starts a request with a pasted message at the split, and one without at the typing", () => {
    const pasted = requestSteps(input());
    expect(pasted.next).toMatchObject({ step: "lignes", title: "Découpez le message en lignes" });
    expect(pasted.steps.map((step) => step.state)).toEqual(["active", "upcoming", "upcoming"]);
    expect(requestSteps(input({ hasSourceText: false })).next.title).toBe("Collez le message du technicien, ou ajoutez les lignes");
  });

  it("follows the order of work on the lines: article, supplier, alerts, validation", () => {
    const unlinked = requestSteps(input({ lines: [line("a"), line("b", { product_id: "p", supplier_id: "s" })] }));
    expect(unlinked.next).toMatchObject({ step: "lignes", title: "Rattachez un article à la ligne qui n’en a pas" });

    const noSupplier = requestSteps(input({ lines: [line("a", { product_id: "p" }), line("b", { product_id: "p" })] }));
    expect(noSupplier.next.title).toBe("Choisissez le fournisseur des 2 lignes qui n’en ont pas");

    const blocked = requestSteps(
      input({ lines: [line("a", { product_id: "p", supplier_id: "s" })], blockingLineIds: new Set(["a"]) }),
    );
    expect(blocked.next.title).toBe("Réglez l’alerte de la ligne à compléter");

    const clear = requestSteps(input({ lines: [line("a", { product_id: "p", supplier_id: "s" })] }));
    expect(clear.next.title).toBe("Validez la ligne en brouillon");
    expect(clear.steps[0]).toMatchObject({ state: "active", status: "0 validée sur 1" });
  });

  it("keeps the lines step open while a validated line has no supplier", () => {
    // The server orders a line from its own supplier only: validated without one, it is not ready.
    const result = requestSteps(input({ lines: [line("a", { status: "validated", product_id: "p" })] }));
    expect(result.next).toMatchObject({ step: "lignes", title: "Choisissez le fournisseur de la ligne qui n’en a pas" });
    expect(result.steps[0]).toMatchObject({ state: "active", status: "1 ligne sans fournisseur" });
  });

  it("never sends a line a retained quote prices back to the choice of a supplier", () => {
    // A retained quote sets the price; the line's own supplier column may stay empty until then.
    const result = requestSteps(input({ lines: [line("a", { status: "validated", product_id: "p", price_quote_id: "q" })] }));
    expect(result.next.step).not.toBe("lignes");
  });

  it("leads validated lines through the quotes: consult, wait, retain", () => {
    const lines = [line("a", { status: "validated", product_id: "p", supplier_id: "s" })];
    const none = requestSteps(input({ lines }));
    expect(none.next).toMatchObject({ step: "devis", title: "Consultez les fournisseurs" });
    expect(none.steps.map((step) => step.state)).toEqual(["done", "active", "upcoming"]);

    const waiting = requestSteps(input({ lines, quotes: [{ status: "requested" }] }));
    expect(waiting.next.title).toBe("Saisissez les prix du devis attendu, à sa réception");
    expect(waiting.steps[1].status).toBe("1 devis attendu");

    const received = requestSteps(input({ lines, quotes: [{ status: "requested" }, { status: "received" }, { status: "closed" }] }));
    expect(received.next.title).toBe("Retenez le devis reçu");
    expect(received.steps[1].status).toBe("1 devis reçu, à retenir");
  });

  it("does not guess the quotes while they are not read", () => {
    const result = requestSteps(input({ lines: [line("a", { status: "validated", product_id: "p", supplier_id: "s" })], quotes: null }));
    expect(result.next).toMatchObject({ step: "devis", title: "Faites chiffrer les lignes validées" });
    expect(result.steps[1].status).toBe("1 ligne sans prix retenu");
  });

  it("sends priced lines to the purchase orders, and says when every line is in one", () => {
    const lines = [ready("a"), ready("b")];
    const toCreate = requestSteps(input({ lines, orders: { ready: 2, ordered: 0 } }));
    expect(toCreate.next).toMatchObject({ step: "commande", title: "Créez les brouillons de commande" });
    expect(toCreate.steps.map((step) => step.state)).toEqual(["done", "done", "active"]);
    expect(toCreate.steps[2].status).toBe("2 lignes prêtes");

    const partly = requestSteps(input({ lines, orders: { ready: 1, ordered: 1 } }));
    expect(partly.steps[2].status).toBe("1 ligne prête · 1 dans un bon");

    const done = requestSteps(input({ lines, orders: { ready: 0, ordered: 2 } }));
    expect(done.next).toMatchObject({ step: "commande", done: true, title: "Toutes les lignes ont leur bon de commande" });
    expect(done.steps.map((step) => step.state)).toEqual(["done", "done", "done"]);
  });

  it("keeps the earliest unfinished step first when lines are at different stages", () => {
    const result = requestSteps(input({ lines: [ready("a"), line("b")], orders: { ready: 1, ordered: 0 } }));
    expect(result.next.step).toBe("lignes");
    // The later steps still say what waits there.
    expect(result.steps[2]).toMatchObject({ state: "active", status: "1 ligne prête" });
  });

  it("opens the purchase orders without a count while they are not read", () => {
    const result = requestSteps(input({ lines: [ready("a")], orders: null }));
    expect(result.next).toMatchObject({ step: "commande", title: "Passez aux bons de commande" });
  });

  it("does not ask for an article on a draft a retained quote prices: the server would refuse the link", () => {
    // Validated without an article, priced, then reopened.
    const result = requestSteps(input({ lines: [line("a", { supplier_id: "s", price_quote_id: "q" })] }));
    expect(result.next.title).toBe("Validez la ligne en brouillon");
  });

  it("tells who may not buy that the orders are someone else's to create", () => {
    const result = requestSteps(input({ lines: [ready("a")], orders: { ready: 1, ordered: 0, canCreate: false } }));
    expect(result.next).toMatchObject({ step: "commande", title: "Faites créer les bons de commande" });
    expect(result.next.detail).toContain("Vos droits ne permettent pas de créer un bon de commande");
  });

  it("puts lines ready to order before a quote that is only awaited, and a received quote before them", () => {
    const lines = [ready("a"), line("b", { status: "validated", product_id: "p", supplier_id: "s" })];
    const awaited = requestSteps(input({ lines, quotes: [{ status: "requested" }], orders: { ready: 1, ordered: 0 } }));
    expect(awaited.next).toMatchObject({ step: "commande", title: "Créez les brouillons de commande" });
    expect(awaited.steps[1].status).toBe("1 devis attendu");

    const received = requestSteps(input({ lines, quotes: [{ status: "received" }], orders: { ready: 1, ordered: 0 } }));
    expect(received.next).toMatchObject({ step: "devis", title: "Retenez le devis reçu" });

    // Once the ready lines are in their order, the awaited quote is what is left.
    const later = requestSteps(input({ lines, quotes: [{ status: "requested" }], orders: { ready: 0, ordered: 1 } }));
    expect(later.next).toMatchObject({ step: "devis", title: "Saisissez les prix du devis attendu, à sa réception" });
    expect(later.steps[2]).toMatchObject({ state: "active", status: "1 ligne sans bon de commande" });
  });

  it("does not call quotes retained or closed for other lines a supplier never consulted", () => {
    const lines = [ready("a"), line("b", { status: "validated", product_id: "p", supplier_id: "s" })];
    const result = requestSteps(input({ lines, quotes: [{ status: "retained" }, { status: "closed" }], orders: { ready: 0, ordered: 1 } }));
    expect(result.steps[1].status).toBe("Aucune consultation en cours");
    expect(result.next.title).toBe("Consultez les fournisseurs");
  });
});
