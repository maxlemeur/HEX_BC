import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateTakeoffBenchmark,
  type TakeoffBenchmarkItem,
} from "@/lib/takeoff/benchmark";

type GoldenFixture = {
  fixture: string;
  source_pdf_sha256: string;
  page_count: number;
  truth_page: number;
  plan_only_benchmark: {
    source_page: number;
    observable_item_ids: string[];
    not_directly_observable_item_ids: string[];
    policy: string;
    expected_items: TakeoffBenchmarkItem[];
  };
  items: TakeoffBenchmarkItem[];
};

async function loadGoldenFixture() {
  const fixtureDirectory = resolve(process.cwd(), "docs/test-fixtures");
  const expectedPath = resolve(
    fixtureDirectory,
    "fake-plan-lot-archi.expected.json"
  );
  const expected = JSON.parse(
    await readFile(expectedPath, "utf8")
  ) as GoldenFixture;
  const pdf = await readFile(resolve(fixtureDirectory, expected.fixture));
  const actualHash = createHash("sha256").update(pdf).digest("hex");
  expect(actualHash).toBe(expected.source_pdf_sha256);
  return expected;
}

function makeLocalizedCandidate(
  item: TakeoffBenchmarkItem,
  index: number
): TakeoffBenchmarkItem {
  return {
    ...item,
    confidence: 0.92,
    evidence: `Tableau récapitulatif, poste ${String(index + 1).padStart(2, "0")}.`,
    source_page: 2,
  } satisfies TakeoffBenchmarkItem;
}

describe("evaluateTakeoffBenchmark", () => {
  it("binds the 24-line ground truth to the rendered plan fixture", async () => {
    const expected = await loadGoldenFixture();
    const candidate = expected.items.map(makeLocalizedCandidate);

    const report = evaluateTakeoffBenchmark(expected.items, candidate);

    expect(expected.page_count).toBe(2);
    expect(expected.truth_page).toBe(2);
    expect(report).toMatchObject({
      passed: true,
      expectedCount: 24,
      candidateCount: 24,
      matchedCount: 24,
      quantityMatchCount: 24,
      localizedProofCount: 24,
      highConfidenceCount: 24,
      highConfidenceErrorCount: 0,
      precision: 1,
      recall: 1,
      quantityAccuracy: 1,
      localizedProofCoverage: 1,
      highConfidenceErrorRate: 0,
      failedChecks: [],
    });
  });

  it("separates plan-visible quantities from quantities that would require guessing", async () => {
    const expected = await loadGoldenFixture();
    const allIds = expected.items.map((item) => item.id);
    const partitionIds = [
      ...expected.plan_only_benchmark.observable_item_ids,
      ...expected.plan_only_benchmark.not_directly_observable_item_ids,
    ];
    const observableItems = expected.plan_only_benchmark.expected_items;
    const candidate = observableItems.map((item) => ({
      ...item,
      confidence: 0.92,
      evidence: `Surface explicitement libellée dans la pièce ${item.designation}.`,
      source_page: expected.plan_only_benchmark.source_page,
    }));

    expect(new Set(partitionIds)).toEqual(new Set(allIds));
    expect(observableItems.map((item) => item.id)).toEqual(
      expected.plan_only_benchmark.observable_item_ids
    );
    expect(observableItems).toHaveLength(8);
    expect(evaluateTakeoffBenchmark(observableItems, candidate)).toMatchObject({
      passed: true,
      expectedCount: 8,
      candidateCount: 8,
      matchedCount: 8,
      quantityMatchCount: 8,
      localizedProofCount: 8,
    });
  });

  it("matches an SDB label with its expanded salle de bain wording", () => {
    const report = evaluateTakeoffBenchmark(
      [{ designation: "SDB - surface", quantity: 6, unit: "m2" }],
      [
        {
          designation: "Surface SDB (Salle de bain)",
          quantity: 6,
          unit: "m2",
          confidence: 0.99,
          evidence: "Mention SDB 6.0 m2 visible sur la page.",
          source_page: 1,
        },
      ]
    );

    expect(report).toMatchObject({
      passed: true,
      matchedCount: 1,
      quantityMatchCount: 1,
      highConfidenceErrorCount: 0,
    });
  });

  it("fails a high-confidence quantity error instead of trusting its score", async () => {
    const expected = await loadGoldenFixture();
    const candidate = expected.items.map(makeLocalizedCandidate);
    candidate[8] = {
      ...candidate[8],
      quantity: 420,
      confidence: 0.99,
    };

    const report = evaluateTakeoffBenchmark(expected.items, candidate);

    expect(report.passed).toBe(false);
    expect(report.quantityMatchCount).toBe(23);
    expect(report.highConfidenceErrorCount).toBe(1);
    expect(report.failedChecks).toEqual([
      "quantity_accuracy",
      "high_confidence_error_rate",
    ]);
  });

  it("fails when a candidate cannot localize every extracted quantity", async () => {
    const expected = await loadGoldenFixture();
    const candidate = expected.items.map(makeLocalizedCandidate);
    candidate[0] = {
      ...candidate[0],
      evidence: null,
      source_page: null,
    };

    const report = evaluateTakeoffBenchmark(expected.items, candidate);

    expect(report.passed).toBe(false);
    expect(report.localizedProofCount).toBe(23);
    expect(report.failedChecks).toContain("localized_proof_coverage");
  });

  it("counts an unmatched high-confidence item as a false positive", () => {
    const expected = [
      { designation: "Cloison BA13", quantity: 42, unit: "ml" },
    ];
    const candidate = [
      makeLocalizedCandidate(expected[0], 0),
      {
        designation: "Canalisation fantôme",
        quantity: 100,
        unit: "ml",
        confidence: 0.98,
        evidence: "Aucune correspondance dans la vérité terrain.",
        source_page: 2,
      },
    ];

    const report = evaluateTakeoffBenchmark(expected, candidate);

    expect(report.passed).toBe(false);
    expect(report.falsePositiveCount).toBe(1);
    expect(report.precision).toBe(0.5);
    expect(report.highConfidenceErrorCount).toBe(1);
    expect(report.failedChecks).toEqual([
      "precision",
      "high_confidence_error_rate",
    ]);
  });
});
