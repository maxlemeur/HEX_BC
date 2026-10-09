// Isolated PostgreSQL fixture only. No credentials or remote connection.
// PGLITE_MODULE optionally points to an existing @electric-sql/pglite module.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const modulePath = process.env.PGLITE_MODULE;
const { PGlite } = await import(modulePath ? pathToFileURL(modulePath).href : "@electric-sql/pglite");
const db = new PGlite();
const tenant = "00000000-0000-4000-8000-000000000001";
const otherTenant = "00000000-0000-4000-8000-000000000002";
const legacyTenant = "00000000-0000-4000-8000-000000000004";
const user = "00000000-0000-4000-8000-000000000003";
let assertions = 0;
function equal(actual, expected) { assert.deepEqual(actual, expected); assertions++; }
async function reject(sql, params, code) {
  await assert.rejects(db.query(sql, params), (error) => error.code === code);
  assertions++;
}
async function insert(reference, tenantId = tenant) {
  return (await db.query("insert into public.products(tenant_id,reference,designation) values ($1,$2,'Article') returning id,reference", [tenantId, reference])).rows[0];
}
async function suggest() {
  return (await db.query("select public.suggest_product_reference() as ref")).rows[0].ref;
}
try {
  await db.exec(await fs.readFile("src/test/fixtures/product-reference-ti578.sql", "utf8"));
  // Legacy duplicates, null references and inactive items must remain untouched.
  await insert("Historical"); await insert("historical"); await insert(null);
  await insert(" ART-000001 ", legacyTenant);
  await insert("Art-000002", legacyTenant);
  const archivedLegacy = await insert(" art-000003 ", legacyTenant);
  await db.query("update public.products set is_active=false where id=$1", [archivedLegacy.id]);
  await db.exec(await fs.readFile("supabase/migrations/20261002155954_product_internal_reference_auto.sql", "utf8"));
  equal((await db.query("select reference from public.products where tenant_id=$1 order by reference nulls last", [tenant])).rows.map(r => r.reference), ["Historical", "historical", null]);
  await db.query("select set_config('test.user_id',$1,false), set_config('test.tenant_id',$2,false), set_config('test.role','admin',false)", [user, tenant]);
  await db.exec("set role authenticated");
  equal(await suggest(), "ART-000001"); equal(await suggest(), "ART-000001");
  const automatic = await insert(null); equal(automatic.reference, "ART-000001");
  equal((await insert(" ")).reference, "ART-000002");
  equal((await insert("Manual-123")).reference, "Manual-123");
  await reject("insert into public.products(tenant_id,reference,designation) values($1,'manual-123','Collision')", [tenant], "23505");
  await db.query("update public.products set reference=null,is_active=false where id=$1", [automatic.id]);
  equal((await db.query("select reference,is_active from public.products where id=$1", [automatic.id])).rows[0], {reference:"ART-000001", is_active:false});
  // Preserve the tenant guard even if a caller supplies a foreign tenant explicitly.
  await reject("insert into public.products(tenant_id,reference,designation) values($1,null,'Other')", [otherTenant], "42501");
  await insert("ART-000010"); equal(await suggest(), "ART-000011");
  const allocated = await Promise.all(Array.from({length:20}, () => insert(null)));
  equal(new Set(allocated.map(r => r.reference)).size, 20);
  equal(allocated.at(-1).reference, "ART-000030");
  await db.query("select set_config('test.role','viewer',false)");
  await reject("select public.suggest_product_reference()", [], "42501");
  await reject("insert into public.products(tenant_id,reference,designation) values($1,null,'Denied')", [tenant], "42501");
  await db.exec("set role anon");
  await reject("select public.suggest_product_reference()", [], "42501");
  await db.exec("reset role");
  await db.query("select set_config('test.tenant_id',$1,false), set_config('test.role','admin',false)", [otherTenant]);
  await db.exec("set role authenticated");
  equal((await insert(null, otherTenant)).reference, "ART-000001");
  await db.query("select set_config('test.tenant_id',$1,false)", [legacyTenant]);
  // Use the same normalization as uniqueness; preserve the legacy spelling.
  equal(await suggest(), "ART-000004");
  equal((await insert(null, legacyTenant)).reference, "ART-000004");
  equal((await db.query("select reference,is_active from public.products where id=$1", [archivedLegacy.id])).rows[0], {reference:" art-000003 ", is_active:false});
  console.log(`TI-578: ${assertions} SQL assertions passed (isolated single-backend PostgreSQL; no multi-session concurrency proof).`);
} finally { await db.close(); }
