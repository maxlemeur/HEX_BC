// Runs only in a new in-memory PostgreSQL instance; no network/database credentials.
// PGLITE_MODULE can point to an existing @electric-sql/pglite installation.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const baseline = process.argv.includes("--baseline");
const candidateMigration = "supabase/migrations/20261011030647_reference_price_zero_and_inclusive_validity.sql";
const startedAt = new Date().toISOString();
const evidenceDirectory = path.resolve(".e2e/reference-price", startedAt.replaceAll(":", "-") + (baseline ? "-baseline" : "-candidate"));
const inputPaths = [
  "scripts/test-reference-price-sql.mjs", "src/test/fixtures/reference-price.sql",
  "supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql",
  "supabase/migrations/20260819230500_drop_product_tax_rate.sql",
  "supabase/migrations/20260906110121_supplier_price_validity_six_months.sql",
  "supabase/migrations/20260906145000_supplier_reference_price_proposals.sql",
  ...(!baseline ? [candidateMigration] : []),
];
const proof = {
  startedAt, mode: baseline ? "baseline" : "candidate",
  command: [process.execPath, ...process.argv.slice(1)],
  revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  localChanges: execFileSync("git", ["status", "--short"], { encoding: "utf8" }),
  environment: { node: process.version, platform: process.platform, database: "new in-memory PGlite", modulePath: process.env.PGLITE_MODULE ?? "package resolution", network: "none" },
  inputs: [], checks: [], cases: [],
};
await fs.mkdir(evidenceDirectory, { recursive: true });
for (const input of inputPaths) {
  const contents = await fs.readFile(input);
  const destination = path.join(evidenceDirectory, "source", input);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, contents);
  proof.inputs.push({ path: input, sha256: createHash("sha256").update(contents).digest("hex") });
}
const modulePath = process.env.PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
let assertions = 0;
let inRegressionCase = false;
const equal = (actual, expected, label = "assertion " + (assertions + 1)) => {
  try { assert.deepEqual(actual, expected); assertions++; proof.checks.push({ label, actual, expected, passed: true }); }
  catch (error) { proof.checks.push({ label, actual, expected, passed: false }); throw error; }
};
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = uuid(1), otherTenant = uuid(2), admin = uuid(3), engineer = uuid(4), otherAdmin = uuid(5), product = uuid(6), otherProduct = uuid(7), viewer = uuid(8);
async function proposal(quantity = 100, transport = "excluded", id = product) {
  return (await db.query("select public.product_reference_price_proposal($1, $2, $3) as result", [id, quantity, transport])).rows[0].result;
}
async function reject(sql, params, code) {
  if (inRegressionCase) await db.exec("savepoint expected_rejection");
  let actualCode = null;
  try { await db.query(sql, params); } catch (error) { actualCode = error.code; }
  if (inRegressionCase) await db.exec("rollback to savepoint expected_rejection");
  equal(actualCode, code, "SQL statement refused with " + code);
}
async function validate(value, manual = null, reason = null, id = product) {
  return (await db.query("select public.validate_product_reference_price($1,$2,$3,$4,$5,$6) as result", [id, value.quantity, value.transport_mode, value.fingerprint, manual, reason])).rows[0].result;
}
async function login(id) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function quote(id, supplier, cents, extras = {}) {
  const fields = { id: uuid(id), tenant_id: tenant, product_id: product, supplier_id: uuid(supplier), supplier_sku: `REF-${supplier}`,
    unit_price_cents: cents, transport_mode: "excluded", ...extras };
  const entries = Object.entries(fields);
  await db.query(`insert into public.supplier_pricebook (${entries.map(([k]) => k).join(",")}) values (${entries.map((_, i) => `$${i+1}`).join(",")})`, entries.map(([,v]) => v));
}
async function regressionCase(name, run) {
  await db.exec("begin");
  inRegressionCase = true;
  try {
    await run();
    proof.cases.push({ name, status: "passed" });
  } catch (error) {
    proof.cases.push({ name, status: "failed", message: error.message, code: error.code ?? null });
  } finally {
    inRegressionCase = false;
    await db.exec("rollback");
  }
}
async function securitySnapshot() {
  return (await db.query(`
    select p.proname, p.proowner::regrole::text as owner, p.prosecdef, p.provolatile,
      p.proconfig, p.proacl::text as acl, pg_get_function_identity_arguments(p.oid) as signature,
      case when p.proname <> 'product_reference_price_proposal' then pg_get_functiondef(p.oid) end as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in
      ('product_reference_price_proposal', 'validate_product_reference_price',
       'lock_supplier_reference_product', 'lock_supplier_reference_products', 'protect_product_reference_price')
    order by p.proname
  `)).rows;
}
try {
  await db.exec(await fs.readFile("src/test/fixtures/reference-price.sql", "utf8"));
  const legacy = (await fs.readFile("supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql", "utf8")).replaceAll("\r\n", "\n");
  await db.exec(legacy.slice(0, legacy.indexOf("\ndo $$\ndeclare\n  tenant_products")));
  // Install the actual predecessor page function; its drop is part of the migration.
  const page = await fs.readFile("supabase/migrations/20260819230500_drop_product_tax_rate.sql", "utf8");
  await db.exec(page.slice(page.indexOf("create function public.catalogue_products_page(")));
  await db.exec(await fs.readFile("supabase/migrations/20260906110121_supplier_price_validity_six_months.sql", "utf8"));
  await db.exec(await fs.readFile("supabase/migrations/20260906145000_supplier_reference_price_proposals.sql", "utf8"));
  const securityBefore = await securitySnapshot();
  const policiesBefore = (await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows;
  const triggersBefore = (await db.query("select tgname, pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal order by tgname")).rows;
  if (!baseline) await db.exec(await fs.readFile(candidateMigration, "utf8"));
  equal(await securitySnapshot(), securityBefore, "function security, signatures and unchanged validation/locks");
  equal((await db.query("select * from pg_policies where schemaname = 'public' order by tablename, policyname")).rows, policiesBefore, "RLS policies unchanged");
  equal((await db.query("select tgname, pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal order by tgname")).rows, triggersBefore, "triggers unchanged");
  await db.query("insert into public.tenants(id) values ($1), ($2)", [tenant, otherTenant]);
  await db.query("insert into auth.users(id) values ($1), ($2), ($3), ($4)", [admin, engineer, otherAdmin, viewer]);
  await db.query("insert into public.tenant_memberships(tenant_id,user_id,role) values ($1,$2,'admin'), ($1,$3,'engineer'), ($4,$5,'admin'), ($1,$6,'viewer')", [tenant, admin, engineer, otherTenant, otherAdmin, viewer]);
  await login(admin);
  await db.query("insert into public.products(id,tenant_id) values ($1,$2),($3,$4)", [product,tenant,otherProduct,otherTenant]);
  for (const [id,name] of [[10,"A"],[11,"B"],[12,"C"],[13,"D"],[14,"E"],[15,"F"]]) {
    await db.query("insert into public.suppliers(id,tenant_id,name) values ($1,$2,$3)", [uuid(id),tenant,name]);
  }
  await regressionCase("positive mean excludes zero and retains clarification in the validated snapshot", async () => {
    const testProduct = uuid(50);
    await db.query("insert into public.products(id,tenant_id) values ($1,$2)", [testProduct, tenant]);
    await quote(51,10,1000,{ product_id: testProduct });
    await quote(52,11,1100,{ product_id: testProduct });
    await quote(53,15,0,{ product_id: testProduct });
    const value = await proposal(100,"excluded",testProduct);
    equal(value.proposed_price_cents,1050,"1000 + 1100 + excluded zero gives 1050");
    equal(value.offer_count,2,"zero is not a retained supplier");
    equal(value.zero_price_requires_review,true,"zero clarification remains visible");
    equal(value.offers.find((offer) => offer.id === uuid(53)).exclusion,"zero_price");
    await db.exec("set role authenticated");
    const result = await validate(value,null,null,testProduct);
    equal(result.unit_price_cents,1050);
    const snapshot = (await db.query("select proposal, validated_by, mode from public.product_reference_price_validations where id=$1",[result.validation_id])).rows[0];
    equal(snapshot.validated_by,admin);
    equal(snapshot.mode,"average");
    equal(snapshot.proposal.offers.length,3);
    equal(snapshot.proposal.zero_price_requires_review,true);
    equal(snapshot.proposal.offers.find((offer) => offer.id === uuid(53)).exclusion,"zero_price");
  });
  await regressionCase("all-zero cannot overwrite a prior reference and roles remain enforced", async () => {
    const testProduct = uuid(60);
    await db.query("insert into public.products(id,tenant_id) values ($1,$2)", [testProduct,tenant]);
    await quote(61,15,0,{ product_id: testProduct });
    await db.exec("set role authenticated");
    const first = await proposal(100,"excluded",testProduct);
    await validate(first,1234,"Previous manually justified reference",testProduct);
    const value = await proposal(100,"excluded",testProduct);
    equal(value.proposed_price_cents,null); equal(value.offer_count,0);
    equal(value.zero_price_requires_review,true); equal(value.current_price_cents,1234);
    const args = [testProduct,100,"excluded",value.fingerprint];
    await reject("select public.validate_product_reference_price($1,$2,$3,$4)",args,"22023");
    equal((await db.query("select count(*)::int as n from public.product_reference_price_validations where product_id=$1",[testProduct])).rows[0].n,1);
    equal((await proposal(100,"excluded",testProduct)).current_price_cents,1234);
    for (const reader of [engineer,viewer]) {
      await login(reader);
      await reject("select public.validate_product_reference_price($1,$2,$3,$4)",args,"42501");
    }
    await login(otherAdmin);
    await reject("select public.product_reference_price_proposal($1,100,'excluded')",[testProduct],"P0002");
    await reject("select public.validate_product_reference_price($1,$2,$3,$4)",args,"P0002");
    await db.exec("reset role");
    equal((await db.query("select has_function_privilege('anon','public.product_reference_price_proposal(uuid,numeric,text)','EXECUTE') as proposal, has_function_privilege('anon','public.validate_product_reference_price(uuid,numeric,text,text,integer,text)','EXECUTE') as validation")).rows[0],{proposal:false,validation:false});
    await db.exec("set role anon");
    await reject("select public.product_reference_price_proposal($1,100,'excluded')",[testProduct],"42501");
    await reject("select public.validate_product_reference_price($1,$2,$3,$4)",args,"42501");
    await db.exec("reset role");
    await login(admin);
    await db.exec("set role authenticated");
    equal((await validate(value,0,"Explicit manually justified zero",testProduct)).unit_price_cents,0);
    equal((await proposal(100,"excluded",testProduct)).current_price_cents,0,"manual validated zero stays distinct from missing reference");
  });
  await regressionCase("six calendar months include the final day, including leap February", async () => {
    const testProduct = uuid(70);
    await db.query("insert into public.products(id,tenant_id) values ($1,$2)", [testProduct,tenant]);
    await quote(71,10,1000,{ product_id:testProduct,valid_from:"2026-08-31" });
    equal((await db.query("select valid_to::text from public.supplier_pricebook where id=$1",[uuid(71)])).rows[0].valid_to,"2027-02-28");
    const definition = (await db.query("select pg_get_functiondef('public.product_reference_price_proposal(uuid,numeric,text)'::regprocedure) as definition")).rows[0].definition;
    // Isolated clock substitution only; do not change any predicate or arithmetic.
    // This transaction is rolled back, including this replacement definition.
    await db.exec(definition.replaceAll(/\bcurrent_date\b/gi,"current_setting('test.reference_date')::date"));
    await db.query("select set_config('test.reference_date',$1,true)",["2027-02-28"]);
    let value = await proposal(100,"excluded",testProduct);
    equal(value.as_of,"2027-02-28"); equal(value.proposed_price_cents,1000,"six-month last day is inclusive");
    equal(value.offers[0].exclusion,null);
    await db.query("select set_config('test.reference_date',$1,true)",["2027-03-01"]);
    value = await proposal(100,"excluded",testProduct);
    equal(value.proposed_price_cents,null); equal(value.offers[0].exclusion,"expired");
    await db.query("update public.supplier_pricebook set valid_from='2023-08-31',valid_to=null where id=$1",[uuid(71)]);
    equal((await db.query("select valid_to::text from public.supplier_pricebook where id=$1",[uuid(71)])).rows[0].valid_to,"2024-02-29");
    await db.query("select set_config('test.reference_date',$1,true)",["2024-02-29"]);
    equal((await proposal(100,"excluded",testProduct)).proposed_price_cents,1000,"leap-year last day is inclusive");
    await db.query("select set_config('test.reference_date',$1,true)",["2024-03-01"]);
    equal((await proposal(100,"excluded",testProduct)).offers[0].exclusion,"expired");
    await db.query("update public.supplier_pricebook set valid_from='2026-08-31',valid_to='2026-10-11' where id=$1",[uuid(71)]);
    await db.query("select set_config('test.reference_date',$1,true)",["2026-10-11"]);
    equal((await proposal(100,"excluded",testProduct)).proposed_price_cents,1000,"shorter validity is inclusive too");
    await db.query("select set_config('test.reference_date',$1,true)",["2026-10-12"]);
    equal((await proposal(100,"excluded",testProduct)).offers[0].exclusion,"expired");
  });
  await regressionCase("all insert and update writes obey the six-month date constraint", async () => {
    await quote(80,10,1000,{ valid_from:"2026-08-31" });
    equal((await db.query("select valid_to::text from public.supplier_pricebook where id=$1",[uuid(80)])).rows[0].valid_to,"2027-02-28");
    // Failed statements use savepoints so subsequent observations run normally.
    for (const [sql,args] of [
      ["update public.supplier_pricebook set valid_to='2027-03-01' where id=$1",[uuid(80)]],
      ["update public.supplier_pricebook set valid_to='2026-08-30' where id=$1",[uuid(80)]],
      ["update public.supplier_pricebook set valid_from='2026-08-01' where id=$1",[uuid(80)]],
      ["insert into public.supplier_pricebook(id,tenant_id,product_id,supplier_id,unit_price_cents,valid_from,valid_to) values ($1,$2,$3,$4,1000,'2026-08-31','2027-02-28'),($5,$2,$3,$4,1000,'2026-08-31','2027-03-01')",[uuid(81),tenant,product,uuid(10),uuid(82)]],
    ]) {
      await db.exec("savepoint invalid_write");
      await reject(sql,args,"23514");
      await db.exec("rollback to savepoint invalid_write");
    }
    equal((await db.query("select count(*)::int as n from public.supplier_pricebook where id in ($1,$2)",[uuid(81),uuid(82)])).rows[0].n,0,"invalid batch inserts neither row");
    equal((await db.query("select valid_from::text,valid_to::text from public.supplier_pricebook where id=$1",[uuid(80)])).rows[0],{valid_from:"2026-08-31",valid_to:"2027-02-28"});
    await db.query("update public.supplier_pricebook set valid_to='2026-09-01' where id=$1",[uuid(80)]);
    await db.query("update public.supplier_pricebook set valid_to=null where id=$1",[uuid(80)]);
    equal((await db.query("select valid_to::text from public.supplier_pricebook where id=$1",[uuid(80)])).rows[0].valid_to,"2027-02-28");
  });
  await quote(20,10,1000); await quote(21,11,1100); await quote(22,12,900,{min_quantity:1000});
  let p = await proposal();
  equal(p.proposed_price_cents,1050); equal(p.offer_count,2); equal(p.dispersion_alert,false);
  equal(p.offers.find(o=>o.id===uuid(22)).exclusion,"quantity");
  equal((await proposal(1000)).proposed_price_cents,1000);
  await db.query("update public.supplier_pricebook set unit_price_cents=1150 where id=$1",[uuid(21)]);
  equal((await proposal()).dispersion_alert,false);
  await db.query("update public.supplier_pricebook set unit_price_cents=1151 where id=$1",[uuid(21)]);
  p=await proposal(); equal(p.dispersion_alert,true); equal(p.proposed_price_cents,1076); equal(p.offer_count,2);
  await quote(23,10,3000,{valid_from:"2020-01-01",valid_to:"2020-06-01"});
  p=await proposal(); equal(p.offer_count,2); equal(p.offers.find(o=>o.id===uuid(23)).exclusion,"expired");
  const today=(await db.query("select current_date::text as d")).rows[0].d;
  const yesterday=(await db.query("select (current_date - 1)::text as d")).rows[0].d;
  await quote(24,10,800,{valid_from:yesterday});
  equal((await proposal()).offers.find(o=>o.id===uuid(24)).exclusion,"older_supplier_offer");
  await quote(25,13,500,{unit:"kg"}); await quote(26,14,600,{currency:"USD"}); await quote(27,15,700,{transport_mode:null});
  p=await proposal(); equal(p.offer_count,2);
  equal(p.offers.find(o=>o.id===uuid(25)).exclusion,"unit"); equal(p.offers.find(o=>o.id===uuid(26)).exclusion,"currency"); equal(p.offers.find(o=>o.id===uuid(27)).exclusion,"missing_transport");
  const future=(await db.query("select (current_date + 1)::text as d")).rows[0].d;
  await quote(28,10,1,{valid_from:future}); equal((await proposal()).offers.find(o=>o.id===uuid(28)).exclusion,"future");
  equal((await proposal(null,null)).proposed_price_cents,null);
  equal((await proposal(100,"included")).proposed_price_cents,null);
  await quote(31,15,0);
  p=await proposal(); equal(p.zero_price_requires_review,true); equal(p.proposed_price_cents,1076);
  await db.query("update public.supplier_pricebook set is_active=false where id=$1",[uuid(31)]);
  await quote(29,10,1,{supplier_sku:""}); equal((await proposal()).offers.find(o=>o.id===uuid(29)).exclusion,"missing_supplier_reference");
  const old=(await db.query("select (current_date - interval '6 months' - interval '1 day')::date::text as d")).rows[0].d;
  await quote(30,10,1,{valid_from:old}); equal((await proposal()).offers.find(o=>o.id===uuid(30)).exclusion,"expired");
  await db.query("insert into public.estimate_items(product_id,unit_price_ht_cents) values ($1,777)",[product]);
  await db.exec("set role authenticated");
  p=await proposal(); const v=await validate(p); equal(v.unit_price_cents,1076);
  equal((await db.query("select unit_price_cents from public.products where id=$1",[product])).rows[0].unit_price_cents,1076);
  equal((await db.query("select validated_by, mode from public.product_reference_price_validations where id=$1",[v.validation_id])).rows[0],{validated_by:admin,mode:"average"});
  await reject("select public.validate_product_reference_price($1,$2,$3,$4)",[product,100,"excluded",p.fingerprint],"P0001");
  await reject("update public.products set unit_price_cents=1 where id=$1",[product],"P0001");
  await reject("delete from public.product_reference_price_validations",[],"42501");
  await reject("update public.products set unit='kg' where id=$1",[product],"P0001");
  equal((await db.query("select previous_offer->>'unit_price_cents' as amount from public.supplier_pricebook_history where offer_id=$1 order by changed_at asc limit 1",[uuid(21)])).rows[0].amount,"1100");
  p=await proposal(); await db.query("update public.supplier_pricebook set unit_price_cents=2000 where id=$1",[uuid(20)]);
  await reject("select public.validate_product_reference_price($1,$2,$3,$4)",[product,100,"excluded",p.fingerprint],"P0001");
  equal((await proposal()).current_price_cents,1076);
  p=await proposal(); await reject("select public.validate_product_reference_price($1,$2,$3,$4,$5,$6)",[product,100,"excluded",p.fingerprint,1234,""],"22023");
  equal((await validate(p,1234,"Coût négocié pour ce chantier")).unit_price_cents,1234);
  equal((await db.query("select unit_price_ht_cents from public.estimate_items")).rows[0].unit_price_ht_cents,777);
  await login(engineer); equal((await proposal()).current_price_cents,1234);
  await reject("update public.supplier_pricebook set transport_mode='included' where id=$1",[uuid(20)],"42501");
  p=await proposal(); await reject("select public.validate_product_reference_price($1,$2,$3,$4)",[product,100,"excluded",p.fingerprint],"42501");
  await login(otherAdmin); await reject("select public.product_reference_price_proposal($1,100,'excluded')",[product],"P0002");
  equal((await db.query("select count(*)::int as n from public.product_reference_price_validations")).rows[0].n,0);
  await login(admin); await db.exec("reset role");
  await db.query("update public.supplier_pricebook set is_active=false where id=$1",[uuid(21)]);
  p=await proposal(); equal(p.offer_count,1); equal(p.proposed_price_cents,2000);
  await db.query("update public.supplier_pricebook set is_active=true where id=$1",[uuid(21)]);
  await db.query("insert into public.purchase_orders(id,tenant_id,status,order_date) values ($1,$2,'confirmed',$3)",[uuid(40),tenant,today]);
  await db.query("insert into public.purchase_order_items(tenant_id,purchase_order_id,product_id,unit_price_ht_cents) values ($1,$2,$3,10)",[tenant,uuid(40),product]);
  equal((await proposal()).current_price_cents,1234);
  equal((await db.query("select reference_price_validation_id is not null as validated from public.catalogue_products_page() where id=$1",[product])).rows[0].validated,true);
  await db.query("update public.supplier_pricebook set is_active=false where product_id=$1",[product]);
  p=await proposal(); equal(p.proposed_price_cents,null); equal(p.current_price_cents,1234);
  await db.query("update public.tenants set is_active=false where id=$1",[tenant]);
  await db.exec("set role authenticated");
  await reject("select public.product_reference_price_proposal($1,100,'excluded')",[product],"P0002");
  if (proof.cases.some((entry) => entry.status === "failed")) throw new Error("One or more reference-price regression cases failed.");
  console.log(`PASS: ${assertions} assertions on actual SQL migrations in isolated PostgreSQL; no shared database changed.`);
} catch (error) {
  proof.error = { message: error.message, code: error.code ?? null, detail: error.detail ?? null, where: error.where ?? null };
  console.error({ message: error.message, code: error.code, detail: error.detail, where: error.where });
  process.exitCode = 1;
} finally {
  await db.close();
  proof.finishedAt = new Date().toISOString();
  proof.assertionsPassed = assertions;
  proof.status = process.exitCode ? "failed" : "passed";
  const body = JSON.stringify(proof,null,2) + "\n";
  await fs.writeFile(path.join(evidenceDirectory,"evidence.json"),body);
  await fs.writeFile(path.join(evidenceDirectory,"evidence.sha256"),createHash("sha256").update(body).digest("hex") + "\n");
  console.log("Evidence: " + evidenceDirectory);
}
