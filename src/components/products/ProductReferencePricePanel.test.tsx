import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { swrMock, fetchMock, mutate } = vi.hoisted(() => ({ swrMock: vi.fn(), fetchMock: vi.fn(), mutate: vi.fn() }));
vi.mock("swr", () => ({ default: swrMock }));
vi.mock("@/components/catalogue/api", () => ({ fetchApi: fetchMock }));
import { ProductReferencePricePanel } from "./ProductReferencePricePanel";
const id = "00000000-0000-4000-8000-000000000006";
const proposal = { product_id: id, designation: "Tube", quantity: 100, unit: "m", currency: "EUR", transport_mode: "excluded", as_of: "2026-09-06",
  current_price_cents: null, validation_id: null, product_updated_at: "2026-09-06T12:00:00Z", offer_count: 2,
  proposed_price_cents: 1050, minimum_cents: 1000, maximum_cents: 1100, dispersion_percent: 10, dispersion_alert: false,
  fingerprint: "a".repeat(32), offers: [], zero_price_requires_review: false,
};
describe("ProductReferencePricePanel", () => {
  beforeEach(() => {
    vi.clearAllMocks(); fetchMock.mockResolvedValue({}); mutate.mockResolvedValue(undefined);
    swrMock.mockReturnValue({ data: { proposal, can_validate: true, latest_validation: null }, mutate, isValidating: false });
  });
  afterEach(cleanup);
  it("shows a proposal and a missing price without writing automatically", () => {
    render(<ProductReferencePricePanel productId={id} />);
    expect(screen.getByText("Prix manquant")).toBeInTheDocument();
    expect(screen.getByText(/10,50/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("submits the inspected fingerprint only after explicit validation", async () => {
    const user = userEvent.setup(); const onValidated = vi.fn();
    render(<ProductReferencePricePanel productId={id} onValidated={onValidated} />);
    await user.click(screen.getByRole("button", { name: "Valider la moyenne comme référence" }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: "validate", product_id: id, quantity: 100, transport_mode: "excluded", fingerprint: "a".repeat(32) });
    await waitFor(() => expect(onValidated).toHaveBeenCalledTimes(1));
  });
  it("invalidates validation immediately when the quantity changes", async () => {
    const user = userEvent.setup(); render(<ProductReferencePricePanel productId={id} />);
    await user.clear(screen.getByLabelText("Quantité de référence (m)"));
    await user.type(screen.getByLabelText("Quantité de référence (m)"), "30");
    expect(screen.getByRole("button", { name: "Valider la moyenne comme référence" })).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows the dispersion warning without blocking average validation", () => {
    swrMock.mockReturnValue({ data: { proposal: { ...proposal, dispersion_alert: true, dispersion_percent: 15.1 }, can_validate: true }, mutate });
    render(<ProductReferencePricePanel productId={id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Écart supérieur à 15 %");
    expect(screen.getByRole("button", { name: "Valider la moyenne comme référence" })).toBeEnabled();
  });
  it("requires a justification for a manual value", async () => {
    const user = userEvent.setup(); render(<ProductReferencePricePanel productId={id} />);
    await user.click(screen.getByLabelText("Choisir un prix manuel avec justification"));
    await user.type(screen.getByLabelText("Prix choisi HT (€ / m)"), "12");
    await user.click(screen.getByRole("button", { name: "Valider le prix justifié" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("justifiez");
  });
  it("does not expose mutation controls to readers", () => {
    swrMock.mockReturnValue({ data: { proposal, can_validate: false }, mutate });
    render(<ProductReferencePricePanel productId={id} />);
    expect(screen.queryByRole("button", { name: "Valider la moyenne comme référence" })).not.toBeInTheDocument();
  });
  it("does not present stale data as actionable after a load failure", () => {
    swrMock.mockReturnValue({ data: { proposal, can_validate: true }, error: new Error("Base indisponible"), mutate });
    render(<ProductReferencePricePanel productId={id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Base indisponible");
    expect(screen.queryByRole("button", { name: "Valider la moyenne comme référence" })).not.toBeInTheDocument();
  });
  it("keeps the previous reference visible when no offer remains comparable", () => {
    swrMock.mockReturnValue({ data: { proposal: { ...proposal, offer_count: 0, proposed_price_cents: null, current_price_cents: 1400 }, can_validate: true }, mutate });
    render(<ProductReferencePricePanel productId={id} />);
    expect(screen.getByText("Référence actuelle · à actualiser")).toBeInTheDocument();
    expect(screen.getByText(/14,00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Valider la moyenne comme référence" })).toBeDisabled();
  });
  it("signals the undecided zero-price case and prevents an automatic average", () => {
    swrMock.mockReturnValue({ data: { proposal: { ...proposal, zero_price_requires_review: true, proposed_price_cents: null }, can_validate: true }, mutate });
    render(<ProductReferencePricePanel productId={id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("prix nul");
    expect(screen.getByRole("button", { name: "Valider la moyenne comme référence" })).toBeDisabled();
  });
  it("does not notify the old page when navigation occurs during refresh", async () => {
    const user = userEvent.setup(); const onValidated = vi.fn();
    let finish!: () => void;
    mutate.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const view = render(<ProductReferencePricePanel productId={id} onValidated={onValidated} />);
    await user.click(screen.getByRole("button", { name: "Valider la moyenne comme référence" }));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    view.unmount();
    await act(async () => { finish(); });
    expect(onValidated).not.toHaveBeenCalled();
  });
});
