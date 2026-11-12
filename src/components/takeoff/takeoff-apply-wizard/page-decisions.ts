import { composeDpgfTarget, removeDpgfParts } from "@/lib/takeoff/dpgf-composition";
import { replacementQuantities } from "@/lib/takeoff/page-replacement";
import {
  TAKEOFF_PAGE_KEEP_BOTH_REASONS,
  TAKEOFF_PAGE_NOTE_MIN,
  type TakeoffPageDecision,
  type TakeoffPageKeepBothReason,
  type TakeoffPageReplacementDpgfTarget,
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

/**
 * What the screen asks of the estimator to confirm, and how. `choose` names the choices of this screen the text
 * advises: each one enabled where it is advised, and part of a state that can be confirmed. `elsewhere` names what is
 * done outside the step when no choice here can confirm, each way out written in `exits` with what it opens. The text
 * is written from these only.
 */
export type Advice = {
  text: string;
  choose: Array<{ control: string; value: string | null }>;
  elsewhere: Array<"exclude_at_review" | "link_in_dpgf_review">;
  exits: string[];
};
/** The text of an advice as one message (its sentence, then its ways out). */
const adviceMessage = (advice: Advice) => [advice.text, ...advice.exits].join(" ");
export type ResolvedPage = { page: TakeoffPageReplacementPage; choice: PageChoice; label: string; missing: string[]; advice: Advice[];
  /** « Remplacer » is marked « (recommandé) »: only where replacing can be confirmed on the page. */
  recommended: boolean;
  /** Why « Garder les deux » is not offered on the page, if it is not. */
  keepBothRefused: string | null };
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
  /** What the new measure gives the line (its pages' parts decided), shown while a take is still to choose. */
  measured: number | null;
  take: "new" | "keep_mine" | null;
  vanished: "remove" | "keep" | null;
  /** Why « remove » is not offered, if it is not. */
  removeRefused: string | null;
  missing: string[];
  advice: Advice[];
  /** A DPGF line: what it will hold (TI-682 D4). */
  dpgf?: DpgfTargetOutcome | null;
};
/**
 * TI-682 D4: what a DPGF line the application touches will hold under the draft: the sum of the takeoffs it keeps (by
 * takeoff and page; `job_id` null for this one), the part of each page replaced taken out, and when it falls, each page
 * that took its part away, whether this takeoff feeds the line from it again, and where that page's new measure went (its
 * lines of the line's unit added outside the DPGF; none: nowhere).
 */
export type DpgfTargetOutcome = {
  target: TakeoffPageReplacementDpgfTarget;
  before: number | null;
  after: number;
  takeoffs: Array<{ job_id: string | null; quantity: number; pages: Array<{ label: string; quantity: number | null }> }>;
  falls: boolean;
  drops: Array<{ pageKey: string; label: string; refed: boolean;
    destinations: Array<{ designation: string; quantity: number; unit: string }> }>;
  /**
   * The pages replaced that take only part of a contribution whose share per page is unknown, once every page replaced
   * is counted together (the database refuses them: dpgf_part_unknown), each with the pages read again that hold the
   * rest of it and are not replaced (replacing them too takes it out whole), or none when part of it lies on a page this
   * takeoff does not read.
   */
  indivisible: Array<{ pageKey: string; label: string; alsoReplace: Array<{ key: string; label: string }> }>;
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
  /** The step's introduction: what it advises for these pages. */
  introduction: Advice;
  complete: boolean;
  payload: TakeoffPageDecision[];
  counts: { updated: number; added: number; removed: number; kept: number; keptBoth: number };
  /** TI-682 D4: every DPGF line the application touches, before and after. */
  dpgf: DpgfTargetOutcome[];
};

const placeLabel = (place: { source_file_name: string | null; source_page: number | null }) =>
  pageLabel({ file_name: place.source_file_name, page: place.source_page });
const samePlace = (place: { source_file_name: string | null; source_page: number | null }, page: TakeoffPageReplacementPage) =>
  place.source_file_name === page.file_name && place.source_page === page.page;

/**
 * TI-696: the pages linked by DPGF parts whose share per page is unknown (a policy applied before D4), by group. The
 * application takes such a part out whole or refuses (dpgf_part_unknown), counting the pages replaced together: a group
 * is replaced together or kept together. `whole`: none of its parts lies on a page this takeoff does not read, so
 * replacing the group takes them out; `forced`: the pages of a group of several that are always replaced (keeping both
 * refused there), so the others cannot be kept both.
 */
type PageGroup = { pages: string[]; whole: boolean; forced: string[] };
function unknownPartGroups(proposal: TakeoffPageReplacementResponse): Map<string, PageGroup> {
  const parent = new Map(proposal.pages.map((page) => [page.key, page.key]));
  const find = (key: string): string => (parent.get(key) === key ? key : find(parent.get(key)!));
  const notWhole = new Set<string>();
  for (const target of proposal.dpgf_targets) {
    const holding = (itemId: string) => proposal.pages.filter((page) => page.lines.some((entry) => entry.id === target.id
      && entry.item_ids.includes(itemId))).map((page) => page.key);
    for (const part of target.earlier.filter((entry) => entry.item_ids.length > 1)) {
      const pages = [...new Set(part.item_ids.flatMap(holding))];
      if (pages.length === 0) continue;
      for (const key of pages.slice(1)) parent.set(find(key), find(pages[0]));
      if (part.item_ids.some((itemId) => holding(itemId).length === 0)) notWhole.add(pages[0]);
    }
  }
  const groups = new Map<string, PageGroup>();
  for (const page of proposal.pages) {
    const group = groups.get(find(page.key)) ?? { pages: [], whole: true, forced: [] };
    group.pages.push(page.key);
    if (page.keep_both_refused) group.forced.push(page.key);
    groups.set(find(page.key), group);
  }
  for (const key of notWhole) groups.get(find(key))!.whole = false;
  for (const group of groups.values()) if (group.pages.length < 2) group.forced = [];
  return new Map(proposal.pages.map((page) => [page.key, groups.get(find(page.key))!]));
}

/** What one DPGF line will hold once the pages of `replacing` are replaced (the application's arithmetic, D4). */
function dpgfOutcome(proposal: TakeoffPageReplacementResponse, target: TakeoffPageReplacementDpgfTarget,
  replacing: ReadonlySet<string>, groups: ReadonlyMap<string, PageGroup>): DpgfTargetOutcome {
  const pages = proposal.pages.filter((page) => replacing.has(page.key));
  const removedOn = new Map(pages.map((page) => [page.key, new Set(page.lines.find((entry) => entry.id === target.id)?.item_ids ?? [])]));
  // Every page replaced, together, as the application takes them out (removeDpgfParts, the twin of
  // private.takeoff_compose_dpgf_targets): a part goes whole, or the replacement is refused.
  const removed = new Set([...removedOn.values()].flatMap((ids) => [...ids]));
  const parts = removeDpgfParts(target.earlier, removed);
  // The pages kept both of its group: replacing them too takes every part out whole, unless one lies on a page this
  // takeoff does not read (then the group is only kept both).
  const indivisible = pages.filter((page) => parts.indivisible.some((part) => part.item_ids.some((id) => removedOn.get(page.key)!.has(id))))
    .map((page) => {
      const group = groups.get(page.key)!;
      const others = group.whole ? proposal.pages.filter((other) => group.pages.includes(other.key) && !replacing.has(other.key)) : [];
      return { pageKey: page.key, label: pageLabel(page), alsoReplace: others.map((other) => ({ key: other.key, label: pageLabel(other) })) };
    });
  const kept = parts.kept;
  const total = composeDpgfTarget(target.reference, [...kept,
    ...target.fed.map((line) => ({ job_id: proposal.job_id, item_ids: [line.item_id], quantity: line.quantity, protective: line.protective,
      printed_gap: line.printed_gap }))]).priced;
  // Rounded once, up to the unit for a length, as the application rounds the sum. The application writes only a line it
  // feeds or whose page it replaces (private.takeoff_compose_dpgf_targets): any other keeps what it holds.
  const written = target.fed.length > 0 || pages.some((page) => page.lines.some((entry) => entry.id === target.id));
  const composed = target.length_factor ? Math.ceil(Number((total * target.length_factor).toFixed(9))) / target.length_factor : total;
  const after = written || target.quantity === null ? composed : target.quantity;
  const created = new Map(proposal.jobs.map((job) => [job.id, job.created_at]));
  const byJob = new Map<string | null, DpgfTargetOutcome["takeoffs"][number]>();
  for (const part of [...kept.map((entry) => ({ job: entry.job_id as string | null, quantity: entry.quantity, place: entry,
    split: entry.item_ids.length === 1 })), ...target.fed.map((line) => ({ job: null, quantity: line.quantity, place: line, split: true }))]) {
    const entry = byJob.get(part.job) ?? { job_id: part.job, quantity: 0, pages: [] };
    entry.quantity = Number((entry.quantity + part.quantity).toFixed(4));
    const label = placeLabel(part.place);
    const page = entry.pages.find((known) => known.label === label);
    if (page && page.quantity !== null && part.split) page.quantity = Number((page.quantity + part.quantity).toFixed(4));
    else if (page) page.quantity = null;
    else entry.pages.push({ label, quantity: part.split ? part.quantity : null });
    byJob.set(part.job, entry);
  }
  const takeoffs = [...byJob.values()].sort((left, right) => (left.job_id === null ? 1 : 0) - (right.job_id === null ? 1 : 0)
    || (created.get(left.job_id ?? "") ?? "").localeCompare(created.get(right.job_id ?? "") ?? ""));
  const falls = target.quantity !== null && after < target.quantity;
  const fedIds = new Set(target.fed.map((line) => line.item_id));
  const newLines = new Map(proposal.new_lines.map((line) => [line.id, line]));
  const drops = falls ? pages.filter((page) => target.earlier.some((part) => part.item_ids.some((id) => removedOn.get(page.key)!.has(id))))
    .map((page) => {
      const refed = target.fed.some((line) => samePlace(line, page));
      return { pageKey: page.key, label: pageLabel(page), refed, destinations: refed ? [] : page.new_line_ids
        .flatMap((id) => (newLines.get(id) && !fedIds.has(id) && newLines.get(id)!.unit_key === target.unit_key ? [newLines.get(id)!] : []))
        .map((line) => ({ designation: line.designation, quantity: line.quantity, unit: line.unit })) };
    }) : [];
  return { target, before: target.quantity, after, takeoffs, falls, drops, indivisible };
}

/** One reading of the draft: what each page, each line and each new line does, and the decisions sent. */
export function resolveConfirmation(proposal: TakeoffPageReplacementResponse, draft: ConfirmationDraft): Resolution {
  const labels = new Map(proposal.pages.map((page) => [page.key, pageLabel(page)]));
  const groups = unknownPartGroups(proposal);
  const keepBothRefused = new Map(proposal.pages.map((page) => {
    const forced = groups.get(page.key)!.forced.filter((key) => key !== page.key);
    return [page.key, keepBothRefusal(page) ?? (forced.length > 0 ? "une ligne DPGF y garde une part d’un métré appliqué avant le cumul, "
      + `qui ne sort qu’entière avec ${forced.map((key) => labels.get(key)).join(", ")}, toujours remplacée` : null)] as const;
  }));
  const choiceOf = (key: string) => {
    const choice = draft.pages[key] ?? REPLACE;
    // A refused « keep both » is never in effect, whatever the draft holds.
    return choice.decision === "keep_both" && keepBothRefused.get(key) ? REPLACE : choice;
  };
  const replacing = new Set(proposal.pages.filter((page) => choiceOf(page.key).decision === "replace").map((page) => page.key));
  const locked = new Map(proposal.pairs.filter((pair) => pair.locked).map((pair) => [pair.takeoff_item_id, pair.estimate_item_id]));
  const linesById = new Map(proposal.lines.map((line) => [line.id, line]));
  // What each page can replace, whatever the estimator chooses on it: a DPGF line (TI-682 D4: the page's part leaves its
  // sum, fed again or not), a line some new line can replace, or a line it can remove. « Remplacer » is confirmed on a
  // page only with one of these (else nothing_replaced).
  const replaceableLines = new Set([...proposal.new_lines.flatMap((newLine) => newLine.candidates.flatMap((candidate) => candidate.line_ids)),
    ...locked.values()]);
  const replacesOtherThan = (page: TakeoffPageReplacementPage, lineId: string | null) => page.lines.some((entry) => entry.id !== lineId
    && (linesById.get(entry.id)!.dpgf_target || replaceableLines.has(entry.id) || !linesById.get(entry.id)!.outside_pages));
  // A page whose group holds a DPGF part of unknown share lying partly on a page this takeoff does not read: no
  // replacement takes it out whole (dpgf_part_unknown), so replacing is not recommended there; the group is kept both.
  // A group whose parts all lie on pages read again leaves whole when all of them are replaced; the line says so when
  // only some are.
  const cutsUnknownPart = (page: TakeoffPageReplacementPage) => !groups.get(page.key)!.whole;
  const replaceable = new Map(proposal.pages.map((page) => [page.key, replacesOtherThan(page, null) && !cutsUnknownPart(page)]));
  const dpgf = proposal.dpgf_targets.map((target) => dpgfOutcome(proposal, target, replacing, groups));
  const dpgfById = new Map(dpgf.map((outcome) => [outcome.target.id, outcome]));
  const pagesByKey = new Map(proposal.pages.map((page) => [page.key, page]));
  const keepBothOffered = (key: string) => !keepBothRefused.get(key);

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
    const base = { line, before, take: null, vanished: null, removeRefused: null, newLineIds: [] as string[], measured: null };
    if (line.dpgf_target) {
      // TI-682 D4: it sums the takeoffs it keeps; a replaced page's part leaves it. A part whose share per page is unknown
      // (a policy applied before D4) cannot leave with one page: the page is kept both.
      const outcome = dpgfById.get(line.id);
      const advice: Advice[] = (outcome?.indivisible ?? []).map(({ pageKey, label, alsoReplace }) => {
        const keepBoth = keepBothOffered(pageKey);
        const ways = [...(alsoReplace.length > 0 ? [`remplacez aussi ${alsoReplace.map((other) => other.label).join(", ")}`] : []),
          ...(keepBoth ? ["gardez les deux mesures de la page"] : [])];
        const sentence = ways.join(", ou ");
        return { text: `« ${line.title} » : sa part sur ${label} n’est pas connue (métré appliqué avant le cumul) ; remplacer la page la retirerait entière.`
            + `${sentence ? ` ${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.` : ""}`,
          choose: [...alsoReplace.map((other) => ({ control: `page:${other.key}`, value: "replace" })),
            ...(keepBoth ? [{ control: `page:${pageKey}`, value: "keep_both" }] : [])], elsewhere: [], exits: [] };
      });
      return { ...base, state: "dpgf" as const, after: outcome?.after ?? before, missing: advice.map(adviceMessage), advice, dpgf: outcome ?? null,
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
      const advice: Advice[] = [
        ...pages.filter((page) => page.role === "part" && page.part === null && replaceable.get(page.key)).map((page) => {
          // Keeping its part replaces nothing on a page where nothing else is replaced: the page is then kept both.
          const keepPart = replacesOtherThan(pagesByKey.get(page.key)!, line.id);
          const options = ["retirez sa part", ...(keepPart ? ["gardez-la"] : keepBothOffered(page.key) ? ["gardez les deux mesures de la page"] : [])];
          return { text: `« ${line.title} » : ${page.label} est remesurée sans ligne qui la remplace, ${options.join(", ou ")}.`,
            choose: [{ control: `part:${line.id}:${page.key}`, value: "drop" },
              ...(keepPart ? [{ control: `part:${line.id}:${page.key}`, value: "keep" }]
                : keepBothOffered(page.key) ? [{ control: `page:${page.key}`, value: "keep_both" }] : [])],
            elsewhere: [], exits: [] };
        }),
        ...(line.changed_by_hand && take === null ? [{ text: `« ${line.title} » : quantité modifiée à la main, nouvelle mesure ou la vôtre.`,
          choose: [{ control: `take:${line.id}`, value: "new" }, { control: `take:${line.id}`, value: "keep_mine" }], elsewhere: [], exits: [] }] : []),
      ];
      const missing = advice.map(adviceMessage);
      const decided = pages.every((page) => page.role !== "part" || page.part !== null);
      return { ...base, state: "updated" as const, pages, take, newLineIds: by.map((entry) => entry.newLine.id), measured: decided ? next : null,
        after: !decided ? null : line.changed_by_hand && take === "keep_mine" ? before ?? 0 : line.changed_by_hand && take === null ? null : next,
        missing, advice };
    }
    if (replaced.length === 0) {
      return { ...base, state: "kept" as const, after: before, missing: [], advice: [],
        pages: onPages.map((page) => ({ ...page, role: "kept_both" as const, part: null })) };
    }
    const removeRefused = line.outside_pages
      ? "elle porte aussi des pages que ce métré ne relit pas, qui partiraient avec elle"
      : keptBoth.length > 0 ? `elle est gardée avec ${keptBoth.map((page) => page.label).join(", ")} (garder les deux)` : null;
    const choice = draft.vanished[line.id] ?? null;
    const vanished = choice === "remove" && removeRefused ? null : choice;
    // Only what can be confirmed: removing it (unless refused, and why); keeping it, where its pages still replace
    // something else; else keeping both measures of its page. On a page that cannot be replaced at all, the page says
    // what to do, not the line.
    const advisable = replaced.filter((page) => replaceable.get(page.key));
    const keepLine = advisable.length > 0 && advisable.every((page) => replacesOtherThan(pagesByKey.get(page.key)!, line.id));
    const keepBothPages = keepLine ? [] : advisable.filter((page) => keepBothOffered(page.key));
    const options = [...(removeRefused ? [] : ["retirez-la"]), ...(keepLine ? ["gardez-la"] : keepBothPages.length > 0 ? [
      `gardez les deux mesures ${keepBothPages.length > 1 ? "de ses pages" : "de la page"}`] : [])];
    const advice: Advice[] = vanished !== null || advisable.length === 0 ? [] : [{
      text: `« ${line.title} » : le nouveau métré ne l’a plus${options.length > 0 ? `, ${options.join(", ou ")}` : ""}`
        + `${removeRefused ? ` (la retirer n’est pas possible : ${removeRefused})` : ""}.`,
      choose: [...(removeRefused ? [] : [{ control: `vanished:${line.id}`, value: "remove" }]),
        ...(keepLine ? [{ control: `vanished:${line.id}`, value: "keep" }] : keepBothPages.map((page) => ({ control: `page:${page.key}`, value: "keep_both" })))],
      elsewhere: [], exits: [] }];
    return { ...base, state: "vanished" as const, vanished, removeRefused,
      after: vanished === "keep" ? before : null,
      pages: onPages.map((page) => ({ ...page, role: replacing.has(page.key) ? "vanished" as const : "kept_both" as const, part: null })),
      missing: advice.map(adviceMessage), advice };
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
    const advice: Advice[] = [];
    const done = () => ({ page, choice, label, advice, missing: advice.map(adviceMessage), recommended: replaceable.get(page.key)!,
      keepBothRefused: keepBothRefused.get(page.key) ?? null });
    if (choice.decision === "keep_both") {
      if (!choice.reason) {
        advice.push({ text: `${label} : choisissez le motif pour garder les deux mesures.`,
          choose: TAKEOFF_PAGE_KEEP_BOTH_REASONS.map((reason) => ({ control: `reason:${page.key}`, value: reason })), elsewhere: [], exits: [] });
      } else if (choice.reason === "complementary_scope" && choice.note.trim().length < TAKEOFF_PAGE_NOTE_MIN) {
        advice.push({ text: `${label} : décrivez le périmètre complémentaire (10 caractères au moins).`, choose: [], elsewhere: [], exits: [] });
      }
      return done();
    }
    // « Keep both » is advised only where the screen offers it.
    const keepBothOpen = keepBothOffered(page.key);
    const keepBoth = { control: `page:${page.key}`, value: "keep_both" };
    const held = page.lines.map((entry) => resolvedLines.get(entry.id)!);
    // The DPGF line says why a page cutting its unknown part is kept both.
    if (!replaceable.get(page.key) && !cutsUnknownPart(page)) {
      // Nothing on the page can be replaced (no new line replaces one of its lines, none can be removed): replacing it
      // is never confirmed (nothing_replaced). Keeping both is what confirms it.
      advice.push({ text: `${label} : Remplacer ne se confirme pas sur cette page : aucune ligne du nouveau métré ne remplace une de ses lignes, `
          + `et aucune ne peut en être retirée.${keepBothOpen ? " Gardez les deux mesures avec un motif." : ""}`,
        choose: keepBothOpen ? [keepBoth] : [], elsewhere: [], exits: [] });
      return done();
    }
    const pending = held.some((entry) => entry.missing.length > 0);
    const replaces = held.some((entry) => entry.line.dpgf_target || actionOn(entry, page.key) !== "keep");
    if (!replaces && !pending) {
      advice.push(keepBothOpen
        ? { text: `${label} : rien n’y est remplacé. Gardez les deux mesures avec un motif.`, choose: [keepBoth], elsewhere: [], exits: [] }
        : { text: `${label} : rien n’y est remplacé ; remplacez ou retirez au moins une de ses lignes.`, choose: [], elsewhere: [], exits: [] });
    }
    return done();
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
  // The introduction names a choice only where some page can be confirmed with it.
  const replaceablePages = proposal.pages.filter((page) => replaceable.get(page.key));
  const keepablePages = proposal.pages.filter((page) => keepBothOffered(page.key));
  const advised = [...(replaceablePages.length > 0 ? ["remplacez leur mesure précédente"] : []),
    ...(keepablePages.length > 0 ? ["gardez les deux avec un motif"] : [])];
  const introduction: Advice = {
    text: `Une page n’entre qu’une fois : ${advised.length > 0 ? `${advised.join(", ou ")}.`
      : "aucune ne se confirme ici, la suite se fait hors de cette étape, comme chaque page l’indique."}`,
    choose: [...replaceablePages.map((page) => ({ control: `page:${page.key}`, value: "replace" })),
      ...keepablePages.map((page) => ({ control: `page:${page.key}`, value: "keep_both" }))],
    elsewhere: [], exits: [] };
  return {
    pages, lines, newLines, missing, complete: missing.length === 0, payload, introduction, dpgf,
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
  merge_match: "la fusion, obligatoire avec un DPGF, met une nouvelle ligne sur une ligne précédente de la page",
} as const;
export const keepBothRefusal = (page: TakeoffPageReplacementPage) => (page.keep_both_refused ? KEEP_BOTH_REFUSED[page.keep_both_refused] : null);
const LOCKED = "imposée par la fusion, obligatoire avec un DPGF";

/** Every control the screen shows for this draft, with its options and why an option is not offered. */
export function confirmationControls(resolution: Resolution): ConfirmationControl[] {
  const controls: ConfirmationControl[] = [];
  for (const { page, choice, keepBothRefused } of resolution.pages) {
    controls.push({ id: `page:${page.key}`, kind: "page", pageKey: page.key, value: choice.decision,
      options: [{ value: "replace", disabled: null }, { value: "keep_both", disabled: keepBothRefused }] });
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
