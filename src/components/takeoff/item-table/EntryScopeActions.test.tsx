import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fixtureItemTable, fixturePoste, fixtureItemId, fixtureReading, fixtureAnswer, FIXTURE_MEMBER } from "@/lib/takeoff/item-table.test-fixtures";
import type { ItemEntryView } from "@/lib/takeoff/item-table";
import * as client from "@/lib/takeoff/item-table-client";
import { EntryScopeActions } from "./EntryScopeActions";

const source: ItemEntryView = { itemId: fixtureItemId(0), scope: "affaire", planKey: null, revision: 2,
  quantity: 0.0005, unit: "u", category: "site_survey", note: null, actorId: FIXTURE_MEMBER,
  at: "2026-11-22T08:00:00Z", previous: null, included: true };

function open() {
  const line = fixtureItemTable({ items: [fixturePoste(0, "Vanne")], entries: [source],
    readings: [fixtureReading(0, "plan-rdc", fixtureAnswer("not_found", null))] }).page.lines[0];
  const refresh = vi.fn();
  render(<EntryScopeActions projectId="affaire" viewerKey="membre" line={line} filtered={false} version={0}
    onRefused={() => false} onRefresh={refresh} />);
  return refresh;
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("shows both distinct stored quantities when attaching over a plan entry", async () => {
  vi.spyOn(client, "sendEntryScope").mockResolvedValue({ outcome: "collision", entry: {
    quantity: 0.0004, unit: "u", revision: 3, category: "site_survey", actor_id: FIXTURE_MEMBER, author: "Léa", entered_at: source.at,
  } });
  open();
  fireEvent.click(screen.getByText("Rattacher cette saisie à un plan"));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Plan de destination"), { target: { value: "plan-rdc" } });
  fireEvent.click(dialog.getByRole("button", { name: "Rattacher" }));
  expect(await dialog.findByRole("status")).toHaveTextContent("0,0004 u");
  expect(screen.getByRole("dialog")).toHaveTextContent("0,0005 u");
});

it("reconciles after leaving a withdrawal whose response was lost", async () => {
  vi.spyOn(client, "sendEntryScope").mockRejectedValue(new Error("response lost"));
  const refresh = open();
  fireEvent.click(screen.getByText("Retirer la saisie de l’affaire"));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.click(dialog.getByRole("button", { name: "Retirer" }));
  await dialog.findByRole("alert");
  fireEvent.click(dialog.getByRole("button", { name: "Annuler" }));
  expect(refresh).toHaveBeenCalledOnce();
});
