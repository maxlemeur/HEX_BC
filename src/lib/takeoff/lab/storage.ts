import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { writePrivateJson } from "@/lib/ai/chatgpt-local-store";
import { conflict, notFound } from "@/lib/estimates/errors";
import { ELEMENT_ID_PATTERN, LAB_NAME_PATTERN } from "@/lib/takeoff/lab/contracts";

// Where the takeoff lab (TI-661) reads and writes. TAKEOFF_LAB_DATASET_DIR is
// read only (the L0 dataset, TI-659); TAKEOFF_LAB_OUTPUT_DIR is the lab's
// storage-guard run (`storage_guard.py begin --repo mergeone --run
// takeoff-lab-<yyyymmdd> --kind source`), never the dataset. Both are absolute
// server paths; nothing is hard-coded. Without them the lab shows « Dataset non
// configuré » and only reads the public fictional fixtures.

export const DEFAULT_DECISIONS_MAX_TOKENS = 2_000_000;

export type LabPaths = { datasetDir: string; outputDir: string };
export type LabConfiguration =
  | { status: "configured"; paths: LabPaths }
  | { status: "not_configured"; message: string };

const NOT_CONFIGURED = "Dataset non configuré";

function absolute(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && path.isAbsolute(trimmed) ? path.resolve(trimmed) : null;
}

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function readLabConfiguration(env: NodeJS.ProcessEnv = process.env): LabConfiguration {
  const datasetDir = absolute(env.TAKEOFF_LAB_DATASET_DIR);
  const outputDir = absolute(env.TAKEOFF_LAB_OUTPUT_DIR);
  if (!datasetDir || !outputDir) {
    return { status: "not_configured", message: `${NOT_CONFIGURED} : TAKEOFF_LAB_DATASET_DIR et TAKEOFF_LAB_OUTPUT_DIR doivent être des chemins absolus. Les fixtures fictives restent lisibles ; Lancer et les verdicts sont désactivés.` };
  }
  if (inside(datasetDir, outputDir)) {
    return { status: "not_configured", message: `${NOT_CONFIGURED} : la sortie du labo doit être hors du dataset, qui reste en lecture seule.` };
  }
  return { status: "configured", paths: { datasetDir, outputDir } };
}

/** The configured paths, or a 409 naming what is missing. The output run must already exist (storage-guard begin). */
export async function requireLabPaths(): Promise<LabPaths> {
  const configuration = readLabConfiguration();
  if (configuration.status !== "configured") throw conflict(configuration.message, undefined, "TAKEOFF_LAB_NOT_CONFIGURED");
  const output = await stat(configuration.paths.outputDir).catch(() => null);
  if (!output?.isDirectory()) {
    throw conflict("Le dossier de sortie du labo n’existe pas : créez-le avec storage_guard.py begin (--kind source).", undefined, "TAKEOFF_LAB_NOT_CONFIGURED");
  }
  return configuration.paths;
}

/** Positive integer from TAKEOFF_LAB_DECISIONS_MAX_TOKENS (default TI-658: 2 000 000); null when invalid. */
export function readDecisionsTokenCap(env: NodeJS.ProcessEnv = process.env): number | null {
  const value = env.TAKEOFF_LAB_DECISIONS_MAX_TOKENS?.trim();
  if (!value) return DEFAULT_DECISIONS_MAX_TOKENS;
  return /^[1-9]\d{0,12}$/.test(value) ? Number(value) : null;
}

export function sha256Hex(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

/** JSON with object keys sorted at every depth: the identity of a question set. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) => entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)))
    : entry);
}

export function elementIdOf(runId: string, configId: string, kind: "item" | "question", key: number | string) {
  return sha256Hex(JSON.stringify([runId, configId, kind, key]));
}

function assertName(name: string, what: string) {
  if (!LAB_NAME_PATTERN.test(name)) throw notFound(`${what} introuvable.`);
}

/** A path under the output run, refused unless every segment is a lab name. */
function outputPath(paths: LabPaths, ...segments: string[]) {
  const target = path.join(paths.outputDir, ...segments);
  if (!inside(paths.outputDir, target)) throw new Error("Chemin hors de la sortie du labo.");
  return target;
}

async function privateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return directory;
}

export function runFile(paths: LabPaths, runId: string) {
  assertName(runId, "Essai");
  return outputPath(paths, "runs", `lab-${runId}.json`);
}

export function campaignVerdictsDirectory(paths: LabPaths, campaign: string) {
  assertName(campaign, "Campagne");
  return outputPath(paths, "verdicts", campaign);
}

export function verdictFile(paths: LabPaths, campaign: string, elementId: string) {
  if (!ELEMENT_ID_PATTERN.test(elementId)) throw notFound("Élément introuvable.");
  return path.join(campaignVerdictsDirectory(paths, campaign), `${elementId}.json`);
}

/** Directories 0700, files 0600, written to a temporary file then renamed (no half-written JSON). */
export async function writeLabJson(file: string, value: unknown) {
  await privateDirectory(path.dirname(file));
  await writePrivateJson(file, value);
}

export async function removeLabFile(file: string) {
  await rm(file, { force: true });
}

/** A file the lab wrote that no longer parses is named, never dropped from the stats. */
export class LabFileError extends Error {
  constructor(readonly file: string, cause: unknown) {
    super(`Fichier du labo illisible : ${file}.`, { cause });
    this.name = "LabFileError";
  }
}

export async function readLabJson<T>(file: string, parse: (value: unknown) => T, relativeTo: string): Promise<T> {
  try {
    return parse(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    throw new LabFileError(path.relative(relativeTo, file), error);
  }
}

/** JSON files of a directory of the output run, sorted; none when it does not exist yet. */
export async function listJsonFiles(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json") && !entry.name.startsWith("."))
    .map((entry) => path.join(directory, entry.name)).sort();
}

export async function listDirectories(directory: string) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries.filter((entry) => entry.isDirectory() && LAB_NAME_PATTERN.test(entry.name)).map((entry) => entry.name).sort();
}

export function outputSubdirectory(paths: LabPaths, name: "runs" | "verdicts") {
  return outputPath(paths, name);
}
