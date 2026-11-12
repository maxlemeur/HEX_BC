import type { ReactNode } from "react";

/** `aria-describedby` value from a field's hint ids and, after them, its error id while invalid. */
export function describedByIds(...ids: Array<string | false | null | undefined>) {
  return ids.filter(Boolean).join(" ") || undefined;
}

/**
 * Reason of a refused draft for screen readers, in dense cells whose layout stays unchanged: the
 * cell shows its red border and the same text in its `title`. Render it only while the field is
 * invalid, and list `id` in the field's `aria-describedby` at the same time, so the reason is read
 * with the field.
 *
 * `refusedDraft` is the value refused when the user left the field, or `null` while they type.
 * Each new refusal mounts the reason again as an alert, so it is announced once although focus
 * has moved on; leaving the same refused value again, or typing, announces nothing.
 */
export function InvalidDraftReason({
  id,
  refusedDraft,
  children,
}: {
  id: string;
  refusedDraft: string | null;
  children: ReactNode;
}) {
  const refused = refusedDraft !== null;
  return (
    <span
      key={refused ? `refused:${refusedDraft}` : "draft"}
      id={id}
      className="sr-only"
      role={refused ? "alert" : undefined}
    >
      {children}
    </span>
  );
}
