// Runs only in a new in-memory PostgreSQL instance; no network/database credentials.
// PGLITE_MODULE can point to an existing @electric-sql/pglite installation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
const modulePath = process.env.PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
let assertions = 0;
const equal = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const tenant = uuid(1), otherTenant = uuid(2), admin = uuid(3), engineer = uuid(4), otherAdmin = uuid(5), product = uuid(6), otherProduct = uuid(7);
async function proposal(quantity = 100, transport = "excluded", id = product) {
  return (await db.query("select public.product_reference_price_proposal($1, $2, $3) as result", [id, quantity, transport])).rows[0].result;
}
async function reject(sql, params, code) {
  await assert.rejects(db.query(sql, params), (error) => error.code === code); assertions++;
}
async function validate(value, manual = null, reason = null) {
  return (await db.query("select public.validate_product_reference_price($1,$2,$3,$4,$5,$6) as result", [product, value.quantity, value.transport_mode, value.fingerprint, manual, reason])).rows[0].result;
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
try {
  await db.exec(await fs.readFile("src/test/fixtures/reference-price.sql", "utf8"));
  const legacy = (await fs.readFile("supabase/migrations/20260714090000_sync_reference_price_from_confirmed_orders.sql", "utf8")).replaceAll("\r\n", "\n");
  await db.exec(legacy.slice(0, legacy.indexOf("\ndo $$\ndeclare\n  tenant_products")));
  // Install the actual predecessor page function; its drop is part of the migration.
  const page = await fs.readFile("supabase/migrations/20260819230500_drop_product_tax_rate.sql", "utf8");
  await db.exec(page.slice(page.indexOf("create function public.catalogue_products_page(")));
  await db.exec(await fs.readFile("supabase/migrations/20260906110121_supplier_price_validity_six_months.sql", "utf8"));
  await db.exec(await fs.readFile("supabase/migrations/20260906145000_supplier_reference_price_proposals.sql", "utf8"));
  await db.query("insert into public.tenants(id) values ($1), ($2)", [tenant, otherTenant]);
  await db.query("insert into auth.users(id) values ($1), ($2), ($3)", [admin, engineer, otherAdmin]);
  await db.query("insert into public.tenant_memberships(tenant_id,user_id,role) values ($1,$2,'admin'), ($1,$3,'engineer'), ($4,$5,'admin')", [tenant, admin, engineer, otherTenant, otherAdmin]);
  await login(admin);
  await db.query("insert into public.products(id,tenant_id) values ($1,$2),($3,$4)", [product,tenant,otherProduct,otherTenant]);
  for (const [id,name] of [[10,"A"],[11,"B"],[12,"C"],[13,"D"],[14,"E"],[15,"F"]]) {
    await db.query("insert into public.suppliers(id,tenant_id,name) values ($1,$2,$3)", [uuid(id),tenant,name]);
  }
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
  p=await proposal(); equal(p.zero_price_requires_review,true); equal(p.proposed_price_cents,null);
  await db.query("update public.supplier_pricebook set is_active=false where id=$1",[uuid(31)]);
  await quote(29,10,1,{supplier_sku:""}); equal((await proposal()).offers.find(o=>o.id===uuid(29)).exclusion,"missing_supplier_reference");
  const old=(await db.query("select (current_date - interval '6 months')::date::text as d")).rows[0].d;
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
  console.log(`PASS: ${assertions} assertions on actual SQL migrations in isolated PostgreSQL; no shared database changed.`);
} catch (error) {
  console.error({ message: error.message, code: error.code, detail: error.detail, where: error.where });
  process.exitCode = 1;
} finally { await db.close(); }
