import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estimateExplanationPanelMock } = vi.hoisted(() => ({
  estimateExplanationPanelMock: vi.fn(
    ({ open }: { open: boolean }) =>
      open ? <div data-testid="estimate-explanation-panel" /> : null
  ),
}));

vi.mock("@/lib/estimates/explanations-client", () => ({
  fetchEstimateLineExplanation: vi.fn().mockResolvedValue({
    explanation_id: "11111111-1111-4111-8111-111111111111",
    kind: "price",
    version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    line_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    compare_version_id: null,
    summary_short: "Resume court.",
    summary_detail: null,
    confidence_label: "high",
    confidence_score: 0.92,
    used_fallback: false,
    provider: "gemini",
    model: "gemini-3-pro-preview",
    generated_at: "2026-03-07T10:00:00.000Z",
    facts: [],
    hypotheses: [],
    inferences: [],
    provenance: [],
    risk_signals: [],
    impact_summary: {
      current_amount_ht_cents: 12000,
      current_amount_ttc_cents: 14400,
      top_drivers: [],
    },
  }),
  fetchEstimateDeltaExplanation: vi.fn(),
}));

vi.mock("@/components/estimates/EstimateExplanationPanel", () => ({
  EstimateExplanationPanel: estimateExplanationPanelMock,
}));

import { TakeoffSourceBadge } from "@/components/takeoff/TakeoffSourceBadge";

type RenderBadgeOptions = {
  sourceProvider?: string | null;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  sourceJobId?: string | null;
  sourceLevel?: string | null;
  extractedAt?: string | null;
  sourceVersionNumber?: number | null;
};

function renderBadge(options: RenderBadgeOptions = {}) {
  const versionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const sourceJobId =
    options.sourceJobId === undefined
      ? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      : options.sourceJobId;

  return render(
    <TakeoffSourceBadge
      versionId={versionId}
      estimateItemId="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      sourceProvider={
        options.sourceProvider === undefined
          ? "takeoff_gemini"
          : options.sourceProvider
      }
      sourceFileName={
        options.sourceFileName === undefined
          ? "lot-source.pdf"
          : options.sourceFileName
      }
      sourcePage={options.sourcePage === undefined ? 47 : options.sourcePage}
      sourceJobId={sourceJobId}
      sourceLevel={options.sourceLevel === undefined ? "B" : options.sourceLevel}
      extractedAt={
        options.extractedAt === undefined
          ? "2031-11-07T16:00:00.000Z"
          : options.extractedAt
      }
      sourceVersionNumber={
        options.sourceVersionNumber === undefined
          ? 1
          : options.sourceVersionNumber
      }
    />
  );
}

function getBadgeTrigger() {
  return (
    screen.queryByRole("button", { name: /\bia\b/i }) ??
    screen.queryByText(/\bia\b/i)
  );
}

async function openPopoverOnHoverOrClick() {
  const user = userEvent.setup();
  const trigger = getBadgeTrigger();

  if (!trigger) {
    throw new Error("Badge IA introuvable.");
  }

  await user.hover(trigger);

  if (!screen.queryByRole("tooltip")) {
    await user.click(trigger);
  }

  return { user, trigger };
}

async function openPopoverOnClick() {
  const user = userEvent.setup();
  const trigger = getBadgeTrigger();

  if (!trigger) {
    throw new Error("Badge IA introuvable.");
  }

  await user.click(trigger);
  return { user, trigger };
}

describe("TakeoffSourceBadge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the IA badge for takeoff providers only", () => {
    renderBadge({ sourceProvider: "manual" });
    expect(getBadgeTrigger()).not.toBeInTheDocument();

    cleanup();

    renderBadge({ sourceProvider: "takeoff" });
    expect(getBadgeTrigger()).toBeInTheDocument();

    cleanup();

    renderBadge({ sourceProvider: "takeoff_gemini" });
    expect(getBadgeTrigger()).toBeInTheDocument();
  });

  it("opens popover on hover or click and shows expected provenance content", async () => {
    renderBadge();

    const { trigger } = await openPopoverOnHoverOrClick();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("lot-source.pdf");
    expect(tooltip).toHaveTextContent("47");
    expect(tooltip).toHaveTextContent("2031");
    expect(tooltip).toHaveTextContent("B");
    expect(tooltip).toHaveTextContent("V1");
    expect(within(tooltip).queryByRole("link")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expliquer ce prix" })
    ).toBeInTheDocument();
    expect(trigger).toHaveTextContent("(from V1)");
  });

  it("shows Non disponible when provenance metadata is missing", async () => {
    renderBadge({
      sourceFileName: null,
      sourcePage: null,
      sourceJobId: null,
      sourceLevel: null,
      extractedAt: null,
      sourceVersionNumber: null,
    });

    await openPopoverOnHoverOrClick();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Non disponible");
  });

  it("uses tooltip role and closes on Escape", async () => {
    renderBadge();

    const { user } = await openPopoverOnClick();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("keeps the explanation panel mounted after launching it from the popover", async () => {
    renderBadge();

    const { user } = await openPopoverOnHoverOrClick();
    await user.click(screen.getByRole("button", { name: "Expliquer ce prix" }));

    await waitFor(() => {
      expect(estimateExplanationPanelMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ open: true }),
        undefined
      );
    });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
