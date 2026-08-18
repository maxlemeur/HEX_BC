import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

type ClientModuleManifest = {
  chunks?: unknown;
};

type RouteClientReferenceManifest = {
  clientModules?: Record<string, ClientModuleManifest>;
};

export type PerformanceBudget = {
  name: string;
  manifest: string;
  maxRawBytes: number;
  maxGzipBytes: number;
};

export type PerformanceBudgetConfig = {
  version: 1;
  budgets: PerformanceBudget[];
};

export type PerformanceBudgetMeasurement = {
  name: string;
  chunkCount: number;
  rawBytes: number;
  gzipBytes: number;
  maxRawBytes: number;
  maxGzipBytes: number;
};

function parseClientReferenceManifest(source: string) {
  const assignmentMarker = "] = ";
  const assignmentIndex = source.lastIndexOf(assignmentMarker);
  if (assignmentIndex === -1) {
    throw new Error("Invalid Next.js client reference manifest assignment.");
  }

  const json = source
    .slice(assignmentIndex + assignmentMarker.length)
    .trim()
    .replace(/;$/, "");
  return JSON.parse(json) as RouteClientReferenceManifest;
}

function isPerformanceBudget(value: unknown): value is PerformanceBudget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.manifest === "string" &&
    typeof candidate.maxRawBytes === "number" &&
    candidate.maxRawBytes > 0 &&
    typeof candidate.maxGzipBytes === "number" &&
    candidate.maxGzipBytes > 0
  );
}

export function readPerformanceBudgetConfig(
  configPath = "config/performance-budgets.json"
): PerformanceBudgetConfig {
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid performance budget config.");
  }

  const candidate = parsed as Record<string, unknown>;
  if (
    candidate.version !== 1 ||
    !Array.isArray(candidate.budgets) ||
    !candidate.budgets.every(isPerformanceBudget)
  ) {
    throw new Error("Invalid performance budget config.");
  }

  return candidate as PerformanceBudgetConfig;
}

export function measurePerformanceBudget(input: {
  buildDirectory: string;
  budget: PerformanceBudget;
}): PerformanceBudgetMeasurement {
  const manifestPath = path.join(
    input.buildDirectory,
    ...input.budget.manifest.split("/")
  );
  const manifest = parseClientReferenceManifest(
    fs.readFileSync(manifestPath, "utf8")
  );
  const chunks = new Set<string>();

  Object.values(manifest.clientModules ?? {}).forEach((module) => {
    if (!Array.isArray(module.chunks)) return;
    module.chunks.forEach((chunk) => {
      if (typeof chunk === "string" && chunk.endsWith(".js")) {
        chunks.add(chunk.replace(/^\/_next\//, ""));
      }
    });
  });

  let rawBytes = 0;
  let gzipBytes = 0;
  chunks.forEach((chunk) => {
    const content = fs.readFileSync(path.join(input.buildDirectory, chunk));
    rawBytes += content.byteLength;
    gzipBytes += gzipSync(content).byteLength;
  });

  return {
    name: input.budget.name,
    chunkCount: chunks.size,
    rawBytes,
    gzipBytes,
    maxRawBytes: input.budget.maxRawBytes,
    maxGzipBytes: input.budget.maxGzipBytes,
  };
}

export function assertPerformanceBudget(
  measurement: PerformanceBudgetMeasurement
) {
  const failures: string[] = [];
  if (measurement.rawBytes > measurement.maxRawBytes) {
    failures.push(
      `raw ${measurement.rawBytes} > ${measurement.maxRawBytes} bytes`
    );
  }
  if (measurement.gzipBytes > measurement.maxGzipBytes) {
    failures.push(
      `gzip ${measurement.gzipBytes} > ${measurement.maxGzipBytes} bytes`
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `Performance budget failed for ${measurement.name}: ${failures.join(", ")}.`
    );
  }
}

export function runPerformanceBudgetCheck(input?: {
  buildDirectory?: string;
  configPath?: string;
}) {
  const buildDirectory = input?.buildDirectory ?? ".next";
  const config = readPerformanceBudgetConfig(input?.configPath);
  const measurements = config.budgets.map((budget) => {
    const measurement = measurePerformanceBudget({ buildDirectory, budget });
    assertPerformanceBudget(measurement);
    return measurement;
  });
  return { measurements };
}
