import type { RevisionChoices, RevisionPreview } from "./contribution-revision-contracts";

export function canKeepBoth(
  block: RevisionPreview["blockers"][number],
  page: NonNullable<typeof block.pages>[number],
  planId: string,
) {
  return (
    !(block.line_id && page.today_estimate_item_ids?.includes(block.line_id)) &&
    !page.parts?.some(
      (part) =>
        part.estimate_item_id === block.line_id && (part.item_id !== block.item_id || part.plan_key !== planId),
    )
  );
}

/** Bind a response to the amounts on a line, or to the contributions on a held page. */
export function revisionQuestions(preview: RevisionPreview): Map<string, string> {
  const questions = new Map<string, string>();
  const pages = new Map<number | null, string[]>();
  for (const b of preview.blockers) {
    if (b.reason === "typed_line" && b.line_id)
      questions.set(b.line_id, JSON.stringify([b.item_id, b.entered, b.retained, b.reference]));
    if (b.reason === "page_held")
      for (const page of b.pages ?? []) {
        const held = pages.get(page.page) ?? [];
        held.push(JSON.stringify([b.line_id, b.item_id, page]));
        pages.set(page.page, held);
      }
  }
  for (const [page, holds] of pages) questions.set(`page:${page}`, JSON.stringify(holds.sort()));
  for (const point of preview.addition_preview?.to_resolve ?? []) {
    questions.set(`add:${point.key}`, JSON.stringify([point.facts, point.earlier_lines, point.held_item_ids]));
  }
  return questions;
}

/** Reapply the member's decisions only to questions that still exist. A held
 * page cannot be kept alongside a contribution already on that line. */
export function reconcileRevisionChoices(
  previous: RevisionChoices,
  fresh: RevisionPreview,
  planId = "",
  seen?: ReadonlyMap<string, string>,
  applied: RevisionChoices = {},
): RevisionChoices {
  const result: RevisionChoices = {};
  const now = revisionQuestions(fresh);
  const sameQuestion = (key: string) => !seen || (seen.has(key) && seen.get(key) === now.get(key));
  const leave = previous.leave_out?.filter((id) => fresh.changes.some((c) => c.item_id === id));
  if (leave?.length) result.leave_out = leave;
  for (const [id, choice] of Object.entries(previous.lines ?? {})) {
    const b = fresh.blockers.find((b) => b.reason === "typed_line" && b.line_id === id);
    if (
      applied.lines?.[id] === choice ||
      (b &&
        sameQuestion(id) &&
        (choice === "use_retained" || b.reference == null || (b.entered ?? 0) >= (b.retained ?? 0)))
    )
      (result.lines ??= {})[id] = choice;
  }
  const pages = previous.page_decisions?.filter(
    (d) =>
      applied.page_decisions?.some((p) => p.page === d.page) ||
      (sameQuestion(`page:${d.page}`) &&
        fresh.blockers.some(
          (b) => b.reason === "page_held" && b.pages?.some((p) => p.page === d.page && canKeepBoth(b, p, planId)),
        )),
  );
  if (pages?.length) result.page_decisions = pages;
  const add = previous.additions;
  if (add && fresh.additions.length) {
    const points = fresh.addition_preview?.to_resolve ?? [];
    result.additions = {
      ...add,
      resolutions: add.resolutions?.filter(
        (r) =>
          applied.additions?.resolutions?.some((a) => a.key === r.key) ||
          (sameQuestion(`add:${r.key}`) &&
            points.some(
              (p) =>
                p.key === r.key &&
                ((p.kind === "page_decision" && r.choice.kind === "leave_out") ||
                  p.options.some(
                    (o) =>
                      o.kind === r.choice.kind &&
                      (o.kind !== "line" ||
                        (r.choice.kind === "line" && o.estimate_item_id === r.choice.estimate_item_id)),
                  )),
            )),
      ),
      page_decisions: add.page_decisions?.filter(
        (d) =>
          applied.additions?.page_decisions?.some((p) => p.page === d.page) ||
          points.some((p) => p.kind === "page_decision" && p.page === d.page && sameQuestion(`add:${p.key}`)),
      ),
    };
  }
  return result;
}
