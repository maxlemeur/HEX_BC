import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { CAD_CAP_HEIGHT, cadLineWidth, cadWrap } from "@/lib/cad/text-layout";

// Fictional notes only. A paragraph (MTEXT) is drawn in a rectangle of a given
// width: its lines break at the spaces so that none runs past that width.

const NOTES = [
  "Evacuation des eaux usées vers la colonne EU 100",
  "Chute EU DN 100 en fonte, pente 2 cm par mètre",
  "ALIMENTATION EF - PER 16x1,5 SOUS FOURREAU",
  "Sdb 4,32 m² - NGF 34.50",
  "Vanne d'isolement 1/4 de tour, PN 16, accessible en gaine technique",
];

describe("cadLineWidth", () => {
  it("is close to the width of the font the plan is plotted with", async () => {
    const font = (await PDFDocument.create()).embedStandardFont(StandardFonts.Helvetica);
    for (const note of NOTES) {
      const plotted = font.widthOfTextAtSize(note, 1) / CAD_CAP_HEIGHT;
      expect(cadLineWidth(note) / plotted, note).toBeGreaterThan(0.9);
      expect(cadLineWidth(note) / plotted, note).toBeLessThan(1.1);
    }
    expect(cadLineWidth("")).toBe(0);
  });
});

describe("cadWrap", () => {
  it("breaks a line at the spaces so that no line is wider than the rectangle", () => {
    for (const note of NOTES) {
      for (const width of [8, 12, 20, 35]) {
        const lines = cadWrap(note, width).split("\n");
        expect(lines.join(" "), note).toBe(note);
        // A note that fits stays on its line: it breaks only when it is wider than the rectangle.
        expect(lines.length > 1, note).toBe(cadLineWidth(note) > width);
        lines.forEach((line, index) => {
          if (line.includes(" ")) expect(cadLineWidth(line), line).toBeLessThanOrEqual(width);
          // Greedy: the first word of the next line would not have fitted on this one.
          if (index + 1 < lines.length) expect(cadLineWidth(`${line} ${lines[index + 1].split(" ")[0]}`), line).toBeGreaterThan(width);
        });
      }
    }
  });

  it("puts each word on its own line in a rectangle narrower than two words, and leaves a long word whole", () => {
    expect(cadWrap("Evacuation des eaux usées vers la colonne EU 100", 3)).toBe("Evacuation\ndes\neaux\nusées\nvers\nla\ncolonne\nEU\n100");
    expect(cadWrap("Anticonstitutionnellement", 3)).toBe("Anticonstitutionnellement");
  });

  it("keeps the line breaks the paragraph already has, and wraps each of its lines on its own", () => {
    expect(cadWrap("AAAA AAAA AAAA\nAAAA\nAAAA AAAA AAAA AAAA", 9)).toBe("AAAA AAAA\nAAAA\nAAAA\nAAAA AAAA\nAAAA AAAA");
  });

  it("leaves alone a line that fits, spaces included, and a paragraph without a rectangle", () => {
    expect(cadWrap("DN  100   EU", 300)).toBe("DN  100   EU");
    for (const width of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) expect(cadWrap("AAAA AAAA AAAA", width)).toBe("AAAA AAAA AAAA");
  });

  it("drops the spaces a break falls on", () => {
    expect(cadWrap("AAAA AAAA   AAAA AAAA", 9)).toBe("AAAA AAAA\nAAAA AAAA");
  });

  it("wraps a very long run of spaces and words in a time that grows with its length", () => {
    const long = `A${" ".repeat(400_000)}${"AAAA ".repeat(100_000)}`;
    const started = performance.now(), lines = cadWrap(long, 9).split("\n");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(lines[0]).toBe("A");
    expect(lines.slice(1, -1).every((line) => line === "AAAA AAAA")).toBe(true);
  });
});
