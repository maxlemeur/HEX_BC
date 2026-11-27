import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { test } from "vitest";

import { nativeStackWaitMs } from "./native-stack-guard";
import { runLocalSupabaseCi } from "./local-supabase-ci";
import { createLocalCiEnvironment, type SupabaseEnvironment } from "./supabase-cli";

// Run from the checkout with:
// MERGEONE_TEST_DASHBOARD_MEMORY=1 npx vitest run --project node --disableConsoleIntercept --silent=false \
//   src/test/dashboard-backend-memory.integration.test.ts
// Allocator totals cover PostgreSQL memory contexts after each statement. RSS includes shared
// pages, so it is reported separately. The budget is for retained growth after warm-up.
// The five dashboard entries need a sixth row to decide whether another page exists.
const actor = "ba810000-0000-4000-8000-000000000001";
const tenant = "ba810000-0000-4000-8000-000000000010";
const other = "ba820000-0000-4000-8000-000000000001";
const otherTenant = "ba820000-0000-4000-8000-000000000010";
const warmReads = 20;
const retainedGrowthBudget = 1024 * 1024;

const fixture = `
begin;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('${actor}', 'memory-reader@example.test', '{}', now()),
  ('${other}', 'memory-other@example.test', '{}', now());
update public.tenant_memberships set is_default = false where user_id in ('${actor}', '${other}');
insert into public.tenants (id, name, slug) values
  ('${tenant}', 'Memory reader fixture', 'memory-reader-fixture'),
  ('${otherTenant}', 'Memory other fixture', 'memory-other-fixture');
insert into public.tenant_memberships (tenant_id, user_id, role, is_default) values
  ('${tenant}', '${actor}', 'engineer', true), ('${otherTenant}', '${other}', 'engineer', true);
insert into public.estimate_projects (id, tenant_id, user_id, name)
  select gen_random_uuid(), t.tenant_id, t.user_id, 'Memory fixture ' || n
  from (values ('${tenant}'::uuid, '${actor}'::uuid), ('${otherTenant}', '${other}')) as t(tenant_id, user_id)
  cross join generate_series(1, 24) n;
insert into public.estimate_versions (project_id, version_number, calc_engine_version)
  select id, 1, 2 from public.estimate_projects where tenant_id in ('${tenant}', '${otherTenant}');
commit;
`;

// Read allocator counters only while the statement being profiled has finished.
// RESET ROLE allows introspection; all application statements switch back to authenticated.
function snapshot(stage: string) {
  return `reset role;
\\set rss_kib \`ps -o rss= -p "$MERGEONE_MEMORY_PID"\`
select json_build_object('stage', '${stage}', 'pid', pg_backend_pid(),
  'allocatedBytes', sum(total_bytes), 'usedBytes', sum(used_bytes), 'rssBytes', :'rss_kib'::bigint * 1024)
from pg_backend_memory_contexts;
set role authenticated;`;
}

async function measure(environment: SupabaseEnvironment) {
  const url = new URL(environment.E2E_ARMY_LOCAL_DB_URL ?? "");
  assert(["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) && url.port && url.pathname === "/postgres");
  const psql = environment.E2E_ARMY_LOCAL_PSQL;
  assert(psql);
  const sql = (input: string) => execFileSync(psql, ["-X", "-w", "-qAt", "-v", "ON_ERROR_STOP=1"], {
    env: { ...createLocalCiEnvironment(process.env), PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
      PGPORT: url.port, PGUSER: "postgres", PGPASSWORD: decodeURIComponent(url.password),
      PGDATABASE: "postgres", PGSSLMODE: "disable", PGCONNECT_TIMEOUT: "10" },
    input, encoding: "utf8", timeout: 60_000,
  }).trim();
  sql(fixture); // New connection below, so seeding cannot warm the measured backend.
  const read = "execute dashboard_page;";
  const output = sql(`
select pg_backend_pid() as measured_pid \\gset
\\setenv MERGEONE_MEMORY_PID :measured_pid
set request.jwt.claims to '{"sub":"${actor}","role":"authenticated"}';
${snapshot("cold")}
prepare dashboard_page as
 select json_build_object('rows', count(*), 'versions', sum(version_count),
   'digest', md5(jsonb_agg(to_jsonb(page) order by project_id)::text))
 from public.list_affaires_page(p_tenant_id => '${tenant}', p_owner_user_id => '${actor}',
   p_limit => 6, p_sort_by => 'updatedAt', p_sort_dir => 'desc') as page;
${read}
${snapshot("first")}
${Array(5).fill(read).join("\n")}
${snapshot("warmed")}
${Array(warmReads).fill(read).join("\n")}
${snapshot("final")}
select json_build_object('actor', auth.uid(), 'role', current_user, 'rls', row_security_active('public.estimate_projects'),
 'visibleOtherProjects', (select count(*) from public.estimate_projects where tenant_id = '${otherTenant}'),
 'postgresVersion', current_setting('server_version'));
`);
  const records = output.split("\n").map(line => JSON.parse(line));
  const reads = records.filter(row => "rows" in row);
  assert.equal(reads.length, 6 + warmReads);
  assert(reads.every(row => row.rows === 6 && row.versions === 6 && row.digest === reads[0].digest));
  const scope = records.at(-1);
  const { postgresVersion, ...scopeEvidence } = scope;
  assert.deepEqual(scopeEvidence, { actor, role: "authenticated", rls: true, visibleOtherProjects: 0 });
  const samples = records.filter(row => "stage" in row);
  assert.deepEqual(samples.map(s => s.stage), ["cold", "first", "warmed", "final"]);
  assert(samples.every(s => s.pid === samples[0].pid && s.rssBytes > 0 && s.allocatedBytes >= s.usedBytes && s.usedBytes > 0));
  const retainedGrowthBytes = samples[3].allocatedBytes - samples[2].allocatedBytes;
  console.log(JSON.stringify({ operation: "list_affaires_page", postgresVersion, platform: process.platform,
    fixtureProjectsPerTenant: 24, readsPerBackend: reads.length, warmReads,
    samples, retainedGrowthBytes, retainedGrowthBudgetBytes: retainedGrowthBudget }, null, 2));
  assert(retainedGrowthBytes <= retainedGrowthBudget, "Repeated dashboard reads exceeded the retained backend allocation budget.");
}

// The runner migrates and destroys its own native stack, including after an assertion fails.
test.runIf(process.env.MERGEONE_TEST_DASHBOARD_MEMORY === "1")(
  "the recent dashboard page stays within its retained backend memory budget under RLS",
  async () => {
    await runLocalSupabaseCi({ pgTapFiles: ["affaire-counters-regression.test.sql"], runApplication: measure });
  },
  nativeStackWaitMs() + 10 * 60_000,
);
