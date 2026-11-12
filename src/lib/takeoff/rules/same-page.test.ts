import { describe, expect, it } from "vitest";

import type { TakeoffPageDocument, TakeoffPageIdentity } from "@/lib/takeoff/page-contributions";
import { isRuleBlocked } from "@/lib/takeoff/rules/blocking";
import { TAKEOFF_RULE_VERSIONS, evaluateTakeoffRules, type RuleLine, type RulePage } from "@/lib/takeoff/rules/evaluate";
import { ruleFailureKeys, ruleFailuresReopen } from "@/lib/takeoff/rules/failure-keys";
import { REGISTRATION_VERSION, type PageAnchors } from "@/lib/takeoff/rules/registration";
import type { TakeoffRuleInputs, TakeoffRuleResult } from "@/lib/takeoff/rules/types";

// TI-682 (lot D, PR 3): a takeoff run again on a page another takeoff of the version already measured. Z1/Z2 compares
// every applied or completed takeoff of the version, and each takeoff has its own vector page row: the two readings of
// one page met as two zones, and the second failed ZONE_OVERLAP_DUPLICATE, advising to cut the new measure (the
// behaviour this file pinned on origin/main before the change). Two readings of one plan page by two takeoffs are no
// duplicate between zones: the page decision of the application (« Pages déjà au devis », PR 2) settles them. The page
// is the one of page-contributions.ts, known by its plan file, its content hash or its plan reference; a file name
// alone does not prove it here, where the rule would otherwise silence a real duplicate. Everything else is unchanged.
// Every plan, label and quantity is fictional.

const PLAN = "3c000000-0000-4000-8000-000000000001";
const OTHER_PLAN = "3c000000-0000-4000-8000-000000000002";
const HASH = "a".repeat(64);

/** A fictional floor drawing: building lines and room texts, seen through a sheet shifted by (sx, sy). */
function sheet(sx: number, sy = 0): PageAnchors {
  const texts: Array<[string, number, number]> = ["Bureau 101", "Salle de réunion", "Local technique", "Circulation C2",
    "Sanitaires H", "Sanitaires F", "Archives"].map((text, index) => [text, 12 + index * 1.3 + sx, 4 + index * 0.9 + sy]);
  const lines = Array.from({ length: 30 }, (_, index): [number, number, number, number] =>
    [10 + sx, 2 + index * 0.7 + sy, 13 + (index % 5) + sx, 2 + index * 0.7 + sy]);
  return { version: 1, texts, lines };
}

function inputs(overrides: Partial<TakeoffRuleInputs> = {}): TakeoffRuleInputs {
  return { version: 1, source: "vector", kind: "network", network: "EF", material: "inox-316l", dn: "DN 22", non_observable: null,
    model_quantity: 5, ...overrides };
}

function at(document: Partial<TakeoffPageDocument>, page: number | null = 1): TakeoffPageIdentity {
  return { document: { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "Plan R+1 Z1.pdf", ...document }, page };
}

function page(key: string, identity: TakeoffPageIdentity | null, overrides: Partial<RulePage> = {}): RulePage {
  return { key, job_id: key.split("#")[0], order: 0, level: "R+1", zone: "Z1", scale: { status: "format", reason: null },
    denominator: 50, anchors: sheet(0), identity, ...overrides };
}

function run(id: string, pageKey: string, overrides: Partial<RuleLine> = {}): RuleLine {
  return { id, job_id: pageKey.split("#")[0], page_key: pageKey, designation: "EF Inox 316L DN 22", unit: "ml", quantity: 5,
    is_excluded: false, frozen: false, inputs: inputs(),
    geometry: { segments_m: [[0, 1, 5, 1]], polygon_m: null, length_m: 5, area_m2: null }, ...overrides };
}

function zone(results: Map<string, TakeoffRuleResult[]>, id: string) {
  return results.get(id)?.find((entry) => entry.rule === "zone_overlap");
}

/** M1 applied (frozen) read the page first; M2, completed, reads it again. Each takeoff has its own vector page row. */
function measuredTwice(first: TakeoffPageIdentity | null, second: TakeoffPageIdentity | null,
  overrides: { m1?: Partial<RulePage>; m2?: Partial<RulePage>; line?: Partial<RuleLine> } = {}) {
  const pages = [page("m1#1", first, { order: 1, ...overrides.m1 }), page("m2#1", second, { order: 10_001, ...overrides.m2 })];
  const lines = [run("m1-ef", "m1#1", { frozen: true }), run("m2-ef", "m2#1", overrides.line)];
  return evaluateTakeoffRules({ pages, lines });
}

const SAME_PAGE = { rule: "zone_overlap", status: "pass", code: "ZONE_OVERLAP_SAME_PAGE", acceptable: true };
const DUPLICATE = { rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE" };

describe("a page measured again by a second takeoff (TI-682, lot D PR 3)", () => {
  it("passes both readings of one plan page as the same page, never as a duplicate between zones", () => {
    const { results, transforms } = measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN }));
    expect(transforms.get("m2#1")?.slice(4)).toEqual([0, 0]);
    for (const id of ["m2-ef", "m1-ef"]) {
      expect(zone(results, id)).toMatchObject({ ...SAME_PAGE, version: TAKEOFF_RULE_VERSIONS.zone_overlap, details: { level: "R+1" } });
      expect(zone(results, id)?.reason).toContain("Pages déjà au devis");
      expect(ruleFailureKeys(results.get(id))).toEqual([]);
    }
  });

  it("passes a second reading that reads the run otherwise, and one whose plans carry no anchors", () => {
    const differently = measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN }),
      { line: { designation: "EF Inox 316L DN 28", inputs: inputs({ dn: "DN 28" }) } });
    expect(zone(differently.results, "m2-ef")).toMatchObject(SAME_PAGE);
    const unanchored = measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN }), { m1: { anchors: null }, m2: { anchors: null } });
    expect(zone(unanchored.results, "m2-ef")).toMatchObject(SAME_PAGE);
  });

  it("knows the page by its plan file, its content hash or its plan reference (a revision), never by its file name alone", () => {
    // Two uploads of one PDF under two names, read by their preparations' content hash.
    expect(zone(measuredTwice(at({ content_hash: HASH, file_name: "R+1.pdf" }), at({ content_hash: HASH, file_name: "R+1 relance.pdf" }))
      .results, "m2-ef")).toMatchObject(SAME_PAGE);
    // Revision B of the plan replaces revision A (one « Référence du plan »), its drawing two metres further on the sheet.
    const revision = measuredTwice(at({ plan_file_id: PLAN, logical_document_id: "PLB-R1-Z1" }),
      at({ plan_file_id: OTHER_PLAN, logical_document_id: "plb-r1-z1 " }), { m2: { anchors: sheet(-2) },
        line: { geometry: { segments_m: [[-2, 1, 3, 1]], polygon_m: null, length_m: 5, area_m2: null } } });
    expect(revision.transforms.get("m2#1")?.[4]).toBeCloseTo(2, 3);
    expect(zone(revision.results, "m2-ef")).toMatchObject(SAME_PAGE);
    // Not recognized: the file name alone (two direct uploads without preparation), or a plan file beside a bare name.
    expect(zone(measuredTwice(at({}), at({})).results, "m2-ef")).toMatchObject(DUPLICATE);
    expect(zone(measuredTwice(at({ plan_file_id: PLAN }), at({})).results, "m2-ef")).toMatchObject(DUPLICATE);
    // A page whose identity is unknown (a row read without it), or whose page number is unknown.
    expect(zone(measuredTwice(at({ plan_file_id: PLAN }), null).results, "m2-ef")).toMatchObject(DUPLICATE);
    expect(zone(measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN }, null)).results, "m2-ef")).toMatchObject(DUPLICATE);
  });

  it("leaves two pages of one document, and one page number of two documents, to Z1/Z2 as before", () => {
    const pages = measuredTwice(at({ plan_file_id: PLAN }, 1), at({ plan_file_id: PLAN }, 2));
    expect(zone(pages.results, "m2-ef")).toMatchObject({ ...DUPLICATE, details: { overlap_m: 5, partners: [{ item_id: "m1-ef" }] } });
    const documents = measuredTwice(at({ plan_file_id: PLAN, content_hash: HASH, file_name: "Plan.pdf" }),
      at({ plan_file_id: OTHER_PLAN, content_hash: "b".repeat(64), file_name: "Plan.pdf" }));
    expect(zone(documents.results, "m2-ef")).toMatchObject(DUPLICATE);
  });

  it("leaves one page read twice by one takeoff to Z1/Z2: the page decision compares a takeoff with the others only", () => {
    // Two uploads of one PDF in a single takeoff: two vector pages of one job, one content hash.
    const pages = [page("m2#1", at({ content_hash: HASH, file_name: "R+1.pdf" }), { order: 1 }),
      page("m2#2", at({ content_hash: HASH, file_name: "R+1 bis.pdf" }), { order: 2 })];
    const { results } = evaluateTakeoffRules({ pages, lines: [run("first", "m2#1"), run("second", "m2#2")] });
    expect(zone(results, "second")).toMatchObject({ ...DUPLICATE, details: { partners: [{ item_id: "first" }] } });
  });

  it("keeps a real duplicate between two zones of one takeoff, and names it alone beside a page measured again", () => {
    // Z2's sheet shows the building 40 m further: Z1's run 0–5 m and Z2's 4–7 m share 1 m.
    const z2 = page("m1#2", at({ plan_file_id: OTHER_PLAN, file_name: "Plan R+1 Z2.pdf" }), { order: 2, zone: "Z2", anchors: sheet(-40) });
    const z2Run = run("z2-ef", "m1#2", { frozen: true, quantity: 3, inputs: inputs({ model_quantity: 3 }),
      geometry: { segments_m: [[-36, 1, -33, 1]], polygon_m: null, length_m: 3, area_m2: null } });
    const single = evaluateTakeoffRules({ pages: [page("m1#1", at({ plan_file_id: PLAN }), { order: 1 }), z2],
      lines: [run("m1-ef", "m1#1"), { ...z2Run, frozen: false }] });
    expect(zone(single.results, "m1-ef")).toMatchObject({ ...DUPLICATE, details: { overlap_m: 1, partners: [{ item_id: "z2-ef" }] } });
    // Z1 measured again by M2: its line still duplicates Z2's, never its own first reading. The three lines stay one group,
    // as they were before the change (Z2's line draws both readings of Z1).
    const again = evaluateTakeoffRules({ pages: [page("m1#1", at({ plan_file_id: PLAN }), { order: 1 }), z2,
      page("m2#1", at({ plan_file_id: PLAN }), { order: 10_001 })], lines: [run("m1-ef", "m1#1", { frozen: true }), z2Run, run("m2-ef", "m2#1")] });
    expect(zone(again.results, "m2-ef")).toMatchObject({ ...DUPLICATE, details: { group_size: 3, partners: [{ item_id: "z2-ef" }] } });
    expect(zone(again.results, "m2-ef")?.details?.partners).toHaveLength(1);
    expect(zone(again.results, "z2-ef")?.details?.partners?.map((partner) => partner.item_id).sort()).toEqual(["m1-ef", "m2-ef"]);
  });

  it("never treats two readings that print two zones as one page, even under one plan reference (independent review)", () => {
    // Revision B inserted a sheet: its page 1 is Z2 where revision A's page 1 was Z1. A zone not read stays the same page.
    const zones = measuredTwice(at({ logical_document_id: "PLB-R1", plan_file_id: PLAN }), at({ logical_document_id: "PLB-R1", plan_file_id: OTHER_PLAN }),
      { m2: { zone: "Z2" } });
    expect(zone(zones.results, "m2-ef")).toMatchObject(DUPLICATE);
    const unread = measuredTwice(at({ logical_document_id: "PLB-R1", plan_file_id: PLAN }), at({ logical_document_id: "PLB-R1", plan_file_id: OTHER_PLAN }),
      { m2: { zone: null } });
    expect(zone(unread.results, "m2-ef")).toMatchObject(SAME_PAGE);
  });

  it("keeps an overview measured again beside its enlarged plan one group while its first reading is applied (independent review)", () => {
    // The overview O (1/100) draws 2–9 m and the enlarged plan E (1/50) 0–5 m: 3 m in common. M1 applied O, M2 reads it
    // again. The applied reading never yields to E; if M2's alone did, a reduction of E against M1's and of M2's against
    // E would both pass, and once M2 replaces M1's measure the 3 m would be counted nowhere.
    const overview = (key: string, quantity: number, frozen = false, excluded = false) => run(`${key}-o`, `${key}#1`, { frozen, quantity,
      is_excluded: excluded, inputs: inputs({ model_quantity: 7 }),
      geometry: { segments_m: [[2, 1, 9, 1]], polygon_m: null, length_m: 7, area_m2: null } });
    const detail = (quantity: number) => run("e-d", "e#1", { quantity, geometry: { segments_m: [[-40, 1, -35, 1]], polygon_m: null, length_m: 5, area_m2: null } });
    const evaluate = (m2: number, e: number, firstFrozen = true, firstExcluded = false) => evaluateTakeoffRules({
      pages: [page("m1#1", at({ plan_file_id: PLAN }), { order: 1, denominator: 100 }),
        page("e#1", at({ plan_file_id: OTHER_PLAN, file_name: "Détail R+1.pdf" }), { order: 5_001, denominator: 50, anchors: sheet(-40) }),
        page("m2#1", at({ plan_file_id: PLAN }), { order: 10_001, denominator: 100 })],
      lines: [overview("m1", 7, firstFrozen, firstExcluded), detail(e), overview("m2", m2)] }).results;
    for (const [m2, e] of [[7, 5], [4, 5], [7, 2], [4, 2]]) {
      const results = evaluate(m2, e);
      for (const id of ["m2-o", "e-d"]) expect(zone(results, id), `${id} with M2 ${m2} and E ${e}`).toMatchObject({ ...DUPLICATE, details: { group_size: 3 } });
    }
    // Both readings still current: each yields to E and carries its own correction, as an overview does.
    expect(zone(evaluate(7, 5, false), "m2-o")).toMatchObject({ ...DUPLICATE, details: { partners: [{ item_id: "e-d", plan: "enlarged" }] } });
    expect(zone(evaluate(4, 5, false), "m2-o")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED" });
    // An applied first reading left out of the estimate counts nothing: the second yields alone.
    expect(zone(evaluate(7, 5, true, true), "m2-o")).toMatchObject({ ...DUPLICATE, details: { partners: [{ item_id: "e-d", plan: "enlarged" }] } });
  });

  it("never reads a page measured again at another scale as an enlarged plan of itself (review)", () => {
    // The two readings of one page carry the scale each takeoff read: 1/100 then 1/50, or the reverse. The finer one is
    // no enlarged plan of the coarser: its copy is no pair, so the coverage rule found the whole run undrawn there.
    for (const [first, second] of [[100, 50], [50, 100]]) {
      const { results } = measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN }), { m1: { denominator: first }, m2: { denominator: second } });
      for (const id of ["m1-ef", "m2-ef"]) {
        expect(zone(results, id), `${id} at 1/${first} then 1/${second}`).toMatchObject(SAME_PAGE);
        expect(results.get(id)?.filter((entry) => entry.rule === "zone_coverage"), `${id} at 1/${first} then 1/${second}`).toEqual([]);
      }
    }
    // A real enlarged plan still controls both readings of the overview: it draws 2 m of their 5 m inside its perimeter.
    const pages = [page("m1#1", at({ plan_file_id: PLAN }), { order: 1, denominator: 100 }),
      page("e#1", at({ plan_file_id: OTHER_PLAN, file_name: "Détail R+1.pdf" }), { order: 5_001, denominator: 50 }),
      page("m2#1", at({ plan_file_id: PLAN }), { order: 10_001, denominator: 100 })];
    const detail = run("e-d", "e#1", { quantity: 7, inputs: inputs({ model_quantity: 7 }),
      geometry: { segments_m: [[0, 1, 2, 1], [0, 3, 5, 3]], polygon_m: null, length_m: 7, area_m2: null } });
    const beside = evaluateTakeoffRules({ pages, lines: [run("m1-ef", "m1#1"), detail, run("m2-ef", "m2#1")] }).results;
    for (const id of ["m1-ef", "m2-ef"]) {
      expect(beside.get(id)?.find((entry) => entry.rule === "zone_coverage"), id)
        .toMatchObject({ status: "fail", code: "ZONE_COVERAGE_NOT_ON_ENLARGED_PLAN", details: { uncovered_m: 3 } });
    }
  });

  it("compares an excluded reading with the included one, and never counts an excluded first reading", () => {
    const excludedAgain = measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN }), { line: { is_excluded: true } });
    expect(zone(excludedAgain.results, "m2-ef")).toMatchObject(SAME_PAGE);
    const pages = [page("m1#1", at({ plan_file_id: PLAN }), { order: 1 }), page("m2#1", at({ plan_file_id: PLAN }), { order: 10_001 })];
    const excludedFirst = evaluateTakeoffRules({ pages, lines: [run("m1-ef", "m1#1", { frozen: true, is_excluded: true }), run("m2-ef", "m2#1")] });
    expect(zone(excludedFirst.results, "m2-ef")).toMatchObject({ code: "ZONE_OVERLAP_NONE" });
  });
});

describe("decisions made on a re-measured page before the change", () => {
  // As stored before this change (zone_overlap version 3): the first reading named as an applied partner.
  const stored = (partner: string): TakeoffRuleResult[] => [{ rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE",
    version: 3 * 100 + REGISTRATION_VERSION, acceptable: true, reason: "Fictif.",
    details: { level: "R+1", overlap_m: 5, partner_count: 1, partners: [{ item_id: partner, job_id: "m1", zone: "Z1",
      designation: "EF Inox 316L DN 22", overlap_m: 5, resolved: false }] } }];

  it("keeps a verified line verified when its duplicate disappears: the writer reopens a line on a new failure only", () => {
    const now = measuredTwice(at({ plan_file_id: PLAN }), at({ plan_file_id: PLAN })).results.get("m2-ef");
    expect(ruleFailuresReopen(stored("m1-ef"), now)).toBe(false);
    expect(isRuleBlocked(now, false, true)).toBe(false);
    expect(isRuleBlocked(now, false, false)).toBe(false);
  });

  it("reopens a verified line whose real duplicate remains: the rule's version is part of every failure key", () => {
    const now = measuredTwice(at({ plan_file_id: PLAN }, 1), at({ plan_file_id: PLAN }, 2)).results.get("m2-ef");
    expect(zone(new Map([["m2-ef", now ?? []]]), "m2-ef")).toMatchObject(DUPLICATE);
    expect(ruleFailuresReopen(stored("m1-ef"), now)).toBe(true);
  });
});
