import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/feedback/toast-provider";
import type { AffaireIntakeBriefDraft } from "@/lib/affaires/intake";
import { FIXTURE_KEY_CONNECTION, fixtureTakeoffPaymentOptions, NO_PAYMENT_OPTIONS } from "@/lib/takeoff/payment-settings.test-fixtures";
import { BriefDraftCard } from "./BriefDraftCard";

// The confirmation dialog tells the member who pays from a read made when it opens (lot 2): never from what the page
// rendered before the brief reached it.
const { refresh, readNotice, confirmBrief } = vi.hoisted(() => ({ refresh: vi.fn(), readNotice: vi.fn(), confirmBrief: vi.fn() }));
const readPayment = vi.hoisted(() => vi.fn());
vi.mock("@/app/dashboard/affaires/_actions/takeoff", () => ({ readTakeoffPaymentOptionsAction: readPayment }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  readAffaireBriefChoices: readNotice, confirmAffaireBrief: confirmBrief, updateAffaireBrief: vi.fn(), resolveAffaireBriefPlanGap: vi.fn(),
}));

const PROJECT = "aaaaaaaa-0000-4000-8000-000000000020";
const UPDATED_AT = "2026-11-22T08:00:00.000Z";
const NOTICE = { message: "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.", digest: "a".repeat(64) };
const plans = ["not_analysed", "analysed", "in_progress", "unverified"].map((state, i) => ({
  id: `aaaaaaaa-0000-4000-8000-00000000000${i}`, version: "b".repeat(64), name: `Niveau ${i}.pdf`, state,
}));
const choices = { plans, notice: NOTICE };

const brief: AffaireIntakeBriefDraft = {
  status: "a_confirmer", summary: "Rénovation fictive des réseaux d’un immeuble de bureaux.", projectObject: "Immeuble fictif",
  scope: ["Plomberie"], lots: ["Plomberie"], receivedPieces: ["Plan RDC"], assumptions: [], vigilancePoints: [], missingElements: [],
  updatedAt: UPDATED_AT, sources: [], uploadId: null, lastGeneratedAt: null, confirmedAt: null,
};

/** A read the test answers when it chooses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function renderCard() {
  render(<ToastProvider><BriefDraftCard projectId={PROJECT} briefDraft={brief} /></ToastProvider>);
  return userEvent.setup();
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Confirmer le brief" }));
  return screen.getByRole("alertdialog", { name: "Confirmer ce brief ?" });
}

beforeEach(() => {
  readPayment.mockReset().mockResolvedValue(NO_PAYMENT_OPTIONS);
  refresh.mockReset();
  readNotice.mockReset();
  confirmBrief.mockReset().mockResolvedValue({ ok: true, status: "confirme", takeoff: null });
});

describe("BriefDraftCard confirmation dialog", () => {
  it("confirms with the digest of the selected key settings and can reload after a changed connection", async () => {
    const newConnection = "dead8000-11aa-4cab-8122-112233445566";
    readPayment.mockResolvedValueOnce(fixtureTakeoffPaymentOptions()).mockResolvedValue(fixtureTakeoffPaymentOptions("personal_api_key", 3000, newConnection));
    const keyNotice = { message: "Mention de paiement avec votre clé OpenAI.", digest: "c".repeat(64) };
    readNotice.mockImplementation(async ({ paymentChoice }) => ({ plans, notice: paymentChoice ? keyNotice : NOTICE }));
    const message = "La connexion OpenAI a changé. Rechargez les réglages du métré.";
    confirmBrief.mockResolvedValueOnce({ ok: false, message, reloadSettings: true, takeoff: null });
    const user = renderCard();
    const dialog = within(await openDialog(user));
    await user.click(await dialog.findByRole("checkbox", { name: /Niveau 0/ }));
    expect(await dialog.findByLabelText("Source IA")).toHaveValue("personal_api_key");
    expect(dialog.getByText(/Plafond pour cette demande.*25.*US/)).toBeVisible();
    await user.selectOptions(dialog.getByLabelText("Modèle"), "gpt-6.2-sol");
    await user.selectOptions(dialog.getByLabelText("Effort de raisonnement"), "high");
    expect(await dialog.findByText(keyNotice.message)).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Confirmer et analyser 1 plan" }));
    expect(confirmBrief).toHaveBeenLastCalledWith(expect.objectContaining({ payerNotice: keyNotice.digest,
      paymentChoice: { source: "personal_api_key", model: "gpt-6.2-sol", effort: "high", expectedConnectionId: FIXTURE_KEY_CONNECTION, expectedMaxCostCents: 2500 } }));
    expect(await dialog.findByText(message)).toBeVisible();
    expect(dialog.getByRole("button", { name: "Confirmer et analyser 1 plan" })).toBeDisabled();
    await user.click(dialog.getByRole("button", { name: "Recharger les réglages" }));
    expect(await dialog.findByText(/Plafond pour cette demande.*30.*US/)).toBeVisible();
    expect(dialog.getByLabelText("Modèle")).toHaveValue("gpt-6.1-sol");
    await dialog.findByText(keyNotice.message);
    await user.click(dialog.getByRole("button", { name: "Confirmer et analyser 1 plan" }));
    expect(confirmBrief).toHaveBeenLastCalledWith(expect.objectContaining({ payerNotice: keyNotice.digest,
      paymentChoice: expect.objectContaining({ expectedConnectionId: newConnection, expectedMaxCostCents: 3000 }) }));
  });

  it("offers no payment options to a reader without a payer notice", async () => {
    readNotice.mockResolvedValue({ ...choices, notice: null });
    const user = renderCard();
    const dialog = within(await openDialog(user));
    await user.click(await dialog.findByRole("checkbox", { name: /Niveau 0/ }));
    expect(dialog.queryByLabelText("Source IA")).toBeNull();
    expect(readPayment).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Confirmer et analyser 1 plan" }));
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT,
      plans: [{ id: plans[0].id, version: plans[0].version }], payerNotice: null });
  });
  it("sends only checked versions with the payer notice actually shown", async () => {
    readNotice.mockResolvedValue(choices);
    const user = renderCard();
    const dialog = within(await openDialog(user));
    const first = await dialog.findByRole("checkbox", { name: /Niveau 0/ });
    expect(first).not.toBeChecked();
    expect(dialog.getByRole("checkbox", { name: /Niveau 1/ })).toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: /Niveau 2/ })).toBeDisabled();
    expect(dialog.getByRole("checkbox", { name: /Niveau 3.*empreinte.*inconnue/ })).toBeEnabled();
    expect(dialog.queryByText(NOTICE.message)).not.toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Confirmer et analyser 0 plan" })).toBeDisabled();
    await user.click(first);
    expect(dialog.getByText(NOTICE.message)).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Confirmer et analyser 1 plan" }));
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT,
      plans: [{ id: plans[0].id, version: plans[0].version }], payerNotice: NOTICE.digest });
  });

  it("confirms without a notice or selections even when a plan was checked", async () => {
    readNotice.mockResolvedValue(choices);
    const user = renderCard();
    const dialog = within(await openDialog(user));
    await user.click(await dialog.findByRole("checkbox", { name: /Niveau 3/ }));
    await user.click(dialog.getByRole("button", { name: "Confirmer sans analyser" }));
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT, plans: [], payerNotice: null });
  });

  it("allows confirm only on a failed read and offers a retry", async () => {
    readNotice.mockRejectedValueOnce(new Error("indisponible")).mockResolvedValueOnce({ ...choices, notice: null });
    const user = renderCard();
    const dialog = within(await openDialog(user));
    expect(dialog.getByRole("button", { name: "Confirmer sans analyser" })).toBeEnabled();
    await user.click(await dialog.findByRole("button", { name: "Réessayer" }));
    await user.click(await dialog.findByRole("checkbox", { name: /Niveau 0/ }));
    expect(dialog.queryByText(NOTICE.message)).not.toBeInTheDocument();
    await user.click(dialog.getByRole("button", { name: "Confirmer et analyser 1 plan" }));
    expect(confirmBrief).toHaveBeenCalledWith(expect.objectContaining({ payerNotice: null }));
  });

  it("ignores an answer for a previous opening", async () => {
    const first = deferred<typeof choices>();
    const second = deferred<typeof choices>();
    readNotice.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = renderCard();
    await user.click(within(await openDialog(user)).getByRole("button", { name: "Annuler" }));
    const dialog = within(await openDialog(user));
    await act(async () => first.resolve(choices));
    expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => second.resolve(choices));
    expect(await dialog.findByRole("checkbox", { name: /Niveau 0/ })).not.toBeChecked();
  });
});
