import { DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS, designationSimilarity } from "@/lib/takeoff/benchmark";
import { findDiameterEntries, hasDiameterSeries, sameSizeWithoutSeries, type DiameterEntry } from "@/lib/takeoff/bench/diameters";
import { readItemKey, scoredUnit, type BenchItemKey, type ScoredUnit, type UnreadableReason } from "@/lib/takeoff/bench/item-keys";
import type { LineKind, MaterialCode, NetworkCode, OrganCode, PlanCause, TruthLot } from "@/lib/takeoff/bench/keys";
import type { ManifestDocument, TruthFile, TruthLine } from "@/lib/takeoff/bench/schemas";
import type { TakeoffItem } from "@/lib/takeoff/types";
import { toUnitToken } from "@/lib/takeoff/units";

// Per-key score of the takeoff bench (TI-660), next to evaluateTakeoffBenchmark
// (benchmark.ts), which stays the line-by-line check of the fictional fixture.
// - Scope: the truth files that share a document are scored together, their
//   documents' items pooled; a key priced by two devis adds their lines.
// - Keys: networks zone x level x network x material x DN x unit; counts zone x
//   level x organ x DN x unit, across networks; surfaces zone x level x room,
//   rooms repeated on a level (« Bureau #2 ») added under their printed label.
//   The lot C phases (atelier, chantier) of a key are added. An attribute the
//   truth leaves null is no wildcard. Zone and level come from the manifest
//   (document, or page range by source_page); a zone the manifest cannot give
//   is reported, never guessed. A truth without zone (or level) adds the items
//   of all its documents, whatever their zone (or level).
// - Confounded networks (v3): an EU or EV item counts on an EUV key, a supply
//   or return item on its CHW, HW, GLY, HRC or CW key, in a scope that prices
//   the parent and never the member (CONFOUNDED_NETWORKS).
// - DN: a key whose material has a series matches an item that shares one of
//   its entries (diameters.ts); a key without series (a count, an insulation)
//   matches only an item that names its size (sameSizeWithoutSeries), never
//   the next DN up or down through an entry of another series.
// - Score: the items of one key are added and compared with the sum of its
//   observable lines: u exact, ml ±10 %, m2 ±max(2 %, 0.5 m²). A key with no
//   observable line, a key adding observable lines and lines the plan cannot
//   give (partly_observable: its items cannot be told apart), an ambiguous line
//   or another unit is out of score: its items are neither matched nor false
//   positives, nor is an item that matches no key in its unit but an
//   out-of-score key in another (a WC priced « ens », an insulation in m2).
// - A scope with a document that did not run, or whose reading lost a chunk
//   (timeout, rejection, provider or schema failure), is not scored: the keys of
//   its unread pages would be blamed on the model. Its pages are listed.
// - Causes, in this priority: the plan (plan_cause of an observable line,
//   entered after review); « nous » per zone: a wrong network or DN (a missed
//   key and an unmatched item identical but for the network or the DN, network
//   first), a double count (a sum above tolerance with two identical items on
//   two pages or read by two chunks, or an item of Zi whose key exists only in
//   another zone of the scopes of its role: the reserve never explains a main
//   lot), missed, invented; « indéterminé » for any other deviation, with its
//   sign, « indéterminé:unite » for a key read in another scored unit, and
//   « indéterminé:illisible » for unreadable items.
// - A key is missed only when no item may be it. Pairs, one to one: a missed
//   key and an unmatched group one network, one DN or one unit apart (network
//   first, keys and groups in their order) are one deviation, the group taking
//   the key's cause, a reviewed plan cause included; then an unreviewed missed
//   key and an unreadable item that reads like it but for what it could not
//   read (network, organ, DN, room or zone), with the quantity of the key or of
//   one of its lines within tolerance: the reader, not the model, may have lost
//   the key, which is « indéterminé:illisible ».
// - Causes count once per key and per unpaired false-positive group, unpaired
//   unreadable items making one group per reason.

export const SCORE_VERSION = 3;

/**
 * Networks a confounded truth key collects (score v3, TI-662): a devis that
 * prices EU and EV together (EUV), or supply and return together (CHW, HW,
 * GLY, HRC, CW), while the plan draws and labels them apart. An item of a
 * member network is read as its parent only in a scope that has a key of the
 * parent and none of the member: a scope pricing EU apart keeps its EU items.
 * RECS is never ECS (a return loop is priced apart).
 */
export const CONFOUNDED_NETWORKS: Partial<Record<NetworkCode, NetworkCode>> = {
  EU: "EUV", EV: "EUV", "CHW-S": "CHW", "CHW-R": "CHW", "HW-S": "HW", "HW-R": "HW", "GLY-S": "GLY", "GLY-R": "GLY",
  "HRC-S": "HRC", "HRC-R": "HRC", "CW-S": "CW", "CW-R": "CW",
};

export const BENCH_TOLERANCES: Record<ScoredUnit, { absolute: number; relative: number }> = {
  u: { absolute: 0, relative: 0 },
  ml: { absolute: 0, relative: 0.1 },
  m2: { absolute: 0.5, relative: 0.02 },
};

const EPSILON = 1e-9;

export function toleranceOf(unit: ScoredUnit, expected: number) {
  const { absolute, relative } = BENCH_TOLERANCES[unit];
  return Math.max(absolute, Math.abs(expected) * relative);
}

export function withinTolerance(unit: ScoredUnit, expected: number, actual: number) {
  return Math.abs(actual - expected) <= toleranceOf(unit, expected) + EPSILON;
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

export type ScoreTruthFile = { file: string; truth: TruthFile };
export type ScopeLine = { ref: string; line: TruthLine };

export type ScoreScope = {
  id: string;
  lot: TruthLot;
  role: "truth" | "reserve";
  truthFiles: string[];
  documents: ManifestDocument[];
  lines: ScopeLine[];
};

function byText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Truth files sharing a document form one scope (connected components), sorted by id. */
export function buildScoreScopes(truthFiles: readonly ScoreTruthFile[], manifest: readonly ManifestDocument[]): ScoreScope[] {
  const files = [...truthFiles].sort((left, right) => byText(left.file, right.file));
  const parent = files.map((_, index) => index);
  const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  const owner = new Map<string, number>();
  for (const [index, { truth }] of files.entries()) {
    for (const id of truth.documents) {
      const other = owner.get(id);
      if (other === undefined) owner.set(id, index);
      else parent[find(index)] = find(other);
    }
  }
  const documents = new Map(manifest.map((document) => [document.id, document]));
  const groups = new Map<number, ScoreTruthFile[]>();
  for (const [index, file] of files.entries()) groups.set(find(index), [...(groups.get(find(index)) ?? []), file]);
  return [...groups.values()].map((group) => {
    const ids = [...new Set(group.flatMap(({ truth }) => truth.documents))].sort(byText);
    const covered = ids.map((id) => {
      const document = documents.get(id);
      if (!document) throw new Error(`${id} is in a truth file but not in the manifest.`);
      return document;
    });
    return {
      id: group.map(({ file }) => file).join(" + "),
      lot: group[0].truth.lot,
      role: covered.some((document) => document.role === "reserve") ? "reserve" as const : "truth" as const,
      truthFiles: group.map(({ file }) => file),
      documents: covered,
      lines: group.flatMap(({ file, truth }) => truth.lines.map((line, index) => ({ ref: `${file}#lines[${index}]`, line }))),
    };
  }).sort((left, right) => byText(left.id, right.id));
}

export type KeyLabel = {
  kind: LineKind;
  zone: string | null;
  level: string | null;
  network: NetworkCode | null;
  material: MaterialCode | null;
  organ: OrganCode | null;
  dn: string | null;
  room: string | null;
  unit: string;
};

export type BenchCause = {
  label: string;
  origin: "plan" | "nous" | "indetermine";
  plan_cause?: PlanCause;
  sign?: "+" | "-";
  relative_deviation?: number | null;
  reason?: string;
};

export type KeyScore = {
  key: KeyLabel;
  status: "ok" | "out_of_tolerance" | "missed" | "out_of_score";
  reason: "not_observable" | "partly_observable" | "ambiguous" | "unit" | null;
  expected: number | null;
  actual: number | null;
  tolerance: number | null;
  relative_deviation: number | null;
  items: number;
  lines: number;
  sources: string[];
  plan_causes: PlanCause[];
  cause: BenchCause | null;
};

export type FalsePositiveReason = UnreadableReason | "zone_unresolved" | "key_ambiguous";

export type FalsePositiveGroup = {
  key: KeyLabel | null;
  reason: FalsePositiveReason | null;
  items: number;
  quantity: number;
  pages: string[];
  designations: string[];
  cause: BenchCause;
  /** The missed key this group is one deviation with: the cause counts on that key only. */
  paired_with: KeyLabel | null;
};

export type ScopeCounts = {
  items: number;
  attached: number;
  unreadable: number;
  out_of_score_items: number;
  attachment_rate: number | null;
  keys_scored: number;
  keys_ok: number;
  keys_out_of_tolerance: number;
  keys_missed: number;
  keys_out_of_score: number;
  false_positive_groups: number;
  false_positive_items: number;
  not_reviewed: number;
  causes: Record<string, number>;
};

/** Raw counts for the indicative checks of evaluateTakeoffBenchmark's thresholds (fictional fixture). */
export type IndicativeCounts = {
  expected_keys: number;
  matched_keys: number;
  ok_keys: number;
  candidates: number;
  items: number;
  localized_items: number;
  high_confidence_items: number;
  high_confidence_errors: number;
};

/** Pages of a document that ran but whose chunk got no usable answer. */
export type ReadFailure = { start_page: number; end_page: number; status: string };

export type ScopeScore = {
  id: string;
  lot: TruthLot;
  role: "truth" | "reserve";
  documents: string[];
  truth_files: string[];
  status: "scored" | "not_run" | "read_failed";
  warnings: string[];
  unread_pages: Array<ReadFailure & { document: string }>;
  keys: KeyScore[];
  false_positives: FalsePositiveGroup[];
  out_of_score_items: Array<{ document: string; page: number | null; unit: string; reason: "unit" | "key_out_of_score" }>;
  counts: ScopeCounts;
  indicative: IndicativeCounts;
};

type TruthKey = {
  id: string;
  label: KeyLabel;
  unit: ScoredUnit | null;
  entries: readonly DiameterEntry[] | null;
  /** No series restricts the DN (a count, an insulation): the item must name its size. */
  bySize: boolean;
  lines: ScopeLine[];
  /** Why the key is out of score; null when it is scored. */
  outOfScore: KeyScore["reason"];
};

function roomLabel(room: string) {
  return room.replace(/\s+#\d+$/, "");
}

function truthLabel({ line }: ScopeLine): KeyLabel {
  const base = { kind: line.kind, zone: line.zone, level: line.level, unit: line.unit, network: null, material: null, organ: null, dn: null, room: null };
  if (line.kind === "count") return { ...base, organ: line.organ, dn: line.dn };
  if (line.kind === "surface") return { ...base, room: line.room === null ? null : roomLabel(line.room) };
  return { ...base, network: line.network, material: line.material, dn: line.dn };
}

function labelId(label: KeyLabel) {
  return JSON.stringify([label.kind, label.zone, label.level, label.network, label.material, label.organ, label.dn, label.room, label.unit]);
}

function outOfScoreReason(unit: ScoredUnit | null, lines: readonly TruthLine[]): KeyScore["reason"] {
  if (unit === null) return "unit";
  if (lines.some((line) => line.ambiguous === true || line.quantity === null)) return "ambiguous";
  const observable = lines.filter((line) => line.observable_on_plan).length;
  return observable === 0 ? "not_observable" : observable < lines.length ? "partly_observable" : null;
}

function truthKeysOf(lines: readonly ScopeLine[]): TruthKey[] {
  const keys = new Map<string, Omit<TruthKey, "outOfScore">>();
  for (const scopeLine of lines) {
    const label = truthLabel(scopeLine);
    const id = labelId(label);
    const known = keys.get(id);
    if (known) {
      known.lines.push(scopeLine);
      continue;
    }
    const material = label.kind === "network" ? label.material : null;
    keys.set(id, {
      id, label, unit: scoredUnit(label.unit), lines: [scopeLine],
      entries: label.dn === null ? null : findDiameterEntries(label.dn, material), bySize: !hasDiameterSeries(material),
    });
  }
  return [...keys.values()].map((key) => ({ ...key, outOfScore: outOfScoreReason(key.unit, key.lines.map(({ line }) => line)) }))
    .sort((left, right) => byText(left.id, right.id));
}

type LocatedKey = BenchItemKey & { zone: string | null; level: string | null };

function entryId(entry: DiameterEntry) {
  return `${entry.family}:${entry.od_mm}`;
}

function sameDiameter(item: LocatedKey, key: TruthKey) {
  if (item.dn === null || key.entries === null || key.label.dn === null) return item.dn === null && key.entries === null;
  if (key.bySize) return sameSizeWithoutSeries(item.dn, { printed: key.label.dn, entries: key.entries });
  const ids = new Set(key.entries.map(entryId));
  return item.dn.entries.some((entry) => ids.has(entryId(entry)));
}

type Ignored = Partial<Record<"zone" | "level" | "unit" | "network" | "organ" | "dn" | "room", boolean>>;

function sameKey(item: LocatedKey, key: TruthKey, ignore: Ignored = {}) {
  const label = key.label;
  if (item.kind !== label.kind) return false;
  if (!ignore.level && item.level !== label.level) return false;
  if (!ignore.unit && item.unit !== key.unit) return false;
  if (!ignore.zone && item.zone !== label.zone) return false;
  if (item.kind === "surface") return ignore.room === true || item.room === label.room;
  const dn = ignore.dn === true || sameDiameter(item, key);
  if (item.kind === "count") return (ignore.organ === true || item.organ === label.organ) && dn;
  return (ignore.network === true || item.network === label.network) && item.material === label.material && dn;
}

/** Pairs in this order: the network first, then the DN, then the unit. */
const PAIR_KINDS = ["mauvais_reseau", "mauvais_dn", "unite"] as const;
type PairKind = (typeof PAIR_KINDS)[number];

/** The single difference between an unmatched item and a missed key, when it is the network, the DN or the unit. */
function pairKind(item: LocatedKey, key: TruthKey): PairKind | null {
  const label = key.label;
  if (item.kind !== label.kind || item.zone !== label.zone || item.level !== label.level) return null;
  if (item.unit !== key.unit) return sameKey(item, key, { unit: true }) ? "unite" : null;
  const dnDiffers = !sameDiameter(item, key);
  if (item.kind === "count") return item.organ === label.organ && dnDiffers ? "mauvais_dn" : null;
  if (item.kind !== "network" || item.material !== label.material) return null;
  const networkDiffers = item.network !== label.network;
  if (networkDiffers === dnDiffers) return null;
  return networkDiffers ? "mauvais_reseau" : "mauvais_dn";
}

function itemLabel(key: LocatedKey): KeyLabel {
  const network = key.kind === "network" ? key.network : null;
  const material = key.kind === "network" ? key.material : null;
  return { kind: key.kind, zone: key.zone, level: key.level, network, material, organ: key.organ, dn: key.dn?.printed ?? null, room: key.room, unit: key.unit };
}

function itemIdentity(key: LocatedKey) {
  const label = itemLabel(key);
  return JSON.stringify([label.kind, label.zone, label.level, label.network, label.material, label.organ, label.room, label.unit,
    key.dn === null ? null : key.dn.entries.map(entryId).sort().join(",")]);
}

type Located = { zone: string | null; level: string | null } | null;

function locate(document: ManifestDocument, page: number | undefined, zones: ReadonlySet<string>, levels: ReadonlySet<string>): Located {
  let zone = document.zone;
  let level = document.level;
  if ((document.page_ranges ?? []).length > 0) {
    const range = page === undefined ? undefined : document.page_ranges?.find((entry) => entry.from <= page && page <= entry.to);
    if (!range) return null;
    zone = range.zone ?? document.zone;
    level = range.level ?? document.level;
  }
  if ((zone === null && zones.size > 0) || (level === null && levels.size > 0)) return null;
  // A truth without zone (or level) covers its documents whatever their zone (or level).
  return { zone: zones.size === 0 ? null : zone, level: levels.size === 0 ? null : level };
}

/** `chunks`: the chunks (1-based) of its document that read the item; null when unknown. */
type ScopedItem = { document: string; item: TakeoffItem; chunks: readonly number[] | null };
type AttachedItem = ScopedItem & { key: LocatedKey };
/** `key`: what the item read, where (null when not located); `among`: the networks or rooms it hesitates between. */
type UnreadableItem = ScopedItem & { reason: FalsePositiveReason; key: LocatedKey | null; among: readonly string[] };

/** What each reason leaves unread: an unreadable item may differ from a key by that only. */
const UNREAD: Record<FalsePositiveReason, Ignored> = {
  network_missing: { network: true }, network_ambiguous: { network: true }, organ_missing: { organ: true },
  dn_ambiguous: { dn: true }, dn_unknown: { dn: true }, room_missing: { room: true }, room_ambiguous: { room: true },
  zone_unresolved: { zone: true, level: true }, key_ambiguous: {},
};

/** An unreadable item may be a key it reads like but for what it could not read, with the key's quantity or one of its lines'. */
function mayBe(entry: UnreadableItem, key: TruthKey) {
  const unit = key.unit;
  if (entry.key === null || unit === null || !sameKey(entry.key, key, UNREAD[entry.reason])) return false;
  const named = entry.reason === "room_ambiguous" ? key.label.room : key.label.network;
  if (entry.among.length > 0 && (named === null || !entry.among.includes(named))) return false;
  const observable = key.lines.filter(({ line }) => line.observable_on_plan).map(({ line }) => line.quantity ?? 0);
  return [sum(observable), ...observable].some((quantity) => withinTolerance(unit, quantity, entry.item.quantity));
}

function pageOf({ document, item }: ScopedItem) {
  return `${document}:${item.source_page ?? "?"}`;
}

/** Two items no chunk read together: the blocks of two chunks (on the pages they overlap). */
function twoBlocks(left: ScopedItem, right: ScopedItem) {
  const [one, other] = [left.chunks ?? [], right.chunks ?? []];
  return one.length > 0 && other.length > 0 && !one.some((chunk) => other.includes(chunk));
}

function hasIdenticalPair(items: readonly ScopedItem[]) {
  return items.some((left, index) => items.slice(index + 1).some((right) =>
    designationSimilarity(left.item.designation, right.item.designation) === 1
    && toUnitToken(left.item.unit) === toUnitToken(right.item.unit)
    && Math.abs(left.item.quantity - right.item.quantity) < EPSILON
    && (pageOf(left) !== pageOf(right) || twoBlocks(left, right))));
}

function nous(kind: string): BenchCause {
  return { label: `nous:${kind}`, origin: "nous" };
}

function pairCause(kind: PairKind): BenchCause {
  return kind === "unite" ? { label: "indetermine:unite", origin: "indetermine", reason: "unit" } : nous(kind);
}

function planCause(planCause: PlanCause): BenchCause {
  return { label: `plan:${planCause}`, origin: "plan", plan_cause: planCause };
}

function emptyCounts(): ScopeCounts {
  return {
    items: 0, attached: 0, unreadable: 0, out_of_score_items: 0, attachment_rate: null, keys_scored: 0, keys_ok: 0,
    keys_out_of_tolerance: 0, keys_missed: 0, keys_out_of_score: 0, false_positive_groups: 0, false_positive_items: 0,
    not_reviewed: 0, causes: {},
  };
}

function emptyIndicative(): IndicativeCounts {
  return { expected_keys: 0, matched_keys: 0, ok_keys: 0, candidates: 0, items: 0, localized_items: 0, high_confidence_items: 0, high_confidence_errors: 0 };
}

function scopeWarnings(scope: ScoreScope, zones: ReadonlySet<string>, levels: ReadonlySet<string>) {
  const warnings: string[] = [];
  for (const document of scope.documents) {
    if ((document.page_ranges ?? []).length > 0) continue;
    if (document.zone === null && zones.size > 0) {
      warnings.push(`${document.id} has no zone nor page range while its truth has zones ${[...zones].sort(byText).join(", ")}: `
        + "its items are not attributed to a zone");
    }
    if (document.level === null && levels.size > 0) {
      warnings.push(`${document.id} has no level nor page range while its truth has levels ${[...levels].sort(byText).join(", ")}: `
        + "its items are not attributed to a level");
    }
  }
  return warnings;
}

function sum(values: readonly number[]) {
  return round(values.reduce((total, value) => total + value, 0));
}

export type ScoreReadings = {
  /** Pages of each document that ran but whose chunk got no usable answer. */
  failures?: ReadonlyMap<string, readonly ReadFailure[]>;
  /** Per document, the chunks (1-based) that read each of its items, in the order of its items. */
  chunks?: ReadonlyMap<string, ReadonlyArray<readonly number[]>>;
};

type MissedKey = { key: TruthKey; score: KeyScore; reviewed: PlanCause | undefined; paired: boolean };

function scoreScope(scope: ScoreScope, keys: readonly TruthKey[], roleKeys: readonly TruthKey[],
  items: ReadonlyMap<string, readonly TakeoffItem[]>, readings: ScoreReadings): ScopeScore {
  const zones = new Set(scope.lines.map(({ line }) => line.zone).filter((zone): zone is string => zone !== null));
  const levels = new Set(scope.lines.map(({ line }) => line.level).filter((level): level is string => level !== null));
  const result: ScopeScore = {
    id: scope.id, lot: scope.lot, role: scope.role, documents: scope.documents.map((document) => document.id),
    truth_files: scope.truthFiles, status: "scored", warnings: scopeWarnings(scope, zones, levels), unread_pages: [],
    keys: [], false_positives: [], out_of_score_items: [], counts: emptyCounts(), indicative: emptyIndicative(),
  };
  if (scope.documents.some((document) => !items.has(document.id))) return { ...result, status: "not_run" };
  const unread = scope.documents.flatMap((document) =>
    (readings.failures?.get(document.id) ?? []).map((failure) => ({ document: document.id, ...failure })));
  if (unread.length > 0) {
    return {
      ...result, status: "read_failed", unread_pages: unread,
      warnings: [...result.warnings, ...unread.map((entry) =>
        `${entry.document} pages ${entry.start_page}-${entry.end_page} not read (${entry.status}): the scope is not scored`)],
    };
  }

  const rooms = [...new Set(keys.filter((key) => key.label.room !== null).map((key) => key.label.room as string))];
  const scopeNetworks = new Set(keys.map((key) => key.label.network).filter((network): network is NetworkCode => network !== null));
  const rollUp = (network: NetworkCode | null) => {
    const parent = network === null ? undefined : CONFOUNDED_NETWORKS[network];
    return parent && network !== null && !scopeNetworks.has(network) && scopeNetworks.has(parent) ? parent : network;
  };
  const rolledUp = <T extends { kind: LineKind; network: NetworkCode | null }>(key: T): T =>
    (key.kind === "network" ? { ...key, network: rollUp(key.network) } : key);
  const attachedByKey = new Map<string, AttachedItem[]>(keys.map((key) => [key.id, []]));
  const unmatched: AttachedItem[] = [];
  const unreadable: UnreadableItem[] = [];
  // Item identity, never a copy of its entry: entries are spread into AttachedItem.
  const highConfidence = new Set<TakeoffItem>();
  const erroneous = new Set<TakeoffItem>();
  const counts = result.counts;
  const indicative = result.indicative;
  const addUnreadable = (reason: FalsePositiveReason, entry: ScopedItem, key: LocatedKey | null, among: readonly string[] = []) =>
    unreadable.push({ ...entry, reason, key, among });
  const outOfScore = (entry: ScopedItem) => {
    result.out_of_score_items.push({ document: entry.document, page: entry.item.source_page ?? null, unit: entry.item.unit, reason: "key_out_of_score" });
    highConfidence.delete(entry.item);
  };

  for (const document of scope.documents) {
    const chunks = readings.chunks?.get(document.id);
    for (const [index, item] of (items.get(document.id) ?? []).entries()) {
      const entry: ScopedItem = { document: document.id, item, chunks: chunks?.[index] ?? null };
      counts.items += 1;
      indicative.items += 1;
      if (item.evidence?.trim() && typeof item.source_page === "number" && item.source_page >= 1) indicative.localized_items += 1;
      const reading = readItemKey(item, { rooms });
      if (reading.status === "out_of_score") {
        result.out_of_score_items.push({ document: document.id, page: item.source_page ?? null, unit: item.unit, reason: "unit" });
        continue;
      }
      if (typeof item.confidence === "number" && item.confidence >= DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS.highConfidenceThreshold) {
        highConfidence.add(item);
      }
      const located = locate(document, item.source_page, zones, levels);
      if (reading.status === "unreadable") {
        const among = reading.reason === "network_missing" || reading.reason === "network_ambiguous"
          ? [...new Set(reading.among.map((network) => rollUp(network as NetworkCode) as string))] : reading.among;
        addUnreadable(reading.reason, entry, located === null ? null : rolledUp({ ...reading.key, ...located }), among);
        continue;
      }
      if (located === null) {
        addUnreadable("zone_unresolved", entry, rolledUp({ ...reading.key, zone: null, level: null }));
        continue;
      }
      const key: LocatedKey = rolledUp({ ...reading.key, ...located });
      let candidates = keys.filter((truthKey) => sameKey(key, truthKey));
      if (candidates.length > 1) {
        const exact = key.dn === null ? "" : key.dn.entries.map(entryId).sort().join(",");
        candidates = candidates.filter((truthKey) => (truthKey.entries ?? []).map(entryId).sort().join(",") === exact);
        if (candidates.length !== 1) {
          addUnreadable("key_ambiguous", entry, key);
          continue;
        }
      }
      counts.attached += 1;
      if (candidates.length === 1) attachedByKey.get(candidates[0].id)?.push({ ...entry, key });
      // No key in its unit, but an out-of-score key in another (a WC priced « ens », an insulation in m2): neither matched nor invented.
      else if (keys.some((truthKey) => truthKey.outOfScore !== null && sameKey(key, truthKey, { unit: true }))) outOfScore(entry);
      else unmatched.push({ ...entry, key });
    }
  }

  const groups = new Map<string, AttachedItem[]>();
  for (const entry of unmatched) {
    const identity = itemIdentity(entry.key);
    groups.set(identity, [...(groups.get(identity) ?? []), entry]);
  }
  const fpGroups = [...groups.entries()].sort(([left], [right]) => byText(left, right)).map(([, entries]) => entries);
  const missed: MissedKey[] = [];

  for (const key of keys) {
    const attached = attachedByKey.get(key.id) ?? [];
    const lines = key.lines.map(({ line }) => line);
    const observable = lines.filter((line) => line.observable_on_plan);
    const planCauses = [...new Set(lines.map((line) => line.plan_cause).filter((cause): cause is PlanCause => cause !== undefined))];
    const reviewedCause = observable.map((line) => line.plan_cause).find((cause): cause is PlanCause => cause !== undefined);
    const actual = attached.length === 0 ? null : sum(attached.map(({ item }) => item.quantity));
    const base: KeyScore = {
      key: key.label, status: "out_of_score", reason: null, expected: null, actual, tolerance: null, relative_deviation: null,
      items: attached.length, lines: key.lines.length, sources: key.lines.map(({ ref }) => ref), plan_causes: planCauses, cause: null,
    };
    if (key.outOfScore !== null || key.unit === null) {
      counts.keys_out_of_score += 1;
      attached.forEach(outOfScore);
      result.keys.push({ ...base, reason: key.outOfScore });
      continue;
    }
    counts.keys_scored += 1;
    indicative.expected_keys += 1;
    const expected = sum(observable.map((line) => line.quantity ?? 0));
    const total = actual ?? 0;
    const scored: KeyScore = {
      ...base, expected, actual: total, tolerance: round(toleranceOf(key.unit, expected)),
      relative_deviation: expected === 0 ? null : round((total - expected) / expected),
    };
    if (withinTolerance(key.unit, expected, total)) {
      counts.keys_ok += 1;
      indicative.matched_keys += 1;
      indicative.ok_keys += 1;
      result.keys.push({ ...scored, status: "ok" });
      continue;
    }
    if (attached.length === 0) {
      if (reviewedCause === undefined) counts.not_reviewed += 1;
      counts.keys_missed += 1;
      const score: KeyScore = { ...scored, actual: null, status: "missed", cause: reviewedCause ? planCause(reviewedCause) : null };
      missed.push({ key, score, reviewed: reviewedCause, paired: false });
      result.keys.push(score);
      continue;
    }
    counts.keys_out_of_tolerance += 1;
    indicative.matched_keys += 1;
    for (const { item } of attached) erroneous.add(item);
    const above = total > expected;
    const cause = reviewedCause ? planCause(reviewedCause)
      : above && hasIdenticalPair(attached) ? nous("compte_deux_fois")
        : { label: "indetermine", origin: "indetermine" as const, sign: above ? "+" as const : "-" as const, relative_deviation: scored.relative_deviation };
    result.keys.push({ ...scored, status: "out_of_tolerance", cause });
  }

  // One deviation per pair, one to one: a missed key and the unmatched group one network, one DN or one unit apart
  // (network first, keys and groups in their order), then an unreviewed missed key and an unreadable item that may be it.
  const groupPairs = new Map<AttachedItem[], { miss: MissedKey; kind: PairKind }>();
  for (const kind of PAIR_KINDS) {
    for (const miss of missed.filter((entry) => !entry.paired)) {
      const group = fpGroups.find((entries) => !groupPairs.has(entries) && pairKind(entries[0].key, miss.key) === kind);
      if (!group) continue;
      groupPairs.set(group, { miss, kind });
      miss.paired = true;
      miss.score.cause ??= pairCause(kind);
    }
  }
  const itemPairs = new Map<UnreadableItem, MissedKey>();
  for (const miss of missed.filter((entry) => !entry.paired && entry.reviewed === undefined)) {
    const entry = unreadable.find((candidate) => !itemPairs.has(candidate) && mayBe(candidate, miss.key));
    if (entry) itemPairs.set(entry, miss);
    miss.paired = entry !== undefined;
    miss.score.cause = entry ? { label: "indetermine:illisible", origin: "indetermine", reason: entry.reason } : nous("manque");
  }

  for (const entries of fpGroups) {
    const first = entries[0].key;
    // The group of a pair takes the cause of its missed key, a reviewed plan cause included, and counts on that key only.
    const pair = groupPairs.get(entries);
    const elsewhere = first.zone !== null
      && roleKeys.some((key) => key.label.zone !== null && key.label.zone !== first.zone && sameKey(first, key, { zone: true }))
      && !roleKeys.some((key) => key.label.zone === first.zone && sameKey(first, key, { zone: true }));
    const cause = pair ? (pair.miss.reviewed ? planCause(pair.miss.reviewed) : pairCause(pair.kind))
      : keys.some((key) => sameKey(first, key, { unit: true })) ? pairCause("unite")
        : nous(elsewhere ? "compte_deux_fois" : "invente");
    for (const { item } of entries) erroneous.add(item);
    result.false_positives.push({
      key: itemLabel(first), reason: null, items: entries.length, quantity: sum(entries.map(({ item }) => item.quantity)),
      pages: [...new Set(entries.map(pageOf))], designations: [...new Set(entries.map(({ item }) => item.designation))].slice(0, 5), cause,
      paired_with: pair ? pair.miss.key.label : null,
    });
  }
  const unreadableGroup = (reason: FalsePositiveReason, entries: readonly UnreadableItem[], pairedWith: KeyLabel | null): FalsePositiveGroup => ({
    key: null, reason, items: entries.length, quantity: sum(entries.map(({ item }) => item.quantity)),
    pages: [...new Set(entries.map(pageOf))], designations: [...new Set(entries.map(({ item }) => item.designation))].slice(0, 5),
    cause: { label: "indetermine:illisible", origin: "indetermine", reason }, paired_with: pairedWith,
  });
  for (const reason of [...new Set(unreadable.map((entry) => entry.reason))].sort(byText)) {
    const entries = unreadable.filter((entry) => entry.reason === reason);
    for (const { item } of entries) erroneous.add(item);
    // An item paired with a missed key is one deviation with it, counted on the key; the others make one group.
    for (const entry of entries) {
      const miss = itemPairs.get(entry);
      if (miss) result.false_positives.push(unreadableGroup(reason, [entry], miss.key.label));
    }
    const rest = entries.filter((entry) => !itemPairs.has(entry));
    if (rest.length > 0) result.false_positives.push(unreadableGroup(reason, rest, null));
  }

  counts.unreadable = unreadable.length;
  counts.out_of_score_items = result.out_of_score_items.length;
  counts.false_positive_groups = result.false_positives.length;
  counts.false_positive_items = unmatched.length + counts.unreadable;
  counts.attachment_rate = counts.items === 0 ? null : round(counts.attached / counts.items);
  // One unit: a key or an unpaired false-positive group (unpaired unreadable items: one group per reason).
  for (const cause of [...result.keys.map((score) => score.cause),
    ...result.false_positives.filter((group) => group.paired_with === null).map((group) => group.cause)]) {
    if (cause) counts.causes[cause.label] = (counts.causes[cause.label] ?? 0) + 1;
  }
  // The same unit for the indicative precision: matched keys and false-positive groups, unreadable ones included.
  indicative.candidates = indicative.matched_keys + result.false_positives.length;
  indicative.high_confidence_items = highConfidence.size;
  indicative.high_confidence_errors = [...highConfidence].filter((item) => erroneous.has(item)).length;
  return result;
}

/**
 * Scores every scope whose documents all ran and were read whole; `items` holds the merged items of each
 * document that ran, `readings` the pages of its chunks that got no usable answer and the chunks that read
 * each item. A key of another zone is looked for in the scopes of the same lot and role only.
 */
export function scoreScopes(scopes: readonly ScoreScope[], items: ReadonlyMap<string, readonly TakeoffItem[]>,
  readings: ScoreReadings = {}): ScopeScore[] {
  const keysByScope = new Map(scopes.map((scope) => [scope.id, truthKeysOf(scope.lines)]));
  const roleOf = (scope: ScoreScope) => `${scope.lot}:${scope.role}`;
  const keysByRole = new Map<string, TruthKey[]>();
  for (const scope of scopes) keysByRole.set(roleOf(scope), [...(keysByRole.get(roleOf(scope)) ?? []), ...(keysByScope.get(scope.id) ?? [])]);
  return scopes.map((scope) => scoreScope(scope, keysByScope.get(scope.id) ?? [], keysByRole.get(roleOf(scope)) ?? [], items, readings));
}
