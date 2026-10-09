// Real bulk RPCs in isolated PostgreSQL. Failure modes were recorded first.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const baselineOnly = process.argv.includes("--baseline-only");
const snapshotPath = process.env.BULK_AID_FUNCTIONS_JSON;
const modulePath = process.env.PGLITE_MODULE;
const baseFixture = "src/test/fixtures/tiered-bulk-mosplit.sql";
const fixture = "src/test/fixtures/tiered-bulk-aid.sql";
const moMigration = "supabase/migrations/20261006210154_restore_bulk_estimate_labor_split.sql";
const sources = {
  split: "supabase/migrations/029_est_031_labor_split_atelier_chantier.sql",
  catalogue: "supabase/migrations/20260222001500_est164_catalog_suggestions.sql",
  core: "supabase/migrations/20260223113000_est033_aid_column.sql",
  nature: "supabase/migrations/20260812174449_estimate_line_nature_and_approval_default.sql",
  product: "supabase/migrations/20260825200420_link_estimate_items_to_products.sql",
  governance: "supabase/migrations/20260812032857_govern_estimate_calc_engine_v2.sql",
  tenants: "supabase/migrations/20260713135334_harden_active_tenant_and_profile_rls.sql",
  policies: "supabase/migrations/013_multitenant_core_s5.sql",
  viewer: "supabase/migrations/20260304161000_ux2_017_rls_viewer_readonly.sql",
  director: "supabase/migrations/20260306143000_v3_015_director_approval_workflow.sql",
  timestamps: "supabase/migrations/005_set_search_path_estimate_functions_s1.sql",
  revision: "supabase/migrations/20260713132620_harden_estimate_send_and_approval_revision.sql",
  operators: "supabase/migrations/20260811185118_restore_authenticated_estimate_privileges.sql",
};
const signature = "(uuid,jsonb,jsonb,timestamptz)";
const functionNames = [
  "snapshot_estimate_item_bulk_updates",
  "bulk_update_estimate_items_without_line_nature",
  "bulk_update_estimate_items_without_product_id",
  "bulk_update_estimate_items",
];
const fields = [
  "h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id",
  "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id",
];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const expected = [2, 1.5, id(62), 3, 2, id(63)];
const footer = { total_ht_cents: 55200, total_tax_cents: 11040, total_ttc_cents: 66240 };
const lineA = {
  id: id(40), ...Object.fromEntries(fields.map((field, i) => [field, expected[i]])),
  pu_ht_cents: 24600, line_total_ht_cents: 49200, line_tax_cents: 9840,
  line_total_ttc_cents: 59040, description: "ARMY split inputs",
  selected_supplier_price_id: id(80), product_id: id(70), line_nature: "supply_and_labor",
};
const lineB = { id: id(41), pu_ht_cents: 6000, line_total_ht_cents: 6000, line_tax_cents: 1200, line_total_ttc_cents: 7200 };
const outputDirectory = path.resolve(".e2e/army/tiered-bulk-aid/runs",
  new Date().toISOString().replaceAll(":", "-") + (snapshotPath ? "-deployed" : "-canonical"));
const inputs = new Map();
const checks = [];
const observations = {};
let db;
let activeRole = "postgres";
let activeUser = "";
let status = "failed";
let failure;
let migrationPath;
let deployedMetadata;
const deployedFunctions = new Map();
let deployedPolicies;

function equal(name, actual, value) {
  assert.deepEqual(actual, value, name);
  checks.push({ name, status: "passed" });
}
function sha256(content) { return createHash("sha256").update(content).digest("hex"); }
async function input(file) {
  const content = await fs.readFile(file);
  inputs.set(file, sha256(content));
  return content.toString("utf8").replaceAll("\r\n", "\n");
}
function extractFunction(sql, name) {
  const start = sql.search(new RegExp(`create(?: or replace)? function public\\.${name}\\(`, "i"));
  const end = sql.indexOf("\n$$;", start);
  assert(start >= 0 && end > start, `Cannot extract full function ${name}`);
  return sql.slice(start, end + 4);
}
function extractPolicy(sql, name) {
  const start = sql.indexOf(`create policy "${name}"`);
  const end = sql.indexOf(";", start);
  assert(start >= 0 && end > start, `Cannot extract policy ${name}`);
  return sql.slice(start, end + 1);
}
async function actor(user = "", role = "authenticated") {
  await db.exec("reset role");
  activeUser = user;
  activeRole = role;
  await db.query("select set_config('test.user_id', $1, false)", [user]);
  if (role !== "postgres") await db.exec(`set role ${role}`);
}
async function audit(sql, params = []) {
  await db.exec("reset role");
  try { return (await db.query(sql, params)).rows; }
  finally { if (activeRole !== "postgres") await db.exec(`set role ${activeRole}`); }
}
async function token(version = id(30)) {
  return (await audit("select updated_at::text as token from public.estimate_versions where id=$1", [version]))[0].token;
}
async function invoke(updates, patch = null, version = id(30), expectedToken) {
  const cas = expectedToken === undefined ? await token(version) : expectedToken;
  return (await db.query("select public.bulk_update_estimate_items($1,$2::jsonb,$3::jsonb,$4::timestamptz) as count",
    [version, JSON.stringify(updates), patch === null ? null : JSON.stringify(patch), cas])).rows[0].count;
}
async function business() {
  // These reads change the current role on one connection, so keep them serial.
  const versions = await audit("select * from public.estimate_versions order by id");
  const items = await audit("select * from public.estimate_items order by id");
  return { versions, items };
}
async function loadSnapshot(file) {
  const snapshot = JSON.parse(await input(file));
  equal(`Read-only provenance: ${file}`, snapshot.readOnly, true);
  equal(`Authorized project: ${file}`, snapshot.projectRef, "ijropnynpwjbllievrip");
  assert(snapshot.capturedAt || snapshot.checkedAt, "Snapshot capture time is required");
  for (const entry of snapshot.functions) deployedFunctions.set(entry.proname ?? entry.name, entry);
  if (snapshot.policies) deployedPolicies = snapshot.policies;
  return snapshot;
}
const quoteIdentifier = (value) => '"' + value.replaceAll('"', '""') + '"';
async function loadDeployedPolicies() {
  const tables = ["estimate_projects","estimate_versions","estimate_items","labor_roles","products"];
  assert(deployedPolicies?.length, "Deployed SELECT/UPDATE policies are required");
  const existing = await audit("select tablename,policyname from pg_policies where schemaname='public' and tablename=any($1::text[])", [tables]);
  for (const policy of existing) await db.exec(`drop policy ${quoteIdentifier(policy.policyname)} on public.${quoteIdentifier(policy.tablename)}`);
  for (const policy of deployedPolicies) {
    assert(policy.schemaname === "public" && tables.includes(policy.tablename), "Unexpected policy table");
    assert(["PERMISSIVE","RESTRICTIVE"].includes(policy.permissive), "Unexpected policy kind");
    assert(["SELECT","UPDATE","ALL"].includes(policy.cmd), "Unexpected captured policy command");
    assert(policy.roles.every((role) => ["public","anon","authenticated","service_role"].includes(role)), "Unexpected policy role");
    await db.exec(`create policy ${quoteIdentifier(policy.policyname)} on public.${quoteIdentifier(policy.tablename)}
      as ${policy.permissive} for ${policy.cmd} to ${policy.roles.map(quoteIdentifier).join(",")}
      ${policy.qual ? "using (" + policy.qual + ")" : ""}
      ${policy.with_check ? "with check (" + policy.with_check + ")" : ""}`);
  }
  equal("All three deployed restrictive UPDATE policies are loaded",
    (await audit("select policyname from pg_policies where schemaname='public' and permissive='RESTRICTIVE' and cmd='UPDATE' and tablename=any($1::text[])", [tables])).length,3);
  observations.loadedPolicies = await audit("select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename=any($1::text[]) order by tablename,policyname", [tables]);
}
async function loadFunction(sql, name) {
  const entry = deployedFunctions.get(name);
  await db.exec(entry?.definition ?? extractFunction(sql, name));
  if (entry?.acl) {
    const [{ callable }] = await db.query(`select 'public.' || quote_ident(p.proname) || '(' || pg_get_function_identity_arguments(p.oid) || ')' as callable
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [name]).then((result) => result.rows);
    await db.exec(`revoke all on function ${callable} from public,anon,authenticated,service_role,postgres`);
    for (const acl of entry.acl) {
      const match = /^([^=]*)=([A-Z*]*)\/(.+)$/.exec(acl);
      assert(match, `Unexpected ACL: ${acl}`);
      const role = match[1] || "public";
      assert(["public","postgres","anon","authenticated","service_role"].includes(role), `Unmodeled ACL role: ${role}`);
      if (match[2].includes("X")) await db.exec(`grant execute on function ${callable} to ${role}`);
    }
  }
}
async function split(item = id(40)) {
  const row = (await audit("select * from public.estimate_items where id=$1", [item]))[0];
  return fields.map((field) => row[field] === null || field.endsWith("_id") ? row[field] : Number(row[field]));
}
async function state() {
  return audit(`select p.proname,p.oid::text as oid,pg_get_userbyid(p.proowner) as owner,
    p.prosecdef,p.proconfig,p.proacl::text as acl,
    pg_get_function_identity_arguments(p.oid) as arguments,
    pg_get_function_result(p.oid) as returns,pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any($1::text[]) order by p.proname`, [functionNames]);
}
const metadata = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "definition")));
async function rejected(name, operation, code, message) {
  const before = await business();
  let caught;
  try { await operation(); } catch (error) { caught = error; }
  assert(caught, `${name}: unexpectedly succeeded`);
  equal(`${name}: SQLSTATE`, caught.code, code);
  if (message) equal(`${name}: message`, caught.message, message);
  equal(`${name}: whole transaction rolled back`, await business(), before);
  observations[name] = { code: caught.code, message: caught.message };
}
async function oracle() {
  const rows = await audit("select * from public.estimate_items where version_id=$1 and item_type='line' order by position", [id(30)]);
  const roles = await audit("select id,hourly_rate_cents from public.labor_roles");
  const rates = new Map(roles.map((role) => [role.id, Number(role.hourly_rate_cents)]));
  // The two fixture thresholds and arithmetic are independent of production code.
  const costs = rows.map((row) =>
    Number(row.quantity) * Number(row.unit_price_ht_cents) * Number(row.k_fo)
    + Number(row.h_mo_majoration) * (
      Number(row.h_mo_atelier ?? 0) * Number(row.k_mo_atelier ?? 1) * (rates.get(row.labor_role_atelier_id) ?? 0)
      + Number(row.h_mo_chantier ?? 0) * Number(row.k_mo_chantier ?? 1) * (rates.get(row.labor_role_chantier_id) ?? 0)
    ));
  const cost = costs.reduce((sum, value) => sum + value, 0);
  const margin = cost >= 30000 ? 1.2 : 1.5;
  const lines = costs.map((value) => {
    const ht = Math.round(value * margin);
    const tax = Math.round(ht * 0.2);
    return { ht, tax, ttc: ht + tax };
  });
  const totals = lines.reduce((sum, row) => ({
    total_ht_cents: sum.total_ht_cents + row.ht,
    total_tax_cents: sum.total_tax_cents + row.tax,
    total_ttc_cents: sum.total_ttc_cents + row.ttc,
  }), { total_ht_cents: 0, total_tax_cents: 0, total_ttc_cents: 0 });
  return { cost, margin, lines, totals };
}
try {
  const runtime = await import(modulePath ? pathToFileURL(path.resolve(modulePath)).href : "@electric-sql/pglite");
  db = new runtime.PGlite();
  await input("scripts/test-tiered-bulk-aid-sql.mjs");
  await input("docs/testing/tiered-bulk-aid.md");
  observations.source = {
    revision: execFileSync("git", ["-c","safe.directory=C:/Users/maxim/Projects/miaouffrage","rev-parse","HEAD"], { encoding: "utf8" }).trim(),
    localChanges: execFileSync("git", ["-c","safe.directory=C:/Users/maxim/Projects/miaouffrage","status","--porcelain"], { encoding: "utf8" }).trim().split("\n"),
  };
  await db.exec(await input(baseFixture));
  const sql = Object.fromEntries(await Promise.all(Object.entries(sources).map(async ([name, file]) => [name, await input(file)])));
  if (snapshotPath) {
    const snapshot = await loadSnapshot(snapshotPath);
    await loadSnapshot(".e2e/army/tiered-bulk-mosplit/deployed-dependencies.json");
    const additional = ".e2e/army/tiered-bulk-mosplit/deployed-additional.json";
    await loadSnapshot(additional);
    for (const name of [...functionNames,"current_tenant_id","is_tenant_member","has_tenant_role",
      "guard_estimate_v2_snapshot_columns","normalize_estimate_item_line_nature","validate_estimate_item_product_tenant",
      "set_updated_at","bump_estimate_content_revision_from_item"]) assert(deployedFunctions.has(name), `Required deployed function missing: ${name}`);
    deployedMetadata = snapshot.functions;
  }
  await db.exec(sql.split.slice(0, sql.split.indexOf("create or replace function public.snapshot_estimate_item_bulk_updates")));
  const payloadStart = sql.catalogue.lastIndexOf("alter table public.estimate_items\n  drop constraint if exists estimate_items_item_type_payload_check;");
  assert(payloadStart >= 0, "EST032 payload check not found");
  await db.exec(sql.catalogue.slice(payloadStart));
  await db.exec("alter table public.estimate_items add constraint estimate_items_selected_supplier_price_id_fkey foreign key(selected_supplier_price_id) references public.supplier_pricebook(id) on delete set null");
  for (const name of ["current_tenant_id", "is_tenant_member", "has_tenant_role"]) await loadFunction(sql.tenants, name);
  for (const name of ["Users can manage estimate projects", "Users can manage estimate versions", "Users can view estimate items", "Users can manage labor roles", "Authenticated can view products"]) {
    await db.exec(extractPolicy(sql.policies, name));
  }
  await db.exec(sql.viewer);
  await db.exec('drop policy "Users can view estimate items" on public.estimate_items');
  await db.exec(extractPolicy(sql.director, "Users can view estimate items"));
  await db.exec(extractPolicy(sql.director, "Tenant directors can view estimate projects"));
  await db.exec(extractPolicy(sql.director, "Tenant directors can view estimate versions"));
  if (snapshotPath) {
    await loadDeployedPolicies();
  } else {
    const templates = [...sql.operators.matchAll(/\$policy\$([\s\S]*?)\$policy\$/g)].map((match) => match[1]);
    const updatePolicy = templates.find((template) => template.includes("for update"));
    assert(updatePolicy, "Canonical restrictive UPDATE policy template is required");
    for (const table of ["estimate_projects","estimate_versions","labor_roles"]) {
      const [{ definition }] = (await db.query("select format($1::text,$2::text,$3::text) as definition", [updatePolicy,"Operators can update estimate rows",table])).rows;
      await db.exec(definition);
    }
  }
  if (snapshotPath) {
    for (const name of functionNames) {
      const entry = deployedFunctions.get(name);
      assert(entry?.definition, `Deployed definition missing: ${name}`);
      await loadFunction(sql.core, name);
    }
  } else {
    await db.exec(extractFunction(sql.core, "snapshot_estimate_item_bulk_updates"));
    await db.exec(extractFunction(sql.core, "bulk_update_estimate_items"));
    await db.exec("alter function public.bulk_update_estimate_items" + signature + " rename to bulk_update_estimate_items_without_line_nature");
    await db.exec(extractFunction(sql.nature, "bulk_update_estimate_items"));
    await db.exec("alter function public.bulk_update_estimate_items" + signature + " rename to bulk_update_estimate_items_without_product_id");
    await db.exec(extractFunction(sql.product, "bulk_update_estimate_items"));
  }
  await loadFunction(sql.governance, "guard_estimate_v2_snapshot_columns");
  await loadFunction(sql.nature, "normalize_estimate_item_line_nature");
  await loadFunction(sql.product, "validate_estimate_item_product_tenant");
  await loadFunction(sql.timestamps, "set_updated_at");
  await loadFunction(sql.revision, "bump_estimate_content_revision_from_item");
  await db.exec(`create trigger aaz_guard_estimate_v2_snapshot_columns before insert or update or delete on public.estimate_items
      for each row execute function public.guard_estimate_v2_snapshot_columns();
    create trigger normalize_estimate_item_line_nature before insert or update of item_type,line_nature on public.estimate_items
      for each row execute function public.normalize_estimate_item_line_nature();
    create trigger trg_validate_estimate_item_product_tenant before insert or update of product_id,tenant_id,item_type on public.estimate_items
      for each row execute function public.validate_estimate_item_product_tenant();
    alter table public.estimate_items add constraint estimate_items_line_nature_matches_item_type
      check ((item_type='section' and line_nature is null) or (item_type='line' and line_nature is not null));
    alter table public.estimate_items add constraint estimate_items_sections_without_product_check check(item_type='line' or product_id is null);
    alter table public.estimate_items add constraint estimate_items_product_id_fkey foreign key(product_id) references public.products(id) on delete set null;
    create trigger set_estimate_items_updated_at before update on public.estimate_items for each row execute function public.set_updated_at();
    create trigger set_estimate_versions_updated_at before update on public.estimate_versions for each row execute function public.set_updated_at();
    create trigger bump_estimate_content_revision_from_item after insert or update or delete on public.estimate_items for each row execute function public.bump_estimate_content_revision_from_item();`);

  const moSql = await input(moMigration);
  if (!snapshotPath) await db.exec(moSql);
  await db.exec(await input(fixture));
  observations.runtime = { node:process.version,modulePath:modulePath ?? "@electric-sql/pglite",postgres:(await db.query("select version() as version")).rows[0].version };
  observations.loadedFunctions = metadata(await state());
  equal("Bulk chain remains invoker", (await state()).every((row) => row.prosecdef === false), true);
  equal("Initial financial oracle", (await oracle()).totals, {total_ht_cents:25500,total_tax_cents:5100,total_ttc_cents:30600});
  const aid = async (item = id(40)) => (await audit("select aid from public.estimate_items where id=$1",[item]))[0].aid;
  const nonAidState = async () => {
    const current = await business();
    return {
      versions:current.versions.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["updated_at","content_revision"].includes(key)))),
      items:current.items.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["aid","updated_at"].includes(key)))),
    };
  };
  observations.baseline = [];
  await actor(id(10));
  equal("Public RPC acknowledges initial AID creation", await invoke([{id:id(40),aid:" army.aid.1410 "}]),1);
  if (snapshotPath) {
    equal("Deployed baseline loses new AID",await aid(),null);
    observations.baseline.push({operation:"create",expected:"ARMY.AID.1410",actual:await aid()});
    await actor("","postgres");
    await db.query("update public.estimate_items set aid='ARMY.AID.1410' where id=$1",[id(40)]);
    await actor(id(10));
    equal("Baseline acknowledges replacement",await invoke([{id:id(40),aid:"ARMY.AID.1411"}]),1);
    equal("Baseline silently ignores replacement",await aid(),"ARMY.AID.1410");
    observations.baseline.push({operation:"replace",expected:"ARMY.AID.1411",actual:await aid()});
    await invoke([{id:id(40),aid:null}]);
    equal("Baseline silently ignores explicit null",await aid(),"ARMY.AID.1410");
    observations.baseline.push({operation:"clear",expected:null,actual:await aid()});
  } else {
    equal("Canonical chain already creates normalized AID",await aid(),"ARMY.AID.1410");
    observations.baseline.push({operation:"create",expected:"ARMY.AID.1410",actual:await aid(),alreadyCompatible:true});
  }
  const splitBefore = await split();
  const monetaryBefore = await oracle();
  await invoke([{id:id(40),description:"ARMY absent AID patch"},{id:id(41),line_total_ht_cents:7500,line_tax_cents:1500,line_total_ttc_cents:9000}]);
  equal("Absent AID preserves edited line baseline value",await aid(),"ARMY.AID.1410");
  equal("Absent AID preserves an otherwise recalculated line",await aid(id(41)),"ARMY.UNTOUCHED");
  equal("Baseline AID operations preserve all six MO fields",await split(),splitBefore);
  equal("Baseline AID operations preserve financial inputs",await oracle(),monetaryBefore);

  if (baselineOnly) {
    assert(snapshotPath,"Baseline-only requires a deployed post-MO snapshot");
    status = "defect-reproduced";
  } else {
    const migrations = (await fs.readdir("supabase/migrations")).filter((file) => /^\d+_restore_bulk_estimate_aid\.sql$/.test(file));
    equal("Exactly one new additive AID migration",migrations.length,1);
    migrationPath = path.join("supabase/migrations",migrations[0]).replaceAll("\\","/");
    const migrationSql = await input(migrationPath);
    await actor("","postgres");
    const before = await state();
    await db.exec(migrationSql);
    const after = await state();
    equal("Migration preserves OID, owner, ACL, invoker, signature and search_path",metadata(after),metadata(before));
    equal("Helper and both facades remain identical",after.filter((row) => row.proname !== "bulk_update_estimate_items_without_line_nature"),
      before.filter((row) => row.proname !== "bulk_update_estimate_items_without_line_nature"));
    if (!snapshotPath) equal("Canonical AID implementation is a complete no-op",after,before);
    await db.exec(migrationSql);
    equal("Second migration application is identical",await state(),after);
    await db.query("update public.estimate_items set aid=null where id=$1",[id(40)]);
    await actor(id(10));

    for (const [label,value,expectedAid] of [
      ["creation"," army.aid.1410 ","ARMY.AID.1410"],["replacement","army.aid.1411","ARMY.AID.1411"],
      ["explicit null",null,null],["empty text","",null],["space-only text","   ",null],
      ["maximum length","A".repeat(64),"A".repeat(64)],
    ]) {
      if (["explicit null","empty text","space-only text"].includes(label)) {
        await actor("","postgres");
        await db.query("update public.estimate_items set aid='ARMY.AID.1400' where id=$1",[id(40)]);
        await actor(id(10));
        equal(`AID ${label} starts from an existing value`,await aid(),"ARMY.AID.1400");
      }
      const unchanged = await nonAidState();
      equal(`AID ${label} returns one row`,await invoke([{id:id(40),aid:value}]),1);
      equal(`AID ${label} survives reread`,await aid(),expectedAid);
      equal(`AID ${label} preserves all non-AID business fields`,await nonAidState(),unchanged);
    }
    await actor("","postgres");
    await db.query("update public.estimate_items set aid='  rawStoredAid  ' where id=$1",[id(40)]);
    await actor(id(10));
    await invoke([{id:id(40),description:"ARMY presence test"}]);
    equal("Absent key preserves stored AID exactly without normalizing it",await aid(),"  rawStoredAid  ");
    const sectionFields = (await audit("select * from public.estimate_items where id=$1",[id(50)]))[0];
    await invoke([{id:id(50),aid:"army.sec.1410"}]);
    equal("Section AID is persisted",await aid(id(50)),"ARMY.SEC.1410");
    const sectionAfter = (await audit("select * from public.estimate_items where id=$1",[id(50)]))[0];
    equal("Section financial payload stays unchanged",
      Object.fromEntries(Object.entries(sectionAfter).filter(([key]) => !["aid","updated_at"].includes(key))),
      Object.fromEntries(Object.entries(sectionFields).filter(([key]) => !["aid","updated_at"].includes(key))));
    await invoke([{...lineA,aid:" army.aid.1412 "},lineB],footer);
    equal("Combined AID and six MO inputs are persisted", [await aid(),...await split()],["ARMY.AID.1412",...expected]);
    equal("Combined independent financial oracle",await oracle(),{
      cost:46000,margin:1.2,lines:[{ht:49200,tax:9840,ttc:59040},{ht:6000,tax:1200,ttc:7200}],totals:footer,
    });
    equal("Recalculated untouched line preserves AID",await aid(id(41)),"ARMY.UNTOUCHED");
    const newFooter = {total_ht_cents:55680,total_tax_cents:11136,total_ttc_cents:66816};
    await invoke([{id:id(40),aid:"army.aid.1413",unit_price_ht_cents:1200,pu_ht_cents:24840,
      line_total_ht_cents:49680,line_tax_cents:9936,line_total_ttc_cents:59616},lineB],newFooter);
    equal("Combined AID and changed supply price persist",[(await audit("select unit_price_ht_cents from public.estimate_items where id=$1",[id(40)]))[0].unit_price_ht_cents,await aid()],[1200,"ARMY.AID.1413"]);
    equal("Price and AID change preserves all six MO values",await split(),expected);
    equal("Changed price independent financial oracle",await oracle(),{
      cost:46400,margin:1.2,lines:[{ht:49680,tax:9936,ttc:59616},{ht:6000,tax:1200,ttc:7200}],totals:newFooter,
    });
    equal("Stored line amounts equal reread inputs",await audit("select line_total_ht_cents as ht,line_tax_cents as tax,line_total_ttc_cents as ttc from public.estimate_items where version_id=$1 and item_type='line' order by position",[id(30)]),(await oracle()).lines);
    equal("Stored footer equals reread inputs",(await audit("select total_ht_cents,total_tax_cents,total_ttc_cents from public.estimate_versions where id=$1",[id(30)]))[0],newFooter);
    const saved = (await audit("select product_id,selected_supplier_price_id,line_nature,h_mo from public.estimate_items where id=$1",[id(40)]))[0];
    equal("Product, supplier, nature and legacy MO remain", [saved.product_id,saved.selected_supplier_price_id,saved.line_nature,Number(saved.h_mo)],[id(70),id(80),"supply_and_labor",7]);
    observations.corrected = {aid:await aid(),split:await split(),financial:await oracle(),functions:metadata(after)};

    const attempted = {id:id(40),aid:"ARMY.AID.9999",h_mo_atelier:8,unit_price_ht_cents:1300};
    await rejected("65-character AID rejects complete lot",()=>invoke([{...attempted,aid:"A".repeat(65)},lineB],footer),"23514");
    const stale = await token();
    await invoke([{id:id(40),aid:"ARMY.AID.1414"}]);
    await rejected("Old version token cannot overwrite AID",()=>invoke([attempted],footer,id(30),stale),"P0001","STALE_BULK_UPDATE_ITEMS");
    await rejected("Missing version token",()=>invoke([attempted],footer,id(30),null),"P0001","expected_version_updated_at is required");
    for (const [label,item] of [["missing",id(999)],["other version",id(44)],["other tenant",id(42)]]) {
      await rejected(`Batch with ${label} item`,()=>invoke([attempted,{id:item,aid:"ARMY.AID.9998"}],footer),"P0001","STALE_BULK_UPDATE_ITEMS");
    }
    await rejected("Duplicate ID",()=>invoke([attempted,{id:id(40),aid:"ARMY.AID.9998"}],footer),"23505");
    await rejected("Non-array payload",()=>invoke(attempted,footer),"P0001","item_updates must be a JSON array");
    await rejected("Invalid footer cast",()=>invoke([attempted],{total_ht_cents:"invalid"}),"22P02");
    for (const field of ["labor_role_atelier_id","labor_role_chantier_id"]) {
      for (const [label,role] of [["unknown",id(999)],["foreign tenant",id(64)],["foreign owner",id(65)]]) {
        await rejected(`${label} ${field} rolls back AID`,()=>invoke([{...attempted,[field]:role},lineB],footer),"23503","ESTIMATE_LABOR_ROLE_OWNER_MISMATCH");
      }
    }
    await rejected("Late invalid nature",()=>invoke([{...attempted,line_nature:"invalid"},lineB],footer),"22P02");
    await rejected("Late foreign product",()=>invoke([{...attempted,product_id:id(72)},lineB],footer),"23514","ESTIMATE_ITEM_PRODUCT_TENANT_MISMATCH");
    const aidBeforeMove = await aid();
    const moBeforeMove = await split();
    await invoke([{id:id(40),position:2},{id:id(41),position:1}]);
    equal("Two-phase permutation preserves AID and MO",[await aid(),...await split()],[aidBeforeMove,...moBeforeMove]);
    equal("Two-phase permutation keeps the requested order",await audit("select id,position from public.estimate_items where version_id=$1 and item_type='line' order by position",[id(30)]),[{id:id(41),position:1},{id:id(40),position:2}]);
    for (const [label,user,version,item] of [["outsider",14,30,40],["other tenant",11,30,40],["inactive tenant",15,32,49],["viewer owner",12,37,47]]) {
      await actor(id(user));
      if (label === "viewer owner") equal("Viewer can read its version before write refusal",(await db.query("select id from public.estimate_versions where id=$1",[id(version)])).rows,[{id:id(version)}]);
      await rejected(`RLS rejects ${label}`,()=>invoke([{id:id(item),aid:"ARMY.AID.9999"}],footer,id(version)),"P0001","STALE_BULK_UPDATE_ITEMS");
    }
    await actor("","postgres");
    await rejected("Sent V2 rejects AID even for table owner",()=>invoke([{id:id(45),aid:"ARMY.AID.9999"}],footer,id(34)),"42501","ESTIMATE_VERSION_READ_ONLY");

    const finalState = await state();
    const core = finalState.find((row)=>row.proname === "bulk_update_estimate_items_without_line_nature");
    await db.exec("alter function public.bulk_update_estimate_items_without_line_nature"+signature+" rename to army_missing_aid_core");
    await rejected("Missing core refuses migration",()=>db.exec(migrationSql),"42883");
    await db.exec("alter function public.army_missing_aid_core"+signature+" rename to bulk_update_estimate_items_without_line_nature");
    await db.exec(`create or replace function public.bulk_update_estimate_items_without_line_nature(target_version_id uuid,item_updates jsonb,version_patch jsonb default null,expected_version_updated_at timestamptz default null)
      returns integer language plpgsql set search_path=public as $$ begin return 0; end; $$;`);
    const unexpected = await state();
    await rejected("Unexpected core refuses migration",()=>db.exec(migrationSql),"P0001");
    equal("Refused migration leaves function definitions unchanged",await state(),unexpected);
    await db.exec(core.definition);
    equal("Final corrected function definitions restored",await state(),finalState);
    status = "passed";
  }
} catch (error) {
  failure = {message:error.message,code:error.code,stack:error.stack};
  process.exitCode = 1;
} finally {
  const changes = [];
  for (const [file,hash] of inputs) if (sha256(await fs.readFile(file)) !== hash) changes.push(file);
  if (changes.length) {status = "source-changed";process.exitCode = 1;}
  await fs.mkdir(outputDirectory,{recursive:true});
  const evidencePath = path.join(outputDirectory,"evidence.json");
  await fs.writeFile(evidencePath,JSON.stringify({
    schemaVersion:1,status,baselineOnly,capturedAt:new Date().toISOString(),
    command:["node","scripts/test-tiered-bulk-aid-sql.mjs",...process.argv.slice(2)].join(" "),
    environment:{PGLITE_MODULE:modulePath,BULK_AID_FUNCTIONS_JSON:snapshotPath,network:"none",remoteWrites:false,authentication:"simulated auth.uid()",activeUser,activeRole},
    migrationPath,deployedMetadata,inputs:[...inputs].map(([file,hash])=>({path:file,sha256:hash})),
    sourceChangedDuringRun:changes.length>0,changedInputs:changes,checks,observations,failure,
    limitations:["Isolated schema and simulated identity/table grants; no complete Supabase proof.","No HTTP lease, full publication/audit or multisession concurrency proof.","Recorded post-MO functions and earlier read-only dependencies/policies.","No remote application or UI qualification by this SQL runner."],
  },null,2)+"\n");
  await db?.close();
  console.log(JSON.stringify({status,checks:checks.length,evidencePath,failure:failure?.message}));
}
