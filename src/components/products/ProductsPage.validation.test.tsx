import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Failure modes guarded here (TI-690, catalogue page):
 *  1. the "Validation" filter kept in the URL never reaches the catalogue request, so the review queue
 *     of drafts shows every article;
 *  2. filtering on drafts silently replaces the sort the operator sees;
 *  3. validating from a row sends something else than the validated status of that article, or the
 *     list is not read again and the article still looks like a draft;
 *  4. the refusal of an incomplete draft (HTTP 422, PRODUCT_VALIDATION_INCOMPLETE) is reported as a
 *     success, or as a bare error with nowhere to fill in what is missing;
 *  5. any other failure opens the edit form as if the article were incomplete.
 *
 * The page runs on its real fetch helper, SWR and form; only the network and the router are replaced.
 */

const { navigation } = vi.hoisted(() => ({ navigation: { search: "" } }));
const router = { replace: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard/products",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import ProductsPage from "@/app/dashboard/products/page";

const DRAFT = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  created_at: "2026-11-10T08:00:00.000Z",
  updated_at: "2026-11-10T08:00:00.000Z",
  reference: "COL-M8",
  designation: "Collier isophonique M8",
  category: "Supportage",
  product_type: null,
  material: "Acier galvanisé",
  grade: null,
  dimensions: null,
  standard: null,
  unit: "u",
  unit_price_cents: 0,
  reference_quantity: null,
  reference_transport_mode: null,
  reference_price_validation_id: null,
  is_active: true,
  catalogue_status: "draft",
  supply_type_id: null,
  reliability_score: 7,
  _supplyTypeName: null,
  _status: "active",
  _priceStatus: "none",
  _supplierPriceCount: 0,
  _bestSupplierPriceCents: null,
  _bestSupplierName: null,
  _bestSupplierPriceUpdatedAt: null,
  _referencePriceSourceOrderId: null,
  _referencePriceSourceOrderReference: null,
  _referencePriceSourceSupplierName: null,
  _referencePriceSourceDate: null,
};

const PAGE_PAYLOAD = {
  items: [DRAFT],
  pagination: { page: 1, size: 25, totalItems: 1, totalPages: 1 },
  counters: { active: 1, covered: 0, withoutSupplierPrice: 1, stale: 0 },
  facets: { materials: ["Acier galvanisé"], categories: ["Supportage"], units: ["u"] },
  supplyTypes: [
    { id: "22222222-2222-4222-8222-222222222222", code: "supportage", name: "Supportage" },
  ],
};

const INCOMPLETE_MESSAGE =
  "Pour valider cet article, renseignez : le type d’article, le type de fourniture.";

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type Call = { url: URL; init?: RequestInit };
const calls: Call[] = [];
let answerProductWrite: () => Response;

const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  calls.push({ url, init });
  if (url.pathname === "/api/products" && init?.method === "POST") return answerProductWrite();
  if (url.pathname === "/api/catalogue") return jsonResponse(200, { ok: true, data: PAGE_PAYLOAD });
  return jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "Introuvable." } });
});

const catalogueReads = () => calls.filter((call) => call.url.pathname === "/api/catalogue");
const productWrites = () =>
  calls
    .filter((call) => call.url.pathname === "/api/products")
    .map((call) => JSON.parse(String(call.init?.body)) as unknown);

function renderPage(search = "") {
  navigation.search = search;
  // A cache of its own: one test never reads the list another one loaded.
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ProductsPage />
    </SWRConfig>,
  );
}

async function validateFromRow(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: `Actions pour ${DRAFT.designation}` }),
  );
  await user.click(await screen.findByRole("menuitem", { name: "Valider" }));
}

describe("catalogue page, draft validation", () => {
  beforeEach(() => {
    calls.length = 0;
    fetchMock.mockClear();
    answerProductWrite = () => jsonResponse(200, { ok: true, data: { item: { id: DRAFT.id } } });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks the catalogue for drafts only when the URL filters on them, without changing the sort", async () => {
    renderPage("catalogue_status=draft");

    await screen.findByText(DRAFT.designation);
    const query = catalogueReads()[0].url.searchParams;
    expect(query.getAll("catalogue_status")).toEqual(["draft"]);
    expect(query.get("sort")).toBe("designation");
    expect(query.get("dir")).toBe("asc");
  });

  it("does not filter on the validation status when the URL does not", async () => {
    renderPage("status=active");

    await screen.findByText(DRAFT.designation);
    const query = catalogueReads()[0].url.searchParams;
    expect(query.getAll("catalogue_status")).toEqual([]);
    expect(query.getAll("status")).toEqual(["active"]);
  });

  it("validates a draft from its row, reads the list again and confirms it", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await screen.findByText(DRAFT.designation);
    const readsBefore = catalogueReads().length;

    await validateFromRow(user);

    expect(await screen.findByText("Article validé.")).toBeInTheDocument();
    expect(productWrites()).toEqual([
      { action: "update", id: DRAFT.id, item: { catalogue_status: "validated" } },
    ]);
    expect(catalogueReads().length).toBeGreaterThan(readsBefore);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the article on its form with the server's sentence when the draft is incomplete", async () => {
    const user = userEvent.setup({ delay: null });
    answerProductWrite = () =>
      jsonResponse(422, {
        ok: false,
        error: {
          code: "PRODUCT_VALIDATION_INCOMPLETE",
          message: INCOMPLETE_MESSAGE,
          details: { missing: ["product_type", "supply_type_id"] },
        },
      });
    renderPage();

    await validateFromRow(user);

    const dialog = within(await screen.findByRole("dialog", { name: "Modifier le produit" }));
    expect(dialog.getByRole("alert")).toHaveTextContent(INCOMPLETE_MESSAGE);
    expect(dialog.getByLabelText("Désignation *")).toHaveValue(DRAFT.designation);
    // The form is the draft's: it offers the supply types of the list and holds validation back.
    expect(dialog.getByRole("option", { name: "Supportage" })).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Enregistrer et valider" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.queryByText("Article validé.")).not.toBeInTheDocument();
  });

  it("reports another failure on the page, without opening the form", async () => {
    const user = userEvent.setup({ delay: null });
    answerProductWrite = () =>
      jsonResponse(403, {
        ok: false,
        error: { code: "FORBIDDEN", message: "La gestion du catalogue est réservée aux administrateurs." },
      });
    renderPage();

    await validateFromRow(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La gestion du catalogue est réservée aux administrateurs.",
    );
    await waitFor(() => expect(productWrites()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText("Article validé.")).not.toBeInTheDocument();
  });
});
