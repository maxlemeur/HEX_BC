// Failure case written before the TI-675 fix:
// 1. The picker's document keydown listener is registered again by a passive
//    effect each time the filtered templates change. The search applies 200 ms
//    after typing, outside any discrete event, so for one task the list shows the
//    filtered templates while Entrée still runs the previous handler: it inserted
//    the first template of the unfiltered list, which is no longer shown.
// A browser journey cannot press Entrée between that commit and its effects;
// beforePassiveEffectsOf replays that ordering on every run.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuickTemplatePicker } from "@/components/estimates/editor/QuickTemplatePicker";
import type { EstimateTemplateSummary } from "@/lib/estimates/client";
import { beforePassiveEffectsOf } from "@/test/before-passive-effects";

const fetchEstimateTemplatesMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/estimates/client", () => ({ fetchEstimateTemplates: fetchEstimateTemplatesMock }));

function template(id: string, name: string): EstimateTemplateSummary {
  return { id, name, description: null, sourceVersionId: null, createdBy: null, createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", itemCount: 3 };
}

afterEach(cleanup);

describe("QuickTemplatePicker", () => {
  it("inserts the first filtered template when Entrée follows the search", async () => {
    fetchEstimateTemplatesMock.mockResolvedValue([template("template-kitchen", "Cuisine équipée"), template("template-bathroom", "Salle de bain")]);
    const onInsert = vi.fn().mockResolvedValue(undefined);
    render(<SWRConfig value={{ provider: () => new Map() }}><QuickTemplatePicker isOpen isReadOnly={false} onInsert={onInsert} onClose={vi.fn()} /></SWRConfig>);
    await screen.findByText("Cuisine équipée");

    const search = screen.getByRole("searchbox", { name: "Rechercher par nom" });
    fireEvent.change(search, { target: { value: "salle" } });
    const pressed = beforePassiveEffectsOf(() => screen.queryByText("Cuisine équipée") === null, () => fireEvent.keyDown(search, { key: "Enter" }));
    await pressed.done();

    await waitFor(() => expect(onInsert).toHaveBeenCalledTimes(1));
    expect(onInsert).toHaveBeenCalledWith("template-bathroom");
  });
});
