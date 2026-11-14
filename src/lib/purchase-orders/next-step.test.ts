import { describe, expect, it } from "vitest";

import { orderRequestOrigin } from "@/components/purchase-orders/order-lines";
import { orderNextStep } from "@/lib/purchase-orders/next-step";

// TI-691 (owner's walkthrough of 14/11/2026): the order of an affaire says what comes next and leads back to its request.
describe("orderNextStep", () => {
  it.each([
    ["draft", "Envoyer le bon au fournisseur", ["current", "todo", "todo"]],
    ["sent", "Confirmer la commande", ["done", "current", "todo"]],
    ["confirmed", "Enregistrer la réception", ["done", "done", "current"]],
    ["received", "Commande reçue", ["done", "done", "done"]],
    ["canceled", "Bon annulé", ["todo", "todo", "todo"]],
  ] as const)("names the step of a %s order", (status, title, states) => {
    const model = orderNextStep(status);
    expect([model.title, model.steps.map((step) => step.state)]).toEqual([title, states]);
  });

  it("never says there is nothing left while a remainder is to come", () => {
    expect(orderNextStep("received", { remaining: true }).detail).not.toContain("Rien d’autre");
    expect(orderNextStep("sent", { sentAsTest: true }).detail).toMatch(/^Envoi de test : le fournisseur n’a rien reçu/);
  });
});

describe("orderRequestOrigin", () => {
  const line = (requestId: string, requestedOn: string | null) => ({
    material_request_lines: { position: 1, request_id: requestId, material_requests: { project_id: "p", requested_on: requestedOn } },
  });

  it("leads to the one request, open on its orders, dated", () => {
    expect(orderRequestOrigin("p", [line("r1", "2026-11-14"), line("r1", "2026-11-14"), {}])).toEqual({
      href: "/dashboard/affaires/p/demandes-materiel/r1?etape=commande", label: "Demande du 14/11/2026",
    });
  });

  it("names an undated request, leads to the affaire's purchases for several, and nowhere without one", () => {
    expect(orderRequestOrigin("p", [line("r1", null)])?.label).toBe("Demande de matériel");
    expect(orderRequestOrigin("p", [line("r1", "2026-11-14"), line("r2", "2026-11-15")]))
      .toEqual({ href: "/dashboard/affaires/p/demandes-materiel", label: "Achats" });
    expect(orderRequestOrigin("p", [{}])).toBeNull();
  });
});
