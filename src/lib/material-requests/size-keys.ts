import { findDiameterEntries, type DiameterFamily } from "@/lib/takeoff/bench/diameters";
import type { MaterialCode } from "@/lib/takeoff/bench/keys";
import { foldText } from "@/lib/text/fold";

/**
 * The size of a requested piece and of a catalogue article, read into one form so the matcher can tell the
 * same size behind different notations (TI-690, delivery 3). The diameter table of the takeoff bench is
 * the single source of the outer diameters, DN and thread names; this module only reads.
 *
 * A size is read, never guessed: what cannot be read is null, and two sizes are « unknown » rather than
 * « different » when one of them could not be read. Deliberately not attempted: lengths (« lg 200 mm »),
 * angles (they stay words of the type), plate sizes (« 110 x 60 mm »).
 */

export type SizeReading = {
  /** Nominal diameter, when the size names one or resolves to one. */
  dn: number | null;
  /** Second size of a reducing piece (« DN32>25 », « 32-25 »). */
  reduce: number | null;
  /** Metric thread, « M10 ». */
  metric: number | null;
  /** Outer diameter in millimetres, when printed (and kept even when it resolves to a DN). */
  od: number | null;
  /** Second outer diameter of a reducing piece named by its outer diameters (« 40-32 » in PEHD). */
  reduceOd: number | null;
};

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;

function numberOf(text: string) {
  return Number(text.replace(",", "."));
}

function materialCodeOf(material: string | null): MaterialCode | null {
  const text = foldText(material ?? "");
  if (!text) return null;
  if (text.includes("inox")) return text.includes("316") ? "inox-316l" : text.includes("304") ? "inox-304l" : "inox";
  if (text.includes("cuivre")) return "cuivre";
  if (text.includes("multicouche")) return "multicouche";
  if (/\bper\b/.test(text)) return "per";
  if (text.includes("pvc")) return /pression|\bpn\b/.test(text) ? "pvc-pression" : "pvc";
  if (/\bpehd\b|\bpe\b/.test(text)) return "pehd";
  if (/\bpp\b|\bppr\b/.test(text)) return "pp";
  if (text.includes("fonte")) return "fonte";
  if (text.includes("acier")) return text.includes("noir") ? "acier-noir" : text.includes("galva") ? "acier-galvanise" : "acier";
  return null;
}

/** Press-fit and welded stainless share outer diameters with different DN: the material text decides. */
function familiesOf(material: string | null, code: MaterialCode | null): readonly DiameterFamily[] | undefined {
  const text = foldText(material ?? "");
  if (code && code.startsWith("inox")) {
    if (text.includes("sert")) return ["inox-sertir"];
    if (text.includes("soud")) return ["inox-soude"];
  }
  return undefined;
}

/** Trades that name their pieces by outer diameter: a bare number is an outer diameter there. */
function namesByOuterDiameter(material: string | null, code: MaterialCode | null) {
  if (!code) return false;
  if (code === "cuivre" || code === "multicouche" || code === "per" || code === "pvc" || code === "pehd" || code === "pp") {
    return true;
  }
  return code.startsWith("inox") && foldText(material ?? "").includes("sert");
}

function dnOfOuterDiameter(od: number, material: string | null, code: MaterialCode | null): number | null {
  const entries = findDiameterEntries(`Ø ${od}`, code, familiesOf(material, code));
  const values = new Set(entries.map((entry) => entry.nominal_dn).filter((value): value is number => value !== null));
  return values.size === 1 ? [...values][0] : null;
}

/** Whether the text holds this name of the table on its own, not inside a longer size (« 116/118 »). */
function namedBy(text: string, alias: string) {
  const escaped = foldText(alias).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\w./"])${escaped}(?![\\w./])`).test(text);
}

/** Two outer diameters of a reducing piece: a DN pair only when both resolve, the diameters always. */
function outerPair(main: number, second: number | null, material: string | null, code: MaterialCode | null): SizeReading {
  const reduce = second === null ? null : dnOfOuterDiameter(second, material, code);
  const dn = dnOfOuterDiameter(main, material, code);
  return {
    dn: dn !== null && (second === null || reduce !== null) ? dn : null,
    reduce: dn !== null ? reduce : null,
    metric: null,
    od: main,
    reduceOd: second,
  };
}

/**
 * A bare number, read as each trade writes it: a DN in steel, an outer diameter in copper, multilayer, PER,
 * plastics and press-fit stainless. The outer diameter is kept even when no DN corresponds to it (PVC, PEHD,
 * PP and PER tubes have none in the table): « 32 » and « 40 » in PVC must stay two different sizes.
 */
function bareSizes(values: number[], material: string | null, code: MaterialCode | null): SizeReading {
  const [main, second = null] = values;
  if (!namesByOuterDiameter(material, code)) {
    return { dn: main, reduce: second, metric: null, od: null, reduceOd: null };
  }
  return outerPair(main, second, material, code);
}

export function readSize(raw: string | null | undefined, material: string | null): SizeReading | null {
  const text = foldText(raw ?? "")
    .replace(/[ø⌀]/g, " o ")
    .replace(/\bdiam(?:etre)?\b\.?/g, " o ")
    .replace(/×/g, "x")
    .trim();
  if (!text) return null;
  const code = materialCodeOf(material);
  const empty: SizeReading = { dn: null, reduce: null, metric: null, od: null, reduceOd: null };

  const metric = /\bm\s?(\d{1,2})\b(?!\s*mm)/.exec(text);
  if (metric) return { ...empty, metric: Number(metric[1]) };

  const dnPair = new RegExp(String.raw`\bdn\s*${NUMBER}\s*(?:>|x|/|-|\*)\s*(?:dn\s*)?${NUMBER}\b`).exec(text);
  if (dnPair) return { ...empty, dn: numberOf(dnPair[1]), reduce: numberOf(dnPair[2]) };

  const dn = new RegExp(String.raw`\bdn\s*-?\s*${NUMBER}`).exec(text);
  if (dn) return { ...empty, dn: numberOf(dn[1]) };

  // Names of the material's own series first: in copper « 16/18 » is the 18 mm tube (inner/outer
  // diameters), not a reducer from 16 to 18. Then gas threads and inch sizes (« 15/21 », « 1/2" »), which
  // the steel series of the table holds.
  if (/\d\s*\/\s*\d|"/.test(text)) {
    if (code) {
      const own = findDiameterEntries(text, code, familiesOf(material, code))
        .filter((entry) => entry.aliases.some((alias) => namedBy(text, alias)));
      const ods = new Set(own.map((entry) => entry.od_mm));
      if (ods.size === 1) return { ...empty, od: own[0].od_mm, dn: own[0].nominal_dn };
    }
    const threads = findDiameterEntries(text, null, ["acier"]).filter((entry) => entry.aliases.length > 0);
    const values = new Set(threads.map((entry) => entry.nominal_dn).filter((value): value is number => value !== null));
    if (values.size === 1) return { ...empty, dn: [...values][0] };
  }

  // A reducing size marked with the diameter sign (« Ø 40 x 32 », « Ø40/Ø32 ») keeps both diameters.
  const outerReducing = new RegExp(String.raw`\bo\s*${NUMBER}\s*(?:-|x|/|>)\s*(?:o\s*)?${NUMBER}\b`).exec(text);
  if (outerReducing) return outerPair(numberOf(outerReducing[1]), numberOf(outerReducing[2]), material, code);

  const outer = new RegExp(String.raw`\bo\s*${NUMBER}`).exec(text) ?? new RegExp(String.raw`(?<![\d.,x/])${NUMBER}\s*mm\b`).exec(text);
  if (outer) {
    const od = numberOf(outer[1]);
    return { ...empty, od, dn: dnOfOuterDiameter(od, material, code) };
  }

  const pair = new RegExp(String.raw`^${NUMBER}\s*(?:-|x|/|>)\s*${NUMBER}$`).exec(text);
  if (pair) return bareSizes([numberOf(pair[1]), numberOf(pair[2])], material, code);

  const single = new RegExp(String.raw`^${NUMBER}$`).exec(text);
  if (single) return bareSizes([numberOf(single[1])], material, code);
  return null;
}

const OUTER_DIAMETER_TOLERANCE_MM = 0.5;

export function compareSizes(left: SizeReading | null, right: SizeReading | null): "same" | "different" | "unknown" {
  if (!left || !right) return "unknown";
  if (left.metric !== null || right.metric !== null) {
    if (left.metric !== null && right.metric !== null) return left.metric === right.metric ? "same" : "different";
    return "unknown";
  }
  if (left.dn !== null && right.dn !== null) {
    if (left.dn !== right.dn) return "different";
    if (left.reduce !== null && right.reduce !== null && left.reduce !== right.reduce) return "different";
    return "same";
  }
  if (left.od !== null && right.od !== null) {
    const close = (a: number, b: number) => Math.abs(a - b) <= OUTER_DIAMETER_TOLERANCE_MM;
    if (!close(left.od, right.od)) return "different";
    if (left.reduceOd !== null && right.reduceOd !== null && !close(left.reduceOd, right.reduceOd)) return "different";
    return "same";
  }
  return "unknown";
}
