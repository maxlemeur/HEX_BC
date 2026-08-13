import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument } from "pdf-lib";

import {
  evaluateTakeoffBenchmark,
  type TakeoffBenchmarkItem,
} from "@/lib/takeoff/benchmark";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";
import { getTakeoffPromptRuntimeConfig } from "@/lib/takeoff/prompts";
import { TakeoffExchangeSchema } from "@/lib/takeoff/schemas";

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

function sha256(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function buildPlanOnlyPdf(sourcePdf: Uint8Array, sourcePage: number) {
  const sourceDocument = await PDFDocument.load(sourcePdf);
  if (sourcePage < 1 || sourcePage > sourceDocument.getPageCount()) {
    throw new Error(`Page source invalide pour le benchmark: ${sourcePage}.`);
  }

  const isolatedDocument = await PDFDocument.create();
  const [page] = await isolatedDocument.copyPages(sourceDocument, [sourcePage - 1]);
  isolatedDocument.addPage(page);
  return isolatedDocument.save({ useObjectStreams: false });
}

async function main() {
  const workspace = process.cwd();
  const fixtureDirectory = path.join(workspace, "docs", "test-fixtures");
  const expectedPath = path.join(
    fixtureDirectory,
    "fake-plan-lot-archi.expected.json"
  );
  const outputPath = path.join(
    workspace,
    "tmp",
    "pdfs",
    "fake-plan-lot-archi.provider-observed.json"
  );
  const expected = JSON.parse(
    await readFile(expectedPath, "utf8")
  ) as GoldenFixture;
  const sourcePath = path.join(fixtureDirectory, expected.fixture);
  const sourcePdf = await readFile(sourcePath);
  const sourceHash = sha256(sourcePdf);
  if (sourceHash !== expected.source_pdf_sha256) {
    throw new Error("Le hash du PDF source ne correspond pas à la vérité terrain.");
  }
  if (
    expected.truth_page === expected.plan_only_benchmark.source_page ||
    expected.truth_page < 1 ||
    expected.truth_page > expected.page_count
  ) {
    throw new Error("La page de vérité terrain n'est pas correctement isolée.");
  }
  if (
    expected.plan_only_benchmark.expected_items.length !==
      expected.plan_only_benchmark.observable_item_ids.length ||
    expected.plan_only_benchmark.expected_items.some(
      (item, index) =>
        item.id !== expected.plan_only_benchmark.observable_item_ids[index]
    )
  ) {
    throw new Error("Le périmètre observable du benchmark est incohérent.");
  }

  const planOnlyPdf = await buildPlanOnlyPdf(
    sourcePdf,
    expected.plan_only_benchmark.source_page
  );
  const runtime = getTakeoffPromptRuntimeConfig("C", {
    fileType: "application/pdf",
    schemaVersion: "v1",
    sourceHint: expected.fixture,
  });
  const providerEvents: unknown[] = [];
  const result = await callGeminiStructured(
    {
      prompt: runtime.prompt,
      schema: TakeoffExchangeSchema,
      files: [
        {
          data: Buffer.from(planOnlyPdf).toString("base64"),
          mimeType: "application/pdf",
        },
      ],
      thinkingLevel: runtime.thinkingLevel,
      timeoutMs: 180_000,
      maxRetries: 0,
      deliveryMode: "sync",
      context: {
        jobId: "local-plan-only-benchmark",
        tenantId: "local-no-persistence",
        level: "C",
        promptVersion: runtime.promptVersion,
        model: runtime.model,
      },
    },
    {
      logger: (event) => providerEvents.push(event),
    }
  );
  const report = evaluateTakeoffBenchmark(
    expected.plan_only_benchmark.expected_items,
    result.data.items
  );
  const artifact = {
    observed_at: new Date().toISOString(),
    persistence: "none",
    source: {
      file: path.relative(workspace, sourcePath).replaceAll("\\", "/"),
      sha256: sourceHash,
      page_count: expected.page_count,
      selected_pages: [expected.plan_only_benchmark.source_page],
      selected_pdf_sha256: sha256(planOnlyPdf),
      hidden_truth_page: expected.truth_page,
      policy: expected.plan_only_benchmark.policy,
    },
    provider: {
      model: result.model,
      prompt_version: result.promptVersion,
      thinking_level: runtime.thinkingLevel,
      token_usage: result.tokenUsage,
      token_count: result.tokenCount,
      cost_cents: result.costCents,
      duration_ms: result.durationMs,
      events: providerEvents,
    },
    exchange: result.data,
    report,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify(
      {
        output: path.relative(workspace, outputPath).replaceAll("\\", "/"),
        provider: artifact.provider,
        report: artifact.report,
      },
      null,
      2
    )
  );

  if (!report.passed) {
    throw new Error(
      `Benchmark fournisseur en échec: ${report.failedChecks.join(", ")}.`
    );
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
