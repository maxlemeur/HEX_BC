import { describe, expect, it } from "vitest";

import type { ItemSendPreviewResponse } from "@/lib/takeoff/item-send-contracts";
import {
  EMPTY_ITEM_SEND_CHOICES,
  itemSendPageHolderChanged,
  itemSendPreviewChanges,
  itemSendRequestOf,
  reconcileItemSendChoices,
  withItemSendPageDecision,
  withItemSendResolution,
} from "@/lib/takeoff/item-send-screen";

const JOB = "00000000-0000-4000-8000-000000000001";
const LAVABO = "00000000-0000-4000-8000-0000000000a1";
const WC = "00000000-0000-4000-8000-0000000000a2";
const LINE = "00000000-0000-4000-8000-0000000000b1";
const OTHER_LINE = "00000000-0000-4000-8000-0000000000b2";

type Line = ItemSendPreviewResponse["lines"][number];

function line(overrides: Partial<Line> = {}): Line {
  return { key: `${LAVABO}|together`, item_id: LAVABO, label: "Lavabo", change: "fed", target: "earlier_line", estimate_item_id: LINE,
    title: "Lavabo", section_key: null, compartment: { key: "together", label: "Ensemble", reason: null }, unit: "u",
    quantity_before: 3, quantity_after: 5, reference: null, entered: null, earlier: 3, replaced: 0, added: 2, measured: 5, retained: 5,
    rounded_from: null, gap: null, kept_entry: false, pages: [2], rule: null, ...overrides };
}

function preview(overrides: Partial<ItemSendPreviewResponse> = {}): ItemSendPreviewResponse {
  return { job_id: JOB, plan: { key: "plan-b", name: "Plan B" }, list: { revision_id: JOB, revision: 1 }, destinations: [],
    destination: { kind: "existing_draft", version_id: JOB }, destination_label: "V1 · Brouillon", version_created: false, engine: 3,
    breakdown: "together", blocked: null, sections: [], lines: [line()], not_sent: [], parts_not_sent: [], to_resolve: [], not_added: [],
    page_contributions: [], invalid_page_decisions: [], rules: [], confirmable: true, focus_item_id: LINE, plan_digest: "a".repeat(64),
    ...overrides };
}

const entryPoint = (key = `entry:${LAVABO}|together`): ItemSendPreviewResponse["to_resolve"][number] => ({ key, kind: "entered_quantity",
  item_id: LAVABO, label: "Lavabo", page: null, held_item_ids: [], earlier_lines: [], message: "Saisie à la main.",
  options: [{ kind: "keep_entry" }, { kind: "use_retained" }, { kind: "leave_out" }], facts: { reference: null, entered: 4, measured: 5, retained: 5 } });

describe("the member's choices on the send of one plan", () => {
  it("asks the preview with each explicit choice and each page decision, and nothing else", () => {
    let choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "use_retained" });
    choices = withItemSendPageDecision(choices, { page: 2, decision: "keep_both", reasonCode: "complementary_scope",
      note: "  Reprise des réseaux existants  " });
    expect(itemSendRequestOf({ destination: { kind: "first_draft" }, breakdown: "by_level", choices })).toEqual({
      destination: { kind: "first_draft" }, breakdown: "by_level",
      resolutions: [{ key: `entry:${LAVABO}|together`, choice: { kind: "use_retained" } }],
      page_decisions: [{ page: 2, decision: "keep_both", reason_code: "complementary_scope", note: "Reprise des réseaux existants" }],
    });
    expect(itemSendRequestOf({ choices: EMPTY_ITEM_SEND_CHOICES })).toEqual({});
  });

  it("never asks « garder les deux » without its reason, nor a complementary scope without its note", () => {
    const pending = withItemSendPageDecision(EMPTY_ITEM_SEND_CHOICES, { page: 2, decision: "keep_both", reasonCode: null, note: null });
    expect(itemSendRequestOf({ choices: pending })).toEqual({});
    const short = withItemSendPageDecision(EMPTY_ITEM_SEND_CHOICES, { page: 2, decision: "keep_both", reasonCode: "complementary_scope",
      note: "court" });
    expect(itemSendRequestOf({ choices: short })).toEqual({});
    const other = withItemSendPageDecision(EMPTY_ITEM_SEND_CHOICES, { page: 2, decision: "keep_both", reasonCode: "other_trade", note: null });
    expect(itemSendRequestOf({ choices: other }).page_decisions).toEqual([{ page: 2, decision: "keep_both", reason_code: "other_trade",
      note: null }]);
  });

  it("drops the choice of a point asked again: its option is no longer offered", () => {
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "keep_entry" });
    const next = preview({ lines: [], to_resolve: [{ ...entryPoint(), options: [{ kind: "use_retained" }, { kind: "leave_out" }] }],
      confirmable: false, plan_digest: null });
    const { choices: kept, dropped } = reconcileItemSendChoices(choices, next);
    expect(kept.resolutions.size).toBe(0);
    expect(dropped).toEqual(["« Lavabo » : votre choix ne s’applique plus, choisissez de nouveau."]);
  });

  it("keeps a choice the new preview still applies, by what it shows", () => {
    let choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "keep_entry" });
    choices = withItemSendResolution(choices, { ...entryPoint(`target:${WC}|together`), kind: "target_multiple", item_id: WC, label: "WC",
      options: [{ kind: "line", estimate_item_id: OTHER_LINE, title: "WC" }, { kind: "leave_out" }] },
    { kind: "line", estimateItemId: OTHER_LINE });
    const next = preview({ lines: [line({ entered: 4, kept_entry: true, quantity_after: 4 }),
      line({ key: `${WC}|together`, item_id: WC, label: "WC", estimate_item_id: OTHER_LINE })] });
    const { choices: kept, dropped } = reconcileItemSendChoices(choices, next);
    expect([...kept.resolutions.keys()].sort()).toEqual([`entry:${LAVABO}|together`, `target:${WC}|together`].sort());
    expect(dropped).toEqual([]);
  });

  it("drops a choice whose point is gone, and says so", () => {
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "keep_entry" });
    // The line holds what the sends wrote again: nothing is typed by hand any more, the point is gone.
    const { choices: kept, dropped } = reconcileItemSendChoices(choices, preview());
    expect(kept.resolutions.size).toBe(0);
    expect(dropped).toEqual(["« Lavabo » : ce point n’est plus à trancher."]);
  });

  it("keeps a choice that leads to a second point, which the member then sees", () => {
    // « Alimenter X » for a DPGF item: the line chosen was typed by hand, so the preview now asks its entry.
    const target = { ...entryPoint(`target:${LAVABO}|dpgf`), kind: "target_missing" as const,
      options: [{ kind: "line" as const, estimate_item_id: LINE, title: "Lavabo" }, { kind: "leave_out" as const }] };
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, target, { kind: "line", estimateItemId: LINE });
    const next = preview({ lines: [], to_resolve: [entryPoint(`entry:${LAVABO}|dpgf`)], confirmable: false, plan_digest: null });
    const { choices: kept, dropped } = reconcileItemSendChoices(choices, next);
    expect([[...kept.resolutions.keys()], dropped]).toEqual([[`target:${LAVABO}|dpgf`], []]);
  });

  it("keeps « conserver la saisie » the server suspends, so that the member can change it", () => {
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "keep_entry" });
    const next = preview({ lines: [], not_sent: [{ item_id: LAVABO, label: "Lavabo", reason: "entry_suspended", message: "Suspendue." }] });
    expect(reconcileItemSendChoices(choices, next)).toEqual({ choices, dropped: [] });
  });

  it("drops a choice on an entry typed again since: the member chose about another quantity", () => {
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "use_retained" });
    const next = preview({ lines: [line({ entered: 15, quantity_before: 15 })] });
    const { choices: kept, dropped } = reconcileItemSendChoices(choices, next);
    expect([kept.resolutions.size, dropped]).toEqual([0,
      ["« Lavabo » : la ligne ou les quantités sur lesquelles vous aviez choisi ont changé, choisissez de nouveau."]]);
  });

  it("records what a choice is applied on, and drops it when another line or other quantities stand there", () => {
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "use_retained" });
    const applied = line({ entered: 4, quantity_before: 4, quantity_after: 5 });
    const first = reconcileItemSendChoices(choices, preview({ lines: [applied] }));
    expect([first.dropped, first.choices.resolutions.get(`entry:${LAVABO}|together`)?.appliedOn]).toEqual([[],
      { estimateItemId: LINE, entered: 4, measured: 5, retained: 5 }]);
    // A proven line B holding the same entry, or the retained quantity moved on A: the member chooses again.
    for (const now of [line({ ...applied, estimate_item_id: OTHER_LINE }), line({ ...applied, measured: 7, retained: 7, quantity_after: 7 })]) {
      const next = reconcileItemSendChoices(first.choices, preview({ lines: [now] }));
      expect([next.choices.resolutions.size, next.dropped]).toEqual([0,
        ["« Lavabo » : la ligne ou les quantités sur lesquelles vous aviez choisi ont changé, choisissez de nouveau."]]);
    }
  });

  // Review of #499, round two, point 1: bound when made, not when first applied.
  it("binds a choice to the line its question named when the member made it", () => {
    const named = { ...entryPoint(), earlier_lines: [{ estimate_item_id: LINE, title: "Lavabo", quantity: 4 }] };
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, named, { kind: "use_retained" });
    expect(choices.resolutions.get(named.key)?.appliedOn).toEqual({ estimateItemId: LINE, entered: 4, measured: 5, retained: 5 });
    // The first preview applying it shows another proven line with the same quantities: asked again.
    const next = reconcileItemSendChoices(choices, preview({ lines: [line({ estimate_item_id: OTHER_LINE, entered: 4, quantity_before: 4 })] }));
    expect([next.choices.resolutions.size, next.dropped]).toEqual([0,
      ["« Lavabo » : la ligne ou les quantités sur lesquelles vous aviez choisi ont changé, choisissez de nouveau."]]);
  });

  it("builds one request for the same choices made in another order", () => {
    const wc = { ...entryPoint(`entry:${WC}|together`), item_id: WC, label: "WC" };
    const one = withItemSendResolution(withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "use_retained" }), wc,
      { kind: "keep_entry" });
    const other = withItemSendResolution(withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, wc, { kind: "keep_entry" }), entryPoint(),
      { kind: "use_retained" });
    expect(JSON.stringify(itemSendRequestOf({ choices: one }))).toBe(JSON.stringify(itemSendRequestOf({ choices: other })));
  });

  it("says a page holder changed when its lines, their quantities or the items held moved", () => {
    const page = { ...entryPoint("page:2"), kind: "page_decision" as const, label: null, item_id: null, facts: null, page: 2,
      held_item_ids: [LAVABO], earlier_lines: [{ estimate_item_id: LINE, title: "Ancien apport", quantity: 3 }], options: [] };
    expect(itemSendPageHolderChanged(page, { ...page, earlier_lines: [{ estimate_item_id: LINE, title: "Renommé", quantity: 3 }] })).toBe(false);
    expect(itemSendPageHolderChanged(page, { ...page, earlier_lines: [{ estimate_item_id: LINE, title: "Ancien apport", quantity: 8 }] })).toBe(true);
    expect(itemSendPageHolderChanged(page, { ...page, held_item_ids: [LAVABO, WC] })).toBe(true);
  });

  it("keeps a « laisser de côté » the new preview still shows left out", () => {
    const choices = withItemSendResolution(EMPTY_ITEM_SEND_CHOICES, entryPoint(), { kind: "leave_out" });
    const next = preview({ lines: [], not_sent: [{ item_id: LAVABO, label: "Lavabo", reason: "left_out", message: "Laissé de côté." }] });
    expect(reconcileItemSendChoices(choices, next).choices.resolutions.size).toBe(1);
  });

  it("drops a page decision on a page no longer held, and keeps the others", () => {
    let choices = withItemSendPageDecision(EMPTY_ITEM_SEND_CHOICES, { page: 2, decision: "replace" });
    choices = withItemSendPageDecision(choices, { page: 7, decision: "keep_both", reasonCode: "other_zone", note: null });
    const next = preview({ invalid_page_decisions: [{ page: 2, reason: "page_not_held", message: "Cette page n’est pas au devis." }],
      confirmable: false, plan_digest: null });
    const { choices: kept, dropped } = reconcileItemSendChoices(choices, next);
    expect([...kept.pageDecisions.keys()]).toEqual(["page:7"]);
    expect(dropped).toEqual(["Page 2 : elle n’attend plus de décision."]);
  });
});

describe("what changed between two previews of the same plan", () => {
  it("names each line whose quantities moved, appeared or left, and a new point to resolve", () => {
    const before = preview({ lines: [line(), line({ key: `${WC}|together`, item_id: WC, label: "WC", estimate_item_id: OTHER_LINE,
      quantity_before: 1, quantity_after: 2 })] });
    const after = preview({ lines: [line({ quantity_before: 4, quantity_after: 6 })], to_resolve: [entryPoint()], confirmable: false });
    expect(itemSendPreviewChanges(before, after)).toEqual([
      "« Lavabo » : 4 → 6 u (l’aperçu précédent montrait 3 → 5 u).",
      "« WC » : n’est plus envoyé par cette confirmation.",
      "« Lavabo » : un choix est à faire.",
    ]);
  });

  it("says once that a line typed by hand since the preview now asks a choice, with what it holds now", () => {
    const after = preview({ lines: [], to_resolve: [entryPoint()], confirmable: false, plan_digest: null });
    expect(itemSendPreviewChanges(preview(), after)).toEqual([
      "« Lavabo » : la ligne du devis tient maintenant 4 u (3 u à l’aperçu précédent) : un choix est à faire.",
    ]);
  });

  it("says nothing when the plan shown is the same", () => {
    expect(itemSendPreviewChanges(preview(), preview())).toEqual([]);
  });

  it("names a line now sent and a destination that changed", () => {
    const after = preview({ destination_label: "V2 · Brouillon", lines: [line(),
      line({ key: `${WC}|together`, item_id: WC, label: "WC", change: "created", estimate_item_id: null, quantity_before: null,
        quantity_after: 1 })] });
    expect(itemSendPreviewChanges(preview(), after)).toEqual([
      "Destination : V2 · Brouillon (au lieu de V1 · Brouillon).",
      "« WC » : envoyé maintenant (1 u).",
    ]);
  });
});
