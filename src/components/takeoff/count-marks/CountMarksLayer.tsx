"use client";

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";

import { countMarkOriginLabel } from "@/lib/takeoff/count-marks-view";
import { useCountMarks } from "@/components/takeoff/count-marks/CountMarksScope";
import type { ItemDetailPageFrame } from "@/components/takeoff/item-detail/ItemDetailPlanPane";
import {
  COUNT_MARK_SHOWN_STATE_LABELS,
  COUNT_MARKS_PLAN_KEYS_HELP,
  countMarksListKey,
  inCountRegion,
  isDrawnCountMark,
  nudgeCountPoint,
  visibleCountRegion,
  type CountMarkShown,
} from "@/lib/takeoff/count-marks-view";
import { isItemDetailFieldTarget } from "@/lib/takeoff/item-detail-keys";
import { cn } from "@/lib/utils";

/**
 * The counted marks of the answer shown, over its plan's page (lot 5): each mark at its place, whatever the zoom and the
 * pan (a share of the visible page, in the page's own frame), told apart by state by its shape and its sign, not by its
 * colour alone. Only the marks of the part of the page the frame shows are drawn; the list beside is the accessible way
 * to every mark. With the focus on the plan, the keys of the list apply; in a pointing mode a cross is moved one point
 * of the page per arrow (ten with Shift), Enter places it, Escape leaves. A click places it too, a drag pans the page.
 */

/** Marks drawn at most at once: beyond, the member zooms in (the count and the list do not depend on it). */
const DRAWN_AT_MOST = 2_000;
/** A press that moved more than this, in pixels, was a pan, not a click. */
const CLICK_SLOP = 4;

const SIGNS: Record<CountMarkShown["state"], string> = {
  proposed: "?", to_attribute: "!", retained: "✓", pending: "N", removed: "", withdrawn: "",
};

function markClass(mark: CountMarkShown, active: boolean, claimed: boolean) {
  return cn(
    "pointer-events-auto absolute flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center text-[10px] font-bold leading-none shadow-sm",
    mark.state === "retained" && "rounded-full border-2 border-success bg-success text-white",
    mark.state === "proposed" && "rounded-full border-2 border-dashed border-warning bg-white/90 text-foreground",
    mark.state === "to_attribute" && "rounded-sm border-2 border-dashed border-danger bg-white/90 text-danger",
    mark.state === "pending" && "rounded-full border-2 border-dotted border-primary bg-white/90 text-primary",
    claimed && "outline outline-2 outline-offset-1 outline-foreground-secondary",
    mark.unsaved && "ring-2 ring-primary ring-offset-1",
    active && "z-10 size-5 ring-2 ring-foreground ring-offset-2",
  );
}

export function CountMarksLayer({ frame }: { frame: ItemDetailPageFrame }) {
  const marks = useCountMarks();
  const helpId = useId();
  const layer = useRef<HTMLDivElement>(null);
  const press = useRef<{ x: number; y: number } | null>(null);
  const setPlanFrame = marks?.setPlanFrame;

  // The scope knows the page drawn: its size and geometry, the part of it the frame shows, and how to centre a mark.
  const shownRegion = visibleCountRegion({ frame: frame.frame, offset: frame.offset, scale: frame.scale, size: frame.size });
  const [rx0, ry0, rx1, ry1] = shownRegion ? [shownRegion.x0, shownRegion.y0, shownRegion.x1, shownRegion.y1] : [0, 0, 0, 0];
  const hasRegion = shownRegion !== null;
  useEffect(() => {
    setPlanFrame?.({ page: frame.page, size: frame.size, geometry: frame.geometry, centre: frame.centre,
      visible: hasRegion ? { x0: rx0, y0: ry0, x1: rx1, y1: ry1 } : null, painted: frame.painted });
  }, [frame.centre, frame.geometry, frame.page, frame.painted, frame.size, hasRegion, rx0, rx1, ry0, ry1, setPlanFrame]);
  // A pointing mode takes the keyboard on the plan, wherever it was started from (the toolbar, the list).
  const pointing = marks?.mode.kind !== undefined && marks.mode.kind !== "idle";
  useEffect(() => {
    if (pointing) layer.current?.focus({ preventScroll: true });
  }, [pointing]);
  useEffect(() => () => setPlanFrame?.(null), [setPlanFrame]);

  if (!marks || marks.status !== "ready") return null;
  const { shown, mode, activeId, loaded, itemLabels } = marks;
  const width = frame.size.width * frame.scale;
  const height = frame.size.height * frame.scale;
  const region = shownRegion;
  // A small margin: a mark half out of the frame is still drawn.
  const margin = region ? { x0: region.x0 - 0.01, y0: region.y0 - 0.01, x1: region.x1 + 0.01, y1: region.y1 + 0.01 } : null;
  const visible = margin ? shown.filter((mark) => isDrawnCountMark(mark) && inCountRegion(mark, margin)) : [];
  const drawn = visible.slice(0, DRAWN_AT_MOST);
  const total = loaded?.view.total ?? 0;

  const pointAt = (event: ReactMouseEvent) => {
    const box = layer.current?.getBoundingClientRect();
    if (!box || !(box.width > 0) || !(box.height > 0)) return null;
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
  };

  const onClick = (event: ReactMouseEvent) => {
    const start = press.current;
    press.current = null;
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_SLOP) return;
    if (mode.kind === "idle") return;
    const point = pointAt(event);
    if (point) marks.place(point);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && isItemDetailFieldTarget(event.target)) return;
    if (mode.kind !== "idle") {
      if (event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        marks.cancelMode();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        marks.place();
        return;
      }
      const next = nudgeCountPoint(mode.point, event, frame.size);
      if (next) {
        event.preventDefault();
        marks.movePointer(next);
        frame.centre(next);
      }
      return;
    }
    const action = countMarksListKey({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey,
      shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing }, false);
    if (!action) return;
    event.preventDefault();
    switch (action.kind) {
      case "step": marks.step(action.step); break;
      case "edge": marks.step(action.to); break;
      case "retain": marks.decide("retain"); break;
      case "restore": marks.decide("restore"); break;
      case "remove": marks.openDialog("remove"); break;
      case "reattribute": marks.openDialog("reattribute"); break;
      case "move": marks.startMove(); break;
      case "add": marks.startAdd(); break;
      case "verify": marks.verifyPage(); break;
    }
  };

  const label = `Repères sur le plan, page ${frame.page} : ${drawn.length} dessinés dans la zone visible, `
    + `${loaded?.marks.length ?? 0} chargés, ${total} au total`;
  return (
    <div ref={layer} role="group" tabIndex={0} aria-label={label} aria-describedby={helpId} data-testid="reperes-calque"
      data-drawn={drawn.length} data-mode={mode.kind}
      className={cn("absolute left-0 top-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        mode.kind !== "idle" && "cursor-crosshair")}
      style={{ width, height }}
      onPointerDown={(event) => { press.current = { x: event.clientX, y: event.clientY }; }}
      onClick={onClick} onKeyDown={onKeyDown}>
      <p id={helpId} className="sr-only">{COUNT_MARKS_PLAN_KEYS_HELP}</p>
      {drawn.map((mark) => {
        const claimed = (mark.mark?.others ?? []).filter((other) => other.state === "retained");
        const claim = claimed.length ? ` · retenu aussi pour ${claimed.map((other) => `« ${itemLabels[other.itemId] ?? "un autre poste"} »`).join(", ")}` : "";
        const origin = mark.mark && loaded ? countMarkOriginLabel(mark.mark, loaded.view.names, loaded.view.viewerId) : null;
        return (
          <span key={mark.markId} data-testid="repere" data-mark={mark.markId} data-state={mark.state} data-unsaved={String(mark.unsaved)}
            data-claimed={String(claimed.length > 0)} aria-hidden="true"
            title={`${COUNT_MARK_SHOWN_STATE_LABELS[mark.state]}${mark.unsaved ? " (non enregistré)" : ""}${claim}${origin ? " · " + origin : ""}`}
            className={markClass(mark, mark.markId === activeId, claimed.length > 0)}
            style={{ left: `${mark.x * 100}%`, top: `${mark.y * 100}%` }}
            onClick={(event) => {
              if (mode.kind !== "idle") return;
              event.stopPropagation();
              marks.select(mark.markId, { centre: false });
              layer.current?.focus({ preventScroll: true });
            }}>
            {SIGNS[mark.state]}
          </span>
        );
      })}
      {mode.kind !== "idle" ? (
        <span data-testid="reperes-reticule" aria-hidden="true"
          className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary"
          style={{ left: `${mode.point.x * 100}%`, top: `${mode.point.y * 100}%` }}>
          <span className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-primary" />
          <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-primary" />
        </span>
      ) : null}
      {visible.length > drawn.length ? (
        <p className="pointer-events-none absolute left-2 top-2 rounded bg-surface/90 px-2 py-1 text-xs text-foreground-secondary">
          {visible.length} repères dans la zone : zoomez pour les voir tous.
        </p>
      ) : null}
    </div>
  );
}
