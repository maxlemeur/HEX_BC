import type { ItemDetailGesture } from "@/lib/takeoff/item-detail";

/**
 * The keyboard of the list of items in the detail (lot 5, first row of its specification's table): ↑/↓ the previous or
 * next item in the frozen filtered order, Enter the evidence, Escape back to the table; V accepts, E asks for the reason
 * to set aside, I asks for the individual inclusion, F2 or a digit opens the entry (the digit as its first character).
 * No key forces, sends or spends: a new measure, a send or a forced acceptance has no shortcut.
 *
 * A key typed in a field, during a composition, or with Ctrl, ⌘, Alt or Shift (but a digit) belongs to the browser or to
 * the field.
 */

export type ItemDetailKeyGesture = Extract<ItemDetailGesture, "accept_measured" | "set_aside" | "include_entry" | "enter_quantity">;

export type ItemDetailKeyAction =
  | { kind: "move"; step: -1 | 1 }
  | { kind: "evidence" }
  | { kind: "back" }
  | { kind: "gesture"; gesture: ItemDetailKeyGesture; initial: string | null };

export type ItemDetailKeyEvent = {
  key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean; isComposing?: boolean;
};

export function itemDetailKeyAction(event: ItemDetailKeyEvent, inField: boolean): ItemDetailKeyAction | null {
  // « Process »: a key an input method is composing with (Chrome, Safari).
  if (inField || event.isComposing || event.key === "Process" || event.ctrlKey || event.metaKey || event.altKey) return null;
  // Shift belongs to the browser and to selection, except for a digit: on a French keyboard a digit is typed with it.
  if (event.shiftKey && !/^[0-9]$/.test(event.key)) return null;
  switch (event.key) {
    case "ArrowUp": return { kind: "move", step: -1 };
    case "ArrowDown": return { kind: "move", step: 1 };
    case "Enter": return { kind: "evidence" };
    case "Escape": return { kind: "back" };
    case "F2": return { kind: "gesture", gesture: "enter_quantity", initial: null };
    default: break;
  }
  if (/^[0-9]$/.test(event.key)) return { kind: "gesture", gesture: "enter_quantity", initial: event.key };
  switch (event.key.toLowerCase()) {
    case "v": return { kind: "gesture", gesture: "accept_measured", initial: null };
    case "e": return { kind: "gesture", gesture: "set_aside", initial: null };
    case "i": return { kind: "gesture", gesture: "include_entry", initial: null };
    default: return null;
  }
}

/** Whether a key lands in a field of its own (an input, a menu, an editable text): the list's keys do not apply there. */
export function isItemDetailFieldTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as { closest?: unknown }).closest !== "function") return false;
  const element = target as HTMLElement;
  return element.isContentEditable === true
    || element.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog'], [role='menu']") !== null;
}
