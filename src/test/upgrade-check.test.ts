import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  baselineInventoryDigest,
  LOT2_UPGRADE_BASELINE,
  partitionUpgradeMigrations,
  type MigrationDigest,
} from "@/test/upgrade-check";

// Isolation exception (AGENTS.md, Testing Policy). The upgrade check applies
// the baseline with `db reset`, loads the fixture, then applies the later
// migrations and compares. A wrong split makes it pass without comparing the
// migration that matters, and the WSL run cannot expose it in sub-lot 2.0,
// which has no later migration. Failure modes written before the code:
// 1. A migration published after the cutoff lands in the baseline: `db reset`
//    applies it before the fixture, so the comparison never sees it.
// 2. A migration dated before the cutoff is added after publication (the
//    archived lot 1 migration 20261014172511 restored with its timestamp): it
//    sorts into the baseline and escapes the comparison.
// 3. A published baseline migration is edited or removed: the baseline is no
//    longer the database that holds the client's rows.
// 4. The cutoff migration is missing or renamed: the split point is undefined.
// 5. A later migration has a non-canonical name, so its order is ambiguous.
// 6. The split depends on the order in which the files were listed.

function repositoryMigrations(): MigrationDigest[] {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "supabase", "migrations.manifest.json"), "utf8")
  ) as { migrations: Record<string, string> };
  return Object.entries(manifest.migrations).map(([name, sha256]) => ({ name, sha256 }));
}

const LOT2_EXAMPLE = { name: "20261016090000_lot2_example.sql", sha256: "a".repeat(64) };

describe("lot 2 upgrade check migration split", () => {
  it("splits the published inventory at the frozen lot 2 baseline", () => {
    const files = repositoryMigrations();
    const { baseline, later } = partitionUpgradeMigrations(files);

    expect(baseline).toHaveLength(LOT2_UPGRADE_BASELINE.count);
    expect(baseline.at(-1)?.name).toBe(LOT2_UPGRADE_BASELINE.cutoff);
    expect(baselineInventoryDigest(baseline)).toBe(LOT2_UPGRADE_BASELINE.sha256);
    expect(later.map((file) => file.name)).toEqual(
      files.map((file) => file.name).filter((name) => name > LOT2_UPGRADE_BASELINE.cutoff).sort()
    );
  });

  it("applies a migration published after the cutoff as an upgrade, never in the baseline", () => {
    const { baseline, later } = partitionUpgradeMigrations([...repositoryMigrations(), LOT2_EXAMPLE]);

    expect(later).toContainEqual(LOT2_EXAMPLE);
    expect(baseline).not.toContainEqual(LOT2_EXAMPLE);
    expect(baselineInventoryDigest(baseline)).toBe(LOT2_UPGRADE_BASELINE.sha256);
  });

  it("refuses a migration dated before the cutoff that the published baseline does not contain", () => {
    const restored = {
      name: "20261014172511_restrict_tenant_membership_writes.sql",
      sha256: "b".repeat(64),
    };

    expect(() => partitionUpgradeMigrations([...repositoryMigrations(), restored])).toThrow(
      /baseline/i
    );
  });

  it("refuses an edited or removed baseline migration", () => {
    const files = repositoryMigrations().sort((left, right) => left.name.localeCompare(right.name));
    const edited = files.map((file, index) => (index === 0 ? { ...file, sha256: "c".repeat(64) } : file));
    const removed = files.filter((_, index) => index !== 1);

    expect(() => partitionUpgradeMigrations(edited)).toThrow(/baseline/i);
    expect(() => partitionUpgradeMigrations(removed)).toThrow(/baseline/i);
  });

  it("refuses an inventory without the cutoff migration", () => {
    const files = repositoryMigrations().filter((file) => file.name !== LOT2_UPGRADE_BASELINE.cutoff);

    expect(() => partitionUpgradeMigrations(files)).toThrow(/cutoff/i);
  });

  it("refuses a later migration whose name is not a canonical 14-digit version", () => {
    const ambiguous = { name: "20261016_lot2_example.sql", sha256: "d".repeat(64) };

    expect(() => partitionUpgradeMigrations([...repositoryMigrations(), ambiguous])).toThrow(
      /14-digit/
    );
  });

  it("does not depend on the listing order", () => {
    const files = [...repositoryMigrations(), LOT2_EXAMPLE];
    const reversed = [...files].reverse();

    expect(partitionUpgradeMigrations(reversed)).toEqual(partitionUpgradeMigrations(files));
  });
});
