import { describe, expect, it } from "vitest";

import {
  ITEM_SEND_COMPLEMENT_SECTION_TITLE,
  itemSendCompartment,
  itemSendPlanCanonical,
  planTakeoffItemSend,
  type ItemSendAnswer,
  type ItemSendDraftLine,
  type ItemSendEarlierTarget,
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
    itemId: item.id, answerId: id("70000000", Number(item.id.slice(-4))), revision: "r1", outcome: "measured",
    decision: { kind: "accepted", revision: 1 }, entry: null,
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

type EarlierPart = ItemSendEarlierTarget["parts"][number];
function part(overrides: Partial<EarlierPart> = {}): EarlierPart {
  return { jobId: OTHER_JOB, answerId: "answer-a", observationIds: ["obs-a"], quantity: 3, unit: "u", basis: null, qualifiers: {},
    pages: [1], planKey: "plan-earlier", ...overrides };
}

function input(overrides: Omit<Partial<ItemSendInput>, "plan"> & Pick<ItemSendInput, "items" | "answers">
  & { plan?: Omit<ItemSendInput["plan"], "pages"> & { pages?: number[] } }): ItemSendInput {
  const { plan, ...rest } = overrides;
  return {
    affaireNamesBuilding: false,
    stamps: { job: "job-stamp", peers: null, context: null, dpgf: [], firstDraftSettings: null, destination: null },
    job: { id: JOB, status: "completed", sent: false, canEdit: true },
    plan: { key: "plan-a", name: "Plan A — RDC", location: located("A", "RDC"), pages: [1, 2, 3, 4], ...plan },
    list: { revisionId: id("80000000", 1), revision: 3 },
    scope: overrides.items.map((item) => item.id),
    affaireEntries: [],
    destination: { kind: "first_draft", engine: 3, maxSectionDepth: 3 },
    earlier: { targets: [], sections: [] },
    pagesInEstimate: [],
    rules: new Map(),
    breakdown: "together",
    resolutions: [],
    ...rest,
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
    const plan = planTakeoffItemSend(input({ items: [douche], plan: { key: "plan-a", name: "Plan A", pages: [1, 2], location: null },
      answers: [{ ...measured(douche, []), outcome: "not_found", decision: null,
        entry: { revision: 2, quantity: 2, unit: "u", category: "site_survey", included: true } }] }));
    expect(plan.targets[0].contributions).toEqual([expect.objectContaining({ kind: "entered", quantity: 2, pages: [1, 2] })]);
    expect(plan.targets[0].quantity.after).toBe(2);
  });

  it("never adds a plan's measure to a quantity entered for the whole affaire", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 3, page: 2 }])],
      affaireEntries: [{ itemId: lavabo.id, revision: 1 }] }));
    expect(plan.targets).toEqual([]);
    expect(plan.notSent).toEqual([expect.objectContaining({ itemId: lavabo.id, reason: "affaire_entry" })]);
  });

  it("sends only what was retained: a measure nobody accepted is not sent, « à accepter », and sent once accepted (fix 1)", () => {
    const pending = measured(lavabo, [{ quantity: 3, page: 2 }], { decision: null });
    const held = planTakeoffItemSend(input({ items: [lavabo], answers: [pending] }));
    expect(held.targets).toEqual([]);
    expect(held.notSent).toEqual([expect.objectContaining({ itemId: lavabo.id, reason: "not_accepted" })]);
    expect(held.confirmable).toBe(false);
    const accepted = planTakeoffItemSend(input({ items: [lavabo], answers: [{ ...pending, decision: { kind: "accepted", revision: 1 } }] }));
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
        parts: [part()] }], sections: [] },
    }));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].line).toEqual(expect.objectContaining({ kind: "earlier_line", estimateItemId: earlierLine.id }));
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ before: 3, earlier: 3, added: 2, after: 5 }));
    expect(plan.sections).toEqual([]);
  });

  it("splits by level 3 and 2, keeps the sum, and gives an unknown or multiple level to « Non réparti »", () => {
    const answers = [measured(lavabo, [{ quantity: 3, page: 1 }])];
    const rdcA = itemSendCompartment("by_level", located("A", "RDC"), false).key;
    const byLevel = planTakeoffItemSend(input({ items: [lavabo], answers, breakdown: "by_level",
      plan: { key: "plan-b", name: "Plan B", location: located("A", "R+1") },
      destination: draft([line(1, { title: "Lavabo", quantity: 2, parentId: sectionId(3) })], { sections: [
        { id: sectionId(1), parentId: null, title: "Plomberie" }, { id: sectionId(2), parentId: sectionId(1), title: "Appareils sanitaires" },
        { id: sectionId(3), parentId: sectionId(2), title: "A · RDC" }] }),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "by_level", compartmentKey: rdcA, estimateItemId: lineId(1),
        parts: [part({ quantity: 2 })] }],
      sections: [{ key: `list:${LOT.id}`, estimateItemId: sectionId(1) }, { key: `list:${LOT.id}/${SANITAIRES.id}`, estimateItemId: sectionId(2) },
        { key: `list:${LOT.id}/${SANITAIRES.id}/${rdcA}`, estimateItemId: sectionId(3) }] } }));
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
        parts: [part()] }], sections: [] } }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "breakdown_mixed", itemId: lavabo.id })]);
  });

  it("rounds a length once, on the sum of the compartment", () => {
    const pipe = templateItem(7, "EF cuivre Ø16", "ml", [LOT, RESEAUX]);
    const earlierLine = line(3, { title: "EF cuivre Ø16", unitCode: "ml", quantity: 2 });
    const plan = planTakeoffItemSend(input({ items: [pipe], answers: [measured(pipe, [{ quantity: 1.3, page: 1 }])],
      destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: pipe.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part({ quantity: 1.2, unit: "ml" })] }], sections: [] } }));
    // 1.2 + 1.3 = 2.5, rounded up once: 3 (never 2 + 2).
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ before: 2, measured: 2.5, after: 3, roundedFrom: 2.5 }));
  });

  it("never groups the parts of one item whose diameter changed, nor contributions of another basis (fix 6)", () => {
    const tube = templateItem(8, "Tube cuivre", "ml", [LOT, RESEAUX], { qualifiers: { material: "cuivre", diameter: "16" } });
    const earlierLine = line(8, { title: "Tube cuivre", unitCode: "ml", quantity: 4 });
    const changed = planTakeoffItemSend(input({ items: [tube], answers: [measured(tube, [{ quantity: 6, page: 1 }])], destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: tube.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part({ quantity: 4, unit: "ml", qualifiers: { material: "cuivre", diameter: "14" } })] }], sections: [] } }));
    expect(changed.targets).toEqual([]);
    expect(changed.toResolve).toEqual([expect.objectContaining({ kind: "identity_conflict", itemId: tube.id })]);

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
        parts: [part()] }], sections: [] } }));
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
        parts: [part()] }], sections: [] } }));
    expect(plan.writePlan).toEqual(expect.objectContaining({ format: "takeoff_item_send", version: 1, engine: 3,
      destination: { kind: "existing_draft", version_id: VERSION } }));
    expect(plan.writePlan!.targets[0].line).toEqual({ kind: "earlier_line", estimate_item_id: earlierLine.id,
      expected_updated_at: earlierLine.updatedAt, expected_quantity: 3 });
    expect(plan.writePlan!.targets[0].quantity_after).toBe(5);
  });
});

describe("planTakeoffItemSend — prices are never part of the plan (fix 15)", () => {
  const PRICE_KEYS = /(^|_)(unit_price|price|pu|supplier|origin|h_mo|hours|k_fo|k_mo|coefficient|tax|vat|tva|discount|remise|pricing|amount|cents|margin)(_|$)/i;
  const keysOf = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(keysOf)
    : value && typeof value === "object" ? Object.entries(value).flatMap(([key, entry]) => [key, ...keysOf(entry)]) : []);

  it("feeds an existing line with its quantity only, even under a « Fixer le prix » rule: no price input anywhere in the plan", () => {
    const earlierLine = line(1, { title: "Lavabo", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])], destination: draft([earlierLine]),
      rules: projectItemSendRules([lavabo], [{ id: "rule-price", tenant_id: "t", created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z", created_by: "u", name: "Prix lavabo", match_pattern: "lavabo", match_type: "contains",
        action: "set_price", action_params: { unit_price_cents: 99_999 }, priority: 1, is_active: true } as TakeoffMappingRule]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part()] }], sections: [] } }));
    const target = plan.writePlan!.targets[0];
    expect(Object.keys(target.line).sort()).toEqual(["estimate_item_id", "expected_quantity", "expected_updated_at", "kind"]);
    expect([target.line.kind === "new_line" ? null : target.line.expected_quantity, target.quantity_after]).toEqual([3, 5]);
    expect(target.rule).toEqual(expect.objectContaining({ action: "set_price", effect: "price_ignored" }));
    expect(keysOf(plan.writePlan).filter((key) => PRICE_KEYS.test(key))).toEqual([]);
  });

  it("creates a new line without any price, in an order among the section's new lines, never a position (fix 10)", () => {
    const plan = planTakeoffItemSend(input({ items: [lavabo, wc], answers: [measured(lavabo, [{ quantity: 2, page: 1 }]),
      measured(wc, [{ quantity: 1, page: 1 }])] }));
    expect(plan.writePlan!.targets.map((target) => target.line)).toEqual([
      { kind: "new_line", section_key: `list:${LOT.id}/${SANITAIRES.id}`, section_id: null, title: "Lavabo", unit_code: "u", order: 1 },
      { kind: "new_line", section_key: `list:${LOT.id}/${SANITAIRES.id}`, section_id: null, title: "WC suspendu", unit_code: "u", order: 2 },
    ]);
    expect(keysOf(plan.writePlan).filter((key) => PRICE_KEYS.test(key) || key === "position")).toEqual([]);
  });
});

describe("planTakeoffItemSend — fix round 1", () => {
  const ef = dpgfItem(30, "Lavabo", "u", "raw-30", "mapped-30", 4);
  const other = dpgfItem(31, "Lavabo double", "u", "raw-31", "mapped-31", 4);

  it("puts an entry on its plan's pages: a page another analysis brought holds it, never 3 + 3 (fix 2)", () => {
    const douche = templateItem(3, "Receveur de douche", "u");
    const earlierLine = line(1, { title: "Receveur de douche", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [douche], plan: { key: "plan-a", name: "Plan A", pages: [1], location: null },
      answers: [{ ...measured(douche, []), outcome: "uncertain", decision: null,
        entry: { revision: 1, quantity: 3, unit: "u", category: "site_survey", included: true } }],
      destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: douche.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part()] }], sections: [] },
      pagesInEstimate: [{ page: 1, earlierJobIds: [OTHER_JOB], estimateItemIds: [earlierLine.id] }] }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "page_decision", page: 1, heldItemIds: [douche.id],
      earlierLines: [{ estimateItemId: earlierLine.id, title: "Receveur de douche", quantity: 3 }] })]);
    expect(plan.partsNotSent).toEqual([expect.objectContaining({ itemId: douche.id, kind: "entered", quantity: 3, pages: [1], reason: "page_held" })]);
    expect(plan.confirmable).toBe(false);
  });

  it("gives a sent entry its plan's pages as its page contribution (fix 2)", () => {
    const douche = templateItem(3, "Receveur de douche", "u");
    const plan = planTakeoffItemSend(input({ items: [douche], plan: { key: "plan-a", name: "Plan A", pages: [1, 2], location: null },
      answers: [{ ...measured(douche, []), outcome: "not_found", decision: null,
        entry: { revision: 1, quantity: 2, unit: "u", category: "site_survey", included: true } }] }));
    expect(plan.pageContributions.map((page) => [page.page, page.itemIds])).toEqual([[1, [douche.id]], [2, [douche.id]]]);
  });

  it("keeps a DPGF line live for another item out of reach: neither its target nor offered, and never adds its parts (fix 4)", () => {
    const claimed = dpgfLine(30, "mapped-30", "raw-30", 4);
    const spare = dpgfLine(32, "mapped-32", "raw-32", 4);
    const plan = planTakeoffItemSend(input({ items: [ef, other], scope: [ef.id], answers: [measured(ef, [{ quantity: 3, page: 1 }])],
      destination: draft([claimed, spare]),
      earlier: { targets: [{ itemId: other.id, breakdown: "together", compartmentKey: "dpgf", estimateItemId: claimed.id,
        parts: [part()] }], sections: [] } }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "target_missing", itemId: ef.id,
      options: [{ kind: "line", estimateItemId: spare.id, title: "Ligne 32" }, { kind: "leave_out" }] })]);
  });

  it("leaves a DPGF line live for two items out of reach of both (fix 4)", () => {
    const shared = dpgfLine(30, "mapped-30", "raw-30", 4);
    const plan = planTakeoffItemSend(input({ items: [ef, other], scope: [ef.id], answers: [measured(ef, [{ quantity: 3, page: 1 }])],
      destination: draft([shared]),
      earlier: { targets: [{ itemId: ef.id, breakdown: "together", compartmentKey: "dpgf", estimateItemId: shared.id, parts: [part({ quantity: 2 })] },
        { itemId: other.id, breakdown: "together", compartmentKey: "dpgf", estimateItemId: shared.id, parts: [part({ quantity: 3 })] }], sections: [] } }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "target_missing", itemId: ef.id, options: [{ kind: "leave_out" }] })]);
  });

  it("adds only the same item's earlier parts on a DPGF line, another item's parts elsewhere never (fix 4)", () => {
    const fed = dpgfLine(30, "mapped-30", "raw-30", 4);
    const elsewhere = dpgfLine(31, "mapped-31", "raw-31", 4);
    const plan = planTakeoffItemSend(input({ items: [ef, other], scope: [ef.id], answers: [measured(ef, [{ quantity: 2, page: 1 }])],
      destination: draft([fed, elsewhere]),
      earlier: { targets: [{ itemId: ef.id, breakdown: "together", compartmentKey: "dpgf", estimateItemId: fed.id, parts: [part({ quantity: 3 })] },
        { itemId: other.id, breakdown: "together", compartmentKey: "dpgf", estimateItemId: elsewhere.id, parts: [part({ quantity: 9 })] }],
      sections: [] } }));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ earlier: 3, added: 2, measured: 5, after: 5 }));
  });

  it("targets a DPGF line only through a proven raw row, never through matching metadata alone (fix 5)", () => {
    const unproven = dpgfLine(30, "mapped-30", null, 4);
    const plan = planTakeoffItemSend(input({ items: [ef], answers: [measured(ef, [{ quantity: 3, page: 1 }])], destination: draft([unproven]) }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "target_missing", itemId: ef.id })]);
  });

  it("refuses an earlier part of another basis on the same line, and compares bases as the reading does (fix 6)", () => {
    const floor = templateItem(10, "Chape", "m2", [LOT, RESEAUX], { measurementBasis: "Sol net" });
    const spelled = planTakeoffItemSend(input({ items: [floor], answers: [measured(floor, [{ quantity: 10, page: 1, basis: "sol net" },
      { quantity: 12, page: 2, basis: "Sol  net." }])] }));
    expect(spelled.targets.map((target) => target.quantity.after)).toEqual([22]);
    const earlierLine = line(10, { title: "Chape", unitCode: "m2", quantity: 9 });
    const shab = planTakeoffItemSend(input({ items: [floor], answers: [measured(floor, [{ quantity: 10, page: 1, basis: "sol net" }])],
      destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: floor.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part({ quantity: 9, unit: "m2", basis: "SHAB" })] }], sections: [] } }));
    expect(shab.targets).toEqual([]);
    expect(shab.toResolve).toEqual([expect.objectContaining({ kind: "identity_conflict", itemId: floor.id })]);
  });

  it("keeps the policy's cumulative gap: an earlier printed gap is never cancelled by the totals (fix 7)", () => {
    const hundred = dpgfItem(25, "Sol PVC", "m2", "raw-25", "mapped-25", 100);
    const fed = dpgfLine(25, "mapped-25", "raw-25", 100, { unitCode: "m2", dpgf: { importId: IMPORT, mappedRowId: "mapped-25", rawRowId: "raw-25",
      reference: 100, composition: { version: 2, reference: 100, contributions: [{ job_id: OTHER_JOB, item_ids: [id("90000000", 2)], quantity: 90,
        protective: 0, printed_gap: 4 }] } } });
    const plan = planTakeoffItemSend(input({ items: [hundred], answers: [measured(hundred, [{ quantity: 10, page: 1 }])], destination: draft([fed]) }));
    expect(plan.targets[0].quantity.gap).toEqual({ absolute: 4, percent: 4, requiresReview: true });
  });

  it("lists every part not sent with its observations, pages and quantity, also when its item is partly sent (fix 8)", () => {
    const answer = measured(lavabo, [{ quantity: 3, page: 1 }, { quantity: 2, page: 2 }]);
    const pages = [{ page: 1, earlierJobIds: [OTHER_JOB], estimateItemIds: [lineId(7)] }];
    const asked = planTakeoffItemSend(input({ items: [lavabo], answers: [answer], destination: draft([line(7, { title: "Lavabo ancien", quantity: 3 })]),
      pagesInEstimate: pages }));
    expect(asked.toResolve).toEqual([expect.objectContaining({ kind: "page_decision", page: 1,
      earlierLines: [{ estimateItemId: lineId(7), title: "Lavabo ancien", quantity: 3 }] })]);
    const left = planTakeoffItemSend(input({ items: [lavabo], answers: [answer], destination: draft([line(7, { title: "Lavabo ancien", quantity: 3 })]),
      pagesInEstimate: pages, resolutions: [{ key: asked.toResolve[0].key, choice: { kind: "leave_out" } }] }));
    expect(left.targets.map((target) => target.quantity.after)).toEqual([2]);
    expect(left.partsNotSent).toEqual([{ itemId: lavabo.id, kind: "measured", observationIds: [answer.observations[0].observationId],
      pages: [1], quantity: 3, unit: "u", reason: "left_out" }]);
    expect(left.writePlan!.parts_not_sent).toEqual([{ item_id: lavabo.id, kind: "measured",
      observation_ids: [answer.observations[0].observationId], pages: [1], quantity: 3, unit: "u", reason: "left_out" }]);
  });

  it("keys a compartment so that no two locations collide, bounded whatever the names (fix 9)", () => {
    const one = itemSendCompartment("by_level", located("A|B", "C"), false).key;
    const two = itemSendCompartment("by_level", located("A", "B|C"), false).key;
    expect(one).not.toBe(two);
    const long = "x".repeat(200);
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])], breakdown: "by_level",
      plan: { key: "p", name: "P", location: located(long, `${long}y`) }, destination: draft([line(1, { title: "Lavabo", quantity: 9 })]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "by_level", compartmentKey: itemSendCompartment("by_level", located(long, `${long}y`),
        false).key, estimateItemId: lineId(1), parts: [part()] }], sections: [] } }));
    expect(plan.toResolve.length).toBeGreaterThan(0);
    for (const entry of plan.toResolve) expect(entry.key.length).toBeLessThanOrEqual(400);
    const sent = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 1, page: 1 }])], breakdown: "by_level",
      plan: { key: "p", name: "P", pages: [1], location: located("y".repeat(40), "z".repeat(40)) } }));
    expect(sent.targets).toHaveLength(1);
    expect(sent.targets[0].key.length).toBeLessThanOrEqual(400);
    expect(sent.sections.every((section) => section.key.length <= 400)).toBe(true);
  });

  it("allocates a level without building only when no confirmed location of the affaire names a building (fix 9)", () => {
    const rdc = located(null, "RDC");
    expect(itemSendCompartment("by_level", rdc, false)).toEqual(expect.objectContaining({ label: "RDC", reason: null }));
    expect(itemSendCompartment("by_level", rdc, true)).toEqual({ key: "unallocated", label: "Non réparti", reason: "location_unknown" });
  });

  it("asks to resolve a quantity engine 3 cannot write, never rounds it silently (fix 10)", () => {
    const floor = templateItem(10, "Chape", "m2", [LOT, RESEAUX]);
    const precise = planTakeoffItemSend(input({ items: [floor], answers: [{ ...measured(floor, []), outcome: "not_found", decision: null,
      entry: { revision: 1, quantity: 1.2345, unit: "m2", category: "site_survey", included: true } }] }));
    expect(precise.targets).toEqual([]);
    expect(precise.toResolve).toEqual([expect.objectContaining({ kind: "quantity_unwritable", itemId: floor.id })]);
    const huge = planTakeoffItemSend(input({ items: [floor], answers: [measured(floor, [{ quantity: 600_000_000, page: 1 },
      { quantity: 600_000_000, page: 2 }])] }));
    expect(huge.toResolve).toEqual([expect.objectContaining({ kind: "quantity_unwritable", itemId: floor.id })]);
  });

  it("decides the DPGF import requirement on the whole sealed list, not on the plan's scope (fix 13)", () => {
    const plan = planTakeoffItemSend(input({ items: [ef, lavabo], scope: [lavabo.id], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])] }));
    expect(plan.blocker).toEqual({ reason: "dpgf_import_required", engine: 3 });
  });
});

describe("itemSendPlanCanonical — what the confirmation compares (fix 11)", () => {
  const skip = (ruleId: string): TakeoffMappingRule => ({ id: ruleId, tenant_id: "t", created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z", created_by: "u", name: `Ignorer ${ruleId}`, match_pattern: "baignoire", match_type: "contains",
    action: "skip", action_params: {}, priority: 1, is_active: true } as TakeoffMappingRule);
  const baignoire = templateItem(4, "Baignoire", "u");
  const answers = [measured(lavabo, [{ quantity: 3, page: 1 }]), measured(wc, [{ quantity: 2, page: 1 }]),
    measured(baignoire, [{ quantity: 1, page: 1 }])];
  const base = (overrides: Omit<Partial<ItemSendInput>, "plan"> = {}) => input({ items: [lavabo, wc, baignoire], answers,
    rules: projectItemSendRules([lavabo, wc, baignoire], [skip("11111111-1111-4111-8111-111111111111")]), ...overrides });
  const canonical = (overrides: Omit<Partial<ItemSendInput>, "plan"> = {}) => itemSendPlanCanonical(planTakeoffItemSend(base(overrides)).writePlan!);

  it("is the same whatever the order of the answers read", () => {
    expect(canonical({ answers: [...answers].reverse() })).toBe(canonical());
  });

  it("changes with the rule that skipped an item, with an earlier part's sources at a constant sum, and with each stamp", () => {
    expect(canonical({ rules: projectItemSendRules([lavabo, wc, baignoire], [skip("22222222-2222-4222-8222-222222222222")]) })).not.toBe(canonical());
    const earlierLine = line(1, { title: "Lavabo", quantity: 3 });
    const withEarlier = (observationIds: string[]) => canonical({ destination: draft([earlierLine]), earlier: { targets: [{ itemId: lavabo.id,
      breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id, parts: [part({ observationIds })] }], sections: [] } });
    expect(withEarlier(["obs-a"])).not.toBe(withEarlier(["obs-b"]));
    const stamps = { job: "job-stamp", peers: null, context: null, dpgf: [], firstDraftSettings: null, destination: null };
    expect(canonical({ stamps: { ...stamps, context: { peers: "p1", locations: "l1" } } }))
      .not.toBe(canonical({ stamps: { ...stamps, context: { peers: "p2", locations: "l1" } } }));
    expect(canonical({ stamps: { ...stamps, firstDraftSettings: { sale_coefficient_fo: 1.3 } } }))
      .not.toBe(canonical({ stamps: { ...stamps, firstDraftSettings: { sale_coefficient_fo: 1.25 } } }));
    expect(canonical({ stamps: { ...stamps, dpgf: [{ importId: IMPORT, mappingId: "mapping-1", rowsSha256: "a".repeat(64), updatedAt: "2026-11-22T08:00:00.000Z", status: "done",
      rowCount: 3 }] } }))
      .not.toBe(canonical({ stamps: { ...stamps, dpgf: [{ importId: IMPORT, mappingId: "mapping-1", rowsSha256: "a".repeat(64), updatedAt: "2026-11-22T09:00:00.000Z",
      status: "done", rowCount: 3 }] } }));
  });
});

describe("planTakeoffItemSend — closing changes", () => {
  const douche = templateItem(3, "Receveur de douche", "u");
  const entered = (quantity: number, extra: Partial<ItemSendAnswer> = {}): ItemSendAnswer => ({ ...measured(douche, []), outcome: "uncertain",
    decision: null, entry: { revision: 1, quantity, unit: "u", category: "site_survey", included: true }, ...extra });

  it("replaces this plan's own earlier part with its entry, never adds to it (closing 1)", () => {
    const earlierLine = line(1, { title: "Receveur de douche", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [douche], answers: [entered(3)], destination: draft([earlierLine]),
      plan: { key: "plan-a", name: "Plan A", pages: [1], location: located("A", "RDC") },
      earlier: { targets: [{ itemId: douche.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part({ planKey: "plan-a" })] }], sections: [] } }));
    expect(plan.targets).toHaveLength(1);
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ before: 3, earlier: 0, replaced: 3, added: 3, after: 3 }));
    expect(plan.targets[0].replaces).toEqual([{ jobId: OTHER_JOB, answerId: "answer-a", observationIds: ["obs-a"], quantity: 3 }]);
    expect(plan.writePlan!.targets[0].replaces).toEqual([{ job_id: OTHER_JOB, answer_id: "answer-a", observation_ids: ["obs-a"], quantity: 3 }]);
  });

  it("keeps another plan's earlier part and adds to it (closing 1)", () => {
    const earlierLine = line(1, { title: "Receveur de douche", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [douche], answers: [entered(2)], destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: douche.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [part({ planKey: "plan-other" })] }], sections: [] } }));
    expect(plan.targets[0].quantity).toEqual(expect.objectContaining({ earlier: 3, replaced: 0, added: 2, after: 5 }));
  });

  it("stands an entry on every page of the unit, whatever pages the answer searched (closing 1)", () => {
    const sent = planTakeoffItemSend(input({ items: [douche], answers: [entered(2)],
      plan: { key: "plan-a", name: "Plan A", pages: [1, 2, 3], location: null } }));
    expect(sent.pageContributions.map((page) => page.page)).toEqual([1, 2, 3]);
    const held = planTakeoffItemSend(input({ items: [douche], answers: [entered(2)], destination: draft([]),
      plan: { key: "plan-a", name: "Plan A", pages: [1, 2], location: null },
      pagesInEstimate: [{ page: 1, earlierJobIds: [OTHER_JOB], estimateItemIds: [] }] }));
    expect(held.targets).toEqual([]);
    expect(held.toResolve).toEqual([expect.objectContaining({ kind: "page_decision", page: 1, heldItemIds: [douche.id] })]);
  });

  it("applies one claim rule on every path: a line live for two items feeds neither (closing 2)", () => {
    const disputed = line(1, { title: "Lavabo", quantity: 5 });
    const plan = planTakeoffItemSend(input({ items: [lavabo, wc], scope: [lavabo.id], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])],
      destination: draft([disputed]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: disputed.id, parts: [part()] },
        { itemId: wc.id, breakdown: "together", compartmentKey: "together", estimateItemId: disputed.id, parts: [part({ quantity: 2 })] }],
      sections: [] } }));
    expect(plan.targets).toEqual([]);
    expect(plan.toResolve).toEqual([expect.objectContaining({ kind: "target_missing", itemId: lavabo.id, options: [{ kind: "leave_out" }] })]);
  });

  it("feeds the live target, never a deleted one before it (closing 2)", () => {
    const live = line(2, { title: "Lavabo", quantity: 3 });
    const plan = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 2, page: 1 }])], destination: draft([live]),
      earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: lineId(9), parts: [part()] },
        { itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: live.id, parts: [part()] }], sections: [] } }));
    expect(plan.targets.map((target) => [target.line.kind, "estimateItemId" in target.line ? target.line.estimateItemId : null,
      target.quantity.after])).toEqual([["earlier_line", live.id, 5]]);
  });

  it("compares a diameter as it is written, never with its separators removed, and reads a part without qualifiers (closing 4)", () => {
    const pipe = templateItem(13, "Tube cuivre", "ml", [LOT, RESEAUX], { qualifiers: { diameter: "1/2\"" } });
    const earlierLine = line(13, { title: "Tube cuivre", unitCode: "ml", quantity: 3 });
    const at = (qualifiers: EarlierPart["qualifiers"]) => planTakeoffItemSend(input({ items: [pipe], answers: [measured(pipe, [{ quantity: 2, page: 1 }])],
      destination: draft([earlierLine]), earlier: { targets: [{ itemId: pipe.id, breakdown: "together", compartmentKey: "together",
        estimateItemId: earlierLine.id, parts: [part({ unit: "ml", qualifiers })] }], sections: [] } }));
    expect(at({ diameter: "1.2\"" }).toResolve).toEqual([expect.objectContaining({ kind: "identity_conflict", itemId: pipe.id })]);
    expect(at({ diameter: "1/2\"" }).targets.map((target) => target.quantity.after)).toEqual([5]);
    const bare = { ...part({ unit: "ml" }), qualifiers: undefined } as unknown as EarlierPart;
    expect(() => planTakeoffItemSend(input({ items: [pipe], answers: [measured(pipe, [{ quantity: 2, page: 1 }])], destination: draft([earlierLine]),
      earlier: { targets: [{ itemId: pipe.id, breakdown: "together", compartmentKey: "together", estimateItemId: earlierLine.id,
        parts: [bare] }], sections: [] } }))).not.toThrow();
  });

  it("lists an entry's part not sent when an affaire-wide entry or a skip rule leaves it out (closing 5)", () => {
    const byAffaire = planTakeoffItemSend(input({ items: [douche], answers: [entered(2)], plan: { key: "plan-a", name: "Plan A", pages: [1],
      location: null }, affaireEntries: [{ itemId: douche.id, revision: 1 }] }));
    expect(byAffaire.partsNotSent).toEqual([{ itemId: douche.id, kind: "entered", observationIds: [], pages: [1], quantity: 2, unit: "u",
      reason: "affaire_entry" }]);
    const skipped = planTakeoffItemSend(input({ items: [douche], answers: [entered(2)], plan: { key: "plan-a", name: "Plan A", pages: [1],
      location: null }, rules: projectItemSendRules([douche], [{ id: "rule-skip", tenant_id: "t", created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z", created_by: "u", name: "Hors lot", match_pattern: "douche", match_type: "contains",
        action: "skip", action_params: {}, priority: 1, is_active: true } as TakeoffMappingRule]) }));
    expect(skipped.partsNotSent).toEqual([expect.objectContaining({ kind: "entered", quantity: 2, reason: "rule_skip" })]);
  });

  it("checks a quantity as entered, exactly, before any rounding (closing 7)", () => {
    const at = (quantity: number) => planTakeoffItemSend(input({ items: [douche], answers: [entered(quantity)] }));
    expect(at(1.23401).toResolve).toEqual([expect.objectContaining({ kind: "quantity_unwritable", itemId: douche.id })]);
    expect(at(1.23401).targets).toEqual([]);
    expect(at(0.00001).toResolve).toEqual([expect.objectContaining({ kind: "quantity_unwritable" })]);
    expect(at(0).toResolve).toEqual([expect.objectContaining({ kind: "quantity_unwritable" })]);
    expect(at(33554432.001).targets.map((target) => target.quantity.after)).toEqual([33554432.001]);
    const summed = planTakeoffItemSend(input({ items: [lavabo], answers: [measured(lavabo, [{ quantity: 0.1, page: 1 }, { quantity: 0.2, page: 2 }])] }));
    expect(summed.targets.map((target) => target.quantity.after)).toEqual([0.3]);
  });
});

describe("itemSendPlanCanonical — closing changes (closing 8)", () => {
  const stamps = { job: "job-stamp", peers: null, context: null, dpgf: [], firstDraftSettings: null, destination: null };
  const earlierLine = line(1, { title: "Lavabo", quantity: 3 });
  const answer = measured(lavabo, [{ quantity: 1, page: 1 }, { quantity: 2, page: 2 }]);
  const canonical = (overrides: Omit<Partial<ItemSendInput>, "plan"> = {}) => itemSendPlanCanonical(planTakeoffItemSend(input({ items: [lavabo],
    answers: [answer], destination: draft([earlierLine]), earlier: { targets: [{ itemId: lavabo.id, breakdown: "together",
      compartmentKey: "together", estimateItemId: earlierLine.id, parts: [part()] }], sections: [] }, stamps, ...overrides })).writePlan!);

  it("changes with the destination's own state and with the DPGF review state", () => {
    const draftState = (updatedAt: string) => ({ ...stamps, destination: { versionId: VERSION, status: "draft", updatedAt } });
    expect(canonical({ stamps: draftState("2026-11-22T08:00:00.000Z") })).not.toBe(canonical({ stamps: draftState("2026-11-22T09:00:00.000Z") }));
    const review = (rowsSha256: string) => ({ ...stamps, dpgf: [{ importId: IMPORT, mappingId: "mapping-1", rowsSha256, updatedAt: "t", status: "done",
      rowCount: 3 }] });
    expect(canonical({ stamps: review("a".repeat(64)) })).not.toBe(canonical({ stamps: review("b".repeat(64)) }));
  });

  it("is the same whatever the order of the observations read", () => {
    expect(canonical({ answers: [{ ...answer, observations: [...answer.observations].reverse() }] })).toBe(canonical());
  });

  it("tells two diameters apart that differ by their separators", () => {
    const pipe = templateItem(13, "Tube cuivre", "ml", [LOT, RESEAUX], { qualifiers: { diameter: "1/2\"" } });
    const other = templateItem(13, "Tube cuivre", "ml", [LOT, RESEAUX], { qualifiers: { diameter: "1.2\"" } });
    const pipeAnswer = measured(pipe, [{ quantity: 2, page: 1 }]);
    const of = (item: ItemSendListItem) => itemSendPlanCanonical(planTakeoffItemSend(input({ items: [item], answers: [pipeAnswer], stamps })).writePlan!);
    expect(of(pipe)).not.toBe(of(other));
  });
});
