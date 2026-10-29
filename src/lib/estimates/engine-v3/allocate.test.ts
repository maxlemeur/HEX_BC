import { describe, expect, it } from "vitest";

import { allocateExact, type AllocationEntry } from "@/lib/estimates/engine-v3/allocate";

// Lot 2, sous-lot 2.4 (docs/testing/estimate-engine-v3-2.4.md, F-V3-04). Isolation justifiée :
// la répartition au plus grand reste fixe les nets, la TVA de ligne et les parts FO/MO de chaque
// ligne v3 ; une somme fausse d'un centime ou un départage qui dépend de l'ordre d'affichage
// ne se voit sur aucun écran (moteur inerte en 2.4) et ne se révèle que sur des tirages massifs.

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomUuid(random: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(random() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function shuffled<T>(values: readonly T[], random: () => number): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

const ZERO = BigInt(0);
const ONE = BigInt(1);

describe("allocateExact (largest remainder, exact integers)", () => {
  it("10 000 seeded draws: exact sum, quota bounds, largest remainders, key ties, permutation stability", () => {
    const random = mulberry32(20261017);
    for (let draw = 0; draw < 10_000; draw += 1) {
      const size = 1 + Math.floor(random() * 12);
      const amount = BigInt(Math.floor(random() * 1_000_000));
      const pool = [ZERO, ONE, BigInt(7), BigInt(1000)];
      const entries: AllocationEntry[] = Array.from({ length: size }, () => ({
        key: randomUuid(random),
        // Un tiers de poids pris dans un petit ensemble : ex aequo et poids nuls fréquents.
        weight:
          random() < 0.33
            ? pool[Math.floor(random() * pool.length)]
            : BigInt(Math.floor(random() * 1_000_000_000)),
      }));
      const total = entries.reduce((sum, entry) => sum + entry.weight, ZERO);
      const parts = allocateExact(amount, entries);

      const violations: string[] = [];
      if (parts.length !== size) violations.push("length");
      if (parts.reduce((sum, part) => sum + part, ZERO) !== amount) violations.push("sum");

      if (total === ZERO) {
        const base = amount / BigInt(size);
        const extra = Number(amount % BigInt(size));
        const byKey = entries.map((entry, index) => ({ key: entry.key, part: parts[index] }));
        byKey.sort((left, right) => (left.key < right.key ? -1 : 1));
        byKey.forEach((row, rank) => {
          if (row.part !== (rank < extra ? base + ONE : base)) violations.push("equal split");
        });
      } else {
        const remainders = entries.map((entry) => (amount * entry.weight) % total);
        const floors = entries.map((entry) => (amount * entry.weight) / total);
        parts.forEach((part, index) => {
          if (part !== floors[index] && part !== floors[index] + ONE) violations.push("quota");
        });
        // Toute unité supplémentaire va à un plus grand reste, ex aequo à la plus petite clé.
        entries.forEach((winner, i) => {
          if (parts[i] !== floors[i] + ONE) return;
          entries.forEach((loser, j) => {
            if (parts[j] !== floors[j]) return;
            const wins =
              remainders[i] > remainders[j] ||
              (remainders[i] === remainders[j] && winner.key < loser.key);
            if (!wins) violations.push("largest remainder");
          });
        });
      }

      const permuted = shuffled(entries, random);
      const permutedParts = allocateExact(amount, permuted);
      const partByKey = new Map(entries.map((entry, index) => [entry.key, parts[index]]));
      permuted.forEach((entry, index) => {
        if (permutedParts[index] !== partByKey.get(entry.key)) violations.push("permutation");
      });
      expect({ draw, violations }).toEqual({ draw, violations: [] });
    }
  });

  it("refuses a negative amount, a negative weight and duplicated keys", () => {
    expect(() => allocateExact(BigInt(-1), [{ key: "a", weight: ONE }])).toThrow();
    expect(() => allocateExact(ONE, [{ key: "a", weight: BigInt(-1) }])).toThrow();
    expect(() => allocateExact(ONE, [{ key: "a", weight: ONE }, { key: "a", weight: ONE }])).toThrow();
  });
});
