import { requireValue } from "./local-recipe-common.mjs";
export const numericSelections = ["numeric-price", "numeric-decimals", "numeric-loss", "numeric-all"];
export const componentSelections = ["entry", "full", "assembly-totals", ...numericSelections];
export const isNumericSelection = (selection) => numericSelections.includes(selection);
export const numericTitles = {
  NI01: "NI01 euro unit cost preserves typed decimal and blocks invalid save",
  NI02: "NI02 typed quantity and yield preserve decimals and retained zero labor hours",
  NI03: "NI03 percentage loss preserves typed decimal through reuse and exports",
};
export function numericJourneys(selection) {
  requireValue(isNumericSelection(selection), "Explicit numeric selection required.");
  return selection === "numeric-all" ? ["NI01", "NI02", "NI03"] : [selection === "numeric-price" ? "NI01" : selection === "numeric-decimals" ? "NI02" : "NI03"];
}
export const numericContracts = {
  NI01: { caseId: "NI01", fixtureLabel: "GC01", retainedIndices: [0], parentQuantity: 1, hours: 0, dsCents: 1250, effectiveUnitPriceHtCents: 1250, totals: [1250, 250, 1500], downloads: 4,
    components: [{ index: 0, costType: "material", quantity: 1, unit: "u", unitCostHtCents: 1250, lossCoeffBp: 0, hours: 0 }] },
  NI02: { caseId: "NI02", fixtureLabel: "GC02", retainedIndices: [0, 1], parentQuantity: 2, hours: 0.5, dsCents: 5000, effectiveUnitPriceHtCents: 2500, totals: [5000, 1000, 6000], downloads: 4,
    components: [{ index: 0, costType: "material", quantity: 1.25, unit: "u", unitCostHtCents: 4000, lossCoeffBp: 0, hours: 0 },
      { index: 1, costType: "labor", quantity: 1, unit: "u", unitCostHtCents: 0, lossCoeffBp: 0, yieldValue: 0.25, yieldUnit: "h/u", hours: 0.5 }] },
  "NI03-A": { caseId: "NI03-A", fixtureLabel: "GC03", retainedIndices: [0], parentQuantity: 1, hours: 0, dsCents: 10500, effectiveUnitPriceHtCents: 10500, totals: [10500, 2100, 12600], downloads: 4,
    components: [{ index: 0, costType: "material", quantity: 2.5, unit: "u", unitCostHtCents: 4000, lossCoeffBp: 500, hours: 0 }] },
  "NI03-B": { caseId: "NI03-B", fixtureLabel: "GC04", retainedIndices: [0], parentQuantity: 1, hours: 0, dsCents: 10250, effectiveUnitPriceHtCents: 10250, totals: [10250, 2050, 12300], downloads: 4,
    components: [{ index: 0, costType: "material", quantity: 2.5, unit: "u", unitCostHtCents: 4000, lossCoeffBp: 250, hours: 0 }] },
};
export const numericCases = (selection) => numericJourneys(selection).flatMap((id) => id === "NI03" ? ["NI03-A", "NI03-B"] : [id]);
export const numericDownloads = (selection) => numericCases(selection).reduce((count, id) => count + numericContracts[id].downloads, 0);
export function numericTypingContract(caseId, phase) {
  const match = /^typed-(price|quantity-comma|quantity-point|zero-price|yield|loss)-(prefix|completed)$/.exec(phase);
  requireValue(match && numericContracts[caseId], "Known numeric keyboard phase required.");
  const [field, stage] = match.slice(1);
  const values = caseId === "NI01" ? { price: ["12,", "12,50", 0, "Coût unitaire HT"] } : caseId === "NI02" ? {
    "quantity-comma": ["1,", "1,25", 0, "Quantité"], "quantity-point": ["1.", "1.25", 0, "Quantité"], "zero-price": [null, "0", 1, "Coût unitaire HT"], yield: ["0,", "0,25", 1, "Rendement"],
  } : { loss: [caseId === "NI03-B" ? "2," : null, caseId === "NI03-B" ? "2,5" : "5", 0, "Pertes"] };
  const value = values[field]; requireValue(value && value[stage === "prefix" ? 0 : 1] !== null, "Keyboard case/field differs.");
  return { input: value[stage === "prefix" ? 0 : 1], fieldIndex: value[2], labelPrefix: value[3], field, stage };
}
