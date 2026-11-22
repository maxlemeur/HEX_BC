"use client";

import { MapPin, MapPinPlus } from "lucide-react";

import { useCountMarks } from "@/components/takeoff/count-marks/CountMarksScope";
import { Button } from "@/components/ui/button";

/**
 * The marks' commands in the plan's toolbar (lot 5), reached by Tab after the zoom: « Ajouter un repère » (the pointing
 * mode, for an operator who may correct these marks) and « Repères du poste » (the list, the count and the history).
 */
export const COUNT_MARKS_PANEL_ID = "poste-detail-reperes";

export function CountMarksTools() {
  const marks = useCountMarks();
  if (!marks || marks.status === "none" || marks.status === "refused") return null;
  const adding = marks.mode.kind === "add";
  return (
    <>
      {marks.status === "ready" && marks.canEdit ? (
        <Button size="xs" variant={adding ? "primary" : "outline"} aria-pressed={adding} aria-keyshortcuts="N"
          disabled={Boolean(marks.pointingBlocked) || !marks.planFrame}
          onClick={() => (adding ? marks.cancelMode() : marks.startAdd())}>
          <MapPinPlus className="mr-1 size-4" />Ajouter un repère
        </Button>
      ) : null}
      <Button size="xs" variant="ghost" aria-expanded={marks.panelOpen} aria-controls={COUNT_MARKS_PANEL_ID}
        onClick={() => marks.setPanelOpen(!marks.panelOpen)}>
        <MapPin className="mr-1 size-4" />Repères du poste
      </Button>
    </>
  );
}
