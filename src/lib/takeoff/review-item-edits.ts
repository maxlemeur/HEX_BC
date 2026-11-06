import { ruleFailuresReopen } from "@/lib/takeoff/rules/failure-keys";
import type { TakeoffItemPatchField, TakeoffJobItem } from "@/lib/takeoff/types";

export type ReviewItem = TakeoffJobItem & {
  _dirty: boolean;
  _saving: boolean;
  _error: string | null;
  _original?: TakeoffJobItem;
  _verification?: { value: boolean };
};

const CONTENT = ["designation", "quantity", "unit", "source_page", "is_excluded", "exclusion_reason", "evidence"] as const;
type ContentKey = typeof CONTENT[number];

function difference(before: TakeoffJobItem, after: TakeoffJobItem): TakeoffItemPatchField {
  const fields: TakeoffItemPatchField = {};
  for (const key of CONTENT) {
    if (before[key] !== after[key]) Object.assign(fields, { [key]: after[key] });
  }
  return fields;
}

export function reviewPatch(item: ReviewItem): TakeoffItemPatchField {
  const fields = difference(item._original ?? item, item);
  if (fields.is_excluded === true) fields.exclusion_reason = item.exclusion_reason;
  if (item._verification !== undefined) fields.is_verified = item._verification.value;
  return fields;
}

/** Only an explicit verification control can send a signature. Reverting the whole edit before autosave restores the stored state. */
export function editReviewItem(item: ReviewItem, changes: Partial<Pick<TakeoffJobItem, ContentKey | "is_verified">>): ReviewItem {
  const original = item._original ?? item;
  const next = { ...item, ...changes };
  const contentEdited = CONTENT.some((key) => item[key] !== next[key]);
  if (!contentEdited && (changes.is_verified === undefined || changes.is_verified === item.is_verified)) return item;
  const contentDirty = CONTENT.some((key) => original[key] !== next[key]);
  // A content edit cancels a positive V, never a withdrawal. Each explicit V gets its own
  // identity so a second V on changed content survives the response to the first.
  const intent = changes.is_verified !== undefined ? { value: changes.is_verified }
    : item._verification?.value === false ? item._verification : undefined;
  const verified = intent?.value ?? (!contentDirty && original.is_verified);
  const dirty = contentDirty || (intent !== undefined && intent.value !== original.is_verified);
  const verification = dirty || item._saving ? intent : undefined;
  return { ...next, is_verified: verified, verified_at: verified ? original.verified_at : null,
    verified_by: verified ? original.verified_by : null, _original: dirty ? original : undefined,
    _verification: verification, _dirty: dirty, _error: null };
}

/** An edit made during an earlier save is still pending, based on the server's new revision. */
export function afterReviewSave(saved: TakeoffJobItem, submitted: ReviewItem | undefined, current: ReviewItem): ReviewItem {
  const clean = { ...saved, _dirty: false, _saving: false, _error: null };
  if (!submitted) return clean;
  const later = difference(submitted, current);
  if (current._verification && current._verification !== submitted._verification) {
    // The user can withdraw a verification at any time. A positive decision only covers
    // the content and failures they saw, not an unseen cherry-pick or a newly blocked partner.
    if (!current._verification.value || (!saved.rules_stale && !Object.keys(difference(submitted, saved)).length
      && !ruleFailuresReopen(submitted.rule_results, saved.rule_results))) later.is_verified = current._verification.value;
  }
  return editReviewItem(clean, later);
}
