import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductFormModal, type ProductRecord } from "@/app/dashboard/products/ProductFormModal";

/**
 * Failure modes guarded here (TI-690, delivery 3, usual names of an article): each link of a request
 * line teaches the article the technician's words, and the matcher then proposes it by those words.
 *  1. the office cannot see which usual names an article answers to, so a wrong one keeps proposing it;
 *  2. removing a usual name removes another one, or leaves it listed although the server removed it, or
 *     lists it as removed although the server refused;
 *  3. a new article (nothing stored yet) asks the server for usual names it cannot have;
 *  4. a list that could not be read is shown as « no usual name ».
 */

const PRODUCT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALIAS_1 = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";
const ALIAS_2 = "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2";
const ALIASES_URL = `/api/products/${PRODUCT_ID}/aliases`;

const PRODUCT: ProductRecord = {
  id: PRODUCT_ID,
  created_at: "2026-11-10T08:00:00.000Z",
  reference: "GJ-M10",
  designation: "Goujon d’ancrage M10",
  product_type: "Goujon d’ancrage",
  material: "Acier zingué",
  unit: "u",
  unit_price_cents: 0,
  is_active: true,
  catalogue_status: "validated",
  supply_type_id: null,
};

type Reply = { status: number; body: unknown };
let routes: Record<string, Reply> = {};
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const reply = routes[`${init?.method ?? "GET"} ${input}`] ?? {
    status: 404,
    body: { ok: false, error: { code: "NOT_FOUND", message: "Introuvable." } },
  };
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { "Content-Type": "application/json" },
  });
});

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

const listed = {
  status: 200,
  body: {
    ok: true,
    data: {
      items: [
        { id: ALIAS_1, alias: "goujon", created_at: "2026-11-10T09:00:00.000Z" },
        { id: ALIAS_2, alias: "tige a frapper", created_at: "2026-11-10T09:05:00.000Z" },
      ],
    },
  },
};

describe("ProductFormModal, usual names", () => {
  beforeEach(() => {
    routes = {};
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("lists the usual names the office taught the article (1)", async () => {
    routes = { [`GET ${ALIASES_URL}`]: listed };
    renderForm();

    const list = await screen.findByRole("list", { name: "Noms usuels" });
    expect(within(list).getByText("goujon")).toBeVisible();
    expect(within(list).getByText("tige a frapper")).toBeVisible();
  });

  it("removes the chosen usual name once the server has removed it (2)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ALIASES_URL}`]: listed,
      [`DELETE ${ALIASES_URL}/${ALIAS_1}`]: { status: 200, body: { ok: true, data: { deleted: true } } },
    };
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Retirer le nom usuel « goujon »" }));

    await waitFor(() => expect(screen.queryByText("goujon")).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([url]) => url)).toEqual([
      `${ALIASES_URL}/${ALIAS_1}`,
    ]);
    expect(screen.getByText("tige a frapper")).toBeVisible();
  });

  it("keeps the usual name listed and shows the server's sentence when the removal is refused (2)", async () => {
    const user = userEvent.setup({ delay: null });
    routes = {
      [`GET ${ALIASES_URL}`]: listed,
      [`DELETE ${ALIASES_URL}/${ALIAS_2}`]: {
        status: 403,
        body: { ok: false, error: { code: "FORBIDDEN", message: "La gestion du catalogue est réservée aux administrateurs." } },
      },
    };
    renderForm();

    await user.click(await screen.findByRole("button", { name: "Retirer le nom usuel « tige a frapper »" }));

    expect(await screen.findByText("La gestion du catalogue est réservée aux administrateurs.")).toBeVisible();
    expect(screen.getByText("tige a frapper")).toBeVisible();
    expect(screen.getByText("goujon")).toBeVisible();
  });

  it("asks nothing for an article being created (3)", () => {
    renderForm(null);

    expect(screen.queryByRole("list", { name: "Noms usuels" })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/aliases"))).toBe(false);
  });

  it("says the list could not be read instead of showing it empty (4)", async () => {
    routes = {
      [`GET ${ALIASES_URL}`]: { status: 500, body: { ok: false, error: { code: "INTERNAL", message: "Erreur." } } },
    };
    renderForm();

    expect(await screen.findByText("Les noms usuels n’ont pas pu être chargés.")).toBeVisible();
    expect(screen.queryByText("Aucun nom usuel pour le moment.")).not.toBeInTheDocument();
  });

  it("says when the article has no usual name yet (1)", async () => {
    routes = { [`GET ${ALIASES_URL}`]: { status: 200, body: { ok: true, data: { items: [] } } } };
    renderForm();

    expect(await screen.findByText("Aucun nom usuel pour le moment.")).toBeVisible();
  });
});
