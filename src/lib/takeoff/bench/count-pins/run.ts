import { createHash } from "node:crypto";
import { boxContains, type Point } from "../../vectors/geometry";
import { extractVectorPage } from "../../vectors/extraction";
import { FICTION_TARGETS, fictionalSheets } from "./fiction";
import { combine } from "./fusion";
import { readDeterministic } from "./propose";
import { replayTiles, tileLayout } from "./replay";
import { aggregateSpatial, quantityScore } from "./report";
import { MATCH_RADIUS, metrics, scorePage } from "./score";
import { indexSymbolPage } from "./symbols";
import type { JudgedPin, PageFrame, Pin, Poste } from "./types";

const readerExamples = {
  label: 0,
  cluster: 0,
  example1: 1,
  example2: 2,
  "pipe-unseeded": 0,
  pipe: 2,
  "label+example": 2,
  "label+pipe": 2,
  "all-deterministic": 2,
  "tile-replay": 0,
  "fusion-with-replay": 2,
} as const;
export type Method = keyof typeof readerExamples;
export const METHODS = Object.keys(readerExamples) as Method[];

function typePins(pins: Pin[], targets: readonly Poste[]): JudgedPin[] {
  return pins.map((pin) => {
    const compatible = targets.filter((target) => target.organ === pin.organ);
    // The fictional list has unique families. The historical reader supplies
    // only a family, so it must abstain when that evidence leaves several postes.
    const poste = compatible.length === 1 ? compatible[0] : null;
    return { ...pin, poste: poste?.id ?? null, dn: poste?.requiresDn ? pin.dn : null };
  });
}

function syntheticRecordings(page: PageFrame, points: Awaited<ReturnType<typeof fictionalSheets>>[number]["replay"], truncated?: number) {
  return tileLayout(page).map(({ id, crop }) => {
    if (id === truncated) return { id, status: "truncated" };
    return {
      id, status: "complete",
      pins: points.flatMap(([x, y, poste, dn]) => {
        const box = { x0: x - 2, y0: y - 2, x1: x + 2, y1: y + 2 };
        if (!boxContains(crop, { x: box.x0, y: box.y0 }) || !boxContains(crop, { x: box.x1, y: box.y1 })) return [];
        return [{
          poste, dn,
          x0: (box.x0 - crop.x0) / (crop.x1 - crop.x0),
          y0: (box.y0 - crop.y0) / (crop.y1 - crop.y0),
          x1: (box.x1 - crop.x0) / (crop.x1 - crop.x0),
          y1: (box.y1 - crop.y0) / (crop.y1 - crop.y0),
        }];
      }),
    };
  });
}

function combineReaders(vector: JudgedPin[], replay: JudgedPin[]): JudgedPin[] {
  // Keep the list identity in charge of pairing, even if two postes share a family.
  return [...new Set([...vector, ...replay].map((pin) => pin.poste))].flatMap((poste) =>
    combine(vector.filter((pin) => pin.poste === poste), replay.filter((pin) => pin.poste === poste), MATCH_RADIUS),
  );
}

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
async function measurePage(fixture: Awaited<ReturnType<typeof fictionalSheets>>[number], methods: Method[]) {
  const extraction = await extractVectorPage(fixture.bytes, fixture.page);
  const { width, height, page } = extraction;
  if (width !== fixture.size.width || height !== fixture.size.height || page !== fixture.page) {
    throw new Error("Fictional page metadata and extracted page differ");
  }
  const generation = sha256(fixture.bytes);
  const frame = { width, height, sheet: fixture.id, page, generation };
  const input = { id: fixture.id, generation, extraction };
  const index = indexSymbolPage(extraction);
  const examples = fixture.examples.map((example) => ({ organ: example.organ, paths: index.inside(example.box) }));
  const vector = fixture.support === "vector" ? readDeterministic({ ...input, examples }) : null;
  const pinsByMethod = { ...vector, "pipe-unseeded": vector ? readDeterministic({ ...input, examples: [] }).pipe : [] };
  const recordings = syntheticRecordings(frame, fixture.replay, fixture.truncateTile);
  const replay = replayTiles(frame, FICTION_TARGETS, recordings);
  const truth = fixture.truth.map((pin) => ({ ...pin, sheet: fixture.id, generation, page, method: "truth", evidence: [] }));
  const zones = Object.entries(fixture.negativeZones).map(([name, bounds]) => ({
    name, contains: (pin: Point) => boxContains(bounds, pin),
  }));
  const results = methods.map((method) => {
    const readsReplay = method === "tile-replay" || method === "fusion-with-replay";
    const pins =
      method === "tile-replay" ? replay.pins :
      method === "fusion-with-replay" ? combineReaders(typePins(vector?.["all-deterministic"] ?? [], FICTION_TARGETS), replay.pins) :
      typePins(pinsByMethod[method] ?? [], FICTION_TARGETS);
    const exampleCount = readerExamples[method];
    // Both the reader and the accounting use the first one or two examples per family.
    const supplied = exampleCount === 0 ? [] : fixture.examples.filter((example, i) =>
      fixture.examples.slice(0, i).filter((previous) => previous.organ === example.organ).length < exampleCount,
    );
    const status = readsReplay ? replay.status : vector ? "complete" : "unsupported-raster";
    return {
      method, status, tiles: readsReplay ? replay.tiles : null, pins,
      suppliedExamples: supplied,
      score: status === "partial" ? null : scorePage(pins, truth, supplied.map((example) => example.truthIndex), zones),
    };
  });
  return {
    frame, dossier: fixture.dossier, support: fixture.support, rotation: fixture.rotation, userUnit: fixture.userUnit,
    density: truth.length === 0 ? "empty" : truth.length >= 8 ? "dense" : "sparse",
    truth, negativeZones: fixture.negativeZones, results,
    annotationsSha256: sha256(JSON.stringify([truth, fixture.examples, fixture.negativeZones, recordings])),
  };
}

type MeasuredPage = Awaited<ReturnType<typeof measurePage>>;
type MethodResult = MeasuredPage["results"][number];
type EvaluatedPage = { page: MeasuredPage; result: MethodResult & { score: NonNullable<MethodResult["score"]> } };

function spatialByFamily(pages: EvaluatedPage[]) {
  return FICTION_TARGETS.map(({ id, organ }) => {
    const scores = pages.map(({ page, result }) => {
      const familyTruth = page.truth.filter((pin) => pin.organ === organ);
      // Use the original geometric pairs: a wrong family can cause both a
      // missed truth under its own family and a false prediction under another.
      const drawingPairs = result.score.pairs.filter(([, j]) => page.truth[j].organ === organ);
      const postePairs = drawingPairs.filter(([i, j]) => result.pins[i].poste === page.truth[j].poste);
      const dnPairs = postePairs.filter(([i, j]) => page.truth[j].dn !== null && result.pins[i].dn === page.truth[j].dn);
      const predicted = result.pins.filter((pin) => pin.organ === organ);
      return {
        // An unnamed yet matched drawing is credited to its truth family.
        drawing: metrics(drawingPairs.length, drawingPairs.length + result.score.unmatched.filter((pin) => pin.organ === organ).length, familyTruth.length),
        poste: metrics(postePairs.length, predicted.filter((pin) => pin.poste !== null).length, familyTruth.length),
        dn: metrics(dnPairs.length, predicted.filter((pin) => pin.dn !== null).length, familyTruth.filter((pin) => pin.dn !== null).length),
      };
    });
    return { poste: id, organ, spatial: aggregateSpatial(scores) };
  });
}

function summarize(method: Method, pages: MeasuredPage[], common: Set<MeasuredPage>) {
  const selected = pages.map((page) => ({ page, result: page.results.find((entry) => entry.method === method)! }));
  const rated = selected.flatMap(({ page, result }): EvaluatedPage[] =>
    result.score ? [{ page, result: { ...result, score: result.score } }] : [],
  );
  const ratedPages = new Set(rated.map(({ page }) => page));
  const spatial = (entries: EvaluatedPage[]) => aggregateSpatial(entries.map(({ result }) => result.score.spatial));
  const by = (key: "dossier" | "support" | "density") => Object.fromEntries([...new Set(pages.map((page) => page[key]))].map((value) => {
    const group = rated.filter(({ page }) => page[key] === value);
    return [value, { evaluatedPages: group.length, expectedPages: pages.filter((page) => page[key] === value).length, spatial: spatial(group) }];
  }));
  return {
    method,
    coverage: {
      expectedPages: pages.length,
      readPages: selected.filter(({ result }) => result.status === "complete").length,
      rasterAbstentions: selected.filter(({ result }) => result.status === "unsupported-raster").length,
      partialPages: selected.filter(({ result }) => result.status === "partial").length,
      evaluatedPages: rated.length,
      evaluatedOccurrences: rated.reduce((n, { page }) => n + page.truth.length, 0),
      expectedOccurrences: pages.reduce((n, page) => n + page.truth.length, 0),
    },
    examples: {
      supplied: selected.reduce((n, { result }) => n + result.suppliedExamples.length, 0),
      paired: rated.reduce((n, { result }) => n + result.score.suppliedExamples.spatiallyPaired, 0),
      annotationTimeMs: null,
    },
    abstentions: {
      poste: rated.reduce((n, { result }) => n + result.score.abstentions.poste, 0),
      dn: rated.reduce((n, { result }) => n + result.score.abstentions.dn, 0),
    },
    duplicates: rated.reduce((n, { result }) => n + result.score.duplicates, 0),
    contradictions: rated.reduce((n, { result }) => n + result.score.contradictions, 0),
    wholeCorpusSpatial: rated.length === pages.length ? spatial(rated) : null,
    evaluatedSpatial: spatial(rated),
    spatialWithoutSuppliedExamples: aggregateSpatial(rated.map(({ result }) => result.score.withoutSuppliedExamples)),
    commonPageSpatial: spatial(rated.filter(({ page }) => common.has(page))),
    byPoste: spatialByFamily(rated),
    byDossier: by("dossier"),
    bySupport: by("support"),
    byDensity: by("density"),
    quantitiesByDossier: [...new Set(pages.map((page) => page.dossier))].map((dossier) => {
      const expected = pages.filter((page) => page.dossier === dossier);
      const entries = rated.filter(({ page }) => page.dossier === dossier);
      return {
        dossier,
        quantities: expected.every((page) => ratedPages.has(page))
          ? quantityScore(entries.flatMap(({ result }) => result.pins), expected.flatMap((page) => page.truth), FICTION_TARGETS)
          : null,
      };
    }),
  };
}

export async function runCountBench(methods: Method[], seed: number) {
  const pages: MeasuredPage[] = [];
  for (const fixture of await fictionalSheets(seed)) pages.push(await measurePage(fixture, methods));
  const common = new Set(pages.filter((page) => page.results.every((result) => result.score !== null)));
  return {
    corpus: "fictional-count-pins",
    corpusSha256: sha256(JSON.stringify(pages.map(({ frame, annotationsSha256 }) => [frame.generation, frame.page, annotationsSha256]))),
    seed,
    targets: FICTION_TARGETS,
    calls: 0,
    humanReview: null,
    commonPages: [...common].map(({ frame }) => frame),
    methods: methods.map((method) => summarize(method, pages, common)),
    pages,
  };
}
