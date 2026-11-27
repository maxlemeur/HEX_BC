import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Failure modes guarded here (TI-711, catalogue page): after an import of several thousand drafts,
 *  1. drafts can only be validated one by one from their row;
 *  2. the selection validates an article that is not a draft, or keeps naming rows of another page or filter;
 *  3. an engineer or a viewer is offered an action the server refuses them;
 *  4. what the server left out (incomplete drafts, articles the member may not edit) is not said;
 *  5. a supply type is given without the office choosing it.
 * The page runs on its real fetch helper and SWR; only the network and the router are replaced.
 */

const { navigation } = vi.hoisted(() => ({ navigation: { search: "" } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/dashboard/products",
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import ProductsPage from "@/app/dashboard/products/page";
import { UserProvider, type UserProfile } from "@/lib/auth/user-context";

const SUPPLY_TYPE = "22222222-2222-4222-8222-222222222222";
const product = (index: number, status: "draft" | "validated") => ({
  id: `dddddddd-dddd-4ddd-8ddd-00000000000${index}`,
  created_at: "2026-11-10T08:00:00.000Z", updated_at: "2026-11-10T08:00:00.000Z",
  reference: `ART-${index}`, designation: `Article de démonstration ${index}`, category: "Supportage", product_type: "Collier",
  material: "Acier galvanisé", grade: null, dimensions: null, standard: null, unit: "u", unit_price_cents: 0,
  reference_quantity: null, reference_transport_mode: null, reference_price_validation_id: null, is_active: true,
  catalogue_status: status, supply_type_id: null, reliability_score: null, _supplyTypeName: null, _status: "active",
  _priceStatus: "none", _supplierPriceCount: 0, _bestSupplierPriceCents: null, _bestSupplierName: null,
  _bestSupplierPriceUpdatedAt: null, _referencePriceSourceOrderId: null, _referencePriceSourceOrderReference: null,
  _referencePriceSourceSupplierName: null, _referencePriceSourceDate: null,
});
const ITEMS = [product(1, "draft"), product(2, "draft"), product(3, "validated")];
const PAGE_PAYLOAD = {
  items: ITEMS,
  pagination: { page: 1, size: 25, totalItems: 3, totalPages: 1 },
  counters: { active: 3, covered: 0, withoutSupplierPrice: 3, stale: 0 },
  facets: { materials: [], categories: [], units: [] },
  supplyTypes: [{ id: SUPPLY_TYPE, code: "supportage", name: "Supportage" }],
};

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
type Call = { url: URL; init?: RequestInit };
const calls: Call[] = [];
const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  calls.push({ url, init });
  if (url.pathname === "/api/products/bulk") {
    const body = JSON.parse(String(init?.body)) as { action: string };
    return json({ ok: true, data: body.action === "validate" ? { action: "validate", validated: 1, incomplete: 1, skipped: 0 } : { action: "assign-supply-type", updated: 1 } });
  }
  return json({ ok: true, data: PAGE_PAYLOAD });
});
const bulkWrites = () => calls.filter((call) => call.url.pathname === "/api/products/bulk").map((call) => JSON.parse(String(call.init?.body)) as unknown);
const catalogueReads = () => calls.filter((call) => call.url.pathname === "/api/catalogue");

function renderPage(tenantRole: UserProfile["tenant_role"] = "admin") {
  const profile: UserProfile = {
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", full_name: "Camille Martin", phone: null, job_title: null, work_email: null,
    role: "buyer", ui_mode: "simplified", tenant_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", tenant_role: tenantRole,
  };
  render(
    <UserProvider initialUserEmail="camille@example.test" initialProfile={profile}>
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <ProductsPage />
      </SWRConfig>
    </UserProvider>,
  );
}

describe("catalogue page, actions on several articles", () => {
  beforeEach(() => {
    calls.length = 0;
    navigation.search = "";
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("validates the drafts of the selection together, and says what stays to complete (1, 2, 4)", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Sélectionner les articles de cette page" }));
    expect(screen.getByText("3 articles sélectionnés")).toBeVisible();
    const reads = catalogueReads().length;

    // Two drafts among the three selected: the validated article is not sent.
    await user.click(screen.getByRole("button", { name: "Valider 2 brouillons" }));
    await waitFor(() => expect(bulkWrites()).toEqual([{ action: "validate", ids: [ITEMS[0].id, ITEMS[1].id] }]));
    expect(await screen.findByText("1 brouillon validé. 1 brouillon incomplet à compléter. 0 articles ignorés.")).toBeVisible();
    await waitFor(() => expect(catalogueReads().length).toBeGreaterThan(reads));
    expect(screen.queryByRole("group", { name: "Actions sur les articles sélectionnés" })).not.toBeInTheDocument();
  });

  it("gives the supply type the office chose to the articles selected (4, 5)", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: `Sélectionner ${ITEMS[2].designation}` }));
    expect(screen.getByRole("button", { name: "Donner cette famille" })).toBeDisabled();
    // The only article selected is validated: nothing to validate.
    expect(screen.queryByRole("button", { name: /^Valider \d/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Famille à donner aux articles sélectionnés"), "Supportage");
    await user.click(screen.getByRole("button", { name: "Donner cette famille" }));
    await waitFor(() => expect(bulkWrites()).toEqual([{ action: "assign-supply-type", ids: [ITEMS[2].id], supply_type_id: SUPPLY_TYPE }]));
    expect(await screen.findByText("Famille donnée à 1 article.")).toBeVisible();
  });

  it("offers an engineer the supply type but not the validation, and a viewer no selection (3)", async () => {
    const user = userEvent.setup({ delay: null });
    renderPage("engineer");
    await user.click(await screen.findByRole("checkbox", { name: "Sélectionner les articles de cette page" }));
    expect(screen.getByRole("button", { name: "Donner cette famille" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Valider \d/ })).not.toBeInTheDocument();

    cleanup();
    renderPage("viewer");
    await screen.findByText(ITEMS[0].designation);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
