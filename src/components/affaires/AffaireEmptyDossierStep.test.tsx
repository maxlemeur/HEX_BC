import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AffaireEmptyDossierStep } from "@/components/affaires/AffaireEmptyDossierStep";
import { COCKPIT_OPEN_SURFACE_EVENT, type CockpitOpenSurfaceEventDetail } from "@/lib/cockpit/events";

describe("AffaireEmptyDossierStep", () => {
  const surfaces: CockpitOpenSurfaceEventDetail[] = [];
  const record = (event: Event) => surfaces.push((event as CustomEvent<CockpitOpenSurfaceEventDetail>).detail);

  afterEach(() => {
    document.removeEventListener(COCKPIT_OPEN_SURFACE_EVENT, record);
    surfaces.length = 0;
  });

  it("uploads files dropped on the Drive tile instead of letting the browser open them", () => {
    document.addEventListener(COCKPIT_OPEN_SURFACE_EVENT, record);
    render(<AffaireEmptyDossierStep projectId="project-empty" manualEstimateHref="/manual" />);
    const driveTile = screen.getByRole("button", { name: "Choisir dans Drive" }).parentElement!;
    const file = new File(["plan"], "plan.pdf", { type: "application/pdf" });

    const over = createEvent.dragOver(driveTile, { dataTransfer: { files: [file], dropEffect: "none" } });
    fireEvent(driveTile, over);
    const drop = createEvent.drop(driveTile, { dataTransfer: { files: [file] } });
    fireEvent(driveTile, drop);

    expect([over.defaultPrevented, drop.defaultPrevented]).toEqual([true, true]);
    expect(surfaces).toEqual([
      { projectId: "project-empty", actionId: "flow-empty-upload", surfaceId: "intake-upload", files: [file] },
    ]);
  });
});
