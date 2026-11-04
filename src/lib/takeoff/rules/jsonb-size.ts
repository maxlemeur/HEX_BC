// Size of a JSON value as PostgreSQL gives it back from a jsonb column (TI-677): the byte bounds of the rule columns
// are check constraints on octet_length(value::text), so the server measures what it writes the same way before the
// write. jsonb writes ", " between elements and ": " after a key, a number in plain notation (its numeric text: 1e-7
// is 0.0000001), a string escaped like JSON.stringify (\" \\ \b \f \n \r \t, \u00XX below 0x20) and every other
// character as its UTF-8 bytes. A NUL or a lone surrogate cannot be stored: such a value measures Infinity.
// For plain JSON data only (parsed or built from literals): toJSON, a Date or a boxed primitive is not measured.

function stringBytes(text: string): number {
  let bytes = 2;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0) return Number.POSITIVE_INFINITY;
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x0c || code === 0x0a || code === 0x0d || code === 0x09) bytes += 2;
    else if (code < 0x20) bytes += 6;
    else if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return Number.POSITIVE_INFINITY;
      bytes += 4;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return Number.POSITIVE_INFINITY;
    else bytes += 3;
  }
  return bytes;
}

/** Length of a finite number's numeric text, read from the literal JSON.stringify sends (1.5e-7 → 0.00000015). */
function numberBytes(value: number): number {
  const literal = JSON.stringify(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(literal);
  if (!match) return literal.length;
  const [, sign, whole, fraction = "", exponentText] = match;
  if (exponentText === undefined) return literal.length;
  // JSON.stringify writes one non-zero digit before the point of an exponent: the point then moves by the exponent.
  const exponent = Number(exponentText);
  const point = whole.length + exponent;
  const scale = Math.max(0, fraction.length - exponent);
  return sign.length + (point <= 0 ? 1 : point) + (scale > 0 ? 1 + scale : 0);
}

/** Bytes of octet_length(value::jsonb::text) for the value JSON.stringify would send; Infinity when not storable. */
export function jsonbTextBytes(value: unknown): number {
  if (value === null || value === undefined) return 4;
  switch (typeof value) {
    case "boolean":
      return value ? 4 : 5;
    case "number":
      return Number.isFinite(value) ? numberBytes(value) : 4;
    case "string":
      return stringBytes(value);
    case "object": {
      if (Array.isArray(value)) {
        let bytes = 2 + Math.max(0, value.length - 1) * 2;
        for (const entry of value) {
          bytes += typeof entry === "function" || typeof entry === "symbol" ? 4 : jsonbTextBytes(entry);
        }
        return bytes;
      }
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined && typeof entry !== "function" && typeof entry !== "symbol");
      let bytes = 2 + Math.max(0, entries.length - 1) * 2;
      for (const [key, entry] of entries) bytes += stringBytes(key) + 2 + jsonbTextBytes(entry);
      return bytes;
    }
    default:
      return 4;
  }
}
