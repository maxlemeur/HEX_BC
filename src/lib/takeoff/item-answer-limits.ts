/**
 * What the publication command of the second measuring order stores (public.publish_takeoff_item_answers, migration
 * 20261122080845_takeoff_item_answers.sql): the reading that admits a request, the worker's re-check before its first paid
 * call and the builder of a publication read these bounds here, so that an admitted reading is always publishable and is
 * never refused whole after its calls were paid. Free of any other module.
 */
export const TAKEOFF_ITEM_ANSWER_LIMITS = {
  /** The reasons of one answer at most (`reasons`). */
  reasons: 32,
  /** The observations of one answer at most (`observations`). */
  observations: 500,
  /** A total, a candidate value or an observation's quantity at most: beyond it, a figure is not a measure. */
  value: 999_999_999.999999,
  /** The findings outside the list of one publication at most (`p_findings`). */
  findings: 2_000,
  /** A row's designation and a warning's message, in characters (code points, as the database counts them). */
  textChars: 500,
} as const;

/** A text cut on whole characters (code points, as the database counts them): an emoji is never cut in two. */
export function takeoffItemAnswerText(value: string, chars: number = TAKEOFF_ITEM_ANSWER_LIMITS.textChars) {
  const characters = Array.from(value);
  return characters.length <= chars ? value : characters.slice(0, chars).join("");
}
