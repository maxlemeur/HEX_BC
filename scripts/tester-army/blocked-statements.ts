import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Watch of the owned database while the journeys run (docs/testing/tester-army-ci.md,
// "Pile, confidentialité et diagnostic"). The API roles cancel a statement after
// 8 s (57014), which the application answers as a 400: the journey then fails on
// a status code, and nothing says which statement waited nor on whom. One psql
// session reads pg_stat_activity twice a second and keeps every statement that
// has been running for more than a second, with the backends that block it.
//
// Diagnostic only: it never fails nor delays a run. The repository's evidence is
// public, so nothing a statement carries leaves this module:
// - a statement is retained as its first keyword and the schema-qualified
//   objects it names, read left to right with the lexer's state so that a
//   quote inside a comment, an escape or a quoted identifier cannot open a
//   literal, and what follows a form the sampling cut open is dropped;
// - a backend is retained as a kind of client, not as its role: on an owned
//   stack the superuser's name is also the database password, which the runner's
//   privacy check refuses anywhere in the evidence;
// - a catalog value (wait event, lock type and mode, state, relation) is kept
//   only in the shape the catalog gives it;
// - the retained text is redacted like every other evidence file.

const SAMPLE = "BLOCKED_STATEMENT_SAMPLE ";
const ROUND = "BLOCKED_STATEMENT_ROUND";
const THRESHOLD_MS = 1000;
const POLL_MS = 500;
const LOG_FILE = "blocked-statements.jsonl";
const MAX_OUTPUT_CHARACTERS = 8 * 1024 * 1024;
const MAX_PENDING_INPUT_BYTES = 64 * 1024;
const STOP_TIMEOUT_MS = 2000;
const MAX_STATEMENT_CHARACTERS = 600;
const MAX_OBJECTS = 4;

const KEYWORDS = new Set([
  "select", "insert", "update", "delete", "merge", "with", "do", "call", "copy", "vacuum", "analyze", "lock", "alter",
  "create", "drop", "truncate", "refresh", "begin", "commit", "rollback", "set", "explain", "autovacuum",
]);
// Schemas of this repository's migrations and of the Supabase services: their
// object names are public. Anything else is not named.
const SCHEMAS = new Set([
  "public", "private", "auth", "storage", "extensions", "net", "vault", "realtime", "graphql", "supabase_functions", "pg_catalog",
]);
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WORD = /[A-Za-z0-9_$]/;
// Stands for a quoted identifier that is not a plain name: it joins nothing.
const OPAQUE = "\u0001";

/**
 * The code of a statement: what is neither a comment, a string, a dollar-quoted
 * body nor an odd quoted identifier. One pass, left to right, with the state the
 * server's lexer keeps: block comments nest, a backslash escapes in an E'' string.
 * The sampling cuts a statement, so a form may never close: everything from its
 * opening is then dropped, never read as code.
 */
function statementCode(statement: string): string {
  const text = statement.slice(0, MAX_STATEMENT_CHARACTERS);
  let code = "";
  let at = 0;
  while (at < text.length) {
    const character = text[at];
    if (text.startsWith("--", at)) {
      const end = text.indexOf("\n", at);
      at = end === -1 ? text.length : end;
      code += " ";
    } else if (text.startsWith("/*", at)) {
      let depth = 1;
      at += 2;
      while (at < text.length && depth > 0) {
        if (text.startsWith("/*", at)) { depth += 1; at += 2; }
        else if (text.startsWith("*/", at)) { depth -= 1; at += 2; }
        else at += 1;
      }
      code += " ";
    } else if (character === "'") {
      const escapes = /^[eE]$/.test(text[at - 1] ?? "") && !WORD.test(text[at - 2] ?? "");
      at += 1;
      for (;;) {
        if (at >= text.length) break;
        if (text[at] === "\\") {
          if (escapes) { at += 2; continue; }
          // A backslash before a quote is an escape where standard_conforming_strings
          // is off: where this string ends is not known, nor what follows it.
          if (text[at + 1] === "'") { at = text.length; break; }
        }
        if (text[at] === "'") {
          if (text[at + 1] === "'") { at += 2; continue; }
          at += 1;
          break;
        }
        at += 1;
      }
      code += " ";
    } else if (character === "$" && !WORD.test(text[at - 1] ?? "") && /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(text.slice(at))) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(text.slice(at))![0];
      const end = text.indexOf(tag, at + tag.length);
      at = end === -1 ? text.length : end + tag.length;
      code += " ";
    } else if (character === "\"") {
      let end = at + 1;
      while (end < text.length && (text[end] !== "\"" || text[end + 1] === "\"")) end += text[end] === "\"" ? 2 : 1;
      const name = text.slice(at + 1, end);
      code += end < text.length && IDENTIFIER.test(name) ? name : OPAQUE;
      at = end < text.length ? end + 1 : text.length;
    } else {
      code += character;
      at += 1;
    }
  }
  return code;
}

const activity = (alias: string) => `
  'pid', ${alias}.pid, 'role', ${alias}.usename,
  'ms', (extract(epoch from clock_timestamp() - ${alias}.query_start) * 1000)::bigint,
  'txMs', (extract(epoch from clock_timestamp() - ${alias}.xact_start) * 1000)::bigint,
  'wait', ${alias}.wait_event_type || ':' || ${alias}.wait_event,
  'query', left(${alias}.query, ${MAX_STATEMENT_CHARACTERS})`;

// One round: its marker, then one row per long statement of this database. The
// session's search_path is pg_catalog alone, so a relation is always qualified.
const SAMPLE_SQL = `select '${ROUND}' union all (select '${SAMPLE}' || jsonb_build_object(${activity("a")},
  'start', extract(epoch from a.query_start),
  'at', to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'waitingFor', coalesce((
    select jsonb_agg(distinct jsonb_build_object('type', l.locktype, 'mode', l.mode, 'relation', l.relation::regclass::text))
    from pg_catalog.pg_locks l where l.pid = a.pid and not l.granted), '[]'::jsonb),
  'blockedBy', coalesce((
    select jsonb_agg(jsonb_build_object(${activity("b")}, 'state', b.state) order by b.pid)
    from pg_catalog.pg_stat_activity b where b.pid = any(pg_catalog.pg_blocking_pids(a.pid))), '[]'::jsonb)
)::text
from pg_catalog.pg_stat_activity a
where a.state = 'active' and a.backend_type = 'client backend' and a.pid <> pg_catalog.pg_backend_pid()
  and a.datname = current_database()
  and a.query_start < clock_timestamp() - interval '${THRESHOLD_MS} milliseconds');`;

type Client = "api" | "sql" | "service";

export interface BlockedStatement {
  at: string;
  pid: number;
  client: Client;
  statement: string;
  ms: number;
  wait: string | null;
  waitingFor: Array<{ type: string | null; mode: string | null; relation: string | null }>;
  blockedBy: Array<{ pid: number; client: Client; state: string | null; statement: string; ms: number; txMs: number; wait: string | null }>;
}

/** First keyword and the schema-qualified objects of a statement, without any of its values. */
export function blockedStatementLabel(query: string): string {
  const code = statementCode(String(query ?? ""));
  const keyword = /^[\s(]*([A-Za-z]+)/.exec(code)?.[1]?.toLowerCase();
  if (!keyword || !KEYWORDS.has(keyword)) return "other";
  const objects: string[] = [];
  for (const match of code.matchAll(/(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const object = `${match[1].toLowerCase()}.${match[2].toLowerCase()}`;
    if (SCHEMAS.has(match[1].toLowerCase()) && !objects.includes(object) && objects.length < MAX_OBJECTS) objects.push(object);
  }
  return [keyword, ...objects].join(" ");
}

// PostgREST's roles, then the roles of direct SQL (fixtures, psql); the rest are Supabase services.
const API_ROLES = new Set(["authenticator", "anon", "authenticated", "service_role"]);
const SQL_ROLES = new Set(["postgres", "supabase_admin"]);
const clientOf = (role: unknown): Client => (API_ROLES.has(String(role)) ? "api" : SQL_ROLES.has(String(role)) ? "sql" : "service");

const STATES = new Set(["active", "idle", "idle in transaction", "idle in transaction (aborted)", "fastpath function call", "disabled"]);
const shaped = (value: unknown, shape: RegExp) => (typeof value === "string" && shape.test(value) ? value : null);
const waitOf = (value: unknown) => shaped(value, /^[A-Za-z]{1,24}:[A-Za-z0-9_]{1,48}$/);
const stateOf = (value: unknown) => (typeof value === "string" && STATES.has(value) ? value : null);
/** A relation of an allowed schema, or a bare catalog relation (the session's search_path is pg_catalog). */
function relationOf(value: unknown) {
  if (typeof value !== "string") return null;
  if (/^pg_[a-z0-9_]{1,60}$/.test(value)) return value;
  const [schema, name, rest] = value.split(".");
  return rest === undefined && SCHEMAS.has(schema) && IDENTIFIER.test(name ?? "") ? value : null;
}
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

/** The completed rounds, and one entry per backend query: its longest sampled duration and every backend that blocked it. */
export function summarizeBlockedStatementSamples(output: string): { rounds: number; statements: BlockedStatement[] } {
  const statements = new Map<string, BlockedStatement>();
  let rounds = 0;
  for (const line of output.split(/\r?\n/)) {
    if (line === ROUND) { rounds += 1; continue; }
    if (!line.startsWith(SAMPLE)) continue;
    let sample: Record<string, unknown>;
    try { sample = JSON.parse(line.slice(SAMPLE.length)); } catch { continue; }
    const at = shaped(sample?.at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    if (typeof sample?.pid !== "number" || typeof sample.start !== "number" || !at) continue;
    const key = `${sample.pid}:${sample.start}`;
    const statement = statements.get(key) ?? {
      at, pid: sample.pid, client: clientOf(sample.role), statement: blockedStatementLabel(String(sample.query ?? "")),
      ms: 0, wait: null, waitingFor: [], blockedBy: [],
    };
    statements.set(key, statement);
    statement.ms = Math.max(statement.ms, count(sample.ms));
    statement.wait = waitOf(sample.wait) ?? statement.wait;
    for (const lock of Array.isArray(sample.waitingFor) ? sample.waitingFor as Array<Record<string, unknown>> : []) {
      const entry = { type: shaped(lock?.type, /^[a-z]{1,32}$/), mode: shaped(lock?.mode, /^[A-Za-z]{1,40}$/), relation: relationOf(lock?.relation) };
      if (!statement.waitingFor.some((known) => JSON.stringify(known) === JSON.stringify(entry))) statement.waitingFor.push(entry);
    }
    for (const blocker of Array.isArray(sample.blockedBy) ? sample.blockedBy as Array<Record<string, unknown>> : []) {
      if (typeof blocker?.pid !== "number") continue;
      let entry = statement.blockedBy.find((known) => known.pid === blocker.pid);
      if (!entry) {
        entry = { pid: blocker.pid, client: clientOf(blocker.role), state: null, statement: blockedStatementLabel(String(blocker.query ?? "")), ms: 0, txMs: 0, wait: null };
        statement.blockedBy.push(entry);
      }
      entry.state = stateOf(blocker.state) ?? entry.state;
      entry.ms = Math.max(entry.ms, count(blocker.ms));
      entry.txMs = Math.max(entry.txMs, count(blocker.txMs));
      entry.wait = waitOf(blocker.wait) ?? entry.wait;
    }
  }
  return { rounds, statements: [...statements.values()].sort((left, right) => left.at.localeCompare(right.at) || left.pid - right.pid) };
}

/**
 * Starts the watch on the owned database; `stop` ends it, writes the retained
 * statements next to the run's evidence and records the outcome in the manifest:
 * `watched` only when at least one round came back, `stopped-early` when psql
 * left before the stop, `unavailable` otherwise. Neither call throws.
 */
export function startBlockedStatementWatch(input: {
  databaseUrl: string;
  psql: string;
  evidence: string;
  manifest: Record<string, unknown>;
  redact: (value: string) => string;
}) {
  let output = "";
  let truncated = false;
  let ended = false;
  let child: ChildProcess | undefined;
  let sampling: NodeJS.Timeout | undefined;
  let stopping: Promise<void> | undefined;
  const end = new Promise<void>((resolve) => {
    const finish = () => { ended = true; clearInterval(sampling); resolve(); };
    try {
      const database = new URL(input.databaseUrl);
      // The password travels in the environment, never in the arguments another
      // process can list. No HOME: nothing of the user's own psql setup is read.
      const environment: NodeJS.ProcessEnv = {
        NODE_ENV: process.env.NODE_ENV, PATH: process.env.PATH, LANG: "C.UTF-8",
        PGHOST: database.hostname === "[::1]" ? "::1" : database.hostname, PGPORT: database.port,
        PGUSER: decodeURIComponent(database.username), PGPASSWORD: decodeURIComponent(database.password),
        PGDATABASE: database.pathname.slice(1), PGAPPNAME: "army-blocked-statements", PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
        // The watch itself must not wait on anything; a round that fails is skipped, the next one still runs.
        PGOPTIONS: "-c statement_timeout=2000 -c lock_timeout=500 -c search_path=pg_catalog",
      };
      const spawned = spawn(input.psql, ["-X", "--no-password", "-q", "-A", "-t"], { stdio: ["pipe", "pipe", "ignore"], env: environment });
      child = spawned;
      spawned.on("error", finish);
      // close, not exit: what psql wrote before leaving has then been read.
      spawned.once("close", finish);
      spawned.stdout.setEncoding("utf8");
      spawned.stdout.on("error", () => {});
      spawned.stdout.on("data", (chunk: string) => {
        if (truncated || output.length + chunk.length > MAX_OUTPUT_CHARACTERS) truncated = true;
        else output += chunk;
      });
      spawned.stdin.on("error", () => {});
      // psql runs each statement as it arrives; an error ends that round only.
      const round = () => {
        if (!ended && spawned.stdin.writable && spawned.stdin.writableLength < MAX_PENDING_INPUT_BYTES) spawned.stdin.write(`${SAMPLE_SQL}\n`);
      };
      round();
      sampling = setInterval(round, POLL_MS);
      sampling.unref();
    } catch {
      finish();
    }
  });

  async function stopOnce(): Promise<void> {
    let status: "watched" | "stopped-early" | "unavailable" = "unavailable";
    let rounds = 0;
    let retained = 0;
    try {
      const leftByItself = ended;
      clearInterval(sampling);
      if (child && !ended) {
        child.kill("SIGTERM");
        const kill = setTimeout(() => child?.kill("SIGKILL"), STOP_TIMEOUT_MS);
        await Promise.race([end, new Promise<void>((resolve) => setTimeout(resolve, STOP_TIMEOUT_MS * 2).unref())]);
        clearTimeout(kill);
        // A process even SIGKILL did not end must not hold the runner open.
        if (!ended) { child.stdout?.destroy(); child.stdin?.destroy(); child.unref(); }
      }
      const summary = summarizeBlockedStatementSamples(output);
      rounds = summary.rounds;
      status = rounds === 0 ? "unavailable" : leftByItself ? "stopped-early" : "watched";
      if (summary.statements.length) {
        const text = input.redact(`${summary.statements.map((statement) => JSON.stringify(statement)).join("\n")}\n`);
        fs.writeFileSync(path.join(input.evidence, LOG_FILE), text);
        retained = summary.statements.length;
      }
    } catch {
      status = "unavailable";
    }
    input.manifest.blockedStatements = {
      status, thresholdMs: THRESHOLD_MS, pollMs: POLL_MS, rounds, statements: retained,
      ...(retained ? { log: LOG_FILE } : {}), ...(truncated ? { truncated: true } : {}),
    };
  }

  return {
    stop(): Promise<void> { return (stopping ??= stopOnce()); },
    /** Rounds that came back so far, and whether psql has left. */
    progress() { return { rounds: summarizeBlockedStatementSamples(output).rounds, ended }; },
  };
}
