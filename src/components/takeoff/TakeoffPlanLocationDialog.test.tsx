import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig, useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TakeoffPlanLocationDialog } from "@/components/takeoff/TakeoffPlanLocationDialog";
import { TakeoffApiError } from "@/lib/takeoff/client-http";
import { readPlanLocation, resolvePlanLocation } from "@/lib/takeoff/plan-location";
import type { TakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-contracts";

// The dialogue against its HTTP boundary: what it sends for what the member did, nothing else.
const fetchLocation = vi.hoisted(() => vi.fn());
const saveLocation = vi.hoisted(() => vi.fn());
vi.mock("@/lib/takeoff/plan-location-client", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/takeoff/plan-location-client")>(),
  fetchTakeoffPlanFileLocation: fetchLocation,
  saveTakeoffPlanFileLocation: saveLocation,
}));

const SET_ID = "11111111-1111-4111-8111-111111111111";
const FILE_ID = "22222222-2222-4222-8222-222222222222";
const ORIGIN_ID = "33333333-3333-4333-8333-333333333333";
const HASH = "c".repeat(64);
const reading = readPlanLocation({ originalName: null, pageCount: 1, pages: [{ page: 1, titleBlockText: "BÂTIMENT A NIVEAU L00" }] });

/** An earlier correction offered for these bytes, at the given generation. */
function carry(revision: number, level: string) {
  return { id: ORIGIN_ID, revision, document_name: "P-101.pdf", content_hash: "d".repeat(64), same_source: true,
    building: { value: "A", set_by_name: "Alice Fictive", set_at: "2026-11-20T08:00:00Z" },
    level: { value: level, set_by_name: "Alice Fictive", set_at: "2026-11-20T08:00:00Z" } };
}

function planLocation(carryOver: ReturnType<typeof carry> | null = null): TakeoffPlanFileLocation {
  const values = carryOver ? { building: carryOver.building.value, level: carryOver.level.value } : null;
  return {
    project_id: "44444444-4444-4444-8444-444444444444", plan_set_id: SET_ID, plan_file_id: FILE_ID, document_name: "P-101.pdf",
    revision: { source_kind: "plan_file", source_id: FILE_ID, content_hash: HASH }, current_copy: true, reading, reading_issue: null,
    annotation: null, carry_over: carryOver as TakeoffPlanFileLocation["carry_over"],
    location: resolvePlanLocation({ reading, annotation: null, carryOver: values }),
    suggestions: { building: [], level: [] }, can_edit: true,
  };
}

/** Reads the plan's location again, as the data library does on its own (a reconnect, a focus). */
function BackgroundRead() {
  const { mutate } = useSWRConfig();
  return <button type="button" data-testid="background-read" onClick={() => void mutate(`takeoff-plan-location:${SET_ID}:${FILE_ID}`)} />;
}

/** The location the route answers after a save: the annotation it stored, from the request it received. */
function saved(_setId: string, _fileId: string, body: { building: { choice: string; value: string | null };
  level: { choice: string; value: string | null } }): TakeoffPlanFileLocation {
  const field = (choice: { choice: string; value: string | null }) => ({ choice: choice.choice as "reading" | "value" | "unknown",
    value: choice.value, carried: false, set_by: ORIGIN_ID, set_by_name: "Membre Fictif", set_at: "2026-11-21T08:00:00Z", set_revision: 1 });
  const annotation = { id: ORIGIN_ID, revision: 1, building: field(body.building), level: field(body.level), carried_from_id: null,
    carried_from_revision: null, document_name: "P-101.pdf", updated_by: ORIGIN_ID, updated_by_name: "Membre Fictif",
    updated_at: "2026-11-21T08:00:00Z", created_at: "2026-11-21T08:00:00Z" };
  return { ...planLocation(), annotation, location: resolvePlanLocation({ reading, carryOver: null,
    annotation: { building: { choice: annotation.building.choice, value: annotation.building.value },
      level: { choice: annotation.level.choice, value: annotation.level.value } } }) };
}

function open() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BackgroundRead />
      <TakeoffPlanLocationDialog setId={SET_ID} fileId={FILE_ID} documentName="P-101.pdf" open onOpenChange={() => undefined} />
    </SWRConfig>,
  );
}

const fieldset = (name: "building" | "level") => screen.getByTestId(`plan-location-choice-${name}`);

beforeEach(() => {
  fetchLocation.mockReset();
  saveLocation.mockReset();
});
afterEach(cleanup);

describe("what a save confirms", () => {
  // Written first, failing: editing only the level also sent the untouched, deduced building as a value, and the save
  // stamped it confirmed by the member.
  it("leaves a field the member did not touch to the plan's reading, and confirms a deduced value only when chosen", async () => {
    const user = userEvent.setup();
    fetchLocation.mockResolvedValue(planLocation());
    saveLocation.mockImplementation(async (...args: Parameters<typeof saved>) => saved(...args));
    open();
    const level = within(await screen.findByTestId("plan-location-choice-level")).getByLabelText("Niveau");
    await user.clear(level);
    await user.type(level, "L01");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(saveLocation).toHaveBeenLastCalledWith(SET_ID, FILE_ID, { content_hash: HASH, expected_revision: 0,
      building: { choice: "reading", value: null }, level: { choice: "value", value: "L01" }, carried_from: null });
    // Confirming the building's reading is its own act: « Valeur saisie », prefilled with what the plan shows.
    expect(await within(fieldset("level")).findByDisplayValue("L01")).toBeInTheDocument();
    await user.click(within(fieldset("building")).getByRole("radio", { name: "Valeur saisie" }));
    expect(within(fieldset("building")).getByLabelText("Bâtiment")).toHaveValue("A");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(saveLocation).toHaveBeenLastCalledWith(SET_ID, FILE_ID, expect.objectContaining({ expected_revision: 1,
      building: { choice: "value", value: "A" }, level: { choice: "value", value: "L01" } }));
  });
});

describe("a carried correction that moved before the save", () => {
  // Written first, failing: after the 409 the form kept the earlier value L02; the next click compared it with the
  // refreshed L03, dropped the level from the carried fields and saved L02 as typed by the member.
  it("shows the origin's current value, says the proposal changed, and saves nothing the member did not type", async () => {
    const user = userEvent.setup();
    fetchLocation.mockResolvedValueOnce(planLocation(carry(2, "L02"))).mockResolvedValue(planLocation(carry(3, "L03")));
    saveLocation.mockRejectedValueOnce(new TakeoffApiError("La correction de la version précédente a changé depuis son affichage.", 409,
      { reason: "TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED" }, "CONFLICT")).mockImplementation(async () => planLocation());
    open();
    await user.click(await screen.findByRole("button", { name: "Valider pour cette version" }));
    expect(saveLocation).toHaveBeenNthCalledWith(1, SET_ID, FILE_ID, expect.objectContaining({ level: { choice: "value", value: "L02" },
      carried_from: { id: ORIGIN_ID, revision: 2, fields: ["building", "level"] } }));
    expect(await screen.findByTestId("plan-location-notice")).toHaveTextContent("La correction de la version précédente a changé");
    expect(await within(fieldset("level")).findByDisplayValue("L03")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Valider pour cette version" }));
    expect(saveLocation).toHaveBeenNthCalledWith(2, SET_ID, FILE_ID, expect.objectContaining({ level: { choice: "value", value: "L03" },
      carried_from: { id: ORIGIN_ID, revision: 3, fields: ["building", "level"] } }));
  });
});

describe("a background read that brings another proposal", () => {
  // Written first, failing: the form remounted when the origin's generation changed, and the building the member had
  // typed was gone without a word.
  it("keeps what the member typed in a field the change does not concern, and says the proposal changed", async () => {
    const user = userEvent.setup();
    fetchLocation.mockResolvedValueOnce(planLocation(carry(2, "L02"))).mockResolvedValue(planLocation(carry(3, "L03")));
    open();
    const building = within(await screen.findByTestId("plan-location-choice-building")).getByLabelText("Bâtiment");
    await user.clear(building);
    await user.type(building, "B");
    await act(async () => { screen.getByTestId("background-read").click(); });
    expect(await within(fieldset("level")).findByDisplayValue("L03")).toBeInTheDocument();
    expect(within(fieldset("building")).getByLabelText("Bâtiment")).toHaveValue("B");
    expect(screen.getByTestId("plan-location-proposal-changed")).toHaveTextContent("La proposition a changé");
    expect(saveLocation).not.toHaveBeenCalled();
  });
});
