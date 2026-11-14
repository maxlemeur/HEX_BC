import { describe, expect, it } from "vitest";

import { orderedLineMark } from "./format";

/**
 * Failure mode (TI-691, the owner's walk of 2026-11-14): a request line in a draft purchase order read « Commandé »
 * although nothing was sent nor confirmed. The line says where its order stands, with the words of the supply cost:
 * « commandé » once the supplier confirmed; a canceled order holds no line.
 */
describe("orderedLineMark", () => {
  it.each<[string, string | null]>([
    ["draft", "Brouillon de bon : C-2611-004"],
    ["sent", "Bon envoyé : C-2611-004"],
    ["confirmed", "Commandé : C-2611-004"],
    ["received", "Reçu : C-2611-004"],
    ["canceled", null],
  ])("an order %s", (status, mark) => {
    expect(orderedLineMark(status, "C-2611-004")).toBe(mark);
  });
});
