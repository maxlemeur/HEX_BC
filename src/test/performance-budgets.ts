import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

type ClientModuleManifest = {
  chunks: string[];
};

type RouteClientReferenceManifest = {
  clientModules: Record<string, ClientModuleManifest>;
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
  const assignment = /globalThis\.__RSC_MANIFEST\[\s*"(?:[^"\\]|\\.)*"\s*\]\s*=\s*/.exec(source);
  if (!assignment) {
    throw new Error("Invalid Next.js client reference manifest assignment.");
  }

  const json = source
    .slice(assignment.index + assignment[0].length)
    .trim()
    .replace(/;$/, "");
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid Next.js client reference manifest.");
  }
  const clientModules = (parsed as { clientModules?: unknown }).clientModules;
  if (!clientModules || typeof clientModules !== "object" || Array.isArray(clientModules)) {
    throw new Error("Invalid Next.js client reference manifest modules.");
  }
  Object.values(clientModules).forEach((module: unknown) => {
    if (!module || typeof module !== "object" || Array.isArray(module)) {
      throw new Error("Invalid Next.js client reference manifest module.");
    }
    const chunks = (module as { chunks?: unknown }).chunks;
    if (!Array.isArray(chunks) || !chunks.every((chunk: unknown) => typeof chunk === "string")) {
      throw new Error("Invalid Next.js client reference manifest chunks.");
    }
  });
  return parsed as RouteClientReferenceManifest;
}

function clientChunkPath(chunk: string) {
  const encodedPath = chunk.split(/[?#]/, 1)[0];
  if (!encodedPath.endsWith(".js")) return null;
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(encodedPath.replace(/^\/_next\//, ""));
  } catch (cause) {
    throw new Error("Invalid Next.js client chunk path: " + chunk, { cause });
  }
  if (
    !decodedPath.startsWith("static/chunks/") ||
    /[\\\0]/.test(decodedPath) ||
    decodedPath.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid Next.js client chunk path: " + chunk);
  }
  return decodedPath;
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

  Object.values(manifest.clientModules).forEach((module) => {
    module.chunks.forEach((chunk) => {
      const chunkPath = clientChunkPath(chunk);
      if (chunkPath) chunks.add(chunkPath);
    });
  });
  if (chunks.size === 0) {
    throw new Error("Invalid Next.js client reference manifest: no JavaScript chunks.");
  }

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
