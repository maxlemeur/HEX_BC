import { replacementQuantities } from "@/lib/takeoff/page-replacement";
import {
  TAKEOFF_PAGE_NOTE_MIN,
  type TakeoffPageDecision,
  type TakeoffPageKeepBothReason,
  type TakeoffPageReplacementRow,
} from "@/lib/takeoff/page-replacement-contracts";

// TI-682 lot D, PR 2: the estimator's draft for each page another takeoff already brought into the estimate, what it
// does to the estimate, whether it is complete, and the decisions sent with the application. No choice is made in the
// estimator's place where both errors cost: a line the new takeoff no longer has waits for « remove » or « keep », a
// quantity changed by hand waits for « take the new measure » or « keep mine ». Replacing is preselected: it is the rule.

export type PageDraft = {
  decision: "replace" | "keep_both";
  reason: TakeoffPageKeepBothReason | null;
  note: string;
  /** Each new line: the earlier line it replaces, or null to add it. */
  pairs: Record<string, string | null>;
  /** Each earlier line no new line replaces: remove it, keep it, or not chosen yet. */
  choices: Record<string, "remove" | "keep" | null>;
  /** Each paired earlier line whose quantity was changed by hand: the new measure, or the estimator's own. */
  takes: Record<string, "new" | "keep_mine" | null>;
};

export function initialPageDraft(row: TakeoffPageReplacementRow): PageDraft {
  const pairs = Object.fromEntries(row.new_lines.map((line) => [line.id,
    row.pairs.find((pair) => pair.takeoff_item_id === line.id)?.estimate_item_id ?? null]));
  return { decision: "replace", reason: null, note: "", pairs, choices: {}, takes: {} };
}

export type PageOutcome = {
  updated: Array<{ id: string; title: string; before: number | null;
    /** The quantity the database will store: every page of the line that a decision replaces counts (Codex review). */
    after: number; changedByHand: boolean; take: "new" | "keep_mine" | null; newLineIds: string[];
    /** How many pages of this application replace part of the line. */
    pages: number }>;
  added: string[];
  vanished: Array<{ id: string; title: string; quantity: number | null; choice: "remove" | "keep" | null;
    /** It also carries other pages: it is kept, never removed (its other pages would go with it). */
    otherPages: boolean }>;
  dpgfTargets: string[];
};

/** Every page of the application, so that a line carrying several pages is computed once for all of them. */
export type PageContext = { rows: readonly TakeoffPageReplacementRow[]; drafts: Readonly<Record<string, PageDraft>> };

type LineReplacement = { removed: Set<string>; added: number[]; pages: number; take: "new" | "keep_mine" | null };

/**
 * Each earlier line a decision updates, across all the pages of the application, as private.takeoff_replace_pages
 * computes it: the source lines of every replacing page taken out, every new line paired with it added, one choice for a
 * quantity changed by hand (the first one made, on whichever page).
 */
function lineReplacements(context: PageContext) {
  const lines = new Map<string, LineReplacement>();
  for (const row of context.rows) {
    const draft = context.drafts[row.key] ?? initialPageDraft(row);
    if (draft.decision !== "replace") continue;
    const quantities = new Map(row.new_lines.map((line) => [line.id, line.quantity]));
    for (const line of row.earlier_lines) {
      if (line.dpgf_target) continue;
      const newLineIds = Object.entries(draft.pairs).filter(([, estimateItemId]) => estimateItemId === line.id).map(([newLineId]) => newLineId);
      if (newLineIds.length === 0) continue;
      const entry = lines.get(line.id) ?? { removed: new Set<string>(), added: [], pages: 0, take: null };
      for (const id of line.item_ids) entry.removed.add(id);
      entry.added.push(...newLineIds.map((id) => quantities.get(id) ?? 0));
      entry.pages += 1;
      lines.set(line.id, entry);
    }
  }
  for (const row of context.rows) {
    for (const [lineId, take] of Object.entries((context.drafts[row.key] ?? initialPageDraft(row)).takes)) {
      const entry = lines.get(lineId);
      if (entry && take && entry.take === null) entry.take = take;
    }
  }
  return lines;
}

/**
 * What a page's draft does: the earlier lines updated (before → the quantity stored), the new lines added, the lines
 * that vanished. Without `context`, the page alone (an application of one page).
 */
export function pageOutcome(row: TakeoffPageReplacementRow, draft: PageDraft, context?: PageContext): PageOutcome {
  const whole = context ?? { rows: [row], drafts: { [row.key]: draft } };
  const replacements = lineReplacements({ rows: whole.rows, drafts: { ...whole.drafts, [row.key]: draft } });
  const pairedBy = new Map<string, string[]>();
  for (const [newLineId, estimateItemId] of Object.entries(draft.pairs)) {
    if (estimateItemId) pairedBy.set(estimateItemId, [...(pairedBy.get(estimateItemId) ?? []), newLineId]);
  }
  const outcome: PageOutcome = { updated: [], added: [], vanished: [], dpgfTargets: [] };
  for (const line of row.earlier_lines) {
    if (line.dpgf_target) {
      outcome.dpgfTargets.push(line.id);
      continue;
    }
    const newLineIds = pairedBy.get(line.id) ?? [];
    const replacement = replacements.get(line.id);
    if (newLineIds.length === 0 || !replacement) {
      const choice = draft.choices[line.id] ?? null;
      outcome.vanished.push({ id: line.id, title: line.title, quantity: line.quantity, otherPages: line.other_pages,
        choice: choice === "remove" && line.other_pages ? null : choice });
      continue;
    }
    const next = replacementQuantities({ quantity: line.quantity, factor: line.length_factor, sources: line.sources,
      removedSourceIds: replacement.removed, added: replacement.added.map((quantity) => ({ quantity })) });
    outcome.updated.push({ id: line.id, title: line.title, before: line.quantity,
      after: line.changed_by_hand && replacement.take === "keep_mine" ? line.quantity ?? 0 : next.next,
      changedByHand: line.changed_by_hand, take: replacement.take, newLineIds, pages: replacement.pages });
  }
  outcome.added = row.new_lines.filter((line) => !draft.pairs[line.id]).map((line) => line.id);
  return outcome;
}

/** Each page's outcome, every line computed across all the pages of the application. */
export function pageOutcomes(rows: readonly TakeoffPageReplacementRow[], drafts: Readonly<Record<string, PageDraft>>) {
  return new Map(rows.map((row) => [row.key, pageOutcome(row, drafts[row.key] ?? initialPageDraft(row), { rows, drafts })]));
}

/** What still waits for the estimator on a page: nothing when its decision can be sent. */
export function pageMissing(row: TakeoffPageReplacementRow, draft: PageDraft, context?: PageContext): string[] {
  if (draft.decision === "keep_both") {
    if (row.keep_both_refused) return ["Garder les deux n’est pas possible sur cette page."];
    if (!draft.reason) return ["Choisissez le motif pour garder les deux mesures."];
    if (draft.reason === "complementary_scope" && draft.note.trim().length < TAKEOFF_PAGE_NOTE_MIN) {
      return ["Décrivez le périmètre complémentaire (10 caractères au moins)."];
    }
    return [];
  }
  const outcome = pageOutcome(row, draft, context);
  const missing: string[] = [];
  const notFed = row.earlier_lines.filter((line) => line.dpgf_target && !line.fed_again);
  if (notFed.length > 0) {
    missing.push(`${notFed.map((line) => `« ${line.title} »`).join(", ")} : ligne DPGF que ce métré n’alimente pas ; sa mesure resterait à côté de la nouvelle. Gardez les deux mesures avec un motif.`);
  }
  const replaces = outcome.updated.length > 0 || outcome.vanished.some((line) => line.choice === "remove")
    || row.earlier_lines.some((line) => line.dpgf_target && line.fed_again);
  if (!replaces && outcome.vanished.every((line) => line.choice !== null)) {
    missing.push("Rien n’est remplacé sur cette page : gardez les deux mesures avec un motif.");
  }
  const vanished = outcome.vanished.filter((line) => line.choice === null).length;
  if (vanished > 0) missing.push(`${vanished} ligne${vanished > 1 ? "s" : ""} que le nouveau métré n’a plus : retirer ou garder.`);
  const takes = outcome.updated.filter((line) => line.changedByHand && line.take === null).length;
  if (takes > 0) missing.push(`${takes} quantité${takes > 1 ? "s" : ""} modifiée${takes > 1 ? "s" : ""} à la main : nouvelle mesure ou la vôtre.`);
  return missing;
}

/** The decisions sent with the application, one per page. */
export function pageDecisionsPayload(rows: readonly TakeoffPageReplacementRow[], drafts: Readonly<Record<string, PageDraft>>): TakeoffPageDecision[] {
  return rows.map((row) => {
    const draft = drafts[row.key] ?? initialPageDraft(row);
    const base = { document: row.document, source_page: row.page, earlier_job_ids: row.earlier_job_ids };
    if (draft.decision === "keep_both") {
      return { ...base, decision: "keep_both", reason_code: draft.reason, note: draft.note.trim() || null,
        lines: row.earlier_lines.map((line) => ({ estimate_item_id: line.id, expected_updated_at: line.updated_at, action: "keep" as const,
          take: null, item_ids: line.item_ids })),
        pairs: [] };
    }
    const outcome = pageOutcome(row, draft, { rows, drafts });
    const updated = new Map(outcome.updated.map((line) => [line.id, line]));
    const vanished = new Map(outcome.vanished.map((line) => [line.id, line]));
    return { ...base, decision: "replace", reason_code: null, note: null,
      lines: row.earlier_lines.map((line) => {
        const update = updated.get(line.id);
        return { estimate_item_id: line.id, expected_updated_at: line.updated_at,
          action: update ? "update" as const : line.dpgf_target ? "keep" as const : vanished.get(line.id)?.choice ?? "keep",
          take: update?.changedByHand ? update.take : null, item_ids: line.item_ids };
      }),
      pairs: Object.entries(draft.pairs).flatMap(([takeoffItemId, estimateItemId]) =>
        (estimateItemId ? [{ takeoff_item_id: takeoffItemId, estimate_item_id: estimateItemId }] : [])) };
  });
}

/** The counts the confirmation shows: what the application really does to the earlier lines of these pages. */
export function pageDecisionCounts(rows: readonly TakeoffPageReplacementRow[], drafts: Readonly<Record<string, PageDraft>>) {
  return rows.reduce((counts, row) => {
    const draft = drafts[row.key] ?? initialPageDraft(row);
    if (draft.decision === "keep_both") return { ...counts, keptBoth: counts.keptBoth + 1, added: counts.added + row.new_lines.length };
    const outcome = pageOutcome(row, draft, { rows, drafts });
    return { ...counts, updated: counts.updated + outcome.updated.length, added: counts.added + outcome.added.length,
      removed: counts.removed + outcome.vanished.filter((line) => line.choice === "remove").length,
      kept: counts.kept + outcome.vanished.filter((line) => line.choice === "keep").length };
  }, { updated: 0, added: 0, removed: 0, kept: 0, keptBoth: 0 });
}
