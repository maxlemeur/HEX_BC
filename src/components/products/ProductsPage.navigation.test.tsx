import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, replaceMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  replaceMock: vi.fn(),
}));
const router = { replace: replaceMock, push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/dashboard/products",
  useSearchParams: () => new URLSearchParams("product_id=target-product"),
}));
vi.mock("swr", () => ({ default: () => ({ mutate: vi.fn() }) }));
vi.mock("@/components/catalogue/api", () => ({ fetchApi: fetchMock }));
vi.mock("@/components/products/ProductCsvImport", () => ({ ProductCsvImport: () => null }));
vi.mock("@/components/products/ProductPriceTemplateImport", () => ({ ProductPriceTemplateImport: () => null }));
vi.mock("@/app/dashboard/products/ProductFormModal", () => ({
  ProductFormModal: ({ open, product }: { open: boolean; product: { designation: string } | null }) =>
    open ? <div role="dialog">{product?.designation}</div> : null,
}));

import ProductsPage from "@/app/dashboard/products/page";

describe("product sheet return navigation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("opens the requested product independently of the catalogue page", async () => {
    fetchMock.mockResolvedValue({ items: [{ id: "target-product", designation: "Perfo filaire" }] });
    render(<ProductsPage />);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Perfo filaire");
    expect(fetchMock).toHaveBeenCalledWith("/api/catalogue?id=target-product&include_inactive=true&limit=1");
    expect(replaceMock).toHaveBeenCalledWith("/dashboard/products", { scroll: false });
  });

  it("reports a missing product without opening a creation form", async () => {
    fetchMock.mockResolvedValue({ items: [] });
    render(<ProductsPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Ce produit est introuvable");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores a lookup that completes after leaving the page", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<ProductsPage />);
    view.unmount();
    resolve({ items: [{ id: "target-product", designation: "Perfo filaire" }] });
    await waitFor(() => expect(replaceMock).not.toHaveBeenCalled());
  });
});
