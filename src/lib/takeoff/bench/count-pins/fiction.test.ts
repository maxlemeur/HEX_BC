import { expect, it } from "vitest";
import { extractVectorPage } from "../../vectors/extraction";
import { distance } from "./types";
import { fictionalSheets } from "./fiction";
import { readDeterministic } from "./propose";
import { indexSymbolPage } from "./symbols";

it("reads installed pipe labels and abstains on ambiguous connections in a fictional PDF", async () => {
  const fixture = (await fictionalSheets())[2];
  const extraction = await extractVectorPage(fixture.bytes, fixture.page);
  const index = indexSymbolPage(extraction);
  const pins = readDeterministic({
    id: fixture.id, generation: "fiction", extraction,
    examples: fixture.examples.map((example) => ({ organ: example.organ, paths: index.inside(example.box) })),
  }).pipe;
  for (const scenario of ["plain run", "tee", "crossing", "reducer", "different branches"]) {
    const instance = fixture.truth.find((pin) => pin.scenario === scenario)!;
    const pin = pins.find((point) => distance(point, instance) < 1);
    expect(pin?.dn, scenario).toBe(scenario === "plain run" ? "DN 20" : null);
  }
});

it("generates real CropBox, UserUnit, rotation, raster-only and empty PDF pages", async () => {
  const sheets = await fictionalSheets();
  expect(sheets.map((fixture) => fixture.rotation)).toEqual([0, 0, 0, 90, 180, 270, 90]);
  const selected = sheets.filter((fixture) => fixture.rotation || fixture.page === 2);
  const extracted = await Promise.all(selected.map(async (fixture) => ({
    fixture, extraction: await extractVectorPage(fixture.bytes, fixture.page),
  })));
  for (const { fixture, extraction } of extracted) {
    expect(extraction).toMatchObject({ ...fixture.size, rotate: fixture.rotation, userUnit: fixture.userUnit });
    if (fixture.support === "raster") {
      expect(extraction.counts.imageCoverage).toBeCloseTo(1);
      expect(extraction.paths).toHaveLength(0);
      expect(extraction.texts).toHaveLength(0);
    } else if (!fixture.truth.length) {
      expect(extraction.page).toBe(2);
      expect(extraction.paths).toHaveLength(0);
    } else {
      const index = indexSymbolPage(extraction);
      const example = fixture.examples[0];
      const matched = index.match(index.inside(example.box));
      expect(matched.some((pin) => distance(pin, fixture.truth[example.truthIndex]) < 0.2)).toBe(true);
    }
  }
}, 15_000);

it("keeps installed occurrences and excludes samples next to legend and repeated-detail headings on turned sheets", async () => {
  const sheets = await fictionalSheets();
  for (const sheet of sheets.filter((s) => s.support === "vector" && s.truth.length)) {
    const extraction = await extractVectorPage(sheet.bytes, sheet.page);
    const reader = readDeterministic({ id: sheet.id, generation: "fixture", extraction, examples: [] });
    for (const zone of Object.values(sheet.negativeZones)) {
      const sample = { x: (zone.x0 + zone.x1) / 2, y: (zone.y0 + zone.y1) / 2 };
      expect(reader.onInstallation(sample)).toBe(false);
    }
    expect(sheet.truth.every(reader.onInstallation)).toBe(true);
  }
}, 15_000);
