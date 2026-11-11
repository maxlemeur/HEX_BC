import { describe, expect, it } from "vitest";

import { buildOfferReserveSentence, readOfferTreatment } from "@/lib/estimates/offer-treatment";
import {
  buildOfferTreatmentDecisions,
  buildOfferTreatmentRows,
  initialOfferReserveBasis,
  initialOfferTreatmentValues,
  type OfferTreatmentDraftItem,
} from "@/lib/estimates/offer-treatment-draft";

const ID = (n: number) => `d6820000-0000-4000-8001-${String(n).padStart(12, "0")}`;

function item(n: number, title: string, pricing_status: string | null, extra: Partial<OfferTreatmentDraftItem> = {}): OfferTreatmentDraftItem {
  return { id: ID(n), parent_id: ID(100), item_type: "line", title, pricing_status, source_metadata: null, ...extra };
}

function stored(treatment: Record<string, unknown>) {
  return { offer_treatment: { version: 1, decided_by: ID(900), decided_at: "2026-11-11T10:00:00.000Z", ...treatment } };
}

function reserve(title: string, text: string, basis = "private_estimate") {
  return stored({ kind: "offer_reserve", basis, text, sentence: buildOfferReserveSentence(title, text) });
}

const section: OfferTreatmentDraftItem = { id: ID(100), parent_id: null, item_type: "section", title: "Lot plomberie" };

/** The offer text holds every stored reserve unless a test says what it holds. */
function draft(items: OfferTreatmentDraftItem[], limitsText?: string | null) {
  const written = items.flatMap((entry) => {
    const read = readOfferTreatment(entry.source_metadata);
    return read.state === "read" && read.treatment.kind === "offer_reserve" ? [read.treatment.sentence] : [];
  }).join("\n");
  const rows = buildOfferTreatmentRows([section, ...items], limitsText === undefined ? written : limitsText);
  return { rows, values: initialOfferTreatmentValues(rows), basis: initialOfferReserveBasis(rows) };
}

describe("buildOfferTreatmentRows", () => {
  it("lists the unpriced lines, the lines left out of the price, and the priced lines that carry a reserve or a takeoff provision", () => {
    const { rows } = draft([
      item(1, "Calorifuge", "not_priced"),
      item(2, "Percements", "out_of_scope"),
      item(3, "Réseau EU", "priced"),
      item(4, "Réseau EV", "priced", { source_metadata: reserve("Réseau EV", "quantité provisoire") }),
      item(5, "Chutes", "priced", { source_metadata: { takeoff_provision: { version: 1, job_id: "j", sources: [] } } }),
      item(6, "Essais", "included"),
    ]);
    expect(rows.map((row) => [row.id, row.group, row.listed])).toEqual([
      [ID(1), "not_priced", true], [ID(2), "exclusion", true], [ID(3), "priced", false],
      [ID(4), "priced", true], [ID(5), "priced", true], [ID(6), "exclusion", true],
    ]);
    expect(rows[0]).toMatchObject({ title: "Calorifuge", sectionTitle: "Lot plomberie", statusLabel: "Non chiffrée" });
    expect(rows[4].hasTakeoffProvision).toBe(true);
    expect(rows[1].reasonExpected).toBe(true);
    expect(rows[5].reasonExpected).toBe(false);
  });

  it("reads the stored decisions as the starting values and the basis of the estimate", () => {
    const { rows, values, basis } = draft([
      item(1, "Calorifuge", "not_priced", { source_metadata: reserve("Calorifuge", "à définir", "indicative_quantities") }),
      item(2, "Percements", "out_of_scope",
        { source_metadata: stored({ kind: "internal_exclusion", reason_code: "other", note: "Voir CCTP 3.2" }) }),
    ]);
    expect(basis).toBe("indicative_quantities");
    expect(values[ID(1)]).toEqual({ reasonCode: "", note: "", reserveText: "à définir" });
    expect(values[ID(2)]).toEqual({ reasonCode: "other", note: "Voir CCTP 3.2", reserveText: "" });
    expect(rows.every((row) => !row.staleReserve && !row.unreadable && !row.reserveToRewrite)).toBe(true);
  });

  it("marks a reserve whose sentence names a former title of its line", () => {
    const renamed = item(1, "Isolation réseaux", "not_priced", { source_metadata: reserve("Calorifuge", "à définir") });
    expect(draft([renamed]).rows[0]).toMatchObject({ reserveToRewrite: true, stored: { text: "à définir" } });
  });

  it("marks a reserve whose sentence has left the offer text", () => {
    const items = [
      item(1, "Calorifuge", "not_priced", { source_metadata: reserve("Calorifuge", "à définir") }),
      item(2, "Réseau EV", "priced", { source_metadata: reserve("Réseau EV", "quantité provisoire") }),
    ];
    const { rows } = draft(items, `Hors peinture.\n${buildOfferReserveSentence("Réseau EV", "quantité provisoire")}`);
    expect(rows.map((row) => row.reserveToRewrite)).toEqual([true, false]);
    expect(draft(items, null).rows.map((row) => row.reserveToRewrite)).toEqual([true, true]);
  });

  it("marks a reserve kept from an earlier status and a decision that cannot be read", () => {
    const { rows, values } = draft([
      item(1, "Percements", "out_of_scope", { source_metadata: reserve("Percements", "à définir") }),
      item(2, "Réseau EU", "priced", { source_metadata: { offer_treatment: { kind: "offer_reserve" } } }),
    ]);
    expect(rows[0]).toMatchObject({ group: "exclusion", staleReserve: true, stored: null });
    expect(rows[1]).toMatchObject({ group: "priced", unreadable: true, listed: true, stored: null });
    expect(values[ID(1)]).toEqual({ reasonCode: "", note: "", reserveText: "" });
  });
});

describe("buildOfferTreatmentDecisions", () => {
  it("sends nothing when nothing changed", () => {
    const state = draft([
      item(1, "Calorifuge", "not_priced", { source_metadata: reserve("Calorifuge", "à définir") }),
      item(2, "Percements", "out_of_scope"),
    ]);
    expect(buildOfferTreatmentDecisions(state)).toEqual({ ok: true, remaining: 0, decisions: [] });
  });

  it("sends the changed lines only: a new reserve, a new reason, a withdrawal", () => {
    const state = draft([
      item(1, "Calorifuge", "not_priced"),
      item(2, "Percements", "out_of_scope"),
      item(3, "Réseau EV", "priced", { source_metadata: reserve("Réseau EV", "quantité provisoire") }),
      item(4, "Essais", "included", { source_metadata: stored({ kind: "internal_exclusion", reason_code: "other_lot", note: null }) }),
    ]);
    state.values[ID(1)] = { reasonCode: "", note: "", reserveText: "  non chiffré,\n à définir " };
    state.values[ID(2)] = { reasonCode: "client_supplied", note: " ", reserveText: "" };
    state.values[ID(3)] = { reasonCode: "", note: "", reserveText: "" };
    expect(buildOfferTreatmentDecisions(state)).toEqual({ ok: true, remaining: 0, decisions: [
      { item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: "non chiffré, à définir" } },
      { item_id: ID(2), decision: { kind: "internal_exclusion", reason_code: "client_supplied", note: null } },
      { item_id: ID(3), decision: null },
    ] });
  });

  it("sends every reserve again when the basis changes or the title of its line changed", () => {
    const state = draft([
      item(1, "Calorifuge", "not_priced", { source_metadata: reserve("Calorifuge", "à définir") }),
      item(2, "Réseau EV renommé", "priced", { source_metadata: reserve("Réseau EV", "quantité provisoire") }),
    ]);
    expect(buildOfferTreatmentDecisions(state)).toMatchObject({ ok: true, decisions: [{ item_id: ID(2) }] });
    expect(buildOfferTreatmentDecisions({ ...state, basis: "indicative_quantities" })).toMatchObject({ ok: true, decisions: [
      { item_id: ID(1), decision: { basis: "indicative_quantities" } },
      { item_id: ID(2), decision: { basis: "indicative_quantities" } },
    ] });
  });

  it("writes again an unchanged reserve whose sentence has left the offer text", () => {
    const state = draft([
      item(1, "Calorifuge", "not_priced", { source_metadata: reserve("Calorifuge", "à définir") }),
      item(2, "Réseau EV", "priced", { source_metadata: reserve("Réseau EV", "quantité provisoire") }),
    ], buildOfferReserveSentence("Réseau EV", "quantité provisoire"));
    expect(buildOfferTreatmentDecisions(state)).toEqual({ ok: true, remaining: 0, decisions: [
      { item_id: ID(1), decision: { kind: "offer_reserve", basis: "private_estimate", text: "à définir" } },
    ] });
  });

  it("asks for the basis of a reserve and for the precision of « Autre motif »", () => {
    const state = draft([item(1, "Calorifuge", "not_priced"), item(2, "Percements", "out_of_scope")]);
    state.values[ID(1)] = { reasonCode: "", note: "", reserveText: "à définir" };
    expect(buildOfferTreatmentDecisions(state)).toMatchObject({ ok: false, field: "basis" });
    state.values[ID(1)] = { reasonCode: "", note: "", reserveText: "" };
    state.values[ID(2)] = { reasonCode: "other", note: "  ", reserveText: "" };
    expect(buildOfferTreatmentDecisions({ ...state, basis: "private_estimate" })).toMatchObject({ ok: false, itemId: ID(2) });
  });

  it("withdraws a reserve kept from an earlier status and replaces a decision that cannot be read", () => {
    const state = draft([
      item(1, "Percements", "out_of_scope", { source_metadata: reserve("Percements", "à définir") }),
      item(2, "Réseau EU", "priced", { source_metadata: { offer_treatment: { kind: "offer_reserve" } } }),
      item(3, "Essais", "not_applicable", { source_metadata: reserve("Essais", "à définir") }),
    ]);
    state.values[ID(3)] = { reasonCode: "not_applicable", note: "", reserveText: "" };
    expect(buildOfferTreatmentDecisions(state)).toEqual({ ok: true, remaining: 0, decisions: [
      { item_id: ID(1), decision: null },
      { item_id: ID(2), decision: null },
      { item_id: ID(3), decision: { kind: "internal_exclusion", reason_code: "not_applicable", note: null } },
    ] });
  });

  it("sends 500 changed lines per save, the reserves first, and counts what is left for the next save", () => {
    const state = draft([
      ...Array.from({ length: 600 }, (_, index) => item(index + 1, `Ligne ${index + 1}`, "out_of_scope")),
      item(700, "Calorifuge", "not_priced"),
      item(701, "Réseau EV", "priced", { source_metadata: reserve("Réseau EV", "quantité provisoire") }),
    ]);
    for (const row of state.rows.slice(0, 600)) state.values[row.id] = { reasonCode: "other_lot", note: "", reserveText: "" };
    state.values[ID(700)] = { reasonCode: "", note: "", reserveText: "à définir" };
    state.values[ID(701)] = { reasonCode: "", note: "", reserveText: "" };
    const built = buildOfferTreatmentDecisions(state);
    if (!built.ok) throw new Error(built.message);
    expect(built.remaining).toBe(102);
    expect(built.decisions).toHaveLength(500);
    // A reserve written or withdrawn changes the offer text: it never waits behind 500 reasons.
    expect(built.decisions.slice(0, 3)).toEqual([
      { item_id: ID(700), decision: { kind: "offer_reserve", basis: "private_estimate", text: "à définir" } },
      { item_id: ID(701), decision: null },
      { item_id: ID(1), decision: { kind: "internal_exclusion", reason_code: "other_lot", note: null } },
    ]);
  });
});
