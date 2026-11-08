/** TI-680: percentage of the reference of this estimate line, never the whole project. */
export const QUANTITY_REVIEW_PERCENT = 1;

export type QuantityPair = { reference: number; measured: number };

/** Only real pairs: a total DPGF reference must not be distributed over invented segments. */
export function compareQuantityPairs(pairs: readonly QuantityPair[]) {
  if (pairs.length === 0) return null;
  let reference = 0;
  let measured = 0;
  let priced = 0;
  let absoluteGap = 0;
  for (const pair of pairs) {
    if (!Number.isFinite(pair.reference) || !Number.isFinite(pair.measured) || pair.reference < 0 || pair.measured < 0) {
      throw new Error("Quantités comparées invalides.");
    }
    reference += pair.reference;
    measured += pair.measured;
    priced += Math.max(pair.reference, pair.measured);
    absoluteGap += Math.abs(pair.measured - pair.reference);
  }
  const percentGap = reference > 0 ? absoluteGap / reference * 100 : null;
  return { reference, measured, priced, absoluteGap, percentGap,
    requiresReview: absoluteGap > reference * QUANTITY_REVIEW_PERCENT / 100 + 1e-9 };
}

export type SurfaceBasis = "net_floor" | "shab";

function normalized(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** What the source explicitly says; a bare room name or m² does not establish its basis. */
export function surfaceBasis(text: string): SurfaceBasis | null {
  const plain = normalized(text);
  const shab = /\bshab\b|\bsurface\s+habitable\b/.test(plain);
  const net = /\bsol\s+net\b|\bsurface\s+nette\s+(?:au|de)\s+sol\b/.test(plain);
  return shab === net ? null : shab ? "shab" : "net_floor";
}

/** Default belongs to the priced work, never to an unidentified printed label. No heating-specific convention. */
export function surfaceLineBasis(designation: string): SurfaceBasis | null {
  const explicit = surfaceBasis(designation);
  if (explicit) return explicit;
  const plain = normalized(designation);
  if (/\bplancher\s+chauffant\b/.test(plain)) return null;
  return /\bchapes?\b|\brevetements?\s+(?:de\s+)?sol\b|\bcarrelages?\b|\bparquets?\b|^surface\s+[«"]/.test(plain)
    ? "net_floor" : null;
}
