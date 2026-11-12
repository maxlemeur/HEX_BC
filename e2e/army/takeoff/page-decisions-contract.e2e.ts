import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { expect } from "e2e";

import {
  confirmationControls,
  initialConfirmationDraft,
  resolveConfirmation,
  setConfirmationControl,
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
// functions can raise is read from the migration, and each one is either reached by a naive decision in some situation
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
   * No state of the screen confirms here, by rule: what the screen must say instead, done outside it (its advice's
   * `elsewhere`), and each way out proved after the walk.
   */
  deadEnd?: { elsewhere: string[]; text: RegExp; exits: (input: ExitInput) => Promise<unknown> };
};
type ExitInput = {
  ui: Parameters<Parameters<typeof armyTest>[2]>[0];
  ids: { projectId: string; versionId: string; sectionId: string; jobId: string };
  strategy: string;
  relaunchItem: (designation: string) => { id: string };
  readProposal: () => Promise<TakeoffPageReplacementResponse>;
  /** The confirmable states of a proposal, each applied by the database as the estimator and rolled back. */
  confirmable: (proposal: TakeoffPageReplacementResponse) => Promise<{ states: number; verdicts: string[]; misadvised: string[] }>;
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

/**
 * A DPGF target an earlier takeoff fed from page 1 of the situation's plan: its source line, written into the applied
 * takeoff, and the DPGF line naming it (takeoff_quantity_policy), as the DPGF reconciliation of that takeoff left it.
 */
async function feedDpgfTargetFromPage({ versionId, earlierJobId, plan, source }: { versionId: string; earlierJobId: string;
  plan: (doc?: "A" | "B") => string; source: (doc?: "A" | "B") => string }) {
  const item = randomUUID();
  // The earlier takeoff is applied, so its lines are frozen: the fixture line is written with triggers off.
  await sql(`begin;
set local session_replication_role = replica;
insert into public.takeoff_items (id, tenant_id, job_id, result_id, designation, quantity, unit, confidence, evidence, source_file_name, source_page,
metadata, is_excluded, is_verified)
select '${item}', job_item.tenant_id, job_item.job_id, job_item.result_id, 'EF cuivre DN 22', 30, 'ml', 0.95, 'ARMY localized fixture: EF cuivre DN 22',
'${source()}', 1, jsonb_build_object('source_document', jsonb_build_object('kind', 'plan_file', 'plan_file_id', '${plan()}')), false, false
from public.takeoff_items job_item where job_item.job_id = '${earlierJobId}' limit 1;
set local session_replication_role = origin;
select set_config('miaouffrage.estimate_v3_writer', '${versionId}', true);
update public.estimate_items set source_job_id = '${earlierJobId}', source_file_name = '${source()}', source_page = 1,
source_metadata = source_metadata || jsonb_build_object('takeoff_quantity_policy', jsonb_build_object('version', 1, 'job_id', '${earlierJobId}',
  'item_ids', jsonb_build_array('${item}')))
where version_id = '${versionId}' and source_provider = 'dpgf';
select public.estimate_v3_complete_entry_for_writer('${versionId}', array(select id from public.estimate_items
where version_id = '${versionId}' and source_provider = 'dpgf'));
commit;`);
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
  // A DPGF target an earlier takeoff fed from the page, which the relaunch does not feed again: replacing the page would
  // leave its earlier measure beside the new lines; it is kept both.
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
      // The screen's own « replace » here, confirmed although it says to keep both.
      { reason: "dpgf_not_replaced", build: (context) => {
        const replaced = context.reached.find((resolution) => resolution.pages.every((page) => page.choice.decision === "replace")
          && resolution.lines.every((entry) => entry.missing.length === 0));
        return replaced ? { payload: replaced.payload } : null;
      } },
    ] },
  // The DPGF line the earlier takeoff fed from the page is not fed again, and « Fusionner », required with a DPGF,
  // imposes the washbasin onto its earlier line: replacing would leave the DPGF line's earlier measure beside the new
  // one (dpgf_not_replaced) and keeping both meets the merge (refused until the DPGF accumulation, D4). The screen says
  // what to do instead; both ways out are proved: excluding the merged line at review, or linking a line of the page to
  // the DPGF line in the DPGF reconciliation.
  { name: "a DPGF line not fed again beside a line « Fusionner » imposes", dpgf: true, earlier: [read("Lavabo double vasque", 4, "u", 1)],
    relaunch: [read("Lavabo double vasque", 5, "u", 1), read("Calorifuge", 30, "ml", 1)],
    prepare: feedDpgfTargetFromPage,
    expect: (proposal) => expect([proposal.pages.map((page) => [page.keep_both_refused, page.dpgf_fed_again]), proposal.pairs.map((pair) => pair.locked)])
      .toEqual([[["merge_match", []]], [true]]),
    deadEnd: { elsewhere: ["exclude_at_review", "link_in_dpgf_review"],
      text: /ni remplacer ni garder les deux ne se confirme ici\. Écartez « Lavabo double vasque » à la revue du métré .*, ou liez à « EF cuivre DN 22 \(DPGF\) » une ligne de ce métré lue sur cette page, dans le rapprochement DPGF/,
      exits: async ({ ui, ids, strategy, relaunchItem, readProposal, confirmable, problem }) => {
        // What the estimator sees: the wizard of the takeoff's review, up to its confirmation.
        await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${ids.jobId}/review/targeted?versionId=${ids.versionId}`);
        await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
        const wizard = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
        await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: ids.sectionId });
        await wizard.getByRole("button", "Suivant", { exact: true }).click();
        await wizard.getByRole("radio", /^Fusionner/).check();
        await wizard.getByRole("button", "Suivant", { exact: true }).click();
        await expect(wizard).toContainText("Calorifuge");
        await wizard.getByRole("button", "Suivant", { exact: true }).click();
        const region = wizard.getByRole("region", "Pages déjà au devis", { exact: true });
        await expect(region).toContainText("ni remplacer ni garder les deux ne se confirme ici");
        await expect(region).toContainText("Écartez « Lavabo double vasque » à la revue du métré");
        await expect(region.getByRole("radio", "Garder les deux", { exact: true })).toBeDisabled();
        // Nowhere on this screen is « keep both » advised: no page offers it.
        await expect(region).not.toContainText("gardez les deux");
        await expect(region).not.toContainText("Gardez les deux");
        await expect(wizard.getByRole("button", "Confirmer l'application", { exact: true })).toBeDisabled();
        const screenshot = await ui.app.screenshot("ti682-dpgf-dead-end");
        await wizard.getByRole("button", "Annuler", { exact: true }).click();

        // Way out 1: the merged line excluded at the takeoff's review. The page is then confirmed (keeping both).
        const washbasin = relaunchItem("Lavabo double vasque");
        const exclude = async (excluded: boolean) => {
          const detail = await apiRequest<Envelope<{ items: { data: Array<{ id: string; updated_at: string }> } }>>(ui.browser, "GET", `/api/takeoff/jobs/${ids.jobId}`);
          const row = detail.body.data.items.data.find((item) => item.id === washbasin.id)!;
          const patched = await apiRequest<Envelope<{ results: Array<{ success: boolean }> }>>(ui.browser, "PATCH", `/api/takeoff/jobs/${ids.jobId}/items`,
            { items: [{ item_id: row.id, updated_at: row.updated_at, fields: excluded
              ? { is_excluded: true, exclusion_reason: "Lavabo déjà compté sur la ligne précédente (fixture ARMY)." }
              : { is_excluded: false, exclusion_reason: null } }] });
          if (patched.status !== 200 || !patched.body.data.results[0]?.success) problem(`the review ${excluded ? "excludes" : "includes"} the merged line`, patched.body);
        };
        await exclude(true);
        const excluded = await confirmable(await readProposal());
        if (excluded.states === 0 || excluded.verdicts.some((verdict) => verdict !== "ok") || excluded.misadvised.length > 0) {
          problem("excluding the merged line at review does not unblock the confirmation", excluded);
        }
        await exclude(false);
        const again = await confirmable(await readProposal());
        if (again.states !== 0) problem("the dead end is not back once the merged line is included again", again);

        // Way out 2: a line of the page linked to the DPGF line in the DPGF reconciliation. The page is then replaced,
        // through the route (its DPGF authorization feeds the DPGF line).
        const target = (await readProposal()).lines.find((line) => line.dpgf_target)!;
        const linked = await apiRequest<Envelope<unknown>>(ui.browser, "PATCH", `/api/takeoff/jobs/${ids.jobId}/dpgf-link`,
          { version_id: ids.versionId, estimate_item_id: target.id, takeoff_item_ids: [relaunchItem("Calorifuge").id] });
        if (linked.status !== 200) problem("the DPGF reconciliation links the line", linked.body);
        const fed = await readProposal();
        const resolution = resolveConfirmation(fed, initialConfirmationDraft(fed));
        if (!resolution.complete) problem("linking a line of the page to the DPGF line does not unblock the confirmation", resolution.missing);
        const applied = await applyOwnedTakeoff(ui.browser, ids.versionId, ids.jobId, { strategy, target_section_id: ids.sectionId, page_decisions: resolution.payload });
        if (applied.status !== 200) problem("the route refuses the page once the DPGF line is fed", applied.body);
        return { screenshot, excluded, again: again.states, fed: fed.pages.map((page) => page.dpgf_fed_again), applied: applied.status };
      } } },
];

/**
 * The refusals the contract does not reach through the screen, and why. Every other reason the migration raises must
 * be met by a naive decision of some situation.
 */
const OUTSIDE_THE_CONTRACT: Record<string, string> = {
  decided_by_another: "the route records the signed-in estimator's own decisions, in the application's own transaction: no screen state sends another person's (pgTAP case 19)",
  decisions_not_of_this_application: "the route never records apart from the application (race test, scenario 1)",
  dpgf_keep_both: "needs the relaunch's DPGF reconciliation to feed again a target another takeoff fed, which only the DPGF review of real quantities sets up (pgTAP case 17)",
  shape: "the decisions' shape is the contract's schema: the route's parser refuses a malformed payload before the database (Vitest apply-server)",
  job_not_completed: "the wizard applies a completed takeoff only; an applied one is frozen (TAKEOFF_PAGE_DECISIONS_FROZEN, Vitest apply-errors, pgTAP)",
};

/** Every refusal reason the decisions' functions raise, read from the migration itself. */
function refusalReasons() {
  const directory = path.join(process.cwd(), "supabase/migrations");
  const file = fs.readdirSync(directory).find((name) => name.endsWith("_takeoff_page_decisions.sql"));
  if (!file) throw new Error("The page decisions migration is missing.");
  const text = fs.readFileSync(path.join(directory, file), "utf8");
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
  dpgf: boolean) {
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
select gen_random_uuid(), version.tenant_id, version.id, '${target.parent_id}', 'line', 100, 'EF cuivre DN 22 (DPGF)', 'ml', 30, 'ml', 1000,
  2000, 1, 0, 1, 1000, 30000, 6000, 36000, 'dpgf', 'dpgf-fictif.xlsx', 7, '{"dpgf_source_quantity":30,"dpgf_source_unit":"ml"}', 1
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
        const next = setConfirmationControl(draft, control, option.value);
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
  encode(sha256(convert_to('${token}', 'UTF8')), 'hex'), '{}'::jsonb, now() + interval '10 minutes');` : ""}
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
    const reasons = refusalReasons();
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
      expect(applied.status, `${situation.name}: the earlier takeoff applies`).toBe(200);
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
      if (situation.deadEnd) {
        // No state confirms here, by rule: the screen says what to do instead, and only that.
        const shown = initial.pages.flatMap((page) => page.advice);
        const deadEnd = shown.find((advice) => advice.elsewhere.length > 0);
        if (confirmable.length > 0) problems.push({ situation: situation.name, problem: "a dead end by rule is confirmable", detail: confirmable.length });
        if (!deadEnd || JSON.stringify(deadEnd.elsewhere) !== JSON.stringify(situation.deadEnd.elsewhere) || !situation.deadEnd.text.test(deadEnd.text)) {
          problems.push({ situation: situation.name, problem: "the screen does not say what to do instead", detail: shown });
        }
      } else if (confirmable.length === 0) problems.push({ situation: situation.name, problem: "no state can be confirmed", detail: initial.missing });
      if (!walk.exhausted) problems.push({ situation: situation.name, problem: "the walk did not exhaust the screen's states", detail: walk.resolutions.length });

      // Through the route: a stale proposal is refused and read again; then the default when the screen offers it as
      // complete, else the first complete state reached.
      let exits: unknown = null;
      if (situation.deadEnd) {
        exits = await situation.deadEnd.exits({ ui, ids: { projectId: base.projectId, versionId, sectionId, jobId: relaunch.jobId }, strategy,
          relaunchItem: (designation) => relaunch.items.find((item) => item.designation === designation)!,
          readProposal,
          confirmable: async (next) => {
            const walked = reachableStates(next);
            const states = walked.resolutions.filter((resolution) => resolution.complete);
            const verdicts = await databaseVerdicts({ userId, tenantId: scoped.tenantId, versionId, jobId: relaunch.jobId, sectionId,
              dpgf: Boolean(situation.dpgf), calls: states.map((resolution) => ({ payload: resolution.payload, strategy })) });
            return { states: states.length, verdicts: [...new Set(verdicts)], misadvised: walked.misadvised };
          },
          problem: (problem, detail) => problems.push({ situation: situation.name, problem, detail }) });
      }
      let chosen = context.base;
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
        naive: naive.map((entry, at) => [entry.reason, reasonOf(naiveVerdicts[at])]), defaultComplete: initial.complete, stale, exits });
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
