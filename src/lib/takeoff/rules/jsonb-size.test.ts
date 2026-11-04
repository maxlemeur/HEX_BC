import { describe, expect, it } from "vitest";

import { jsonbTextBytes } from "@/lib/takeoff/rules/jsonb-size";

// The byte bounds of the rule columns (TI-677) are checked by the database on the text jsonb gives back
// (octet_length(value::text)), not on JSON.stringify. Ways the server's measure could let an oversized value through,
// written before the code:
// - the separators counted as JSON.stringify writes them (jsonb writes ", " and ": ");
// - a number counted in its exponent notation (jsonb writes 1e-7 as 0.0000001);
// - a multibyte character counted as one byte, an escape counted short;
// - a value the database refuses to store (a NUL, a lone surrogate) measured as storable.
// pgTAP asserts the same sizes on the same JSON (takeoff-rule-bounds.test.sql): what the server measures before a
// write is what the check measures.

const FIXTURES: Array<[string, number]> = [
  [String.raw`{"a": [1, 2.5, "é"], "b": null, "c": true}`, 43],
  [String.raw`["\"\\\n\t\u0001", 1e-7, -1.5e21, "日本", "😀", {}, []]`, 80],
  [String.raw`{"k\"ey": "v", "ü": 0.001, "z": [true, false, null]}`, 53],
  [String.raw`[5e-324, 0, 123.456, 1e21, -0.5]`, 1 + 326 + 2 + 1 + 2 + 7 + 2 + 22 + 2 + 4 + 1],
];

describe("size of a value as jsonb gives it back", () => {
  it.each(FIXTURES)("measures %s as the database does", (json, bytes) => {
    expect(jsonbTextBytes(JSON.parse(json))).toBe(bytes);
  });

  it("skips what JSON.stringify skips: an undefined property, never an array slot", () => {
    expect(jsonbTextBytes({ a: 1, b: undefined })).toBe(jsonbTextBytes({ a: 1 }));
    expect(jsonbTextBytes([undefined])).toBe(jsonbTextBytes([null]));
  });

  it("never measures as storable what the database refuses: a NUL, a lone surrogate, in a value or a key", () => {
    expect(jsonbTextBytes("a\u0000b")).toBe(Number.POSITIVE_INFINITY);
    expect(jsonbTextBytes(["ok", "\ud800"])).toBe(Number.POSITIVE_INFINITY);
    expect(jsonbTextBytes({ ["\udc00"]: 1 })).toBe(Number.POSITIVE_INFINITY);
    expect(jsonbTextBytes("😀")).toBe(6);
  });
});
