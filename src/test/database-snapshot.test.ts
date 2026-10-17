import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  compareDatabaseFingerprints,
  compareStackState,
  computeDatabaseSnapshotKey,
  DATABASE_FINGERPRINT_SQL,
  DATABASE_SNAPSHOT_FORMAT,
  type DatabaseFingerprint,
  type DatabaseSnapshotManifest,
  lookUpDatabaseSnapshot,
  parseDatabaseFingerprint,
  recordDatabaseSnapshot,
  resolveDatabaseSnapshotDirectory,
  STACK_OWNED_SCHEMAS,
} from "@/test/database-snapshot";

const temporaryDirectories: string[] = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "database-snapshot-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

function repository() {
  const root = temporaryDirectory();
  fs.mkdirSync(path.join(root, "supabase", "migrations"), { recursive: true });
  fs.writeFileSync(path.join(root, "supabase", "migrations", "001_init.sql"), "create table a (id int);\n");
  fs.writeFileSync(path.join(root, "supabase", "migrations", "002_more.sql"), "create table b (id int);\n");
  return root;
}

const keyOptions = { configTemplate: "[db]\nport = 54322\n", postgresBundle: "17.11.0.004-r1", supabaseCli: "2.120.0" };

const fingerprintOutput = [
  "columns|10|0123456789abcdef0123456789abcdef",
  "data|5|11111111111111111111111111111111",
  "functions|3|22222222222222222222222222222222",
  "namespaces|4|33333333333333333333333333333333",
  "policies|2|44444444444444444444444444444444",
  "relations|5|55555555555555555555555555555555",
  "stack_state|2|66666666666666666666666666666666",
].join("\n");

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function writeSnapshot(directory: string, key: string, overrides: Partial<DatabaseSnapshotManifest> = {}) {
  const dump = Buffer.from("PGDMP fixture dump");
  fs.writeFileSync(path.join(directory, "postgres.dump"), dump);
  const manifest: DatabaseSnapshotManifest = {
    format: DATABASE_SNAPSHOT_FORMAT,
    key,
    inputs: { supabaseCli: "2.120.0", postgresBundle: "17.11.0.004-r1", configTemplateSha256: "c".repeat(64), files: [] },
    postgres: { bundle: "17.11.0.004-r1", version: "PostgreSQL 17.6" },
    migrations: ["001", "002"],
    fingerprint: parseDatabaseFingerprint(fingerprintOutput),
    stackOwnedSchemas: [...STACK_OWNED_SCHEMAS],
    privilegeRepairs: ["set role supabase_admin; grant USAGE on schema graphql to anon; reset role;"],
    dump: { file: "postgres.dump", bytes: dump.length, sha256: sha256(dump) },
    createdAt: "2026-10-17T00:00:00.000Z",
    ...overrides,
  };
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify(manifest));
  return manifest;
}

describe("database snapshot", () => {
  it("is opt-in and accepts only an absolute real directory outside disposable workdirs", () => {
    expect(resolveDatabaseSnapshotDirectory({})).toBeUndefined();
    expect(resolveDatabaseSnapshotDirectory({ ARMY_DB_SNAPSHOT_DIR: "  " })).toBeUndefined();
    const parent = temporaryDirectory();
    const target = path.join(parent, "snapshot");
    expect(resolveDatabaseSnapshotDirectory({ ARMY_DB_SNAPSHOT_DIR: target })).toBe(target);
    expect(() => resolveDatabaseSnapshotDirectory({ ARMY_DB_SNAPSHOT_DIR: "relative/snapshot" })).toThrow("absolute");
    expect(() => resolveDatabaseSnapshotDirectory({ ARMY_DB_SNAPSHOT_DIR: os.tmpdir() })).toThrow("temporary root");
    expect(() => resolveDatabaseSnapshotDirectory({
      ARMY_DB_SNAPSHOT_DIR: path.join(os.tmpdir(), "miaouffrage-supabase-ci-abc", "snapshot"),
    })).toThrow("disposable stack workdir");
    const file = path.join(parent, "file");
    fs.writeFileSync(file, "");
    expect(() => resolveDatabaseSnapshotDirectory({ ARMY_DB_SNAPSHOT_DIR: file })).toThrow("real directory");
  });

  it("keys the snapshot on migrations, seeds, config template, CLI and PostgreSQL bundle", () => {
    const root = repository();
    const base = computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: root });
    expect(base.key).toMatch(/^[0-9a-f]{64}$/);
    expect(base.files.map((file) => file.path)).toEqual([
      "supabase/migrations/001_init.sql",
      "supabase/migrations/002_more.sql",
    ]);
    expect(computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: root }).key).toBe(base.key);

    const variants = [
      computeDatabaseSnapshotKey({ ...keyOptions, configTemplate: "[db]\nport = 54323\n", rootDirectory: root }),
      computeDatabaseSnapshotKey({ ...keyOptions, postgresBundle: "17.12.0.000-r1", rootDirectory: root }),
      computeDatabaseSnapshotKey({ ...keyOptions, supabaseCli: "2.121.0", rootDirectory: root }),
    ];
    fs.appendFileSync(path.join(root, "supabase", "migrations", "002_more.sql"), "-- one more byte\n");
    variants.push(computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: root }));
    fs.writeFileSync(path.join(root, "supabase", "seed.sql"), "insert into a values (1);\n");
    variants.push(computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: root }));
    fs.mkdirSync(path.join(root, "supabase", "seeds"));
    fs.writeFileSync(path.join(root, "supabase", "seeds", "extra.sql"), "insert into b values (1);\n");
    const withSeeds = computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: root });
    variants.push(withSeeds);
    expect(withSeeds.files.map((file) => file.path)).toContain("supabase/seeds/extra.sql");
    expect(new Set([base.key, ...variants.map((variant) => variant.key)]).size).toBe(variants.length + 1);

    const empty = temporaryDirectory();
    fs.mkdirSync(path.join(empty, "supabase"));
    expect(() => computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: empty })).toThrow("requires the repository migrations");
  });

  it("hits only a complete snapshot whose key and dump digest match", () => {
    const directory = temporaryDirectory();
    expect(lookUpDatabaseSnapshot(directory, "k".repeat(64))).toEqual({ hit: false, reason: "no snapshot recorded" });

    const manifest = writeSnapshot(directory, "a".repeat(64));
    const hit = lookUpDatabaseSnapshot(directory, "a".repeat(64));
    expect(hit.hit).toBe(true);
    expect(hit.hit && hit.snapshot.manifest.privilegeRepairs).toEqual(manifest.privilegeRepairs);
    expect(hit.hit && hit.snapshot.dumpPath).toBe(path.join(directory, "postgres.dump"));

    expect(lookUpDatabaseSnapshot(directory, "b".repeat(64))).toMatchObject({ hit: false, reason: expect.stringContaining("key") });

    writeSnapshot(directory, "a".repeat(64), { format: "army-db-snapshot-0" as typeof DATABASE_SNAPSHOT_FORMAT });
    expect(lookUpDatabaseSnapshot(directory, "a".repeat(64))).toMatchObject({ hit: false, reason: expect.stringContaining("format") });

    for (const incomplete of [
      { migrations: [] },
      { stackOwnedSchemas: [] },
      { privilegeRepairs: [42 as unknown as string] },
      { fingerprint: { ...manifest.fingerprint, stack: "not-a-digest" } },
    ] satisfies Array<Partial<DatabaseSnapshotManifest>>) {
      writeSnapshot(directory, "a".repeat(64), incomplete);
      expect(lookUpDatabaseSnapshot(directory, "a".repeat(64))).toEqual({ hit: false, reason: "manifest is incomplete" });
    }

    writeSnapshot(directory, "a".repeat(64));
    fs.appendFileSync(path.join(directory, "postgres.dump"), "tampered");
    expect(lookUpDatabaseSnapshot(directory, "a".repeat(64))).toEqual({ hit: false, reason: "dump digest does not match its manifest" });

    fs.writeFileSync(path.join(directory, "manifest.json"), "{not json");
    expect(lookUpDatabaseSnapshot(directory, "a".repeat(64))).toMatchObject({ hit: false, reason: expect.stringContaining("unreadable") });
  });

  it("parses the catalog fingerprint and keeps stack-owned state out of the recorded comparison", () => {
    const recorded = parseDatabaseFingerprint(fingerprintOutput);
    expect(recorded.components.policies).toBe("2:44444444444444444444444444444444");
    expect(compareDatabaseFingerprints(recorded, parseDatabaseFingerprint(fingerprintOutput))).toEqual([]);

    const otherStack = parseDatabaseFingerprint(fingerprintOutput.replace(
      "stack_state|2|66666666666666666666666666666666", "stack_state|2|77777777777777777777777777777777"
    ));
    expect(compareDatabaseFingerprints(recorded, otherStack)).toEqual([]);
    expect(compareStackState(recorded, otherStack)).toBe(false);
    expect(compareStackState(recorded, parseDatabaseFingerprint(fingerprintOutput))).toBe(true);

    const policyDrift = parseDatabaseFingerprint(fingerprintOutput.replace("policies|2|", "policies|3|"));
    expect(compareDatabaseFingerprints(recorded, policyDrift)).toEqual(["policies"]);
    const dataDrift = parseDatabaseFingerprint(fingerprintOutput.replace("data|5|1111", "data|5|2222"));
    expect(compareDatabaseFingerprints(recorded, dataDrift)).toEqual(["data"]);

    // A hand-edited manifest that keeps its components but not its digests.
    const forged: DatabaseFingerprint = { ...recorded, schema: "f".repeat(64) };
    expect(compareDatabaseFingerprints(forged, parseDatabaseFingerprint(fingerprintOutput))).toEqual(["schema"]);

    expect(() => parseDatabaseFingerprint("columns|1|zz")).toThrow("not recognized");
    expect(() => parseDatabaseFingerprint("columns|1|0123456789abcdef0123456789abcdef")).toThrow("missing data");
  });

  it.skipIf(process.platform === "win32")("leaves no directory for a cache step to save when the dump fails", () => {
    const bin = temporaryDirectory();
    const tool = (name: string, script: string) => {
      const file = path.join(bin, name);
      fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
      return file;
    };
    const tools = {
      bundle: "17.11.0.004-r1",
      // Reads its piped SQL like the real psql: exiting first races the parent's
      // write into an EPIPE (seen on the CI runner, 17/10/2026).
      psql: tool("psql", "cat >/dev/null; exit 0"),
      pgDump: tool("pg_dump", "echo 'pg_dump: error: connection refused' >&2; exit 1"),
      pgRestore: tool("pg_restore", "exit 1"),
    };
    const directory = path.join(temporaryDirectory(), "snapshot");
    const root = repository();
    expect(() => recordDatabaseSnapshot({
      databaseUrl: "postgresql://postgres:local-secret@127.0.0.1:54322/postgres",
      directory,
      environment: { PATH: process.env.PATH },
      fingerprint: parseDatabaseFingerprint(fingerprintOutput),
      key: computeDatabaseSnapshotKey({ ...keyOptions, rootDirectory: root }),
      migrations: ["001", "002"],
      serverVersion: "PostgreSQL 17.6",
      tools,
    })).toThrow(/^pg_dump failed with exit code 1: pg_dump: error: connection refused$/);
    expect(fs.existsSync(directory)).toBe(false);
  });

  it("fingerprints every component the restore must reproduce", () => {
    for (const component of [
      "namespaces", "relations", "columns", "constraints", "indexes", "functions", "policies", "triggers", "views",
      "rules", "types", "sequences", "statistics", "extensions", "default_privileges", "event_triggers",
      "publications", "comments", "database", "database_settings", "data", "stack_state",
    ]) {
      expect(DATABASE_FINGERPRINT_SQL).toContain(`'${component}'`);
    }
    expect(DATABASE_FINGERPRINT_SQL).toContain("pg_get_functiondef");
    expect(DATABASE_FINGERPRINT_SQL).toContain("aclexplode");
    expect(STACK_OWNED_SCHEMAS).toEqual(["_realtime"]);
  });
});
