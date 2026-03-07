import { describe, expect, it } from "vitest";

import {
  assignVersionZeroLotKeys,
  matchVersionZeroLotsByLabel,
  normalizeVersionZeroLotKey,
  parseVersionZeroQuantityInput,
} from "@/lib/estimates/version-zero-utils";

describe("version-zero-utils", () => {
  describe("assignVersionZeroLotKeys", () => {
    it("keeps normalized keys unique when multiple labels collapse to the same slug", () => {
      const lots = assignVersionZeroLotKeys([
        { label: "Électricité", order: 0 },
        { label: "Electricite", order: 1 },
        { label: "CVC-Plomberie", order: 2 },
        { label: "CVC Plomberie", order: 3 },
      ]);

      expect(lots.map((lot) => lot.key)).toEqual([
        "electricite",
        "electricite-2",
        "cvc-plomberie",
        "cvc-plomberie-2",
      ]);
    });

    it("uses the same normalized base key as the matching logic", () => {
      expect(normalizeVersionZeroLotKey("Électricité")).toBe("electricite");
    });
  });

  describe("matchVersionZeroLotsByLabel", () => {
    it("matches duplicate normalized labels in order instead of overwriting earlier lots", () => {
      const matches = matchVersionZeroLotsByLabel(
        [
          { label: "Électricité", order: 0 },
          { label: "Electricite", order: 1 },
        ],
        [
          { lot_label: "Électricité", source: "first" },
          { lot_label: "Electricite", source: "second" },
        ]
      );

      expect(matches).toEqual([
        {
          fallbackLot: { label: "Électricité", order: 0 },
          generatedLot: { lot_label: "Électricité", source: "first" },
        },
        {
          fallbackLot: { label: "Electricite", order: 1 },
          generatedLot: { lot_label: "Electricite", source: "second" },
        },
      ]);
    });
  });

  describe("parseVersionZeroQuantityInput", () => {
    it("accepts French decimal input", () => {
      expect(parseVersionZeroQuantityInput("1,5")).toEqual({
        quantity: 1.5,
        error: null,
      });
      expect(parseVersionZeroQuantityInput("1 234,5")).toEqual({
        quantity: 1234.5,
        error: null,
      });
    });

    it("keeps blank input nullable", () => {
      expect(parseVersionZeroQuantityInput("   ")).toEqual({
        quantity: null,
        error: null,
      });
    });

    it("rejects invalid or negative values instead of coercing them", () => {
      expect(parseVersionZeroQuantityInput("abc")).toEqual({
        quantity: null,
        error: "Quantite invalide. Utilisez un nombre positif, par exemple 1,5.",
      });
      expect(parseVersionZeroQuantityInput("-2")).toEqual({
        quantity: null,
        error: "Quantite invalide. Utilisez un nombre positif, par exemple 1,5.",
      });
    });
  });
});
