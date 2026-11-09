import { ruleInputsFromDesignation } from "@/lib/takeoff/rules/inputs";
import { findNetworkDiameterEntries } from "@/lib/takeoff/rules/network-diameters";
import { surfaceLineBasis } from "@/lib/takeoff/quantity-policy";
import { normalizeMeasurementUnit, measurementUnitToken } from "@/lib/units/normalize";
import { readRuleInputs } from "@/lib/takeoff/rules/contracts";

type QuantityLine = { designation: string; description?: string | null; unit: string; quantity: number; metadata?: Record<string, unknown> };

/**
 * Precompute once per line, rather than parsing both designations for every candidate pair. Sizes are read in the
 * series of the network the designation names, as the DN rule reads them (TI-684); a line naming none keeps the
 * material's pressure series, and never meets a line on a network anyway.
 */
export function quantityIdentity(line: QuantityLine) {
  const designation = [line.designation, line.description].filter(Boolean).join(" ");
  const parsed = ruleInputsFromDesignation({ ...line, designation });
  const stored = readRuleInputs(line.metadata);
  const token = measurementUnitToken(line.unit);
  const aliases: Record<string, string> = { un: "u", unit: "u", mlt: "ml", lm: "ml", sqm: "m2", for: "fft" };
  return { ...parsed, designation,
    unit: normalizeMeasurementUnit(line.unit).unitCode ?? (token ? aliases[token] ?? token : null),
    sizes: new Set(parsed.dn === null ? [] : findNetworkDiameterEntries(parsed.dn, parsed.network, parsed.material)
      .map(entry => `${entry.family}:${entry.od_mm}`)),
    basis: stored?.source === "vector" && stored.kind === "surface" ? "net_floor" : surfaceLineBasis(designation) };
}
export type QuantityIdentity = ReturnType<typeof quantityIdentity>;

export function haveSameQuantityIdentity(a: QuantityIdentity, b: QuantityIdentity) {
  if (!a.unit || !b.unit || a.unit !== b.unit) return false;
  if (a.kind === "network" || b.kind === "network" || a.kind === "insulation" || b.kind === "insulation") {
    if (a.kind !== b.kind || a.network !== b.network || a.material !== b.material) return false;
    if (a.dn === null || b.dn === null) return a.designation === b.designation;
    if (a.sizes.size === 0) return a.dn === b.dn;
    return [...b.sizes].some(size => a.sizes.has(size));
  }
  return a.basis === null && b.basis === null || a.basis !== null && a.basis === b.basis;
}

/** A lexical similarity never authorizes combining different materials, diameters or surface bases. */
export function haveComparableQuantities(left: QuantityLine, right: QuantityLine) {
  return haveSameQuantityIdentity(quantityIdentity(left), quantityIdentity(right));
}
