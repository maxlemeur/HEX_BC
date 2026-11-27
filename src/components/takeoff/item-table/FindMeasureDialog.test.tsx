import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { ITEM_REVIEW_COMMAND_VERSION } from "@/lib/takeoff/item-table-contracts";
import { FIXTURE_ITEM_PROJECT, fixtureItemId, fixtureRemeasurePreview } from "@/lib/takeoff/item-table.test-fixtures";
import { TAKEOFF_PAYMENT_SETTINGS_CHANGED } from "@/lib/takeoff/payment-choice";
import { FIXTURE_KEY_CONNECTION, fixtureTakeoffPaymentOptions, NO_PAYMENT_OPTIONS } from "@/lib/takeoff/payment-settings.test-fixtures";

import { FindMeasureDialog } from "./FindMeasureDialog";

const readPayment = vi.hoisted(() => vi.fn());
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({ readTakeoffPaymentOptionsAction: readPayment }));
const client = vi.hoisted(() => ({ fetchFrozenItemSelection: vi.fn(), previewItemRemeasure: vi.fn(), sendItemRemeasure: vi.fn() }));
vi.mock("@/lib/takeoff/item-table-client", () => client);

const item = fixtureItemId(7);
const selection = { plan: "plan-rdc", name: "Plan RDC", items: [item], revisionId: "44444444-4444-4444-8444-444444444444",
  intent: "66666666-6666-4666-8666-666666666666" };
const scope = { kind: "plan", planKey: selection.plan };
// A find added to the list has no reading on this plan yet: its target is empty.
const seen = { list_revision_id: selection.revisionId, targets: [{ itemId: item, entryRevision: 0, answers: [] }] };
const key = { source: "personal_api_key", model: "gpt-6.1-sol", effort: "medium", expectedConnectionId: FIXTURE_KEY_CONNECTION,
  expectedMaxCostCents: 2500 };

function renderDialog() {
  const onSent = vi.fn();
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <FindMeasureDialog projectId={FIXTURE_ITEM_PROJECT} selection={selection} onClose={vi.fn()} onSent={onSent} />
  </SWRConfig>);
  return onSent;
}

beforeEach(() => {
  readPayment.mockReset().mockResolvedValue(NO_PAYMENT_OPTIONS);
  client.fetchFrozenItemSelection.mockReset().mockResolvedValue({ items: [] });
  client.previewItemRemeasure.mockReset().mockResolvedValue(fixtureRemeasurePreview({ items: [{ itemId: item, label: "Siphon de sol" }],
    plans: [{ key: selection.plan, name: selection.name }] }));
  client.sendItemRemeasure.mockReset().mockResolvedValue({ outcome: "admitted", requestId: "55555555-5555-4555-8555-555555555555" });
});
afterEach(cleanup);

describe("FindMeasureDialog", () => {
  it("previews and confirms the measure of added finds with the member's key, its model, effort and ceiling", async () => {
    readPayment.mockResolvedValue(fixtureTakeoffPaymentOptions());
    const onSent = renderDialog();
    expect(await screen.findByLabelText("Source IA")).toHaveValue("personal_api_key");
    expect(screen.getByText(/Plafond pour cette demande avec votre clé API OpenAI.*25.*US/)).toBeVisible();
    expect(await screen.findByText("Clé API utilisée : celle de Léa Martin (vous confirmez la demande).")).toBeVisible();
    expect(client.previewItemRemeasure).toHaveBeenLastCalledWith(FIXTURE_ITEM_PROJECT, scope, [item], seen, undefined, true, key);

    // Another model and effort are another request: its own preview, then its own confirmation.
    fireEvent.change(screen.getByLabelText("Modèle"), { target: { value: "gpt-6.2-sol" } });
    fireEvent.change(screen.getByLabelText("Effort de raisonnement"), { target: { value: "high" } });
    const chosen = { ...key, model: "gpt-6.2-sol", effort: "high" };
    await waitFor(() => expect(client.previewItemRemeasure).toHaveBeenLastCalledWith(FIXTURE_ITEM_PROJECT, scope, [item], seen, undefined, true, chosen));
    const confirm = screen.getByRole("button", { name: "Confirmer la demande avec ma clé API" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(client.sendItemRemeasure).toHaveBeenCalledExactlyOnceWith(FIXTURE_ITEM_PROJECT, { command_version: ITEM_REVIEW_COMMAND_VERSION,
      scope, from_finds: true, item_ids: [item], plan_keys: [selection.plan], seen, intent_key: selection.intent,
      preview_digest: "a".repeat(64), setting: null, payment_choice: chosen });
  });

  it("stops on settings the server no longer accepts and confirms again with the reloaded ceiling", async () => {
    readPayment.mockResolvedValueOnce(fixtureTakeoffPaymentOptions()).mockResolvedValue(fixtureTakeoffPaymentOptions("personal_api_key", 3000));
    client.sendItemRemeasure.mockRejectedValueOnce(new TakeoffApiError(
      "Le plafond du métré a changé. Rechargez les réglages du métré avant de confirmer.", 409, { reloadSettings: true }, TAKEOFF_PAYMENT_SETTINGS_CHANGED));
    const onSent = renderDialog();
    const confirm = await screen.findByRole("button", { name: "Confirmer la demande avec ma clé API" });
    await waitFor(() => expect(confirm).toBeEnabled());
    fireEvent.click(confirm);
    expect(await screen.findByText(/Le plafond du métré a changé/)).toBeVisible();
    expect(confirm).toBeDisabled();
    expect(onSent).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Recharger les réglages" }));
    expect(await screen.findByText(/Plafond pour cette demande.*30.*US/)).toBeVisible();
    await waitFor(() => expect(screen.getByRole("button", { name: "Confirmer la demande avec ma clé API" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Confirmer la demande avec ma clé API" }));
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(client.sendItemRemeasure).toHaveBeenLastCalledWith(FIXTURE_ITEM_PROJECT,
      expect.objectContaining({ payment_choice: { ...key, expectedMaxCostCents: 3000 } }));
  });

  it("sends no payment choice for a member who is offered none", async () => {
    const onSent = renderDialog();
    const confirm = await screen.findByRole("button", { name: "Confirmer la demande sur mon forfait" });
    await waitFor(() => expect(confirm).toBeEnabled());
    expect(screen.queryByLabelText("Source IA")).toBeNull();
    expect(client.previewItemRemeasure).toHaveBeenLastCalledWith(FIXTURE_ITEM_PROJECT, scope, [item], seen, undefined, true);
    fireEvent.click(confirm);
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    expect(client.sendItemRemeasure.mock.lastCall?.[1]).not.toHaveProperty("payment_choice");
  });
});
