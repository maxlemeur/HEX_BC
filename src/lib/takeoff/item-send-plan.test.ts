import { describe, expect, it } from "vitest";

import {
  ITEM_SEND_COMPLEMENT_SECTION_TITLE,
  itemSendLineAfter,
  planTakeoffItemSend,
  type ItemSendAnswer,
  type ItemSendDraftLine,
  type ItemSendInput,
  type ItemSendListItem,
  type ItemSendPlanLocation,
} from "@/lib/takeoff/item-send-plan";
import { projectItemSendRules } from "@/lib/takeoff/item-send-rules";
import type { TakeoffMappingRule } from "@/lib/takeoff/types";

// Lot 4, PR 5a: from the accepted answers of one plan to the write plan of its send to the estimate, computed before the
// module existed. Fictional affaire, plans and quantities.

const JOB = "10000000-0000-4000-8000-000000000001";
const OTHER_JOB = "10000000-0000-4000-8000-000000000002";
const VERSION = "20000000-0000-4000-8000-000000000001";
const IMPORT = "30000000-0000-4000-8000-000000000001";
const OLD_IMPORT = "30000000-0000-4000-8000-000000000002";
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const itemId = (n: number) => id("40000000", n);
const lineId = (n: number) => id("50000000", n);
const sectionId = (n: number) => id("60000000", n);

const LOT = { id: "lot-plomberie", title: "Plomberie", order: 1 };
const SANITAIRES = { id: "fam-sanitaires", title: "Appareils sanitaires", order: 2 };
const RESEAUX = { id: "fam-reseaux", title: "Réseaux", order: 3 };

function templateItem(n: number, label: string, unit: string | null, sections = [LOT, SANITAIRES],
  extra: Partial<ItemSendListItem> = {}): ItemSendListItem {
  return { id: itemId(n), label, expectedUnit: unit, measurementBasis: null, qualifiers: {}, sections, referenceQuantity: null,
    origin: { kind: "template", templateId: "plomberie", version: 1, familyId: sections[1]?.id ?? "f", lineId: `line-${n}` }, ...extra };
}

function dpgfItem(n: number, label: string, unit: string, rawRow: string, mappedRow: string, reference: number | null): ItemSendListItem {
  return { id: itemId(n), label, expectedUnit: unit, measurementBasis: null, qualifiers: {}, sections: [LOT], referenceQuantity: reference,
    origin: { kind: "dpgf", importId: IMPORT, mappingId: "mapping-1", rawRowId: rawRow, mappedRowId: mappedRow, rowIndex: n,
      sheetName: null, sourceRowNumber: n, sourcePage: null, tableIndex: null, documentId: null, reference: `1.${n}`,
      sourceUnit: unit, measurementNotesDigest: null, factsDigest: "facts" } };
}

let observationCount = 0;
function measured(item: ItemSendListItem, parts: Array<{ quantity: number; unit?: string; page: number; role?: "contribution" | "alternative" | "candidate"; basis?: string | null }>,
  extra: Partial<ItemSendAnswer> = {}): ItemSendAnswer {
  return {
    itemId: item.id, answerId: id("70000000", Number(item.id.slice(-4))), revision: "r1", outcome: "measured", anomalies: [], decision: null, entry: null,
    observations: parts.map((part) => ({ observationId: `obs-${++observationCount}`, role: part.role ?? "contribution", source: "model",
      quantity: part.quantity, unit: part.unit ?? item.expectedUnit ?? "u", page: part.page, measurementBasis: part.basis ?? null })),
    ...extra,
  };
}

const confirmed = (value: string): ItemSendPlanLocation["level"] => ({ value, state: "confirmed" });
const located = (building: string | null, level: string | null): ItemSendPlanLocation => ({
  building: building ? confirmed(building) : { value: null, state: "unknown" },
  level: level ? confirmed(level) : { value: null, state: "unknown" },
  generation: 1,
});

function input(overrides: Partial<ItemSendInput> & Pick<ItemSendInput, "items" | "answers">): ItemSendInput {
  return {
    job: { id: JOB, status: "completed", sent: false, canEdit: true },
    plan: { key: "plan-a", name: "Plan A — RDC", location: located("A", "RDC") },
    list: { revisionId: id("80000000", 1), revision: 3 },
    scope: overrides.items.map((item) => item.id),
    affaireEntries: [],
    destination: { kind: "first_draft", engine: 3, maxSectionDepth: 3 },
    earlier: { targets: [], sections: [] },
    pagesInEstimate: [],
    rules: new Map(),
    breakdown: "together",
    resolutions: [],
    ...overrides,
  };
}

function draft(lines: ItemSendDraftLine[], extra: { sections?: Array<{ id: string; parentId: string | null; title: string | null }>; engine?: 1 | 2 | 3 } = {}):
  ItemSendInput["destination"] {
  return { kind: "existing_draft", versionId: VERSION, engine: extra.engine ?? 3, maxSectionDepth: 3,
    sections: (extra.sections ?? []).map((section, index) => ({ ...section, position: index + 1 })), lines };
}

function line(n: number, overrides: Partial<ItemSendDraftLine> = {}): ItemSendDraftLine {
  return { id: lineId(n), parentId: null, title: `Ligne ${n}`, unitCode: "u", pricingStatus: "priced", quantity: 0,
    updatedAt: "2026-11-22T08:00:00.000Z", dpgf: null, ...overrides };
}

function dpgfLine(n: number, mappedRow: string | null, rawRow: string | null, reference: number | null, overrides: Partial<ItemSendDraftLine> = {}) {
  return line(n, { quantity: reference ?? 0, dpgf: { importId: IMPORT, mappedRowId: mappedRow, rawRowId: rawRow, reference, composition: { version: 0 } },
    ...overrides });
}

const lavabo = templateItem(1, "Lavabo", "u");
const wc = templateItem(2, "WC suspendu", "u");

describe("planTakeoffItemSend — the unit of a send is the retained lines of this plan", () => {
  it("lists every line it does not send with its reason, and never adds a hypothesis not retained", () => {
    const douche = templateItem(3, "Receveur de douche", "u");
    const baignoire = templateItem(4, "Baignoire", "u");
    const evier = templateItem(5, "Évier", "u");
    const vasque = templateItem(6, "Vasque", "u");
    const plan = planTakeoffItemSend(input({
      items: [lavabo, wc, douche, baignoire, evier, vasque],
      answers: [
        measured(lavabo, [{ quantity: 3, page: 2 }]),
        measured(wc, [{ quantity: 2, page: 2 }], { decision: { kind: "set_aside", revision: 1 } }),
        { ...measured(douche, []), outcome: "not_found" },
        { ...measured(baignoire, [{ quantity: 1, page: 3, role: "candidate" }]), outcome: "uncertain" },
        { ...measured(evier, []), outcome: "uncertain",
          entry: { revision: 1, quantity: 4, unit: "u", category: "hypothesis", included: false } },
        measured(vasque, [{ quantity: 2, unit: "ml", page: 2 }]),
      ],
    }));
    expect(plan.targets.map((target) => [target.label, target.quantity.after])).toEqual([["Lavabo", 3]]);
    expect(plan.notSent.map((entry) => [entry.label, entry.reason])).toEqual([
      ["WC suspendu", "set_aside"], ["Receveur de douche", "not_found"], ["Baignoire", "uncertain"],
      ["Évier", "hypothesis_not_included"], ["Vasque", "unit_incompatible"],
    ]);
    expect(plan.confirmable).toBe(true);
  });

  it("sends an included entry as the plan's quantity, kept apart from the raw reading", () => {
    const douche = templateItem(3, "Receveur de douche", "u");
    const plan = planTakeoffItemSend(input({ items: [douche], answers: [{ ...measured(douche, []), outcome: "not_found",
      entry: { revision: 2, quantity: 2, unit: "u", category: "site_survey", included: true } }] }));
    expect(plan.targets[0].contributions).toEqual([expect.objectContaining({ kind: "entered", quantity: 2, pages: [] })]);
    expect(plan.targets[0].quantity.after).toBe(2);
  });

  it("never adds a plan's measure to a quantity entered for the whole affaire", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 3, page: 2 }])],
      affaireEntries: [{ itemId: lavabo.id, revision: 1 }] }));
    expect(plan.targets).toEqual([]);
    expect(plan.notSent).toEqual([expect.objectContaining({ itemId: lavabo.id, reason: "affaire_entry" })]);
  });

  it("holds an answer with an anomaly nobody accepted, and sends it once accepted", () => {
    const flagged = measured(lavabo, [{ quantity: 3, page: 2 }], { anomalies: ["low_confidence"] });
    const held = planTakeoffItemSend(input({ items: [lavabo], answers: [flagged] }));
    expect(held.targets).toEqual([]);
    expect(held.toResolve).toEqual([expect.objectContaining({ itemId: lavabo.id, kind: "review_required", options: [{ kind: "leave_out" }] })]);
    expect(held.confirmable).toBe(false);
    const accepted = planTakeoffItemSend(input({ items: [lavabo], answers: [{ ...flagged, decision: { kind: "accepted", revision: 1 } }] }));
    expect(accepted.targets.map((target) => target.quantity.after)).toEqual([3]);
  });

  it("refuses an item of the sealed scope without its answer, and an answer outside it", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo, wc], scope: [lavabo.id, wc.id],
      answers: [measured(lavabo, [{ quantity: 3, page: 2 }])] }));
    expect(plan.notSent).toEqual([expect.objectContaining({ itemId: wc.id, reason: "no_answer" })]);
    expect(() => planTakeoffItemSend(input({ items: [lavabo, wc], scope: [lavabo.id],
      answers: [measured(lavabo, [{ quantity: 3, page: 2 }]), measured(wc, [{ quantity: 1, page: 2 }])] })))
      .toThrow(/hors de la portée/);
  });
});

describe("planTakeoffItemSend — grouping", () => {
  it("adds only the contributions: an alternative reading of the same WC on a detail plan is never a sixth fixture", () => {
    const plan = planTakeoffItemSend(input({ items: [wc], answers: [measured(wc, [
      { quantity: 3, page: 1 }, { quantity: 2, page: 2 }, { quantity: 1, page: 4, role: "alternative" },
    ])] }));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].quantity.after).toBe(5);
    expect(plan.notAdded).toEqual([expect.objectContaining({ itemId: wc.id, role: "alternative", quantity: 1, page: 4 })]);
  });

  it("plan A sent 3 washbasins, plan B brings 2: one line of five, never five unit lines", () => {
    const earlierLine = line(1, { title: "Lavabo", quantity: 3, parentId: sectionId(2) });
    const plan = planTakeoffItemSend(input({
      plan: { key: "plan-b", name: "Plan B — R+1", location: located("A", "R+1") },
      items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])],
      destination: draft([earlierLine], { sections: [{ id: sectionId(1), parentId: null, title: "Plomberie" },
        { id: sectionId(2), parentId: sectionId(1), title: "Appareils sanitaires" }] }),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 3, unit: "u", pages: [1] }] }], sections: [] },
    }));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].line).toEqual(expect.objectContaining({ kind: "earlier_line", estimateItemId: earlierLine.id }));
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ before: 3, earlier: 3, added: 2, after: 5 }));
    expect(plan.sections).toEqual([]);
  });

  it("splits by level 3 and 2, keeps the sum, and gives an unknown or multiple level to « Non réparti »", () => {
    const answers = [measured(lavabo, [{ quantity: 3, page: 1 }])];
    const byLevel = planTakeoffItemSend(input({ items: [lavabo], answers, breakdown: "by_level",
      plan: { key: "plan-b", name: "Plan B", location: located("A", "R+1") },
      destination: draft([line(1, { title: "Lavabo", quantity: 2, parentId: sectionId(3) })], { sections: [
        { id: sectionId(1), parentId: null, title: "Plomberie" }, { id: sectionId(2), parentId: sectionId(1), title: "Appareils sanitaires" },
        { id: sectionId(3), parentId: sectionId(2), title: "A · RDC" }] }),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "by_level", compartmentKey: "level:a|rdc", estimateItemId: lineId(1),
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 2, unit: "u", pages: [1] }] }],
      sections: [{ key: `list:${LOT.id}`, estimateItemId: sectionId(1) }, { key: `list:${LOT.id}/${SANITAIRES.id}`, estimateItemId: sectionId(2) },
        { key: `list:${LOT.id}/${SANITAIRES.id}/level:a|rdc`, estimateItemId: sectionId(3) }] } }));
    expect(byLevel.targets.map((target) => [target.compartment.label, target.quantity.after])).toEqual([["A · R+1", 3]]);
    expect(byLevel.sections.map((section) => [section.title, section.parentKey, section.parentExistingId]))
      .toEqual([["A · R+1", `list:${LOT.id}/${SANITAIRES.id}`, sectionId(2)]]);

    const multiple = planTakeoffItemSend(input({ items: [lavabo], answers, breakdown: "by_level",
      plan: { key: "plan-c", name: "Plan C", location: { building: confirmed("A"), level: { value: "RDC", state: "multiple" }, generation: 2 } } }));
    expect(multiple.targets.map((target) => [target.compartment.label, target.compartment.reason, target.quantity.after]))
      .toEqual([["Non réparti", "location_multiple", 3]]);
    const proposed = planTakeoffItemSend(input({ items: [lavabo], answers, breakdown: "by_building",
      plan: { key: "plan-c", name: "Plan C", location: { building: { value: "B", state: "proposed" }, level: confirmed("RDC"), generation: 2 } } }));
    expect(proposed.targets[0].compartment).toEqual({ key: "unallocated", label: "Non réparti", reason: "location_to_confirm" });
  });

  it("keeps two buildings' homonymous levels apart", () => {
    const a = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])], breakdown: "by_level",
      plan: { key: "p", name: "P", location: located("A", "RDC") } }));
    const b = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])], breakdown: "by_level",
      plan: { key: "p", name: "P", location: located("B", "RDC") } }));
    expect(a.targets[0].compartment.key).not.toBe(b.targets[0].compartment.key);
    expect([a.targets[0].compartment.label, b.targets[0].compartment.label]).toEqual(["A · RDC", "B · RDC"]);
  });

  it("refuses to mix « Ensemble » and « Par niveau » on one item of the draft", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])], breakdown: "by_level",
      destination: draft([line(1, { title: "Lavabo", quantity: 3 })]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: lineId(1),
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 3, unit: "u", pages: [1] }] }], sections: [] } }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "breakdown_mixed", itemId: lavabo.id })]);
  });

  it("rounds a length once, on the sum of the compartment", () => {
    const pipe = templateItem(7, "EF cuivre Ø16", "ml", [LOT, RESEAUX]);
    const earlierLine = line(3, { title: "EF cuivre Ø16", unitCode: "ml", quantity: 2 });
    const plan = planTakeoffItemSend(input({ items: [pipe], answers: [measured(pipe, [{ quantity: 1.3, page: 1 }])],
      destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: pipe.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 1.2, unit: "ml", pages: [1] }] }], sections: [] } }));
    // 1.2 + 1.3 = 2.5, rounded up once: 3 (never 2 + 2).
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ before: 2, measured: 2.5, after: 3, roundedFrom: 2.5 }));
  });

  it("never groups two items of different diameters, nor contributions of another basis", () => {
    const d14 = templateItem(8, "Tube cuivre", "ml", [LOT, RESEAUX], { qualifiers: { material: "cuivre", diameter: "14" } });
    const d16 = templateItem(9, "Tube cuivre", "ml", [LOT, RESEAUX], { qualifiers: { material: "cuivre", diameter: "16" } });
    const two = planTakeoffItemSend(input({ items: [d14, d16], answers: [measured(d14, [{ quantity: 4, page: 1 }]),
      measured(d16, [{ quantity: 6, page: 1 }])] }));
    expect(two.targets.map((target) => [target.itemId, target.quantity.after])).toEqual([[d14.id, 4], [d16.id, 6]]);

    const floor = templateItem(10, "Chape", "m2", [LOT, RESEAUX], { measurementBasis: "net_floor" });
    const mixed = planTakeoffItemSend(input({ items: [floor], answers: [measured(floor, [{ quantity: 10, page: 1, basis: "net_floor" },
      { quantity: 12, page: 2, basis: "shab" }])] }));
    expect(mixed.targets).toEqual([]);
    expect(mixed.notSent).toEqual([expect.objectContaining({ itemId: floor.id, reason: "unit_incompatible" })]);
  });
});

describe("planTakeoffItemSend — sections", () => {
  it("creates lot then family from the list, by identity, never onto a homonymous section made by hand", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo, templateItem(11, "Vanne d’arrêt", "u", [LOT, { id: "fam-robinetterie", title: "Réseaux", order: 4 }])],
      answers: [measured(lavabo, [{ quantity: 3, page: 1 }]), measured(templateItem(11, "Vanne d’arrêt", "u"), [{ quantity: 2, page: 1 }])],
      destination: draft([], { sections: [{ id: sectionId(9), parentId: null, title: "Plomberie" }] }) }));
    expect(plan.sections.map((section) => [section.key, section.title, section.parentExistingId, section.homonymInDraft])).toEqual([
      [`list:${LOT.id}`, "Plomberie", null, true],
      [`list:${LOT.id}/${SANITAIRES.id}`, "Appareils sanitaires", null, false],
      [`list:${LOT.id}/fam-robinetterie`, "Réseaux", null, false],
    ]);
  });

  it("asks to choose « Ensemble » when the compartment would exceed the draft's section depth", () => {
    const deep = templateItem(12, "Siphon", "u", [LOT, SANITAIRES, { id: "fam-x", title: "Accessoires", order: 5 }]);
    const plan = planTakeoffItemSend(input({ items: [deep], answers: [measured(deep, [{ quantity: 1, page: 1 }])], breakdown: "by_level" }));
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "section_depth", itemId: deep.id })]);
  });
});

describe("planTakeoffItemSend — DPGF targets and entries", () => {
  const ef = dpgfItem(20, "Lavabo", "u", "raw-20", "mapped-20", 4);
  const efTwin = dpgfItem(21, "Lavabo", "u", "raw-21", "mapped-21", 6);

  it("feeds each DPGF line where it is: two homonyms stay two lines", () => {
    const plan = planTakeoffItemSend(input({ items: [ef, efTwin], breakdown: "by_level",
      answers: [measured(ef, [{ quantity: 3, page: 1 }]), measured(efTwin, [{ quantity: 2, page: 1 }])],
      destination: draft([dpgfLine(20, "mapped-20", "raw-20", 4), dpgfLine(21, "mapped-21", "raw-21", 6)]) }));
    expect(plan.targets.map((target) => [target.line.kind, "estimateItemId" in target.line ? target.line.estimateItemId : null,
      target.compartment.key])).toEqual([["dpgf_line", lineId(20), "dpgf"], ["dpgf_line", lineId(21), "dpgf"]]);
    // The protective maximum of the DPGF policy: max(4, 3) = 4, max(6, 2) = 6; the measure is kept apart.
    expect(plan.targets.map((target) => [target.quantity.measured, target.quantity.after])).toEqual([[3, 4], [2, 6]]);
    expect(plan.sections).toEqual([]);
  });

  it("finds the line of a remapped import through its raw row, and asks a choice for a line deleted or of an older import", () => {
    const remapped = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])],
      destination: draft([dpgfLine(20, "mapped-other", "raw-20", 4)]) }));
    expect(remapped.targets[0].line).toEqual(expect.objectContaining({ kind: "dpgf_line", estimateItemId: lineId(20) }));

    const deleted = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])],
      destination: draft([dpgfLine(22, "mapped-22", "raw-22", 1)]) }));
    expect(deleted.toResolve).toEqual([expect.objectContaining({ kind: "target_missing", itemId: ef.id,
      options: [{ kind: "line", estimateItemId: lineId(22), title: "Ligne 22" }, { kind: "leave_out" }] })]);

    const older = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])],
      destination: draft([dpgfLine(23, "mapped-23", "raw-20", 4, { dpgf: { importId: OLD_IMPORT, mappedRowId: "mapped-23",
        rawRowId: "raw-20", reference: 4, composition: { version: 0 } } })]) }));
    expect(older.toResolve[0]).toEqual(expect.objectContaining({ kind: "target_missing" }));
    // The member's explicit choice of a line offered: the line receives the send, nothing else.
    const chosen = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])],
      destination: draft([dpgfLine(22, "mapped-22", "raw-22", 1)]),
      resolutions: [{ key: deleted.toResolve[0].key, choice: { kind: "line", estimateItemId: lineId(22) } }] }));
    expect(chosen.targets[0].line).toEqual(expect.objectContaining({ estimateItemId: lineId(22) }));
    // A line that was not offered is never written.
    const forged = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])],
      destination: draft([dpgfLine(22, "mapped-22", "raw-22", 1)]),
      resolutions: [{ key: deleted.toResolve[0].key, choice: { kind: "line", estimateItemId: lineId(99) } }] }));
    expect(forged.targets).toEqual([]);
    expect(forged.confirmable).toBe(false);
  });

  it("never offers one DPGF line to two items: a line proven or chosen for one item is not another's", () => {
    const lost = dpgfItem(26, "Évier", "u", "raw-26", "mapped-26", 2);
    const proven = planTakeoffItemSend(input({ items: [ef, lost], answers: [measured(ef, [{ quantity: 3, page: 1 }]),
      measured(lost, [{ quantity: 1, page: 1 }])], destination: draft([dpgfLine(20, "mapped-20", "raw-20", 4), dpgfLine(27, "mapped-27", "raw-27", 2)]) }));
    const ask = proven.toResolve.find((entry) => entry.itemId === lost.id)!;
    expect(ask.options).toEqual([{ kind: "line", estimateItemId: lineId(27), title: "Ligne 27" }, { kind: "leave_out" }]);
    const twice = planTakeoffItemSend(input({ items: [ef, lost], answers: [measured(ef, [{ quantity: 3, page: 1 }]),
      measured(lost, [{ quantity: 1, page: 1 }])], destination: draft([dpgfLine(20, "mapped-20", "raw-20", 4)]),
      resolutions: [{ key: ask.key, choice: { kind: "line", estimateItemId: lineId(20) } }] }));
    expect(twice.targets.map((target) => target.itemId)).toEqual([ef.id]);
    expect(twice.toResolve).toEqual([expect.objectContaining({ itemId: lost.id, kind: "target_missing" })]);
  });

  it("asks a choice between two lines of one raw row", () => {
    const plan = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])],
      destination: draft([dpgfLine(20, "mapped-20", "raw-20", 4), dpgfLine(24, "mapped-20", "raw-20", 4)]) }));
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "target_multiple",
      options: [expect.objectContaining({ estimateItemId: lineId(20) }), expect.objectContaining({ estimateItemId: lineId(24) }), { kind: "leave_out" }] })]);
  });

  it("keeps the reference, the entered value, the measure and the quantity retained apart on a line typed by hand", () => {
    const typed = dpgfLine(20, "mapped-20", "raw-20", 4, { quantity: 9 });
    const plan = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])], destination: draft([typed]) }));
    expect(plan.targets).toEqual([]);
    const ask = plan.toResolve[0];
    expect(ask).toEqual(expect.objectContaining({ kind: "entered_quantity",
      facts: { reference: 4, entered: 9, measured: 5, retained: 5 }, options: [{ kind: "keep_entry" }, { kind: "use_retained" }, { kind: "leave_out" }] }));
    const kept = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])], destination: draft([typed]),
      resolutions: [{ key: ask.key, choice: { kind: "keep_entry" } }] }));
    expect(kept.targets[0].quantity).toEqual(expect.objectContaining({ reference: 4, entered: 9, measured: 5, retained: 5, after: 9, keptEntry: true }));
    const replaced = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])], destination: draft([typed]),
      resolutions: [{ key: ask.key, choice: { kind: "use_retained" } }] }));
    expect(replaced.targets[0].quantity.after).toBe(5);
  });

  it("suspends the line when keeping an entry below the measure would break the protective maximum", () => {
    const typed = dpgfLine(20, "mapped-20", "raw-20", 4, { quantity: 4.5 });
    const ask = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])], destination: draft([typed]) })).toResolve[0];
    const kept = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 5, page: 1 }])], destination: draft([typed]),
      resolutions: [{ key: ask.key, choice: { kind: "keep_entry" } }] }));
    expect(kept.targets).toEqual([]);
    expect(kept.notSent).toEqual([expect.objectContaining({ itemId: ef.id, reason: "entry_suspended" })]);
  });

  it("reads the 1 % rule of the DPGF policy unchanged: exactly 1 % needs no check, above it does", () => {
    const hundred = dpgfItem(25, "Réseau EF", "ml", "raw-25", "mapped-25", 100);
    const at = (measure: number) => planTakeoffItemSend(input({ items: [hundred], answers: [measured(hundred, [{ quantity: measure, page: 1 }])],
      destination: draft([dpgfLine(25, "mapped-25", "raw-25", 100, { unitCode: "ml" })]) })).targets[0].quantity;
    expect(at(101).gap).toEqual({ absolute: 1, percent: 1, requiresReview: false });
    expect(at(101.5).gap).toEqual({ absolute: 1.5, percent: 1.5, requiresReview: true });
    expect(at(101.5).after).toBe(102);
    expect(at(98).after).toBe(100);
  });

  it("adds a plan's part to what a DPGF line holds of an earlier send, and judges the gap on the total", () => {
    const fed = dpgfLine(20, "mapped-20", "raw-20", 4, { dpgf: { importId: IMPORT, mappedRowId: "mapped-20", rawRowId: "raw-20", reference: 4,
      composition: { version: 2, reference: 4, contributions: [{ job_id: OTHER_JOB, item_ids: [id("90000000", 1)], quantity: 3, protective: 0,
        printed_gap: 0 }] } } });
    const plan = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 2, page: 1 }])], destination: draft([fed]) }));
    // The line holds max(4, 3) = 4, its quantity: not typed by hand. With plan B's 2: 5 measured, 1 above the reference of 4.
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ before: 4, earlier: 3, added: 2, measured: 5, after: 5,
      gap: { absolute: 1, percent: 25, requiresReview: true } }));
  });

  it("sends the additions outside the DPGF to a complementary section, announced apart, with no DPGF price", () => {
    const plan = planTakeoffItemSend(input({ items: [ef, lavabo], answers: [measured(ef, [{ quantity: 4, page: 1 }]),
      measured(lavabo, [{ quantity: 2, page: 1 }])], destination: draft([dpgfLine(20, "mapped-20", "raw-20", 4)]) }));
    expect(plan.sections.map((section) => section.title)).toEqual([ITEM_SEND_COMPLEMENT_SECTION_TITLE, "Appareils sanitaires"]);
    const created = plan.targets.find((target) => target.itemId === lavabo.id)!;
    expect(created.line).toEqual({ kind: "new_line", sectionKey: `complement/${SANITAIRES.id}`, sectionId: null, title: "Lavabo" });
  });

  it("protects a line created by an earlier send that the estimator changed", () => {
    const edited = line(1, { title: "Lavabo", quantity: 7 });
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])], destination: draft([edited]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: edited.id,
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 3, unit: "u", pages: [1] }] }], sections: [] } }));
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "entered_quantity", facts: { reference: null, entered: 7, measured: 5, retained: 5 } })]);
  });
});

describe("planTakeoffItemSend — pages", () => {
  it("gives several items of a page's first send one page contribution", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo, wc], answers: [measured(lavabo, [{ quantity: 3, page: 2 }]),
      measured(wc, [{ quantity: 2, page: 2 }, { quantity: 1, page: 3 }])] }));
    expect(plan.pageContributions.map((page) => [page.page, page.itemIds])).toEqual([[2, [lavabo.id, wc.id]], [3, [wc.id]]]);
  });

  it("never counts a page another analysis already brought into the estimate without its decision", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo, wc], answers: [measured(lavabo, [{ quantity: 3, page: 2 }]),
      measured(wc, [{ quantity: 2, page: 2 }, { quantity: 1, page: 3 }])],
      destination: draft([]), pagesInEstimate: [{ page: 2, earlierJobIds: [OTHER_JOB], estimateItemIds: [lineId(7)] }] }));
    expect(plan.targets.map((target) => [target.label, target.quantity.after])).toEqual([["WC suspendu", 1]]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "page_decision", page: 2, itemId: null,
      heldItemIds: [lavabo.id, wc.id], options: [{ kind: "leave_out" }] })]);
    expect(plan.pageContributions.map((page) => page.page)).toEqual([3]);
    expect(plan.confirmable).toBe(false);
  });
});

describe("planTakeoffItemSend — the destination", () => {
  it("checks engine 3 at the preview and says why another engine does not fit", () => {
    expect(planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])],
      destination: draft([], { engine: 2 }) })).blocker).toEqual({ reason: "engine_not_v3", engine: 2 });
    expect(planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])],
      destination: { kind: "first_draft", engine: 2, maxSectionDepth: 3 } })).blocker).toEqual({ reason: "engine_policy_v2", engine: 2 });
  });

  it("points to the confirmed import when the list holds the DPGF but the draft has none of its lines; it imports nothing", () => {
    const ef = dpgfItem(20, "Lavabo", "u", "raw-20", "mapped-20", 4);
    const plan = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 3, page: 1 }])] }));
    expect(plan.blocker).toEqual({ reason: "dpgf_import_required", engine: 3 });
    expect(plan.targets).toEqual([]);
    expect(plan.writePlan).toBeNull();
  });

  it("refuses a takeoff already sent, not finished, or read by a member who cannot write the affaire", () => {
    const base = { items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])] };
    expect(planTakeoffItemSend(input({ ...base, job: { id: JOB, status: "completed", sent: true, canEdit: true } })).blocker?.reason).toBe("already_sent");
    expect(planTakeoffItemSend(input({ ...base, job: { id: JOB, status: "processing", sent: false, canEdit: true } })).blocker?.reason).toBe("not_completed");
    expect(planTakeoffItemSend(input({ ...base, job: { id: JOB, status: "completed", sent: false, canEdit: false } })).blocker?.reason).toBe("read_only");
  });

  it("writes a plan only when nothing is left to resolve, naming the lines it expects as it read them", () => {
    const earlierLine = line(1, { title: "Lavabo", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])], destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 3, unit: "u", pages: [1] }] }], sections: [] } }));
    expect(plan.writePlan).toEqual(expect.objectContaining({ format: "takeoff_item_send", version: 1, engine: 3,
      destination: { kind: "existing_draft", version_id: VERSION } }));
    expect(plan.writePlan!.targets[0].line).toEqual({ kind: "earlier_line", estimate_item_id: earlierLine.id,
      expected_updated_at: earlierLine.updatedAt, expected_quantity: 3 });
    expect(plan.writePlan!.targets[0].quantity_after).toBe(5);
  });
});

describe("itemSendLineAfter — prices are never touched", () => {
  it("changes the quantity of an existing line and nothing of its price, supplier, hours, coefficients, VAT, status or discount", () => {
    const existing = { id: lineId(1), quantity: 3, unit_price_ht_cents: 12_345, supplier_id: "supplier-1", price_origin: "supplier_offer",
      h_mo_per_unit: 0.75, k_fo: 1.2, k_mo: 1.1, tax_rate_bp: 2000, pricing_status: "priced", discount_bp: 500, title: "Lavabo" };
    const earlierLine = line(1, { title: "Lavabo", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])], destination: draft([earlierLine]),
      rules: projectItemSendRules([lavabo], [{ id: "rule-price", tenant_id: "t", created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z", created_by: "u", name: "Prix lavabo", match_pattern: "lavabo", match_type: "contains",
        action: "set_price", action_params: { unit_price_cents: 99_999 }, priority: 1, is_active: true } as TakeoffMappingRule]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [{ jobId: OTHER_JOB, answerId: "answer-a", quantity: 3, unit: "u", pages: [1] }] }], sections: [] } }));
    const after = itemSendLineAfter(existing, plan.writePlan!.targets[0]);
    const { quantity: before, ...unchangedBefore } = existing;
    const { quantity: written, ...unchangedAfter } = after;
    expect([before, written]).toEqual([3, 5]);
    expect(unchangedAfter).toEqual(unchangedBefore);
    expect(Object.keys(plan.writePlan!.targets[0].line).sort()).toEqual(["estimate_item_id", "expected_quantity", "expected_updated_at", "kind"]);
  });

  it("creates a new line without any price: the engine 3 initial values apply", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])] }));
    expect(plan.writePlan!.targets[0].line).toEqual({ kind: "new_line", section_key: `list:${LOT.id}/${SANITAIRES.id}`, section_id: null,
      title: "Lavabo", unit_code: "u", position: 0 });
  });
});
