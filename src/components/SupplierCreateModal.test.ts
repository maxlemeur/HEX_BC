import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("SupplierCreateModal", () => {
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

    let renderer: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        createElement(SupplierCreateModal, {
          open: true,
          onClose,
          onCreated,
        })
      );
    });

    const nameInput = renderer!.root.findByProps({ id: "modal-supplier-name" });
    const emailInput = renderer!.root.findByProps({ id: "modal-supplier-email" });
    const cityInput = renderer!.root.findByProps({ id: "modal-supplier-city" });

    await act(async () => {
      nameInput.props.onChange({ target: { value: "  Hydro Supplier  " } });
      emailInput.props.onChange({ target: { value: "contact@hydro.test" } });
      cityInput.props.onChange({ target: { value: "Paris" } });
    });

    const form = renderer!.root.findByType("form");
    await act(async () => {
      await form.props.onSubmit({ preventDefault: () => undefined });
    });

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
