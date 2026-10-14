export const MAX_ORDER_QUANTITY = 2_147_483_647;

// Inspect the decimal representation rather than quantity * 1000: values such
// as 1.001 are not exact binary fractions.
export function isValidOrderQuantity(quantity: number): boolean {
  return Number.isFinite(quantity) && quantity > 0 &&
    quantity <= MAX_ORDER_QUANTITY && /^\d+(?:\.\d{1,3})?$/.test(String(quantity));
}

export function parseOrderQuantityInput(input: string): number | null {
  const text = input.trim();
  if (!/^\d+(?:[.,]\d+)?$/.test(text)) return null;
  // Extra trailing zeroes do not increase the effective decimal precision.
  const canonical = text.replace(",", ".").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (!/^\d+(?:\.\d{1,3})?$/.test(canonical)) return null;
  const quantity = Number(canonical);
  return isValidOrderQuantity(quantity) ? quantity : null;
}

export function formatOrderQuantity(quantity: number): string {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(quantity);
}

export function orderQuantityToMilliunits(quantity: number): bigint {
  if (!isValidOrderQuantity(quantity)) {
    throw new RangeError("Quantité positive attendue, avec au plus trois décimales.");
  }
  const [whole, fraction = ""] = String(quantity).split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
}
