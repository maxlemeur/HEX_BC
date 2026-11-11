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
  updated: Array<{ id: string; title: string; before: number | null; after: number; changedByHand: boolean; take: "new" | "keep_mine" | null;
    newLineIds: string[] }>;
  added: string[];
  vanished: Array<{ id: string; title: string; quantity: number | null; choice: "remove" | "keep" | null;
    /** It also carries other pages: it is kept, never removed (its other pages would go with it). */
    otherPages: boolean }>;
  dpgfTargets: string[];
};

/** What a page's draft does: the earlier lines updated (before → after), the new lines added, the lines that vanished. */
export function pageOutcome(row: TakeoffPageReplacementRow, draft: PageDraft): PageOutcome {
  const pairedBy = new Map<string, string[]>();
  for (const [newLineId, estimateItemId] of Object.entries(draft.pairs)) {
    if (estimateItemId) pairedBy.set(estimateItemId, [...(pairedBy.get(estimateItemId) ?? []), newLineId]);
  }
  const quantities = new Map(row.new_lines.map((line) => [line.id, line.quantity]));
  const outcome: PageOutcome = { updated: [], added: [], vanished: [], dpgfTargets: [] };
  for (const line of row.earlier_lines) {
    if (line.dpgf_target) {
      outcome.dpgfTargets.push(line.id);
      continue;
    }
    const newLineIds = pairedBy.get(line.id) ?? [];
    if (newLineIds.length === 0) {
      const choice = draft.choices[line.id] ?? null;
      outcome.vanished.push({ id: line.id, title: line.title, quantity: line.quantity, otherPages: line.other_pages,
        choice: choice === "remove" && line.other_pages ? null : choice });
      continue;
    }
    const next = replacementQuantities({ quantity: line.quantity, factor: line.length_factor,
      sources: line.sources, removedSourceIds: new Set(line.item_ids), added: newLineIds.map((id) => ({ quantity: quantities.get(id) ?? 0 })) });
    const take = draft.takes[line.id] ?? null;
    outcome.updated.push({ id: line.id, title: line.title, before: line.quantity, after: line.changed_by_hand && take === "keep_mine"
      ? line.quantity ?? 0 : next.next, changedByHand: line.changed_by_hand, take, newLineIds });
  }
  outcome.added = row.new_lines.filter((line) => !draft.pairs[line.id]).map((line) => line.id);
  return outcome;
}

/** What still waits for the estimator on a page: nothing when its decision can be sent. */
export function pageMissing(row: TakeoffPageReplacementRow, draft: PageDraft): string[] {
  if (draft.decision === "keep_both") {
    if (row.keep_both_refused) return ["Garder les deux n’est pas possible sur cette page."];
    if (!draft.reason) return ["Choisissez le motif pour garder les deux mesures."];
    if (draft.reason === "complementary_scope" && draft.note.trim().length < TAKEOFF_PAGE_NOTE_MIN) {
      return ["Décrivez le périmètre complémentaire (10 caractères au moins)."];
    }
    return [];
  }
  const outcome = pageOutcome(row, draft);
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
    const outcome = pageOutcome(row, draft);
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
    const outcome = pageOutcome(row, draft);
    return { ...counts, updated: counts.updated + outcome.updated.length, added: counts.added + outcome.added.length,
      removed: counts.removed + outcome.vanished.filter((line) => line.choice === "remove").length,
      kept: counts.kept + outcome.vanished.filter((line) => line.choice === "keep").length };
  }, { updated: 0, added: 0, removed: 0, kept: 0, keptBoth: 0 });
}
