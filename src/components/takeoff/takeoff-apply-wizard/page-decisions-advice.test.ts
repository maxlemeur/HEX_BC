import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import {
  confirmationControls,
  initialConfirmationDraft,
  resolveConfirmation,
  setConfirmationControl,
  setPageNote,
  type ConfirmationDraft,
  type Resolution,
} from "./page-decisions";

// TI-682 lot D: the « Pages déjà au devis » step never advises a choice it disables. Each piece of advice the screen
// shows is read as the estimator reads it: the choices it names (« gardez les deux », « retirez-la », …) must be
// enabled where they are named. Written before the fix (red on 2dc19d79): a page with a DPGF line the relaunch no longer
// feeds and a line « Fusionner » imposes advised « Gardez les deux », disabled there; a vanished line whose removal is
// refused advised « retirez-la ». Fictional identifiers.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" };
const key = (page: number) => `page-${page}`;
type Page = TakeoffPageReplacementResponse["pages"][number];
type Line = TakeoffPageReplacementResponse["lines"][number];
const page = (n: number, lines: number[], newLines: number[], extra: Partial<Page> = {}): Page => ({
  key: key(n), document, file_name: "plan.pdf", page: n, earlier_job_ids: [id(9000)],
  lines: lines.map((line) => ({ id: id(line), item_ids: [id(line + 1000 + n)] })), new_line_ids: newLines.map(id),
  dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: null, ...extra,
});
const line = (n: number, title: string, extra: Partial<Line> = {}): Line => ({
  id: id(n), title, unit_key: "u", quantity: 4, measured_quantity: 4, changed_by_hand: false, updated_at: "2026-11-12T10:00:00.000000+00:00",
  unit_price_ht_cents: 1000, dpgf_target: false, assembly: false, outside_pages: false, sources: [{ id: id(n + 1001), quantity: 4 }],
  length_factor: null, ...extra,
});
const newLine = (n: number, designation: string, candidates: Array<[number, number[]]>, unit = "u") => ({
  id: id(n), designation, unit, quantity: 5, unit_key: unit,
  candidates: candidates.map(([pageNumber, lines]) => ({ key: key(pageNumber), line_ids: lines.map(id) })),
});
const proposal = (extra: Partial<TakeoffPageReplacementResponse>): TakeoffPageReplacementResponse => ({
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], jobs: [], unidentified_count: 0, merge_required: false, ...extra,
});

/** The situations of TKD03 where a choice is disabled, as their proposals read. */
const SITUATIONS: Array<[string, TakeoffPageReplacementResponse]> = [
  // A DPGF line the earlier takeoff fed from the page, not fed again; « Fusionner » imposes the WC onto its earlier line.
  ["a DPGF line not fed again beside a line « Fusionner » imposes", proposal({ merge_required: true,
    pages: [page(1, [201, 202], [101], { keep_both_refused: "merge_match" })],
    lines: [line(201, "WC suspendu"), line(202, "EF cuivre DN 22 (DPGF)", { unit_key: "ml", dpgf_target: true, measured_quantity: null })],
    new_lines: [newLine(101, "WC suspendu", [[1, [201]]])],
    pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "merge", locked: true }] })],
  // The same page, whose new lines feed again another DPGF line another takeoff fed (D-6).
  ["a DPGF line not fed again on a page that feeds another one again", proposal({ merge_required: true,
    pages: [page(1, [202, 203], [101], { keep_both_refused: "dpgf_target", dpgf_fed_again: [id(203)] })],
    lines: [line(202, "EF cuivre DN 22 (DPGF)", { unit_key: "ml", dpgf_target: true }), line(203, "EU PVC 100 (DPGF)", { unit_key: "ml", dpgf_target: true })],
    new_lines: [newLine(101, "EU PVC 100", [[1, []]], "ml")] })],
  ["a vanished line carrying a page the relaunch does not read", proposal({
    pages: [page(1, [201], [101])], lines: [line(201, "EF cuivre DN 20", { unit_key: "ml", outside_pages: true })],
    new_lines: [newLine(101, "Vanne d'arrêt", [[1, []]])] })],
  ["a vanished line on two pages, one kept both", proposal({
    pages: [page(1, [201], [101]), page(2, [201], [102])], lines: [line(201, "EF cuivre DN 20", { unit_key: "ml" })],
    new_lines: [newLine(101, "Vanne d'arrêt", [[1, []]]), newLine(102, "Vanne d'arrêt", [[2, []]])] })],
  ["a line measured again", proposal({ pages: [page(1, [201], [101])], lines: [line(201, "WC suspendu")],
    new_lines: [newLine(101, "WC suspendu", [[1, [201]]])],
    pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "same_designation", locked: false }] })],
];

/** What a piece of advice tells the estimator to choose, read from its words. */
const PHRASES: Array<{ pattern: RegExp; control: (scope: string) => string; value: unknown }> = [
  { pattern: /gardez les deux|garder les deux mesures avec un motif/i, control: (scope) => `page:${scope}`, value: "keep_both" },
  { pattern: /retirez sa part/i, control: (scope) => scope, value: "drop" },
  { pattern: /retirez-la/i, control: (scope) => `vanished:${scope}`, value: "remove" },
  { pattern: /gardez-la/i, control: (scope) => `vanished:${scope}`, value: "keep" },
];

/** The advice the screen shows, each with the choices its words name, and whether each is enabled there. */
function disabledAdvice(resolution: Resolution) {
  const controls = new Map(confirmationControls(resolution).map((control) => [control.id, control]));
  const shown = [
    ...resolution.pages.flatMap((entry) => entry.missing.map((text) => ({ text, scope: entry.page.key, pages: [entry.page.key] }))),
    ...resolution.lines.flatMap((entry) => entry.missing.map((text) => ({ text, scope: entry.line.id, pages: entry.pages.map((onPage) => onPage.key) }))),
  ];
  // An explanation of why a choice is not offered, in parentheses, advises nothing.
  const advising = (text: string) => text.replace(/\([^)]*n’est pas possible[^)]*\)/g, "");
  const byWords = shown.flatMap(({ text, scope, pages }) => PHRASES.filter((phrase) => phrase.pattern.test(advising(text)))
    .flatMap((phrase) => {
      // « Gardez les deux » names a page: the page itself, or one of the pages of the line advised.
      const ids = phrase.value === "keep_both" ? pages.map((key) => `page:${key}`) : [phrase.control(scope)];
      const enabled = ids.some((controlId) => (controls.get(controlId)?.options as Array<{ value: unknown; disabled: string | null }> | undefined)
        ?.some((entry) => entry.value === phrase.value && entry.disabled === null));
      return enabled ? [] : [`« ${text} » names ${ids.join(" or ")}=${String(phrase.value)}, not offered there`];
    }));
  // The advice as the screen states it: each choice it names, enabled where it is named.
  const byStructure = [...resolution.pages.flatMap((entry) => entry.advice), ...resolution.lines.flatMap((entry) => entry.advice)].flatMap((advice) =>
    advice.choose.flatMap((choice) => {
      const option = (controls.get(choice.control)?.options as Array<{ value: unknown; disabled: string | null }> | undefined)?.find((entry) => entry.value === choice.value);
      return option && option.disabled === null ? [] : [`« ${advice.text} » chooses ${choice.control}=${String(choice.value)}, ${option ? `disabled: ${option.disabled}` : "not on screen"}`];
    }));
  return [...byWords, ...byStructure];
}

/** Every state reachable through enabled controls. */
function states(data: TakeoffPageReplacementResponse) {
  const seen = new Map<string, Resolution>();
  const queue: ConfirmationDraft[] = [initialConfirmationDraft(data)];
  while (queue.length > 0 && seen.size < 500) {
    const draft = queue.shift()!;
    const resolution = resolveConfirmation(data, draft);
    const signature = JSON.stringify([confirmationControls(resolution).map((control) => [control.id, control.value]), resolution.missing]);
    if (seen.has(signature)) continue;
    seen.set(signature, resolution);
    for (const control of confirmationControls(resolution)) {
      for (const option of control.options) {
        if (option.disabled !== null || (control.kind === "pair" && control.disabled)) continue;
        const next = setConfirmationControl(draft, control, option.value);
        // A complementary scope is written, as the estimator must to confirm it.
        queue.push(control.kind === "reason" && option.value === "complementary_scope"
          ? setPageNote(next, control.pageKey, "Réseau du local technique ajouté (fictif).") : next);
      }
    }
  }
  return [...seen.values()];
}

/**
 * Every choice the screen recommends or advises in a state: its advice (pages and lines), « (recommandé) » on
 * « Remplacer », and its introduction.
 */
function recommended(resolution: Resolution) {
  return [
    ...[...resolution.pages.flatMap((entry) => entry.advice), ...resolution.lines.flatMap((entry) => entry.advice), resolution.introduction]
      .flatMap((advice) => advice.choose.map((choice) => ({ ...choice, by: advice.text }))),
    ...resolution.pages.filter((entry) => entry.recommended).map((entry) => ({ control: `page:${entry.page.key}`, value: "replace" as string | null,
      by: "« (recommandé) »" })),
  ];
}

describe("the screen recommends only what can be confirmed", () => {
  // TKD03 checks the same against the database's verdicts; here a state the screen offers as complete stands for it.
  it.each(SITUATIONS)("%s", (_name, data) => {
    const reached = states(data);
    const confirmable = reached.filter((resolution) => resolution.complete)
      .map((resolution) => new Map(confirmationControls(resolution).map((control) => [control.id, control.value])));
    const unconfirmable = reached.flatMap((resolution) => recommended(resolution).flatMap((choice) =>
      confirmable.some((controls) => controls.get(choice.control) === choice.value) ? [] : [`${choice.control}=${String(choice.value)}, by ${choice.by}`]));
    expect([...new Set(unconfirmable)]).toEqual([]);
  });
});

describe("advice never names a disabled choice", () => {
  it.each(SITUATIONS)("%s", (_name, data) => {
    const named = states(data).flatMap(disabledAdvice);
    expect([...new Set(named)]).toEqual([]);
  });

  it("says what to do on a page where neither replacing nor keeping both is possible: exclude the merged line, or feed the DPGF line", () => {
    const resolution = resolveConfirmation(SITUATIONS[0][1], initialConfirmationDraft(SITUATIONS[0][1]));
    expect(resolution.complete).toBe(false);
    const advice = resolution.pages[0].missing.join(" ");
    expect(advice).toContain("« WC suspendu »");
    expect(advice).toContain("« EF cuivre DN 22 (DPGF) »");
    expect(advice).toMatch(/Écarter « WC suspendu » à la revue du métré : garder les deux redevient possible\./);
    expect(advice).toMatch(/Lier à cette ligne DPGF, dans le rapprochement DPGF, une ligne de ce métré lue sur cette page qui la mesure \(même unité, matériau et diamètre\) : remplacer redevient possible\./);
    expect(advice).not.toMatch(/gardez les deux/i);
    expect(resolution.pages[0].advice.map((entry) => [entry.choose, entry.elsewhere, entry.exits.length])).toEqual([[[], ["exclude_at_review", "link_in_dpgf_review"], 2]]);
    expect(resolution.pages[0].recommended).toBe(false);
    expect(resolution.introduction.choose).toEqual([]);
  });

  it("on a page feeding another DPGF line again, the only way out is to feed the line not fed", () => {
    const resolution = resolveConfirmation(SITUATIONS[1][1], initialConfirmationDraft(SITUATIONS[1][1]));
    expect(resolution.pages[0].advice.map((entry) => entry.elsewhere)).toEqual([["link_in_dpgf_review"]]);
    expect(resolution.pages[0].missing.join(" ")).not.toMatch(/écarter/i);
  });

  it("where nothing on the page can be replaced, the page advises keeping both, and the vanished line advises nothing", () => {
    const resolution = resolveConfirmation(SITUATIONS[2][1], initialConfirmationDraft(SITUATIONS[2][1]));
    expect(resolution.lines[0].missing).toEqual([]);
    expect(resolution.pages[0].missing).toEqual(["plan.pdf, page 1 : Remplacer ne se confirme pas sur cette page : aucune ligne du nouveau métré ne remplace "
      + "une de ses lignes, et aucune ne peut en être retirée. Gardez les deux mesures avec un motif."]);
    expect([resolution.pages[0].recommended, resolution.complete]).toEqual([false, false]);
  });
});
