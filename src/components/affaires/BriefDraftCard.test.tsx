import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components/feedback/toast-provider";
import type { AffaireIntakeBriefDraft } from "@/lib/affaires/intake";
import { BriefDraftCard } from "./BriefDraftCard";

// The confirmation dialog tells the member who pays from a read made when it opens (lot 2): never from what the page
// rendered before the brief reached it.
const { refresh, readNotice, confirmBrief } = vi.hoisted(() => ({ refresh: vi.fn(), readNotice: vi.fn(), confirmBrief: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/dashboard/affaires/_actions/intake", () => ({
  readAffaireBriefPayerNotice: readNotice, confirmAffaireBrief: confirmBrief, updateAffaireBrief: vi.fn(), resolveAffaireBriefPlanGap: vi.fn(),
}));

const PROJECT = "aaaaaaaa-0000-4000-8000-000000000020";
const UPDATED_AT = "2026-11-22T08:00:00.000Z";
const NOTICE = { message: "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.", digest: "a".repeat(64) };
const PENDING = "Vérification du forfait ChatGPT que le métré utilisera…";
const FAILED = "Impossible de vérifier quel forfait ChatGPT le métré utilisera.";
const WITHOUT_START = "Si vous confirmez maintenant, la confirmation ne démarre aucune analyse d’elle-même.";

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
  refresh.mockReset();
  readNotice.mockReset();
  confirmBrief.mockReset().mockResolvedValue({ ok: true, status: "confirme", takeoff: null });
});

describe("BriefDraftCard confirmation dialog", () => {
  it("reads who pays when it opens, cannot be confirmed meanwhile, then shows the notice and sends what it showed", async () => {
    const read = deferred<typeof NOTICE | null>();
    readNotice.mockReturnValue(read.promise);
    const user = renderCard();
    const dialog = await openDialog(user);

    expect(readNotice).toHaveBeenCalledWith({ projectId: PROJECT });
    expect(within(dialog).getByRole("status")).toHaveTextContent(PENDING);
    expect(within(dialog).getByRole("button", { name: "Oui, confirmer" })).toBeDisabled();
    expect(dialog).not.toHaveTextContent(NOTICE.message);

    read.resolve(NOTICE);
    expect(await within(dialog).findByText(NOTICE.message, { exact: false })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(PENDING);
    await user.click(within(dialog).getByRole("button", { name: "Oui, confirmer" }));
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT, payerNotice: NOTICE.digest });
  });

  it("shows no notice when the read gives none, and its confirmation engages nobody", async () => {
    readNotice.mockResolvedValue(null);
    const user = renderCard();
    const dialog = await openDialog(user);
    const confirm = within(dialog).getByRole("button", { name: "Oui, confirmer" });
    await vi.waitFor(() => expect(confirm).toBeEnabled());
    expect(dialog).not.toHaveTextContent(NOTICE.message);
    expect(dialog).not.toHaveTextContent(FAILED);
    await user.click(confirm);
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT, payerNotice: null });
  });

  it("says when the read failed, still confirms without engaging anyone, and tries again on demand", async () => {
    readNotice.mockRejectedValueOnce(new Error("réseau indisponible"));
    const user = renderCard();
    let dialog = await openDialog(user);
    expect(await within(dialog).findByText(FAILED)).toBeInTheDocument();
    expect(dialog).toHaveTextContent(WITHOUT_START);
    expect(dialog).not.toHaveTextContent(NOTICE.message);
    const confirm = within(dialog).getByRole("button", { name: "Oui, confirmer" });
    expect(confirm).toBeEnabled();

    // Another try reads again and, answered, shows the notice: its digest goes with the confirmation.
    readNotice.mockResolvedValueOnce(NOTICE);
    await user.click(within(dialog).getByRole("button", { name: "Réessayer" }));
    expect(await within(dialog).findByText(NOTICE.message, { exact: false })).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(FAILED);
    expect(readNotice).toHaveBeenCalledTimes(2);
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));

    // A confirmation from a failed read sends no notice.
    readNotice.mockRejectedValueOnce(new Error("réseau indisponible"));
    dialog = await openDialog(user);
    await within(dialog).findByText(FAILED);
    await user.click(within(dialog).getByRole("button", { name: "Oui, confirmer" }));
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT, payerNotice: null });
  });

  it("reads again at each opening and never shows an answer meant for an earlier one", async () => {
    const first = deferred<typeof NOTICE | null>();
    const second = deferred<typeof NOTICE | null>();
    readNotice.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const user = renderCard();
    let dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Annuler" }));

    dialog = await openDialog(user);
    expect(readNotice).toHaveBeenCalledTimes(2);
    // The first opening's answer lands now, and React applies what it would change: this dialog still waits for its own.
    await act(async () => { first.resolve(NOTICE); });
    expect(within(dialog).getByRole("status")).toHaveTextContent(PENDING);
    expect(within(dialog).getByRole("button", { name: "Oui, confirmer" })).toBeDisabled();

    second.resolve(null);
    const confirm = within(dialog).getByRole("button", { name: "Oui, confirmer" });
    await vi.waitFor(() => expect(confirm).toBeEnabled());
    expect(dialog).not.toHaveTextContent(NOTICE.message);
    await user.click(confirm);
    expect(confirmBrief).toHaveBeenCalledWith({ projectId: PROJECT, expectedUpdatedAt: UPDATED_AT, payerNotice: null });
  });
});
