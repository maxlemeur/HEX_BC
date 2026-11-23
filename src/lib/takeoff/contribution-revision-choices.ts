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

/** Reapply the member's decisions only to questions that still exist. A held
 * page cannot be kept alongside a contribution already on that line. */
export function reconcileRevisionChoices(
  previous: RevisionChoices,
  fresh: RevisionPreview,
  planId = "",
): RevisionChoices {
  const result: RevisionChoices = {};
  const leave = previous.leave_out?.filter((id) => fresh.changes.some((c) => c.item_id === id));
  if (leave?.length) result.leave_out = leave;
  for (const [id, choice] of Object.entries(previous.lines ?? {})) {
    const b = fresh.blockers.find((b) => b.reason === "typed_line" && b.line_id === id);
    if (b && (choice === "use_retained" || b.reference == null || (b.entered ?? 0) >= (b.retained ?? 0)))
      (result.lines ??= {})[id] = choice;
  }
  const pages = previous.page_decisions?.filter((d) =>
    fresh.blockers.some(
      (b) => b.reason === "page_held" && b.pages?.some((p) => p.page === d.page && canKeepBoth(b, p, planId)),
    ),
  );
  if (pages?.length) result.page_decisions = pages;
  const add = previous.additions;
  if (add && fresh.additions.length) {
    const points = fresh.addition_preview?.to_resolve ?? [];
    result.additions = {
      ...add,
      resolutions: add.resolutions?.filter((r) =>
        points.some(
          (p) =>
            p.key === r.key &&
            p.options.some(
              (o) =>
                o.kind === r.choice.kind &&
                (o.kind !== "line" ||
                  (r.choice.kind === "line" && o.estimate_item_id === r.choice.estimate_item_id)),
            ),
        ),
      ),
      page_decisions: add.page_decisions?.filter((d) =>
        points.some((p) => p.kind === "page_decision" && p.page === d.page),
      ),
    };
  }
  return result;
}
