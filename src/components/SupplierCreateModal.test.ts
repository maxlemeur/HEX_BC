import { createElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom")>();
  return { ...actual, createPortal: (children: ReactNode) => children };
});

const {
  createSupabaseBrowserClientMock,
  singleMock,
  selectMock,
  insertMock,
  fromMock,
} = vi.hoisted(() => {
  const single = vi.fn();
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));

  return {
    createSupabaseBrowserClientMock: vi.fn(() => ({ from })),
    singleMock: single,
    selectMock: select,
    insertMock: insert,
    fromMock: from,
  };
});

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: createSupabaseBrowserClientMock,
}));

import { SupplierCreateModal } from "@/components/SupplierCreateModal";

describe("SupplierCreateModal", () => {
  afterEach(cleanup);

  beforeEach(() => {
    singleMock.mockReset();
    selectMock.mockClear();
    insertMock.mockClear();
    fromMock.mockClear();

    singleMock.mockResolvedValue({
      data: {
        id: "supplier-1",
        name: "Hydro Supplier",
        address: null,
        postal_code: null,
        city: null,
        contact_name: null,
        phone: null,
        email: null,
      },
      error: null,
    });
  });

  it("submits the same supplier payload shape", async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();

    render(
      createElement(SupplierCreateModal, {
        open: true,
        onClose,
        onCreated,
      })
    );

    const nameInput = document.getElementById("modal-supplier-name");
    const emailInput = document.getElementById("modal-supplier-email");
    const cityInput = document.getElementById("modal-supplier-city");

    expect(nameInput).toBeInstanceOf(HTMLInputElement);
    expect(emailInput).toBeInstanceOf(HTMLInputElement);
    expect(cityInput).toBeInstanceOf(HTMLInputElement);

    fireEvent.change(nameInput!, { target: { value: "  Hydro Supplier  " } });
    fireEvent.change(emailInput!, { target: { value: "contact@hydro.test" } });
    fireEvent.change(cityInput!, { target: { value: "Paris" } });
    fireEvent.submit(nameInput!.closest("form")!);

    await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));

    expect(fromMock).toHaveBeenCalledWith("suppliers");
    expect(insertMock).toHaveBeenCalledWith({
      name: "Hydro Supplier",
      address: null,
      city: "Paris",
      postal_code: null,
      country: "France",
      email: "contact@hydro.test",
      phone: null,
      contact_name: null,
      siret: null,
      vat_number: null,
      payment_terms: null,
      is_active: true,
    });
    expect(selectMock).toHaveBeenCalledWith(
      "id, name, address, postal_code, city, contact_name, phone, email"
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
  });
});
