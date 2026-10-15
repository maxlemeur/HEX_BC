import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { componentsRecords } from "../../../scripts/tester-army/generated-components-plan.mjs";
import { recordEvidence, type ArmyState, type OwnedEstimate } from "../critical/fixtures";
import { localTakeoffFixture } from "./fixtures";

type ProposalRecord = { table: string; row: Record<string, unknown> };
type Scenario = OwnedEstimate & {
  label: "reject" | "fallback" | "provenance";
  sectionId: string | null; draftId: string; candidateId: string; subdetailId: string; designation: string;
  components: Array<{ componentId: string; fragmentId: string; sourceLinkId: string; designation: string; costType: string; quantity: number; unit: string; unitCostHtCents: number }>;
};
const tables = [
  "estimate_generated_ouvrage_drafts", "estimate_generated_ouvrage_candidates",
  "estimate_generated_ouvrage_subdetail_drafts", "estimate_generated_ouvrage_source_fragments",
  "estimate_generated_ouvrage_candidate_sources", "estimate_generated_ouvrage_subdetail_items",
  "estimate_generated_ouvrage_subdetail_item_sources",
];
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

function localSqlTransport() {
  let api: URL, db: URL;
  try {
    api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    db = new URL(process.env.E2E_ARMY_LOCAL_DB_URL ?? "missing:");
  } catch {
    throw new Error("Generated proposals require valid explicit local transport URLs; values withheld.");
  }
  const executable = process.env.E2E_ARMY_LOCAL_PSQL ?? "";
  const distribution = process.env.E2E_ARMY_LOCAL_PSQL_WSL_DISTRIBUTION;
  const loopback = (host: string) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (api.protocol !== "http:" || !loopback(api.hostname) || api.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
    api.username || api.password || api.pathname !== "/" || api.search || api.hash ||
    !["postgres:", "postgresql:"].includes(db.protocol) || !loopback(db.hostname) || !db.port || db.port === api.port ||
    db.pathname !== "/postgres" || decodeURIComponent(db.username) !== "postgres" || !db.password || db.search || db.hash ||
    !/^psql(?:\.exe)?$/.test(path.posix.basename(executable.replaceAll("\\", "/"))) ||
    !(distribution ? path.posix.isAbsolute(executable) : path.isAbsolute(executable)) ||
    (distribution && (process.platform !== "win32" || !/^[a-zA-Z0-9._-]+$/.test(distribution)))) {
    throw new Error("Generated proposals require explicit consistent local API/PostgreSQL origins and an absolute native psql path.");
  }
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "test", PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP, TMP: process.env.TMP, LANG: "C.UTF-8",
    PGHOST: db.hostname === "[::1]" ? "::1" : db.hostname, PGPORT: db.port,
    PGUSER: "postgres", PGDATABASE: "postgres", PGPASSWORD: decodeURIComponent(db.password),
    PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable",
    PGOPTIONS: "-c statement_timeout=30000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=30000",
  };
  const args = ["-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate"];
  if (distribution) {
    environment.WSLENV = Object.keys(environment).filter(key => key.startsWith("PG")).map(key => `${key}/u`).join(":");
    return { executable: "wsl.exe", args: ["--distribution", distribution, "--exec", executable, ...args], environment };
  }
  return { executable, args, environment };
}

async function executeSql(sql: string) {
  const transport = localSqlTransport();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(transport.executable, transport.args, { env: transport.environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.stdin.destroy(); child.kill(); }, 90_000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout = (stdout + chunk).slice(-65_536); });
    child.stderr.on("data", chunk => { stderr = (stderr + chunk).slice(-65_536); });
    child.stdin.on("error", () => { /* The exit callback reports a refused/closed SQL session. */ });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Native generated proposal preparation could not start; no retry.")); });
    child.once("close", code => {
      clearTimeout(timer);
      if (timedOut || code !== 0 || !stdout.split(/\r?\n/).includes("GEN_PREREQUISITES_COMMITTED")) {
        const state = /ERROR:\s*([0-9A-Z]{5})\b/.exec(stderr)?.[1] ?? "unavailable";
        reject(new Error(`Native proposal preparation failed or is ambiguous: exit=${code}, timeout=${timedOut}, SQLSTATE=${state}; no retry.`));
      } else resolve();
    });
    child.stdin.end(sql);
  });
}

// Same pending-record builder and jsonb_populate_record mechanism as the reviewed
// native component recipe. This helper never creates reviewed or applied state.
export async function seedGeneratedReviewPrerequisites(input: {
  army: ArmyState; ids: OwnedEstimate; userId: string; scenario: Scenario;
}) {
  const { army, ids, userId, scenario } = input;
  const { draftId } = scenario;
  const fixture = await localTakeoffFixture(army, ids);
  const currentUser = await fixture.client.auth.getUser();
  if (currentUser.error || currentUser.data.user?.id !== userId) throw new Error("Generated proposal creator differs from the ordinary RLS account.");
  if (scenario.projectId !== ids.projectId || scenario.versionId !== ids.versionId || !scenario.sectionId ||
    !scenario.designation.startsWith(army.runPrefix) || scenario.components.length !== 2 ||
    scenario.components.some((item, index) => item.costType !== (index ? "labor" : "material") || item.quantity !== 1 ||
      item.unit !== (index ? "h" : "u") || item.unitCostHtCents !== 4000 || !item.designation.startsWith(army.runPrefix))) {
    throw new Error("Generated review requires its exact two-component unreviewed scenario.");
  }
  const records = (componentsRecords({ prefix: army.runPrefix, owner: { userId, tenantId: fixture.tenantId },
    scenarios: [scenario], reuse: scenario }) as ProposalRecord[]).filter(record => tables.includes(record.table));
  for (const record of records) if (record.table === "estimate_generated_ouvrage_subdetail_items") record.row.status = "manual";
  if (records.length !== 11 || tables.some(table => !records.some(record => record.table === table)) || records.some(({ table, row }) =>
    row.tenant_id !== fixture.tenantId || (row.project_id !== undefined && row.project_id !== ids.projectId) ||
    (row.target_version_id !== undefined && row.target_version_id !== ids.versionId) ||
    (table === "estimate_generated_ouvrage_drafts" ? row.id !== draftId : row.draft_id !== draftId) ||
    Object.keys(row).some(key => !/^[a-z_]+$/.test(key)) ||
    (row.created_by !== undefined && row.created_by !== userId) ||
    (table === "estimate_generated_ouvrage_drafts" && row.status !== "pending") ||
    (table === "estimate_generated_ouvrage_candidates" && row.resolution_status !== "pending") ||
    (table === "estimate_generated_ouvrage_subdetail_drafts" && row.status !== "pending_review") ||
    (table === "estimate_generated_ouvrage_subdetail_items" && row.status !== "manual")
  )) throw new Error("Generated prerequisite plan must contain only the exact pending owned proposals.");
  const context = { ...ids, userId, tenantId: fixture.tenantId, draftId, prefix: army.runPrefix };
  const delimiter = `$army_${randomUUID().replaceAll("-", "")}$`;
  if (JSON.stringify({ context, records }).includes(delimiter)) throw new Error("Generated SQL delimiter collision.");
  const sql = `BEGIN;
DO ${delimiter}
DECLARE ctx jsonb := ${literal(context)}; plan jsonb := ${literal(records)};
  entry jsonb; proposal jsonb; table_name text; column_names text; matches integer;
  version_before jsonb; lines_before jsonb;
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR
    current_user <> (SELECT pg_get_userbyid(proowner) FROM pg_proc WHERE oid = 'public.commit_generated_ouvrages(uuid,uuid,uuid,timestamptz,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)'::regprocedure)
  THEN RAISE EXCEPTION 'Native owner identity differs'; END IF;
  SELECT to_jsonb(v) INTO version_before FROM public.estimate_versions v
    JOIN public.estimate_projects p ON p.id = v.project_id AND p.tenant_id = v.tenant_id
    JOIN public.tenants t ON t.id = v.tenant_id
    JOIN public.tenant_memberships m ON m.tenant_id = t.id AND m.user_id = (ctx->>'userId')::uuid
    WHERE v.id = (ctx->>'versionId')::uuid AND v.project_id = (ctx->>'projectId')::uuid AND v.tenant_id = (ctx->>'tenantId')::uuid
      AND v.status = 'draft' AND p.user_id = (ctx->>'userId')::uuid AND NOT p.is_archived AND t.is_active AND t.name ~ '^ARMY\\y'
      AND left(p.name,length(ctx->>'prefix')) = ctx->>'prefix' AND m.role IN ('admin','engineer') FOR UPDATE OF v;
  IF version_before IS NULL THEN RAISE EXCEPTION 'Live ordinary fixture identity differs'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb) INTO lines_before FROM public.estimate_items i WHERE i.version_id = (ctx->>'versionId')::uuid;
  IF EXISTS(SELECT 1 FROM public.estimate_generated_ouvrage_drafts WHERE id = (ctx->>'draftId')::uuid) THEN RAISE EXCEPTION 'Prerequisite already exists'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(plan) LOOP
    table_name := entry->>'table'; proposal := entry->'row';
    SELECT string_agg(quote_ident(key),',' ORDER BY key) INTO column_names FROM jsonb_object_keys(proposal) key;
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_record(null::public.%I,$1)',table_name,column_names,column_names,table_name) USING proposal;
    EXECUTE format('SELECT count(*) FROM public.%I t WHERE to_jsonb(t) @> $1',table_name) INTO matches USING proposal;
    IF matches <> 1 THEN RAISE EXCEPTION 'Exact proposal readback differs'; END IF;
  END LOOP;
  IF version_before IS DISTINCT FROM (SELECT to_jsonb(v) FROM public.estimate_versions v WHERE v.id=(ctx->>'versionId')::uuid)
    OR lines_before IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id),'[]'::jsonb) FROM public.estimate_items i WHERE i.version_id=(ctx->>'versionId')::uuid)
  THEN RAISE EXCEPTION 'Prerequisite preparation changed the estimate'; END IF;
END ${delimiter};
COMMIT;
SELECT 'GEN_PREREQUISITES_COMMITTED';
`;
  const sha256 = createHash("sha256").update(sql).digest("hex");
  await recordEvidence(army, "generated-native-plan", { context, records, sqlSha256: sha256, boundary: "Local native owner; pending proposals only, no privilege/schema/final-state mutation." });
  await executeSql(sql);
  for (const { table, row } of records) {
    const selector = typeof row.id === "string" ? { id: row.id } : {
      tenant_id: row.tenant_id, draft_id: row.draft_id, candidate_id: row.candidate_id, source_fragment_id: row.source_fragment_id,
    };
    const result = await fixture.client.from(table).select(Object.keys(row).join(",")).match(selector).single();
    if (result.error || !isDeepStrictEqual(result.data, row)) throw new Error(`Ordinary RLS readback differs for ${table}; native commit retained, no retry.`);
  }
  await recordEvidence(army, "generated-native-readback", { context, sqlSha256: sha256, rows: records.length, ordinaryRlsReadback: true, estimatePreserved: true });
}
