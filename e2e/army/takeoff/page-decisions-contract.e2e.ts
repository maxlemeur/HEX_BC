import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { expect } from "e2e";

import {
  confirmationControls,
  initialConfirmationDraft,
  resolveConfirmation,
  setConfirmationControl,
  setPageNote,
  type ConfirmationDraft,
  type Resolution,
} from "@/components/takeoff/takeoff-apply-wizard/page-decisions";
import type { TakeoffPageDecision, TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, ownEstimate, readEstimate, recordEvidence, type ArmyState,
} from "../critical/fixtures";
import { applyOwnedTakeoff, localTakeoffFixture, type TakeoffSeedItem } from "./fixtures";
import { localSqlTransport } from "./generated-prerequisites";

// TI-682 lot D, PR 2: the contract between the « Pages déjà au devis » confirmation and the database.
//
// Codex reviews of 708c7fbf and 251a98a1: the screen and the proposal must never offer what the database refuses. The
// situations are derived from the database rather than from the cases thought of: every refusal reason the decisions'
// functions can raise is read from their definitions in the database (TI-682 D4: two migrations define them now), and
// each one is either reached by a naive decision in some situation
// (what a page-by-page screen, or a careless one, would send: the database must refuse it with exactly that reason) or
// named below with why the contract leaves it out. A reason added to the migration without a situation fails this
// journey.
//
// For each situation: an earlier takeoff applied through the route, then the estimator's edits and the fixtures it asks
// for, a relaunch seeded, and the proposal read from the real route with the estimator's session. Every state the screen
// reaches through enabled controls is walked (distinct by what it shows and sends); every state it lets the estimator
// confirm is applied by public.apply_takeoff_job_with_page_decisions as the estimator, in one transaction rolled back,
// and must be accepted; every choice it withholds, forced past it, must be refused. Then one complete state is applied
// through the real route. Engine 3 versions prepared by SQL in the estimator's own project (the Army tenant creates
// engine 2 versions, whose lines never carry two pages). Fictional plans and quantities only.

const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 900_000 };
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string; details?: unknown } };
type Read = { line: string; quantity: number; unit: string; page: number | null; doc?: "A" | "B"; excluded?: boolean };
type Context = {
  proposal: TakeoffPageReplacementResponse;
  /** The default resolution when complete, else the first complete one reached. */
  base: Resolution | null;
  /** The resolutions reached, complete or not. */
  reached: Resolution[];
  lineId: (title: string) => string;
  newLineId: (designation: string, doc?: "A" | "B") => string;
  relaunchIds: string[];
  outsider: { id: string; updated_at: string };
};
type Naive = { reason: string; build: (context: Context) => { payload: TakeoffPageDecision[]; strategy?: string } | null };
type Situation = {
  name: string;
  dpgf?: boolean;
  /** The relaunch's level: C by default; a line without a page is read at B (at C the quantity guard blocks it). */
  level?: "B" | "C";
  earlier: Read[];
  /** The estimator's quantity typed by hand on the earlier line of this title, before the relaunch. */
  handQuantity?: { title: string; quantity: number };
  /** SQL prepared once the earlier takeoff is applied (an ouvrage line, a DPGF target fed from the page). */
  prepare?: (input: { versionId: string; earlierJobId: string; plan: (doc?: "A" | "B") => string; source: (doc?: "A" | "B") => string }) => Promise<void>;
  relaunch: Read[];
  /** What the proposal must show before anything is chosen. */
  expect: (proposal: TakeoffPageReplacementResponse) => void;
  /** The decisions a naive screen would send here, and the refusal each one must meet. */
  naive?: Naive[];
  /** Edit the line after the proposal is read: the route refuses (STALE), the proposal read again is accepted. */
  staleAfterProposal?: string;
  /**
   * What the estimator sees in the wizard itself, after the walk; when it confirms the application there, the route
   * application of the walk's state is left out.
   */
  wizard?: (input: WizardInput) => Promise<{ applied: boolean } & Record<string, unknown>>;
};
type WizardInput = {
  ui: Parameters<Parameters<typeof armyTest>[2]>[0];
  ids: { projectId: string; versionId: string; sectionId: string; jobId: string };
  problem: (problem: string, detail: unknown) => void;
};

const read = (line: string, quantity: number, unit: string, page: number | null, extra: Partial<Read> = {}): Read => ({ line, quantity, unit, page, ...extra });
const EF = "EF cuivre DN 20";
const lineNamed = (proposal: TakeoffPageReplacementResponse, title: string) => proposal.lines.find((line) => line.title === title)!;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const mapLines = (payload: TakeoffPageDecision[], lineId: string, f: (line: TakeoffPageDecision["lines"][number], index: number) => TakeoffPageDecision["lines"][number]) =>
  payload.map((decision, index) => ({ ...decision, lines: decision.lines.map((line) => (line.estimate_item_id === lineId ? f(line, index) : line)) }));
const complete = (context: Context, predicate: (resolution: Resolution) => boolean) => context.reached.find((resolution) => resolution.complete && predicate(resolution)) ?? null;
const payloadWhere = (context: Context, predicate: (resolution: Resolution) => boolean) => context.reached.find(predicate)?.payload ?? null;

/** Naive decisions every situation meets: no decision at all, a strategy that empties the section, and stale or foreign references. */
const GENERIC: Naive[] = [
  { reason: "page_already_applied", build: () => ({ payload: [] }) },
  // « Remplacer la section » beside a replacement (the rule reads a page decided « replace »).
  { reason: "strategy_replace", build: (context) => {
    const replacing = complete(context, (resolution) => resolution.payload.some((decision) => decision.decision === "replace"));
    return replacing ? { payload: replacing.payload, strategy: "replace" } : null;
  } },
  { reason: "page_twice", build: (context) => (context.base ? { payload: [...context.base.payload, context.base.payload[0]] } : null) },
  { reason: "line_missing", build: (context) => {
    if (!context.base) return null;
    const payload = clone(context.base.payload);
    payload[0].lines[0] = { ...payload[0].lines[0], estimate_item_id: randomUUID() };
    return { payload };
  } },
  { reason: "line_changed", build: (context) => {
    if (!context.base) return null;
    const payload = clone(context.base.payload);
    payload[0].lines[0] = { ...payload[0].lines[0], expected_updated_at: "2000-01-01T00:00:00.000000+00:00" };
    return { payload };
  } },
  { reason: "line_not_on_page", build: (context) => {
    if (!context.base) return null;
    const payload = clone(context.base.payload);
    payload[0].lines.push({ estimate_item_id: context.outsider.id, expected_updated_at: context.outsider.updated_at, action: "keep", take: null, item_ids: [] });
    return { payload };
  } },
  { reason: "source_not_on_page", build: (context) => {
    if (!context.base) return null;
    const payload = clone(context.base.payload);
    payload[0].lines[0] = { ...payload[0].lines[0], item_ids: [...payload[0].lines[0].item_ids, context.relaunchIds[0]] };
    return { payload };
  } },
  // One page kept both, its decision left out while another page's decision is sent: its earlier part is then neither
  // replaced nor kept. (Without any decision left, the refusal is the page itself: page_already_applied.)
  { reason: "page_not_decided", build: (context) => {
    const keeping = complete(context, (resolution) => resolution.payload.length > 1 && resolution.payload.some((decision) => decision.decision === "keep_both"));
    if (!keeping) return null;
    const dropped = keeping.payload.findIndex((decision) => decision.decision === "keep_both");
    return { payload: keeping.payload.filter((_decision, index) => index !== dropped) };
  } },
  // A pair whose line is not updated, and updates without their pair.
  { reason: "pair_without_update", build: (context) => {
    const pair = context.base?.payload.flatMap((decision) => decision.pairs)[0];
    if (!context.base || !pair) return null;
    return { payload: mapLines(context.base.payload, pair.estimate_item_id, (line) => ({ ...line, action: "keep", take: null })) };
  } },
  { reason: "update_without_pair", build: (context) => {
    if (!context.base || !context.base.payload.some((decision) => decision.pairs.length > 0)) return null;
    return { payload: context.base.payload.map((decision) => ({ ...decision, pairs: [] })) };
  } },
];

type Prepare = { versionId: string; earlierJobId: string; plan: (doc?: "A" | "B") => string; source: (doc?: "A" | "B") => string };

/** Lines of the applied (frozen) earlier takeoff, written with triggers off: run lines of the DPGF line, one per page. */
async function frozenRuns({ earlierJobId, plan, source }: Prepare, runs: Array<{ quantity: number; page: number }>) {
  const items = runs.map((run) => ({ ...run, id: randomUUID() }));
  await sql(`begin;
set local session_replication_role = replica;
${items.map((run) => `insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, confidence, evidence,
source_file_name, source_page, metadata, is_excluded, is_verified)
select '${run.id}', job_item.tenant_id, job_item.job_id, job_item.result_id, 'EF cuivre DN 22', ${run.quantity}, 'ml', 0.95,
'ARMY localized fixture: EF cuivre DN 22', '${source()}', ${run.page},
jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', '${plan()}')), false, false
from public.takeoff_items job_item where job_item.job_id = '${earlierJobId}' limit 1;`).join("\n")}
commit;`);
  return items;
}

/** The DPGF line holds a policy (TI-682 D4: version 2, a composition; version 1, one takeoff written before D4). */
async function writeDpgfPolicy({ versionId, earlierJobId, source }: Prepare, quantity: number, policy: Record<string, unknown>) {
  await sql(`begin;
select set_config('miaouffrage.estimate_v3_writer', '${versionId}', true);
update public.estimate_items set quantity = ${quantity}, source_job_id = '${earlierJobId}', source_file_name = '${source()}', source_page = 1,
source_metadata = source_metadata || jsonb_build_object('takeoff_quantity_policy', ${literal(policy)})
where version_id = '${versionId}' and source_provider = 'dpgf';
select public.estimate_v3_complete_entry_for_writer('${versionId}', array(select id from public.estimate_items
where version_id = '${versionId}' and source_provider = 'dpgf'));
commit;`);
}

/**
 * A DPGF target an earlier takeoff fed from page 1 of the situation's plan: its run (40 ml, the DPGF reference being 30)
 * written into the applied takeoff, and the DPGF line holding it in its composition, as an application since D4 leaves it.
 */
async function feedDpgfTargetFromPage(input: Prepare) {
  const [run] = await frozenRuns(input, [{ quantity: 40, page: 1 }]);
  await writeDpgfPolicy(input, 40, { version: 2, job_id: input.earlierJobId, reference_quantity: 30, measured_quantity: 40,
    priced_quantity: 40, absolute_gap: 10, reviewed: false, item_ids: [run.id],
    contributions: [{ job_id: input.earlierJobId, item_ids: [run.id], quantity: 40, protective: 0, printed_gap: 0 }] });
}

/**
 * The same, applied before D4 over pages 1 and 2 (a version 1 policy) by a calculation its frozen lines no longer give
 * back (30 + 10 measured 45): its part per page is unknown, and the service reads it as one block.
 */
async function feedDpgfTargetBeforeD4(input: Prepare) {
  const runs = await frozenRuns(input, [{ quantity: 30, page: 1 }, { quantity: 10, page: 2 }]);
  await writeDpgfPolicy(input, 45, { version: 1, job_id: input.earlierJobId, reference_quantity: 30, measured_quantity: 45,
    priced_quantity: 45, absolute_gap: 15, reviewed: false, item_ids: runs.map((run) => run.id).sort() });
}

const SITUATIONS: Situation[] = [
  { name: "a line on one page, measured again", earlier: [read("WC suspendu", 4, "u", 1)], relaunch: [read("WC suspendu", 5, "u", 1)],
    expect: (proposal) => expect(proposal.pairs).toHaveLength(1),
    // The relaunch replaces a count with a length: never across two units.
    naive: [{ reason: "unit_mismatch", build: (context) => (context.base ? { payload: context.base.payload.map((decision) => ({ ...decision,
      pairs: decision.pairs.map((pair) => ({ ...pair, takeoff_item_id: context.newLineId("Réseau EF") })) })) } : null) }],
    staleAfterProposal: "WC suspendu" },
  { name: "a line on two pages, both measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read(EF, 15, "ml", 1), read(EF, 20, "ml", 2)],
    expect: (proposal) => expect([proposal.pages.length, proposal.lines.length, proposal.pairs.length]).toEqual([2, 1, 2]) },
  { name: "a line on two pages, one measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read(EF, 12, "ml", 1)],
    expect: (proposal) => expect(lineNamed(proposal, EF).outside_pages).toBe(true) },
  { name: "a new line without a page over a line of two pages", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    level: "B", relaunch: [read(EF, 18, "ml", null)],
    expect: (proposal) => expect([proposal.pages.length, proposal.pairs.length]).toEqual([2, 1]),
    // A page-by-page screen pairs the new line on each page it lies on.
    naive: [{ reason: "new_line_paired_twice", build: (context) => {
      if (!context.base) return null;
      const pair = context.base.payload.flatMap((decision) => decision.pairs)[0];
      return pair ? { payload: context.base.payload.map((decision) => ({ ...decision, pairs: [pair] })) } : null;
    } }] },
  { name: "a vanished line whose pages are all measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read("Vanne d'arrêt", 2, "u", 1), read("Vanne d'arrêt", 1, "u", 2)],
    expect: (proposal) => expect(lineNamed(proposal, EF).outside_pages).toBe(false),
    naive: [
      // Removed on one page, kept on the other: one line, two answers.
      { reason: "conflicting_actions", build: (context) => {
        const removed = payloadWhere(context, (resolution) => resolution.complete && resolution.counts.removed === 1);
        return removed ? { payload: mapLines(removed, context.lineId(EF), (line, index) => (index === 1 ? { ...line, action: "keep" } : line)) } : null;
      } },
      // « Replace » with everything kept: keeping both in disguise.
      { reason: "nothing_replaced", build: (context) => {
        const removed = payloadWhere(context, (resolution) => resolution.complete && resolution.counts.removed === 1);
        return removed ? { payload: mapLines(removed, context.lineId(EF), (line) => ({ ...line, action: "keep" })) } : null;
      } },
    ] },
  { name: "a vanished line carrying a page not measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read("Vanne d'arrêt", 2, "u", 1)],
    expect: (proposal) => expect(lineNamed(proposal, EF).outside_pages).toBe(true),
    naive: [{ reason: "remove_other_pages", build: (context) => {
      const kept = payloadWhere(context, (resolution) => resolution.lines.some((entry) => entry.vanished === "keep"));
      return kept ? { payload: mapLines(kept, context.lineId(EF), (line) => ({ ...line, action: "remove" })) } : null;
    } }] },
  { name: "an updated line whose other page has no new line", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read(EF, 15, "ml", 1), read("Vanne d'arrêt", 1, "u", 2)],
    expect: (proposal) => expect(proposal.pairs).toHaveLength(1) },
  { name: "a quantity changed by hand, on two pages", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    handQuantity: { title: EF, quantity: 24 }, relaunch: [read(EF, 15, "ml", 1), read(EF, 20, "ml", 2)],
    expect: (proposal) => expect(lineNamed(proposal, EF).changed_by_hand).toBe(true),
    naive: [{ reason: "take_required", build: (context) => {
      const chosen = complete(context, () => true);
      return chosen ? { payload: mapLines(chosen.payload, context.lineId(EF), (line) => ({ ...line, take: null })) } : null;
    } }] },
  // Codex review of 251a98a1: one length grouped over two plan files (finalize_takeoff_lengths groups by title and unit).
  { name: "a line over two plan files, both measured again", earlier: [read(EF, 10, "ml", 1, { doc: "A" }), read(EF, 10, "ml", 1, { doc: "B" })],
    relaunch: [read(EF, 12, "ml", 1, { doc: "A" }), read(EF, 15, "ml", 1, { doc: "B" })],
    expect: (proposal) => expect([proposal.pages.length, proposal.lines.length, proposal.pairs.length]).toEqual([2, 1, 2]),
    // Plan B's run sent to replace plan A's part, and A's to replace B's.
    naive: [{ reason: "ambiguous_document", build: (context) => {
      if (!context.base) return null;
      const pairs = context.base.payload.map((decision) => decision.pairs);
      return pairs.every((entry) => entry.length === 1) ? { payload: context.base.payload.map((decision, index) => ({ ...decision, pairs: pairs[1 - index] })) } : null;
    } }] },
  { name: "a line over two plan files, one measured again", earlier: [read(EF, 10, "ml", 1, { doc: "A" }), read(EF, 10, "ml", 1, { doc: "B" })],
    relaunch: [read(EF, 12, "ml", 1, { doc: "A" }), read("Vanne d'arrêt", 1, "u", 1, { doc: "B" })],
    expect: (proposal) => expect([proposal.pages.length, proposal.pairs.length]).toEqual([2, 1]) },
  { name: "a matching new line excluded at the review", earlier: [read("WC suspendu", 4, "u", 1)],
    relaunch: [read("WC suspendu", 5, "u", 1, { excluded: true }), read("Lave-mains", 1, "u", 1)],
    expect: (proposal) => expect([proposal.new_lines.length, proposal.pairs.length]).toEqual([1, 0]),
    naive: [{ reason: "new_line_not_applied", build: (context) => {
      const kept = payloadWhere(context, (resolution) => resolution.lines.some((entry) => entry.vanished === "keep"));
      if (!kept) return null;
      const line = context.lineId("WC suspendu");
      const payload = mapLines(kept, line, (entry) => ({ ...entry, action: "update", take: null }));
      payload[0] = { ...payload[0], pairs: [{ takeoff_item_id: context.newLineId("WC suspendu"), estimate_item_id: line }] };
      return { payload };
    } }] },
  // An ouvrage component (its quantity is the ouvrage's): kept or removed, never replaced by a new line.
  { name: "an ouvrage line on the page", earlier: [read("Collier", 6, "u", 1)], relaunch: [read("Collier", 7, "u", 1)],
    prepare: async ({ versionId, earlierJobId }) => {
      await sql(`begin;
select set_config('miaouffrage.estimate_v3_writer', '${versionId}', true);
update public.estimate_items set source_metadata = source_metadata || '{"mapping_action":"apply_assembly"}'::jsonb
where version_id = '${versionId}' and source_job_id = '${earlierJobId}' and title = 'Collier';
select public.estimate_v3_complete_entry_for_writer('${versionId}', array(select id from public.estimate_items
  where version_id = '${versionId}' and source_job_id = '${earlierJobId}'));
commit;`);
    },
    expect: (proposal) => expect([lineNamed(proposal, "Collier").assembly, proposal.pairs.length]).toEqual([true, 0]),
    naive: [{ reason: "assembly_line", build: (context) => {
      const kept = payloadWhere(context, (resolution) => resolution.lines.some((entry) => entry.vanished === "keep"));
      if (!kept) return null;
      const line = context.lineId("Collier");
      const payload = mapLines(kept, line, (entry) => ({ ...entry, action: "update", take: null }));
      payload[0] = { ...payload[0], pairs: [{ takeoff_item_id: context.newLineId("Collier"), estimate_item_id: line }] };
      return { payload };
    } }] },
  { name: "a DPGF version, « Fusionner » required", dpgf: true, earlier: [read("WC suspendu", 4, "u", 1), read("Robinet d'arrêt", 3, "u", 1)],
    relaunch: [read("WC suspendu", 5, "u", 1), read("Lave-mains", 1, "u", 1)],
    expect: (proposal) => expect([proposal.merge_required, proposal.pairs.map((pair) => pair.locked)]).toEqual([true, [true]]),
    // The writer merges the WC onto its own line: sent onto the valve, the database names the conflict.
    naive: [{ reason: "merge_elsewhere", build: (context) => {
      const chosen = complete(context, () => true);
      if (!chosen) return null;
      const valve = context.lineId("Robinet d'arrêt");
      const wc = context.lineId("WC suspendu");
      return { payload: chosen.payload.map((decision) => ({ ...decision,
        lines: decision.lines.map((line) => (line.estimate_item_id === valve ? { ...line, action: "update" as const } : line.estimate_item_id === wc ? { ...line, action: "keep" as const } : line)),
        pairs: decision.pairs.map((pair) => ({ ...pair, estimate_item_id: valve })) })) };
    } }] },
  // A DPGF target an earlier takeoff fed from the page, which the relaunch does not feed again (TI-682 D4): replacing the
  // page takes its part out of the target (40 ml down to its DPGF reference, 30), keeping both keeps it.
  // Its own titles: « Fusionner » matches by title across the section, which the other DPGF situation shares.
  { name: "a DPGF target the earlier takeoff fed from the page", dpgf: true, earlier: [read("Lavabo", 4, "u", 1)],
    relaunch: [read("Lavabo (relevé)", 5, "u", 1)],
    prepare: feedDpgfTargetFromPage,
    expect: (proposal) => expect(proposal.lines.some((line) => line.dpgf_target)).toBe(true),
    naive: [
      { reason: "dpgf_target", build: (context) => {
        const chosen = complete(context, () => true);
        const target = context.proposal.lines.find((line) => line.dpgf_target);
        if (!chosen || !target) return null;
        return { payload: chosen.payload.map((decision) => ({ ...decision, decision: "replace" as const, reason_code: null, note: null,
          lines: decision.lines.map((line) => ({ ...line, action: line.estimate_item_id === target.id ? "remove" as const : "keep" as const })) })) };
      } },
    ] },
  // TI-682 D4: a DPGF line a policy applied before D4 holds over pages 1 and 2, by a calculation its lines no longer give
  // back. The relaunch reads page 1 only: the screen never cuts that part (it asks to keep both), and a replacement is
  // refused for it (dpgf_part_unknown). The service reads it in the permit as one block.
  { name: "a DPGF line of a policy applied before D4, its part per page unknown", dpgf: true, earlier: [read("Siphon de cour", 2, "u", 1)],
    relaunch: [read("Siphon de cour (relevé)", 3, "u", 1)],
    prepare: feedDpgfTargetBeforeD4,
    expect: (proposal) => expect(proposal.dpgf_targets.map((target) => target.earlier.map((part) => [part.quantity, part.item_ids.length])))
      .toEqual([[[45, 2]]]),
    naive: [{ reason: "dpgf_part_unknown", build: (context) => {
      const replaced = context.reached.find((resolution) => resolution.payload.some((decision) => decision.decision === "replace")
        && resolution.lines.every((entry) => entry.line.dpgf_target || entry.missing.length === 0));
      return replaced ? { payload: replaced.payload } : null;
    } }] },
  // TI-696 (Codex review of PR 288): the same part, both its pages read again. The application counts the pages replaced
  // together: replacing both takes the part out whole (the screen recommends it, the database accepts it); replacing one
  // while keeping the other both still cuts it (dpgf_part_unknown), and the line says to replace that page too or keep both.
  // Its own titles: « Fusionner » matches by title across the section the DPGF situations share.
  { name: "a DPGF line of a policy applied before D4, both its pages read again", dpgf: true, earlier: [read("Grille de sol", 2, "u", 1)],
    relaunch: [read("Grille de sol (relevé)", 3, "u", 1), read("Tampon de regard", 1, "u", 2)],
    prepare: feedDpgfTargetBeforeD4,
    expect: (proposal) => {
      const initial = resolveConfirmation(proposal, initialConfirmationDraft(proposal));
      expect([proposal.pages.length, proposal.dpgf_targets.map((target) => target.earlier.map((part) => [part.quantity, part.item_ids.length])),
        initial.dpgf.map((outcome) => outcome.indivisible), initial.pages.map((page) => page.recommended)])
        .toEqual([2, [[[45, 2]]], [[]], [true, true]]);
    },
    naive: [{ reason: "dpgf_part_unknown", build: (context) => {
      const mixed = context.reached.find((resolution) => resolution.payload.some((decision) => decision.decision === "replace")
        && resolution.payload.some((decision) => decision.decision === "keep_both")
        && resolution.pages.every((page) => page.missing.length === 0)
        && resolution.lines.every((entry) => entry.line.dpgf_target || entry.missing.length === 0));
      return mixed ? { payload: mixed.payload } : null;
    } }] },
  // TI-682 D4 (C1): the DPGF line the earlier takeoff fed from the page (40 ml, DPGF reference 30) is not fed again,
  // and « Fusionner », required with a DPGF, imposes the washbasin onto its earlier line, so keeping both is refused.
  // Until D4 neither choice confirmed (#259's dead end). Replacing now takes the page's part out of the DPGF line, which
  // falls to its reference: the wizard says so on the line, with why and where the page's new run went, and applies it.
  { name: "a DPGF line not fed again beside a line « Fusionner » imposes", dpgf: true, earlier: [read("Lavabo double vasque", 4, "u", 1)],
    // The run of the DPGF line, read again but not linked by the reconciliation (its title differs too much).
    relaunch: [read("Lavabo double vasque", 5, "u", 1), read("EF cuivre DN 22", 30, "ml", 1)],
    prepare: feedDpgfTargetFromPage,
    expect: (proposal) => expect([proposal.pages.map((page) => [page.keep_both_refused, page.dpgf_fed_again]), proposal.pairs.map((pair) => pair.locked),
      proposal.dpgf_targets.map((target) => [target.quantity, target.reference, target.fed.length])])
      .toEqual([[["merge_match", []]], [true], [[40, 30, 0]]]),
    wizard: async ({ ui, ids, problem }) => {
      // The draft lease this journey's API calls hold (from the page they run in, before any navigation) is released, as
      // closing that editor would: the wizard of the review takes its own.
      const released = await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
      if (released.status >= 300) problem("the journey's draft lease is released", released.body);
      await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${ids.jobId}/review/targeted?versionId=${ids.versionId}`);
      await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
      const wizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
      await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: ids.sectionId });
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      await wizard.getByRole("radio", /^Fusionner/).check();
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      await expect(wizard).toContainText("EF cuivre DN 22");
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      const region = wizard.getByRole("region", "Pages déjà au devis", { exact: true });
      await expect(region.getByRole("radio", "Remplacer la mesure précédente (recommandé)", { exact: true })).toBeChecked();
      await expect(region).not.toContainText("ne se confirme ici");
      // The fall, said on the line: never as an unchanged line.
      const fall = /Baisse : 40 → 30 \(−10\)\. [^,]+, page 1 n’alimente plus cette ligne DPGF ; sa nouvelle mesure est entrée hors DPGF : « EF cuivre DN 22 » \(30 ml\)\./;
      await expect(region).toContainText(fall);
      const targets = wizard.getByRole("region", "Lignes DPGF", { exact: true });
      const line = targets.getByRole("group", /^Ligne DPGF Réseau de distribution sanitaire EF en tube cuivre DN 22/);
      await expect(line.getByRole("status")).toContainText(fall);
      await expect(line).toContainText("40 → 30 (−10)");
      const screenshot = await ui.app.screenshot("ti682-dpgf-fall");
      const confirm = wizard.getByRole("button", "Confirmer l'application", { exact: true });
      await expect(confirm).toBeEnabled();
      const [response] = await Promise.all([ui.browser.waitForResponse(`**/api/takeoff/jobs/${ids.jobId}/apply`), confirm.click()]);
      if (response.status !== 200) problem("the wizard's confirmation of the fall is refused", await response.json());
      await expect(wizard).toBeHidden();
      const held = (await readEstimate(ui.browser, ids.versionId)).items.find((item) => item.source_provider === "dpgf")!;
      if (Number(held.quantity) !== 30) problem("the DPGF line does not hold what the wizard said (30)", held.quantity);
      return { applied: response.status === 200, screenshot, held: held.quantity };
    } },
];

/**
 * The refusals the contract does not reach through the screen, and why. Every other reason the migration raises must
 * be met by a naive decision of some situation.
 */
const OUTSIDE_THE_CONTRACT: Record<string, string> = {
  decided_by_another: "the route records the signed-in estimator's own decisions, in the application's own transaction: no screen state sends another person's (pgTAP case 19)",
  decisions_not_of_this_application: "the route never records apart from the application (race test, scenario 1)",
  shape: "the decisions' shape is the contract's schema: the route's parser refuses a malformed payload before the database (Vitest apply-server)",
  job_not_completed: "the wizard applies a completed takeoff only; an applied one is frozen (TAKEOFF_PAGE_DECISIONS_FROZEN, Vitest apply-errors, pgTAP)",
  // TI-716: TAKEOFF_DPGF_QUANTITY_MAPPING_CONFLICT, not a page decision's refusal.
  merged_outside_reconciliation: "« Fusionner » sending a takeoff line onto a DPGF line outside the reconciliation is refused whatever the page decisions: no screen state sends it, the mapping and the permit do (pgTAP takeoff-dpgf-accumulation cases 18, 21 and 22, Vitest apply-errors)",
};

/**
 * Every refusal reason the decisions' functions raise, read from their definitions in the database (TI-682 D4: the page
 * decisions' migration and the DPGF accumulation's define them).
 */
async function refusalReasons() {
  const text = (await sql(`select string_agg(procedure.prosrc, E'\n' order by procedure.proname) from pg_catalog.pg_proc procedure
join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
where namespace.nspname in ('public', 'private') and procedure.proname in ('record_takeoff_page_decisions', 'takeoff_prepare_page_decisions',
  'takeoff_replace_pages', 'assert_takeoff_pages_once', 'takeoff_compose_dpgf_targets', 'takeoff_page_refusal_detail',
  'takeoff_page_decisions_frozen', 'apply_takeoff_job_guarded_atomic', 'apply_takeoff_job_with_page_decisions');`)).join("\n");
  if (!text.includes("page_already_applied")) throw new Error("The page decisions' functions are missing.");
  const reasons = new Set<string>();
  for (const pattern of [/'reason', '([a-z_]+)'/g, /refusal_detail\('([a-z_]+)'/g, /select '([a-z_]+)'(?:,| as reason)/g, /(?:then|else) '([a-z_]+)'(?: end\))?/g]) {
    for (const match of text.matchAll(pattern)) reasons.add(match[1]);
  }
  return reasons;
}

/** SQL as the owner of the local stack (prerequisites and the rolled-back calls); its output, one value per line. */
async function sql(text: string) {
  const transport = localSqlTransport();
  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(transport.executable, transport.args, { env: transport.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-8_192); });
    child.once("error", () => reject(new Error("The local SQL session could not start.")));
    child.once("close", (code) => {
      if (code !== 0) reject(new Error(`Local SQL failed: ${/ERROR:\s*([0-9A-Z]{5}:?[^\n]{0,160})/.exec(stderr)?.[1] ?? "unavailable"}`));
      else resolve(stdout.split(/\r?\n/).filter(Boolean));
    });
    child.stdin.end(text);
  });
}
const literal = (value: unknown) => `$contract$${JSON.stringify(value)}$contract$::jsonb`;

/** An engine 3 draft in the estimator's project, beside the one the wizard created; a DPGF price line in it if asked. */
async function engineThreeVersion(army: ArmyState, browser: Parameters<typeof createLineViaApi>[0], projectId: string, fromVersionId: string,
  dpgf: boolean, line = { title: "Réseau de distribution sanitaire EF en tube cuivre DN 22, y compris raccords, supports et essais", reference: 30 }) {
  const versionId = randomUUID();
  await sql(`begin;
insert into public.estimate_versions (id, tenant_id, project_id, version_number, title, calc_engine_version, max_section_depth, currency, status,
  margin_mode, margin_multiplier, margin_bp, global_coefficient, discount_bp, discount_mode, tax_rate_bp, rounding_mode, rounding_step_cents,
  sale_coefficient_fo, sale_coefficient_mo, gross_ht_cents, discount_applied_cents, commercial_rounding_cents, total_ht_cents, total_tax_cents,
  total_ttc_cents)
select '${versionId}', version.tenant_id, version.project_id,
  (select max(other.version_number) + 1 from public.estimate_versions other where other.project_id = version.project_id),
  'ARMY contrat des pages (moteur 3)', 3, 3, 'EUR', 'draft', 'fixed', 1, 0, 1, 0, 'simple', 2000, 'none', 1, 1, 1, 0, 0, 0, 0, 0, 0
from public.estimate_versions version where version.id = '${fromVersionId}' and version.project_id = '${projectId}';
commit;`);
  ownEstimate(army, { projectId, versionId });
  const target = await createLineViaApi(browser, versionId, `${army.runPrefix} target`);
  if (dpgf) {
    await sql(`begin;
select set_config('miaouffrage.estimate_v3_writer', '${versionId}', true);
insert into public.estimate_items (id, tenant_id, version_id, parent_id, item_type, position, title, description, quantity, unit_code,
  unit_price_ht_cents, tax_rate_bp, k_fo, h_mo, k_mo, pu_ht_cents, line_total_ht_cents, line_tax_cents, line_total_ttc_cents, source_provider,
  source_file_name, source_page, source_metadata, fo_provision)
select gen_random_uuid(), version.tenant_id, version.id, '${target.parent_id}', 'line', 100, '${line.title}', 'ml', ${line.reference}, 'ml', 1000,
  2000, 1, 0, 1, 1000, ${line.reference * 1000}, ${line.reference * 200}, ${line.reference * 1200}, 'dpgf', 'dpgf-fictif.xlsx', 7,
  jsonb_build_object('dpgf_source_quantity', ${line.reference}, 'dpgf_source_unit', 'ml'), 1
from public.estimate_versions version where version.id = '${versionId}';
select public.estimate_v3_complete_entry_for_writer('${versionId}', array(select id from public.estimate_items where version_id = '${versionId}'
  and source_provider = 'dpgf'));
commit;`);
  }
  return { versionId, sectionId: String(target.parent_id), target };
}

/** What the screen shows and sends for a draft: two drafts that show and send the same are one state. */
function signature(resolution: Resolution) {
  return JSON.stringify([confirmationControls(resolution).map((control) => [control.id, control.value]), resolution.payload]);
}

/**
 * A choice the screen does not offer, forced past it: the decisions it would send. The database must refuse each one,
 * or the screen withholds a choice the estimator is entitled to.
 */
function forcedPayload(proposal: TakeoffPageReplacementResponse, draft: ConfirmationDraft, control: ReturnType<typeof confirmationControls>[number],
  value: unknown): TakeoffPageDecision[] | null {
  if (control.kind === "vanished" && value === "remove") {
    // From « keep », every other choice made: the pages of the line may then replace nothing, which the removal changes.
    const kept = resolveConfirmation(proposal, { ...draft, vanished: { ...draft.vanished, [control.lineId]: "keep" } });
    const linePages = new Set(kept.lines.find((entry) => entry.line.id === control.lineId)?.pages.map((page) => page.key) ?? []);
    if (kept.lines.some((entry) => entry.missing.length > 0)
      || kept.pages.some((page) => page.missing.some((message) => !(linePages.has(page.page.key) && message.includes("rien n’y est remplacé"))))) return null;
    return mapLines(kept.payload, control.lineId, (line, index) => (kept.payload[index].decision === "replace" ? { ...line, action: "remove" } : line));
  }
  if (control.kind === "page" && value === "keep_both") {
    const open = { ...proposal, pages: proposal.pages.map((page) => (page.key === control.pageKey ? { ...page, keep_both_refused: null } : page)) };
    const forced = resolveConfirmation(open, { ...draft, pages: { ...draft.pages, [control.pageKey]: { decision: "keep_both", reason: "other_zone", note: "" } } });
    return forced.complete ? forced.payload : null;
  }
  if (control.kind === "pair") {
    const open = { ...proposal, pairs: proposal.pairs.map((pair) => ({ ...pair, locked: false })) };
    const forced = resolveConfirmation(open, { ...draft, pairs: { ...draft.pairs, [control.newLineId]: value as string | null } });
    return forced.complete ? forced.payload : null;
  }
  return null;
}

/** Every choice a state recommends or advises: its advice, « (recommandé) » on « Remplacer », its introduction. */
function recommendations(resolution: Resolution) {
  return [
    ...[...resolution.pages.flatMap((entry) => entry.advice), ...resolution.lines.flatMap((entry) => entry.advice), resolution.introduction]
      .flatMap((advice) => advice.choose.map((choice) => ({ ...choice, by: advice.text }))),
    ...resolution.pages.filter((entry) => entry.recommended).map((entry) => ({ control: `page:${entry.page.key}`, value: "replace" as string | null,
      by: "« (recommandé) »" })),
  ];
}

/** The advice of a state that chooses an option the screen disables (or does not show). */
function misadvice(resolution: Resolution) {
  const controls = new Map(confirmationControls(resolution).map((control) => [control.id, control]));
  return [...resolution.pages.flatMap((entry) => entry.advice), ...resolution.lines.flatMap((entry) => entry.advice)].flatMap((advice) =>
    advice.choose.flatMap((choice) => {
      const option = (controls.get(choice.control)?.options as Array<{ value: unknown; disabled: string | null }> | undefined)
        ?.find((entry) => entry.value === choice.value);
      return option && option.disabled === null ? [] : [`« ${advice.text} » → ${choice.control}=${String(choice.value)} (${option?.disabled ?? "not on screen"})`];
    }));
}

/** Every state the screen reaches from its initial state through enabled controls, distinct by what it shows and sends. */
function reachableStates(proposal: TakeoffPageReplacementResponse, limit = 2_000) {
  const seen = new Map<string, Resolution>();
  const drafts = new Map<string, ConfirmationDraft>();
  const queue = [initialConfirmationDraft(proposal)];
  const unexplained: string[] = [];
  const misadvised = new Set<string>();
  const withheld = new Map<string, { choice: string; payload: TakeoffPageDecision[] }>();
  while (queue.length > 0 && seen.size < limit) {
    const draft = queue.shift()!;
    const resolution = resolveConfirmation(proposal, draft);
    const key = signature(resolution);
    if (seen.has(key)) continue;
    seen.set(key, resolution);
    drafts.set(key, draft);
    // The advice shown names only choices the screen offers where it names them.
    for (const entry of misadvice(resolution)) misadvised.add(entry);
    for (const control of confirmationControls(resolution)) {
      for (const option of control.options) {
        // An option the screen does not offer says why; an option it offers takes effect.
        if (option.disabled !== null) {
          if (option.disabled.trim().length < 10) unexplained.push(`${control.id}=${String(option.value)}`);
          const payload = forcedPayload(proposal, draft, control, option.value);
          if (payload) withheld.set(JSON.stringify(payload), { choice: `${control.id}=${String(option.value)} (${option.disabled})`, payload });
          continue;
        }
        if (control.kind === "pair" && control.disabled) continue;
        const set = setConfirmationControl(draft, control, option.value);
        // A complementary scope is written, as the estimator must to confirm it.
        const next = control.kind === "reason" && option.value === "complementary_scope"
          ? setPageNote(set, control.pageKey, "Réseau du local technique ajouté (fictif).") : set;
        const after = confirmationControls(resolveConfirmation(proposal, next)).find((entry) => entry.id === control.id);
        if (after?.value !== option.value) unexplained.push(`${control.id}=${String(option.value)} has no effect`);
        queue.push(next);
      }
    }
  }
  return { resolutions: [...seen.values()], exhausted: queue.length === 0, unexplained, misadvised: [...misadvised], withheld: [...withheld.values()] };
}

type Call = { payload: TakeoffPageDecision[]; strategy: string };
/** Each call applied by the real database function as the estimator, then rolled back: « ok » or the refusal. */
async function databaseVerdicts(input: { userId: string; tenantId: string; versionId: string; jobId: string; sectionId: string; dpgf: boolean; calls: Call[] }) {
  if (input.calls.length === 0) return [];
  const token = `contract-${randomUUID()}`;
  const calls = input.calls.map((call, index) => `select 'STATE|${index}|' || pg_temp.contract_try(${literal(call.payload)}, '${call.strategy}');`).join("\n");
  const lines = await sql(`begin;
create function pg_temp.contract_try(p_decisions jsonb, p_strategy text) returns text language plpgsql as $fn$
declare
  plan jsonb;
  detail text;
begin
  select coalesce(jsonb_agg(entry.value order by entry.ord), '[]'::jsonb) into plan from (
    select jsonb_build_object('item_id', item.id, 'source_order', (row_number() over (order by item.created_at, item.id)) - 1, 'rule_id', null,
      'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null,
      'category_id', null, 'assembly_id', null) as value,
      row_number() over (order by item.created_at, item.id) as ord
    from public.takeoff_items item where item.job_id = '${input.jobId}') entry;
  begin
    perform count(*) from public.apply_takeoff_job_with_page_decisions('${input.jobId}', p_strategy, '${input.sectionId}', plan,
      p_decisions, ${input.dpgf ? `'${token}'` : "null"});
    raise exception using errcode = 'P0001', message = 'CONTRACT_DRY_RUN_OK';
  exception when others then
    if sqlerrm = 'CONTRACT_DRY_RUN_OK' then return 'ok'; end if;
    get stacked diagnostics detail = pg_exception_detail;
    return sqlstate || ' ' || sqlerrm || coalesce(' ' || detail, '');
  end;
end
$fn$;
grant execute on function pg_temp.contract_try(jsonb, text) to authenticated;
${input.dpgf ? `insert into public.takeoff_apply_authorizations (tenant_id, job_id, estimate_version_id, user_id, authorization_token_hash,
  review_summary, expires_at) values ('${input.tenantId}', '${input.jobId}', '${input.versionId}', '${input.userId}',
  encode(sha256(convert_to('${token}', 'UTF8')), 'hex'),
  -- TI-682 D4: as the service mints it, the version 1 policies read as compositions (here as one block each, their part
  -- per page unknown, as the service reads one its lines no longer give back).
  jsonb_build_object('dpgf_compositions', coalesce((select jsonb_agg(jsonb_build_object('target_id', item.id,
    'expected_updated_at', item.updated_at, 'job_id', item.source_metadata #> '{takeoff_quantity_policy,job_id}',
    'item_ids', item.source_metadata #> '{takeoff_quantity_policy,item_ids}',
    'contributions', jsonb_build_array(jsonb_build_object('job_id', item.source_metadata #> '{takeoff_quantity_policy,job_id}',
      'item_ids', item.source_metadata #> '{takeoff_quantity_policy,item_ids}',
      'quantity', item.source_metadata #> '{takeoff_quantity_policy,measured_quantity}', 'protective', 0, 'printed_gap', 0))))
    from public.estimate_items item where item.version_id = '${input.versionId}' and item.source_provider = 'dpgf'
      and item.source_metadata #>> '{takeoff_quantity_policy,version}' = '1'), '[]'::jsonb)), now() + interval '10 minutes');` : ""}
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"${input.userId}"}', true) is not null;
select set_config('request.jwt.claim.sub', '${input.userId}', true) is not null;
set local role authenticated;
${calls}
rollback;`);
  return lines.filter((line) => line.startsWith("STATE|")).map((line) => line.split("|").slice(2).join("|"));
}
const reasonOf = (verdict: string) => /"reason": "([a-z_]+)"/.exec(verdict)?.[1] ?? (verdict === "ok" ? "ok" : verdict.slice(0, 80));

armyTest("TKD03 every confirmation the « Pages déjà au devis » screen allows is accepted by the database, and every refusal it can raise has a situation", options,
  async (ui) => {
    const { browser, army } = ui;
    const reasons = await refusalReasons();
    const base = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY contrat des pages" }, army);
    const fixture = await localTakeoffFixture(army, base);
    const userId = (await fixture.client.auth.getUser()).data.user!.id;
    const plain = await engineThreeVersion(army, browser, base.projectId, base.versionId, false);
    const dpgf = await engineThreeVersion(army, browser, base.projectId, base.versionId, true);
    const report: unknown[] = [];
    // Every situation is walked before anything fails, so that one run reports all of them.
    const problems: Array<{ situation: string; problem: string; detail: unknown }> = [];
    const reached = new Map<string, string>();

    for (const [index, situation] of SITUATIONS.entries()) {
      const { versionId, sectionId, target } = situation.dpgf ? dpgf : plain;
      const strategy = situation.dpgf ? "merge" : "append";
      // The draft leases of both versions were taken once, by createLineViaApi, and last 120 s (DRAFT_LOCK_TTL_SECONDS).
      // An open editor renews its own every 15 s (useDraftLock); this walk holds no editor, and on a CI runner it passes
      // 120 s around its twelfth situation: the apply that followed was refused 409, exactly 120 s after the lease was
      // taken (release run 43417080272, both attempts). Each situation renews the lease of the version it writes, as
      // the editor would.
      const renewed = await apiRequest(browser, "PATCH", `/api/estimates/${versionId}/lock`);
      expect(renewed.status, `${situation.name}: the draft lease is renewed: ${JSON.stringify(renewed.body)}`).toBe(200);
      // One plan (two for the situations of two plan files) per situation: its pages are its own.
      const plans = { A: randomUUID(), B: randomUUID() };
      const plan = (doc: "A" | "B" = "A") => plans[doc];
      const source = (doc: "A" | "B" = "A") => `contrat-${index + 1}${doc === "B" ? "-b" : ""}.pdf`;
      const seedOf = (reads: Read[]): Array<TakeoffSeedItem & { source: string }> => reads.map((entry) => ({ designation: entry.line, quantity: entry.quantity,
        unit: entry.unit, confidence: 0.95, source_page: entry.page, is_excluded: entry.excluded ?? false, source: source(entry.doc),
        metadata: { source_document: { kind: "plan_file", plan_file_id: plan(entry.doc) } } }));
      const scoped = await localTakeoffFixture(army, { projectId: base.projectId, versionId });
      const seed = async (level: "B" | "C", reads: Read[]) => {
        const items = seedOf(reads);
        const seeded = await scoped.seed(level, items.map((item) => ({ designation: item.designation, quantity: item.quantity, unit: item.unit,
          confidence: item.confidence, source_page: item.source_page, is_excluded: item.is_excluded, metadata: item.metadata })), source());
        // A second plan file: its lines name it (the seed writes one file name per takeoff).
        const second = items.flatMap((item, at) => (item.source !== source() ? [{ id: seeded.items[at].id, source: item.source }] : []));
        if (second.length > 0) {
          await sql(`begin;\n${second.map((entry) => `update public.takeoff_items set source_file_name = '${entry.source}' where id = '${entry.id}';`).join("\n")}\ncommit;`);
        }
        return seeded;
      };
      const earlier = await seed("C", situation.earlier);
      const applied = await applyOwnedTakeoff(browser, versionId, earlier.jobId, { strategy, target_section_id: sectionId });
      expect(applied.status, `${situation.name}: the earlier takeoff applies: ${JSON.stringify(applied.body)}`).toBe(200);
      if (situation.prepare) await situation.prepare({ versionId, earlierJobId: earlier.jobId, plan, source });
      if (situation.handQuantity) {
        const estimate = await readEstimate(browser, versionId);
        const line = estimate.items.find((item) => item.title === situation.handQuantity!.title && item.source_job_id === earlier.jobId)!;
        const edited = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/batch`,
          { operation_key: randomUUID(), operations: [{ op: "update", id: line.id, data: { quantity: situation.handQuantity.quantity } }] },
          { "if-match": estimate.version.updated_at });
        expect(edited.status, `${situation.name}: the estimator's own quantity`).toBe(200);
      }
      const relaunch = await seed(situation.level ?? "C", [...situation.relaunch,
        // Not on any page: a length the naive unit check can borrow (never paired by the screen).
        ...(index === 0 ? [read("Réseau EF", 3, "ml", 9)] : [])]);
      const readProposal = async () => {
        const response = await apiRequest<Envelope<TakeoffPageReplacementResponse>>(browser, "POST", `/api/takeoff/jobs/${relaunch.jobId}/page-replacement`,
          { strategy, target_section_id: sectionId });
        expect([response.status, response.body.ok], `${situation.name}: the proposal`).toEqual([200, true]);
        return response.body.data;
      };
      const proposal = await readProposal();
      situation.expect(proposal);

      const walk = reachableStates(proposal);
      if (walk.unexplained.length > 0) problems.push({ situation: situation.name, problem: "an option without effect or without a reason", detail: walk.unexplained });
      if (walk.misadvised.length > 0) problems.push({ situation: situation.name, problem: "an advice names a choice the screen disables", detail: walk.misadvised });
      const confirmable = walk.resolutions.filter((resolution) => resolution.complete);
      const initial = resolveConfirmation(proposal, initialConfirmationDraft(proposal));
      const outsider = (await readEstimate(browser, versionId)).items.find((item) => item.id === target.id)!;
      const context: Context = { proposal, base: initial.complete ? initial : confirmable[0] ?? null, reached: walk.resolutions,
        lineId: (title) => lineNamed(proposal, title).id,
        newLineId: (designation, doc) => relaunch.items.find((item, at) => item.designation === designation
          && (!doc || seedOf(situation.relaunch)[at]?.source === source(doc)))!.id,
        relaunchIds: relaunch.items.map((item) => item.id), outsider: { id: outsider.id, updated_at: String(outsider.updated_at) } };
      const naive = [...GENERIC, ...(situation.naive ?? [])].flatMap((entry) => {
        // Without decisions, « Fusionner » merging a new line onto an earlier one is refused as a merge, else as the page itself.
        if (entry.reason === "page_already_applied" && proposal.pairs.some((pair) => pair.locked)) {
          return [{ reason: "merged_without_decision", call: { payload: [], strategy } }];
        }
        if (entry.reason === "strategy_replace" && situation.dpgf) return [];
        const built = entry.build(context);
        return built ? [{ reason: entry.reason, call: { payload: built.payload, strategy: built.strategy ?? strategy } }] : [];
      });
      const calls: Call[] = [...confirmable.map((resolution) => ({ payload: resolution.payload, strategy })),
        ...walk.withheld.map((entry) => ({ payload: entry.payload, strategy })), ...naive.map((entry) => entry.call)];
      const verdicts = await databaseVerdicts({ userId, tenantId: scoped.tenantId, versionId, jobId: relaunch.jobId, sectionId,
        dpgf: Boolean(situation.dpgf), calls });
      expect(verdicts, `${situation.name}: one verdict per call`).toHaveLength(calls.length);
      const confirmVerdicts = verdicts.slice(0, confirmable.length);
      const withheldVerdicts = verdicts.slice(confirmable.length, confirmable.length + walk.withheld.length);
      const naiveVerdicts = verdicts.slice(confirmable.length + walk.withheld.length);
      const refused = confirmable.flatMap((resolution, at) => (confirmVerdicts[at] === "ok" ? [] : [{ payload: resolution.payload, verdict: confirmVerdicts[at] }]));
      const unjustified = walk.withheld.flatMap((entry, at) => (withheldVerdicts[at] === "ok" ? [entry.choice] : []));
      const naiveMisses = naive.flatMap((entry, at) => {
        const got = reasonOf(naiveVerdicts[at]);
        if (got === entry.reason) reached.set(entry.reason, situation.name);
        return got === entry.reason ? [] : [{ expected: entry.reason, got: naiveVerdicts[at] }];
      });
      if (refused.length > 0) problems.push({ situation: situation.name, problem: "a state the screen lets the estimator confirm is refused by the database", detail: refused.slice(0, 3) });
      if (unjustified.length > 0) problems.push({ situation: situation.name, problem: "a choice the screen withholds is accepted by the database", detail: unjustified });
      if (naiveMisses.length > 0) problems.push({ situation: situation.name, problem: "a naive decision is not refused for the reason it was built for", detail: naiveMisses });
      // Everything the screen recommends or advises (its advice, « (recommandé) », its introduction), in any state it
      // reaches, belongs to at least one state the database accepts.
      const accepted = confirmable.filter((_resolution, at) => confirmVerdicts[at] === "ok")
        .map((resolution) => new Map(confirmationControls(resolution).map((control) => [control.id, control.value])));
      const unconfirmable = new Set(walk.resolutions.flatMap((resolution) => recommendations(resolution).flatMap((choice) =>
        accepted.some((controls) => controls.get(choice.control) === choice.value) ? [] : [`${choice.control}=${String(choice.value)}, by ${choice.by}`])));
      if (unconfirmable.size > 0) problems.push({ situation: situation.name, problem: "the screen recommends a choice no accepted state holds", detail: [...unconfirmable] });
      if (confirmable.length === 0) problems.push({ situation: situation.name, problem: "no state can be confirmed", detail: initial.missing });
      if (!walk.exhausted) problems.push({ situation: situation.name, problem: "the walk did not exhaust the screen's states", detail: walk.resolutions.length });

      // Through the route: a stale proposal is refused and read again; then the default when the screen offers it as
      // complete, else the first complete state reached.
      // What the estimator sees in the wizard itself; when it applies there, the route application below is left out.
      const wizard = situation.wizard ? await situation.wizard({ ui, ids: { projectId: base.projectId, versionId, sectionId, jobId: relaunch.jobId },
        problem: (problem, detail) => problems.push({ situation: situation.name, problem, detail }) }) : null;
      let chosen = wizard?.applied ? null : context.base;
      let stale: unknown = null;
      if (situation.staleAfterProposal && chosen) {
        const estimate = await readEstimate(browser, versionId);
        const line = estimate.items.find((item) => item.title === situation.staleAfterProposal && item.source_job_id === earlier.jobId)!;
        const edited = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/batch`,
          { operation_key: randomUUID(), operations: [{ op: "update", id: line.id, data: { title: `${situation.staleAfterProposal} (repris)` } }] },
          { "if-match": estimate.version.updated_at });
        expect(edited.status, `${situation.name}: the estimator edits the line after the proposal`).toBe(200);
        const refusedStale = await applyOwnedTakeoff(browser, versionId, relaunch.jobId, { strategy, target_section_id: sectionId, page_decisions: chosen.payload });
        stale = refusedStale.body;
        if (refusedStale.status !== 409) problems.push({ situation: situation.name, problem: "a stale proposal is not refused as stale", detail: refusedStale.body });
        const fresh = await readProposal();
        const again = resolveConfirmation(fresh, initialConfirmationDraft(fresh));
        chosen = again.complete ? again : chosen;
      }
      if (chosen) {
        const final = await applyOwnedTakeoff(browser, versionId, relaunch.jobId, { strategy, target_section_id: sectionId, page_decisions: chosen.payload });
        if (final.status !== 200) problems.push({ situation: situation.name, problem: "the route refuses the state applied", detail: final.body });
      }
      report.push({ situation: situation.name, versionId, earlier: earlier.jobId, relaunch: relaunch.jobId, pages: proposal.pages.length,
        states: walk.resolutions.length, exhausted: walk.exhausted, confirmable: confirmable.length, refused: refused.length,
        withheld: walk.withheld.length, unjustified: unjustified.length,
        naive: naive.map((entry, at) => [entry.reason, reasonOf(naiveVerdicts[at])]), defaultComplete: initial.complete, stale, wizard });
    }

    // The refusals the migration can raise, each met by a naive decision or named as outside the contract.
    const uncovered = [...reasons].filter((reason) => !reached.has(reason) && !(reason in OUTSIDE_THE_CONTRACT)).sort();
    const unknown = Object.keys(OUTSIDE_THE_CONTRACT).filter((reason) => !reasons.has(reason));
    if (uncovered.length > 0) problems.push({ situation: "all", problem: "a refusal reason with no situation behind it", detail: uncovered });
    if (unknown.length > 0) problems.push({ situation: "all", problem: "a reason named outside the contract that the migration no longer raises", detail: unknown });
    await recordEvidence(army, "TKD03-contract", { base, plain, dpgf, reasons: [...reasons].sort(), reached: Object.fromEntries(reached),
      outside: OUTSIDE_THE_CONTRACT, report, problems });
    expect(problems).toEqual([]);
  });

// TI-682 lot D4: a DPGF line two takeoffs of two pages feed holds their sum. Until D4 the second takeoff overwrote the
// first (the line held 20, its DPGF reference, instead of 12.4 + 10.2). An engine 3 version whose DPGF line « EF cuivre
// DN 22 » (reference 20 ml) the reconciliation links by its title: the first takeoff feeds it from page 1 (12.4 ml), the
// second from page 2 (10.2 ml), its run seeded as drawn again over 2.5 m of the first one's (zone_overlap). Fictional.
armyTest("TKD04 a DPGF line two takeoffs of two pages feed holds their sum, shown in the reconciliation, the confirmation and the client export",
  options, async (ui) => {
    const { browser, army } = ui;
    const base = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY cumul DPGF" }, army);
    const { versionId, sectionId, target: helper } = await engineThreeVersion(army, browser, base.projectId, base.versionId, true,
      { title: "EF cuivre DN 22", reference: 20 });
    // The client export refuses a priced line without a unit (ESTIMATE_V3_UNIT_REQUIRED): the line that gives the section
    // gets one.
    await sql(`begin;
select set_config('miaouffrage.estimate_v3_writer', '${versionId}', true);
update public.estimate_items set unit_code = 'u' where id = '${helper.id}' and version_id = '${versionId}';
select public.estimate_v3_complete_entry_for_writer('${versionId}', array['${helper.id}'::uuid]);
commit;`);
    const scoped = await localTakeoffFixture(army, { projectId: base.projectId, versionId });
    const plan = randomUUID();
    const seed = (level: "B" | "C", quantity: number, page: number) => scoped.seed(level, [{ designation: "EF cuivre DN 22", quantity,
      unit: "ml", confidence: 0.95, source_page: page, is_excluded: false, metadata: { source_document: { kind: "plan_file", plan_file_id: plan } } }],
      "cumul-dpgf.pdf");
    const dpgfLine = async () => (await readEstimate(browser, versionId)).items.find((item) => item.source_provider === "dpgf")!;
    const composition = async () => (await sql(`select jsonb_build_array(item.quantity, item.source_metadata #> '{takeoff_quantity_policy,contributions}')
from public.estimate_items item where item.version_id = '${versionId}' and item.source_provider = 'dpgf';`))[0];

    const first = await seed("C", 12.4, 1);
    const applied = await applyOwnedTakeoff(browser, versionId, first.jobId, { strategy: "merge", target_section_id: sectionId });
    expect(applied.status, "the first takeoff applies").toBe(200);
    expect(Number((await dpgfLine()).quantity), "the first takeoff alone: the DPGF reference").toBe(20);

    // The second takeoff, its run seeded as drawn again over 2.5 m of the first one's (the zone rules' result).
    const second = await seed("B", 10.2, 2);
    await sql(`begin;
update public.takeoff_items set rule_results = jsonb_build_array(jsonb_build_object('rule', 'zone_overlap', 'status', 'fail',
  'code', 'ZONE_OVERLAP_DUPLICATE', 'version', 1, 'acceptable', true, 'reason', 'Tronçon dessiné aussi sur une autre page (fixture ARMY).',
  'details', jsonb_build_object('partners', jsonb_build_array(jsonb_build_object('item_id', '${first.items[0].id}', 'job_id', '${first.jobId}',
    'zone', null, 'designation', 'EF cuivre DN 22', 'overlap_m', 2.5, 'resolved', false)))))
where id = '${second.items[0].id}';
commit;`);
    const compared = await apiRequest<Envelope<{ rows: Array<{ line_label: string; delta_absolute: number | null;
      composition?: { earlier: Array<{ job_id: string; quantity: number; read_again: boolean }>; total_quantity: number;
        double_counted: Array<{ overlap_m: number }> } }> }>>(browser, "GET",
      `/api/takeoff/jobs/${second.jobId}/dpgf-compare?version_id=${versionId}&view=all`);
    const row = compared.body.data.rows.find((entry) => entry.line_label === "EF cuivre DN 22")!;
    expect([row.composition?.earlier.map((entry) => [entry.job_id, entry.quantity, entry.read_again]), row.composition?.total_quantity,
      row.composition?.double_counted.map((entry) => entry.overlap_m), row.delta_absolute], "the reconciliation judges the total")
      .toEqual([[[first.jobId, 12.4, false]], 22.6, [2.5], 2.6]);

    // The draft lease this journey's API calls hold is released from the page they ran in, before any navigation (its
    // session lives in that page), as closing that editor would: the wizard of the review takes its own.
    const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
    expect(released.status, "the journey's draft lease is released").toBeLessThan(300);

    // The reconciliation, as the estimator reads it.
    await ui.app.open(`/dashboard/affaires/${base.projectId}/takeoff/${second.jobId}/review?versionId=${versionId}&reviewMode=production&view=dpgf`);
    await expect(ui.screen.getByRole("heading", "Comparaison DPGF explicable", { exact: true })).toBeVisible();
    const note = ui.screen.getByRole("group", "Composition de EF cuivre DN 22", { exact: true }).first();
    await expect(note).toContainText("Alimentée par 2 métrés : total 22,6 ml");
    await expect(note).toContainText("Déjà alimentée par le métré du");
    await expect(note.getByRole("status")).toContainText("Peut-être compté deux fois, à vérifier : 2,5 m");
    const reconciliation = await ui.app.screenshot("ti682-dpgf-composition");

    // The confirmation: before and after, its composition; no page already in the estimate (two pages).
    await ui.app.open(`/dashboard/affaires/${base.projectId}/takeoff/${second.jobId}/review/targeted?versionId=${versionId}`);
    await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
    const wizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
    await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: sectionId });
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    await wizard.getByRole("radio", /^Fusionner/).check();
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    await expect(wizard).toContainText("EF cuivre DN 22");
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    const target = wizard.getByRole("region", "Lignes DPGF", { exact: true }).getByRole("group", "Ligne DPGF EF cuivre DN 22", { exact: true });
    await expect(target).toContainText("EF cuivre DN 22 : 20 → 23 (+3) — alimentée par 2 métrés");
    await expect(target.getByRole("list", "Composition de EF cuivre DN 22", { exact: true })).toContainText("Ce métré : 10,2 (cumul-dpgf.pdf, page 2 : 10,2)");
    await expect(wizard.getByRole("region", "Pages déjà au devis", { exact: true })).toHaveCount(0);
    const confirmation = await ui.app.screenshot("ti682-dpgf-confirmation");
    const confirm = wizard.getByRole("button", "Confirmer l'application", { exact: true });
    await expect(confirm).toBeEnabled();
    const [response] = await Promise.all([browser.waitForResponse(`**/api/takeoff/jobs/${second.jobId}/apply`), confirm.click()]);
    expect(response.status, "the confirmation applies").toBe(200);
    await expect(wizard).toBeHidden();

    // The line holds the sum, rounded once, and its composition names both takeoffs (stored in the order of their
    // identifiers, random here: read by takeoff).
    const held = JSON.parse(await composition()) as [number, Array<{ job_id: string; quantity: number }>];
    const byTakeoff = new Map(held[1].map((part) => [part.job_id, Number(part.quantity)]));
    expect([Number(held[0]), held[1].length, byTakeoff.get(first.jobId), byTakeoff.get(second.jobId)], "the DPGF line holds the sum")
      .toEqual([23, 2, 12.4, 10.2]);

    // The client export (DPGF): its quantity column carries the sum, and nothing of the composition.
    const exported = await browser.evaluate(async (input) => {
      const result = await fetch(`/api/estimates/${input.versionId}/export?format=xlsx&mode=dpgf`, { credentials: "same-origin", redirect: "error" });
      const bytes = new Uint8Array(await result.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      return { status: result.status, base64: btoa(binary) };
    }, { versionId });
    expect(exported.status, "the DPGF export").toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(exported.base64, "base64") as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet("Données")!;
    const header: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { header[column - 1] = String(cell.value ?? ""); });
    const rows: Array<Record<string, unknown>> = [];
    sheet.eachRow((entry, number) => {
      if (number > 1) rows.push(Object.fromEntries(header.map((name, index) => [name, entry.getCell(index + 1).value])));
    });
    const exportedLine = rows.find((entry) => String(entry["Désignation"] ?? "").trim() === "EF cuivre DN 22");
    expect(exportedLine?.["Quantité"], "the client DPGF export carries the sum").toBe(23);
    const words = rows.flatMap((entry) => Object.values(entry).map((value) => String(value ?? ""))).join(" ");
    expect(words, "the client export carries nothing of the composition").not.toMatch(/métré du|alimentée|composition/i);
    await recordEvidence(army, "TKD04-dpgf-accumulation", { versionId, first: first.jobId, second: second.jobId, row, held, reconciliation,
      confirmation, exported: exportedLine });
  });

// TI-716: a DPGF line a policy applied before D4 holds over pages 1 and 2 of a plan, its part per page unknown (12 + 8 ml
// written 25 ml, which its frozen lines no longer give back). A relaunch reading page 1 only cannot replace that page:
// the part would be cut, and a quantity nobody can attribute is never removed. Until TI-716 the database refused it with
// « Les choix des pages déjà au devis sont incomplets », and the wizard said only « remplacer la page la retirerait
// entière ». The wizard now names the line and its ways out before anything is sent, and the refusal, forced through the
// route, names the line, the pages its part mixes and the same ways out. The way out recommended works: a relaunch reading
// both pages replaces them together, the part leaves whole, and the line holds the new measure, read again after a
// reload. An engine 3 version whose DPGF line « EF cuivre DN 22 » (reference 20 ml) the reconciliation links by its
// title. Fictional plans and quantities.
armyTest("TKD05 a DPGF line whose part per page is unknown names its ways out, and the pages read again and replaced together take it out whole",
  options, async (ui) => {
    const { browser, army } = ui;
    const base = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY part DPGF inconnue" }, army);
    const { versionId, sectionId } = await engineThreeVersion(army, browser, base.projectId, base.versionId, true,
      { title: "EF cuivre DN 22", reference: 20 });
    const scoped = await localTakeoffFixture(army, { projectId: base.projectId, versionId });
    const plan = randomUUID();
    const file = "part-inconnue.pdf";
    const seed = (level: "B" | "C", lines: Array<{ designation: string; quantity: number; unit: string; page: number }>) => scoped.seed(level,
      lines.map((line) => ({ designation: line.designation, quantity: line.quantity, unit: line.unit, confidence: 0.95, source_page: line.page,
        is_excluded: false, metadata: { source_document: { kind: "plan_file", plan_file_id: plan } } })), file);
    const dpgfLine = async () => (await readEstimate(browser, versionId)).items.find((item) => item.source_provider === "dpgf")!;
    const held = async () => JSON.parse((await sql(`select jsonb_build_array(item.quantity, item.source_metadata #> '{takeoff_quantity_policy}')
from public.estimate_items item where item.version_id = '${versionId}' and item.source_provider = 'dpgf';`))[0]) as
      [number, { version: number; contributions?: Array<{ job_id: string; item_ids: string[]; quantity: number }> }];

    // The earlier takeoff, applied before D4: its count on page 3 enters the estimate, and the DPGF line holds its runs of
    // pages 1 and 2 as one version 1 policy whose calculation its lines no longer give back.
    const earlier = await seed("C", [{ designation: "Siphon de sol", quantity: 2, unit: "u", page: 3 }]);
    const applied = await applyOwnedTakeoff(browser, versionId, earlier.jobId, { strategy: "merge", target_section_id: sectionId });
    expect(applied.status, `the earlier takeoff applies: ${JSON.stringify(applied.body)}`).toBe(200);
    const prepare = { versionId, earlierJobId: earlier.jobId, plan: () => plan, source: () => file };
    const runs = await frozenRuns(prepare, [{ quantity: 12, page: 1 }, { quantity: 8, page: 2 }]);
    await writeDpgfPolicy(prepare, 25, { version: 1, job_id: earlier.jobId, reference_quantity: 20, measured_quantity: 25,
      priced_quantity: 25, absolute_gap: 5, reviewed: false, item_ids: runs.map((run) => run.id).sort() });
    expect(Number((await dpgfLine()).quantity), "the DPGF line holds the earlier takeoff's 25 ml").toBe(25);

    // A relaunch of page 1 only: its run feeds the DPGF line again.
    const pageOne = await seed("C", [{ designation: "EF cuivre DN 22", quantity: 13, unit: "ml", page: 1 }]);
    const proposed = await apiRequest<Envelope<TakeoffPageReplacementResponse>>(browser, "POST", `/api/takeoff/jobs/${pageOne.jobId}/page-replacement`,
      { strategy: "merge", target_section_id: sectionId });
    expect([proposed.status, proposed.body.data?.pages.length, proposed.body.data?.dpgf_targets.map((target) => target.earlier.map((part) => part.item_ids.length))],
      "the relaunch of page 1 meets the line's part of two pages").toEqual([200, 1, [[2]]]);
    // Replacing page 1 anyway (what the screen does not let confirm): the database refuses and names the line and its ways out.
    const replacing = resolveConfirmation(proposed.body.data, initialConfirmationDraft(proposed.body.data)).payload;
    expect(replacing.map((decision) => decision.decision), "the decision forced past the screen").toEqual(["replace"]);
    const refused = await applyOwnedTakeoff(browser, versionId, pageOne.jobId, { strategy: "merge", target_section_id: sectionId,
      page_decisions: replacing }) as { status: number; body: { ok: boolean; error?: { message: string; details?: Record<string, unknown> } } };
    expect([refused.status, refused.body.error?.details?.reason, refused.body.error?.details?.guard],
      "replacing page 1 alone is refused, for its DPGF part").toEqual([422, "dpgf_part_unknown", "page_decision"]);
    expect(refused.body.error?.message, "the refusal names the line, its pages and its ways out").toBe(
      `La ligne DPGF « EF cuivre DN 22 » (25 ml) tient la mesure d’un métré appliqué avant le cumul, qui mêle les pages 1 et 2 de « ${file} » `
      + `sans la part de chacune : elle ne sort pas avec la page 1 de « ${file} » seule. Rien n’est appliqué. Recommandé : relancez le `
      + `métré en lisant aussi la page 2 de « ${file} », puis remplacez ces pages ensemble : la mesure précédente sort alors entière. `
      + `Sinon, gardez les deux mesures de la page 1 de « ${file} » : la page comptera deux fois sur cette ligne, à corriger à la main.`);
    expect(Number((await dpgfLine()).quantity), "nothing was removed").toBe(25);

    // The journey's draft lease is released from the page it ran in, as closing that editor would: the wizard takes its own.
    const released = await apiRequest(browser, "DELETE", `/api/estimates/${versionId}/lock`);
    expect(released.status, "the journey's draft lease is released").toBeLessThan(300);

    const openWizard = async (jobId: string) => {
      await ui.app.open(`/dashboard/affaires/${base.projectId}/takeoff/${jobId}/review/targeted?versionId=${versionId}`);
      await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
      const wizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
      await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: sectionId });
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      await wizard.getByRole("radio", /^Fusionner/).check();
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      await expect(wizard).toContainText("EF cuivre DN 22");
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      return wizard;
    };

    // The wizard says it before anything is sent: the line, the pages its part mixes, the way out recommended, the other.
    const stuck = await openWizard(pageOne.jobId);
    const region = stuck.getByRole("region", "Pages déjà au devis", { exact: true });
    await expect(region.getByRole("radio", "Remplacer la mesure précédente", { exact: true })).toBeChecked();
    const advice = `La ligne DPGF « EF cuivre DN 22 » (25 ml) tient la mesure d’un métré appliqué avant le cumul, qui mêle ${file}, page 1 `
      + `et des pages que ce métré ne relit pas sans la part de chacune : elle ne sort pas avec ${file}, page 1 seule. Recommandé : relancez `
      + "le métré en lisant aussi ces autres pages, puis remplacez ces pages ensemble : la mesure précédente sort alors entière. Sinon, gardez "
      + `les deux mesures de ${file}, page 1 : la page comptera deux fois sur cette ligne, à corriger à la main.`;
    await expect(region).toContainText(advice);
    await expect(stuck.getByRole("button", "Confirmer l'application", { exact: true })).toBeDisabled();
    const named = await ui.app.screenshot("ti716-dpgf-part-unknown-named");
    await stuck.getByRole("button", "Annuler", { exact: true }).click();
    await expect(stuck).toBeHidden();

    // The way out recommended: a relaunch reading both pages, replaced together. The part leaves whole.
    const bothPages = await seed("C", [{ designation: "EF cuivre DN 22", quantity: 13, unit: "ml", page: 1 },
      { designation: "EF cuivre DN 22", quantity: 9, unit: "ml", page: 2 }]);
    const wizard = await openWizard(bothPages.jobId);
    const pages = wizard.getByRole("region", "Pages déjà au devis", { exact: true });
    await expect(pages.getByRole("radio", "Remplacer la mesure précédente (recommandé)", { exact: true })).toHaveCount(2);
    await expect(pages).not.toContainText("tient la mesure d’un métré appliqué avant le cumul");
    const target = wizard.getByRole("region", "Lignes DPGF", { exact: true }).getByRole("group", "Ligne DPGF EF cuivre DN 22", { exact: true });
    await expect(target).toContainText("EF cuivre DN 22 : 25 → 22 (−3)");
    const together = await ui.app.screenshot("ti716-dpgf-pages-replaced-together");
    const confirm = wizard.getByRole("button", "Confirmer l'application", { exact: true });
    await expect(confirm).toBeEnabled();
    const [response] = await Promise.all([browser.waitForResponse(`**/api/takeoff/jobs/${bothPages.jobId}/apply`), confirm.click()]);
    expect(response.status, "the pages replaced together apply").toBe(200);
    await expect(wizard).toBeHidden();

    // Read again after a reload: the line holds max(20, 13 + 9), its composition the relaunch's two runs only.
    await ui.app.open(`/dashboard/affaires/${base.projectId}/takeoff/${bothPages.jobId}/review/targeted?versionId=${versionId}`);
    const [quantity, policy] = await held();
    expect([Number(quantity), Number((await dpgfLine()).quantity), policy.version,
      (policy.contributions ?? []).map((part) => [part.job_id, Number(part.quantity)]).sort((left, right) => left[1] as number - (right[1] as number)),
      (policy.contributions ?? []).some((part) => part.item_ids.some((id) => runs.some((run) => run.id === id)))],
      "the DPGF line holds the relaunch's measure, the earlier part out whole").toEqual([22, 22, 2, [[bothPages.jobId, 9], [bothPages.jobId, 13]], false]);
    await recordEvidence(army, "TKD05-dpgf-part-unknown", { versionId, earlier: earlier.jobId, pageOne: pageOne.jobId, bothPages: bothPages.jobId,
      refusal: refused.body.error, named, together, held: [quantity, policy] });
  });
