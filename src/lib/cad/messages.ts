// What the screen says of a CAD original: why it was not read or plotted, and
// how its quantities and the files made from it are written.

import type { CadReadErrorReason } from "./dxf";
import type { CadUnits, CadWarning, CadWarningCode } from "./model";
import type { CadPlotErrorReason } from "./plot";

const READ_FAILED = "La lecture de ce fichier a échoué.";
const PLOT_FAILED = "Le tracé PDF a échoué.";

const READ_MESSAGES: Record<CadReadErrorReason, string> = {
  empty: "Ce fichier est vide.",
  too_large: "Ce fichier dépasse 50 Mo : il n’est pas lu.",
  binary_dxf: "Ce DXF est au format binaire. Enregistrez-le en DXF ASCII depuis votre logiciel de dessin, puis déposez-le à nouveau.",
  not_dxf: "Ce fichier porte l’extension DXF mais n’en a pas le contenu.",
  not_dwg: "Ce fichier porte l’extension DWG mais n’en a pas le contenu.",
  not_rvt: "Ce fichier porte l’extension RVT mais n’en a pas le contenu.",
  unsupported: "Ce format n’est pas lu par MergeOne.",
};

const PLOT_MESSAGES: Record<CadPlotErrorReason | "no_drawing", string> = {
  truncated: "Ce dessin n’a pas été lu en entier : son tracé serait incomplet.",
  unknown_unit: "Choisissez l’unité du dessin avant de tracer.",
  invalid_denominator: "Cette échelle n’est pas proposée.",
  empty: "Aucun calque affiché ne porte de tracé.",
  does_not_fit: "Le plan ne tient pas sur une feuille à cette échelle : choisissez une échelle plus petite.",
  too_large: "Le tracé dépasse 50 Mo : masquez des calques ou choisissez une échelle plus petite.",
  no_drawing: "Le dessin n’est plus ouvert : rouvrez le document.",
};

export function cadReadMessage(reason: string): string {
  return Object.hasOwn(READ_MESSAGES, reason) ? READ_MESSAGES[reason as CadReadErrorReason] : READ_FAILED;
}

export function cadPlotMessage(reason: string): string {
  return Object.hasOwn(PLOT_MESSAGES, reason) ? PLOT_MESSAGES[reason as CadPlotErrorReason] : PLOT_FAILED;
}

const MAX_NAMES = 5;

/** « A, B » or « A, B, C, D, E et 3 autres ». */
function named(names: string[]): string {
  const rest = names.length - MAX_NAMES;
  return `${names.slice(0, MAX_NAMES).join(", ")}${rest > 0 ? ` et ${rest} autre${rest > 1 ? "s" : ""}` : ""}`;
}

const STOPPED = "la lecture s’est arrêtée avant la fin";

const WARNING_MESSAGES: Record<CadWarningCode, (details: string[]) => string> = {
  truncated_file: () => "Le fichier s’arrête avant sa fin : le dessin est incomplet.",
  limit_entities: () => `Ce dessin compte trop d’objets : ${STOPPED}.`,
  limit_points: () => `Ce dessin compte trop de points : ${STOPPED}.`,
  limit_texts: () => `Ce dessin compte trop de textes : ${STOPPED}.`,
  limit_inserts: () => `Ce dessin place trop de blocs : ${STOPPED}.`,
  missing_block: (names) => `Blocs absents du fichier, ni dessinés ni comptés : ${named(names)}.`,
  xref_missing: (names) => `Références externes non jointes au fichier, leur contenu manque : ${named(names)}.`,
  block_cycle: (names) => `Blocs qui se contiennent eux-mêmes, non suivis plus loin : ${named(names)}.`,
  depth_limit: (names) => `Blocs imbriqués trop profondément, non dessinés au-delà : ${named(names)}.`,
  spline_fit_points: ([count]) => (Number(count) > 1
    ? `${count} splines sont tracées par leurs points de passage : leur longueur est approchée.`
    : "1 spline est tracée par ses points de passage : sa longueur est approchée."),
};

/** One sentence per kind of warning the reading left, in the order they came, the blocks of a kind named together. */
export function cadWarningMessages(warnings: readonly CadWarning[]): string[] {
  const details = new Map<CadWarningCode, string[]>();
  for (const warning of warnings) {
    if (!Object.hasOwn(WARNING_MESSAGES, warning.code)) continue;
    const known = details.get(warning.code) ?? [];
    if (warning.detail !== undefined) known.push(warning.detail);
    details.set(warning.code, known);
  }
  return [...details].map(([code, names]) => WARNING_MESSAGES[code](names));
}

export type CadUnitChoice = {
  /** Value of the option in a select: unique among the choices, empty for drawing units. */
  value: string;
  label: string;
  /** Null: lengths stay in drawing units. */
  metresPerUnit: number | null;
  /** The unit the file gives, which is the one first chosen. */
  fromFile: boolean;
};

const USUAL_UNITS: [number, string][] = [[0.001, "Millimètres"], [0.01, "Centimètres"], [1, "Mètres"]];

/** Units a drawing can be measured in: the file's own first, then the usual ones, then none. */
export function cadUnitChoices(units: CadUnits): CadUnitChoice[] {
  const own = units.metresPerUnit !== null && units.metresPerUnit > 0 && Number.isFinite(units.metresPerUnit) ? units.metresPerUnit : null;
  const choices: CadUnitChoice[] = USUAL_UNITS.map(([metresPerUnit, label]) => ({
    value: String(metresPerUnit), label: metresPerUnit === own ? `${label} (unité du fichier)` : label, metresPerUnit, fromFile: metresPerUnit === own,
  }));
  if (own === null) return [{ value: "", label: "Unités du dessin (le fichier n’en donne pas)", metresPerUnit: null, fromFile: true }, ...choices];
  const none: CadUnitChoice = { value: "", label: "Unités du dessin", metresPerUnit: null, fromFile: false };
  if (choices.some((choice) => choice.fromFile)) return [...choices.filter((choice) => choice.fromFile), ...choices.filter((choice) => !choice.fromFile), none];
  const name = `${units.name.charAt(0).toUpperCase()}${units.name.slice(1)}`;
  return [{ value: String(own), label: `${name} (unité du fichier)`, metresPerUnit: own, fromFile: true }, ...choices, none];
}

/** A quantity to two decimals at most, written as in France. */
export function formatCadQuantity(value: number): string {
  // « -0 » would be written with its sign.
  return (Math.round(value * 100) / 100 + 0).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

const plural = (count: number, word: string) => `${count.toLocaleString("fr-FR")} ${word}${count > 1 ? "s" : ""}`;

/** One line for what is shown of a drawing: its layers, the length they draw and the blocks they place. */
export function cadLayerSummary(shown: { layers: number; length: number; unit: "m" | "unité"; blocks: number }): string {
  if (shown.layers === 0) return "Aucun calque affiché";
  const unit = shown.unit === "m" ? "m" : shown.length > 1 ? "unités" : "unité";
  return [plural(shown.layers, "calque"), `${formatCadQuantity(shown.length)} ${unit} de tracé`, ...(shown.blocks > 0 ? [plural(shown.blocks, "bloc")] : [])].join(" · ");
}

const MAX_FILE_NAME = 160;

function derivedFileName(original: string, suffix: string): string {
  const stem = original.trim().replace(/\.[a-z0-9]{1,5}$/i, "") || "plan";
  return `${stem.slice(0, MAX_FILE_NAME - suffix.length).trimEnd()}${suffix}`;
}

/** The plotted PDF is named after its original and its scale, so that two plots of one plan are told apart in the dossier. */
export function cadPlotFileName(original: string, denominator: number): string {
  return derivedFileName(original, ` (tracé 1-${denominator}).pdf`);
}

export function cadQuantitiesFileName(original: string): string {
  return derivedFileName(original, " - quantités.csv");
}
