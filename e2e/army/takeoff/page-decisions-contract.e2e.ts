import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import {
  confirmationControls,
  initialConfirmationDraft,
  resolveConfirmation,
  setConfirmationControl,
  type ConfirmationDraft,
} from "@/components/takeoff/takeoff-apply-wizard/page-decisions";
import type { TakeoffPageDecision, TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, ownEstimate, readEstimate, recordEvidence, type ArmyState,
} from "../critical/fixtures";
import { applyOwnedTakeoff, localTakeoffFixture, type TakeoffSeedItem } from "./fixtures";
import { localSqlTransport } from "./generated-prerequisites";

// TI-682 lot D, PR 2, Codex review of 708c7fbf: the contract between the « Pages déjà au devis » confirmation and the
// database, closed for a class of situations rather than case by case. Four findings (and one of c06cbb1b) came from
// the screen and the proposal reasoning page by page while the database decides per estimate line across every page of
// the application; two of them were dead ends (a default the database refuses, read again, refused again).
//
// For each situation of the matrix: an earlier takeoff applied through the route, the estimator's edit where it asks
// one, a relaunch seeded, then the proposal read from the real route with the estimator's session. From the screen's
// initial state, every state reachable through an enabled control is walked (the screen's own model,
// page-decisions.ts, the one the panel renders); every state the screen would let the estimator confirm is applied by
// the real database function (public.apply_takeoff_job_with_page_decisions) as the estimator, in one transaction rolled
// back, and must be accepted. Every option the screen does not offer states why. Finally one complete state, the default
// when it is complete, is applied through the real route.
// Engine 3: the Army tenant creates engine 2 versions, whose lines name no source line and never carry two pages; the
// engine 3 versions are prepared by SQL in the estimator's own project, everything under test goes through the routes.
// Fictional plans and quantities only.

const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 600_000 };
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string; details?: unknown } };
type Read = { line: string; quantity: number; unit: string; page: number | null };
type Situation = {
  name: string;
  dpgf?: boolean;
  /**
   * The relaunch's level: C by default. A level C line without a page is blocked from any application until an
   * administrator forces it (the quantity guard, which the wizard shows apart), so a line without a page is read at B.
   */
  level?: "B" | "C";
  earlier: Read[];
  /** The estimator's quantity typed by hand on the earlier line of this title, before the relaunch. */
  handQuantity?: { title: string; quantity: number };
  relaunch: Read[];
  /** What the proposal must show before anything is chosen. */
  expect: (proposal: TakeoffPageReplacementResponse) => void;
};

const read = (line: string, quantity: number, unit: string, page: number | null): Read => ({ line, quantity, unit, page });
const EF = "EF cuivre DN 20";
const lineNamed = (proposal: TakeoffPageReplacementResponse, title: string) => proposal.lines.find((line) => line.title === title)!;

const SITUATIONS: Situation[] = [
  { name: "a line on one page, measured again", earlier: [read("WC suspendu", 4, "u", 1)], relaunch: [read("WC suspendu", 5, "u", 1)],
    expect: (proposal) => expect(proposal.pairs).toHaveLength(1) },
  { name: "a line on two pages, both measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read(EF, 15, "ml", 1), read(EF, 20, "ml", 2)],
    expect: (proposal) => expect([proposal.pages.length, proposal.lines.length, proposal.pairs.length]).toEqual([2, 1, 2]) },
  { name: "a line on two pages, one measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read(EF, 12, "ml", 1)],
    expect: (proposal) => expect(lineNamed(proposal, EF).outside_pages).toBe(true) },
  { name: "a new line without a page over a line of two pages", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    level: "B", relaunch: [read(EF, 18, "ml", null)],
    expect: (proposal) => expect([proposal.pages.length, proposal.pairs.length]).toEqual([2, 1]) },
  { name: "a vanished line whose pages are all measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read("Vanne d'arrêt", 2, "u", 1), read("Vanne d'arrêt", 1, "u", 2)],
    expect: (proposal) => expect(lineNamed(proposal, EF).outside_pages).toBe(false) },
  { name: "a vanished line carrying a page not measured again", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read("Vanne d'arrêt", 2, "u", 1)],
    expect: (proposal) => expect(lineNamed(proposal, EF).outside_pages).toBe(true) },
  { name: "an updated line whose other page has no new line", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    relaunch: [read(EF, 15, "ml", 1), read("Vanne d'arrêt", 1, "u", 2)],
    expect: (proposal) => expect(proposal.pairs).toHaveLength(1) },
  { name: "a quantity changed by hand, on two pages", earlier: [read(EF, 10, "ml", 1), read(EF, 10, "ml", 2)],
    handQuantity: { title: EF, quantity: 24 }, relaunch: [read(EF, 15, "ml", 1), read(EF, 20, "ml", 2)],
    expect: (proposal) => expect(lineNamed(proposal, EF).changed_by_hand).toBe(true) },
  { name: "a DPGF version, « Fusionner » required", dpgf: true, earlier: [read("WC suspendu", 4, "u", 1), read("Robinet d'arrêt", 3, "u", 1)],
    relaunch: [read("WC suspendu", 5, "u", 1), read("Lave-mains", 1, "u", 1)],
    expect: (proposal) => expect([proposal.merge_required, proposal.pairs.map((pair) => pair.locked)]).toEqual([true, [true]]) },
];

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
      if (code !== 0) reject(new Error(`Local SQL failed: SQLSTATE=${/ERROR:\s*([0-9A-Z]{5})/.exec(stderr)?.[1] ?? "unavailable"}`));
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
  return { versionId, sectionId: String(target.parent_id) };
}

/**
 * A choice the screen does not offer, forced past it: the decisions it would send. The database must refuse each one,
 * or the screen withholds a choice the estimator is entitled to (Codex review of 708c7fbf: « Retirer du devis » was
 * disabled for a line whose pages were all measured again, which the database accepts).
 */
function forcedPayload(proposal: TakeoffPageReplacementResponse, draft: ConfirmationDraft, control: ReturnType<typeof confirmationControls>[number],
  value: unknown): TakeoffPageDecision[] | null {
  if (control.kind === "vanished" && value === "remove") {
    // From « keep », every other choice made: the pages of the line may then replace nothing, which the removal changes.
    const kept = resolveConfirmation(proposal, { ...draft, vanished: { ...draft.vanished, [control.lineId]: "keep" } });
    const linePages = new Set(kept.lines.find((entry) => entry.line.id === control.lineId)?.pages.map((page) => page.key) ?? []);
    if (kept.lines.some((entry) => entry.missing.length > 0)
      || kept.pages.some((page) => page.missing.some((message) => !(linePages.has(page.page.key) && message.includes("rien n’y est remplacé"))))) return null;
    return kept.payload.map((decision) => decision.decision !== "replace" ? decision : { ...decision,
      lines: decision.lines.map((line) => (line.estimate_item_id === control.lineId ? { ...line, action: "remove" as const } : line)) });
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

/** Every state the screen can reach from its initial state through enabled controls (bounded), each with its resolution. */
function reachableStates(proposal: TakeoffPageReplacementResponse, limit = 400) {
  const seen = new Map<string, ConfirmationDraft>();
  const queue = [initialConfirmationDraft(proposal)];
  const unexplained: string[] = [];
  const withheld = new Map<string, { choice: string; payload: TakeoffPageDecision[] }>();
  while (queue.length > 0 && seen.size < limit) {
    const draft = queue.shift()!;
    const signature = JSON.stringify(resolveConfirmation(proposal, draft).payload) + JSON.stringify(draft);
    if (seen.has(signature)) continue;
    seen.set(signature, draft);
    for (const control of confirmationControls(resolveConfirmation(proposal, draft))) {
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
  return { states: [...seen.values()], unexplained, withheld: [...withheld.values()] };
}

/** Each payload applied by the real database function as the estimator, then rolled back: « ok » or the refusal. */
async function databaseVerdicts(input: { userId: string; tenantId: string; versionId: string; jobId: string; sectionId: string; strategy: string;
  dpgf: boolean; payloads: TakeoffPageDecision[][] }) {
  if (input.payloads.length === 0) return [];
  const token = `contract-${randomUUID()}`;
  const calls = input.payloads.map((payload, index) => `select 'STATE|${index}|' || pg_temp.contract_try(${literal(payload)});`).join("\n");
  const lines = await sql(`begin;
create function pg_temp.contract_try(p_decisions jsonb) returns text language plpgsql as $fn$
declare
  plan jsonb;
  detail text;
begin
  select coalesce(jsonb_agg(entry.value order by entry.ord), '[]'::jsonb) into plan from (
    select jsonb_build_object('item_id', item.id, 'source_order', (row_number() over (order by item.created_at, item.id)) - 1, 'rule_id', null,
      'action', 'none', 'designation', btrim(item.designation), 'unit_price_cents', null, 'category_id', null, 'assembly_id', null) as value,
      row_number() over (order by item.created_at, item.id) as ord
    from public.takeoff_items item where item.job_id = '${input.jobId}') entry;
  begin
    perform count(*) from public.apply_takeoff_job_with_page_decisions('${input.jobId}', '${input.strategy}', '${input.sectionId}', plan,
      p_decisions, ${input.dpgf ? `'${token}'` : "null"});
    raise exception using errcode = 'P0001', message = 'CONTRACT_DRY_RUN_OK';
  exception when others then
    if sqlerrm = 'CONTRACT_DRY_RUN_OK' then return 'ok'; end if;
    get stacked diagnostics detail = pg_exception_detail;
    return sqlstate || ' ' || sqlerrm || coalesce(' ' || detail, '');
  end;
end
$fn$;
grant execute on function pg_temp.contract_try(jsonb) to authenticated;
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

armyTest("TKD03 every confirmation the « Pages déjà au devis » screen allows is accepted by the database, for each situation of the matrix", options,
  async (ui) => {
    const { browser, army } = ui;
    const base = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY contrat des pages" }, army);
    const fixture = await localTakeoffFixture(army, base);
    const userId = (await fixture.client.auth.getUser()).data.user!.id;
    const plain = await engineThreeVersion(army, browser, base.projectId, base.versionId, false);
    const dpgf = await engineThreeVersion(army, browser, base.projectId, base.versionId, true);
    const report: unknown[] = [];
    // Every situation is walked before anything fails, so that one run reports all of them.
    const problems: Array<{ situation: string; problem: string; detail: unknown }> = [];

    for (const [index, situation] of SITUATIONS.entries()) {
      const { versionId, sectionId } = situation.dpgf ? dpgf : plain;
      const strategy = situation.dpgf ? "merge" : "append";
      // One plan per situation: its pages are its own.
      const plan = randomUUID();
      const source = `contrat-${index + 1}.pdf`;
      const seedOf = (reads: Read[]): TakeoffSeedItem[] => reads.map((entry) => ({ designation: entry.line, quantity: entry.quantity, unit: entry.unit,
        confidence: 0.95, source_page: entry.page, metadata: { source_document: { kind: "plan_file", plan_file_id: plan } } }));
      const scoped = await localTakeoffFixture(army, { projectId: base.projectId, versionId });
      const earlier = await scoped.seed("C", seedOf(situation.earlier), source);
      const applied = await applyOwnedTakeoff(browser, versionId, earlier.jobId, { strategy, target_section_id: sectionId });
      expect(applied.status, `${situation.name}: the earlier takeoff applies`).toBe(200);
      if (situation.handQuantity) {
        const estimate = await readEstimate(browser, versionId);
        const line = estimate.items.find((item) => item.title === situation.handQuantity!.title && item.source_job_id === earlier.jobId)!;
        const edited = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${versionId}/batch`,
          { operation_key: randomUUID(), operations: [{ op: "update", id: line.id, data: { quantity: situation.handQuantity.quantity } }] },
          { "if-match": estimate.version.updated_at });
        expect(edited.status, `${situation.name}: the estimator's own quantity`).toBe(200);
      }
      const relaunch = await scoped.seed(situation.level ?? "C", seedOf(situation.relaunch), source);
      const read = await apiRequest<Envelope<TakeoffPageReplacementResponse>>(browser, "POST", `/api/takeoff/jobs/${relaunch.jobId}/page-replacement`,
        { strategy, target_section_id: sectionId });
      expect([read.status, read.body.ok], `${situation.name}: the proposal`).toEqual([200, true]);
      const proposal = read.body.data;
      situation.expect(proposal);

      const { states, unexplained, withheld } = reachableStates(proposal);
      if (unexplained.length > 0) problems.push({ situation: situation.name, problem: "an option without effect or without a reason", detail: unexplained });
      const complete = states.map((draft) => resolveConfirmation(proposal, draft)).filter((resolution) => resolution.complete);
      const allVerdicts = await databaseVerdicts({ userId, tenantId: scoped.tenantId, versionId, jobId: relaunch.jobId, sectionId, strategy,
        dpgf: Boolean(situation.dpgf), payloads: [...complete.map((resolution) => resolution.payload), ...withheld.map((entry) => entry.payload)] });
      const verdicts = allVerdicts.slice(0, complete.length);
      const refused = complete.flatMap((resolution, at) => (verdicts[at] === "ok" ? [] : [{ payload: resolution.payload, verdict: verdicts[at] }]));
      // A choice the screen withholds is one the database refuses.
      const unjustified = withheld.flatMap((entry, at) => (allVerdicts[complete.length + at] === "ok" ? [entry.choice] : []));
      const initial = resolveConfirmation(proposal, initialConfirmationDraft(proposal));
      report.push({ situation: situation.name, versionId, earlier: earlier.jobId, relaunch: relaunch.jobId, pages: proposal.pages.length,
        states: states.length, complete: complete.length, refused: refused.length, withheld: withheld.length, unjustified: unjustified.length,
        withheldVerdicts: withheld.map((entry, at) => [entry.choice, allVerdicts[complete.length + at]]),
        defaultComplete: initial.complete, defaultMissing: initial.missing });
      expect(allVerdicts, `${situation.name}: one verdict per state sent`).toHaveLength(complete.length + withheld.length);
      if (refused.length > 0) {
        problems.push({ situation: situation.name, problem: "a state the screen lets the estimator confirm is refused by the database",
          detail: refused.slice(0, 3) });
      }
      if (unjustified.length > 0) problems.push({ situation: situation.name, problem: "a choice the screen withholds is accepted by the database", detail: unjustified });
      if (complete.length === 0) problems.push({ situation: situation.name, problem: "no state can be confirmed", detail: initial.missing });

      // Through the route: the default when the screen offers it as complete, else the first complete state reached.
      const chosen = initial.complete ? initial : complete[0];
      if (chosen) {
        const final = await applyOwnedTakeoff(browser, versionId, relaunch.jobId, { strategy, target_section_id: sectionId, page_decisions: chosen.payload });
        if (final.status !== 200) problems.push({ situation: situation.name, problem: "the route refuses the state applied", detail: final.body });
      }
    }
    await recordEvidence(army, "TKD03-contract", { base, plain, dpgf, report, problems });
    expect(problems).toEqual([]);
  });
