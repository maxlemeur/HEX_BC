import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createLocalCiEnvironment, type SupabaseEnvironment } from "@/test/supabase-cli";

/**
 * Pre-migrated database snapshot for the owned native stack (opt-in through
 * ARMY_DB_SNAPSHOT_DIR). A miss keeps today's `db reset`, then dumps the
 * verified database; a hit restores that dump instead and must prove the same
 * applied migrations and catalog fingerprint, or the caller falls back to
 * `db reset`. Bump the format whenever the dump, restore or fingerprint
 * contract changes: older snapshots then miss.
 */
export const DATABASE_SNAPSHOT_FORMAT = "army-db-snapshot-1";
export const DATABASE_SNAPSHOT_DIRECTORY_VARIABLE = "ARMY_DB_SNAPSHOT_DIR";

/**
 * Schemas whose content belongs to the running stack instance, not to the
 * migrations: the realtime service records its tenant there, with this
 * stack's own database port. The snapshot leaves them out and a restore keeps
 * the current stack's copy; the fingerprint proves that copy unchanged.
 */
export const STACK_OWNED_SCHEMAS = ["_realtime"] as const;

const MANIFEST_FILE = "manifest.json";
const DUMP_FILE = "postgres.dump";
const MAX_DUMP_BYTES = 512 * 1024 * 1024;
// The native start script owns the cluster as this superuser with the stack's
// database password. A full-database restore needs it for Supabase-owned objects.
const SNAPSHOT_DATABASE_ROLE = "supabase_admin";
const ISOLATED_WORKDIR_PREFIX = "miaouffrage-supabase-ci-";
const STACK_OWNED_SCHEMAS_SQL = `array[${STACK_OWNED_SCHEMAS.map((name) => `'${name}'`).join(", ")}]::text[]`;

export interface DatabaseSnapshotKey {
  key: string;
  supabaseCli: string;
  postgresBundle: string;
  configTemplateSha256: string;
  files: Array<{ path: string; sha256: string }>;
}

export interface DatabaseFingerprint {
  /** Every catalog component: definitions, ownership and privileges. */
  schema: string;
  /** Rows of every table outside the stack-owned schemas, and sequence values. */
  data: string;
  /** Stack-owned rows and database settings: compared with this stack's own. */
  stack: string;
  components: Record<string, string>;
}

export interface DatabaseSnapshotManifest {
  format: typeof DATABASE_SNAPSHOT_FORMAT;
  key: string;
  inputs: Omit<DatabaseSnapshotKey, "key">;
  postgres: { bundle: string; version: string };
  migrations: string[];
  fingerprint: DatabaseFingerprint;
  stackOwnedSchemas: string[];
  privilegeRepairs: string[];
  dump: { file: typeof DUMP_FILE; bytes: number; sha256: string };
  createdAt: string;
}

export interface DatabaseSnapshot {
  directory: string;
  dumpPath: string;
  manifest: DatabaseSnapshotManifest;
}

export type DatabaseSnapshotLookup =
  | { hit: true; snapshot: DatabaseSnapshot }
  | { hit: false; reason: string };

export interface NativePostgresTools {
  bundle: string;
  pgDump: string;
  pgRestore: string;
  psql: string;
}

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Returns the opt-in snapshot directory, or undefined when the flag is unset:
 * local runs keep `db reset` by default. The directory must be absolute, must
 * not be a link and must live outside the disposable stack workdirs.
 */
export function resolveDatabaseSnapshotDirectory(environment: SupabaseEnvironment) {
  const value = environment[DATABASE_SNAPSHOT_DIRECTORY_VARIABLE]?.trim();
  if (!value) return undefined;
  if (!path.isAbsolute(value)) {
    throw new Error(`${DATABASE_SNAPSHOT_DIRECTORY_VARIABLE} must be an absolute path`);
  }
  const directory = path.resolve(value);
  const temporary = path.resolve(os.tmpdir());
  if (directory.split(path.sep).some((segment) => segment.startsWith(ISOLATED_WORKDIR_PREFIX)) ||
    directory === temporary || directory === path.parse(directory).root) {
    throw new Error(`${DATABASE_SNAPSHOT_DIRECTORY_VARIABLE} must not be a disposable stack workdir, the temporary root or a filesystem root`);
  }
  if (fs.existsSync(directory) && (fs.lstatSync(directory).isSymbolicLink() || !fs.lstatSync(directory).isDirectory())) {
    throw new Error(`${DATABASE_SNAPSHOT_DIRECTORY_VARIABLE} must be a real directory, not a link or a file`);
  }
  return directory;
}

function listFiles(directory: string, relativeTo: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Database snapshot inputs must not contain links: ${path.relative(relativeTo, file)}`);
    return entry.isDirectory() ? listFiles(file, relativeTo) : [path.relative(relativeTo, file).split(path.sep).join("/")];
  });
}

/**
 * Keys the snapshot on every byte that shapes the reset database: all files
 * under supabase/migrations, supabase/seed*.sql and supabase/seeds/**, the
 * isolated config.toml template, the pinned Supabase CLI version and the
 * PostgreSQL bundle that CLI installed.
 */
export function computeDatabaseSnapshotKey(options: {
  configTemplate: string;
  postgresBundle: string;
  rootDirectory: string;
  supabaseCli: string;
}): DatabaseSnapshotKey {
  const supabaseDirectory = path.join(options.rootDirectory, "supabase");
  const seedFiles = fs.readdirSync(supabaseDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^seed.*\.sql$/i.test(entry.name))
    .map((entry) => `supabase/${entry.name}`);
  const names = [
    ...listFiles(path.join(supabaseDirectory, "migrations"), options.rootDirectory),
    ...seedFiles,
    ...listFiles(path.join(supabaseDirectory, "seeds"), options.rootDirectory),
  ].sort();
  const files = names.map((name) => ({
    path: name,
    sha256: sha256(fs.readFileSync(path.join(options.rootDirectory, name))),
  }));
  if (!files.some((file) => file.path.startsWith("supabase/migrations/"))) {
    throw new Error("Database snapshot key requires the repository migrations");
  }
  const configTemplateSha256 = sha256(options.configTemplate);
  const key = sha256(JSON.stringify({
    format: DATABASE_SNAPSHOT_FORMAT,
    supabaseCli: options.supabaseCli,
    postgresBundle: options.postgresBundle,
    configTemplateSha256,
    files,
  }));
  return { key, supabaseCli: options.supabaseCli, postgresBundle: options.postgresBundle, configTemplateSha256, files };
}

function readRegularFile(file: string, maximumBytes: number) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
  if (stat.size > maximumBytes) throw new Error(`${path.basename(file)} exceeds ${maximumBytes} bytes`);
  return fs.readFileSync(file);
}

const DIGEST = /^[0-9a-f]{64}$/;

/** Reads a snapshot only when its manifest, key and dump digest all match. */
export function lookUpDatabaseSnapshot(directory: string, key: string): DatabaseSnapshotLookup {
  const manifestPath = path.join(directory, MANIFEST_FILE);
  if (!fs.existsSync(manifestPath)) return { hit: false, reason: "no snapshot recorded" };
  try {
    const manifest = JSON.parse(readRegularFile(manifestPath, 1024 * 1024).toString("utf8")) as DatabaseSnapshotManifest;
    if (manifest.format !== DATABASE_SNAPSHOT_FORMAT) return { hit: false, reason: `format ${String(manifest.format)} is not ${DATABASE_SNAPSHOT_FORMAT}` };
    if (manifest.key !== key) return { hit: false, reason: "recorded key does not match the current migrations, seed, config template, CLI or PostgreSQL bundle" };
    if (manifest.dump?.file !== DUMP_FILE || !DIGEST.test(manifest.dump.sha256 ?? "") ||
      !DIGEST.test(manifest.fingerprint?.schema ?? "") || !DIGEST.test(manifest.fingerprint?.data ?? "") ||
      !DIGEST.test(manifest.fingerprint?.stack ?? "") || typeof manifest.fingerprint?.components !== "object" ||
      !Array.isArray(manifest.migrations) || manifest.migrations.length === 0 ||
      JSON.stringify(manifest.stackOwnedSchemas) !== JSON.stringify(STACK_OWNED_SCHEMAS) ||
      !Array.isArray(manifest.privilegeRepairs) || manifest.privilegeRepairs.some((statement) => typeof statement !== "string")) {
      return { hit: false, reason: "manifest is incomplete" };
    }
    const dumpPath = path.join(directory, DUMP_FILE);
    const dump = readRegularFile(dumpPath, MAX_DUMP_BYTES);
    if (dump.length !== manifest.dump.bytes || sha256(dump) !== manifest.dump.sha256) {
      return { hit: false, reason: "dump digest does not match its manifest" };
    }
    return { hit: true, snapshot: { directory, dumpPath, manifest } };
  } catch (error) {
    return { hit: false, reason: `unreadable snapshot (${error instanceof Error ? error.message : String(error)})` };
  }
}

/** The native runtime ships one PostgreSQL bundle; its client tools match the server. */
export function resolveNativePostgresTools(homeDirectory = os.homedir()): NativePostgresTools {
  const cache = path.join(homeDirectory, ".supabase", "cache", "stack", "slim-services", "postgres");
  const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "x64" ? "amd64" : "arm64"}`;
  const bundles = fs.readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(cache, entry.name, platform, "bin", "psql")))
    .map((entry) => entry.name);
  if (bundles.length !== 1) throw new Error("The native runtime must provide exactly one PostgreSQL client");
  const binary = (name: string) => {
    const file = path.join(cache, bundles[0], platform, "bin", name);
    fs.accessSync(file, fs.constants.X_OK);
    return file;
  };
  return { bundle: bundles[0], pgDump: binary("pg_dump"), pgRestore: binary("pg_restore"), psql: binary("psql") };
}

interface SnapshotConnection {
  host: string;
  password: string;
  port: string;
}

function snapshotConnection(databaseUrl: string): SnapshotConnection {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !url.port || !url.password || url.pathname !== "/postgres" || url.search || url.hash) {
    throw new Error("Database snapshots require the owned loopback PostgreSQL route");
  }
  return { host: url.hostname === "[::1]" ? "::1" : url.hostname, password: decodeURIComponent(url.password), port: url.port };
}

function runPostgresTool(
  tool: string,
  args: string[],
  connection: SnapshotConnection,
  environment: SupabaseEnvironment,
  options: { input?: string; serverOptions?: string } = {}
) {
  // The password travels in the child environment only, never in argv.
  const result = spawnSync(tool, [
    `--host=${connection.host}`, `--port=${connection.port}`, `--username=${SNAPSHOT_DATABASE_ROLE}`, "--no-password", ...args,
  ], {
    encoding: "utf8",
    env: {
      ...createLocalCiEnvironment(environment),
      LC_ALL: "C.UTF-8",
      PGAPPNAME: "miaouffrage-db-snapshot",
      PGCONNECT_TIMEOUT: "10",
      PGPASSWORD: connection.password,
      PGTZ: "UTC",
      ...(options.serverOptions ? { PGOPTIONS: options.serverOptions } : {}),
    },
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    timeout: 10 * 60 * 1000,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? ""}${result.error ? ` ${result.error.message}` : ""}`
      .replaceAll(connection.password, "[redacted]").trim().slice(-2_000);
    throw new Error(`${path.basename(tool)} failed with exit code ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`);
  }
  return result.stdout ?? "";
}

function runQuery(tools: NativePostgresTools, databaseUrl: string, environment: SupabaseEnvironment, sql: string, database = "postgres") {
  return runPostgresTool(tools.psql, [`--dbname=${database}`, "-X", "-A", "-t", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"],
    snapshotConnection(databaseUrl), environment, { input: sql });
}

// Sorted, owner-normalized privileges: a NULL ACL means the type's default.
function aclItems(acl: string) {
  return `(select coalesce(string_agg(item, ',' order by item), '') from (
    select format('%s:%s:%s', case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,
      a.privilege_type, a.is_grantable) as item from aclexplode(${acl}) a) acl_items)`;
}

function tableRowsDigest(component: string, condition: string) {
  return `select '${component}', format('%L|%L|%L', s.nspname, c.relname,
    (xpath('/row/h/text()', query_to_xml(format(
      'select md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), '''')) as h from %I.%I t',
      s.nspname, c.relname), false, true, '')))[1]::text)
  from pg_class c join scope s on s.oid = c.relnamespace where c.relkind = 'r' and ${condition}`;
}

/**
 * One catalog query per database: each component hashes sorted definition
 * lines, independent of OIDs, physical column numbers and ACL item order,
 * which a dump and restore are free to change. Grantors are omitted for the
 * same reason; grantee, privilege and grant option are kept.
 */
export const DATABASE_FINGERPRINT_SQL = `
set search_path = pg_catalog;
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set intervalstyle = 'postgres';
set extra_float_digits = 3;
set bytea_output = 'hex';
with scope as (
  select n.oid, n.nspname from pg_namespace n
  where n.nspname not in ('pg_catalog', 'information_schema') and n.nspname !~ '^pg_(toast|temp_|toast_temp_)'
),
lines(component, line) as (
  select 'namespaces', format('%L|%L|%L', n.nspname, pg_get_userbyid(n.nspowner),
    ${aclItems("coalesce(n.nspacl, acldefault('n', n.nspowner))")})
  from pg_namespace n join scope s on s.oid = n.oid
  union all
  select 'relations', format('%L|%L|%L|%L|%L|%L|%L|%L|%L|%L', s.nspname, c.relname, c.relkind, c.relpersistence,
    c.relrowsecurity, c.relforcerowsecurity, pg_get_userbyid(c.relowner), array_to_string(c.reloptions, ','),
    pg_get_expr(c.relpartbound, c.oid),
    case when c.relkind = 'c' then '' else ${aclItems("coalesce(c.relacl, case when c.relkind = 'S' then acldefault('s', c.relowner) else acldefault('r', c.relowner) end)")} end)
  from pg_class c join scope s on s.oid = c.relnamespace
  where c.relkind in ('r', 'p', 'v', 'm', 'S', 'f', 'c')
  union all
  select 'columns', format('%L|%L|%s|%L|%L|%L|%L|%L|%L|%L|%L', s.nspname, c.relname,
    row_number() over (partition by a.attrelid order by a.attnum), a.attname, format_type(a.atttypid, a.atttypmod),
    a.attnotnull, pg_get_expr(d.adbin, d.adrelid), a.attidentity, a.attgenerated,
    case when a.attcollation <> 0 then a.attcollation::regcollation::text end,
    ${aclItems("a.attacl")})
  from pg_attribute a join pg_class c on c.oid = a.attrelid join scope s on s.oid = c.relnamespace
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where c.relkind in ('r', 'p', 'v', 'm', 'f', 'c') and a.attnum > 0 and not a.attisdropped
  union all
  select 'constraints', format('%L|%L|%L|%L|%L', s.nspname,
    case when co.conrelid <> 0 then co.conrelid::regclass::text else co.contypid::regtype::text end,
    co.conname, co.contype, pg_get_constraintdef(co.oid, true))
  from pg_constraint co join scope s on s.oid = co.connamespace
  union all
  select 'indexes', format('%L|%L|%L', s.nspname, pg_get_indexdef(i.indexrelid), i.indisclustered)
  from pg_index i join pg_class c on c.oid = i.indexrelid join scope s on s.oid = c.relnamespace
  union all
  select 'functions', format('%L|%L|%L|%L|%L|%L', s.nspname, p.oid::regprocedure::text, p.prokind,
    pg_get_userbyid(p.proowner), ${aclItems("coalesce(p.proacl, acldefault('f', p.proowner))")},
    md5(case when p.prokind <> 'a' then pg_get_functiondef(p.oid) else
      (select format('%s|%s|%s', ag.aggtransfn, ag.aggfinalfn, ag.agginitval) from pg_aggregate ag where ag.aggfnoid = p.oid) end))
  from pg_proc p join scope s on s.oid = p.pronamespace
  union all
  select 'policies', format('%L|%L|%L|%L|%L|%L|%L', po.polrelid::regclass::text, po.polname, po.polcmd, po.polpermissive,
    (select string_agg(role_name, ',' order by role_name) from (
      select case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end as role_name from unnest(po.polroles) r) roles),
    pg_get_expr(po.polqual, po.polrelid), pg_get_expr(po.polwithcheck, po.polrelid))
  from pg_policy po join pg_class c on c.oid = po.polrelid join scope s on s.oid = c.relnamespace
  union all
  select 'triggers', format('%L|%L', pg_get_triggerdef(t.oid, true), t.tgenabled)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join scope s on s.oid = c.relnamespace
  where not t.tgisinternal
  union all
  select 'views', format('%L|%L|%L', s.nspname, c.relname, md5(pg_get_viewdef(c.oid, true)))
  from pg_class c join scope s on s.oid = c.relnamespace where c.relkind in ('v', 'm')
  union all
  select 'rules', format('%L|%L|%L', ru.schemaname, ru.tablename, md5(ru.definition))
  from pg_rules ru join scope s on s.nspname = ru.schemaname
  union all
  select 'types', format('%L|%L|%L|%L|%L|%L|%L|%L|%L', s.nspname, t.typname, t.typtype, pg_get_userbyid(t.typowner),
    ${aclItems("coalesce(t.typacl, acldefault('T', t.typowner))")},
    (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid),
    case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end, t.typnotnull, t.typdefault)
  from pg_type t join scope s on s.oid = t.typnamespace
  where t.typcategory <> 'A'
    and not exists (select 1 from pg_class tc where tc.oid = t.typrelid and tc.relkind <> 'c')
  union all
  select 'sequences', format('%L|%L|%L|%L|%L|%L|%L|%L|%L', s.nspname, c.relname, sq.seqtypid::regtype::text,
    sq.seqstart, sq.seqincrement, sq.seqmax, sq.seqmin, sq.seqcache, sq.seqcycle)
  from pg_sequence sq join pg_class c on c.oid = sq.seqrelid join scope s on s.oid = c.relnamespace
  union all
  select 'statistics', format('%L|%L', s.nspname, pg_get_statisticsobjdef(st.oid))
  from pg_statistic_ext st join scope s on s.oid = st.stxnamespace
  union all
  select 'extensions', format('%L|%L|%L|%L', e.extname, e.extversion, e.extnamespace::regnamespace::text, pg_get_userbyid(e.extowner))
  from pg_extension e
  union all
  select 'default_privileges', format('%L|%L|%L|%L', pg_get_userbyid(da.defaclrole),
    case when da.defaclnamespace = 0 then '' else da.defaclnamespace::regnamespace::text end, da.defaclobjtype,
    ${aclItems("da.defaclacl")})
  from pg_default_acl da
  union all
  select 'event_triggers', format('%L|%L|%L|%L|%L|%L', et.evtname, et.evtevent, pg_get_userbyid(et.evtowner),
    et.evtfoid::regprocedure::text, et.evtenabled, array_to_string(et.evttags, ','))
  from pg_event_trigger et
  union all
  select 'publications', format('%L|%L|%L|%L|%L|%L|%L|%L|%L|%L', pb.pubname, pg_get_userbyid(pb.pubowner), pb.puballtables,
    pb.pubinsert, pb.pubupdate, pb.pubdelete, pb.pubtruncate, pb.pubviaroot,
    (select string_agg(format('%s:%s:%s', pr.prrelid::regclass, pg_get_expr(pr.prqual, pr.prrelid),
      (select string_agg(pa.attname, ',' order by pa.attname) from pg_attribute pa
        where pa.attrelid = pr.prrelid and pa.attnum = any(pr.prattrs))),
      ',' order by pr.prrelid::regclass::text) from pg_publication_rel pr where pr.prpubid = pb.oid),
    (select string_agg(pn.pnnspid::regnamespace::text, ',' order by pn.pnnspid::regnamespace::text)
      from pg_publication_namespace pn where pn.pnpubid = pb.oid))
  from pg_publication pb
  union all
  select 'comments', format('%L|%L|%L', io.type, io.identity, md5(de.description))
  from pg_description de cross join lateral pg_identify_object(de.classoid, de.objoid, de.objsubid) io
  where coalesce(io.schema, '') not in ('pg_catalog', 'information_schema')
  union all
  select 'database', format('%L|%L|%L|%L|%L|%L|%L', d.datname, pg_encoding_to_char(d.encoding), d.datlocprovider,
    d.datcollate, d.datctype, pg_get_userbyid(d.datdba), ${aclItems("coalesce(d.datacl, acldefault('d', d.datdba))")})
  from pg_database d where d.datname = current_database()
  union all
  select component, format('%L|%L', case when rs.setrole = 0 then '' else pg_get_userbyid(rs.setrole) end,
    (select string_agg(setting, ',' order by setting) from unnest(rs.setconfig) setting))
  from pg_db_role_setting rs cross join (values ('database_settings'), ('stack_state')) settings(component)
  where rs.setdatabase = (select oid from pg_database where datname = current_database())
  union all
  ${tableRowsDigest("data", `s.nspname <> all (${STACK_OWNED_SCHEMAS_SQL})`)}
  union all
  ${tableRowsDigest("stack_state", `s.nspname = any (${STACK_OWNED_SCHEMAS_SQL})`)}
  union all
  select 'data', format('%L|%L|%L', s.nspname, c.relname, pg_sequence_last_value(c.oid))
  from pg_class c join scope s on s.oid = c.relnamespace
  where c.relkind = 'S' and s.nspname <> all (${STACK_OWNED_SCHEMAS_SQL})
  union all
  select 'stack_state', format('%L|%L|%L', s.nspname, c.relname, pg_sequence_last_value(c.oid))
  from pg_class c join scope s on s.oid = c.relnamespace
  where c.relkind = 'S' and s.nspname = any (${STACK_OWNED_SCHEMAS_SQL})
)
select component || '|' || count(*) || '|' || md5(string_agg(line, E'\\n' order by line))
from lines group by component order by component;
`;

const SNAPSHOT_COMPONENTS = new Set(["data", "stack_state"]);

export function parseDatabaseFingerprint(output: string): DatabaseFingerprint {
  const components: Record<string, string> = {};
  for (const line of output.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(/^([a-z_]+)\|(\d+)\|([0-9a-f]{32})$/);
    if (!match) throw new Error("Database fingerprint output was not recognized");
    components[match[1]] = `${match[2]}:${match[3]}`;
  }
  for (const required of ["columns", "data", "functions", "namespaces", "policies", "relations"]) {
    if (!components[required]) throw new Error(`Database fingerprint is missing ${required}`);
  }
  const schemaLines = Object.entries(components).filter(([name]) => !SNAPSHOT_COMPONENTS.has(name))
    .map(([name, value]) => `${name}=${value}`).sort();
  return {
    schema: sha256(schemaLines.join("\n")),
    data: sha256(components.data),
    stack: sha256(components.stack_state ?? "none"),
    components,
  };
}

/**
 * Lists what differs between the recorded and the restored database, the
 * stack-owned state aside (see compareStackState). The digests are checked
 * too: a hand-edited manifest may keep its components.
 */
export function compareDatabaseFingerprints(expected: DatabaseFingerprint, actual: DatabaseFingerprint) {
  const names = [...new Set([...Object.keys(expected.components), ...Object.keys(actual.components)])]
    .filter((name) => name !== "stack_state").sort();
  const differing = names.filter((name) => expected.components[name] !== actual.components[name]);
  if (expected.schema !== actual.schema && !differing.some((name) => name !== "data")) differing.push("schema");
  if (expected.data !== actual.data && !differing.includes("data")) differing.push("data");
  return differing;
}

/** The current stack's own state must survive the restore unchanged. */
export function compareStackState(beforeRestore: DatabaseFingerprint, afterRestore: DatabaseFingerprint) {
  return beforeRestore.stack === afterRestore.stack &&
    beforeRestore.components.stack_state === afterRestore.components.stack_state;
}

export function computeDatabaseFingerprint(tools: NativePostgresTools, databaseUrl: string, environment: SupabaseEnvironment) {
  return parseDatabaseFingerprint(runQuery(tools, databaseUrl, environment, DATABASE_FINGERPRINT_SQL));
}

export function readServerVersion(tools: NativePostgresTools, databaseUrl: string, environment: SupabaseEnvironment) {
  return runQuery(tools, databaseUrl, environment, "select version();").trim();
}

/**
 * pg_dump treats a privilege recorded in pg_init_privs as created by its
 * extension and leaves it to CREATE EXTENSION. The bundle's initialization
 * leaves such entries on objects no extension owns (the graphql schemas), so
 * their grants would vanish in a restore: record them as statements to replay.
 * Only schemas are known to need it; any other object class refuses recording.
 */
export const STALE_EXTENSION_PRIVILEGES_SQL = `
set search_path = pg_catalog;
with stale as (
  select ip.classoid, ip.objoid, ip.objsubid from pg_init_privs ip
  where ip.privtype = 'e' and not exists (
    select 1 from pg_depend d where d.classid = ip.classoid and d.objid = ip.objoid and d.deptype = 'e')
)
select format('set role %I; grant %s on schema %I to %s%s; reset role;', pg_get_userbyid(a.grantor), a.privilege_type,
  n.nspname, case when a.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(a.grantee)) end,
  case when a.is_grantable then ' with grant option' else '' end)
from stale st join pg_namespace n on st.classoid = 'pg_namespace'::regclass and st.objsubid = 0 and n.oid = st.objoid
cross join lateral aclexplode(n.nspacl) a
union all
select format('unsupported: %s', st.classoid::regclass) from stale st
where not (st.classoid = 'pg_namespace'::regclass and st.objsubid = 0)
order by 1;
`;

export function readPrivilegeRepairs(tools: NativePostgresTools, databaseUrl: string, environment: SupabaseEnvironment) {
  const statements = runQuery(tools, databaseUrl, environment, STALE_EXTENSION_PRIVILEGES_SQL)
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const unsupported = statements.filter((statement) => statement.startsWith("unsupported: "));
  if (unsupported.length > 0) {
    throw new Error(`stale extension privileges cannot be replayed (${[...new Set(unsupported)].join(", ")})`);
  }
  return statements;
}

function stackOwnedSchemaArguments() {
  return STACK_OWNED_SCHEMAS.map((name) => `--exclude-schema=${name}`);
}

/**
 * Dumps the whole `postgres` database (every schema, auth, storage and
 * supabase_migrations included, plus database-level settings), the
 * stack-owned schemas excepted, and writes the dump before the manifest, both
 * through atomic renames.
 */
export function recordDatabaseSnapshot(options: {
  databaseUrl: string;
  directory: string;
  environment: SupabaseEnvironment;
  fingerprint: DatabaseFingerprint;
  key: DatabaseSnapshotKey;
  migrations: string[];
  serverVersion: string;
  tools: NativePostgresTools;
}) {
  const privilegeRepairs = readPrivilegeRepairs(options.tools, options.databaseUrl, options.environment);
  const created = !fs.existsSync(options.directory);
  fs.mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const suffix = `${process.pid}-${randomUUID().slice(0, 8)}`;
  const temporaryDump = path.join(options.directory, `.${DUMP_FILE}.${suffix}`);
  const temporaryManifest = path.join(options.directory, `.${MANIFEST_FILE}.${suffix}`);
  let recorded = false;
  try {
    runPostgresTool(options.tools.pgDump, [
      "--dbname=postgres", "--format=custom", "--compress=1", "--no-sync", ...stackOwnedSchemaArguments(),
      `--file=${temporaryDump}`,
    ], snapshotConnection(options.databaseUrl), options.environment);
    const dump = readRegularFile(temporaryDump, MAX_DUMP_BYTES);
    const { key, ...inputs } = options.key;
    const manifest: DatabaseSnapshotManifest = {
      format: DATABASE_SNAPSHOT_FORMAT,
      key,
      inputs,
      postgres: { bundle: options.tools.bundle, version: options.serverVersion },
      migrations: [...options.migrations].sort(),
      fingerprint: options.fingerprint,
      stackOwnedSchemas: [...STACK_OWNED_SCHEMAS],
      privilegeRepairs,
      dump: { file: DUMP_FILE, bytes: dump.length, sha256: sha256(dump) },
      createdAt: new Date().toISOString(),
    };
    fs.chmodSync(temporaryDump, 0o600);
    fs.writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
    // A reader that sees the new manifest also sees its dump; a stale manifest
    // with a new dump fails its digest and misses.
    fs.renameSync(temporaryDump, path.join(options.directory, DUMP_FILE));
    fs.renameSync(temporaryManifest, path.join(options.directory, MANIFEST_FILE));
    recorded = true;
    return manifest;
  } finally {
    fs.rmSync(temporaryDump, { force: true });
    fs.rmSync(temporaryManifest, { force: true });
    // A cache step must not save an empty directory as a snapshot.
    if (!recorded && created && fs.readdirSync(options.directory).length === 0) fs.rmdirSync(options.directory);
  }
}

// Every restored object commits on its own; the disposable stack needs no
// durability, so the restore sessions skip the WAL flush of each commit.
const RESTORE_SERVER_OPTIONS = "-c synchronous_commit=off";

/**
 * Replaces the freshly started `postgres` database with the snapshot, then
 * puts back this stack's own schemas and the recorded privilege repairs. Auth
 * and the Data API start on their first request; FORCE ends any other backend.
 */
export function restoreDatabaseSnapshot(options: {
  databaseUrl: string;
  environment: SupabaseEnvironment;
  snapshot: DatabaseSnapshot;
  tools: NativePostgresTools;
}) {
  const connection = snapshotConnection(options.databaseUrl);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "miaouffrage-db-snapshot-"));
  try {
    const stackSchemas = runQuery(options.tools, options.databaseUrl, options.environment,
      `select nspname from pg_catalog.pg_namespace where nspname = any (${STACK_OWNED_SCHEMAS_SQL}) order by 1;`)
      .split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const stackDump = path.join(scratch, "stack-owned.dump");
    if (stackSchemas.length > 0) {
      runPostgresTool(options.tools.pgDump, [
        "--dbname=postgres", "--format=custom", "--compress=0", "--no-sync",
        ...stackSchemas.map((name) => `--schema=${name}`), `--file=${stackDump}`,
      ], connection, options.environment);
    }
    runPostgresTool(options.tools.psql, ["--dbname=template1", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
      "drop database if exists postgres with (force)"], connection, options.environment);
    runPostgresTool(options.tools.pgRestore, [
      "--dbname=template1", "--create", "--exit-on-error", `--jobs=${Math.min(4, os.availableParallelism())}`,
      options.snapshot.dumpPath,
    ], connection, options.environment, { serverOptions: RESTORE_SERVER_OPTIONS });
    if (stackSchemas.length > 0) {
      runPostgresTool(options.tools.pgRestore, ["--dbname=postgres", "--exit-on-error", stackDump],
        connection, options.environment, { serverOptions: RESTORE_SERVER_OPTIONS });
    }
    if (options.snapshot.manifest.privilegeRepairs.length > 0) {
      runPostgresTool(options.tools.psql, ["--dbname=postgres", "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"],
        connection, options.environment, { input: `${options.snapshot.manifest.privilegeRepairs.join("\n")}\n` });
    }
  } finally {
    fs.rmSync(scratch, { force: true, recursive: true });
  }
}

/** The snapshot steps runLocalSupabaseCi drives; tests substitute them. */
export interface DatabaseSnapshotOperations {
  computeKey: (postgresBundle: string) => DatabaseSnapshotKey;
  fingerprint: (tools: NativePostgresTools, databaseUrl: string) => DatabaseFingerprint;
  lookUp: (directory: string, key: string) => DatabaseSnapshotLookup;
  record: (options: {
    databaseUrl: string;
    directory: string;
    fingerprint: DatabaseFingerprint;
    key: DatabaseSnapshotKey;
    migrations: string[];
    tools: NativePostgresTools;
  }) => DatabaseSnapshotManifest;
  resolveTools: () => NativePostgresTools;
  restore: (options: { databaseUrl: string; snapshot: DatabaseSnapshot; tools: NativePostgresTools }) => void;
}

export function createDatabaseSnapshotOperations(options: {
  configTemplate: () => string;
  environment: SupabaseEnvironment;
  rootDirectory: string;
  supabaseCli: string;
}): DatabaseSnapshotOperations {
  return {
    computeKey: (postgresBundle) => computeDatabaseSnapshotKey({
      configTemplate: options.configTemplate(),
      postgresBundle,
      rootDirectory: options.rootDirectory,
      supabaseCli: options.supabaseCli,
    }),
    fingerprint: (tools, databaseUrl) => computeDatabaseFingerprint(tools, databaseUrl, options.environment),
    lookUp: lookUpDatabaseSnapshot,
    record: (recordOptions) => recordDatabaseSnapshot({
      ...recordOptions,
      environment: options.environment,
      serverVersion: readServerVersion(recordOptions.tools, recordOptions.databaseUrl, options.environment),
    }),
    resolveTools: () => resolveNativePostgresTools(),
    restore: (restoreOptions) => restoreDatabaseSnapshot({ ...restoreOptions, environment: options.environment }),
  };
}
