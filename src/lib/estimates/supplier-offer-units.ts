import { measurementUnitToken, normalizeMeasurementUnit } from "@/lib/units/normalize";

// Sub-lot 2.9 (D9, point 30 of estimate-engine-v3-2.4.md): units resolve through the shared referential
// for every engine ("m.l." and "m" = ml, "Pce" = u, "forfait" = fft; no millilitre, P-08); a unit outside
// it ("barre") compares by its spelling token. SQL twin: private.purchase_unit_token.
function normalizedUnit(value: string) {
  return normalizeMeasurementUnit(value).unitCode ?? measurementUnitToken(value);
}

/** True when either unit is blank or both name the same unit (P-08, D9). */
export function areSupplierUnitsCompatible(lineUnit: string | null | undefined, offerUnit: string | null | undefined) {
  return !lineUnit?.trim() || !offerUnit?.trim() || normalizedUnit(lineUnit) === normalizedUnit(offerUnit);
}
