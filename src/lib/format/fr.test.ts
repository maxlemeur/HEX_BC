import { describe, expect, it } from "vitest";

import { COUNT_FORMAT, PARIS_DATE_TIME_FORMAT, PARIS_DAY_FORMAT, QUANTITY_FORMAT } from "@/lib/format/fr";

// French groups thousands with a narrow no-break space (U+202F).
const NNBSP = " ";

describe("French display formatters", () => {
  it("formats a quantity with up to three decimals", () => {
    expect(QUANTITY_FORMAT.format(0)).toBe("0");
    expect(QUANTITY_FORMAT.format(1.5)).toBe("1,5");
    expect(QUANTITY_FORMAT.format(-2.25)).toBe("-2,25");
    expect(QUANTITY_FORMAT.format(1.23456)).toBe("1,235");
    expect(QUANTITY_FORMAT.format(0.0005)).toBe("0,001");
    expect(QUANTITY_FORMAT.format(-0.0004)).toBe("-0");
    expect(QUANTITY_FORMAT.format(1234567.89012)).toBe(`1${NNBSP}234${NNBSP}567,89`);
  });

  it("formats a count with the default French options", () => {
    expect(COUNT_FORMAT.format(0)).toBe("0");
    expect(COUNT_FORMAT.format(7)).toBe("7");
    expect(COUNT_FORMAT.format(-1234)).toBe(`-1${NNBSP}234`);
    expect(COUNT_FORMAT.format(12345678)).toBe(`12${NNBSP}345${NNBSP}678`);
    expect(COUNT_FORMAT.format(1.23456)).toBe("1,235");
  });

  it("formats a moment in Paris across both daylight saving changes", () => {
    expect(PARIS_DATE_TIME_FORMAT.format(new Date("2026-03-29T00:30:00Z"))).toBe("29/03/2026 01:30");
    expect(PARIS_DATE_TIME_FORMAT.format(new Date("2026-03-29T01:30:00Z"))).toBe("29/03/2026 03:30");
    expect(PARIS_DATE_TIME_FORMAT.format(new Date("2026-10-25T00:30:00Z"))).toBe("25/10/2026 02:30");
    expect(PARIS_DATE_TIME_FORMAT.format(new Date("2026-10-25T01:30:00Z"))).toBe("25/10/2026 02:30");
  });

  it("formats the day in Paris, not in UTC", () => {
    expect(PARIS_DAY_FORMAT.format(new Date("2026-03-28T22:59:00Z"))).toBe("28/03/2026");
    expect(PARIS_DAY_FORMAT.format(new Date("2026-03-28T23:30:00Z"))).toBe("29/03/2026");
    expect(PARIS_DAY_FORMAT.format(new Date("2026-10-24T21:30:00Z"))).toBe("24/10/2026");
    expect(PARIS_DAY_FORMAT.format(new Date("2026-10-24T22:30:00Z"))).toBe("25/10/2026");
  });
});
