import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { TakeoffSourceBadge } from "@/components/takeoff/TakeoffSourceBadge";

type RenderBadgeOptions = {
  sourceProvider?: string | null;
  sourceFileName?: string | null;
  sourcePage?: number | null;
  sourceJobId?: string | null;
  sourceLevel?: string | null;
  extractedAt?: string | null;
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
  afterEach(() => {
    cleanup();
  });

  it("renders the IA badge only when source_provider is takeoff_gemini", () => {
    renderBadge({ sourceProvider: "manual" });
    expect(getBadgeTrigger()).not.toBeInTheDocument();

    cleanup();

    renderBadge({ sourceProvider: "takeoff_gemini" });
    expect(getBadgeTrigger()).toBeInTheDocument();
  });

  it("opens popover on hover or click and shows expected provenance content", async () => {
    renderBadge();

    await openPopoverOnHoverOrClick();

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("lot-source.pdf");
    expect(tooltip).toHaveTextContent("47");
    expect(tooltip).toHaveTextContent("2031");
    expect(tooltip).toHaveTextContent("B");
    expect(within(tooltip).queryByRole("link")).toBeInTheDocument();
  });

  it("shows Non disponible when provenance metadata is missing", async () => {
    renderBadge({
      sourceFileName: null,
      sourcePage: null,
      sourceJobId: null,
      sourceLevel: null,
      extractedAt: null,
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
});
