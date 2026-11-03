import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { notFound } from "@/lib/estimates/errors";
import type { LabBenchReportSummary } from "@/lib/takeoff/lab/contracts";
import { readLabConfiguration } from "@/lib/takeoff/lab/storage";

// The takeoff:bench reports (TI-660), read only: report.json for the list,
// report.md for the detail. They live beside the lab's output run, in
// TAKEOFF_LAB_BENCH_REPORTS_DIR when set (absolute), else in the parent of
// TAKEOFF_LAB_OUTPUT_DIR (both storage-guard runs of outputs/).

const REPORT_NAME = /^takeoff-bench-[a-z0-9-]{1,80}$/;
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

const ReportSchema = z.looseObject({
  status: z.string().optional(),
  metadata: z.looseObject({
    started_at: z.string().optional(),
    commit: z.string().nullable().optional(),
    dataset: z.looseObject({ sha256: z.string().optional() }).optional(),
  }).optional(),
  couples: z.array(z.looseObject({
    model: z.string(),
    reasoning_effort: z.string().nullable().optional(),
    passes: z.array(z.looseObject({
      summary: z.looseObject({ main: z.looseObject({ all: z.looseObject({ score: z.looseObject({
        keys_ok: z.number().optional(), keys_scored: z.number().optional(),
      }).optional() }).optional() }).optional() }).optional(),
    })).optional(),
  })).optional(),
});

function reportsDirectory() {
  const explicit = process.env.TAKEOFF_LAB_BENCH_REPORTS_DIR?.trim();
  if (explicit) return path.isAbsolute(explicit) ? path.resolve(explicit) : null;
  const configuration = readLabConfiguration();
  return configuration.status === "configured" ? path.dirname(configuration.paths.outputDir) : null;
}

export async function listBenchReports(): Promise<{ directory: string | null; reports: LabBenchReportSummary[] }> {
  const directory = reportsDirectory();
  if (!directory) return { directory: null, reports: [] };
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const reports: LabBenchReportSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !REPORT_NAME.test(entry.name)) continue;
    const json = await readFile(path.join(directory, entry.name, "report.json"), "utf8").catch(() => null);
    if (json === null) continue;
    let parsed: z.infer<typeof ReportSchema>;
    try {
      const result = ReportSchema.safeParse(JSON.parse(json));
      if (!result.success) continue;
      parsed = result.data;
    } catch {
      continue;
    }
    reports.push({
      name: entry.name, started_at: parsed.metadata?.started_at ?? null, commit: parsed.metadata?.commit ?? null,
      dataset_sha256: parsed.metadata?.dataset?.sha256 ?? null, status: parsed.status ?? null,
      couples: (parsed.couples ?? []).map((couple) => {
        const scores = (couple.passes ?? []).map((pass) => pass.summary?.main?.all?.score);
        return { model: couple.model, reasoning_effort: couple.reasoning_effort ?? null, passes: scores.length,
          keys_ok: scores.map((score) => score?.keys_ok ?? 0), keys_scored: scores[0]?.keys_scored ?? null };
      }),
    });
  }
  return { directory, reports: reports.sort((left, right) => (left.name < right.name ? 1 : -1)) };
}

export async function readBenchReportMarkdown(name: string) {
  const directory = reportsDirectory();
  if (!directory || !REPORT_NAME.test(name)) throw notFound("Rapport introuvable.");
  const file = path.join(directory, name, "report.md");
  const size = (await stat(file).catch(() => null))?.size;
  if (size === undefined) throw notFound("Rapport introuvable.");
  if (size > MAX_MARKDOWN_BYTES) throw notFound("Rapport trop volumineux pour le labo : ouvrez report.md.");
  return readFile(file, "utf8");
}
