import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductFormModal, type ProductRecord } from "@/components/products/ProductFormModal";

/**
 * Failure modes guarded here (sale packagings of an article, « conditionnements de vente »): the office records
 * how an article is sold (a bar of 6 m, a reel of 100 m) with a label and a quantity in the article's unit.
 *  1. the packagings are not shown with the unit they are expressed in, so « 6 » reads as six of anything;
 *  2. a member who may not change the article is shown controls the server will refuse;
 *  3. a French decimal (« 2,5 ») is sent as something else, or a quantity of zero, a word, or the same packaging
 *     twice reaches the server;
 *  4. marking a packaging usual leaves the former one marked on screen, or the screen disagrees with the server;
 *  5. a removal the server refused is shown as done, or one it did is still listed;
 *  6. the article's unit is changed in the form while it has packagings and nothing says the server will refuse
 *     it (their quantities are in the current unit); a packaging is added while a unit change is not saved yet;
 *     a draft without a unit offers to add packagings;
 *  7. a new article (nothing stored yet) asks the server for packagings it cannot have;
 *  8. a list that could not be read is shown as « no packaging ».
 */

const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BAR = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const REEL = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const COIL = "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3";
const URL = `/api/products/${PRODUCT_ID}/packagings`;

const PRODUCT: ProductRecord = {
  id: PRODUCT_ID,
  created_at: "2026-11-10T08:00:00.000Z",
  reference: "TUB-40",
  designation: "Tube DN40 48,3x2 fictif",
  product_type: "Tube",
  material: "Inox 304L",
  unit: "ml",
  unit_price_cents: 0,
  is_active: true,
  catalogue_status: "validated",
  supply_type_id: null,
};

type Packaging = { id: string; label: string; quantity: number; is_usual: boolean; unit: string };
type Reply = { status: number; body: unknown };
let routes: Record<string, Reply | Reply[]> = {};
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const key = `${init?.method ?? "GET"} ${input}`;
  const entry = routes[key];
  const reply = (Array.isArray(entry) ? entry.shift() : entry) ?? {
    status: 404,
    body: { ok: false, error: { code: "NOT_FOUND", message: "Introuvable." } },
  };
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
});

function answer(items: Packaging[], canEdit = true, status = 200): Reply {
  return { status, body: { ok: true, data: { items, can_edit: canEdit } } };
}

const bar: Packaging = { id: BAR, label: "Barre", quantity: 6, is_usual: true, unit: "ml" };
const reel: Packaging = { id: REEL, label: "Touret", quantity: 100, is_usual: false, unit: "ml" };

function renderForm(product: ProductRecord | null = PRODUCT) {
  render(
    <ProductFormModal
      open
      product={product}
      isSaving={false}
      error={null}
      supplyTypes={[]}
      onOpenChange={vi.fn()}
      onSubmit={vi.fn()}
    />,
  );
}

function sentBodies(method: string) {
  return fetchMock.mock.calls
    .filter(([url, init]) => String(url).startsWith(URL) && init?.method === method)
    .map(([url, init]) => ({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined }));
}

async function section() {
  return screen.findByRole("region", { name: "Conditionnements de vente" });
}

describe("ProductFormModal, sale packagings", () => {
  beforeEach(() => {
    routes = {};
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows each packaging with the article's unit, the usual one marked, and what the quantity means (1)", async () => {
    routes = { [`GET ${URL}`]: answer([bar, reel]) };
    renderForm();

    const region = await section();
    const list = await within(region).findByRole("list", { name: "Conditionnements de l’article" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByRole("combobox", { name: "Conditionnement" })).toHaveValue("Barre");
    expect(within(rows[0]).getByRole("textbox", { name: "Quantité en ml" })).toHaveValue("6");
    expect(within(rows[0]).getByRole("checkbox", { name: "Usuel" })).toBeChecked();
    expect(within(rows[1]).getByRole("textbox", { name: "Quantité en ml" })).toHaveValue("100");
    expect(within(rows[1]).getByRole("checkbox", { name: "Usuel" })).not.toBeChecked();
    expect(within(region).getByText(/Quantité d’unités de l’article dans un conditionnement/)).toBeVisible();
  });

  it("shows the list without any control to a member who may not change the article (2)", async () => {
    routes = { [`GET ${URL}`]: answer([bar, reel], false) };
    renderForm();

    const region = await section();
    const list = await within(region).findByRole("list", { name: "Conditionnements de l’article" });
    expect(within(list).getByText("Barre de 6 ml")).toBeVisible();
    expect(within(list).getByText("Touret de 100 ml")).toBeVisible();
    expect(within(list).getByText("usuel")).toBeVisible();
    expect(within(region).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(region).queryByRole("combobox")).not.toBeInTheDocument();
    expect(within(region).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(within(region).queryByRole("button")).not.toBeInTheDocument();
  });

  it("adds two packagings, the second marked usual, sending French decimals as numbers (3, 4)", async () => {
    const user = userEvent.setup({ delay: null });
    const coil: Packaging = { id: COIL, label: "Couronne", quantity: 2.5, is_usual: false, unit: "ml" };
    routes = {
      [`GET ${URL}`]: answer([]),
      [`POST ${URL}`]: [
        answer([coil], true, 201),
        answer([coil, { ...bar, id: REEL, label: "Barre" }], true, 201),
      ],
    };
    renderForm();

    const region = await section();
    expect(await within(region).findByText("Aucun conditionnement renseigné.")).toBeVisible();

    await user.click(within(region).getByRole("button", { name: "Ajouter un conditionnement" }));
    await user.type(within(region).getByRole("combobox", { name: "Nouveau conditionnement" }), "Couronne");
    await user.type(within(region).getByRole("textbox", { name: "Quantité du nouveau conditionnement en ml" }), "2,5");
    await user.click(within(region).getByRole("button", { name: "Ajouter ce conditionnement" }));
    await within(region).findByDisplayValue("Couronne");

    await user.click(within(region).getByRole("button", { name: "Ajouter un conditionnement" }));
    await user.type(within(region).getByRole("combobox", { name: "Nouveau conditionnement" }), "Barre");
    await user.type(within(region).getByRole("textbox", { name: "Quantité du nouveau conditionnement en ml" }), "6");
    await user.click(within(region).getByRole("checkbox", { name: "Conditionnement usuel" }));
    await user.click(within(region).getByRole("button", { name: "Ajouter ce conditionnement" }));

    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(2));
    expect(sentBodies("POST").map((call) => call.body)).toEqual([
      { label: "Couronne", quantity: 2.5, is_usual: false },
      { label: "Barre", quantity: 6, is_usual: true },
    ]);
    const rows = within(region).getAllByRole("listitem");
    expect(within(rows[1]).getByRole("checkbox", { name: "Usuel" })).toBeChecked();
  });

  it.each([
    ["a quantity of zero", "Barre", "0", "La quantité doit être un nombre supérieur à zéro, avec trois décimales au plus."],
    ["a word as quantity", "Barre", "six", "La quantité doit être un nombre supérieur à zéro, avec trois décimales au plus."],
    ["an empty label", "   ", "6", "Renseignez le conditionnement (par exemple « Barre »)."],
    ["the same packaging folded for case", "BARRE", "6,000", "Ce conditionnement existe déjà pour cet article."],
  ])("refuses %s without asking the server (3)", async (_label, label, quantity, message) => {
    const user = userEvent.setup({ delay: null });
    routes = { [`GET ${URL}`]: answer([bar]) };
    renderForm();

    const region = await section();
    await within(region).findByDisplayValue("Barre");
    await user.click(within(region).getByRole("button", { name: "Ajouter un conditionnement" }));
    await user.type(within(region).getByRole("combobox", { name: "Nouveau conditionnement" }), label);
    await user.type(within(region).getByRole("textbox", { name: "Quantité du nouveau conditionnement en ml" }), quantity);
    await user.click(within(region).getByRole("button", { name: "Ajouter ce conditionnement" }));

    expect(await within(region).findByText(message)).toBeVisible();
    expect(sentBodies("POST")).toEqual([]);
  });

  it("marking another packaging usual moves the mark as the server answers (4)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${URL}`]: answer([bar, reel]),
      [`PATCH ${URL}/${REEL}`]: answer([{ ...bar, is_usual: false }, { ...reel, is_usual: true }]),
    };
    renderForm();

    const region = await section();
    await within(region).findByDisplayValue("Touret");
    const rows = within(region).getAllByRole("listitem");
    await user.click(within(rows[1]).getByRole("checkbox", { name: "Usuel" }));

    await waitFor(() => expect(within(rows[0]).getByRole("checkbox", { name: "Usuel" })).not.toBeChecked());
    expect(within(rows[1]).getByRole("checkbox", { name: "Usuel" })).toBeChecked();
    expect(sentBodies("PATCH")).toEqual([{ url: `${URL}/${REEL}`, body: { is_usual: true } }]);
  });

  it("saves a changed quantity of a packaging (3)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${URL}`]: answer([bar, reel]),
      [`PATCH ${URL}/${BAR}`]: answer([{ ...bar, quantity: 3 }, reel]),
    };
    renderForm();

    const region = await section();
    await within(region).findByDisplayValue("Touret");
    const rows = within(region).getAllByRole("listitem");
    const quantity = within(rows[0]).getByRole("textbox", { name: "Quantité en ml" });
    await user.clear(quantity);
    await user.type(quantity, "3");
    await user.click(within(rows[0]).getByRole("button", { name: "Enregistrer Barre" }));

    await waitFor(() => expect(sentBodies("PATCH")).toEqual([{ url: `${URL}/${BAR}`, body: { label: "Barre", quantity: 3 } }]));
    expect(await within(region).findByText("Conditionnement enregistré.")).toBeVisible();
  });

  it("removes a packaging once the server has, and keeps it with the server's sentence when refused (5)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${URL}`]: answer([bar, reel]),
      [`DELETE ${URL}/${BAR}`]: {
        status: 403,
        body: { ok: false, error: { code: "FORBIDDEN", message: "Cet article fait partie de la base commune." } },
      },
      [`DELETE ${URL}/${REEL}`]: answer([bar]),
    };
    renderForm();

    const region = await section();
    await within(region).findByDisplayValue("Touret");
    await user.click(within(region).getByRole("button", { name: "Retirer le conditionnement Barre de 6 ml" }));
    expect(await within(region).findByText("Cet article fait partie de la base commune.")).toBeVisible();
    expect(within(region).getAllByRole("listitem")).toHaveLength(2);

    await user.click(within(region).getByRole("button", { name: "Retirer le conditionnement Touret de 100 ml" }));
    await waitFor(() => expect(within(region).getAllByRole("listitem")).toHaveLength(1));
    expect(within(region).queryByDisplayValue("Touret")).not.toBeInTheDocument();
  });

  it("says to remove the packagings before changing the unit, which their quantities keep (6)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = { [`GET ${URL}`]: answer([bar]) };
    renderForm();

    const region = await section();
    await within(region).findByDisplayValue("Barre");
    expect(within(region).queryByText(/avant de changer l’unité/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Unité"), "kg");

    expect(
      within(region).getByText(
        "Retirez les conditionnements de vente avant de changer l’unité de l’article : leurs quantités sont exprimées en ml.",
      ),
    ).toBeVisible();
    expect(within(region).getByRole("textbox", { name: "Quantité en ml" })).toHaveValue("6");
    expect(within(region).queryByRole("button", { name: "Ajouter un conditionnement" })).not.toBeInTheDocument();
  });

  it("adds no packaging while a change of unit is not saved (6)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = { [`GET ${URL}`]: answer([]) };
    renderForm();

    const region = await section();
    await within(region).findByText("Aucun conditionnement renseigné.");
    await user.selectOptions(screen.getByLabelText("Unité"), "kg");

    expect(
      within(region).getByText("Enregistrez d’abord la nouvelle unité de l’article pour lui ajouter des conditionnements de vente."),
    ).toBeVisible();
    expect(within(region).queryByRole("button", { name: "Ajouter un conditionnement" })).not.toBeInTheDocument();
  });

  it("offers no packaging to a draft without a unit, and says why (6)", async () => {
    routes = { [`GET ${URL}`]: answer([]) };
    renderForm({ ...PRODUCT, unit: "", catalogue_status: "draft" });

    const region = await section();
    expect(
      await within(region).findByText("Renseignez et enregistrez l’unité de l’article avant d’ajouter ses conditionnements de vente."),
    ).toBeVisible();
    expect(within(region).queryByRole("button", { name: "Ajouter un conditionnement" })).not.toBeInTheDocument();
  });

  it("asks nothing for an article being created (7)", () => {
    renderForm(null);

    expect(screen.queryByRole("region", { name: "Conditionnements de vente" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/packagings"))).toBe(false);
  });

  it("says the list could not be read instead of showing it empty (8)", async () => {
    routes = { [`GET ${URL}`]: { status: 500, body: { ok: false, error: { code: "INTERNAL", message: "Erreur." } } } };
    renderForm();

    const region = await section();
    expect(await within(region).findByText("Les conditionnements n’ont pas pu être chargés.")).toBeVisible();
    expect(within(region).queryByText("Aucun conditionnement renseigné.")).not.toBeInTheDocument();
  });
});
