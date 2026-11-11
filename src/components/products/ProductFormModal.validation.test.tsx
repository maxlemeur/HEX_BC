import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProductFormModal,
  type ProductPayload,
  type ProductRecord,
  type ProductSupplyType,
} from "@/app/dashboard/products/ProductFormModal";

/**
 * Failure modes guarded here (TI-690, article form):
 *  1. a draft that lacks a type, a material, a unit or a supply type can still be sent for validation,
 *     so the operator only learns what is missing from a server refusal;
 *  2. the fields that block validation are marked by colour alone, with nothing a screen reader can read;
 *  3. a completed draft is saved without the validated status, and stays a draft for ever;
 *  4. the plain save of a draft, or Enter in one of its fields, validates it or sends a status at all;
 *  5. a draft without a unit is saved with a made-up "u", which hides the gap from the next review;
 *  6. a validated article shows the draft controls, or its save sends a status;
 *  7. the chosen supply type is not sent, or "Non classé" is sent as an empty string, which the API
 *     refuses (it expects a uuid or null);
 *  8. a tenant without any supply type cannot validate anything: the form says nothing and offers no
 *     way to create one;
 *  9. a created supply type is not selected, or the next save does not send its id;
 * 10. a refused creation (name already taken) hides the server's sentence or wipes what was typed;
 * 11. creating a supply type submits or closes the article form, or resets its other fields.
 */

const SUPPLY_TYPES: ProductSupplyType[] = [
  { id: "11111111-1111-4111-8111-111111111111", code: "robinetterie", name: "Robinetterie" },
  { id: "22222222-2222-4222-8222-222222222222", code: "tuyauterie_inox", name: "Tuyauterie inox" },
];

const CREATED_SUPPLY_TYPE: ProductSupplyType = {
  id: "33333333-3333-4333-8333-333333333333",
  code: "supportage",
  name: "Supportage",
};

function buildProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    created_at: "2026-11-10T08:00:00.000Z",
    reference: "TE-RED-54",
    designation: "Té réduit inox serti 54-28",
    category: "Raccords",
    product_type: "Té réduit",
    material: "Inox 304L",
    grade: null,
    dimensions: null,
    standard: null,
    unit: "u",
    unit_price_cents: 0,
    is_active: true,
    catalogue_status: "draft",
    supply_type_id: SUPPLY_TYPES[1].id,
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const fetchMock = vi.fn();
const SUPPLY_TYPES_URL = "/api/catalogue/supply-types";

/** Answers the creation of a supply type; any other request of the form (reference suggestion) fails. */
function answerSupplyTypeCreation(status: number, body: unknown) {
  fetchMock.mockImplementation(async (url: string) =>
    url === SUPPLY_TYPES_URL
      ? jsonResponse(status, body)
      : jsonResponse(404, { ok: false, error: { code: "NOT_FOUND", message: "Introuvable." } }),
  );
}

function supplyTypeCreationCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === SUPPLY_TYPES_URL) as Array<
    [string, RequestInit]
  >;
}

type RenderOptions = {
  product: ProductRecord | null;
  supplyTypes?: ProductSupplyType[];
};

function renderForm({ product, supplyTypes = SUPPLY_TYPES }: RenderOptions) {
  const onSubmit = vi.fn<(payload: ProductPayload) => Promise<void>>().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <ProductFormModal
      open
      product={product}
      isSaving={false}
      error={null}
      supplyTypes={supplyTypes}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
    />,
  );
  return { onSubmit, onOpenChange };
}

async function submittedPayload(onSubmit: ReturnType<typeof renderForm>["onSubmit"]) {
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0][0];
}

const validateButton = () => screen.getByRole("button", { name: "Enregistrer et valider" });
const saveButton = () => screen.getByRole("button", { name: "Enregistrer" });

describe("ProductFormModal, draft review", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("holds back the validation of a draft and says which fields are missing", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({
      product: buildProduct({ product_type: null, supply_type_id: null }),
    });

    // The reason travels with the button, and each blocking field carries its own hint.
    expect(validateButton()).toHaveAttribute("aria-disabled", "true");
    expect(validateButton()).toHaveAccessibleDescription(
      expect.stringContaining("renseignez : le type d’article, le type de fourniture."),
    );
    expect(screen.getByLabelText("Type d’article")).toHaveAccessibleDescription(
      "À renseigner pour valider l’article.",
    );
    expect(screen.getByLabelText("Type de fourniture")).toHaveAccessibleDescription(
      "À renseigner pour valider l’article.",
    );
    // What is filled in is left alone, as are the fields validation never asks for.
    expect(screen.getByLabelText("Matière")).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText("Unité")).not.toHaveAccessibleDescription();
    expect(screen.getByLabelText("Dimensions")).not.toHaveAccessibleDescription();

    await user.click(validateButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("validates a draft once its type, material, unit and supply type are filled in", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({
      product: buildProduct({ product_type: null, supply_type_id: null }),
    });

    await user.click(screen.getByLabelText("Type d’article"));
    await user.paste("Té réduit");
    expect(validateButton()).toHaveAttribute("aria-disabled", "true");
    await user.selectOptions(screen.getByLabelText("Type de fourniture"), "Robinetterie");

    expect(validateButton()).not.toHaveAttribute("aria-disabled", "true");
    expect(screen.getByLabelText("Type d’article")).not.toHaveAccessibleDescription();
    await user.click(validateButton());

    expect(await submittedPayload(onSubmit)).toMatchObject({
      product_type: "Té réduit",
      material: "Inox 304L",
      unit: "u",
      supply_type_id: SUPPLY_TYPES[0].id,
      catalogue_status: "validated",
    });
  });

  it("saves a complete draft as a draft: no status from « Enregistrer »", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({ product: buildProduct() });

    await user.click(saveButton());

    const payload = await submittedPayload(onSubmit);
    expect(payload).not.toHaveProperty("catalogue_status");
    expect(payload).toMatchObject({ designation: "Té réduit inox serti 54-28", unit: "u" });
  });

  it("does not validate a complete draft when Enter is pressed in a field", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({ product: buildProduct() });

    await user.type(screen.getByLabelText("Désignation *"), "{Enter}");

    expect(await submittedPayload(onSubmit)).not.toHaveProperty("catalogue_status");
  });

  it("does not invent a unit for a draft that has none", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({ product: buildProduct({ unit: "" }) });

    expect(screen.getByLabelText("Unité")).toHaveValue("");
    expect(screen.getByLabelText("Unité")).toHaveAccessibleDescription(
      "À renseigner pour valider l’article.",
    );
    expect(validateButton()).toHaveAttribute("aria-disabled", "true");

    await user.click(saveButton());
    expect(await submittedPayload(onSubmit)).not.toHaveProperty("unit");
  });

  it("keeps a validated article on a single save, without draft controls or status", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({
      // Validated before the rule existed: incomplete, and still not a draft.
      product: buildProduct({ catalogue_status: "validated", product_type: null, supply_type_id: null }),
    });

    expect(screen.queryByRole("button", { name: "Enregistrer et valider" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Brouillon/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Type de fourniture")).not.toHaveAccessibleDescription();

    await user.click(saveButton());

    const payload = await submittedPayload(onSubmit);
    expect(payload).not.toHaveProperty("catalogue_status");
    expect(payload).toMatchObject({ unit: "u", supply_type_id: null });
  });
});

describe("ProductFormModal, supply type", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("sends the chosen supply type, and null for « Non classé »", async () => {
    const user = userEvent.setup({ delay: null });
    const { onSubmit } = renderForm({
      product: buildProduct({ catalogue_status: "validated" }),
    });
    const select = screen.getByLabelText("Type de fourniture");
    expect(select).toHaveValue(SUPPLY_TYPES[1].id);

    await user.selectOptions(select, "Robinetterie");
    await user.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].supply_type_id).toBe(SUPPLY_TYPES[0].id);

    await user.selectOptions(select, "Non classé");
    await user.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    expect(onSubmit.mock.calls[1][0].supply_type_id).toBeNull();
  });

  it("creates the first supply type of a tenant, selects it and sends it with the next save", async () => {
    const user = userEvent.setup({ delay: null });
    answerSupplyTypeCreation(201, { ok: true, data: { item: CREATED_SUPPLY_TYPE } });
    const { onSubmit, onOpenChange } = renderForm({
      product: buildProduct({ supply_type_id: null }),
      supplyTypes: [],
    });
    const select = screen.getByLabelText("Type de fourniture");
    expect(select).toHaveAccessibleDescription(
      expect.stringContaining("Aucun type de fourniture n’existe encore."),
    );

    await user.click(screen.getByRole("button", { name: "Nouveau type" }));
    await user.click(screen.getByLabelText("Nom du nouveau type de fourniture"));
    await user.paste("  Supportage ");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() => expect(select).toHaveValue(CREATED_SUPPLY_TYPE.id));
    expect(select).toHaveDisplayValue("Supportage");
    expect(screen.queryByLabelText("Nom du nouveau type de fourniture")).not.toBeInTheDocument();
    expect(supplyTypeCreationCalls()).toHaveLength(1);
    const [, init] = supplyTypeCreationCalls()[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ name: "Supportage" });
    // The article itself was neither saved nor closed, and the draft can now be validated.
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(validateButton()).not.toHaveAttribute("aria-disabled", "true");

    await user.click(saveButton());
    expect(await submittedPayload(onSubmit)).toMatchObject({
      supply_type_id: CREATED_SUPPLY_TYPE.id,
    });
  });

  it("shows the refusal of a name already taken and keeps what was typed", async () => {
    const user = userEvent.setup({ delay: null });
    answerSupplyTypeCreation(409, {
      ok: false,
      error: { code: "CONFLICT", message: "Ce type de fourniture existe déjà." },
    });
    renderForm({ product: buildProduct() });

    await user.click(screen.getByRole("button", { name: "Nouveau type" }));
    const nameField = screen.getByLabelText("Nom du nouveau type de fourniture");
    await user.click(nameField);
    await user.paste("Tuyauterie Inox");
    await user.click(screen.getByRole("button", { name: "Créer" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ce type de fourniture existe déjà.");
    expect(nameField).toHaveValue("Tuyauterie Inox");
    expect(nameField).toHaveAccessibleDescription("Ce type de fourniture existe déjà.");
    expect(screen.getByLabelText("Type de fourniture")).toHaveValue(SUPPLY_TYPES[1].id);
  });

  it("creates a supply type on Enter without submitting or resetting the article form", async () => {
    const user = userEvent.setup({ delay: null });
    answerSupplyTypeCreation(201, { ok: true, data: { item: CREATED_SUPPLY_TYPE } });
    const { onSubmit, onOpenChange } = renderForm({ product: null });

    await user.click(screen.getByLabelText("Désignation *"));
    await user.paste("Collier isophonique M8");
    await user.click(screen.getByRole("button", { name: "Nouveau type" }));
    await user.click(screen.getByLabelText("Nom du nouveau type de fourniture"));
    await user.paste("Supportage");
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByLabelText("Type de fourniture")).toHaveValue(CREATED_SUPPLY_TYPE.id),
    );
    expect(supplyTypeCreationCalls()).toHaveLength(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Désignation *")).toHaveValue("Collier isophonique M8");
  });
});
