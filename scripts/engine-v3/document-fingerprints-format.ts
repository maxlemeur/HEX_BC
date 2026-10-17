import { createHash } from "node:crypto";

export const FINGERPRINT_SCHEMA_VERSION = "engine-document-fingerprints-1";
export const DEFAULT_BASELINE_PATH = "src/test/fixtures/engine-document-fingerprints.before.json";

export type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

export type StageFingerprint = {
  /** SHA-256 of the canonical JSON of each component payload. */
  sha256: Record<string, string>;
  /** Readable amounts of the stage, compared like the hashes. */
  amounts: Record<string, CanonicalJson>;
  /** Proof outcomes of the stage (seal verified, SQL validity...). */
  checks: Record<string, CanonicalJson>;
};

export type FamilyFingerprint = {
  versionId: string;
  engine: 1 | 2;
  flow: string;
  stages: Record<string, StageFingerprint>;
};

export type FingerprintSet = Record<string, FamilyFingerprint>;

export type FingerprintDocument = {
  schemaVersion: typeof FINGERPRINT_SCHEMA_VERSION;
  description: string;
  generator: { script: string; design: string };
  /** Run identity; informative, never compared. */
  recorded: {
    at: string;
    sourceRevision: string;
    sourceDiffSha256: string;
    node: string;
    icu: string | null;
    platform: string;
    migrations: number;
    migrationsSha256: string;
  };
  corpusSha256: string;
  aggregateSha256: string;
  fingerprints: FingerprintSet;
};

/**
 * Canonical JSON: sorted object keys, Maps as sorted objects, no undefined
 * member, finite numbers only, -0 as 0. Anything else is a harness defect.
 */
export function canonicalize(value: unknown, location = "$"): CanonicalJson {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite number at ${location}.`);
    return Object.is(value, -0) ? 0 : value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([key, item]) => [String(key), item] as const);
    if (new Set(entries.map(([key]) => key)).size !== entries.length) {
      throw new Error(`Map keys collide once stringified at ${location}.`);
    }
    return Object.fromEntries(entries.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item, `${location}.${key}`)]));
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) throw new Error(`Undefined array member at ${location}[${index}].`);
      return canonicalize(item, `${location}[${index}]`);
    });
  }
  if (typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort()
      .filter((key) => source[key] !== undefined)
      .map((key) => [key, canonicalize(source[key], `${location}.${key}`)]));
  }
  throw new Error(`Unsupported ${typeof value} value at ${location}.`);
}

export function canonicalText(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(text: string | Buffer) {
  return createHash("sha256").update(text).digest("hex");
}

export function aggregateFingerprints(fingerprints: FingerprintSet) {
  return sha256Hex(canonicalText(fingerprints));
}

export type FingerprintDifference = {
  path: string;
  before: CanonicalJson | "<missing>";
  after: CanonicalJson | "<missing>";
};

/** Every differing leaf path; an empty list means byte-identical fingerprints. */
export function compareFingerprints(before: unknown, after: unknown): FingerprintDifference[] {
  const differences: FingerprintDifference[] = [];
  const walk = (left: CanonicalJson | undefined, right: CanonicalJson | undefined, location: string) => {
    const leftObject = left !== null && typeof left === "object" && !Array.isArray(left);
    const rightObject = right !== null && typeof right === "object" && !Array.isArray(right);
    if (leftObject && rightObject) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
      for (const key of keys) {
        walk((left as Record<string, CanonicalJson>)[key], (right as Record<string, CanonicalJson>)[key], `${location}.${key}`);
      }
      return;
    }
    if (left === undefined || right === undefined) {
      differences.push({ path: location, before: left ?? "<missing>", after: right ?? "<missing>" });
      return;
    }
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      differences.push({ path: location, before: left, after: right });
    }
  };
  walk(canonicalize(before), canonicalize(after), "$");
  return differences;
}

/**
 * Sensitivity control of the comparator: an altered copy of a real set must
 * report exactly the altered leaf. A comparator that cannot see a change
 * would turn every later check into a vacuous pass.
 */
export function assertComparatorSensitivity(fingerprints: FingerprintSet) {
  const altered = structuredClone(fingerprints);
  const [familyKey] = Object.keys(altered).sort();
  const family = familyKey ? altered[familyKey] : undefined;
  const [stageKey] = family ? Object.keys(family.stages).sort() : [];
  const stage = family && stageKey ? family.stages[stageKey] : undefined;
  const [componentKey] = stage ? Object.keys(stage.sha256).sort() : [];
  if (!familyKey || !stage || !stageKey || !componentKey) {
    throw new Error("The comparator control needs at least one recorded component.");
  }
  const original = stage.sha256[componentKey];
  stage.sha256[componentKey] = `${original.slice(0, -1)}${original.endsWith("0") ? "1" : "0"}`;
  const differences = compareFingerprints(fingerprints, altered);
  const expectedPath = `$.${familyKey}.stages.${stageKey}.sha256.${componentKey}`;
  if (differences.length !== 1 || differences[0].path !== expectedPath) {
    throw new Error("The fingerprint comparator did not report exactly the altered component.");
  }
  return expectedPath;
}
