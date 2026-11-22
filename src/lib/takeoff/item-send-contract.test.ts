import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  itemSendCanonical,
  planTakeoffItemSend,
  type ItemSendAnswer,
  type ItemSendDraftLine,
  type ItemSendEarlierTarget,
  type ItemSendInput,
  type ItemSendListItem,
  type ItemSendWritePlan,
} from "@/lib/takeoff/item-send-plan";
import { projectItemSendRules } from "@/lib/takeoff/item-send-rules";
import type { TakeoffMappingRule } from "@/lib/takeoff/types";

// Lot 4, PR 5b (closing of #484's last check): one contract between the planner's output and the writer's input. The real
// planner computes the plans of a few fictional sends (a first draft, an existing draft with its page decisions, a DPGF
// line chosen by the member, a deleted line recreated); each is serialised as the route sends it to the writer (the JSON
// of p_request.plan, with the server's digest of the member's choices). Those serialised plans are checked in as vectors
// of supabase/tests/database/takeoff-item-send.test.sql, which runs them through the writer's own shape check (every key
// SQL reads present, none it does not know) and reads the keys it consumes from them: a key renamed on one side breaks
// this test or that file, never a member's confirmation. To write the vectors again after a deliberate change of the
// plan: ITEM_SEND_CONTRACT_WRITE=<file> npx vitest run src/lib/takeoff/item-send-contract.test.ts, then paste.

const SQL_FILE = path.join(process.cwd(), "supabase/tests/database/takeoff-item-send.test.sql");
const id = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const JOB = id("c1000000", 1);
const OTHER_JOB = id("c1000000", 2);
const VERSION = id("c2000000", 1);
const IMPORT = id("c3000000", 1);
const PLAN = id("c4000000", 1);
const itemId = (n: number) => id("c5000000", n);
const lineId = (n: number) => id("c6000000", n);
const answerId = (n: number) => id("c7000000", n);
const observationId = (n: number) => id("c8000000", n);
const LOT = { id: "lot-plomberie", title: "Plomberie", order: 1 };
const FAMILY = { id: "fam-sanitaires", title: "Appareils sanitaires", order: 2 };
const REVISION = "a".repeat(64);

const templateItem = (n: number, label: string): ItemSendListItem => ({ id: itemId(n), label, expectedUnit: "u", measurementBasis: null,
  qualifiers: {}, sections: [LOT, FAMILY], referenceQuantity: null,
  origin: { kind: "template", templateId: "plomberie", version: 1, familyId: FAMILY.id, lineId: `line-${n}` } });
const dpgfItem = (n: number, label: string, rawRow: string): ItemSendListItem => ({ id: itemId(n), label, expectedUnit: "u",
  measurementBasis: null, qualifiers: {}, sections: [LOT], referenceQuantity: 4,
  origin: { kind: "dpgf", importId: IMPORT, mappingId: "mapping-1", rawRowId: rawRow, mappedRowId: "mapped-1", rowIndex: n,
    sheetName: null, sourceRowNumber: n, sourcePage: null, tableIndex: null, documentId: null, reference: `1.${n}`, sourceUnit: "u",
    measurementNotesDigest: null, factsDigest: "facts" } });
function measured(item: ItemSendListItem, n: number, parts: Array<{ quantity: number; page: number }>, extra: Partial<ItemSendAnswer> = {}):
  ItemSendAnswer {
  return { itemId: item.id, answerId: answerId(n), revision: REVISION, outcome: "measured", decision: { kind: "accepted", revision: 1 },
    entry: null, searchedPages: [2, 7], current: true,
    observations: parts.map((part, index) => ({ observationId: observationId(n * 10 + index), role: "contribution" as const,
      source: "model" as const, quantity: part.quantity, unit: "u", page: part.page, measurementBasis: null })), ...extra };
}
const line = (n: number, overrides: Partial<ItemSendDraftLine> = {}): ItemSendDraftLine => ({ id: lineId(n), parentId: null,
  title: `Ligne ${n}`, unitCode: "u", pricingStatus: "priced", quantity: 0, updatedAt: "2026-11-22T08:00:00.000Z", dpgf: null, ...overrides });
const earlierPart = (overrides: Partial<ItemSendEarlierTarget["parts"][number]> = {}): ItemSendEarlierTarget["parts"][number] => ({
  jobId: OTHER_JOB, answerId: answerId(90), observationIds: [observationId(900)], quantity: 3, unit: "u", basis: null, qualifiers: {},
  pages: [2], planKey: PLAN, identity: { unit: "u", basis: null, network: null, material: null, diameter: null }, ...overrides });

function input(overrides: Partial<ItemSendInput> & Pick<ItemSendInput, "items" | "answers">): ItemSendInput {
  return {
    affaireNamesBuilding: false,
    stamps: { job: "job-stamp", peers: null, context: null, dpgf: [], firstDraftSettings: null, destination: null, mapping: "mapping-stamp" },
    job: { id: JOB, status: "completed", sent: false, canEdit: true },
    plan: { key: PLAN, name: "Plan A — RDC", location: null, pages: [2, 7] },
    list: { revisionId: id("c9000000", 1), revision: 3 },
    scope: overrides.items.map((item) => item.id),
    affaireEntries: [],
    destination: { kind: "first_draft", engine: 3, maxSectionDepth: 3 },
    earlier: { targets: [], sections: [], displaced: [] },
    pagesInEstimate: [],
    rules: new Map(),
    breakdown: "together",
    resolutions: [],
    ...overrides,
  };
}
const existing = (lines: ItemSendDraftLine[]) => ({ kind: "existing_draft" as const, versionId: VERSION, engine: 3 as const,
  maxSectionDepth: 3, sections: [], lines });
const existingStamps = { job: "job-stamp", peers: "peers-stamp", context: { peers: "p", locations: "l" },
  dpgf: [{ importId: IMPORT, mappingId: "c3100000-0000-4000-8000-000000000001", rowsSha256: "b".repeat(64), updatedAt: "2026-11-22T07:00:00.000Z",
    status: "completed", rowCount: 3 }], firstDraftSettings: null,
  destination: { versionId: VERSION, status: "draft", updatedAt: "2026-11-22T08:30:00.000Z" }, mapping: "mapping-stamp" };

const lavabo = templateItem(1, "Lavabo");
const wc = templateItem(2, "WC suspendu");
const rules = projectItemSendRules([lavabo, wc], [{ id: id("ca000000", 1), tenant_id: "t", created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z", created_by: "m", name: "Renommer le lavabo", match_pattern: "lavabo", match_type: "contains",
  action: "rename", action_params: { designation: "Lavabo PMR" }, priority: 1, is_active: true } as TakeoffMappingRule]);

/** The fictional sends, each with the member's choices it was confirmed with. */
function contractPlans(): Array<{ name: string; plan: ItemSendWritePlan }> {
  const first = planTakeoffItemSend(input({ items: [lavabo, wc], rules,
    stamps: { ...input({ items: [], answers: [] }).stamps, firstDraftSettings: { validite_jours: 30, discount_bp: 0 } },
    answers: [measured(lavabo, 1, [{ quantity: 2, page: 2 }, { quantity: 1, page: 7 }]),
      measured(wc, 2, [{ quantity: 4, page: 2 }], { decision: null })] }));
  const fed = line(10, { quantity: 3 });
  const today = line(11, { title: "Ligne d'aujourd'hui" });
  const decided = planTakeoffItemSend(input({ items: [lavabo], destination: existing([fed, today]), stamps: existingStamps,
    answers: [measured(lavabo, 3, [{ quantity: 2, page: 2 }, { quantity: 4, page: 7 }])],
    earlier: { targets: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together", estimateItemId: fed.id,
      parts: [earlierPart({ pages: [2], quantity: 2, observationIds: [observationId(901)] }),
        earlierPart({ pages: [7], quantity: 1, observationIds: [observationId(902)] })] }], sections: [], displaced: [] },
    pagesInEstimate: [{ page: 2, earlierJobIds: [OTHER_JOB], estimateItemIds: [today.id], today: true, todayEstimateItemIds: [today.id],
      parts: [] }],
    pageDecisions: [{ page: 2, decision: "keep_both", reasonCode: "complementary_scope", note: "Autre zone du plan (fictive)" }] }));
  const offered = line(20, { title: "Lavabo (DPGF)", quantity: 4, dpgf: { importId: IMPORT, metadataImportId: IMPORT, mappedRowId: "mapped-9",
    rawRowId: "raw-9", reference: 4, composition: { version: 0 } } });
  const dpgf = dpgfItem(3, "Lavabo DPGF", "raw-3");
  const asked = planTakeoffItemSend(input({ items: [dpgf], destination: existing([offered]), stamps: existingStamps,
    answers: [measured(dpgf, 4, [{ quantity: 5, page: 7 }])] }));
  const chosen = planTakeoffItemSend(input({ items: [dpgf], destination: existing([offered]), stamps: existingStamps,
    answers: [measured(dpgf, 4, [{ quantity: 5, page: 7 }])],
    resolutions: [{ key: asked.toResolve[0].key, choice: { kind: "line", estimateItemId: offered.id } }] }));
  const recreated = planTakeoffItemSend(input({ items: [lavabo], destination: existing([]), stamps: existingStamps,
    answers: [measured(lavabo, 5, [{ quantity: 2, page: 2 }])],
    earlier: { targets: [], sections: [], displaced: [{ itemId: lavabo.id, breakdown: "together", compartmentKey: "together",
      parts: [earlierPart()] }] },
    resolutions: [{ key: `target:${lavabo.id}|together`, choice: { kind: "new_line" } }] }));
  const plans = { first, decided, chosen, recreated };
  return Object.entries(plans).map(([name, computed]) => {
    if (!computed.writePlan) throw new Error(`Le plan ${name} n'est pas confirmable : ${JSON.stringify(computed.toResolve)}`);
    // As the route sends it: the server adds the digest of the member's choices, then JSON carries it to the writer.
    const plan = { ...computed.writePlan, choices_sha256: createHash("sha256").update(itemSendCanonical({ name }), "utf8").digest("hex") };
    return { name, plan: JSON.parse(JSON.stringify(plan)) as ItemSendWritePlan };
  });
}

const vectors = () => {
  const match = /\$contract\$(\[[\s\S]*?\])\$contract\$/.exec(readFileSync(SQL_FILE, "utf8"));
  if (!match) throw new Error("Les plans du contrat sont introuvables dans le fichier pgTAP.");
  return JSON.parse(match[1]) as Array<{ name: string; plan: ItemSendWritePlan }>;
};

describe("the contract between the planner's plans and the writer", () => {
  it("serialises the plans the pgTAP file runs through the writer, key for key", () => {
    const plans = contractPlans();
    if (process.env.ITEM_SEND_CONTRACT_WRITE) {
      writeFileSync(process.env.ITEM_SEND_CONTRACT_WRITE, plans.map((entry) => JSON.stringify(entry)).join(",\n"));
    }
    expect(plans).toEqual(vectors());
  });

  it("covers every branch the writer reads: page decisions, a chosen line, a recreated line, rules and parts not sent", () => {
    const byName = new Map(contractPlans().map((entry) => [entry.name, entry.plan]));
    expect(byName.get("decided")!.page_decisions).toEqual([{ page: 2, decision: "keep_both", reason_code: "complementary_scope",
      note: "Autre zone du plan (fictive)" }]);
    expect(byName.get("chosen")!.dependencies.resolutions).toEqual([expect.objectContaining({ choice: { kind: "line",
      estimate_item_id: lineId(20) } })]);
    expect(byName.get("recreated")!.targets[0].replaces).toHaveLength(1);
    expect(byName.get("first")!.dependencies.rules).toHaveLength(1);
    expect(byName.get("first")!.parts_not_sent.length + byName.get("first")!.left_out.length).toBeGreaterThan(0);
  });
});
