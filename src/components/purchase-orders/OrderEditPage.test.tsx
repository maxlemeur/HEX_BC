import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatEUR } from "@/lib/money";

/** The amount as the page writes it, spaces as the queries read them (no-break spaces normalised). */
const euros = (cents: number) => formatEUR(cents).replace(/\s/g, " ");

/**
 * Failure modes of the purchase order editor, written before it changed (TI-691, lot 2 « l'achat », delivery 3a). A
 * draft made from a material request has no site, prices from the retained quote (some for a lot) and request links;
 * the office adds the supplier's shipping or a discount. Each of these would order at another price or lose a line:
 *  1. the draft cannot be saved without a site, or a site choice replaces its delivery mode;
 *  2. a request line's price can be changed, or its total multiplies the price for 100 by the quantity;
 *  3. a « Port » or « Remise » line cannot be added, or asks for a unit and a quantity, or a discount is added to
 *     the total instead of subtracted;
 *  4. a save drops what the request line carries (its id is not sent back, its price changes), or sends a shipping
 *     line as an article, or without the unit every stored line has (one lump sum, « forfait »);
 *  5. an existing order (from an estimate, with a site) offers port and remise, or saves another payload than before.
 */

const ORDER_ID = "0b0b0b0b-0b0b-40b0-80b0-0b0b0b0b0b0b";
const ITEM_ID = "1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c";
const SUPPLIER_ID = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const SITE_ID = "5e5e5e5e-5e5e-45e5-85e5-5e5e5e5e5e5e";
const LINE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";

const { push, rows } = vi.hoisted(() => ({
  push: vi.fn(),
  rows: { order: null as unknown },
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: ORDER_ID }),
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/UserContext", () => ({
  useUserContext: () => ({ profile: { full_name: "Camille Martin", job_title: "Acheteuse", phone: null, work_email: null } }),
}));
vi.mock("@/lib/purchase-orders", () => ({ assertCompletePurchaseOrderSnapshot: vi.fn(async () => undefined) }));
vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    from: (table: string) => {
      const answer = () =>
        table === "purchase_orders"
          ? { data: rows.order, error: null }
          : table === "suppliers"
            ? { data: [{ id: SUPPLIER_ID, name: "Comptoir Bêta", address: null, postal_code: null, city: null, contact_name: null, phone: null, email: null }], error: null }
            : { data: [{ id: SITE_ID, name: "Chantier Les Acacias", project_code: "AC-12", address: "8 rue des Acacias", postal_code: "38000", city: "Grenoble", contact_name: null, contact_phone: null }], error: null };
      const query = {
        select: () => query,
        eq: () => query,
        order: async () => answer(),
        single: async () => answer(),
      };
      return query;
    },
  }),
}));

import EditOrderPage from "@/app/dashboard/orders/[id]/edit/page";

type Item = Record<string, unknown>;

function estimateItem(partial: Item = {}): Item {
  return {
    id: ITEM_ID,
    product_id: null,
    reference: "CD-50",
    source_estimate_item_id: "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1",
    source_selected_supplier_price_id: null,
    is_source_linked: true,
    designation: "Coude 90° inox DN 50",
    quantity: 20,
    unit: "u",
    price_unit: "u",
    unit_price_ht_cents: 1150,
    tax_rate_bp: 2000,
    position: 0,
    line_kind: "article",
    price_per: 1,
    imputation: "project",
    overhead_category: null,
    material_request_line_id: null,
    material_request_lines: null,
    ...partial,
  };
}

function order(partial: Item = {}): Item {
  return {
    id: ORDER_ID,
    reference: "C-2026-0042",
    order_date: "2026-11-12",
    expected_delivery_date: null,
    notes: null,
    supplier_id: SUPPLIER_ID,
    delivery_site_id: SITE_ID,
    status: "draft",
    source_estimate_version_id: "e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0",
    edit_revision: 3,
    project_id: null,
    delivery_mode: null,
    estimate_projects: null,
    purchase_order_items: [estimateItem()],
    ...partial,
  };
}

/** A draft made from a request: the screws quoted 3,42 € the hundred, delivered at the counter. */
const FROM_REQUEST = order({
  delivery_site_id: null,
  source_estimate_version_id: null,
  project_id: PROJECT_ID,
  delivery_mode: "counter",
  estimate_projects: { name: "Résidence des Tilleuls", site_address: null },
  purchase_order_items: [
    estimateItem({
      reference: null,
      source_estimate_item_id: null,
      is_source_linked: false,
      designation: "Vis tête hexagonale M10",
      quantity: 125,
      unit_price_ht_cents: 342,
      price_per: 100,
      material_request_line_id: LINE_ID,
      material_request_lines: { position: 2, request_id: REQUEST_ID, material_requests: { project_id: PROJECT_ID, requested_on: "2026-11-12" } },
    }),
  ],
});

let saved: unknown[] = [];

function mockSave() {
  saved = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) !== `/api/purchase-orders/${ORDER_ID}` || init?.method !== "PUT") throw new Error(`Appel inattendu : ${String(input)}`);
      saved.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }),
  );
}

async function openEditor(stored: Item) {
  rows.order = stored;
  mockSave();
  const user = userEvent.setup();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EditOrderPage />
    </SWRConfig>,
  );
  await screen.findByRole("form", { name: "Modifier le bon de commande C-2026-0042" });
  return user;
}

function totalHt(): string {
  const label = screen.getAllByText("Total HT").find((element) => element.tagName === "SPAN") as HTMLElement;
  return (label.parentElement?.lastElementChild?.textContent ?? "").replace(/\s/g, " ");
}

describe("purchase order editor", () => {
  beforeEach(() => push.mockReset());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a request line as quoted, adds a port and a remise, and saves without a site (1, 2, 3, 4)", async () => {
    const user = await openEditor(FROM_REQUEST);

    // Delivered at the counter: no site to choose.
    expect(screen.getByText("Retrait au comptoir")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "Chantier de livraison" })).not.toBeInTheDocument();
    // The screws keep the retained quote's price for 100; 125 × 3,42 € ÷ 100 = 4,275 €, half away from zero.
    expect(screen.queryByRole("textbox", { name: "Prix unitaire HT, ligne 1" })).not.toBeInTheDocument();
    const screws = screen.getByRole("textbox", { name: "Désignation, ligne 1" }).closest("tr") as HTMLElement;
    expect(within(screws).getByText(`${euros(342)} les 100`)).toBeVisible();
    expect(within(screws).getByText(euros(428))).toBeVisible();
    expect(within(screws).getByRole("link", { name: "Demande du 12/11, ligne 2" })).toHaveAttribute(
      "href",
      `/dashboard/affaires/${PROJECT_ID}/demandes-materiel/${REQUEST_ID}`,
    );
    expect(totalHt()).toBe(euros(428));

    await user.click(screen.getByRole("button", { name: "+ Ajouter un port" }));
    const shipping = screen.getByRole("textbox", { name: "Désignation, ligne 2" }).closest("tr") as HTMLElement;
    expect(within(shipping).getByText("Port")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Désignation, ligne 2" })).toHaveValue("Frais de port");
    // An amount, not an article: no quantity, no unit to type.
    expect(screen.queryByRole("textbox", { name: "Quantité, ligne 2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Unité, ligne 2" })).not.toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "Montant HT, ligne 2" }), "15");
    expect(totalHt()).toBe(euros(1928));

    await user.click(screen.getByRole("button", { name: "+ Ajouter une remise" }));
    expect(screen.getByRole("textbox", { name: "Désignation, ligne 3" })).toHaveValue("Remise");
    await user.type(screen.getByRole("textbox", { name: "Montant HT, ligne 3" }), "2,50");
    const discount = screen.getByRole("textbox", { name: "Désignation, ligne 3" }).closest("tr") as HTMLElement;
    expect(within(discount).getByText(euros(-250))).toBeVisible();
    expect(totalHt()).toBe(euros(1678));

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/orders/${ORDER_ID}`));
    expect(saved).toEqual([
      {
        expectedRevision: 3,
        supplierId: SUPPLIER_ID,
        expectedDeliveryDate: null,
        notes: null,
        items: [
          { id: ITEM_ID, productId: null, reference: null, designation: "Vis tête hexagonale M10", quantity: 125, unit: "u", taxRateBp: 2000, unitPriceCents: 342 },
          { productId: null, reference: null, designation: "Frais de port", quantity: 1, unit: "forfait", taxRateBp: 2000, unitPriceCents: 1500, lineKind: "shipping" },
          { productId: null, reference: null, designation: "Remise", quantity: 1, unit: "forfait", taxRateBp: 2000, unitPriceCents: 250, lineKind: "discount" },
        ],
      },
    ]);
  });

  it("refuses a port without its amount, and says so on its line (3)", async () => {
    const user = await openEditor(FROM_REQUEST);

    await user.click(screen.getByRole("button", { name: "+ Ajouter un port" }));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    // On its line, and beside the disabled button.
    expect(screen.getAllByText("Ligne 2 : renseignez le montant HT.")).toHaveLength(2);
    expect(saved).toEqual([]);
  });

  it("edits an existing order from an estimate as before: a site, no port, the same payload (5)", async () => {
    const user = await openEditor(order());

    expect(screen.getByRole("combobox", { name: "Chantier de livraison" })).toHaveValue(SITE_ID);
    expect(screen.queryByRole("button", { name: "+ Ajouter un port" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Ajouter une remise" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Prix unitaire HT, ligne 1" })).toHaveValue("11,50");
    expect(screen.queryByText(/Demande du|Affaire|Frais généraux|Retrait au comptoir/)).not.toBeInTheDocument();

    await user.clear(screen.getByRole("textbox", { name: "Quantité, ligne 1" }));
    await user.type(screen.getByRole("textbox", { name: "Quantité, ligne 1" }), "21");
    expect(totalHt()).toBe(euros(24150));
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/dashboard/orders/${ORDER_ID}`));
    expect(saved).toEqual([
      {
        expectedRevision: 3,
        supplierId: SUPPLIER_ID,
        deliverySiteId: SITE_ID,
        expectedDeliveryDate: null,
        notes: null,
        items: [
          { id: ITEM_ID, productId: null, reference: "CD-50", designation: "Coude 90° inox DN 50", quantity: 21, unit: "u", taxRateBp: 2000, unitPriceCents: 1150 },
        ],
      },
    ]);
  });
});
