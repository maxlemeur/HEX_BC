import { describe, expect, it } from "vitest";

import { formatFilenameDate, sanitizeDownloadFilename } from "@/lib/download-filename";

describe("sanitizeDownloadFilename", () => {
  it.each([
    ["  Devis  Dupont  V2 ", "Devis_Dupont_V2"],
    ['Lot 1/2: "plomberie" <a>|b', "Lot_1-2-_-plomberie-_-a-b"],
    ["__-Commande--42__-", "Commande-42"],
    ["a\\b*c?d", "a-b-c-d"],
    ["Électricité générale", "Électricité_générale"],
    ["   ", ""],
  ])("sanitizes %j", (input, expected) => {
    expect(sanitizeDownloadFilename(input)).toBe(expected);
  });
});

describe("formatFilenameDate", () => {
  it("keeps the UTC calendar date and returns an empty string for invalid input", () => {
    expect(formatFilenameDate("2026-11-16")).toBe("2026-11-16");
    expect(formatFilenameDate("2026-11-16T23:30:00-02:00")).toBe("2026-11-17");
    expect(formatFilenameDate("not a date")).toBe("");
  });
});
