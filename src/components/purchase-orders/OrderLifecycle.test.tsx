import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatEUR } from "@/lib/money";

/** The amount as the screen writes it, spaces as the queries read them (no-break spaces normalised). */
const euros = (cents: number) => formatEUR(cents).replace(/\s/g, " ");

/**
 * Failure modes, written before the screen (TI-691, lot 2 « l'achat », delivery 3b-1 « commander et recevoir »). The
 * office confirms a draft of an affaire at its real prices with the supplier's confirmation as proof, then records its
 * reception. Each of these would record a wrong cost, an order without proof, or a second copy of the proof:
 *  1. a line does not start at its quote price and lot, or the quote price is no longer shown once changed;
 *  2. a changed price does not change the line total and the order total at quantity × price ÷ lot, rounded half away
 *     from zero to the cent (1 500 screws at 3,52 € the hundred = 52,80 €);
 *  3. the order is confirmed without a proof, or with a price that is not an amount;
 *  4. a new proof is not sent before the confirmation, or is sent again when the confirmation is retried after a
 *     refusal (the order would hold two copies); a document already joined is sent again instead of being named;
 *  5. the confirmation does not send the revision read, the dates, the trimmed reference, the proof and every line's
 *     real price in cents and its lot;
 *  6. a refusal is silent or shows a code instead of the server's sentence; a confirmation does not reload the order;
 *  7. a reception does not send its date (today by default) and its note, or a confirmed order offers no reception;
 *  8. an ordered order offers its status to be changed directly, or a draft offers more than « Annulée ».
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh }) }));
// The status write of an affaire's order: from("purchase_orders").update({ status }).eq("id", order) -> { error }.
const statusWrites = vi.hoisted(() => ({ calls: [] as unknown[], error: null as { message: string } | null }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: async (column: string, value: unknown) => {
          statusWrites.calls.push({ table, values, column, value });
          return { error: statusWrites.error };
        },
      }),
    }),
  }),
}));

import { OrderLifecycle, type OrderLifecycleProps } from "@/components/purchase-orders/OrderLifecycle";

const ORDER = "50000000-0000-4000-8000-000000000001";
const ELBOWS = "52000000-0000-4000-8000-000000000001";
const SCREWS = "52000000-0000-4000-8000-000000000002";
const PORT = "52000000-0000-4000-8000-000000000003";
const JOINED = "51000000-0000-4000-8000-000000000001";
const UPLOADED = "51000000-0000-4000-8000-000000000002";

function props(partial: Partial<OrderLifecycleProps> = {}): OrderLifecycleProps {
  return {
    orderId: ORDER,
    reference: "C-2611-007",
    status: "draft",
    editRevision: 4,
    orderDate: "2026-11-13",
    expectedDeliveryDate: "2026-11-20",
    lines: [
      { id: ELBOWS, position: 1, designation: "Coude 90° inox DN 50", quantity: 4, unit: "u", unitPriceHtCents: 1234, pricePer: 1, taxRateBp: 2000, kind: "article", fromRequest: true },
      { id: SCREWS, position: 2, designation: "Vis inox M6x20", quantity: 1500, unit: "u", unitPriceHtCents: 340, pricePer: 100, taxRateBp: 2000, kind: "article", fromRequest: true },
      { id: PORT, position: 3, designation: "Frais de port", quantity: 1, unit: "forfait", unitPriceHtCents: 1500, pricePer: 1, taxRateBp: 2000, kind: "shipping" },
    ],
    documents: [{ id: JOINED, name: "Devis Alpha" }],
    confirmation: null,
    reception: null,
    today: "2026-11-13",
    ...partial,
  };
}

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function respond(handler: (call: Call) => { status: number; body: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body instanceof FormData ? init.body : typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const call = { url, method: init?.method ?? "GET", body };
    calls.push(call);
    const answer = handler(call);
    return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { "content-type": "application/json" } });
  }));
}

const confirmedAnswer = { status: 200, body: { ok: true, data: { id: ORDER, status: "confirmed" } } };
const uploadedAnswer = { status: 201, body: { item: { id: UPLOADED, name: "AR Alpha" } } };

beforeEach(() => {
  calls = [];
  refresh.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openConfirmation() {
  const user = userEvent.setup();
  render(<OrderLifecycle {...props()} />);
  await user.click(screen.getByRole("button", { name: "Confirmer la commande…" }));
  const dialog = await screen.findByRole("dialog", { name: "Confirmer la commande C-2611-007" });
  return { user, dialog };
}

describe("OrderLifecycle — confirmation", () => {
  it("starts each line at its quote price and lot, and totals at quantity × price ÷ lot", async () => {
    const { dialog } = await openConfirmation();
    expect(within(dialog).getByLabelText("Prix réel HT, ligne 1")).toHaveValue("12.34");
    expect(within(dialog).getByLabelText("Prix réel HT, ligne 2")).toHaveValue("3.40");
    expect(within(dialog).getByLabelText("Lot, ligne 2")).toHaveValue("100");
    expect(within(dialog).getByText(`Prix du devis : ${euros(340)} les 100`)).toBeInTheDocument();
    // 4 × 12,34 + 1 500 × 3,40 ÷ 100 + 15 = 49,36 + 51,00 + 15,00.
    expect(within(dialog).getByText("Total HT au prix réel").nextSibling).toHaveTextContent(euros(4936 + 5100 + 1500));
  });

  it("follows a changed price in the line and order totals, the quote price still shown", async () => {
    const { user, dialog } = await openConfirmation();
    const price = within(dialog).getByLabelText("Prix réel HT, ligne 2");
    await user.clear(price);
    await user.type(price, "3,52");
    expect(within(dialog).getByTestId(`confirmation-line-total-${SCREWS}`)).toHaveTextContent(euros(5280));
    expect(within(dialog).getByText(`Prix du devis : ${euros(340)} les 100`)).toBeInTheDocument();
    expect(within(dialog).getByText("Total HT au prix réel").nextSibling).toHaveTextContent(euros(4936 + 5280 + 1500));
  });

  it("refuses to confirm without a proof, and sends nothing", async () => {
    respond(() => confirmedAnswer);
    const { user, dialog } = await openConfirmation();
    await user.selectOptions(within(dialog).getByLabelText("Preuve de commande"), "");
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Joignez la confirmation du fournisseur (bon, e-mail ou capture) pour confirmer la commande.");
    expect(calls).toEqual([]);
  });

  it("refuses a price that is not an amount, and sends nothing", async () => {
    respond(() => confirmedAnswer);
    const { user, dialog } = await openConfirmation();
    const price = within(dialog).getByLabelText("Prix réel HT, ligne 1");
    await user.clear(price);
    await user.type(price, "douze");
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Ligne 1 : saisissez un prix HT, par exemple 12,34.");
    expect(calls).toEqual([]);
  });

  it("names a document already joined as the proof and sends the whole confirmation", async () => {
    respond(() => confirmedAnswer);
    const { user, dialog } = await openConfirmation();
    await user.selectOptions(within(dialog).getByLabelText("Preuve de commande"), JOINED);
    const price = within(dialog).getByLabelText("Prix réel HT, ligne 2");
    await user.clear(price);
    await user.type(price, "3,52");
    const ordered = within(dialog).getByLabelText("Date de commande");
    await user.clear(ordered);
    await user.type(ordered, "2026-11-12");
    const delivery = within(dialog).getByLabelText("Livraison prévue");
    await user.clear(delivery);
    await user.type(delivery, "2026-11-19");
    await user.type(within(dialog).getByLabelText("Référence du fournisseur"), "  AR-4471 ");
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{
      url: `/api/purchase-orders/${ORDER}/confirmation`,
      method: "POST",
      body: {
        expected_revision: 4,
        ordered_on: "2026-11-12",
        expected_delivery_date: "2026-11-19",
        supplier_reference: "AR-4471",
        document_id: JOINED,
        lines: [
          { id: ELBOWS, unit_price_ht_cents: 1234, price_per: 1 },
          { id: SCREWS, unit_price_ht_cents: 352, price_per: 100 },
          { id: PORT, unit_price_ht_cents: 1500, price_per: 1 },
        ],
      },
    }]);
  });

  it("sends a new proof once, before the confirmation, and keeps it when the confirmation is retried", async () => {
    let confirmations = 0;
    respond((call) => {
      if (call.url.endsWith("/devis")) return uploadedAnswer;
      confirmations += 1;
      return confirmations === 1
        ? { status: 409, body: { ok: false, error: { code: "PURCHASE_ORDER_REVISION_CONFLICT", message: "Ce bon a été modifié entre-temps : rechargez la page, puis confirmez de nouveau." } } }
        : confirmedAnswer;
    });
    const { user, dialog } = await openConfirmation();
    const file = new File(["%PDF-1.7 accusé de réception"], "ar-alpha.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("Ajouter la confirmation du fournisseur"), file);
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Ce bon a été modifié entre-temps : rechargez la page, puis confirmez de nouveau.");
    expect(refresh).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST /api/purchase-orders/${ORDER}/devis`,
      `POST /api/purchase-orders/${ORDER}/confirmation`,
      `POST /api/purchase-orders/${ORDER}/confirmation`,
    ]);
    const uploaded = calls[0].body as FormData;
    expect((uploaded.get("file") as File).name).toBe("ar-alpha.pdf");
    expect(uploaded.get("name")).toBe("Confirmation de commande");
    expect(calls.slice(1).map((call) => (call.body as { document_id: string }).document_id)).toEqual([UPLOADED, UPLOADED]);
  });
});

describe("OrderLifecycle — confirmation, review cases", () => {
  // The draft editor writes « TBD » for a delivery « À déterminer »: the field starts empty and an empty field keeps it.
  it("keeps a delivery date still to be determined when no date is given", async () => {
    respond(() => confirmedAnswer);
    const user = userEvent.setup();
    render(<OrderLifecycle {...props({ expectedDeliveryDate: "TBD" })} />);
    await user.click(screen.getByRole("button", { name: "Confirmer la commande…" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirmer la commande C-2611-007" });
    expect(within(dialog).getByLabelText("Livraison prévue")).toHaveValue("");
    await user.selectOptions(within(dialog).getByLabelText("Preuve de commande"), JOINED);
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls[0].body).not.toHaveProperty("expected_delivery_date");
  });

  it("offers only the files the storage keeps, and says so in French when the upload is refused", async () => {
    respond(() => ({ status: 400, body: { error: "mime type image/gif is not supported" } }));
    const { user, dialog } = await openConfirmation();
    const input = within(dialog).getByLabelText("Ajouter la confirmation du fournisseur");
    expect(input).toHaveAttribute("accept", "application/pdf,image/png,image/jpeg,image/webp");
    await user.upload(input, new File(["%PDF-1.7"], "ar.pdf", { type: "application/pdf" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "La confirmation du fournisseur n’a pas pu être jointe : envoyez un PDF ou une image PNG, JPEG ou WebP de 10 Mo au plus.");
    expect(within(dialog).getByRole("alert")).not.toHaveTextContent("mime type");
  });

  it("refuses a price beyond an order's capacity without breaking the dialog", async () => {
    respond(() => confirmedAnswer);
    const { user, dialog } = await openConfirmation();
    const price = within(dialog).getByLabelText("Prix réel HT, ligne 1");
    await user.clear(price);
    await user.type(price, "99999999999");
    expect(within(dialog).getByTestId(`confirmation-line-total-${ELBOWS}`)).toHaveTextContent("—");
    await user.selectOptions(within(dialog).getByLabelText("Preuve de commande"), JOINED);
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Ligne 1 : le montant dépasse la capacité d’une commande.");
    expect(calls).toEqual([]);
  });

  it("names the proof already sent when the dialog is opened again after a refusal", async () => {
    let confirmations = 0;
    respond((call) => {
      if (call.url.endsWith("/devis")) return uploadedAnswer;
      confirmations += 1;
      return confirmations === 1
        ? { status: 422, body: { ok: false, error: { code: "PURCHASE_ORDER_CONFIRMATION_DATE_INVALID", message: "La commande ne peut pas être passée dans le futur, ni livrée avant d’être passée." } } }
        : confirmedAnswer;
    });
    const { user, dialog } = await openConfirmation();
    await user.upload(within(dialog).getByLabelText("Ajouter la confirmation du fournisseur"),
      new File(["%PDF-1.7"], "ar-alpha.pdf", { type: "application/pdf" }));
    await user.click(within(dialog).getByRole("button", { name: "Confirmer la commande" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));
    await user.click(screen.getByRole("button", { name: "Confirmer la commande…" }));
    const again = await screen.findByRole("dialog", { name: "Confirmer la commande C-2611-007" });
    expect(within(again).getByLabelText("Preuve de commande")).toHaveValue(UPLOADED);
    await user.click(within(again).getByRole("button", { name: "Confirmer la commande" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(calls.filter((call) => call.url.endsWith("/devis"))).toHaveLength(1);
    expect((calls.at(-1)?.body as { document_id: string }).document_id).toBe(UPLOADED);
  });
});

describe("OrderLifecycle — status and reception", () => {
  // TI-691 (owner's walkthrough of 14/11/2026): a status selector beside « Confirmer la commande… » read as a way to
  // order without proof. The changes without proof are named actions under the step, and the step says what comes next.
  it("offers a draft only to be canceled, besides its confirmation", () => {
    render(<OrderLifecycle {...props()} />);
    expect(screen.queryByLabelText("Statut de la commande")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Envoyer le bon au fournisseur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Annuler le bon…" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /brouillon/ })).not.toBeInTheDocument();
  });

  // Codex review of #311: an order of an affaire marked « Envoyée » before this delivery was offered nothing.
  it("offers a sent order of an affaire to return to draft or to be canceled", () => {
    render(<OrderLifecycle {...props({ status: "sent" })} />);
    expect(screen.queryByLabelText("Statut de la commande")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Confirmer la commande" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remettre en brouillon" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Annuler le bon…" })).toBeEnabled();
  });

  it("cancels a draft only once its cancellation is confirmed, with the same write as before", async () => {
    statusWrites.calls = [];
    statusWrites.error = null;
    const user = userEvent.setup();
    render(<OrderLifecycle {...props()} />);
    await user.click(screen.getByRole("button", { name: "Annuler le bon…" }));
    const dialog = await screen.findByRole("dialog", { name: "Annuler le bon C-2611-007" });
    await user.click(within(dialog).getByRole("button", { name: "Garder le bon" }));
    expect(statusWrites.calls).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Annuler le bon…" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Annuler le bon" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(statusWrites.calls).toEqual([{ table: "purchase_orders", values: { status: "canceled" }, column: "id", value: ORDER }]);
  });

  it("names the refusal of a cancellation in its dialog", async () => {
    statusWrites.calls = [];
    statusWrites.error = { message: "new row violates row-level security policy" };
    const user = userEvent.setup();
    render(<OrderLifecycle {...props({ status: "sent" })} />);
    await user.click(screen.getByRole("button", { name: "Annuler le bon…" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Annuler le bon" }));
    expect(await within(dialog).findByRole("alert")).toBeInTheDocument();
    statusWrites.error = null;
  });

  it("returns a sent order to draft, and reopens a canceled one", async () => {
    statusWrites.calls = [];
    const user = userEvent.setup();
    const { unmount } = render(<OrderLifecycle {...props({ status: "sent" })} />);
    await user.click(screen.getByRole("button", { name: "Remettre en brouillon" }));
    await waitFor(() => expect(statusWrites.calls).toHaveLength(1));
    unmount();
    render(<OrderLifecycle {...props({ status: "canceled" })} />);
    expect(screen.getByRole("heading", { name: "Bon annulé" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Annuler le bon…" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Rouvrir en brouillon" }));
    await waitFor(() => expect(statusWrites.calls).toHaveLength(2));
    expect(statusWrites.calls.map((call) => (call as { values: unknown }).values)).toEqual([{ status: "draft" }, { status: "draft" }]);
  });

  it("offers a confirmed order no direct status change, only its reception, and says how it was ordered", () => {
    render(<OrderLifecycle {...props({
      status: "confirmed", orderDate: "2026-11-12", expectedDeliveryDate: "2026-11-19",
      confirmation: { documentId: JOINED, documentName: "AR Alpha", supplierReference: "AR-4471" },
    })} />);
    expect(screen.queryByLabelText("Statut de la commande")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Confirmer la commande…" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer la réception…" })).toBeEnabled();
    expect(screen.getByText("Commandée le 12/11/2026 · référence du fournisseur AR-4471 · preuve : AR Alpha")).toBeInTheDocument();
  });

  it("records the reception of the whole order, today by default, with its note", async () => {
    respond(() => ({ status: 200, body: { ok: true, data: { id: ORDER, status: "received", edit_revision: 8 } } }));
    const user = userEvent.setup();
    render(<OrderLifecycle {...props({
      status: "confirmed", editRevision: 7, orderDate: "2026-11-12",
      confirmation: { documentId: JOINED, documentName: "AR Alpha", supplierReference: null },
    })} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer la réception…" }));
    const dialog = await screen.findByRole("dialog", { name: "Réception de C-2611-007" });
    expect(within(dialog).getByLabelText("Date de réception")).toHaveValue("2026-11-13");
    await user.type(within(dialog).getByLabelText("Reste à venir (facultatif)"), "Reliquat : 500 vis à suivre");
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer la réception" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(calls).toEqual([{
      url: `/api/purchase-orders/${ORDER}/reception`, method: "POST",
      body: { expected_revision: 7, received_on: "2026-11-13", note: "Reliquat : 500 vis à suivre" },
    }]);
  });

  it("shows the server's sentence when a reception is refused", async () => {
    respond(() => ({ status: 422, body: { ok: false, error: { code: "PURCHASE_ORDER_RECEPTION_DATE_INVALID", message: "La réception se date entre le jour de la commande et aujourd’hui." } } }));
    const user = userEvent.setup();
    render(<OrderLifecycle {...props({ status: "confirmed", confirmation: { documentId: JOINED, documentName: "AR Alpha", supplierReference: null } })} />);
    await user.click(screen.getByRole("button", { name: "Enregistrer la réception…" }));
    const dialog = await screen.findByRole("dialog", { name: "Réception de C-2611-007" });
    await user.click(within(dialog).getByRole("button", { name: "Enregistrer la réception" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("La réception se date entre le jour de la commande et aujourd’hui.");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says when and how a received order came, and offers nothing more", () => {
    render(<OrderLifecycle {...props({
      status: "received", orderDate: "2026-11-12",
      confirmation: { documentId: JOINED, documentName: "AR Alpha", supplierReference: null },
      reception: { receivedOn: "2026-11-13", note: "Reliquat : 500 vis à suivre" },
    })} />);
    expect(screen.getByText("Reçue le 13/11/2026 · reste à venir : Reliquat : 500 vis à suivre")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Enregistrer la réception/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Statut de la commande")).not.toBeInTheDocument();
  });
});
