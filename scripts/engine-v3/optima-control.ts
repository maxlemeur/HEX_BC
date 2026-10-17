// Lot 2, sub-lot 2.4: reading of the OPTIMA control cells (design §5.4). Pure module, used by
// optima-lot-check.ts and tested by src/test/engine-v3-optima-control.test.ts.

/** Exact decimal string to cents, half up (x >= 0). */
export function centsHalfUp(text: string): number {
  const [whole, fraction = ""] = text.split(".");
  const scaled = BigInt(whole + fraction.padEnd(2, "0").slice(0, 2));
  const rest = fraction.slice(2);
  const roundUp = rest.length > 0 && rest[0] >= "5";
  return Number(scaled + (roundUp ? BigInt(1) : BigInt(0)));
}

/** A float control cell read at Excel's 15 significant digits, then to cents half up. */
export function controlCents(value: number): number {
  const text = Number(value.toPrecision(15)).toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
  return centsHalfUp(text);
}
