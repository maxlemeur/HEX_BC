"use client";

/** Keep grid focus handling from replacing the trigger during its first click.
 * Return a native button so Popover can attach its ref and interaction props.
 */
export function renderLineDetailsTrigger(title: string) {
  return <button className="estimate-line-more__trigger" type="button"
    aria-label={`Details de la ligne ${title || "sans titre"}`} title="Details de la ligne"
    data-testid="estimate-line-more-trigger"
    onMouseDown={event => event.stopPropagation()} onFocus={event => event.stopPropagation()}>
    …
  </button>;
}
