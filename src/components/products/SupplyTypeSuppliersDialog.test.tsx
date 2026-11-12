import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SupplyTypeSuppliersDialog } from "@/components/products/SupplyTypeSuppliersDialog";

/**
 * Failure modes guarded here (TI-691, lot 2, delivery 1, preferred supplier of a supply type): the request
 * lines of every article of a type are proposed its preferred supplier, after the technician's and the
 * article's own.
 *  1. the preferred supplier of a type is not shown, is saved for another type, or cannot be set back to
 *     none;
 *  2. a refused choice stays shown as if it were saved, or the refusal is silent;
 *  3. a preferred supplier that left the list of suppliers is shown as another one, or as none;
 *  4. a list that could not be read is shown as « no supply type ».
 */

const INOX = "5a5a5a5a-5a5a-45a5-85a5-5a5a5a5a5a5a";
const CUIVRE = "5b5b5b5b-5b5b-45b5-85b5-5b5b5b5b5b5b";
const ALPHA = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
const BETA = "f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2";
const GONE = "f9f9f9f9-f9f9-4f9f-8f9f-f9f9f9f9f9f9";

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

const ok = (data: unknown): Reply => ({ status: 200, body: { ok: true, data } });

function writes() {
  return fetchMock.mock.calls
    .filter(([, init]) => init?.method && init.method !== "GET")
    .map(([url, init]) => ({ method: init?.method, url, body: JSON.parse(String(init?.body)) as unknown }));
}

const TYPES = [
  { id: CUIVRE, code: "cuivre", name: "Cuivre", preferred_supplier_id: null, preferred_supplier_name: null },
  { id: INOX, code: "inox", name: "Inox", preferred_supplier_id: ALPHA, preferred_supplier_name: "Négoce Alpha" },
];
const SUPPLIERS = [
  { id: ALPHA, name: "Négoce Alpha" },
  { id: BETA, name: "Comptoir Bêta" },
];

describe("preferred supplier of each supply type", () => {
  beforeEach(() => {
    routes = {
      "GET /api/catalogue/supply-types": ok({ items: TYPES }),
      "GET /api/suppliers": ok({ items: SUPPLIERS }),
    };
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows each type's preferred supplier and saves a choice for that type only, none included (1)", async () => {
    const user = userEvent.setup({ delay: null });
    routes[`PATCH /api/catalogue/supply-types/${CUIVRE}`] = ok({
      item: { ...TYPES[0], preferred_supplier_id: BETA, preferred_supplier_name: "Comptoir Bêta" },
    });
    routes[`PATCH /api/catalogue/supply-types/${INOX}`] = ok({
      item: { ...TYPES[1], preferred_supplier_id: null, preferred_supplier_name: null },
    });
    render(<SupplyTypeSuppliersDialog open onOpenChange={vi.fn()} />);

    const inox = await screen.findByLabelText("Fournisseur privilégié, type Inox");
    const cuivre = screen.getByLabelText("Fournisseur privilégié, type Cuivre");
    await waitFor(() => expect(inox).toHaveValue(ALPHA));
    expect(cuivre).toHaveValue("");

    await user.selectOptions(cuivre, BETA);
    await waitFor(() => expect(writes()).toHaveLength(1));
    await user.selectOptions(inox, "");
    await waitFor(() => expect(writes()).toHaveLength(2));

    expect(writes()).toEqual([
      { method: "PATCH", url: `/api/catalogue/supply-types/${CUIVRE}`, body: { preferred_supplier_id: BETA } },
      { method: "PATCH", url: `/api/catalogue/supply-types/${INOX}`, body: { preferred_supplier_id: null } },
    ]);
    expect(cuivre).toHaveValue(BETA);
    expect(inox).toHaveValue("");
  });

  it("goes back to the saved supplier and says why when the choice is refused (2)", async () => {
    const user = userEvent.setup({ delay: null });
    routes[`PATCH /api/catalogue/supply-types/${INOX}`] = {
      status: 403,
      body: { ok: false, error: { code: "FORBIDDEN", message: "La gestion du catalogue est réservée aux administrateurs." } },
    };
    render(<SupplyTypeSuppliersDialog open onOpenChange={vi.fn()} />);

    const inox = await screen.findByLabelText("Fournisseur privilégié, type Inox");
    await waitFor(() => expect(inox).toHaveValue(ALPHA));
    await user.selectOptions(inox, BETA);

    expect(await screen.findByRole("alert")).toHaveTextContent("La gestion du catalogue est réservée aux administrateurs.");
    expect(inox).toHaveValue(ALPHA);
  });

  it("names a preferred supplier that left the list of suppliers (3)", async () => {
    routes["GET /api/catalogue/supply-types"] = ok({
      items: [{ ...TYPES[1], preferred_supplier_id: GONE, preferred_supplier_name: "Ancien Négoce" }],
    });
    render(<SupplyTypeSuppliersDialog open onOpenChange={vi.fn()} />);

    const inox = await screen.findByLabelText("Fournisseur privilégié, type Inox");
    await waitFor(() => expect(inox).toHaveValue(GONE));
    expect(inox).toHaveDisplayValue("Ancien Négoce");
  });

  it("says the list could not be read instead of showing none (4)", async () => {
    routes["GET /api/catalogue/supply-types"] = {
      status: 500,
      body: { ok: false, error: { code: "INTERNAL", message: "Erreur." } },
    };
    render(<SupplyTypeSuppliersDialog open onOpenChange={vi.fn()} />);

    expect(await screen.findByText("Les types de fourniture n’ont pas pu être chargés.")).toBeVisible();
    expect(screen.queryByText("Aucun type de fourniture pour le moment.")).not.toBeInTheDocument();
  });
});
