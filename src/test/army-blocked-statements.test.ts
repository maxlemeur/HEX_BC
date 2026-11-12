import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { redactOutput } from "../../scripts/tester-army/local-recipe-common.mjs";
import {
  blockedStatementLabel,
  startBlockedStatementWatch,
  summarizeBlockedStatementSamples,
} from "../../scripts/tester-army/blocked-statements";

// Failure modes of the watch (docs/testing/tester-army-ci.md, "Pile,
// confidentialité et diagnostic"): it publishes SQL text or a value of a
// statement (a literal, a comment, an odd quoted identifier, a catalog value
// it did not expect); it reports one long statement once per sample; it loses
// who blocks a statement; it says it watched when no sample ever came back; it
// fails or delays a run when psql cannot start, leaves or ignores its stop; it
// retains a word the runner treats as a secret (the owned database's password
// is the name of its superuser), which makes the privacy check refuse the
// whole evidence.

const SAMPLE = "BLOCKED_STATEMENT_SAMPLE ";
const ROUND = "BLOCKED_STATEMENT_ROUND";
const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function sample(value: Record<string, unknown>) {
  return `${SAMPLE}${JSON.stringify(value)}`;
}

async function until(condition: () => boolean, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("The awaited state was not reached.");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("blocked statement labels", () => {
  it("names the function of a PostgREST call and nothing else", () => {
    const query = 'WITH pgrst_source AS (SELECT pgrst_call.* FROM "public"."atomic_create_estimate_item"("p_item" => $1, "p_version_id" => $2) pgrst_call) SELECT 1';
    expect(blockedStatementLabel(query)).toBe("with public.atomic_create_estimate_item");
  });

  it("names the tables of a statement and drops its values", () => {
    const query = "UPDATE public.estimate_projects SET name='ARMY-private-name public.leak' WHERE id='0b7c1f0e-0000-4000-8000-000000000001' AND tenant_id IN (SELECT id FROM public.tenants)";
    expect(blockedStatementLabel(query)).toBe("update public.estimate_projects public.tenants");
  });

  it("drops dollar-quoted bodies and keeps the autovacuum target", () => {
    expect(blockedStatementLabel("DO $owned$ BEGIN PERFORM private.hidden('secret'); END $owned$;")).toBe("do");
    expect(blockedStatementLabel("SELECT $$ public.inside $$, $a$ private.inside $a$ FROM public.outside")).toBe("select public.outside");
    expect(blockedStatementLabel("autovacuum: VACUUM public.estimate_items")).toBe("autovacuum public.estimate_items");
  });

  it("reads a statement left to right: a quote inside a comment, an escape or an identifier opens nothing", () => {
    expect(blockedStatementLabel("UPDATE public.t SET name = E'it\\'s public.leakedvalue' WHERE id = 1")).toBe("update public.t");
    expect(blockedStatementLabel("UPDATE public.t -- l'affaire\nSET name = 'private.acme_contract' WHERE x = 'y'")).toBe("update public.t");
    expect(blockedStatementLabel("SELECT 1 AS \"l'alias\", 'public.leak1', ''")).toBe("select");
    expect(blockedStatementLabel("SELECT /* public.acme_corp */ 1")).toBe("select");
    expect(blockedStatementLabel("SELECT 1 -- storage.secretbucket")).toBe("select");
    expect(blockedStatementLabel("SELECT /* outer /* inner */ public.nested */ 1 FROM public.t")).toBe("select");
    expect(blockedStatementLabel("SELECT * FROM \"public\".\"odd.name\" WHERE x")).toBe("select");
    expect(blockedStatementLabel("-- note\n  SELECT 1 FROM public.t")).toBe("select public.t");
  });

  it("names nothing a cut statement left open", () => {
    expect(blockedStatementLabel("INSERT INTO public.t(title) VALUES ('public.cut_in_the_middle")).toBe("insert public.t");
    expect(blockedStatementLabel(`SELECT 1 FROM public.t ${" ".repeat(600)} JOIN public.too_far ON true`)).toBe("select public.t");
  });

  it("answers other for a statement it cannot name", () => {
    expect(blockedStatementLabel("")).toBe("other");
    expect(blockedStatementLabel("  \u0000 4212 'only a value'")).toBe("other");
    expect(blockedStatementLabel("SELECT 'x' FROM secretschema.thing")).toBe("select");
  });
});

describe("blocked statement summary", () => {
  it("reports one statement per backend query with its longest duration and every blocker", () => {
    const waiting = {
      pid: 41, start: 1794434105.627, at: "2026-11-11T21:55:06.700Z", role: "authenticated", ms: 1073, txMs: 1073,
      wait: "Lock:transactionid",
      query: 'WITH pgrst_source AS (SELECT pgrst_call.* FROM "public"."atomic_create_estimate_item"("p_item" => $1) pgrst_call) SELECT 1',
      waitingFor: [{ type: "transactionid", mode: "ShareLock", relation: null }],
      blockedBy: [{ pid: 77, role: "postgres", state: "idle in transaction", ms: 900, txMs: 1400, wait: "Client:ClientRead",
        query: "UPDATE public.estimate_versions SET title='ARMY-private' WHERE id='x'" }],
    };
    const output = [
      ROUND,
      "",
      sample(waiting),
      ROUND,
      sample({ ...waiting, ms: 1574, txMs: 1574, blockedBy: [
        { ...waiting.blockedBy[0], ms: 1400, txMs: 1900 },
        { pid: 78, role: "service_role", state: "active", ms: 200, txMs: 200, wait: null, query: "DELETE FROM public.draft_locks WHERE version_id=$1" },
      ] }),
      `${SAMPLE}{not json`,
      sample({ pid: 52, start: 1794434107.1, at: "2026-11-11T21:55:08.200Z", role: "postgres", ms: 1100, txMs: 1100, wait: null,
        query: "SELECT private.slow_report('ARMY-private')", waitingFor: [], blockedBy: [] }),
    ].join("\n");

    const { rounds, statements } = summarizeBlockedStatementSamples(output);

    expect(rounds).toBe(2);
    expect(statements).toEqual([
      {
        at: "2026-11-11T21:55:06.700Z", pid: 41, client: "api", statement: "with public.atomic_create_estimate_item",
        ms: 1574, wait: "Lock:transactionid",
        waitingFor: [{ type: "transactionid", mode: "ShareLock", relation: null }],
        blockedBy: [
          { pid: 77, client: "sql", state: "idle in transaction", statement: "update public.estimate_versions", ms: 1400, txMs: 1900, wait: "Client:ClientRead" },
          { pid: 78, client: "api", state: "active", statement: "delete public.draft_locks", ms: 200, txMs: 200, wait: null },
        ],
      },
      {
        at: "2026-11-11T21:55:08.200Z", pid: 52, client: "sql", statement: "select private.slow_report",
        ms: 1100, wait: null, waitingFor: [], blockedBy: [],
      },
    ]);
    expect(JSON.stringify(statements)).not.toContain("ARMY-private");
  });

  it("names the kind of client instead of its database role", () => {
    const base = { start: 1, at: "2026-11-11T21:55:06.700Z", ms: 1200, txMs: 1200, wait: null, query: "SELECT 1", waitingFor: [], blockedBy: [] };
    const clients = ["authenticator", "anon", "authenticated", "service_role", "postgres", "supabase_admin", "supabase_storage_admin", null]
      .map((role, pid) => summarizeBlockedStatementSamples(sample({ ...base, pid, role })).statements[0].client);
    expect(clients).toEqual(["api", "api", "api", "api", "sql", "sql", "service", "service"]);
  });

  it("keeps two queries of one backend apart", () => {
    const base = { pid: 41, at: "2026-11-11T21:55:06.700Z", role: "authenticated", ms: 1200, txMs: 1200, wait: null,
      query: "SELECT 1 FROM public.estimate_items", waitingFor: [], blockedBy: [] };
    const { statements } = summarizeBlockedStatementSamples([sample({ ...base, start: 1 }), sample({ ...base, start: 2, at: "2026-11-11T21:55:09.000Z" })].join("\n"));
    expect(statements.map((statement) => statement.at)).toEqual(["2026-11-11T21:55:06.700Z", "2026-11-11T21:55:09.000Z"]);
  });

  it("keeps a catalog value only in the shape the catalog gives it", () => {
    const { statements } = summarizeBlockedStatementSamples([
      sample({ pid: 1, start: 1, at: "2026-11-11T21:55:06.700Z", role: "postgres", ms: 1200, txMs: 1200,
        wait: "words that are not a wait event", query: "SELECT 1",
        waitingFor: [
          { type: "relation", mode: "AccessShareLock", relation: "public.estimate_items" },
          { type: "relation", mode: "AccessShareLock", relation: "pg_class" },
          { type: "relation", mode: "AccessShareLock", relation: "secret words here" },
          { type: "relation", mode: "AccessShareLock", relation: "pg_temp_3.private_rows" },
          { type: "a type; with words", mode: "a mode with words", relation: "public.\"Odd Name\"" },
        ],
        blockedBy: [{ pid: 2, role: "postgres", state: "anything goes", ms: 1, txMs: 1, wait: "Lock:tuple", query: "SELECT 1" }] }),
      sample({ pid: 3, start: 1, at: "not a date", role: "postgres", ms: 1200, txMs: 1200, wait: null, query: "SELECT 1", waitingFor: [], blockedBy: [] }),
    ].join("\n"));

    expect(statements).toEqual([{
      at: "2026-11-11T21:55:06.700Z", pid: 1, client: "sql", statement: "select", ms: 1200, wait: null,
      waitingFor: [
        { type: "relation", mode: "AccessShareLock", relation: "public.estimate_items" },
        { type: "relation", mode: "AccessShareLock", relation: "pg_class" },
        { type: "relation", mode: "AccessShareLock", relation: null },
        { type: null, mode: null, relation: null },
      ],
      blockedBy: [{ pid: 2, client: "sql", state: null, statement: "select", ms: 1, txMs: 1, wait: "Lock:tuple" }],
    }]);
  });
});

describe.skipIf(process.platform === "win32")("blocked statement watch", () => {
  // A psql stand-in: `onStatement` runs each time the watch sends its statement.
  function fixture(onStatement: string, preamble = "") {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "army-blocked-statements-test-"));
    directories.push(root);
    const evidence = path.join(root, "evidence");
    fs.mkdirSync(evidence);
    const psql = path.join(root, "psql");
    fs.writeFileSync(psql, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
${preamble}
let sent = 0;
process.stdin.on("data", (chunk) => {
  if (!String(chunk).includes("pg_blocking_pids")) return;
  sent += 1;
  if (sent === 1) fs.writeFileSync(path.join(__dirname, "seen.json"), JSON.stringify({
    argv: process.argv.slice(2), statement: String(chunk), home: process.env.HOME ?? null,
    host: process.env.PGHOST, port: process.env.PGPORT, user: process.env.PGUSER, database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD, options: process.env.PGOPTIONS, ssl: process.env.PGSSLMODE,
  }));
  ${onStatement}
});
setInterval(() => {}, 1000);
`, { mode: 0o755 });
    // The runner's redaction: the owned database's password is "postgres" on a local stack.
    const redact = (value: string) => redactOutput(value, { NODE_ENV: "test", SECRET_0: "postgres" });
    return { root, evidence, psql, manifest: {} as Record<string, unknown>, redact,
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" };
  }
  const write = (...lines: string[]) => `process.stdout.write(${JSON.stringify(`${lines.join("\n")}\n`)});`;
  const retainedFile = (input: { evidence: string }) => path.join(input.evidence, "blocked-statements.jsonl");

  it("samples through psql without the password in its arguments and retains labels only", async () => {
    const line = sample({ pid: 41, start: 1, at: "2026-11-11T21:55:06.700Z", role: "authenticated", ms: 8100, txMs: 8100, wait: "Lock:tuple",
      query: "INSERT INTO public.estimate_items(title) VALUES ('ARMY-private')", waitingFor: [],
      blockedBy: [{ pid: 9, role: "postgres", state: "active", ms: 8200, txMs: 8200, wait: null, query: "LOCK TABLE extensions.postgres_probe" }] });
    const input = fixture(write(line, ROUND));

    const watch = startBlockedStatementWatch(input);
    await until(() => watch.progress().rounds >= 1);
    await watch.stop();

    const seen = JSON.parse(fs.readFileSync(path.join(input.root, "seen.json"), "utf8"));
    expect(seen.argv).toEqual(["-X", "--no-password", "-q", "-A", "-t"]);
    expect(seen).toMatchObject({ host: "127.0.0.1", port: "54322", user: "postgres", database: "postgres", password: "postgres", ssl: "disable", home: null });
    expect(seen.options).toContain("search_path=pg_catalog");
    expect(seen.statement).toContain("pg_blocking_pids");
    const retained = fs.readFileSync(retainedFile(input), "utf8");
    expect(retained.trim().split("\n").map((entry) => JSON.parse(entry))).toEqual([
      { at: "2026-11-11T21:55:06.700Z", pid: 41, client: "api", statement: "insert public.estimate_items", ms: 8100,
        wait: "Lock:tuple", waitingFor: [],
        blockedBy: [{ pid: 9, client: "sql", state: "active", statement: "lock extensions.[REDACTED]_probe", ms: 8200, txMs: 8200, wait: null }] },
    ]);
    expect(retained).not.toContain("ARMY-private");
    expect(retained).not.toContain("postgres");
    expect(input.manifest.blockedStatements).toMatchObject({ status: "watched", thresholdMs: 1000, pollMs: 500, statements: 1, log: "blocked-statements.jsonl" });
    expect((input.manifest.blockedStatements as { rounds: number }).rounds).toBeGreaterThanOrEqual(1);
  });

  it("keeps sampling and writes no file when nothing ran longer than the threshold", async () => {
    const input = fixture(write(ROUND));
    const watch = startBlockedStatementWatch(input);
    await until(() => watch.progress().rounds >= 2);
    await watch.stop();
    expect(fs.existsSync(retainedFile(input))).toBe(false);
    expect(input.manifest.blockedStatements).toMatchObject({ status: "watched", statements: 0 });
    expect(input.manifest.blockedStatements).not.toHaveProperty("log");
  });

  it("does not say it watched when no sample ever came back", async () => {
    const input = fixture("");
    const watch = startBlockedStatementWatch(input);
    await until(() => fs.existsSync(path.join(input.root, "seen.json")));
    await watch.stop();
    expect(input.manifest.blockedStatements).toEqual({ status: "unavailable", thresholdMs: 1000, pollMs: 500, rounds: 0, statements: 0 });
  });

  it("says so when psql left before the end", async () => {
    const input = fixture(`${write(ROUND)} setTimeout(() => process.exit(3), 50);`);
    const watch = startBlockedStatementWatch(input);
    await until(() => watch.progress().ended);
    await watch.stop();
    expect(input.manifest.blockedStatements).toMatchObject({ status: "stopped-early", statements: 0 });
    expect((input.manifest.blockedStatements as { rounds: number }).rounds).toBeGreaterThanOrEqual(1);
  });

  it("retains nothing when the redaction fails", async () => {
    const line = sample({ pid: 41, start: 1, at: "2026-11-11T21:55:06.700Z", role: "authenticated", ms: 8100, txMs: 8100, wait: null,
      query: "SELECT 1 FROM public.estimate_items", waitingFor: [], blockedBy: [] });
    const input = fixture(write(line, ROUND));
    const watch = startBlockedStatementWatch({ ...input, redact: () => { throw new Error("redaction unavailable"); } });
    await until(() => watch.progress().rounds >= 1);
    await expect(watch.stop()).resolves.toBeUndefined();
    expect(fs.existsSync(retainedFile(input))).toBe(false);
    expect(input.manifest.blockedStatements).toMatchObject({ status: "unavailable", statements: 0 });
    expect(input.manifest.blockedStatements).not.toHaveProperty("log");
  });

  it("never fails the run when psql cannot start or stops at once, and stops only once", async () => {
    const unavailable = { status: "unavailable", thresholdMs: 1000, pollMs: 500, rounds: 0, statements: 0 };
    const missing = fixture("");
    fs.rmSync(missing.psql);
    const absent = startBlockedStatementWatch(missing);
    await expect(absent.stop()).resolves.toBeUndefined();
    expect(missing.manifest.blockedStatements).toEqual(unavailable);

    const refused = fixture("", "process.exit(2);");
    const stopped = startBlockedStatementWatch(refused);
    await until(() => stopped.progress().ended);
    await expect(stopped.stop()).resolves.toBeUndefined();
    expect(refused.manifest.blockedStatements).toEqual(unavailable);
    refused.manifest.blockedStatements = "kept";
    await expect(stopped.stop()).resolves.toBeUndefined();
    expect(refused.manifest.blockedStatements).toBe("kept");

    const invalid = fixture("");
    const refusedUrl = startBlockedStatementWatch({ ...invalid, databaseUrl: "not a url" });
    await expect(refusedUrl.stop()).resolves.toBeUndefined();
    expect(invalid.manifest.blockedStatements).toEqual(unavailable);
  });

  it("ends within seconds a psql that ignores its stop", async () => {
    const input = fixture(write(ROUND), 'process.on("SIGTERM", () => {});');
    const watch = startBlockedStatementWatch(input);
    await until(() => watch.progress().rounds >= 1);
    const startedAt = Date.now();
    await watch.stop();
    expect(Date.now() - startedAt).toBeLessThan(6_000);
    expect(watch.progress().ended).toBe(true);
    expect(input.manifest.blockedStatements).toMatchObject({ status: "watched" });
  }, 15_000);
});
