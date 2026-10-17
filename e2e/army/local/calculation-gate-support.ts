import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import { localSqlTransport } from "../takeoff/generated-prerequisites";
import type { ArmyState } from "../critical/fixtures";

// Product data seeded by createEstimate for every project owner (server.ts).
export const DEFAULT_LABOR_ROLE_NAMES = [
  "Maçon", "Électricien", "Plombier", "Chauffagiste", "Menuisier",
  "Plaquiste", "Carreleur", "Peintre", "Couvreur",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
type SqlOutcome = { code: number | null; stdout: string[]; state: string; timedOut: boolean };

function openSql(timeoutMs: number) {
  const transport = localSqlTransport();
  const child = spawn(transport.executable, transport.args, { env: transport.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let stdout = "", stderr = "", timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.stdin.destroy(); child.kill(); }, timeoutMs);
  child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
  child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-65_536); });
  child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-65_536); });
  child.stdin.on("error", () => { /* The exit outcome reports a refused or closed SQL session. */ });
  const done = new Promise<SqlOutcome>((resolve) => {
    child.once("error", () => { clearTimeout(timer); resolve({ code: null, stdout: [], state: "spawn-failed", timedOut }); });
    child.once("close", code => {
      clearTimeout(timer);
      resolve({ code, stdout: stdout.split(/\r?\n/).filter(Boolean), state: /ERROR:\s*([0-9A-Z]{5})\b/.exec(stderr)?.[1] ?? "none", timedOut });
    });
  });
  return { write: (sql: string) => child.stdin.write(sql), end: (sql: string) => child.stdin.end(sql), kill: () => child.kill(), done };
}

/** One statement batch as the native owner (postgres) of the owned stack; stdout lines. */
export async function querySql(sql: string) {
  const session = openSql(30_000);
  session.end(sql);
  const outcome = await session.done;
  if (outcome.code !== 0 || outcome.timedOut) {
    throw new Error(`Owned local SQL failed: exit=${outcome.code}, timeout=${outcome.timedOut}, SQLSTATE=${outcome.state}; no retry.`);
  }
  return outcome.stdout;
}

const gateKey = (tenantId: string) =>
  `pg_catalog.hashtextextended('estimate-calculation:${tenantId}', 0)`;

async function gateHolders(tenantId: string, tag: string) {
  const [count] = await querySql(`SELECT count(*) FROM pg_catalog.pg_locks l
  JOIN pg_catalog.pg_stat_activity a ON a.pid = l.pid
  WHERE a.application_name = '${tag}' AND l.locktype = 'advisory' AND l.mode = 'ShareLock' AND l.granted
    AND ((l.classid::bigint << 32) | l.objid::bigint) = ${gateKey(tenantId)};
`);
  return Number(count);
}

/**
 * Holds the shared tenant calculation gate exactly as a line creation, batch or
 * settings save does (pg_try_advisory_xact_lock_shared on estimate-calculation),
 * in an owned psql transaction kept open until release().
 */
export async function holdSharedCalculationGate(tenantId: string, label: string) {
  const tag = `army_gate_${label}_${randomUUID().slice(0, 8)}`;
  if (!UUID.test(tenantId) || !/^army_gate_[a-z0-9_]{1,60}$/.test(tag)) throw new Error("Invalid calculation gate fixture identity.");
  // idle_in_transaction_session_timeout (30 s, transport) ends an abandoned holder.
  const session = openSql(120_000);
  session.write(`SET application_name = '${tag}';
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock_shared(${gateKey(tenantId)});
`);
  const deadline = Date.now() + 15_000;
  let exited = false;
  void session.done.then(() => { exited = true; });
  while (await gateHolders(tenantId, tag) !== 1) {
    if (exited || Date.now() > deadline) {
      session.kill();
      const outcome = await session.done;
      throw new Error(`The shared calculation gate was not granted: exit=${outcome.code}, SQLSTATE=${outcome.state}.`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let released = false;
  return {
    tag,
    holders: () => gateHolders(tenantId, tag),
    async release() {
      if (released) return;
      released = true;
      session.end("COMMIT;\nSELECT 'ARMY_GATE_RELEASED';\n");
      const outcome = await session.done;
      if (outcome.code !== 0 || outcome.timedOut || !outcome.stdout.includes("ARMY_GATE_RELEASED")) {
        throw new Error(`The gate holder did not commit cleanly: exit=${outcome.code}, SQLSTATE=${outcome.state}.`);
      }
      if (await gateHolders(tenantId, tag) !== 0) throw new Error("The shared calculation gate is still held after release.");
    },
  };
}

/** Owner and ARMY tenant of an owned estimate, read as the native owner. */
export async function ownedEstimateContext(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid owned project identity.");
  const [row] = await querySql(`SELECT jsonb_build_object('tenantId', p.tenant_id, 'userId', p.user_id, 'role', m.role)
  FROM public.estimate_projects p
  JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active AND t.name ~ '^ARMY\\y'
  JOIN public.tenant_memberships m ON m.tenant_id = p.tenant_id AND m.user_id = p.user_id
  WHERE p.id = '${projectId}' AND current_user = 'postgres';
`);
  const context = row ? JSON.parse(row) as { tenantId: string; userId: string; role: string } : null;
  if (!context || !UUID.test(context.tenantId) || !UUID.test(context.userId)) {
    throw new Error("The owned estimate is not in an active ARMY tenant of its owner.");
  }
  return context;
}

export async function laborRolesOf(tenantId: string, userId: string) {
  if (!UUID.test(tenantId) || !UUID.test(userId)) throw new Error("Invalid labor-role owner identity.");
  const [rows] = await querySql(`SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY name, id), '[]')
  FROM public.labor_roles WHERE tenant_id = '${tenantId}' AND user_id = '${userId}';
`);
  return (JSON.parse(rows) as Array<{ id: string; name: string }>)
    .filter(role => (DEFAULT_LABOR_ROLE_NAMES as readonly string[]).includes(role.name));
}

export async function versionCountOf(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid project identity.");
  const [count] = await querySql(`SELECT count(*) FROM public.estimate_versions WHERE project_id = '${projectId}';\n`);
  return Number(count);
}

/**
 * A second, never-logged-in owner of one ARMY project in the same tenant: the
 * only way to reach a creation whose default labor roles are still missing
 * without deleting roles that concurrent workers rely on.
 */
export async function createRoleLessOwnerProject(army: ArmyState, owner: { tenantId: string; userId: string }) {
  const context = {
    tenantId: owner.tenantId, actorUserId: owner.userId, ghostUserId: randomUUID(), projectId: randomUUID(),
    email: `${army.runPrefix.toLowerCase()}-second-owner@example.test`, name: `${army.runPrefix} second owner`,
  };
  const delimiter = `$army_${randomUUID().replaceAll("-", "")}$`;
  if (JSON.stringify(context).includes(delimiter)) throw new Error("Owner fixture SQL delimiter collision.");
  const output = await querySql(`BEGIN;
DO ${delimiter}
DECLARE ctx jsonb := ${literal(context)};
BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id = t.id
    WHERE t.id = (ctx->>'tenantId')::uuid AND t.is_active AND t.name ~ '^ARMY\\y'
      AND m.user_id = (ctx->>'actorUserId')::uuid AND m.role = 'admin')
  THEN RAISE EXCEPTION 'The acting ARMY admin identity differs'; END IF;
  INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES ((ctx->>'ghostUserId')::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    ctx->>'email', '{}'::jsonb, jsonb_build_object('full_name', ctx->>'name'), now(), now());
  INSERT INTO public.estimate_projects (id, tenant_id, user_id, name)
  VALUES ((ctx->>'projectId')::uuid, (ctx->>'tenantId')::uuid, (ctx->>'ghostUserId')::uuid, ctx->>'name');
  IF EXISTS(SELECT 1 FROM public.labor_roles WHERE tenant_id = (ctx->>'tenantId')::uuid AND user_id = (ctx->>'ghostUserId')::uuid)
  THEN RAISE EXCEPTION 'The second owner already has labor roles'; END IF;
END ${delimiter};
COMMIT;
SELECT 'ARMY_SECOND_OWNER_COMMITTED';
`);
  if (!output.includes("ARMY_SECOND_OWNER_COMMITTED")) throw new Error("Second owner fixture commit is ambiguous; no retry.");
  return { userId: context.ghostUserId, projectId: context.projectId };
}
