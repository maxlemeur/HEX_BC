import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const LEGACY_MIGRATION_FILES = new Set([
  "001_add_job_title_to_profiles.sql",
  "002_add_devis.sql",
  "003_create_devis_storage.sql",
  "004_harden_estimate_devis_rls_s1.sql",
  "005_set_search_path_estimate_functions_s1.sql",
  "006_performance_rls_tuning_s2.sql",
  "007_harden_procurement_rls_s3.sql",
  "008_atomic_reorder_estimate_items_s4.sql",
  "009_bulk_update_estimate_items_s4.sql",
  "010_estimate_audit_trail_s4.sql",
  "011_dpgf_import_tables_s3.sql",
  "012_mapping_tables_s4.sql",
  "013_multitenant_core_s5.sql",
  "014_catalogue_pricebook_indices_s4.sql",
  "015_catalogue_helpers_s4.sql",
  "016_atomic_reorder_purchase_order_devis_s5.sql",
  "017_margin_multiplier_upper_bound_s1.sql",
  "018_atomic_bulk_update_estimate_items_s4.sql",
  "019_reorder_purchase_order_devis_tenant_access_s5.sql",
  "020_multitenant_unique_keys_s5.sql",
  "021_fix_bulk_update_tenant_bootstrap_and_admin_hardening_v2.sql",
  "022_feature_flags.sql",
  "023_margin_tiers.sql",
  "024_rounding_invariants.sql",
  "025_est046_seal_and_events.sql",
  "026_est_101_bulk_update_estimate_items_version_patch.sql",
  "027_draft_locks.sql",
  "028_est_032_h_mo_majoration_and_estimate_item_functions.sql",
  "029_est_031_labor_split_atelier_chantier.sql",
  "030_est_118_bulk_update_version_token_guard.sql",
  "031_est181_templates_tenant_triggers_alignment.sql",
  "20260222_est144_audit_index.sql",
  "20260304_ux2_005_affaires_backend.sql",
  "20260305_ux2_007_link_dpgf_to_project.sql",
  "20260306_ux2_020_analytics.sql",
]);

const EMPTY_MIGRATION_TOMBSTONES = new Set([
  "20260718014058_protect_takeoff_replace_with_recovery.sql",
]);

export const MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS = 10 * 60 * 1000;

export function parseUtcMigrationTimestamp(timestamp: string) {
  const parts = timestamp.match(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/
  );
  if (!parts) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
    ? date
    : null;
}

export const UNTRACKED_LEGACY_MIGRATION_VERSIONS = new Set([
  "20260222",
  "20260304",
  "20260305",
  "20260306",
]);

export interface SupabaseMigrationInventory {
  files: string[];
  versions: string[];
  errors: string[];
}

export interface AppliedMigrationRow {
  local: string;
  remote?: string;
}

interface MigrationManifest {
  algorithm: "sha256";
  migrations: Record<string, string>;
}

export function computeSupabaseMigrationHashes(rootDirectory = process.cwd()) {
  const migrationsDirectory = path.join(rootDirectory, "supabase", "migrations");
  return Object.fromEntries(
    fs
      .readdirSync(migrationsDirectory)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort()
      .map((fileName) => {
        const contents = fs
          .readFileSync(path.join(migrationsDirectory, fileName), "utf8")
          .replace(/\r\n/g, "\n");
        return [fileName, createHash("sha256").update(contents).digest("hex")];
      })
  );
}

function validateMigrationManifest(
  rootDirectory: string,
  files: string[],
  errors: string[]
) {
  const manifestPath = path.join(
    rootDirectory,
    "supabase",
    "migrations.manifest.json"
  );
  if (!fs.existsSync(manifestPath)) {
    errors.push("supabase/migrations.manifest.json is missing");
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as MigrationManifest;
  if (manifest.algorithm !== "sha256" || !manifest.migrations) {
    errors.push("Supabase migration manifest must use sha256");
    return;
  }

  const manifestFiles = Object.keys(manifest.migrations).sort();
  if (JSON.stringify(manifestFiles) !== JSON.stringify(files)) {
    errors.push(
      `migration manifest inventory mismatch: expected ${files.length}, received ${manifestFiles.length}`
    );
  }

  const actualHashes = computeSupabaseMigrationHashes(rootDirectory);
  for (const fileName of files) {
    if (manifest.migrations[fileName] !== actualHashes[fileName]) {
      errors.push(`deployed migration content changed: ${fileName}`);
    }
  }
}

function extractTomlSection(config: string, sectionName: string) {
  const lines = config.split(/\r?\n/);
  const startIndex = lines.findIndex(
    (line) => line.trim() === `[${sectionName}]`
  );
  if (startIndex < 0) {
    return "";
  }

  const sectionLines: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      break;
    }
    sectionLines.push(line);
  }
  return sectionLines.join("\n");
}

function validateSeedConfiguration(rootDirectory: string, errors: string[]) {
  const configPath = path.join(rootDirectory, "supabase", "config.toml");
  const config = fs.readFileSync(configPath, "utf8");
  const seedSection = extractTomlSection(config, "db.seed");
  const enabledMatch = seedSection.match(/^\s*enabled\s*=\s*(true|false)\s*$/m);

  if (!enabledMatch) {
    errors.push("supabase/config.toml must declare [db.seed].enabled explicitly");
    return;
  }

  const seedEnabled = enabledMatch[1] === "true";
  const defaultSeedPath = path.join(rootDirectory, "supabase", "seed.sql");
  if (seedEnabled && !fs.existsSync(defaultSeedPath)) {
    errors.push("database seeding is enabled but supabase/seed.sql is absent");
  }

  const migrationsSection = extractTomlSection(config, "db.migrations");
  if (/schema\.sql/i.test(migrationsSection)) {
    errors.push("supabase/schema.sql must not be configured as a migration source");
  }
}

export function inspectSupabaseMigrations(
  rootDirectory = process.cwd(),
  now = new Date()
): SupabaseMigrationInventory {
  const migrationsDirectory = path.join(rootDirectory, "supabase", "migrations");
  const files = fs
    .readdirSync(migrationsDirectory)
    .filter((fileName) => fileName.endsWith(".sql"))
    .sort();
  const versions = files.map((fileName) => fileName.split("_", 1)[0]);
  const errors: string[] = [];

  const seenVersions = new Set<string>();
  for (const [index, fileName] of files.entries()) {
    const version = versions[index];
    if (seenVersions.has(version)) {
      errors.push(`duplicate migration version: ${version}`);
    }
    seenVersions.add(version);

    const canonicalMatch = fileName.match(
      /^(\d{14})_[a-z0-9][a-z0-9_]*\.sql$/
    );
    if (!canonicalMatch) {
      if (!LEGACY_MIGRATION_FILES.has(fileName)) {
        errors.push(`new migration names must use a 14-digit timestamp: ${fileName}`);
      }
    } else {
      const timestamp = parseUtcMigrationTimestamp(canonicalMatch[1]);
      if (!timestamp) {
        errors.push(`migration timestamp is not valid UTC: ${fileName}`);
      } else if (
        timestamp.getTime() >
        now.getTime() + MAX_FUTURE_MIGRATION_TIMESTAMP_SKEW_MS
      ) {
        errors.push(`migration timestamp is too far in the future: ${fileName}`);
      }
    }

    const migrationPath = path.join(migrationsDirectory, fileName);
    const sql = fs.readFileSync(migrationPath, "utf8");
    if (sql.trim().length === 0) {
      if (!EMPTY_MIGRATION_TOMBSTONES.has(fileName)) {
        errors.push(`empty migration is not an allowlisted tombstone: ${fileName}`);
      }
    } else if (EMPTY_MIGRATION_TOMBSTONES.has(fileName)) {
      errors.push(`deployed migration tombstone must remain empty: ${fileName}`);
    }

    if (/^\s*\\(?:i|ir)\s+.*schema\.sql/im.test(sql)) {
      errors.push(`migration must not execute the destructive schema snapshot: ${fileName}`);
    }
  }

  for (const tombstone of EMPTY_MIGRATION_TOMBSTONES) {
    if (!files.includes(tombstone)) {
      errors.push(`allowlisted migration tombstone is missing: ${tombstone}`);
    }
  }

  validateMigrationManifest(rootDirectory, files, errors);
  validateSeedConfiguration(rootDirectory, errors);
  return { files, versions, errors };
}

export function parseSupabaseMigrationList(output: string): AppliedMigrationRow[] {
  const versionPattern = /^(?:\d{3}|\d{8}|\d{14})$/;
  for (const line of output.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("{")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmedLine) as {
        migrations?: Array<{ local?: unknown; remote?: unknown }>;
      };
      if (Array.isArray(parsed.migrations)) {
        return parsed.migrations
          .filter(
            (row): row is { local: string; remote?: string } =>
              typeof row.local === "string" &&
              versionPattern.test(row.local) &&
              (row.remote === "" ||
                (typeof row.remote === "string" &&
                  versionPattern.test(row.remote)))
          )
          .map((row) => ({
            local: row.local,
            remote: row.remote || undefined,
          }));
      }
    } catch {
      // Fall through to the pinned CLI text format parser.
    }
  }

  const rows: AppliedMigrationRow[] = [];
  for (const line of output.split(/\r?\n/)) {
    const normalizedLine = line
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/`/g, "");
    const match = normalizedLine.match(
      /^\s*(\d{3}|\d{8}|\d{14})\s*[|│]\s*(\d{3}|\d{8}|\d{14})?\s*[|│]/
    );
    if (match) {
      rows.push({ local: match[1], remote: match[2] || undefined });
    }
  }
  return rows;
}

export function validateAppliedMigrationRows(
  expectedVersions: string[],
  appliedRows: AppliedMigrationRow[]
) {
  const errors: string[] = [];
  const localVersions = appliedRows.map((row) => row.local);
  const appliedVersions = appliedRows.map((row) => row.remote).filter(Boolean);
  const expectedAppliedVersions = expectedVersions.filter(
    (version) => !UNTRACKED_LEGACY_MIGRATION_VERSIONS.has(version)
  );

  if (JSON.stringify(localVersions) !== JSON.stringify(expectedVersions)) {
    errors.push(
      `local migration inventory mismatch: expected ${expectedVersions.length}, received ${localVersions.length}`
    );
  }
  if (
    JSON.stringify(appliedVersions) !== JSON.stringify(expectedAppliedVersions)
  ) {
    errors.push(
      `applied migration inventory mismatch: expected ${expectedAppliedVersions.length}, received ${appliedVersions.length}`
    );
  }
  for (const row of appliedRows) {
    if (UNTRACKED_LEGACY_MIGRATION_VERSIONS.has(row.local)) {
      if (row.remote !== undefined) {
        errors.push(
          `legacy migration must remain local-only in CLI history: ${row.local}`
        );
      }
    } else if (row.remote !== row.local) {
      errors.push(`migration is not applied locally: ${row.local}`);
    }
  }

  return errors;
}
