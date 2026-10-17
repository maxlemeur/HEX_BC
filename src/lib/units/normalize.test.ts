// Lot 2, sous-lot 2.4 (piste B) : normaliseur d'unités partagé TS/SQL (D9, P-08, P-09).
// Défaillances visées : docs/testing/estimate-engine-v3-2.4.md (U1 à U9).
// Les 40 vecteurs sont repris à l'identique dans supabase/tests/database/measurement-units.test.sql :
// le même jeton et la même cible doivent sortir des deux langages ; le premier test relit le bloc
// pgTAP et le compare à cette liste (U3).
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildUnitsReferential,
  checkUnitsSqlBlocks,
} from "../../../scripts/units/generate-units-sql";
import {
  MEASUREMENT_UNITS,
  measurementUnitToken,
  normalizeMeasurementUnit,
} from "@/lib/units/normalize";
import unitsSource from "@/lib/units/units.json";

type Vector = readonly [
  raw: string,
  token: string,
  unitCode: string | null,
  pricingStatus: string | null,
];

const VECTORS: readonly Vector[] = [
  ["ML", "ml", "ml", null],
  ["ml", "ml", "ml", null],
  ["mL", "ml", "ml", null],
  ["m.l.", "ml", "ml", null],
  ["mètre linéaire", "metrelineaire", "ml", null],
  ["m", "m", "ml", null],
  ["  Ml  ", "ml", "ml", null],
  ["m l", "ml", "ml", null],
  ["m-l", "ml", "ml", null],
  ["métres linéaires", "metreslineaires", "ml", null],
  ["ＭＬ", "ml", "ml", null],
  ["m²", "m2", "m2", null],
  ["M2", "m2", "m2", null],
  ["m 2", "m2", "m2", null],
  ["Mètre carré", "metrecarre", "m2", null],
  ["m³", "m3", "m3", null],
  ["M3", "m3", "m3", null],
  ["U", "u", "u", null],
  ["unité", "unite", "u", null],
  ["Pce", "pce", "u", null],
  ["ENS", "ens", "ens", null],
  ["Ensemble", "ensemble", "ens", null],
  ["Fft", "fft", "fft", null],
  ["forfait", "forfait", "fft", null],
  ["KG", "kg", "kg", null],
  ["Tonne", "tonne", "t", null],
  ["h", "h", "h", null],
  ["Jours", "jours", "j", null],
  ["\"", "\"", "pouce", null],
  ["Pouces", "pouces", "pouce", null],
  ["HL", "hl", null, "out_of_scope"],
  ["h.l.", "hl", null, "out_of_scope"],
  ["PM", "pm", null, "for_memory"],
  ["NC", "nc", null, "not_priced"],
  ["Inc.", "inc", null, "included"],
  ["incl", "incl", null, "included"],
  ["CP", "cp", null, "included"],
  ["SO", "so", null, "not_applicable"],
  ["millilitre", "millilitre", null, null],
  ["", "", null, null],
];

const SQL_LITERAL = String.raw`(null|U&'(?:[^']|'')*'|'(?:[^']|'')*')`;
const PGTAP_VECTOR_ROW = new RegExp(
  String.raw`^\s*\((\d+), ${SQL_LITERAL}, ${SQL_LITERAL}, ${SQL_LITERAL}, ${SQL_LITERAL}\)[,;]$`
);

/** Littéral SQL décodé : chaîne standard ('' doublé) ou chaîne Unicode U&'…' (\XXXX, \+XXXXXX, \\). */
function decodeSqlLiteral(literal: string): string | null {
  if (literal === "null") return null;
  const unicode = literal.startsWith("U&");
  const body = literal.slice(unicode ? 3 : 1, -1).replace(/''/g, "'");
  if (!unicode) return body;
  return body.replace(/\\(\\|\+[0-9A-Fa-f]{6}|[0-9A-Fa-f]{4})/g, (_match, escape: string) =>
    escape === "\\" ? "\\" : String.fromCodePoint(parseInt(escape.replace("+", ""), 16))
  );
}

/** Les vecteurs du bloc `insert into unit_vectors` de la suite pgTAP, dans l'ordre de leur position. */
function pgTapVectors(): Vector[] {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/tests/database/measurement-units.test.sql"), "utf8");
  const start = sql.indexOf("insert into unit_vectors");
  const block = sql.slice(start, sql.indexOf(";\n", start) + 1);
  return block
    .split("\n")
    .map((line) => PGTAP_VECTOR_ROW.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match, index) => {
      expect(Number(match[1])).toBe(index + 1);
      const [raw, token, unitCode, pricingStatus] = match.slice(2).map(decodeSqlLiteral);
      return [raw ?? "", token ?? "", unitCode, pricingStatus] as const;
    });
}

describe("normaliseur d'unités (D9)", () => {
  it("compte exactement 40 vecteurs, identiques octet pour octet à ceux de la suite pgTAP", () => {
    expect(VECTORS).toHaveLength(40);
    expect(pgTapVectors()).toEqual(VECTORS);
  });

  it.each(VECTORS)("« %s » donne le jeton « %s »", (raw, token) => {
    expect(measurementUnitToken(raw)).toBe(token);
  });

  it.each(VECTORS)(
    "« %s » (jeton « %s ») se résout en unité %s / statut %s",
    (raw, _token, unitCode, pricingStatus) => {
      expect(normalizeMeasurementUnit(raw)).toEqual({ unitCode, pricingStatus });
    }
  );

  it("ne résout ni null ni undefined en unité par défaut (U9)", () => {
    expect(normalizeMeasurementUnit(null)).toEqual({ unitCode: null, pricingStatus: null });
    expect(normalizeMeasurementUnit(undefined)).toEqual({
      unitCode: null,
      pricingStatus: null,
    });
  });

  it("n'admet aucun millilitre et fait de chaque code son propre jeton (P-08, U5, U7)", () => {
    expect(MEASUREMENT_UNITS.map((unit) => unit.code)).toContain("ml");
    for (const unit of MEASUREMENT_UNITS) {
      expect(measurementUnitToken(unit.code)).toBe(unit.code);
      expect(normalizeMeasurementUnit(unit.code)).toEqual({
        unitCode: unit.code,
        pricingStatus: null,
      });
      expect(unit.label.toLowerCase()).not.toContain("millilitre");
    }
  });

  it("distingue l'ensemble du forfait (P-08 : ens ≠ fft)", () => {
    expect(normalizeMeasurementUnit("ens").unitCode).toBe("ens");
    expect(normalizeMeasurementUnit("fft").unitCode).toBe("fft");
  });
});

describe("référentiel généré (U4, U5)", () => {
  it("garde la migration M3 et la suite pgTAP alignées sur units.json", () => {
    expect(checkUnitsSqlBlocks()).toEqual([]);
  });

  it("signale une dérive : un alias ajouté au JSON sans migration", () => {
    const source = structuredClone(unitsSource);
    source.units[0].aliases.push("unitaire");
    expect(checkUnitsSqlBlocks(process.cwd(), source)).toEqual([
      expect.stringContaining("le bloc généré diffère de units.json"),
      expect.stringContaining("le bloc généré diffère de units.json"),
    ]);
  });

  it("refuse un jeton qui viserait deux cibles", () => {
    const source = structuredClone(unitsSource);
    source.units[0].aliases.push("HL");
    expect(() => buildUnitsReferential(source)).toThrow(/UNITS_ALIAS_CONFLICT/);
  });

  it("refuse le millilitre, quelle que soit sa graphie", () => {
    const source = structuredClone(unitsSource);
    source.units[0].aliases.push("Millilitres");
    expect(() => buildUnitsReferential(source)).toThrow(/UNITS_MILLILITRE_FORBIDDEN/);
  });
});
