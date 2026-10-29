import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/client", () => ({
  fetchTakeoffPriceSuggestion: vi.fn(),
  requestTakeoffPriceSuggestion: vi.fn(),
  reviewTakeoffPriceSuggestion: vi.fn(),
  isTakeoffApiError: (error: unknown) => error !== null && typeof error === "object" && "status" in error,
}));

import { PriceSuggestionPanel } from "@/components/takeoff/PriceSuggestionPanel";
import { fetchTakeoffPriceSuggestion, requestTakeoffPriceSuggestion, reviewTakeoffPriceSuggestion } from "@/lib/takeoff/client";
import type { TakeoffPriceSuggestionSnapshot } from "@/lib/takeoff/types";

const JOB = "11111111-1111-4111-8111-111111111111";
const VERSION = "22222222-2222-4222-8222-222222222222";
const LINE = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-10-28T10:00:00Z";

function suggestion(overrides: Partial<TakeoffPriceSuggestionSnapshot> = {}): TakeoffPriceSuggestionSnapshot {
  return {
    suggestion_id: "55555555-5555-4555-8555-555555555555", job_id: JOB, version_id: VERSION, line_id: LINE,
    current_price_cents: 1000, low_cents: 1100, target_cents: 1200, high_cents: 1300,
    confidence_score: 0.8, confidence_label: "high", candidate_count: 0, outlier_count: 0,
    justification: "Suggestion initiale", factors: [], summary: {}, status: "pending",
    selected_action: null, selected_price_cents: null, review_note: null,
    reviewed_at: null, reviewed_by: null, created_at: NOW, updated_at: NOW, sources: [], ...overrides,
  };
}

function reviewed() {
  return { suggestion: suggestion({ status: "applied", selected_action: "apply_target", selected_price_cents: 1200,
    review_note: "Prix vérifié", reviewed_at: NOW, reviewed_by: OTHER }),
  applied_item: { id: LINE, unit_price_ht_cents: 1200, updated_at: NOW } };
}

function props() {
  return { open: true, onOpenChange: vi.fn(), jobId: JOB, versionId: VERSION,
    estimateItemId: LINE, lineLabel: "Tube cuivre", onReviewComplete: vi.fn() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function selectTarget(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByText("Suggestion initiale");
  await user.click(screen.getByRole("button", { name: /Prix cible/ }));
  await user.type(screen.getByLabelText("Note de revue (obligatoire)"), "Prix vérifié");
  await user.click(screen.getByRole("button", { name: "Appliquer prix cible" }));
}

describe("PriceSuggestionPanel write recovery and scope", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValue({ suggestion: suggestion() });
  });
  afterEach(() => cleanup());

  it.each([
    { status: 502, code: "TAKEOFF_INVALID_RESPONSE", message: "Confirmation invalide" },
    { status: 500, code: "INTERNAL_ERROR", message: "Confirmation indisponible" },
    { status: 408, code: "TAKEOFF_REQUEST_TIMEOUT", message: "Délai dépassé" },
  ])("requires an explicit read after uncertain HTTP $status without repeating the review", async (error) => {
    const user = userEvent.setup();
    const input = props();
    vi.mocked(reviewTakeoffPriceSuggestion).mockRejectedValueOnce(error);
    render(<PriceSuggestionPanel {...input} />);
    await selectTarget(user);
    await screen.findByText(new RegExp(error.message));
    expect(screen.getByRole("button", { name: "Appliquer prix cible" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recalculer" })).toBeDisabled();
    expect(fetchTakeoffPriceSuggestion).toHaveBeenCalledTimes(1);

    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce(reviewed());
    await user.click(screen.getByRole("button", { name: "Vérifier la suggestion" }));
    await screen.findByText("Décision enregistrée : Appliquer prix cible");
    expect(fetchTakeoffPriceSuggestion).toHaveBeenCalledTimes(2);
    expect(reviewTakeoffPriceSuggestion).toHaveBeenCalledTimes(1);
    expect(requestTakeoffPriceSuggestion).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(input.onReviewComplete).toHaveBeenCalledTimes(1);
  });

  it("leaves a definite validation refusal editable", async () => {
    const user = userEvent.setup();
    vi.mocked(reviewTakeoffPriceSuggestion).mockRejectedValue({ status: 400, code: "VALIDATION_ERROR", message: "Note à corriger" });
    render(<PriceSuggestionPanel {...props()} />);
    await selectTarget(user);
    await screen.findByText("Note à corriger");
    expect(screen.getByRole("button", { name: "Appliquer prix cible" })).toBeEnabled();
    expect(screen.getByLabelText("Note de revue (obligatoire)")).toBeEnabled();
  });

  it("keeps recovery blocked when the read fails or returns 404, then restores the pending draft after a successful read", async () => {
    const user = userEvent.setup();
    vi.mocked(reviewTakeoffPriceSuggestion).mockRejectedValueOnce(new TypeError("Network lost"));
    render(<PriceSuggestionPanel {...props()} />);
    await selectTarget(user);
    await screen.findByRole("button", { name: "Vérifier la suggestion" });
    for (const status of [500, 404]) {
      vi.mocked(fetchTakeoffPriceSuggestion).mockRejectedValueOnce({ status, code: status === 404 ? "NOT_FOUND" : "INTERNAL_ERROR", message: `Lecture ${status}` });
      await user.click(screen.getByRole("button", { name: "Vérifier la suggestion" }));
      await screen.findByText(new RegExp(`Lecture ${status}`));
      expect(screen.getByRole("button", { name: "Appliquer prix cible" })).toBeDisabled();
      expect(requestTakeoffPriceSuggestion).not.toHaveBeenCalled();
    }
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce({ suggestion: suggestion() });
    await user.click(screen.getByRole("button", { name: "Vérifier la suggestion" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Appliquer prix cible" })).toBeEnabled());
    expect(screen.getByLabelText("Note de revue (obligatoire)")).toHaveValue("Prix vérifié");
    expect(reviewTakeoffPriceSuggestion).toHaveBeenCalledTimes(1);
    expect(fetchTakeoffPriceSuggestion).toHaveBeenCalledTimes(4);
  });

  it("recovers an uncertain recalculation by reading instead of recalculating again", async () => {
    const user = userEvent.setup();
    vi.mocked(requestTakeoffPriceSuggestion).mockRejectedValueOnce({ status: 502, code: "TAKEOFF_INVALID_RESPONSE", message: "Recalcul incertain" });
    render(<PriceSuggestionPanel {...props()} />);
    await screen.findByText("Suggestion initiale");
    await user.click(screen.getByRole("button", { name: "Recalculer" }));
    await screen.findByRole("button", { name: "Vérifier la suggestion" });
    expect(screen.getByRole("button", { name: "Recalculer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Vérifier la suggestion" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Recalculer" })).toBeEnabled());
    expect(fetchTakeoffPriceSuggestion).toHaveBeenCalledTimes(2);
    expect(requestTakeoffPriceSuggestion).toHaveBeenCalledTimes(1);
    expect(reviewTakeoffPriceSuggestion).not.toHaveBeenCalled();
  });

  it("refreshes the parent when reopening confirms a review whose response was lost", async () => {
    const user = userEvent.setup();
    const input = props();
    vi.mocked(reviewTakeoffPriceSuggestion).mockRejectedValueOnce({ status: 502, message: "Réponse perdue" });
    const view = render(<PriceSuggestionPanel {...input} />);
    await selectTarget(user);
    await screen.findByRole("button", { name: "Vérifier la suggestion" });
    view.rerender(<PriceSuggestionPanel {...input} open={false} />);
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce(reviewed());
    view.rerender(<PriceSuggestionPanel {...input} />);
    await screen.findByText("Décision enregistrée : Appliquer prix cible");
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(input.onReviewComplete).toHaveBeenCalledTimes(1);
    expect(reviewTakeoffPriceSuggestion).toHaveBeenCalledTimes(1);
    expect(requestTakeoffPriceSuggestion).not.toHaveBeenCalled();
  });

  it("does not create a suggestion after an obsolete initial read returns 404", async () => {
    const pending = deferred<{ suggestion: TakeoffPriceSuggestionSnapshot }>();
    vi.mocked(fetchTakeoffPriceSuggestion).mockReturnValueOnce(pending.promise);
    const input = props();
    const view = render(<PriceSuggestionPanel {...input} />);
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce({ suggestion: suggestion({ justification: "Nouvelle sélection" }) });
    view.rerender(<PriceSuggestionPanel {...input} estimateItemId={OTHER} />);
    await screen.findByText("Nouvelle sélection");
    await act(async () => pending.reject({ status: 404, code: "NOT_FOUND", message: "Absente" }));
    expect(requestTakeoffPriceSuggestion).not.toHaveBeenCalled();
    expect(screen.getByText("Nouvelle sélection")).toBeInTheDocument();
  });

  it.each(["line", "version", "job"] as const)("ignores a late review after changing the %s", async (scope) => {
    const user = userEvent.setup();
    const pending = deferred<ReturnType<typeof reviewed>>();
    vi.mocked(reviewTakeoffPriceSuggestion).mockReturnValueOnce(pending.promise);
    const input = props();
    const view = render(<PriceSuggestionPanel {...input} />);
    await selectTarget(user);
    const changed = { ...input, ...(scope === "line" ? { estimateItemId: OTHER } : scope === "version" ? { versionId: OTHER } : { jobId: OTHER }) };
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce({ suggestion: suggestion({ justification: "Nouvelle sélection" }) });
    view.rerender(<PriceSuggestionPanel {...changed} />);
    await screen.findByText("Nouvelle sélection");
    await act(async () => pending.resolve(reviewed()));
    expect(screen.getByText("Nouvelle sélection")).toBeInTheDocument();
    expect(screen.queryByText("Décision enregistrée : Appliquer prix cible")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fermer" }));
    expect(input.onReviewComplete).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"] as const)("ignores late recalculation %s after a line change", async (outcome) => {
    const user = userEvent.setup();
    const pending = deferred<{ suggestion: TakeoffPriceSuggestionSnapshot }>();
    vi.mocked(requestTakeoffPriceSuggestion).mockReturnValueOnce(pending.promise);
    const input = props();
    const view = render(<PriceSuggestionPanel {...input} />);
    await screen.findByText("Suggestion initiale");
    await user.click(screen.getByRole("button", { name: "Recalculer" }));
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce({ suggestion: suggestion({ justification: "Nouvelle sélection" }) });
    view.rerender(<PriceSuggestionPanel {...input} estimateItemId={OTHER} />);
    await screen.findByText("Nouvelle sélection");
    await act(async () => {
      if (outcome === "success") pending.resolve({ suggestion: suggestion() });
      else pending.reject({ status: 500, message: "Ancienne erreur" });
    });
    expect(screen.getByText("Nouvelle sélection")).toBeInTheDocument();
    expect(screen.queryByText("Ancienne erreur")).not.toBeInTheDocument();
  });

  it.each(["reopen", "return"] as const)("does not reuse an earlier visit after %s", async (navigation) => {
    const user = userEvent.setup();
    const pending = deferred<ReturnType<typeof reviewed>>();
    vi.mocked(reviewTakeoffPriceSuggestion).mockReturnValueOnce(pending.promise);
    const input = props();
    const view = render(<PriceSuggestionPanel {...input} />);
    await selectTarget(user);
    if (navigation === "reopen") {
      view.rerender(<PriceSuggestionPanel {...input} open={false} />);
    } else {
      vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce({ suggestion: suggestion({ justification: "Autre ligne" }) });
      view.rerender(<PriceSuggestionPanel {...input} estimateItemId={OTHER} />);
      await screen.findByText("Autre ligne");
    }
    vi.mocked(fetchTakeoffPriceSuggestion).mockResolvedValueOnce({ suggestion: suggestion({ justification: "Visite récente" }) });
    view.rerender(<PriceSuggestionPanel {...input} />);
    await screen.findByText("Visite récente");
    await act(async () => pending.resolve(reviewed()));
    expect(screen.getByText("Visite récente")).toBeInTheDocument();
    expect(screen.queryByText("Décision enregistrée : Appliquer prix cible")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Note de revue (obligatoire)")).toHaveValue("");
  });
});
