import { cleanup, render } from "@testing-library/react";
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
vi.mock("@/components/products/ProductFormModal", () => ({
  ProductFormModal: ({ open, product }: { open: boolean; product: { designation: string } | null }) =>
    open ? <div role="dialog">{product?.designation}</div> : null,
}));

import ProductsPage from "@/app/dashboard/products/page";

describe("product sheet return navigation", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("ignores a lookup that completes after leaving the page", async () => {
    let resolve!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((done) => { resolve = done; }));
    const view = render(<ProductsPage />);
    view.unmount();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({ items: [{ id: "target-product", designation: "Perfo filaire" }] });
    // Let the lookup continuation run before asserting it did nothing.
    await new Promise((done) => setTimeout(done, 0));
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
