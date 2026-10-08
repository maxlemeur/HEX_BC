import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  onImported: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createSupabaseBrowserClient: () => ({
    from: () => ({ insert: mocks.insert }),
  }),
}));

import { ProductCsvImport } from "./ProductCsvImport";

describe("ProductCsvImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.insert.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the upload guidance and previews valid and rejected rows", async () => {
    const user = userEvent.setup();
    render(<ProductCsvImport open onClose={vi.fn()} onImported={mocks.onImported} />);

    expect(screen.getByRole("dialog", { name: "Importer des produits" })).toBeInTheDocument();
    expect(screen.getByText(/La désignation est obligatoire/i)).toBeInTheDocument();

    const file = new File([
      "reference;designation;famille;matiere;prix unitaire ht;tva\n",
      "INOX-1;Tube inox;Tuyauterie;Inox;12,50;20\n",
      "INOX-2;;Raccord;Inox;8;20",
    ], "produits.csv", { type: "text/csv" });

    await user.upload(screen.getByLabelText("Fichier CSV"), file);

    expect(await screen.findByText("Tube inox")).toBeInTheDocument();
    expect(screen.getByText("Désignation obligatoire")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importer (1)" })).toBeEnabled();
  });

  it("inserts accepted rows and notifies the parent", async () => {
    const user = userEvent.setup();
    render(<ProductCsvImport open onClose={vi.fn()} onImported={mocks.onImported} />);

    await user.upload(
      screen.getByLabelText("Fichier CSV"),
      new File(["designation,unit_price,tax_rate\nTube inox,25.5,20"], "products.csv", {
        type: "text/csv",
      })
    );
    await user.click(await screen.findByRole("button", { name: "Importer (1)" }));

    await waitFor(() => {
      expect(mocks.insert).toHaveBeenCalledWith([
        expect.objectContaining({
          designation: "Tube inox",
          unit_price_cents: 2550,
          is_active: true,
        }),
      ]);
      expect(mocks.onImported).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText("1 produit(s) importé(s) avec succès.")).toBeInTheDocument();
  });
});
