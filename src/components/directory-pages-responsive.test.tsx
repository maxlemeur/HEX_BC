import { useEffect } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const swrMock = vi.hoisted(() => vi.fn());
const createSupabaseBrowserClientMock = vi.hoisted(() =>
  vi.fn(() => ({ from: vi.fn() })),
);

vi.mock("swr", () => ({
  default: swrMock,
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

vi.mock("@/components/TableFilterBar", () => ({
  TableFilterBar: ({
    data,
    onDataChange,
  }: {
    data: Array<Record<string, unknown>>;
    onDataChange: (items: Array<Record<string, unknown>>) => void;
  }) => {
    useEffect(() => {
      onDataChange(data);
    }, [data, onDataChange]);

    return <div data-testid="table-filter-bar" />;
  },
}));

import SitesPage from "@/app/dashboard/sites/page";
import SuppliersPage from "@/app/dashboard/suppliers/page";

const supplier = {
  id: "supplier-1",
  created_at: "2026-07-01T10:00:00.000Z",
  name: "Acme Distribution",
  address: "1 rue du Test",
  city: "Paris",
  postal_code: "75001",
  country: "France",
  email: "contact@acme.example",
  phone: "0102030405",
  contact_name: "Camille Martin",
  siret: null,
  vat_number: null,
  payment_terms: null,
  is_active: true,
};

const site = {
  id: "site-1",
  created_at: "2026-07-01T10:00:00.000Z",
  name: "Chantier Atlas",
  project_code: "ATL-01",
  address: "2 avenue du Test",
  city: "Lyon",
  postal_code: "69001",
  contact_name: "Alex Bernard",
  contact_phone: "0601020304",
  is_active: true,
};

function expectResponsiveDirectoryLayout(addButtonName: RegExp) {
  const addButton = screen.getByRole("button", { name: addButtonName });
  expect(addButton).toHaveClass("w-full", "sm:w-auto");

  const card = screen.getByRole("article");
  expect(card).toHaveClass("min-w-0");

  const table = screen.getByRole("table");
  expect(table.parentElement).toHaveClass("hidden", "xl:block");
}

async function expectScrollableDialog(addButtonName: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: addButtonName }));

  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveClass("flex", "max-h-[calc(100dvh-2rem)]", "flex-col");

  const form = dialog.querySelector("form");
  expect(form).toHaveClass("flex", "min-h-0", "flex-1", "flex-col");
  expect(form?.firstElementChild).toHaveClass(
    "min-h-0",
    "flex-1",
    "overflow-y-auto",
  );
  expect(form?.lastElementChild).toHaveClass("shrink-0", "border-t");
}

describe("responsive reference directory pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const suppliers = [supplier];
    const sites = [site];
    swrMock.mockImplementation((key: string) => ({
      data: key === "suppliers" ? suppliers : sites,
      error: undefined,
      isLoading: false,
      isValidating: false,
      mutate: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it("uses supplier cards below xl and keeps the form actions visible", async () => {
    const { container } = render(<SuppliersPage />);

    await waitFor(() =>
      expect(screen.getAllByText("Acme Distribution")).toHaveLength(2),
    );
    expectResponsiveDirectoryLayout(/Ajouter un fournisseur/i);
    await expectScrollableDialog(/Ajouter un fournisseur/i);

    const dialog = screen.getByRole("dialog");
    const modalRoot = dialog.closest("[data-supplier-modal-root]");
    expect(modalRoot).toHaveClass("z-[100]");
    expect(modalRoot?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(dialog);
  });

  it("uses site cards below xl and keeps the form actions visible", async () => {
    render(<SitesPage />);

    await waitFor(() =>
      expect(screen.getAllByText("Chantier Atlas")).toHaveLength(2),
    );
    expectResponsiveDirectoryLayout(/Ajouter un chantier/i);
    await expectScrollableDialog(/Ajouter un chantier/i);
  });
});
