import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { resolveNativePostgresTools } from "../src/test/database-snapshot";
import { parseLocalSupabaseCiArguments, runLocalSupabaseCi } from "../src/test/local-supabase-ci";
import { createLocalCiEnvironment, type SupabaseEnvironment } from "../src/test/supabase-cli";

// This regression runs the shipped workflow's shell/Python, encryption and
// real pg_dump/pg_restore against this invocation's disposable migrated stack.
// A local Docker adapter replaces transport only: loopback PostgreSQL has no
// TLS and the pinned production Docker image is not launched on this Mac.
const root = process.cwd();
const startedAt = new Date().toISOString();
const runId = `${startedAt.replace(/[:.]/gu, "-")}-${randomUUID().slice(0, 8)}`;
const evidence = path.join(root, "outputs", "backup-restore", runId);
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const receiptPath = path.join(evidence, "result.json");
const workflowPath = path.join(root, ".github/workflows/supabase-backup.yml");
const workflow = fs.readFileSync(workflowPath, "utf8");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

function git(args: string[]) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, "Cannot identify the restore proof's source");
  return result.stdout;
}

function sourceEvidence() {
  const paths = new Set([
    ...git(["diff", "--name-only", "HEAD"]).trim().split("\n").filter(Boolean),
    ".github/workflows/supabase-backup.yml", "scripts/verify-backup-restore.ts",
  ]);
  return {
    source: git(["rev-parse", "HEAD"]).trim(),
    // HEAD includes both the staged migration and unstaged changes. The
    // explicit input hashes also cover this harness before its first commit.
    diffSha256: digest(git(["diff", "--binary", "HEAD"])),
    inputs: Object.fromEntries([...paths].sort().map((name) => [name,
      fs.existsSync(path.join(root, name)) ? digest(fs.readFileSync(path.join(root, name))) : null])),
  };
}

const source = sourceEvidence();
const receipt: Record<string, unknown> = {
  status: "running", startedAt, ...source,
  command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)], node: process.version,
  scope: "owned native PostgreSQL restore; no hosted data or Storage binaries",
  limits: ["local adapter replaces Docker/TLS transport", "no hosted restore", "Storage file bytes not covered"],
};
const writeReceipt = () => fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
writeReceipt();

function stepScript(name: string) {
  const step = workflow.split(/^\s+- name:/mu).slice(1).find((part) => part.trimStart().startsWith(name));
  assert(step, `Missing backup step ${name}`);
  const lines = step.split(/\r?\n/u);
  const start = lines.findIndex((line) => /^\s+run: \|$/u.test(line));
  assert(start >= 0, `Missing shell in ${name}`);
  const indent = lines[start].indexOf("run:") + 2;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && line.length - line.trimStart().length < indent) break;
    body.push(line.slice(indent));
  }
  return body.join("\n");
}

const rowSnapshot = `
create function pg_temp.backup_rows() returns jsonb language plpgsql as $$
declare r record; h text; result jsonb := '{}'::jsonb;
begin
  for r in select n.nspname, c.relname, c.relkind from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private','auth','storage') and c.relkind in ('r','p','S')
    order by n.nspname,c.relname
  loop
    if r.relkind = 'S' then
      execute format('select md5(row_to_json(s)::text) from (select last_value,is_called from %I.%I) s',
        r.nspname,r.relname) into h;
    else
      execute format('select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,''[]'')) from %I.%I t',
        r.nspname,r.relname) into h;
    end if;
    result := result || jsonb_build_object(r.nspname||'.'||r.relname,h);
  end loop;
  return result;
end $$;
select pg_temp.backup_rows();`;

async function verify(environment: SupabaseEnvironment) {
  const url = new URL(environment.E2E_ARMY_LOCAL_DB_URL ?? "");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port && url.pathname === "/postgres"
    && url.password && !url.search && !url.hash, "Restore proof requires this runner's owned loopback database");
  const tools = resolveNativePostgresTools();
  const cleanEnvironment = createLocalCiEnvironment(process.env);
  const temporary = fs.mkdtempSync(path.join(evidence, "restore-private-"));
  fs.chmodSync(temporary, 0o700);
  const workspace = path.join(temporary, "workspace");
  const bin = path.join(temporary, "bin");
  const runnerTemp = path.join(temporary, "runner");
  const suffix = randomUUID().replaceAll("-", "");
  const destination = `backup_restore_${suffix}`;
  const reader = `backup_reader_${suffix}`;
  const password = randomUUID();
  const tenant = randomUUID();
  const privateKey = path.join(temporary, "private.pem");
  const certificate = path.join(workspace, ".github", "backup-recipient.pem");
  const base = {
    ...cleanEnvironment,
    PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
    PGPORT: url.port, PGUSER: "supabase_admin", PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: "postgres", PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "10",
  };
  function run(command: string, args: string[], extra: Record<string, string> = {}, input?: string | Buffer) {
    const result = spawnSync(command, args, { env: { ...base, ...extra }, input, encoding: "utf8",
      timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    let detail = result.stderr ?? "";
    for (const secret of [base.PGPASSWORD, password, environment.SUPABASE_SERVICE_ROLE_KEY]) {
      if (secret) detail = detail.replaceAll(secret, "[redacted]");
    }
    assert.equal(result.status, 0, `${path.basename(command)} failed: ${detail.slice(-2500)}`);
    return result.stdout;
  }
  function sql(query: string, database = "postgres") {
    return run(tools.psql, ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--dbname", database], {}, query).trim();
  }
  let created = false;
  try {
    for (const directory of [path.dirname(certificate), bin, runnerTemp]) fs.mkdirSync(directory, { recursive: true });
    sql(`create role ${reader} login password '${password}' bypassrls;
      grant pg_read_all_data to ${reader}; alter role ${reader} set default_transaction_read_only=on;
      insert into public.tenants(id,name,slug) values('${tenant}','ARMY backup restore','army-backup-${suffix}');
      insert into private.estimate_reference_counters(tenant_id,reference_year,last_value) values('${tenant}',2026,74);
      create table public.backup_restore_probe(id bigint generated always as identity primary key,
        tenant_id uuid references public.tenants(id), owner_id uuid references auth.users(id), payload text);
      insert into public.backup_restore_probe(tenant_id,owner_id,payload)
        select '${tenant}',id,'synthetic restore fixture' from auth.users order by id limit 1;
      alter table public.backup_restore_probe enable row level security;
      grant select on public.backup_restore_probe to authenticated;
      create policy backup_restore_deny on public.backup_restore_probe to authenticated using(false);`);
    const before = JSON.parse(sql(rowSnapshot)) as Record<string, string>;
    assert(before["private.estimate_reference_counters"], "Source must contain the real private counter table");

    // Execute the workflow unchanged; the adapter can reach only this stack.
    fs.writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env python3
import os,sys,subprocess
from pathlib import Path
args=sys.argv[1:]
assert args[:2]==['run','--rm']
assert os.environ['PGHOST']==os.environ['FIXTURE_HOST'] and os.environ['PGPORT']==os.environ['FIXTURE_PORT']
assert os.environ['PGUSER']==os.environ['FIXTURE_READER']
assert os.environ['PGSSLMODE']=='verify-full'
index=next(i for i,a in enumerate(args) if a in ('pg_dump','pg_dumpall'))
mounts=[args[i+1] for i,a in enumerate(args[:-1]) if a=='--volume']
directory=next(a[:-8] for a in mounts if a.endswith(':/backup'))
command=[str(Path(os.environ['FIXTURE_PG_BIN'])/args[index])]
for value in args[index+1:]:
    command.append(value.replace('--file=/backup/','--file='+directory+'/'))
environment=os.environ.copy()
environment['PGSSLMODE']='disable'
result=subprocess.run(command,env=environment)
raise SystemExit(result.returncode)
`, { mode: 0o700 });
    run("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj",
      "/CN=local-backup-restore", "-keyout", privateKey, "-out", certificate]);
    fs.copyFileSync(certificate, path.join(workspace, ".github", "supabase-ca.crt"));
    const backupUrl = new URL(url);
    backupUrl.username = reader;
    backupUrl.password = password;
    const common = {
      PATH: `${bin}${path.delimiter}${cleanEnvironment.PATH ?? ""}`, RUNNER_TEMP: runnerTemp, GITHUB_WORKSPACE: workspace,
      GITHUB_OUTPUT: path.join(temporary, "output"), SUPABASE_DB_URL: backupUrl.href,
      POSTGRES_IMAGE: /^\s+POSTGRES_IMAGE:\s*(\S+)$/mu.exec(workflow)?.[1] ?? "",
      FIXTURE_HOST: base.PGHOST, FIXTURE_PORT: base.PGPORT, FIXTURE_READER: reader,
      FIXTURE_PG_BIN: path.dirname(tools.psql),
    };
    for (const step of ["Validate required secrets", "Validate backup encryption certificate", "Dump and encrypt database"]) {
      run("bash", ["-e", "-c", stepScript(step)], common);
    }
    const archive = /^archive_path=(.+)$/mu.exec(fs.readFileSync(common.GITHUB_OUTPUT, "utf8"))?.[1];
    assert(archive && path.dirname(archive) === path.join(runnerTemp, "backup-encrypted"));
    const encryptedHash = digest(fs.readFileSync(archive));
    const decrypted = path.join(temporary, "backup.tar.gz");
    run("openssl", ["cms", "-decrypt", "-binary", "-inform", "DER", "-in", archive,
      "-recip", certificate, "-inkey", privateKey, "-out", decrypted]);
    run("tar", ["-xzf", decrypted, "-C", temporary]);
    const dumpDirectory = fs.readdirSync(temporary).find((name) => /^\d{8}T\d{6}Z$/u.test(name));
    assert(dumpDirectory);
    const dump = path.join(temporary, dumpDirectory, "database.dump");
    assert(fs.readFileSync(dump).subarray(0, 5).equals(Buffer.from("PGDMP")), "Must restore a real custom-format PostgreSQL dump");
    const dumpHash = digest(fs.readFileSync(dump));
    sql(`create database ${destination} template template0;`);
    created = true;
    const extensions = JSON.parse(sql(`select jsonb_agg(jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion))
      from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname<>'plpgsql';`)) as Array<{ name: string; schema: string; version: string }>;
    const quote = (identifier: string) => '"' + identifier.replaceAll('"', '""') + '"';
    for (const extension of extensions) {
      sql(`create schema if not exists ${quote(extension.schema)};
        create extension if not exists ${quote(extension.name)} with schema ${quote(extension.schema)} version '${extension.version.replaceAll("'", "''")}';`, destination);
    }
    run(tools.pgRestore, ["--clean", "--if-exists", "--exit-on-error", "--dbname", destination, dump]);
    const after = JSON.parse(sql(rowSnapshot, destination)) as Record<string, string>;
    assert.deepEqual(after, before, "Restored table data and sequence values must equal all four source schemas");
    assert.equal(sql(`select last_value from private.estimate_reference_counters where tenant_id='${tenant}' and reference_year=2026;`, destination), "74");
    assert.equal(sql("select count(*) from public.backup_restore_probe;", destination), "1");
    assert.equal(sql("set role authenticated; select count(*) from public.backup_restore_probe;", destination), "0", "Restored RLS must hide the actual restored fixture row");
    run("bash", ["-e", "-c", stepScript("Remove plaintext dump")], common);
    assert(!fs.existsSync(path.join(runnerTemp, "backup-plain")));
    Object.assign(receipt, { postgres: tools.bundle,
      workflowSha256: digest(workflow), dumpSha256: dumpHash, encryptedSha256: encryptedHash,
      tablesAndSequences: Object.keys(before).length, dataSha256: digest(JSON.stringify(before)),
      privateCounterRestored: true, rowLevelSecurityRestored: true, schemas: ["public", "private", "auth", "storage"],
    });
    console.log(`Backup restore passed: ${Object.keys(before).length} tables/sequences, private counter and RLS verified.`);
  } finally {
    try {
      if (created) sql(`drop database ${destination} with (force);`);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}

Promise.resolve()
  .then(() => runLocalSupabaseCi({ ...parseLocalSupabaseCiArguments(process.argv.slice(2)), runApplication: verify }))
  .then(({ database }) => {
    assert.deepEqual(sourceEvidence(), source, "Source inputs changed during restore verification");
    Object.assign(receipt, { status: "passed", finishedAt: new Date().toISOString(), database, cleanup: "completed" });
    writeReceipt();
  })
  .catch((error: unknown) => {
    const details = (value: unknown): string[] => value instanceof Error
      ? [value.message, ...details(value.cause), ...(value instanceof AggregateError ? value.errors.flatMap(details) : [])] : [];
    const failure = [...new Set(details(error))].join("\n");
    Object.assign(receipt, { status: "failed", finishedAt: new Date().toISOString(), failure });
    writeReceipt();
    console.error(failure);
    process.exitCode = 1;
  })
  .finally(() => { console.log(`Backup restore receipt: ${path.relative(root, receiptPath)}`); });
