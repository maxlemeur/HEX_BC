import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Follow-ups of lot 5, written before the fix: the browser's back from an item's detail gave the keyboard to the line
// its address named (`posteFocus`, from an earlier return), not to the line whose « Détail » opened it. Fictional ids.

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }), usePathname: () => "/dashboard/affaires/p/takeoff" }));

import {
  forgetItemDetailOpener,
  ItemDetailOpenerFocus,
  rememberItemDetailOpener,
  takeItemDetailOpener,
} from "@/components/takeoff/item-detail/ItemDetailOpenerFocus";

const PROJECT = "e0000000-0000-4000-8000-000000000001";
const NAMED = "b0000000-0000-4000-8000-000000000003";
const OPENER = "b0000000-0000-4000-8000-000000000002";
const TABLE = `posteLimit=25&posteFocus=${NAMED}`;

/** The table's lines as it draws them: each with its « Détail ». */
function drawLines(ids: string[]) {
  const table = document.createElement("table");
  for (const id of ids) {
    const row = table.insertRow();
    row.id = `poste-ligne-${id}`;
    const link = document.createElement("a");
    link.href = "#";
    link.setAttribute("data-poste-detail-link", "");
    link.textContent = "Détail";
    row.insertCell().append(link);
  }
  document.body.append(table);
  return (id: string) => document.querySelector<HTMLElement>(`#poste-ligne-${id} [data-poste-detail-link]`)!;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", `/dashboard/affaires/p/takeoff?${TABLE}`);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("the line a detail was opened from", () => {
  it("gets the keyboard back on the browser's back, over the line the address named, and the address names it", () => {
    // The detail was opened from the opener's line on this very address.
    rememberItemDetailOpener(PROJECT, `poste=${OPENER}&plan=x&lecture=y&${TABLE}`, OPENER);
    const link = drawLines([NAMED, OPENER]);
    // The table gave the keyboard to the line its address named.
    link(NAMED).focus();
    render(<ItemDetailOpenerFocus projectId={PROJECT} />);
    expect(document.activeElement).toBe(link(OPENER));
    expect(replace).toHaveBeenCalledWith(`/dashboard/affaires/p/takeoff?posteLimit=25&posteFocus=${OPENER}`, { scroll: false });
    expect(takeItemDetailOpener(PROJECT, TABLE)).toBeNull();
  });

  it("waits for the line to be drawn, whichever comes first, the table's focus or the line", async () => {
    rememberItemDetailOpener(PROJECT, TABLE, OPENER);
    render(<ItemDetailOpenerFocus projectId={PROJECT} />);
    expect(replace).not.toHaveBeenCalled();
    let link: (id: string) => HTMLElement = () => document.body;
    await act(async () => {
      link = drawLines([NAMED, OPENER]);
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(link(OPENER));
    // The table's own focus after that does not take it back (it gives the keyboard only when nothing holds it).
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("leaves a focus the member gave elsewhere, and only names the opener", () => {
    rememberItemDetailOpener(PROJECT, TABLE, OPENER);
    drawLines([NAMED, OPENER]);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    render(<ItemDetailOpenerFocus projectId={PROJECT} />);
    expect(document.activeElement).toBe(field);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("does nothing for another address of the table, nor after « Revenir aux postes », which forgets it", () => {
    rememberItemDetailOpener(PROJECT, "posteLimit=50", OPENER);
    const link = drawLines([NAMED, OPENER]);
    link(NAMED).focus();
    render(<ItemDetailOpenerFocus projectId={PROJECT} />);
    expect(document.activeElement).toBe(link(NAMED));
    cleanup();
    rememberItemDetailOpener(PROJECT, TABLE, OPENER);
    forgetItemDetailOpener(PROJECT);
    render(<ItemDetailOpenerFocus projectId={PROJECT} />);
    expect(document.activeElement).toBe(link(NAMED));
    expect(replace).not.toHaveBeenCalled();
  });
});
