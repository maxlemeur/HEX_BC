import "server-only";

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { badRequest, conflict, notFound } from "@/lib/estimates/errors";
import { buildScoreScopes, type ScoreScope } from "@/lib/takeoff/bench/score";
import { ManifestSchema, TruthFileSchema } from "@/lib/takeoff/bench/schemas";
import { LAB_DATASET_LAYOUT, LAB_NAME_PATTERN, type LabDocumentSummary } from "@/lib/takeoff/lab/contracts";
import { readLabConfiguration, sha256Hex } from "@/lib/takeoff/lab/storage";

// Documents of the takeoff lab (TI-661): the PDF binaries of the dataset's
// manifest.json (the private L0 dataset, or a fictional one in E2E) and two
// public fictional fixtures of the repository, readable without configuration.
// A dataset PDF is sent only if its size and SHA-256 are still the manifest's.
// Truth, used to score an extraction of the whole PDF:
// - lines: lab/truth/<id>.json, items { designation, quantity, unit } scored by
//   evaluateTakeoffBenchmark (designation similarity >= 0.8, as the fixture);
// - keys: the bench truth (truth/*.json, TI-659) when the manifest is a bench
//   manifest, scored by the bench (TI-660) for a scope made of this document only.

const FIXTURE_PREFIX = "fixture-";
const FIXTURES = [
  { id: "fixture-army-chatgpt-plan", label: "Plan fictif ARMY (cuivre et vannes)", file: "e2e/fixtures/takeoff/army-chatgpt-plan.pdf" },
  { id: "fixture-fake-plan-lot-archi", label: "Plan fictif lot architecture", file: "docs/test-fixtures/fake-plan-lot-archi.pdf" },
] as const;

const ManifestEntrySchema = z.looseObject({
  id: z.string(),
  file_type: z.string().optional(),
  raw_status: z.string().optional(),
  raw_path: z.string().nullable().optional(),
  sha256: z.string().nullable().optional(),
  file_size: z.number().int().nonnegative().nullable().optional(),
  pages: z.number().int().min(1).nullable().optional(),
  lot: z.string().optional(),
  kind: z.string().optional(),
  role: z.string().optional(),
});
const LabManifestSchema = z.looseObject({ documents: z.array(z.unknown()) });

const LineTruthSchema = z.object({
  schema_version: z.literal(1),
  document: z.string(),
  items: z.array(z.object({
    designation: z.string().trim().min(1),
    quantity: z.number().finite().nonnegative(),
    unit: z.string().trim().min(1),
  }).strict()).min(1),
}).strict();
export type LabLineTruth = z.infer<typeof LineTruthSchema>;

type DatasetEntry = { id: string; rawPath: string; sha256: string; size: number; pages: number; label: string };

async function readJson(file: string) {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function datasetLabel(entry: z.infer<typeof ManifestEntrySchema>) {
  return [entry.id, entry.kind, entry.lot ? `lot ${entry.lot}` : null, entry.role].filter(Boolean).join(" · ");
}

/** PDF binaries of the manifest with an id the lab can store (dataset ids never start with « fixture- »). */
async function readDatasetEntries(datasetDir: string): Promise<DatasetEntry[]> {
  const manifest = LabManifestSchema.safeParse(await readJson(path.join(datasetDir, LAB_DATASET_LAYOUT.manifest)).catch(() => null));
  if (!manifest.success) throw conflict("Le manifest.json du dataset est absent ou illisible.", undefined, "TAKEOFF_LAB_DATASET");
  const entries: DatasetEntry[] = [];
  for (const value of manifest.data.documents) {
    const parsed = ManifestEntrySchema.safeParse(value);
    if (!parsed.success) continue;
    const entry = parsed.data;
    if (!LAB_NAME_PATTERN.test(entry.id) || entry.id.startsWith(FIXTURE_PREFIX)) continue;
    if ((entry.file_type ?? "pdf") !== "pdf" || (entry.raw_status ?? "binary") !== "binary") continue;
    if (entry.raw_path !== LAB_DATASET_LAYOUT.raw(entry.id) || !entry.sha256 || !/^[0-9a-f]{64}$/.test(entry.sha256)
      || typeof entry.file_size !== "number" || typeof entry.pages !== "number") continue;
    entries.push({ id: entry.id, rawPath: entry.raw_path, sha256: entry.sha256, size: entry.file_size, pages: entry.pages, label: datasetLabel(entry) });
  }
  return entries.sort((left, right) => (left.id < right.id ? -1 : 1));
}

async function readLineTruth(datasetDir: string, id: string): Promise<LabLineTruth | null> {
  const file = path.join(datasetDir, LAB_DATASET_LAYOUT.lineTruth(id));
  const value = await readJson(file).catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : Promise.reject(error)));
  if (value === null) return null;
  const parsed = LineTruthSchema.safeParse(value);
  if (!parsed.success || parsed.data.document !== id) throw conflict(`Vérité du labo invalide : ${LAB_DATASET_LAYOUT.lineTruth(id)}.`, undefined, "TAKEOFF_LAB_DATASET");
  return parsed.data;
}

/** Per document, the bench scopes made of that document alone, when the dataset is a bench dataset (TI-659). */
async function readKeyScopeIndex(datasetDir: string): Promise<Map<string, ScoreScope[]>> {
  const index = new Map<string, ScoreScope[]>();
  const manifest = ManifestSchema.safeParse(await readJson(path.join(datasetDir, LAB_DATASET_LAYOUT.manifest)).catch(() => null));
  if (!manifest.success) return index;
  const directory = path.join(datasetDir, "truth");
  const names = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const truthFiles = [];
  for (const entry of names) {
    if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "noise.json") continue;
    const truth = TruthFileSchema.safeParse(await readJson(path.join(directory, entry.name)).catch(() => null));
    // takeoff:bench:check refuses such a dataset: the lab scores nothing rather than a part of it.
    if (!truth.success) return index;
    truthFiles.push({ file: `truth/${entry.name}`, truth: truth.data });
  }
  let scopes: ScoreScope[];
  try {
    scopes = buildScoreScopes(truthFiles, manifest.data.documents);
  } catch {
    // A truth citing a document the manifest lacks: refused by takeoff:bench:check too.
    return index;
  }
  for (const scope of scopes) {
    if (scope.documents.length !== 1) continue;
    const id = scope.documents[0].id;
    index.set(id, [...(index.get(id) ?? []), scope]);
  }
  return index;
}

export type LabTruth = { kind: "lines"; file: string; truth: LabLineTruth } | { kind: "keys"; file: string; scopes: ScoreScope[] } | null;

export async function readLabTruth(datasetDir: string, id: string, keyIndex?: Map<string, ScoreScope[]>): Promise<LabTruth> {
  const lines = await readLineTruth(datasetDir, id);
  if (lines) return { kind: "lines", file: LAB_DATASET_LAYOUT.lineTruth(id), truth: lines };
  const scopes = (keyIndex ?? await readKeyScopeIndex(datasetDir)).get(id) ?? [];
  return scopes.length > 0 ? { kind: "keys", file: scopes.map((scope) => scope.id).join(" + "), scopes } : null;
}

async function fixtureEntries() {
  const entries = [];
  for (const fixture of FIXTURES) {
    const bytes = await readFile(path.join(process.cwd(), fixture.file)).catch(() => null);
    if (bytes) entries.push({ ...fixture, bytes });
  }
  return entries;
}

async function pdfPageCount(bytes: Uint8Array) {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount();
}

/**
 * The documents the lab offers: fictional fixtures always, the dataset's PDFs when configured. An
 * unreadable dataset (no manifest.json, wrong path) is reported, never thrown: the fixtures stay usable.
 */
export async function listLabDocuments(): Promise<{ documents: LabDocumentSummary[]; error: string | null }> {
  const documents: LabDocumentSummary[] = [];
  let error: string | null = null;
  const configuration = readLabConfiguration();
  if (configuration.status === "configured") {
    const { datasetDir } = configuration.paths;
    try {
      const keyIndex = await readKeyScopeIndex(datasetDir);
      for (const entry of await readDatasetEntries(datasetDir)) {
        const truth = await readLabTruth(datasetDir, entry.id, keyIndex).catch(() => null);
        documents.push({ id: entry.id, source: "dataset", label: entry.label, pages: entry.pages, truth: truth?.kind ?? null });
      }
    } catch (cause) {
      documents.length = 0;
      error = `Dataset non configuré : ${cause instanceof Error ? cause.message : "dataset illisible."} Les fixtures fictives restent lisibles.`;
    }
  }
  for (const fixture of await fixtureEntries()) {
    documents.push({ id: fixture.id, source: "fixture", label: fixture.label, pages: await pdfPageCount(fixture.bytes), truth: null });
  }
  return { documents, error };
}

export type LabDocument = { summary: LabDocumentSummary; bytes: Buffer; sha256: string };

/** The document's bytes; a dataset PDF only while its size and SHA-256 match the manifest. */
/**
 * A lab document. With `expectedSha256` (the hash an essai recorded), a document that changed under
 * the same id since the essai is refused: its verdicts must never be judged against other evidence.
 */
export async function readLabDocument(id: string, options: { expectedSha256?: string } = {}): Promise<LabDocument> {
  const document = await readCurrentLabDocument(id);
  if (options.expectedSha256 !== undefined && options.expectedSha256 !== document.sha256) {
    throw conflict("Ce document a changé depuis l’essai (SHA-256 différent) : il ne peut plus servir de preuve pour ses verdicts.",
      undefined, "TAKEOFF_LAB_DOCUMENT_CHANGED");
  }
  return document;
}

async function readCurrentLabDocument(id: string): Promise<LabDocument> {
  if (!LAB_NAME_PATTERN.test(id)) throw notFound("Document introuvable.");
  if (id.startsWith(FIXTURE_PREFIX)) {
    const fixture = (await fixtureEntries()).find((entry) => entry.id === id);
    if (!fixture) throw notFound("Document introuvable.");
    return { summary: { id, source: "fixture", label: fixture.label, pages: await pdfPageCount(fixture.bytes), truth: null },
      bytes: fixture.bytes, sha256: sha256Hex(fixture.bytes) };
  }
  const configuration = readLabConfiguration();
  if (configuration.status !== "configured") throw conflict(configuration.message, undefined, "TAKEOFF_LAB_NOT_CONFIGURED");
  const { datasetDir } = configuration.paths;
  const entry = (await readDatasetEntries(datasetDir)).find((candidate) => candidate.id === id);
  if (!entry) throw notFound("Document introuvable dans le manifest du dataset.");
  const file = path.join(datasetDir, entry.rawPath);
  const size = (await stat(file).catch(() => null))?.size;
  if (size !== entry.size) throw conflict(`${entry.rawPath} : taille différente du manifest, document refusé.`, undefined, "TAKEOFF_LAB_DATASET");
  const bytes = await readFile(file);
  const sha256 = sha256Hex(bytes);
  if (sha256 !== entry.sha256) throw conflict(`${entry.rawPath} : SHA-256 différent du manifest, document refusé.`, undefined, "TAKEOFF_LAB_DATASET");
  const truth = await readLabTruth(datasetDir, id);
  return { summary: { id, source: "dataset", label: entry.label, pages: entry.pages, truth: truth?.kind ?? null }, bytes, sha256 };
}

export function assertCropPage(document: LabDocument, page: number) {
  if (page > document.summary.pages) throw badRequest(`La page ${page} dépasse les ${document.summary.pages} pages du document.`);
}
