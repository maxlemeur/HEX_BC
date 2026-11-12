import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductFormModal, type ProductRecord } from "@/app/dashboard/products/ProductFormModal";

/**
 * Failure modes guarded here (TI-691, lot 2, delivery 1, « Fournisseurs de l'article »): the office records
 * at which suppliers an article is bought and its reference there; request lines are then proposed the
 * article's exception before its supply type's supplier.
 *  1. the office cannot see the article's suppliers, their reference, their link, or which ones carry a
 *     price; a withdrawn supplier is still listed;
 *  2. adding a supplier sends a price, another supplier or reference than the one typed, is not listed once
 *     saved, or Enter in its fields submits the whole article form;
 *  3. changing a reference does not send the link shown beside it, or the other way round;
 *  4. withdrawing deletes the supplier or touches its reference, leaves it listed although the server
 *     withdrew it, or removes it although the server refused;
 *  5. the article's preferred supplier is not shown as the server holds it, is not saved, is chosen among
 *     suppliers that are not the article's, or cannot be set back to none;
 *  6. a refusal is silent, or throws away what was typed;
 *  7. a new article asks the server for suppliers it cannot have; a list that could not be read is shown
 *     as « no supplier »;
 *  8. withdrawing the supplier the article names as its exception leaves the exception on screen although
 *     the server cleared it;
 *  9. the preferred supplier's select disables itself while it saves (on Windows each arrow key is a change:
 *     the first one saves and the disabled select drops the keyboard focus), or an earlier answer overrides
 *     the last choice.
 * (8 and 9: independent review of delivery 1.)
 */

const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALPHA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BETA = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const GAMMA = "f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3";
const ITEMS_URL = `/api/products/${PRODUCT_ID}/supplier-items`;
const PREFERRED_URL = `/api/products/${PRODUCT_ID}/preferred-supplier`;

const PRODUCT: ProductRecord = {
  id: PRODUCT_ID,
  created_at: "2026-11-12T08:00:00.000Z",
  reference: "CD-I316-50",
  designation: "Coude 90° inox 316L DN 50",
  product_type: "Coude 90°",
  material: "Inox 316L",
  unit: "u",
  unit_price_cents: 0,
  is_active: true,
  catalogue_status: "validated",
  supply_type_id: null,
};

const ITEM_ALPHA = {
  id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
  supplier_id: ALPHA,
  supplier_name: "Négoce Alpha",
  supplier_sku: "NA-4471",
  product_url: "https://fournisseur.example/na-4471",
  is_active: true,
  has_price: true,
};
const ITEM_BETA = {
  id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
  supplier_id: BETA,
  supplier_name: "Comptoir Bêta",
  supplier_sku: "CB-90-50",
  product_url: null,
  is_active: true,
  has_price: false,
};
const ITEM_GAMMA_WITHDRAWN = {
  id: "c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3",
  supplier_id: GAMMA,
  supplier_name: "Dépôt Gamma",
  supplier_sku: "DG-1",
  product_url: null,
  is_active: false,
  has_price: false,
};

type Reply = { status: number; body: unknown };
type Route = Reply | ((body: unknown) => Reply | Promise<Reply>);
let routes: Record<string, Route> = {};
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const route = routes[`${init?.method ?? "GET"} ${input}`];
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
  const reply = route === undefined
    ? { status: 404, body: { ok: false, error: { code: "NOT_FOUND", message: "Introuvable." } } }
    : typeof route === "function" ? await route(body) : route;
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
});

const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });
const refused = (message: string): Reply => ({ status: 403, body: { ok: false, error: { code: "FORBIDDEN", message } } });

function writes() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== "GET")
    .map(([url, init]) => ({ method: init?.method, url, body: JSON.parse(String(init?.body)) as unknown }));
}

function renderForm(product: ProductRecord | null = PRODUCT) {
  const onSubmit = vi.fn();
  render(
    <ProductFormModal
      open
      product={product}
      isSaving={false}
      error={null}
      supplyTypes={[]}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe("ProductFormModal, suppliers of the article", () => {
  beforeEach(() => {
    routes = {};
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the article's suppliers with their reference, link and price mark, without the withdrawn ones (1)", async () => {
    routes = { [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA, ITEM_BETA, ITEM_GAMMA_WITHDRAWN], preferred_supplier_id: null }) };
    renderForm();

    const list = await screen.findByRole("list", { name: "Fournisseurs de l’article" });
    const entries = within(list).getAllByRole("listitem");
    expect(entries).toHaveLength(2);
    expect(within(entries[0]).getByText("Négoce Alpha")).toBeVisible();
    expect(within(entries[0]).getByText("Réf. NA-4471")).toBeVisible();
    expect(within(entries[0]).getByText("avec prix")).toBeVisible();
    expect(within(entries[0]).getByRole("link", { name: "Fiche chez Négoce Alpha" })).toHaveAttribute(
      "href",
      "https://fournisseur.example/na-4471",
    );
    expect(within(entries[1]).getByText("Comptoir Bêta")).toBeVisible();
    expect(within(entries[1]).queryByText("avec prix")).not.toBeInTheDocument();
    expect(within(list).queryByText("Dépôt Gamma")).not.toBeInTheDocument();
  });

  it("adds a supplier and its reference without a price; Enter adds it and never submits the article (2)", async () => {
    const user = userEvent.setup({ delay: null });
    const added = { ...ITEM_GAMMA_WITHDRAWN, supplier_sku: "DG-50", is_active: true };
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_BETA, ITEM_GAMMA_WITHDRAWN], preferred_supplier_id: null }),
      "GET /api/suppliers": ok({ items: [{ id: ALPHA, name: "Négoce Alpha" }, { id: BETA, name: "Comptoir Bêta" }, { id: GAMMA, name: "Dépôt Gamma" }] }),
      [`PUT ${ITEMS_URL}`]: ok({ item: added, preferred_supplier_id: null }),
    };
    const { onSubmit } = renderForm();

    await user.click(await screen.findByRole("button", { name: "Ajouter un fournisseur" }));
    const supplier = await screen.findByLabelText("Fournisseur à ajouter");
    await within(supplier).findByRole("option", { name: "Dépôt Gamma" });
    // Already a supplier of the article: not offered again.
    expect(within(supplier).queryByRole("option", { name: "Comptoir Bêta" })).not.toBeInTheDocument();
    await user.selectOptions(supplier, GAMMA);
    await user.type(screen.getByLabelText("Référence chez ce fournisseur"), " DG-50 {Enter}");

    const list = await screen.findByRole("list", { name: "Fournisseurs de l’article" });
    await waitFor(() => expect(within(list).getByText("Dépôt Gamma")).toBeVisible());
    expect(within(list).getByText("Réf. DG-50")).toBeVisible();
    expect(writes()).toEqual([
      { method: "PUT", url: ITEMS_URL, body: { supplier_id: GAMMA, supplier_sku: "DG-50", product_url: null, is_active: true } },
    ]);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Fournisseur à ajouter")).not.toBeInTheDocument();
  });

  it("keeps what was typed and shows the server's sentence when the addition is refused (2, 6)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [], preferred_supplier_id: null }),
      "GET /api/suppliers": ok({ items: [{ id: GAMMA, name: "Dépôt Gamma" }] }),
      [`PUT ${ITEMS_URL}`]: refused("La gestion du catalogue est réservée aux administrateurs."),
    };
    renderForm();

    expect(await screen.findByText("Aucun fournisseur pour cet article.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Ajouter un fournisseur" }));
    const supplier = await screen.findByLabelText("Fournisseur à ajouter");
    await within(supplier).findByRole("option", { name: "Dépôt Gamma" });
    await user.selectOptions(supplier, GAMMA);
    await user.type(screen.getByLabelText("Référence chez ce fournisseur"), "DG-50");
    await user.click(screen.getByRole("button", { name: "Ajouter ce fournisseur" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("La gestion du catalogue est réservée aux administrateurs.");
    expect(screen.getByLabelText("Fournisseur à ajouter")).toHaveValue(GAMMA);
    expect(screen.getByLabelText("Référence chez ce fournisseur")).toHaveValue("DG-50");
    expect(screen.getByText("Aucun fournisseur pour cet article.")).toBeVisible();
  });

  it("changes a reference and sends the link with it (3)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA], preferred_supplier_id: null }),
      [`PUT ${ITEMS_URL}`]: (body) => ok({ item: { ...ITEM_ALPHA, ...(body as object) }, preferred_supplier_id: null }),
    };
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Modifier Négoce Alpha" }));
    const reference = screen.getByLabelText("Référence chez Négoce Alpha");
    expect(screen.getByLabelText("Lien chez Négoce Alpha (facultatif)")).toHaveValue("https://fournisseur.example/na-4471");
    await user.clear(reference);
    await user.type(reference, "NA-4472");
    await user.click(screen.getByRole("button", { name: "Enregistrer la référence" }));

    expect(await screen.findByText("Réf. NA-4472")).toBeVisible();
    expect(writes()).toEqual([
      {
        method: "PUT",
        url: ITEMS_URL,
        body: { supplier_id: ALPHA, supplier_sku: "NA-4472", product_url: "https://fournisseur.example/na-4471", is_active: true },
      },
    ]);
  });

  it("withdraws a supplier without touching its reference, once the server has withdrawn it (4)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA, ITEM_BETA], preferred_supplier_id: ALPHA }),
      [`PUT ${ITEMS_URL}`]: ok({ item: { ...ITEM_BETA, is_active: false }, preferred_supplier_id: ALPHA }),
    };
    renderForm();

    const withdraw = await screen.findByRole("button", { name: "Retirer Comptoir Bêta de l’article" });
    expect(withdraw).toHaveAccessibleDescription(
      "Les prix de ce fournisseur restent enregistrés mais ne sont plus proposés tant qu’il est retiré de l’article.",
    );
    await user.click(withdraw);

    const list = screen.getByRole("list", { name: "Fournisseurs de l’article" });
    await waitFor(() => expect(within(list).queryByText("Comptoir Bêta")).not.toBeInTheDocument());
    expect(within(list).getByText("Négoce Alpha")).toBeVisible();
    // A key left out keeps what is stored: the reference stays with the withdrawn supplier.
    expect(writes()).toEqual([{ method: "PUT", url: ITEMS_URL, body: { supplier_id: BETA, is_active: false } }]);
    expect(screen.getByLabelText("Fournisseur privilégié pour cet article")).toHaveValue(ALPHA);
  });

  it("shows the exception cleared once its supplier is withdrawn from the article (8)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA, ITEM_BETA], preferred_supplier_id: BETA }),
      [`PUT ${ITEMS_URL}`]: ok({ item: { ...ITEM_BETA, is_active: false }, preferred_supplier_id: null }),
    };
    renderForm();

    const preferred = await screen.findByLabelText("Fournisseur privilégié pour cet article");
    await waitFor(() => expect(preferred).toHaveValue(BETA));
    await user.click(screen.getByRole("button", { name: "Retirer Comptoir Bêta de l’article" }));

    await waitFor(() => expect(preferred).toHaveValue(""));
    expect(preferred).toHaveDisplayValue("Aucun : celui du type de fourniture");
    expect(screen.queryByText("privilégié")).not.toBeInTheDocument();
    expect(within(preferred).queryByRole("option", { name: "Fournisseur retiré de l’article" })).not.toBeInTheDocument();
  });

  it("keeps a supplier listed and says why when its withdrawal is refused (4, 6)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_BETA], preferred_supplier_id: null }),
      [`PUT ${ITEMS_URL}`]: refused("La gestion du catalogue est réservée aux administrateurs."),
    };
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Retirer Comptoir Bêta de l’article" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("La gestion du catalogue est réservée aux administrateurs.");
    expect(within(screen.getByRole("list", { name: "Fournisseurs de l’article" })).getByText("Comptoir Bêta")).toBeVisible();
  });

  it("saves the article's preferred supplier among its suppliers, and none (5)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA, ITEM_BETA, ITEM_GAMMA_WITHDRAWN], preferred_supplier_id: ALPHA }),
      [`PATCH ${PREFERRED_URL}`]: (body) => ok({ preferred_supplier_id: (body as { preferred_supplier_id: string | null }).preferred_supplier_id }),
    };
    renderForm();

    const preferred = await screen.findByLabelText("Fournisseur privilégié pour cet article");
    await waitFor(() => expect(preferred).toHaveValue(ALPHA));
    expect(preferred).toHaveAccessibleDescription(expect.stringContaining("Proposé avant le fournisseur du type"));
    expect(within(preferred).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Aucun : celui du type de fourniture",
      "Négoce Alpha",
      "Comptoir Bêta",
    ]);

    await user.selectOptions(preferred, BETA);
    expect(await screen.findByText("Fournisseur privilégié enregistré.")).toBeVisible();
    await user.selectOptions(preferred, "");
    await waitFor(() => expect(writes()).toHaveLength(2));

    expect(writes()).toEqual([
      { method: "PATCH", url: PREFERRED_URL, body: { preferred_supplier_id: BETA } },
      { method: "PATCH", url: PREFERRED_URL, body: { preferred_supplier_id: null } },
    ]);
    expect(preferred).toHaveValue("");
  });

  it("goes back to the saved preferred supplier and says why when the choice is refused (5, 6)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA, ITEM_BETA], preferred_supplier_id: ALPHA }),
      [`PATCH ${PREFERRED_URL}`]: refused("La gestion du catalogue est réservée aux administrateurs."),
    };
    renderForm();

    const preferred = await screen.findByLabelText("Fournisseur privilégié pour cet article");
    await waitFor(() => expect(preferred).toHaveValue(ALPHA));
    await user.selectOptions(preferred, BETA);

    expect(await screen.findByRole("alert")).toHaveTextContent("La gestion du catalogue est réservée aux administrateurs.");
    expect(preferred).toHaveValue(ALPHA);
  });

  it("keeps the preferred select usable while it saves, one save after another, the last choice winning (9)", async () => {
    const user = userEvent.setup({ delay: null });
    const answers: Array<() => void> = [];
    routes = {
      [`GET ${ITEMS_URL}`]: ok({ items: [ITEM_ALPHA, ITEM_BETA], preferred_supplier_id: null }),
      [`PATCH ${PREFERRED_URL}`]: (body) =>
        new Promise<Reply>((resolve) => {
          answers.push(() => resolve(ok({ preferred_supplier_id: (body as { preferred_supplier_id: string | null }).preferred_supplier_id })));
        }),
    };
    renderForm();

    const preferred = await screen.findByLabelText("Fournisseur privilégié pour cet article");
    await waitFor(() => expect(within(preferred).getAllByRole("option")).toHaveLength(3));
    preferred.focus();
    // Arrow keys through the options: each one is a change.
    await user.selectOptions(preferred, ALPHA);
    expect(preferred).toBeEnabled();
    expect(preferred).toHaveFocus();
    await user.selectOptions(preferred, BETA);
    expect(preferred).toHaveValue(BETA);
    // The second save waits for the first answer: the server receives them in the order chosen.
    expect(writes()).toHaveLength(1);

    answers[0]();
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(preferred).toHaveValue(BETA);
    answers[1]();

    expect(await screen.findByText("Fournisseur privilégié enregistré.")).toBeVisible();
    expect(writes().map((call) => call.body)).toEqual([{ preferred_supplier_id: ALPHA }, { preferred_supplier_id: BETA }]);
    expect(preferred).toHaveValue(BETA);
    expect(preferred).toHaveFocus();
  });

  it("asks nothing for an article being created (7)", () => {
    renderForm(null);

    expect(screen.queryByRole("heading", { name: "Fournisseurs de l’article" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/supplier-items"))).toBe(false);
  });

  it("says the suppliers could not be read instead of showing none (7)", async () => {
    routes = {
      [`GET ${ITEMS_URL}`]: { status: 500, body: { ok: false, error: { code: "INTERNAL", message: "Erreur." } } },
    };
    renderForm();

    expect(await screen.findByText("Les fournisseurs de l’article n’ont pas pu être chargés.")).toBeVisible();
    expect(screen.queryByText("Aucun fournisseur pour cet article.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Fournisseur privilégié pour cet article")).not.toBeInTheDocument();
  });
});
