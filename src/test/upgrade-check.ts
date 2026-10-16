import { createHash } from "node:crypto";

/**
 * Published database before lot 2 (`98408ef0`, design §10.2 step 1). The
 * upgrade check resets a disposable stack to exactly these migrations, loads
 * the fixture, then applies every later migration. The inventory is frozen:
 * a migration dated before the cutoff but added afterwards would otherwise be
 * applied by `db reset` before the fixture and escape the comparison.
 * `count` and `sha256` cover the files up to and including the cutoff, with
 * the LF-normalized hashes of `supabase/migrations.manifest.json`.
 */
export const LOT2_UPGRADE_BASELINE = {
  cutoff: "20261015190000_scope_takeoff_recalculation_safeupdate.sql",
  count: 244,
  sha256: "1dfbc44b8ce8a80c16db39fe582bc5a38ac995ce1757bba505113124bd8e449a",
} as const;

const CANONICAL_MIGRATION = /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/;

export interface MigrationDigest {
  name: string;
  sha256: string;
}

export interface UpgradeMigrationPartition {
  baseline: MigrationDigest[];
  later: MigrationDigest[];
}

/** One `name<TAB>sha256` line per file, in file-name order. */
export function baselineInventoryDigest(files: readonly MigrationDigest[]) {
  const lines = [...files]
    .sort((left, right) => compareNames(left.name, right.name))
    .map((file) => `${file.name}\t${file.sha256}\n`)
    .join("");
  return createHash("sha256").update(lines).digest("hex");
}

function compareNames(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Splits the repository inventory into the frozen published baseline and the
 * later migrations, in the order `db reset` and the upgrade apply them.
 */
export function partitionUpgradeMigrations(
  files: readonly MigrationDigest[]
): UpgradeMigrationPartition {
  const sorted = [...files].sort((left, right) => compareNames(left.name, right.name));
  const names = new Set(sorted.map((file) => file.name));
  if (names.size !== sorted.length) {
    throw new Error("Upgrade check refuses duplicate migration file names.");
  }

  const cutoffIndex = sorted.findIndex((file) => file.name === LOT2_UPGRADE_BASELINE.cutoff);
  if (cutoffIndex < 0) {
    throw new Error(
      `Upgrade check cutoff ${LOT2_UPGRADE_BASELINE.cutoff} is missing from the migration inventory.`
    );
  }

  const baseline = sorted.slice(0, cutoffIndex + 1);
  const later = sorted.slice(cutoffIndex + 1);
  const digest = baselineInventoryDigest(baseline);
  if (baseline.length !== LOT2_UPGRADE_BASELINE.count || digest !== LOT2_UPGRADE_BASELINE.sha256) {
    throw new Error(
      `Upgrade check baseline differs from the published lot 2 base: expected ${LOT2_UPGRADE_BASELINE.count} files (${LOT2_UPGRADE_BASELINE.sha256}), found ${baseline.length} (${digest}). A migration up to the cutoff was added, edited or removed; date every new migration after the cutoff.`
    );
  }

  const cutoffVersion = LOT2_UPGRADE_BASELINE.cutoff.slice(0, 14);
  const versions = new Set<string>();
  for (const file of later) {
    const version = CANONICAL_MIGRATION.exec(file.name)?.[1];
    if (!version || version <= cutoffVersion) {
      throw new Error(
        `Upgrade check needs a canonical 14-digit migration version after the cutoff: ${file.name}`
      );
    }
    if (versions.has(version)) {
      throw new Error(`Upgrade check refuses duplicate migration version ${version}.`);
    }
    versions.add(version);
  }

  return {
    baseline: baseline.map((file) => ({ ...file })),
    later: later.map((file) => ({ ...file })),
  };
}
