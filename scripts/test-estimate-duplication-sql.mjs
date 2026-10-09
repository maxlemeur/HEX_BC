// Full duplication functions in isolated PostgreSQL; no connection or secret.
// Failure modes and the E2E gap were recorded before this regression script.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const migration = "supabase/migrations/20261002175735_fix_estimate_duplication_parameter_qualification.sql";
const fixture = "src/test/fixtures/estimate-duplication-qualification.sql";
const canonical = "supabase/migrations/20260812032857_govern_estimate_calc_engine_v2.sql";
const products = "supabase/migrations/20260825200420_link_estimate_items_to_products.sql";
const variants = "supabase/migrations/20260222170000_est223_variants.sql";
const baselineOnly = process.argv.includes("--baseline-only");
const snapshotPath = process.env.DUPLICATION_FUNCTIONS_JSON;
const output = path.resolve(".e2e/army/duplication-sql", baselineOnly ? "baseline-evidence.json" : snapshotPath ? "evidence-deployed.json" : "evidence-canonical.json");
const modulePath = process.env.PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : "@electric-sql/pglite");
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const oldQualifier = "duplicate_estimate_version.";
const newQualifier = "duplicate_estimate_version_without_product_id.";
const inputs = [];
const checks = [];
const observations = {};
let status = "failed";
let failure;
let deployedMetadata;
let migrationSql;

function equal(name, actual, expected) {
  assert.deepEqual(actual, expected, name);
  checks.push({ name, status: "passed" });
}
async function readInput(file) {
  const text = await fs.readFile(file, "utf8");
  inputs.push({ path: file, sha256: createHash("sha256").update(text).digest("hex") });
  return text;
}
function extractFunction(sql, name) {
  const pattern = new RegExp(`create(?: or replace)? function public\\.${name}\\(`, "i");
  const start = sql.search(pattern);
  const end = sql.indexOf("\n$$;", start);
  assert(start >= 0 && end > start, `Cannot extract complete ${name} function`);
  return sql.slice(start, end + 4);
}
async function rejected(name, sql, params, code, message) {
  let error;
  try { await db.query(sql, params); } catch (caught) { error = caught; }
  assert(error, `${name}: statement unexpectedly succeeded`);
  equal(`${name}: SQLSTATE`, error.code, code);
  if (message) equal(`${name}: message`, error.message, message);
  observations[name] = { code: error.code, message: error.message };
}
async function actor(user, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('test.user_id', $1, false)", [user ?? ""]);
  if (role !== "postgres") await db.exec(`set role ${role}`);
}
async function duplicate(version = id(30), variant = false) {
  return (await db.query("select public.duplicate_estimate_version($1, $2) as id", [version, variant])).rows[0].id;
}
async function functionState() {
  return (await db.query(`select p.proname, p.oid::text as oid,
    pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig,
    p.proacl::text as acl, pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as returns, pg_get_functiondef(p.oid) as definition
    from pg_proc p where p.oid in (
      to_regprocedure('public.duplicate_estimate_version(uuid,boolean)'),
      to_regprocedure('public.duplicate_estimate_version_without_product_id(uuid,boolean)'))
    order by p.proname`)).rows;
}
async function counts() {
  return (await db.query(`select
    (select count(*)::integer from public.estimate_versions) as versions,
    (select count(*)::integer from public.estimate_items) as items,
    (select count(*)::integer from public.takeoff_version_links) as links,
    (select count(*)::integer from public.takeoff_dpgf_review_decisions) as decisions`)).rows[0];
}
async function version(versionId) {
  return (await db.query("select * from public.estimate_versions where id=$1", [versionId])).rows[0];
}
async function items(versionId) {
  return (await db.query("select * from public.estimate_items where version_id=$1 order by title", [versionId])).rows;
}
function hierarchy(rows) {
  return rows.map(({ parent_id, ...item }) => {
    delete item.id;
    delete item.version_id;
    return { ...item, parent: parent_id ? rows.find((parent) => parent.id === parent_id)?.title : null };
  });
}
function functionMetadata(entries) {
  return entries.map((entry) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "definition")));
}

try {
  await readInput("scripts/test-estimate-duplication-sql.mjs");
  await db.exec(await readInput(fixture));
  if (!baselineOnly) {
    migrationSql = await readInput(migration);
    await rejected("Missing implementation refuses migration", migrationSql, [], "42883",
      "Expected governed estimate duplication implementation is missing");
    equal("Missing implementation leaves business data untouched", await counts(), { versions: 0, items: 0, links: 0, decisions: 0 });
  }
  observations.runtime = { node: process.version, postgres: (await db.query("select version() as version")).rows[0].version };
  await db.exec(extractFunction(await readInput(variants), "estimate_variant_label_from_index"));
  if (snapshotPath) {
    const snapshot = JSON.parse(await readInput(snapshotPath));
    equal("Read-only snapshot declares its provenance", snapshot.readOnly, true);
    equal("Read-only snapshot contains both functions", snapshot.functions.length, 2);
    const inner = snapshot.functions.find((entry) => entry.proname === "duplicate_estimate_version_without_product_id");
    const outer = snapshot.functions.find((entry) => entry.proname === "duplicate_estimate_version");
    assert(inner && outer, "Deployed snapshot must contain both expected definitions");
    deployedMetadata = snapshot.functions;
    await db.exec(inner.definition);
    await db.exec(outer.definition);
  } else {
    await db.exec(extractFunction(await readInput(canonical), "duplicate_estimate_version"));
    // Reproduce the real migration's rename, including its stale parameter label.
    await db.exec("alter function public.duplicate_estimate_version(uuid, boolean) rename to duplicate_estimate_version_without_product_id");
    await db.exec(extractFunction(await readInput(products), "duplicate_estimate_version"));
  }
  // Match the deployed ACLs; the facade alone is callable by authenticated.
  await db.exec(`revoke all on function public.duplicate_estimate_version_without_product_id(uuid, boolean)
      from public, anon, authenticated, service_role;
    revoke all on function public.duplicate_estimate_version(uuid, boolean)
      from public, anon, authenticated, service_role;
    grant execute on function public.duplicate_estimate_version(uuid, boolean) to authenticated;`);
  await db.query("insert into public.tenants(id,is_active) values($1,true),($2,true),($3,false)", [id(1), id(2), id(3)]);
  await db.query(`insert into public.tenant_memberships(tenant_id,user_id,role) values
    ($1,$2,'admin'),($3,$4,'admin'),($1,$5,'viewer'),($1,$6,'engineer'),($7,$2,'admin')`,
  [id(1), id(10), id(2), id(11), id(12), id(13), id(3)]);
  for (const [project, tenant, owner, estimate] of [[20, 1, 10, 30], [21, 2, 11, 31], [22, 3, 10, 32], [23, 1, 12, 33], [24, 1, 13, 34]]) {
    await db.query("insert into public.estimate_projects(id,tenant_id,user_id,name) values($1,$2,$3,'ARMY synthetic SQL')", [id(project), id(tenant), id(owner)]);
    await db.query("insert into public.estimate_versions(id,tenant_id,project_id,version_number,title,exclusions) values($1,$2,$3,1,'ARMY source','ARMY exclusions')", [id(estimate), id(tenant), id(project)]);
  }
  await db.query("update public.estimate_versions set total_ht_cents=20004,total_tax_cents=4000,total_ttc_cents=24004 where id=$1", [id(30)]);
  await db.query("insert into public.products(id,tenant_id) values($1,$3),($2,$3)", [id(60), id(61), id(1)]);
  // Deliberately reverse IDs by hierarchy depth to catch ID-ordered insertion.
  for (const [section, parent, title] of [[43, null, "ARMY root"], [42, 43, "ARMY middle"], [41, 42, "ARMY leaf"]]) {
    await db.query(`insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title)
      values($1,$2,$3,$4,'section',1,$5)`, [id(section), id(1), id(30), parent ? id(parent) : null, title]);
  }
  for (const [line, title, quantity, price, ht, tax, ttc, product, position] of [
    [40, "ARMY principal", 2, 10000, 20000, 4000, 24000, 60, 1],
    [39, "ARMY centime B", 1, 2, 2, 0, 2, null, 2],
    [38, "ARMY centime C", 1, 2, 2, 0, 2, 61, 3],
  ]) {
    await db.query(`insert into public.estimate_items(id,tenant_id,version_id,parent_id,item_type,position,title,
      description,aid,quantity,unit_price_ht_cents,tax_rate_bp,k_fo,h_mo,h_mo_majoration,k_mo,pu_ht_cents,
      product_id,source_provider,source_job_id,source_file_name,source_page,source_metadata,
      line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
      values($1,$2,$3,$4,'line',$5,$6,'u',$7,$8,$9,2000,1,0,1,1,$9,$10,
      'dpgf_import',$11,'ARMY fixture.csv',2,$12,$13,$14,$15)`,
    [id(line), id(1), id(30), id(41), position, title, `ARMY-${line}`, quantity, price,
      product ? id(product) : null, id(70), { _timax_provenance: { sourceDocumentId: id(90), row: position }, marker: title }, ht, tax, ttc]);
  }
  await db.query("insert into public.takeoff_jobs(id,tenant_id,estimate_version_id) values($1,$2,$3)", [id(70), id(1), id(30)]);
  await db.query(`insert into public.takeoff_dpgf_review_decisions(id,tenant_id,version_id,takeoff_job_id,
    estimate_item_id,review_reference,line_label,line_position,source_file_name,source_page,decision,reason,decided_by)
    values($1,$2,$3,$4,$5,'ARMY review','ARMY principal',1,'ARMY fixture.csv',2,'keep','ARMY reason',$6)`,
  [id(80), id(1), id(30), id(70), id(40), id(10)]);
  const sourceBefore = { version: await version(id(30)), items: await items(id(30)) };
  const before = await functionState();
  if (deployedMetadata) {
    const metadata = (entries) => entries.map(({ proname, arguments: args, prosecdef, proconfig, acl }) => ({ proname, arguments: args, prosecdef, proconfig, acl }));
    equal("Isolated signature security search_path and ACL match deployed capture", metadata(before), metadata(deployedMetadata));
  }
  observations.before = { functions: functionMetadata(before), counts: await counts() };
  await actor(id(10));
  await rejected("Reproduced deployed rename defect", "select public.duplicate_estimate_version($1,false)", [id(30)], "42P01",
    'missing FROM-clause entry for table "duplicate_estimate_version"');
  await actor(id(10), "postgres");
  equal("Broken call leaves no partial resources", await counts(), observations.before.counts);
  if (baselineOnly) {
    status = "baseline-reproduced";
  } else {
    await db.exec(migrationSql);
    const after = await functionState();
    equal("Patch changes only the stale qualification", after, before.map((entry) => ({
      ...entry, definition: entry.proname === "duplicate_estimate_version_without_product_id"
        ? entry.definition.replaceAll(oldQualifier, newQualifier) : entry.definition,
    })));
    await db.exec(migrationSql);
    equal("Patch is idempotent including identity owner ACL and body", await functionState(), after);
    for (const [role, facade, inner] of [["anon", false, false], ["authenticated", true, false], ["service_role", false, false]]) {
      equal(`${role} keeps exact facade/internal execute access`, (await db.query(`select
        has_function_privilege($1,'public.duplicate_estimate_version(uuid,boolean)','execute') as facade,
        has_function_privilege($1,'public.duplicate_estimate_version_without_product_id(uuid,boolean)','execute') as inner`, [role])).rows[0], { facade, inner });
    }
    await actor(null, "anon");
    await rejected("Anonymous facade denied", "select public.duplicate_estimate_version($1,false)", [id(30)], "42501");
    await actor(null);
    await rejected("Authenticated without identity denied", "select public.duplicate_estimate_version($1,false)", [id(30)], "42501");
    await actor(id(10));
    await rejected("Internal function remains private", "select public.duplicate_estimate_version_without_product_id($1,false)", [id(30)], "42501");
    for (const [label, actorId, target] of [["Other tenant denied", 10, 31], ["Inactive tenant denied", 10, 32], ["Viewer own source denied", 12, 33], ["Engineer foreign owner denied", 13, 30]]) {
      await actor(id(actorId));
      await rejected(label, "select public.duplicate_estimate_version($1,false)", [id(target)], "P0001", "Estimate version not found or access denied");
    }
    await actor(id(10));
    const copy = await duplicate();
    await actor(id(10), "postgres");
    const copyVersion = await version(copy);
    equal("Copy retains every version field except identity and version number", copyVersion, { ...sourceBefore.version, id: copy, version_number: 2 });
    const copiedItems = await items(copy);
    equal("Full hierarchy financial values provenance and product links retained", hierarchy(copiedItems), hierarchy(sourceBefore.items));
    equal("All copied item IDs are independent", copiedItems.some((row) => sourceBefore.items.some((source) => source.id === row.id)), false);
    equal("Takeoff provenance link carried over", (await db.query("select tenant_id,takeoff_job_id,source_version_id,target_version_id from public.takeoff_version_links where target_version_id=$1", [copy])).rows,
      [{ tenant_id: id(1), takeoff_job_id: id(70), source_version_id: id(30), target_version_id: copy }]);
    const copiedPrincipal = copiedItems.find((row) => row.title === "ARMY principal");
    equal("Review decision maps to copied line and retains source", (await db.query("select estimate_item_id,carried_over_from_version_id,decision,reason from public.takeoff_dpgf_review_decisions where version_id=$1", [copy])).rows,
      [{ estimate_item_id: copiedPrincipal.id, carried_over_from_version_id: id(30), decision: "keep", reason: "ARMY reason" }]);
    equal("Source remains unchanged", { version: await version(id(30)), items: await items(id(30)) }, sourceBefore);
    observations.successfulCopy = { sourceVersionId: id(30), copiedVersionId: copy, totals: [copyVersion.total_ht_cents, copyVersion.total_tax_cents, copyVersion.total_ttc_cents], items: copiedItems };
    await actor(id(10));
    const variantId = await duplicate(id(30), true);
    await actor(id(13));
    const engineerCopyId = await duplicate(id(34));
    await actor(id(10), "postgres");
    const variant = await version(variantId);
    equal("Variant branch keeps its source and label", [variant.parent_version_id, variant.variant_label, variant.version_number], [id(30), "A", 3]);
    equal("Engineer own source remains allowed", (await version(engineerCopyId)).project_id, id(24));
    // Force a late item constraint failure to prove the complete SQL transaction
    // rolls back version, hierarchy, links and decisions. This trigger is a stub.
    await db.query("update public.estimate_items set source_metadata=source_metadata || '{\"force_test_failure\":true}'::jsonb where id=$1", [id(38)]);
    await db.exec(`create function public.test_fail_copied_item() returns trigger language plpgsql as $$
      begin
        if new.source_metadata->>'force_test_failure' = 'true' then
          raise exception using errcode='23514',message='ARMY simulated late item constraint';
        end if;
        return new;
      end; $$;
      create trigger army_test_fail_copied_item before insert on public.estimate_items
        for each row execute function public.test_fail_copied_item();`);
    const beforeFailure = await counts();
    await actor(id(10));
    await rejected("Late item constraint rollback", "select public.duplicate_estimate_version($1,false)", [id(30)], "23514", "ARMY simulated late item constraint");
    await actor(id(10), "postgres");
    equal("Late failure leaves no partial version items links or decisions", await counts(), beforeFailure);
    observations.itemFailureAtomicity = { before: beforeFailure, after: await counts() };
    // A facade failure happens AFTER the canonical RPC created its provenance
    // links and review decisions, so rollback must include those writes too.
    await db.exec(`drop trigger army_test_fail_copied_item on public.estimate_items;
      create function public.test_fail_product_link() returns trigger language plpgsql as $$
      begin
        if new.version_id <> '${id(30)}'::uuid and new.product_id is not null then
          raise exception using errcode='23514',message='ARMY simulated product link constraint';
        end if;
        return new;
      end; $$;
      create trigger army_test_fail_product_link before update of product_id on public.estimate_items
        for each row execute function public.test_fail_product_link();`);
    const beforeProductFailure = await counts();
    await actor(id(10));
    await rejected("Facade product constraint rollback", "select public.duplicate_estimate_version($1,false)", [id(30)], "23514", "ARMY simulated product link constraint");
    await actor(id(10), "postgres");
    equal("Facade failure rolls back completed hierarchy provenance and decisions", await counts(), beforeProductFailure);
    observations.productFailureAtomicity = { before: beforeProductFailure, after: await counts() };
    equal("Security and definitions survive all calls", await functionState(), after);
    observations.after = { functions: functionMetadata(after), counts: await counts() };
    status = "passed";
  }
} catch (error) {
  failure = { code: error.code ?? null, message: error.message };
  throw error;
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify({
    schemaVersion: "miaouffrage-duplication-sql-1", recordedAt: new Date().toISOString(), status,
    environment: "PGlite isolated single-backend PostgreSQL", remoteMutations: false,
    functionSource: snapshotPath ? "read-only deployed function snapshot" : "complete canonical migrations and real rename",
    inputs, checks, observations, failure,
    simulated: ["auth.uid via test.user_id", "minimal tables and foreign keys", "late item and facade product constraint triggers"],
    notCovered: ["production RLS and remaining triggers", "Supabase Auth/PostgREST", "multi-session concurrency", "shared Supabase after migration", "line_nature and nonzero rounding_adjustment_cents"],
  }, null, 2)}\n`);
  await db.close();
  console.log(`Estimate duplication SQL: ${status}; ${checks.length} assertions; evidence ${output}`);
}
