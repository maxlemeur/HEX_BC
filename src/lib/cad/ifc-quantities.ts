// What is shown and exported of the quantities of an IFC model: its rows
// narrowed to a storey and to the classes that are shown, added up over the
// storeys, and written as on a site.

import type { IfcModel, IfcRow, IfcSection } from "./ifc";
import { formatCadQuantity } from "./messages";
import { cadDimensionNumber } from "./model-quantities";
import { cadCsvCell } from "./quantities";

/** `storey`: its place in the model, -1 for what is in none, null for every storey. `shown`: by class; a class without a say is shown. */
export type IfcFilter = { storey: number | null; shown: readonly boolean[] };

/** The elements of one class, one type and one section, over the storeys kept. */
export type IfcQuantityRow = Omit<IfcRow, "storey">;

export type IfcClassQuantity = { cls: number; name: string; label: string; /** Elements on the storeys kept, the class shown or not. */ count: number };

export type IfcQuantities = {
  classes: IfcClassQuantity[];
  rows: IfcQuantityRow[];
  totals: { elements: number; length: number };
  /** Whether a row declares an area, or a volume. */
  columns: { area: boolean; volume: boolean };
};

// A map, not an object: the name of a class comes from the file.
const CLASS_LABELS = new Map([
  ["IfcFlowSegment", "Tuyaux, gaines et chemins de câbles"], ["IfcPipeSegment", "Tuyaux"], ["IfcDuctSegment", "Gaines"],
  ["IfcCableCarrierSegment", "Chemins de câbles"], ["IfcCableSegment", "Câbles"],
  ["IfcFlowFitting", "Raccords"], ["IfcPipeFitting", "Raccords de tuyauterie"], ["IfcDuctFitting", "Raccords de gaines"],
  ["IfcCableCarrierFitting", "Raccords de chemins de câbles"], ["IfcCableFitting", "Raccords de câbles"], ["IfcJunctionBox", "Boîtes de jonction"],
  ["IfcFlowTerminal", "Terminaux"], ["IfcSanitaryTerminal", "Appareils sanitaires"], ["IfcWasteTerminal", "Siphons et évacuations"],
  ["IfcAirTerminal", "Bouches d’air"], ["IfcFireSuppressionTerminal", "Terminaux incendie"], ["IfcStackTerminal", "Sorties de toiture"],
  ["IfcSpaceHeater", "Émetteurs de chaleur"], ["IfcLightFixture", "Luminaires"], ["IfcOutlet", "Prises"], ["IfcElectricAppliance", "Appareils électriques"],
  ["IfcFlowController", "Organes de réglage"], ["IfcValve", "Vannes et robinets"], ["IfcDamper", "Registres et clapets"], ["IfcFlowMeter", "Compteurs"],
  ["IfcFlowMovingDevice", "Pompes et ventilateurs"], ["IfcPump", "Pompes"], ["IfcFan", "Ventilateurs"],
  ["IfcFlowStorageDevice", "Réservoirs"], ["IfcTank", "Réservoirs et ballons"],
  ["IfcFlowTreatmentDevice", "Filtres et traitement"], ["IfcFilter", "Filtres"], ["IfcInterceptor", "Séparateurs"],
  ["IfcEnergyConversionDevice", "Production de chaleur et de froid"], ["IfcBoiler", "Chaudières"], ["IfcChiller", "Groupes froids"], ["IfcHeatExchanger", "Échangeurs"],
  ["IfcUnitaryEquipment", "Unités de traitement d’air"], ["IfcCoil", "Batteries"],
  ["IfcDistributionChamberElement", "Regards et chambres"], ["IfcDistributionControlElement", "Régulation"],
  ["IfcWall", "Murs"], ["IfcWallStandardCase", "Murs"], ["IfcSlab", "Dalles"], ["IfcRoof", "Toitures"], ["IfcBeam", "Poutres"], ["IfcColumn", "Poteaux"],
  ["IfcMember", "Barres et montants"], ["IfcPlate", "Plaques et panneaux"], ["IfcFooting", "Fondations"], ["IfcPile", "Pieux"],
  ["IfcDoor", "Portes"], ["IfcWindow", "Fenêtres"], ["IfcCurtainWall", "Murs-rideaux"], ["IfcCovering", "Revêtements"],
  ["IfcStair", "Escaliers"], ["IfcStairFlight", "Volées d’escalier"], ["IfcRamp", "Rampes"], ["IfcRampFlight", "Volées de rampe"], ["IfcRailing", "Garde-corps"],
  ["IfcFurnishingElement", "Mobilier"], ["IfcFurniture", "Mobilier"], ["IfcBuildingElementProxy", "Objets génériques"], ["IfcBuildingElementPart", "Parties d’ouvrage"],
  ["IfcElementAssembly", "Assemblages"], ["IfcTransportElement", "Ascenseurs et transports"], ["IfcDiscreteAccessory", "Accessoires"], ["IfcMechanicalFastener", "Fixations"],
  ["IfcReinforcingBar", "Armatures"], ["IfcReinforcingMesh", "Treillis soudés"],
]);

/** The French name of an IFC class; its own name when it is not one of the usual ones. */
export function ifcClassLabel(name: string): string {
  return CLASS_LABELS.get(name) ?? name;
}

const millimetres = (value: number) => value.toLocaleString("fr-FR", { maximumFractionDigits: 1, useGrouping: false });

/** « Ø 110 mm » for a round section, « 400 × 350 mm » for a rectangular one. */
export function ifcSectionLabel(section: IfcSection | null): string {
  if (!section) return "";
  return section.length === 1 ? `Ø ${millimetres(section[0])} mm` : `${millimetres(section[0])} × ${millimetres(section[1])} mm`;
}

/** The length of a row: « ≈ » when some of it was measured on the mesh, and how many elements it adds up when not all have one. */
export function ifcLengthLabel(row: Pick<IfcRow, "count" | "length" | "lengths" | "approximate">): string {
  if (row.lengths === 0) return "";
  return `${row.approximate > 0 ? "≈ " : ""}${formatCadQuantity(row.length)} m${row.lengths < row.count ? ` (${row.lengths.toLocaleString("fr-FR")} sur ${row.count.toLocaleString("fr-FR")})` : ""}`;
}

export function ifcStoreyLabel(model: IfcModel, storey: number): string {
  return model.storeys[storey]?.name ?? "Hors niveau";
}

/** One line for what a model holds. */
export function ifcModelSummary(model: IfcModel): string {
  if (model.elements === 0) return `${model.schema} · Aucun élément`;
  const elements = `${model.elements.toLocaleString("fr-FR")} élément${model.elements > 1 ? "s" : ""}`;
  return [model.schema, elements, ...(model.storeys.length > 0 ? [`${model.storeys.length.toLocaleString("fr-FR")} ${model.storeys.length > 1 ? "niveaux" : "niveau"}`] : [])].join(" · ");
}

const kept = (filter: IfcFilter, row: IfcRow) => filter.storey === null || row.storey === filter.storey;

export function ifcQuantities(model: IfcModel, filter: IfcFilter): IfcQuantities {
  const classes: IfcClassQuantity[] = model.classes.map((name, cls) => ({ cls, name, label: ifcClassLabel(name), count: 0 }));
  const rows = new Map<string, IfcQuantityRow>();
  const totals = { elements: 0, length: 0 }, columns = { area: false, volume: false };
  for (const entry of model.rows) {
    if (!kept(filter, entry)) continue;
    if (classes[entry.cls]) classes[entry.cls].count += entry.count;
    if (filter.shown[entry.cls] === false) continue;
    const key = `${entry.cls}|${entry.section?.join("x") ?? ""}|${entry.type}`;
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { cls: entry.cls, type: entry.type, section: entry.section, count: 0, length: 0, lengths: 0, stated: 0, approximate: 0, area: 0, areas: 0, volume: 0, volumes: 0 }));
    for (const field of ["count", "length", "lengths", "stated", "approximate", "area", "areas", "volume", "volumes"] as const) row[field] += entry[field];
    totals.elements += entry.count;
    totals.length += entry.length;
    columns.area ||= entry.areas > 0;
    columns.volume ||= entry.volumes > 0;
  }
  return { classes, rows: [...rows.values()], totals, columns };
}

const decimal = (value: number) => cadDimensionNumber(value, false);

/** The rows shown, storey by storey, as a CSV file Excel opens as is: semicolons, decimal commas, UTF-8 with its mark. */
export function ifcQuantitiesCsv(model: IfcModel, filter: IfcFilter): string {
  const lines = ["Classe IFC;Nature;Type;Section;Niveau;Nombre;Longueur (m);Longueurs approchées;Surface (m²);Volume (m³)"];
  for (const row of model.rows) {
    if (!kept(filter, row) || filter.shown[row.cls] === false) continue;
    const name = model.classes[row.cls] ?? "";
    lines.push([
      cadCsvCell(name), cadCsvCell(ifcClassLabel(name)), cadCsvCell(row.type), ifcSectionLabel(row.section), cadCsvCell(ifcStoreyLabel(model, row.storey)), row.count,
      row.lengths > 0 ? decimal(row.length) : "", row.approximate > 0 ? row.approximate : "", row.areas > 0 ? decimal(row.area) : "", row.volumes > 0 ? decimal(row.volume) : "",
    ].join(";"));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
