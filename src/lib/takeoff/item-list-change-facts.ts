import type { ItemListViewPoste as Poste } from "./item-list-server";

/** Each qualifier's name, and the word for its absence (agreed with the name). */
const QUALIFIER_LABELS: Record<keyof Poste["qualifiers"], { label: string; none: string }> = {
  network: { label: "Réseau", none: "aucun" }, material: { label: "Matière", none: "aucune" },
  diameter: { label: "Diamètre", none: "aucun" }, convention: { label: "Convention", none: "aucune" },
  scope: { label: "Périmètre", none: "aucun" },
};

const referenceFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 6 });

const dpgf = (item: Poste) => (item.origin.kind === "dpgf" ? item.origin : null);

/** The unit the item is measured in: its own, else the DPGF row's unit as read, else « à préciser ». */
function effectiveUnit(item: Poste) {
  return item.expectedUnit ?? (dpgf(item)?.sourceUnit?.trim() || null) ?? "à préciser";
}

function sectionPath(item: Poste) {
  return item.sections.map(({ title }) => title).join(" / ");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A section path that tells same-titled sections apart: each title with its place in its own source. A section of the
 * DPGF is its title row (identified by that row), numbered as the list numbers an import's rows without their own row
 * number (« Ligne importée N », « Enregistrement importé N » for a CSV); a template's family, or the section of items
 * added by hand, by its position.
 */
function locatedSectionPath(item: Poste, sourceFormat: string | undefined) {
  if (!item.sections.length) return "Sans section";
  const row = sourceFormat === "csv" ? "enregistrement importé" : "ligne importée";
  return item.sections.map(({ id, title, order }) => `${title} (${UUID.test(id) ? row : "position"} ${order + 1})`).join(" / ");
}

/**
 * What a change of the proposal changes in an item, each fact before and after it: its effective unit, its basis, each
 * qualifier, its reference quantity, its section (two sections of one title told apart by their place in their source), its DPGF
 * reference, and its place in the list. A change of the DPGF row's notes, whose text the reader is never sent, is named
 * without it (`notesChanged`, decided by the server on the notes' digests).
 */
export function itemListChangedFacts(change: { previous: Poste; current: Poste; moved: boolean; notesChanged: boolean },
  options: { sourceFormat?: string } = {}) {
  const { previous, current } = change;
  const facts: string[] = [];
  const compare = (label: string, before: string, after: string) => {
    if (before !== after) facts.push(`${label} : ${before} → ${after}`);
  };
  compare("Unité", effectiveUnit(previous), effectiveUnit(current));
  compare("Base de mesure", previous.measurementBasis ?? "aucune", current.measurementBasis ?? "aucune");
  for (const [key, { label, none }] of Object.entries(QUALIFIER_LABELS) as Array<[keyof Poste["qualifiers"], { label: string; none: string }]>) {
    compare(label, previous.qualifiers?.[key] ?? none, current.qualifiers?.[key] ?? none);
  }
  const reference = (value: number | null) => (value === null ? "aucune" : referenceFormat.format(value));
  compare("Référence quantitative", reference(previous.referenceQuantity), reference(current.referenceQuantity));
  const sameSections = JSON.stringify(previous.sections.map(({ id, title, order }) => [id, title, order]))
    === JSON.stringify(current.sections.map(({ id, title, order }) => [id, title, order]));
  if (!sameSections) {
    const [before, after] = [sectionPath(previous) || "Sans section", sectionPath(current) || "Sans section"];
    if (before !== after) compare("Section", before, after);
    else compare("Section", locatedSectionPath(previous, options.sourceFormat), locatedSectionPath(current, options.sourceFormat));
  }
  compare("Référence de la ligne DPGF", dpgf(previous)?.reference ?? "aucune", dpgf(current)?.reference ?? "aucune");
  if (change.notesChanged) facts.push("Notes de la ligne de la DPGF modifiées");
  if (change.moved) facts.push("Place dans la liste modifiée");
  return facts;
}
