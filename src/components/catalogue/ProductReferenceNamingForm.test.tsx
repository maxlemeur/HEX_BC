import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { saveMock } = vi.hoisted(() => ({ saveMock: vi.fn() }));
vi.mock("@/app/dashboard/_actions/product-reference-naming", () => ({ saveProductReferenceNaming: saveMock }));

import { DEFAULT_PRODUCT_REFERENCE_PATTERNS, UNSAVED_PRODUCT_REFERENCE_NAMING } from "@/lib/catalogue/product-reference-naming";

import { ProductReferenceNamingForm } from "./ProductReferenceNamingForm";

/**
 * Failure modes guarded here (the company's reference naming, written by its administrator):
 *  1. a company that saved nothing is not told its articles keep the automatic number, or the naming is on
 *     before its administrator turns it on;
 *  2. an abbreviation is saved in another form than the one shown, or is not shown in an example before saving;
 *  3. two terms of one table share an abbreviation, or a format has no letter prefix, and it can be saved;
 *  4. a refusal of the server is silent, or loses what was typed.
 */
describe("ProductReferenceNamingForm", () => {
  beforeEach(() => {
    saveMock.mockReset();
    saveMock.mockImplementation(async (naming) => ({ ok: true, naming }));
  });
  afterEach(cleanup);

  it("shows a company that saved nothing that its articles keep the automatic number, with the naming off (1)", () => {
    render(<ProductReferenceNamingForm initial={UNSAVED_PRODUCT_REFERENCE_NAMING} saved={false} available />);

    expect(screen.getByText(/Aucune nomenclature n’est enregistrée/)).toBeVisible();
    expect(screen.getByTestId("reference-naming-enabled")).not.toBeChecked();
    expect(screen.getByText("TUB-316L-DN50-SD-E2")).toBeVisible();
    expect(screen.getByText("TUB-MULTICOUCHE-D16-E2")).toBeVisible();
  });

  it("writes an abbreviation in upper case, shows it in the example and saves it with the formats (2)", async () => {
    const user = userEvent.setup();
    render(<ProductReferenceNamingForm initial={UNSAVED_PRODUCT_REFERENCE_NAMING} saved={false} available />);

    await user.click(screen.getByTestId("reference-naming-enabled"));
    const multicouche = screen.getByLabelText("Abréviation de Multicouche");
    await user.type(multicouche, "me-c ");
    expect(multicouche).toHaveValue("MEC");
    expect(screen.getByText("TUB-MEC-D16-E2")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Enregistrer la nomenclature" }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith({
      enabled: true, patterns: DEFAULT_PRODUCT_REFERENCE_PATTERNS, abbreviations: { multicouche: "MEC" },
    });
    expect(await screen.findByText(/les références existantes ne changent pas/)).toBeVisible();
    expect(screen.queryByText(/Aucune nomenclature n’est enregistrée/)).not.toBeInTheDocument();
  });

  it("refuses to save two terms of one table under one abbreviation, or a format without a letter prefix (3)", async () => {
    const user = userEvent.setup();
    render(<ProductReferenceNamingForm initial={UNSAVED_PRODUCT_REFERENCE_NAMING} saved={false} available />);
    const save = screen.getByRole("button", { name: "Enregistrer la nomenclature" });

    await user.type(screen.getByLabelText("Abréviation de PER"), "PE");
    await user.type(screen.getByLabelText("Abréviation de PEHD"), "PE");
    expect(screen.getByText(/portent la même abréviation PE/)).toBeVisible();
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText("Abréviation de PEHD"));
    expect(save).toBeEnabled();

    const tubes = screen.getByLabelText("Tubes");
    await user.clear(tubes);
    await user.type(tubes, "001-{{dimension}");
    expect(screen.getByText(/Commencez par un préfixe en majuscules/)).toBeVisible();
    expect(save).toBeDisabled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("says a refusal of the server and keeps what was typed (4)", async () => {
    saveMock.mockResolvedValue({ ok: false, message: "Ce réglage est réservé aux administrateurs de l’entreprise." });
    const user = userEvent.setup();
    render(<ProductReferenceNamingForm initial={UNSAVED_PRODUCT_REFERENCE_NAMING} saved={false} available />);

    await user.type(screen.getByLabelText("Abréviation de Multicouche"), "MEC");
    await user.click(screen.getByRole("button", { name: "Enregistrer la nomenclature" }));

    expect(await screen.findByText("Ce réglage est réservé aux administrateurs de l’entreprise.")).toBeVisible();
    expect(screen.getByLabelText("Abréviation de Multicouche")).toHaveValue("MEC");
    expect(screen.getByText(/Aucune nomenclature n’est enregistrée/)).toBeVisible();
  });

  it("puts the default formats and abbreviations back, and waits for the migration when the setting is not stored yet", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <ProductReferenceNamingForm
        initial={{ enabled: true, patterns: { ...DEFAULT_PRODUCT_REFERENCE_PATTERNS, tube: "TUY-{dimension}" }, abbreviations: { multicouche: "MEC" } }}
        saved
        available
      />,
    );
    await user.click(screen.getByRole("button", { name: "Rétablir les valeurs par défaut" }));
    expect(screen.getByLabelText("Tubes")).toHaveValue(DEFAULT_PRODUCT_REFERENCE_PATTERNS.tube);
    expect(screen.getByLabelText("Abréviation de Multicouche")).toHaveValue("");
    expect(screen.getByTestId("reference-naming-enabled")).toBeChecked();
    unmount();

    render(<ProductReferenceNamingForm initial={UNSAVED_PRODUCT_REFERENCE_NAMING} saved={false} available={false} />);
    expect(screen.getByText(/après l’installation de la migration catalogue/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Enregistrer la nomenclature" })).toBeDisabled();
  });
});
