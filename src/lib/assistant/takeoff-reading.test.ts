import { describe, expect, it } from "vitest";

import { takeoffLinesPage } from "@/lib/assistant/takeoff-reading";

const item = (index: number, evidence: string | null) => ({
  id: `item-${index}`, designation: `Tube cuivre ${index}`, quantity: index + 0.5, unit: "m", confidence: 0.9, evidence,
  source_file_name: "plan.pdf", source_page: 1, is_verified: false, is_excluded: false, exclusion_reason: null,
});

describe("takeoff lines read by the assistant", () => {
  it("returns a short page whole, with what is left after it", () => {
    const page = takeoffLinesPage(Array.from({ length: 3 }, (_, index) => item(index, "Relevé sur le plan.")), { total: 10, offset: 4 });
    expect(page.lignes.map((line) => line.id)).toEqual(["item-0", "item-1", "item-2"]);
    expect(page.lignes[0]).toEqual({
      id: "item-0", designation: "Tube cuivre 0", quantite: 0.5, unite: "m", confiance: 0.9, preuve: "Relevé sur le plan.",
      fichier_source: "plan.pdf", page_source: 1, verifiee: false, exclue: false, motif_exclusion: null,
    });
    expect(page).toMatchObject({ lignes_restantes: 3, prochain_offset: 7 });
  });

  it("keeps a page of long evidence under what one tool result may carry, and says where to resume", () => {
    // 100 lines with the longest evidence the takeoff accepts: sent whole they exceed the limit and are all lost.
    const items = Array.from({ length: 100 }, (_, index) => item(index, "é".repeat(2_000)));
    const page = takeoffLinesPage(items, { total: 250, offset: 0 });
    expect(JSON.stringify(page).length).toBeLessThan(110_000);
    expect(page.lignes.length).toBeGreaterThan(20);
    // Evidence is cut and flagged, never dropped silently.
    expect(page.lignes[0]?.preuve?.length).toBeLessThan(700);
    expect(page.lignes[0]).toMatchObject({ preuve_tronquee: true });
    // What was not returned is still to read, from the first line left out.
    expect(page.prochain_offset).toBe(page.lignes.length);
    expect(page.lignes_restantes).toBe(250 - page.lignes.length);
  });

  it("always returns at least one line, and no resume point after the last one", () => {
    const page = takeoffLinesPage([item(0, null)], { total: 1, offset: 0, budget: 10 });
    expect(page.lignes).toHaveLength(1);
    expect(page).toMatchObject({ lignes_restantes: 0, prochain_offset: null });
  });
});
