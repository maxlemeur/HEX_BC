import { describe, expect, it } from "vitest";

import { projectDpgfPostes } from "./poste-list-dpgf";
import { createPosteRevision, posteSourceId, type PosteDraft } from "./poste-list";
import {
  ITEM_LIST_ADDED_SECTION,
  itemListEntries,
  posteFromStoredEntry,
  proposeItemListRevision,
  storedItemListRevision,
  withAddedItem,
  type StoredItemListEntry,
} from "./item-list";
import { PLUMBING_TEMPLATE, templatePosteDrafts } from "./plumbing-template";

const scope = { tenantId: "tenant", projectId: "project" };

function raw(id: string, rowIndex: number) {
  return { id, rowIndex, sheetName: "DPGF", sourceRowNumber: rowIndex + 2, sourcePage: null, tableIndex: null, documentId: null };
}

function dpgfDrafts(rows: Array<{ id: string; designation: string; unit?: string; quantity?: number | string }>,
  decisions?: Parameters<typeof projectDpgfPostes>[0]["decisions"]) {
  return projectDpgfPostes({
    importId: "import", mappingId: "mapping", columnMapping: {}, decisions,
    rawRows: rows.map(({ id }, index) => raw(id, index)),
    mappedRows: rows.map(({ id, ...row }) => ({ id: `m-${id}`, rawRowId: id, ...row })),
  });
}

/** The entries as the database stores them and the server reads them back (JSON, nulls kept, no undefined). */
function roundTrip(entries: ReturnType<typeof itemListEntries>): StoredItemListEntry[] {
  return JSON.parse(JSON.stringify(entries)) as StoredItemListEntry[];
}

describe("structure decisions of the confirmed import", () => {
  const rows = [
    { id: "r1", designation: "Bâtiment A" },
    { id: "r2", designation: "Lavabo", unit: "u", quantity: 2 },
    { id: "r3", designation: "Option vasque double", unit: "u", quantity: 1 },
    { id: "r4", designation: "Sanitaires étage" },
    { id: "r5", designation: "WC", unit: "u", quantity: 3 },
  ];

  it("applies a row ignored, a level set and a title kept as a line", () => {
    const decided = dpgfDrafts(rows, [
      { rowIndex: 0, kind: "section", level: 1 },
      { rowIndex: 2, kind: "ignore", level: null },
      { rowIndex: 3, kind: "section", level: 2 },
    ]);
    expect(decided.items.map(({ label, sections }) => [label, sections.map(({ title }) => title)])).toEqual([
      ["Lavabo", ["Bâtiment A"]],
      ["WC", ["Bâtiment A", "Sanitaires étage"]],
    ]);
    expect(decided.issues).toContainEqual(expect.objectContaining({ rawRowId: "r3", reason: "ignored" }));

    const kept = dpgfDrafts(rows, [{ rowIndex: 3, kind: "line", level: null }]);
    expect(kept.items.map(({ label }) => label)).toContain("Sanitaires étage");
  });

  it("without recorded decisions, keeps the classification of the reading", () => {
    const undecided = dpgfDrafts(rows);
    expect(undecided.items.map(({ label }) => label)).toEqual(["Lavabo", "Option vasque double", "WC"]);
    expect(undecided.issues.map(({ reason }) => reason)).toEqual(["section", "ambiguous"]);
  });

  it("never turns a total or an unreadable designation into an item, whatever the decision", () => {
    const result = dpgfDrafts([{ id: "r1", designation: "Sous-total" }, { id: "r2", designation: "1 249,50" }], [
      { rowIndex: 0, kind: "line", level: null }, { rowIndex: 1, kind: "line", level: null },
    ]);
    expect(result.items).toEqual([]);
    expect(result.issues.map(({ reason }) => reason)).toEqual(["footer", "unreadable_designation"]);
  });

  it("changes the facts of an item when its decision changes", () => {
    const line = dpgfDrafts(rows, [{ rowIndex: 3, kind: "line", level: null }]).items.find(({ label }) => label === "WC")!;
    const nested = dpgfDrafts(rows, [{ rowIndex: 3, kind: "section", level: 2 }]).items.find(({ label }) => label === "WC")!;
    expect(line.origin.rawRowId).toBe(nested.origin.rawRowId);
    expect(line.sections).not.toEqual(nested.sections);
  });
});

describe("stored revisions and proposals", () => {
  const sources = dpgfDrafts([
    { id: "r1", designation: "Lavabo en céramique", unit: "u", quantity: 2 },
    { id: "r2", designation: "Lavabo en céramique", unit: "u", quantity: 3 },
  ]).items;

  it("reads back a stored revision as the same facts: an unchanged source proposes nothing", () => {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: sources });
    expect(first).toMatchObject({ cause: "initial", changed: true });
    const stored = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first.candidate)), aliases: {} });
    expect(stored.digest).toBe(first.candidate.digest);
    expect(proposeItemListRevision({ scope, current: stored, sourceDrafts: sources })).toMatchObject({ changed: false });
  });

  it("keeps two homonyms as two items and their identities on a remapping", () => {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: sources }).candidate;
    expect(new Set(first.items.map(({ id }) => id)).size).toBe(2);
    const remapped = sources.map((draft) => ({ ...draft, origin: { ...draft.origin, mappingId: "mapping-2",
      mappedRowId: `${draft.origin.mappedRowId}-2` } }));
    const stored = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first)), aliases: {} });
    const proposal = proposeItemListRevision({ scope, current: stored, sourceDrafts: remapped });
    expect(proposal.candidate.items.map(({ id }) => id)).toEqual(first.items.map(({ id }) => id));
    expect(proposal.comparison.added).toEqual([]);
    expect(proposal.comparison.removed).toEqual([]);
  });

  it("carries the items added by hand into every proposal", () => {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: sources }).candidate;
    const stored = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first)), aliases: {} });
    const added = withAddedItem(stored, {
      intentId: "8f7c1d9e-0000-4000-8000-000000000001", addedBy: "member", addedAt: "2026-11-21T10:00:00.000Z",
      label: "Siphon de sol", expectedUnit: "u", measurementBasis: null, qualifiers: {}, sectionPath: null,
    });
    expect(added.items.at(-1)).toMatchObject({ label: "Siphon de sol", origin: { kind: "manual", addedInRevision: 2 },
      sections: [ITEM_LIST_ADDED_SECTION] });
    const second = storedItemListRevision(scope, { revision: 2, entries: roundTrip(itemListEntries(added)), aliases: {} });
    const proposal = proposeItemListRevision({ scope, current: second, sourceDrafts: sources.slice(1) });
    expect(proposal.candidate.items.map(({ label }) => label)).toEqual(["Lavabo en céramique", "Siphon de sol"]);
    expect(proposal.comparison.removed.map(({ id }) => id)).toEqual([first.items[0].id]);
  });

  it("finds an item retired then back under its first identity", () => {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: sources }).candidate;
    const stored = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first)), aliases: {} });
    const retired = proposeItemListRevision({ scope, current: stored, sourceDrafts: sources.slice(1) }).candidate;
    const second = storedItemListRevision(scope, { revision: 2, entries: roundTrip(itemListEntries(retired)), aliases: {} });
    const back = proposeItemListRevision({ scope, current: second, sourceDrafts: sources }).candidate;
    expect(back.items[0].id).toBe(first.items[0].id);
    expect(back.items[0].id).toBe(posteSourceId(scope, sources[0].origin));
  });

  it("proposes a template's corrected version on a list made from the template, keeping identities", () => {
    const drafts = templatePosteDrafts(PLUMBING_TEMPLATE);
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: drafts }).candidate;
    const stored = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first)), aliases: {} });
    const corrected = templatePosteDrafts({ ...PLUMBING_TEMPLATE, version: 2, publicationId: "publication",
      families: PLUMBING_TEMPLATE.families.map((family) => family.id !== "sanitaires" ? family : {
        ...family, lines: family.lines.map((line) => line.id !== "lavabo" ? line
          : { ...line, definition: { ...line.definition, label: "Lavabo sur colonne" } }),
      }) });
    const proposal = proposeItemListRevision({ scope, current: stored, sourceDrafts: corrected });
    expect(proposal.changed).toBe(true);
    const lavabo = proposal.comparison.changes.find(({ current }) => current.label === "Lavabo sur colonne")!;
    expect(lavabo.previous.id).toBe(lavabo.current.id);
    expect(lavabo).toMatchObject({ measurementChanged: true });
  });

  it("proposes an item added by hand as the same item as a new DPGF row, and keeps it once accepted", () => {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: [] }).candidate;
    const empty = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first)), aliases: {} });
    const added = withAddedItem(empty, {
      intentId: "8f7c1d9e-0000-4000-8000-000000000002", addedBy: "member", addedAt: "2026-11-21T10:00:00.000Z",
      label: "Siphon de sol", expectedUnit: "u", measurementBasis: null, qualifiers: {}, sectionPath: null,
    });
    const stored = storedItemListRevision(scope, { revision: 2, entries: roundTrip(itemListEntries(added)), aliases: {} });
    const manualId = stored.items[0].id;
    const dpgf = dpgfDrafts([{ id: "r9", designation: "Siphon de sol", unit: "u", quantity: 4 }]).items as PosteDraft[];
    const proposal = proposeItemListRevision({ scope, current: stored, sourceDrafts: dpgf });
    expect(proposal.candidate.items.map(({ origin }) => origin.kind)).toEqual(["dpgf", "manual"]);
    expect(proposal.comparison.continuities).toEqual([expect.objectContaining({ previousItemId: manualId,
      ambiguous: false })]);
    const accepted = proposeItemListRevision({ scope, current: stored, sourceDrafts: dpgf,
      continuities: proposal.comparison.continuities.map(({ previousItemId, nextItemId }) => ({ previousItemId, nextItemId })) });
    expect(accepted.candidate.items.map(({ id, origin }) => [id, origin.kind])).toEqual([[manualId, "dpgf"]]);
    expect(accepted.continuities).toEqual([{ sourceKey: expect.stringContaining("r9"), itemId: manualId }]);
    expect(() => proposeItemListRevision({ scope, current: stored, sourceDrafts: dpgf,
      continuities: [{ previousItemId: manualId, nextItemId: "00000000-0000-4000-8000-000000000000" }] })).toThrow();
  });

  it("never offers as a continuity an origin the affaire's registry already holds (its own item coming back)", () => {
    const first = proposeItemListRevision({ scope, current: null, sourceDrafts: [] }).candidate;
    const empty = storedItemListRevision(scope, { revision: 1, entries: roundTrip(itemListEntries(first)), aliases: {} });
    const added = withAddedItem(empty, {
      intentId: "8f7c1d9e-0000-4000-8000-000000000003", addedBy: "member", addedAt: "2026-11-21T10:00:00.000Z",
      label: "Siphon de sol", expectedUnit: "u", measurementBasis: null, qualifiers: {}, sectionPath: null,
    });
    const stored = storedItemListRevision(scope, { revision: 2, entries: roundTrip(itemListEntries(added)), aliases: {} });
    const [row] = dpgfDrafts([{ id: "r9", designation: "Siphon de sol", unit: "u", quantity: 4 }]).items;
    const offered = proposeItemListRevision({ scope, current: stored, sourceDrafts: [row] });
    expect(offered.comparison.continuities).toHaveLength(1);
    const known = proposeItemListRevision({ scope, current: stored, sourceDrafts: [row],
      registeredKeys: new Set([itemListEntries({ items: [{ ...row, id: "x" }] })[0].source_key]) });
    expect(known.comparison.continuities).toEqual([]);
  });

  it("reads a stored entry without inventing fields", () => {
    const [entry] = roundTrip(itemListEntries(proposeItemListRevision({ scope, current: null, sourceDrafts: sources }).candidate));
    expect(posteFromStoredEntry(entry)).toEqual(expect.objectContaining({ label: "Lavabo en céramique", expectedUnit: "u",
      referenceQuantity: 2, synonyms: [], qualifiers: {} }));
    expect(entry).not.toHaveProperty("unit_price_ht_cents");
  });
});

describe("the item list never asks for a price", () => {
  it("classifies the same rows whatever their price columns", () => {
    const base = { id: "r1", designation: "Lavabo", unit: "u", quantity: 2 };
    const without = dpgfDrafts([base]);
    const withPrices = projectDpgfPostes({
      importId: "import", mappingId: "mapping", columnMapping: {}, rawRows: [raw("r1", 0)],
      mappedRows: [{ ...base, id: "m-r1", rawRowId: "r1", ...({ unit_price_ht: "11,15", total_ht: "22,30" } as object) }],
    });
    expect(withPrices.items).toEqual(without.items);
  });
});

describe("a revision is not a second list", () => {
  it("refuses two definitions of one origin", () => {
    const [draft] = dpgfDrafts([{ id: "r1", designation: "Lavabo", unit: "u", quantity: 2 }]).items;
    expect(() => createPosteRevision(scope, [draft, { ...draft, label: "Autre" }])).toThrow();
  });
});
