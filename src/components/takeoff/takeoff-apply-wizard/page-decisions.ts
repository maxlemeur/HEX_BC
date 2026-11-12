import { replacementQuantities } from "@/lib/takeoff/page-replacement";
import {
  TAKEOFF_PAGE_KEEP_BOTH_REASONS,
  TAKEOFF_PAGE_NOTE_MIN,
  type TakeoffPageDecision,
  type TakeoffPageKeepBothReason,
  type TakeoffPageReplacementLine,
  type TakeoffPageReplacementNewLine,
  type TakeoffPageReplacementPage,
  type TakeoffPageReplacementResponse,
} from "@/lib/takeoff/page-replacement-contracts";

// TI-682 lot D, PR 2: the estimator's decisions at the confirmation, for every page another takeoff already brought into
// the estimate. Codex review of 708c7fbf: the database decides per estimate line across all the pages of the application
// (one take, one removal, one pair per new line), so each choice has one owner here: a page's decision belongs to the
// page; a pair to the new line; a take, a removal and the part of a page a line keeps to the estimate line. Everything
// the screen shows, whether the confirmation is complete and the decisions sent are all read from one resolution of that
// draft (`resolveConfirmation`), so that no control can show what the decisions do not carry.
//
// No choice is made in the estimator's place where both errors cost: a line the new takeoff no longer has waits for
// « remove » or « keep », a quantity changed by hand for « take the new measure » or « keep mine », a re-measured page
// of an updated line where no new line replaces it for « drop its part » or « keep it ». Replacing is preselected.

export type PageChoice = { decision: "replace" | "keep_both"; reason: TakeoffPageKeepBothReason | null; note: string };
export type ConfirmationDraft = {
  pages: Record<string, PageChoice>;
  /** Each new line: the earlier line it replaces, or null to add it. */
  pairs: Record<string, string | null>;
  /** Each earlier line no new line replaces: remove it, keep it, or not chosen yet. */
  vanished: Record<string, "remove" | "keep" | null>;
  /** Each updated line's re-measured page that no new line of it replaces (key `partKey`): drop its part, keep it. */
  parts: Record<string, "drop" | "keep" | null>;
  /** Each updated line whose quantity was changed by hand: the new measure, or the estimator's own. */
  takes: Record<string, "new" | "keep_mine" | null>;
};

export const partKey = (lineId: string, pageKey: string) => `${lineId} ${pageKey}`;
const REPLACE: PageChoice = { decision: "replace", reason: null, note: "" };

export function initialConfirmationDraft(proposal: TakeoffPageReplacementResponse): ConfirmationDraft {
  return { pages: {}, pairs: Object.fromEntries(proposal.pairs.map((pair) => [pair.takeoff_item_id, pair.estimate_item_id])),
    vanished: {}, parts: {}, takes: {} };
}

export function pageLabel(page: Pick<TakeoffPageReplacementPage, "file_name" | "page">) {
  return `${page.file_name ?? "Plan sans nom"}, ${page.page === null ? "page inconnue" : `page ${page.page}`}`;
}

export type ResolvedPage = { page: TakeoffPageReplacementPage; choice: PageChoice; label: string; missing: string[] };
export type LinePageRole = "replaced" | "part" | "kept_both" | "vanished" | "dpgf";
export type ResolvedLine = {
  line: TakeoffPageReplacementLine;
  /** updated: a new line replaces it; vanished: re-measured, nothing replaces it; kept: every page kept both; dpgf. */
  state: "updated" | "vanished" | "kept" | "dpgf";
  pages: Array<{ key: string; label: string; role: LinePageRole; part: "drop" | "keep" | null; itemIds: string[] }>;
  newLineIds: string[];
  before: number | null;
  /** The quantity the database will store; null when the line is removed or not decided yet. */
  after: number | null;
  take: "new" | "keep_mine" | null;
  vanished: "remove" | "keep" | null;
  /** Why « remove » is not offered, if it is not. */
  removeRefused: string | null;
  missing: string[];
};
export type ResolvedNewLine = {
  newLine: TakeoffPageReplacementNewLine;
  pageKeys: string[];
  /** The earlier line it replaces, as sent; null: added. */
  pair: string | null;
  /** The lines it may replace on its pages decided « replace ». */
  options: string[];
  locked: boolean;
};
export type Resolution = {
  pages: ResolvedPage[];
  lines: ResolvedLine[];
  newLines: ResolvedNewLine[];
  missing: string[];
  complete: boolean;
  payload: TakeoffPageDecision[];
  counts: { updated: number; added: number; removed: number; kept: number; keptBoth: number };
};

/** One reading of the draft: what each page, each line and each new line does, and the decisions sent. */
export function resolveConfirmation(proposal: TakeoffPageReplacementResponse, draft: ConfirmationDraft): Resolution {
  const choiceOf = (key: string) => {
    const choice = draft.pages[key] ?? REPLACE;
    const page = proposal.pages.find((entry) => entry.key === key);
    // A refused « keep both » is never in effect, whatever the draft holds.
    return choice.decision === "keep_both" && page?.keep_both_refused ? REPLACE : choice;
  };
  const labels = new Map(proposal.pages.map((page) => [page.key, pageLabel(page)]));
  const replacing = new Set(proposal.pages.filter((page) => choiceOf(page.key).decision === "replace").map((page) => page.key));
  const locked = new Map(proposal.pairs.filter((pair) => pair.locked).map((pair) => [pair.takeoff_item_id, pair.estimate_item_id]));
  const linesById = new Map(proposal.lines.map((line) => [line.id, line]));

  const newLines: ResolvedNewLine[] = proposal.new_lines.map((newLine) => {
    const pageKeys = proposal.pages.filter((page) => page.new_line_ids.includes(newLine.id)).map((page) => page.key);
    const options = [...new Set(newLine.candidates.filter((candidate) => replacing.has(candidate.key)).flatMap((candidate) => candidate.line_ids))];
    const target = locked.get(newLine.id) ?? draft.pairs[newLine.id] ?? null;
    return { newLine, pageKeys, options, locked: locked.has(newLine.id), pair: target !== null && options.includes(target) ? target : null };
  });
  const pairedBy = new Map<string, ResolvedNewLine[]>();
  for (const entry of newLines) if (entry.pair) pairedBy.set(entry.pair, [...(pairedBy.get(entry.pair) ?? []), entry]);

  const lines: ResolvedLine[] = proposal.lines.map((line) => {
    const onPages = proposal.pages.flatMap((page) => {
      const held = page.lines.find((entry) => entry.id === line.id);
      return held ? [{ key: page.key, label: labels.get(page.key)!, itemIds: held.item_ids }] : [];
    });
    const keptBoth = onPages.filter((page) => !replacing.has(page.key));
    const replaced = onPages.filter((page) => replacing.has(page.key));
    const before = line.quantity;
    const base = { line, before, take: null, vanished: null, removeRefused: null, newLineIds: [] as string[] };
    if (line.dpgf_target) {
      return { ...base, state: "dpgf" as const, after: before, missing: [],
        pages: onPages.map((page) => ({ ...page, role: "dpgf" as const, part: null })) };
    }
    const by = pairedBy.get(line.id) ?? [];
    if (by.length > 0) {
      const covered = new Set(by.flatMap((entry) => entry.pageKeys));
      const pages = onPages.map((page) => {
        if (!replacing.has(page.key)) return { ...page, role: "kept_both" as const, part: null };
        if (covered.has(page.key)) return { ...page, role: "replaced" as const, part: null };
        return { ...page, role: "part" as const, part: draft.parts[partKey(line.id, page.key)] ?? null };
      });
      const removed = new Set(pages.filter((page) => page.role === "replaced" || page.part === "drop").flatMap((page) => page.itemIds));
      const take = line.changed_by_hand ? draft.takes[line.id] ?? null : null;
      const next = replacementQuantities({ quantity: line.quantity, factor: line.length_factor, sources: line.sources,
        removedSourceIds: removed, added: by.map((entry) => ({ quantity: entry.newLine.quantity })) }).next;
      const missing = [
        ...pages.filter((page) => page.role === "part" && page.part === null).map((page) =>
          `« ${line.title} » : ${page.label} est remesurée sans ligne qui la remplace, retirez sa part ou gardez-la.`),
        ...(line.changed_by_hand && take === null ? [`« ${line.title} » : quantité modifiée à la main, nouvelle mesure ou la vôtre.`] : []),
      ];
      const decided = pages.every((page) => page.role !== "part" || page.part !== null);
      return { ...base, state: "updated" as const, pages, take, newLineIds: by.map((entry) => entry.newLine.id),
        after: !decided ? null : line.changed_by_hand && take === "keep_mine" ? before ?? 0 : line.changed_by_hand && take === null ? null : next,
        missing };
    }
    if (replaced.length === 0) {
      return { ...base, state: "kept" as const, after: before, missing: [],
        pages: onPages.map((page) => ({ ...page, role: "kept_both" as const, part: null })) };
    }
    const removeRefused = line.outside_pages
      ? "elle porte aussi des pages que ce métré ne relit pas, qui partiraient avec elle"
      : keptBoth.length > 0 ? `elle est gardée avec ${keptBoth.map((page) => page.label).join(", ")} (garder les deux)` : null;
    const choice = draft.vanished[line.id] ?? null;
    const vanished = choice === "remove" && removeRefused ? null : choice;
    return { ...base, state: "vanished" as const, vanished, removeRefused,
      after: vanished === "keep" ? before : null,
      pages: onPages.map((page) => ({ ...page, role: replacing.has(page.key) ? "vanished" as const : "kept_both" as const, part: null })),
      missing: vanished === null ? [`« ${line.title} » : le nouveau métré ne l’a plus, retirez-la ou gardez-la.`] : [] };
  });

  const resolvedLines = new Map(lines.map((entry) => [entry.line.id, entry]));
  const actionOn = (entry: ResolvedLine, key: string): "update" | "remove" | "keep" => {
    const page = entry.pages.find((onPage) => onPage.key === key)!;
    if (entry.state === "updated") return page.role === "replaced" || page.part === "drop" ? "update" : "keep";
    if (entry.state === "vanished") return page.role === "vanished" && entry.vanished === "remove" ? "remove" : "keep";
    return "keep";
  };
  // Each pair once, on the first replaced page of its line that holds the new line.
  const pairPage = new Map(newLines.flatMap((entry) => {
    if (!entry.pair) return [];
    const target = resolvedLines.get(entry.pair)!;
    const page = target.pages.find((onPage) => onPage.role === "replaced" && entry.pageKeys.includes(onPage.key));
    return page ? [[entry.newLine.id, page.key] as const] : [];
  }));

  const pages: ResolvedPage[] = proposal.pages.map((page) => {
    const choice = choiceOf(page.key);
    const label = labels.get(page.key)!;
    const missing: string[] = [];
    if (choice.decision === "keep_both") {
      if (!choice.reason) missing.push(`${label} : choisissez le motif pour garder les deux mesures.`);
      else if (choice.reason === "complementary_scope" && choice.note.trim().length < TAKEOFF_PAGE_NOTE_MIN) {
        missing.push(`${label} : décrivez le périmètre complémentaire (10 caractères au moins).`);
      }
      return { page, choice, label, missing };
    }
    const held = page.lines.map((entry) => resolvedLines.get(entry.id)!);
    const notFed = held.filter((entry) => entry.line.dpgf_target && !page.dpgf_fed_again.includes(entry.line.id));
    if (notFed.length > 0) {
      missing.push(`${label} : ${notFed.map((entry) => `« ${entry.line.title} »`).join(", ")}, ligne DPGF que ce métré n’alimente pas ; sa mesure resterait à côté de la nouvelle. Gardez les deux mesures avec un motif.`);
    }
    const pending = held.some((entry) => entry.missing.length > 0);
    const replaces = held.some((entry) => entry.line.dpgf_target || actionOn(entry, page.key) !== "keep");
    if (!replaces && !pending) missing.push(`${label} : rien n’y est remplacé. Gardez les deux mesures avec un motif.`);
    return { page, choice, label, missing };
  });

  const payload: TakeoffPageDecision[] = pages.map(({ page, choice }) => {
    const base = { document: page.document, source_page: page.page, earlier_job_ids: page.earlier_job_ids };
    const lineOf = (id: string) => linesById.get(id)!;
    if (choice.decision === "keep_both") {
      return { ...base, decision: "keep_both" as const, reason_code: choice.reason, note: choice.note.trim() || null,
        lines: page.lines.map((entry) => ({ estimate_item_id: entry.id, expected_updated_at: lineOf(entry.id).updated_at, action: "keep" as const,
          take: null, item_ids: entry.item_ids })),
        pairs: [] };
    }
    return { ...base, decision: "replace" as const, reason_code: null, note: null,
      lines: page.lines.map((entry) => {
        const resolved = resolvedLines.get(entry.id)!;
        const action = actionOn(resolved, page.key);
        return { estimate_item_id: entry.id, expected_updated_at: resolved.line.updated_at, action,
          take: action === "update" && resolved.line.changed_by_hand ? resolved.take : null, item_ids: entry.item_ids };
      }),
      pairs: newLines.filter((entry) => entry.pair && pairPage.get(entry.newLine.id) === page.key)
        .map((entry) => ({ takeoff_item_id: entry.newLine.id, estimate_item_id: entry.pair! })) };
  });

  const missing = [...pages.flatMap((page) => page.missing), ...lines.flatMap((entry) => entry.missing)];
  return {
    pages, lines, newLines, missing, complete: missing.length === 0, payload,
    counts: {
      updated: lines.filter((entry) => entry.state === "updated").length,
      added: newLines.filter((entry) => entry.pair === null).length,
      removed: lines.filter((entry) => entry.state === "vanished" && entry.vanished === "remove").length,
      kept: lines.filter((entry) => entry.state === "vanished" && entry.vanished === "keep").length,
      keptBoth: pages.filter((page) => page.choice.decision === "keep_both").length,
    },
  };
}

export type ControlOption<T> = { value: T; disabled: string | null };
export type ConfirmationControl =
  | { id: string; kind: "page"; pageKey: string; value: "replace" | "keep_both"; options: ControlOption<"replace" | "keep_both">[] }
  | { id: string; kind: "reason"; pageKey: string; value: TakeoffPageKeepBothReason | null; options: ControlOption<TakeoffPageKeepBothReason | null>[] }
  | { id: string; kind: "pair"; newLineId: string; value: string | null; options: ControlOption<string | null>[]; disabled: string | null }
  | { id: string; kind: "take"; lineId: string; value: "new" | "keep_mine" | null; options: ControlOption<"new" | "keep_mine">[] }
  | { id: string; kind: "vanished"; lineId: string; value: "remove" | "keep" | null; options: ControlOption<"remove" | "keep">[] }
  | { id: string; kind: "part"; lineId: string; pageKey: string; value: "drop" | "keep" | null; options: ControlOption<"drop" | "keep">[] };

const KEEP_BOTH_REFUSED = {
  dpgf_target: "cette page alimente une ligne DPGF déjà alimentée par un autre métré, qui ne garde qu’une mesure",
  merge_match: "la fusion, obligatoire avec un DPGF, met une nouvelle ligne sur une ligne précédente de la page",
} as const;
export const keepBothRefusal = (page: TakeoffPageReplacementPage) => (page.keep_both_refused ? KEEP_BOTH_REFUSED[page.keep_both_refused] : null);
const LOCKED = "imposée par la fusion, obligatoire avec un DPGF";

/** Every control the screen shows for this draft, with its options and why an option is not offered. */
export function confirmationControls(resolution: Resolution): ConfirmationControl[] {
  const controls: ConfirmationControl[] = [];
  for (const { page, choice } of resolution.pages) {
    controls.push({ id: `page:${page.key}`, kind: "page", pageKey: page.key, value: choice.decision,
      options: [{ value: "replace", disabled: null }, { value: "keep_both", disabled: keepBothRefusal(page) }] });
    if (choice.decision === "keep_both") {
      controls.push({ id: `reason:${page.key}`, kind: "reason", pageKey: page.key, value: choice.reason,
        options: [{ value: null, disabled: null }, ...TAKEOFF_PAGE_KEEP_BOTH_REASONS.map((reason) => ({ value: reason, disabled: null }))] });
    }
  }
  for (const entry of resolution.newLines) {
    controls.push({ id: `pair:${entry.newLine.id}`, kind: "pair", newLineId: entry.newLine.id, value: entry.pair,
      disabled: entry.locked ? LOCKED : entry.options.length === 0 ? "aucune ligne précédente de même unité sur ses pages remplacées" : null,
      options: [{ value: null, disabled: entry.locked ? LOCKED : null },
        ...entry.options.map((lineId) => ({ value: lineId, disabled: entry.locked && lineId !== entry.pair ? LOCKED : null }))] });
  }
  for (const entry of resolution.lines) {
    if (entry.state === "updated" && entry.line.changed_by_hand) {
      controls.push({ id: `take:${entry.line.id}`, kind: "take", lineId: entry.line.id, value: entry.take,
        options: [{ value: "new", disabled: null }, { value: "keep_mine", disabled: null }] });
    }
    if (entry.state === "updated") {
      for (const page of entry.pages.filter((onPage) => onPage.role === "part")) {
        controls.push({ id: `part:${entry.line.id}:${page.key}`, kind: "part", lineId: entry.line.id, pageKey: page.key, value: page.part,
          options: [{ value: "drop", disabled: null }, { value: "keep", disabled: null }] });
      }
    }
    if (entry.state === "vanished") {
      controls.push({ id: `vanished:${entry.line.id}`, kind: "vanished", lineId: entry.line.id, value: entry.vanished,
        options: [{ value: "remove", disabled: entry.removeRefused }, { value: "keep", disabled: null }] });
    }
  }
  return controls;
}

/** The draft after the estimator sets one control: the choice is written once, where it belongs. */
export function setConfirmationControl(draft: ConfirmationDraft, control: ConfirmationControl, value: unknown): ConfirmationDraft {
  const option = (control.options as ControlOption<unknown>[]).find((entry) => entry.value === value);
  if (!option || option.disabled || (control.kind === "pair" && control.disabled)) return draft;
  switch (control.kind) {
    case "page": {
      const current = draft.pages[control.pageKey] ?? REPLACE;
      return { ...draft, pages: { ...draft.pages, [control.pageKey]: { ...current, decision: value as PageChoice["decision"] } } };
    }
    case "reason": {
      const current = draft.pages[control.pageKey] ?? REPLACE;
      return { ...draft, pages: { ...draft.pages, [control.pageKey]: { ...current, reason: value as PageChoice["reason"] } } };
    }
    case "pair":
      return { ...draft, pairs: { ...draft.pairs, [control.newLineId]: value as string | null } };
    case "take":
      return { ...draft, takes: { ...draft.takes, [control.lineId]: value as "new" | "keep_mine" } };
    case "vanished":
      return { ...draft, vanished: { ...draft.vanished, [control.lineId]: value as "remove" | "keep" } };
    case "part":
      return { ...draft, parts: { ...draft.parts, [partKey(control.lineId, control.pageKey)]: value as "drop" | "keep" } };
  }
}

/** A keep-both page's note (free text, not an option). */
export function setPageNote(draft: ConfirmationDraft, pageKey: string, note: string): ConfirmationDraft {
  const current = draft.pages[pageKey] ?? REPLACE;
  return { ...draft, pages: { ...draft.pages, [pageKey]: { ...current, note } } };
}
