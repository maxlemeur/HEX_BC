import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SEND_CONTEXT_CHANGED_LABEL, TakeoffSendContextNotice, sendContextChangedItemIds } from "@/components/takeoff/review/TakeoffSendContextNotice";

const LINES = ["55555555-5555-4555-8555-555555555551", "55555555-5555-4555-8555-555555555552"];

afterEach(cleanup);

describe("TakeoffSendContextNotice", () => {
  it("shows nothing when nothing the send compared has changed", () => {
    const { container } = render(<TakeoffSendContextNotice context={{ changed: false, sent_at: "2026-11-22T10:00:00Z", changes: [],
      item_ids: LINES }} />);
    expect(container).toBeEmptyDOMElement();
    expect(sendContextChangedItemIds({ changed: false, sent_at: "2026-11-22T10:00:00Z", changes: [], item_ids: LINES }).size).toBe(0);
  });

  it("names each change since the send and the lines it concerns, which stay as sent", () => {
    const context = { changed: true, sent_at: "2026-11-22T10:00:00Z", item_ids: LINES, changes: [
      { reason: "location_changed" as const, plan_name: "plan-b.pdf" },
      { reason: "peer_replaced" as const, plan_name: "plan-c.pdf" },
    ] };
    render(<TakeoffSendContextNotice context={context} />);
    const notice = screen.getByRole("region", { name: SEND_CONTEXT_CHANGED_LABEL });
    expect(within(notice).getByText(/2 lignes envoyées sont concernées\. Elles restent telles qu’envoyées\./)).toBeInTheDocument();
    expect(within(within(notice).getByRole("list", { name: "Changements depuis l’envoi" })).getAllByRole("listitem").map((item) => item.textContent))
      .toEqual(["la localisation de « plan-b.pdf » a été corrigée", "« plan-c.pdf », avec lequel ce plan a été comparé, a été relu"]);
    expect([...sendContextChangedItemIds(context)]).toEqual(LINES);
  });
});
