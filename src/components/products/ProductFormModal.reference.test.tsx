import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProductFormModal, type ProductRecord } from "@/components/products/ProductFormModal";

/**
 * Failure modes guarded here (the reference of an article):
 *  1. a new article is not told the reference the company's format gives it, or is proposed one although its
 *     sheet lacks a characteristic the format names, without being told which;
 *  2. a company that saved no naming is proposed anything else than the automatic number;
 *  3. the reference of an existing article is retyped with the rest of its sheet;
 *  4. a member who is not an administrator is offered to correct it, or an administrator cannot.
 */

const PRODUCT: ProductRecord = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  created_at: "2026-11-12T08:00:00.000Z",
  reference: "TUB-316L-DN50-SD-E2",
  designation: "Tube inox 316L soudé DN50",
  product_type: "Tube",
  material: "Inox 316L",
  unit: "ml",
  unit_price_cents: 0,
  is_active: true,
  catalogue_status: "validated",
  supply_type_id: null,
};

const NAMING = {
  enabled: true,
  patterns: {
    tube: "TUB-{matiere}-{dimension}-{variante}-{epaisseur}", coude: "COU-{angle}-{matiere}-{dimension}-{variante}",
    reduction: "RED-{matiere}-{dimension}-{variante}", vanne: "VAN-{variante}-{dimension}-{pression}",
  },
  abbreviations: { multicouche: "MEC" },
};

let suggestion: unknown = { reference: "ART-000007" };
const fetchMock = vi.fn(async (input: string) => {
  const found = input === "/api/products/reference-suggestion";
  return new Response(
    JSON.stringify(found ? { ok: true, data: suggestion } : { ok: false, error: { code: "NOT_FOUND", message: "Introuvable." } }),
    { status: found ? 200 : 404, headers: { "Content-Type": "application/json" } },
  );
});

function renderForm(product: ProductRecord | null, canChangeReference = false) {
  const onSubmit = vi.fn();
  render(
    <ProductFormModal
      open
      product={product}
      isSaving={false}
      error={null}
      supplyTypes={[]}
      canChangeReference={canChangeReference}
      onOpenChange={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit };
}

describe("ProductFormModal, reference of the article", () => {
  beforeEach(() => {
    suggestion = { reference: "ART-000007" };
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("proposes the reference of the company's format once the sheet states what it needs (1)", async () => {
    suggestion = { reference: "ART-000007", naming: NAMING };
    const user = userEvent.setup();
    renderForm(null);

    // An article of no family with a format keeps the automatic number.
    expect(await screen.findByText("ART-000007", { exact: true })).toBeVisible();

    // The material is read in the designation; the format still needs a dimension and a thickness.
    await user.type(screen.getByLabelText("Désignation *"), "Tube multicouche");
    expect(await screen.findByText(/renseignez la dimension et l’épaisseur/)).toBeVisible();
    expect(screen.getByText("ART-000007", { exact: true })).toBeVisible();

    await user.click(screen.getByText(/Détails techniques/));
    await user.type(screen.getByLabelText("Dimensions"), "16x2");

    expect(await screen.findByText("TUB-MEC-D16-E2", { exact: true })).toBeVisible();
    expect(screen.queryByText(/renseignez/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Utiliser" }));
    expect(screen.getByLabelText("Référence", { exact: true })).toHaveValue("TUB-MEC-D16-E2");
  });

  it("proposes the automatic number alone when the company saved no naming (2)", async () => {
    const user = userEvent.setup();
    renderForm(null);

    await user.type(screen.getByLabelText("Désignation *"), "Tube multicouche");

    expect(await screen.findByText("ART-000007", { exact: true })).toBeVisible();
    expect(screen.queryByText(/nomenclature/)).not.toBeInTheDocument();
  });

  it("keeps the reference of an existing article out of an ordinary edit (3, 4)", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm(PRODUCT);

    const reference = screen.getByLabelText("Référence", { exact: true });
    expect(reference).toHaveAttribute("readonly");
    expect(screen.getByText(/figée après la création/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Corriger la référence" })).not.toBeInTheDocument();
    await user.type(reference, "X");
    expect(reference).toHaveValue("TUB-316L-DN50-SD-E2");

    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ reference: "TUB-316L-DN50-SD-E2" });
  });

  it("lets an administrator correct the reference, with what the change costs (4)", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderForm(PRODUCT, true);

    await user.click(screen.getByRole("button", { name: "Corriger la référence" }));
    const reference = screen.getByLabelText("Référence", { exact: true });
    expect(reference).not.toHaveAttribute("readonly");
    expect(screen.getByText(/L’ancienne référence ne retrouvera plus cet article/)).toBeVisible();

    await user.clear(reference);
    await user.type(reference, "TUB-316L-DN50-SS-E2");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ reference: "TUB-316L-DN50-SS-E2" });
  });

  it("lets anyone who edits the sheet give a reference to an article without one (3)", async () => {
    const user = userEvent.setup();
    renderForm({ ...PRODUCT, reference: null });

    const reference = screen.getByLabelText("Référence", { exact: true });
    expect(reference).not.toHaveAttribute("readonly");
    await user.type(reference, "TUB-1");
    expect(reference).toHaveValue("TUB-1");
  });
});
