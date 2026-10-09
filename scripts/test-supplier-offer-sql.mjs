// Atomic edit and RLS fixture only; no network/database credentials.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
let assertions = 0;
const equal = (a,b) => { assert.deepEqual(a,b); assertions++; };
async function edit(patch, price = id(4)) {
  return (await db.query("select public.update_supplier_offer($1,$2) as offer",[price,patch])).rows[0].offer;
}
async function reject(patch, code, price = id(4)) {
  await assert.rejects(edit(patch,price), (error) => error.code === code); assertions++;
}
try {
  await db.exec(await fs.readFile("src/test/fixtures/product-reference-ti578.sql","utf8"));
  await db.exec(await fs.readFile("src/test/fixtures/supplier-offer-ti579.sql","utf8"));
  for (const [product, tenant] of [[9, 1], [10, 2]]) {
    await db.query("insert into public.products(id,tenant_id,designation) values($1,$2,'Article')", [id(product), id(tenant)]);
  }
  await db.query("insert into public.suppliers(id,tenant_id) values($1,$2),($3,$4)", [id(11), id(1), id(12), id(2)]);
  await db.query("insert into public.supplier_catalog_items(id,tenant_id,product_id,supplier_id,supplier_sku) values ($1,$2,$3,$4,'ORIGINAL'),($5,$6,$7,$8,'OTHER')",[id(3),id(1),id(9),id(11),id(7),id(2),id(10),id(12)]);
  for(const [price,item,tenant] of [[4,3,1],[5,3,1],[6,7,2]]) {
    await db.query("insert into public.supplier_pricebook(id,tenant_id,supplier_catalog_item_id,product_id,supplier_id,unit_price_cents) values ($1,$2,$3,$4,$5,1000)",[id(price),id(tenant),id(item),id(tenant === 1 ? 9 : 10),id(tenant === 1 ? 11 : 12)]);
  }
  await db.exec(await fs.readFile("supabase/migrations/20261002160807_supplier_offer_atomic_edit.sql","utf8"));
  await db.query("select set_config('test.user_id',$1,false),set_config('test.tenant_id',$2,false),set_config('test.role','admin',false)",[id(8),id(1)]);
  await db.exec("set role authenticated");
  equal((await db.query("select has_table_privilege('authenticated','public.supplier_catalog_items','UPDATE') as allowed")).rows[0].allowed, false);
  const updated = await edit({unit_price_cents:1200,supplier_sku:"NEW",product_url:"https://example.test/new"});
  equal(updated.unit_price_cents,1200);
  equal(updated.supplier_sku,"NEW");
  equal(updated.product_url,"https://example.test/new");
  equal((await db.query("select supplier_sku,product_url from public.supplier_catalog_items where id=$1",[id(3)])).rows[0],{supplier_sku:"NEW",product_url:"https://example.test/new"});
  equal((await db.query("select unit_price_cents from public.supplier_pricebook where id=$1",[id(5)])).rows[0].unit_price_cents,1000);
  await reject({unit_price_cents:-1,supplier_sku:"SHOULD-ROLL-BACK"},"23514");
  equal((await db.query("select supplier_sku from public.supplier_catalog_items where id=$1",[id(3)])).rows[0].supplier_sku,"NEW");
  equal((await db.query("select unit_price_cents from public.supplier_pricebook where id=$1",[id(4)])).rows[0].unit_price_cents,1200);
  await reject({tenant_id:id(2)},"22023"); await reject({},"22023");
  await reject({product_url:"javascript:alert(1)"},"22023");
  await reject({product_url:"https://example.test/with space"},"22023");
  equal((await edit({transport_mode:"included"})).transport_mode,"included");
  equal((await edit({transport_mode:"excluded"})).transport_mode,"excluded");
  await reject({transport_mode:"unknown"},"23514");
  equal((await edit({transport_mode:null})).transport_mode,null);
  equal((await edit({notes:null,source:"Supplier quote"})).notes,"Supplier quote");
  await reject({unit_price_cents:5},"P0002",id(6));
  await db.query("select set_config('test.role','engineer',false)"); equal((await edit({unit_price_cents:1300})).unit_price_cents,1300);
  await reject({transport_mode:"included",supplier_sku:"SHOULD-ROLL-BACK"},"42501");
  equal((await db.query("select supplier_sku from public.supplier_catalog_items where id=$1",[id(3)])).rows[0].supplier_sku,"NEW");
  await db.query("select set_config('test.role','viewer',false)"); await reject({unit_price_cents:6},"42501");
  await db.exec("set role anon"); await reject({unit_price_cents:6},"42501");
  await db.exec("reset role");
  await db.query("select set_config('test.user_id','',false),set_config('test.role','admin',false)");
  await db.exec("set role authenticated"); await reject({unit_price_cents:6},"42501");
  console.log(`TI-579: ${assertions} isolated SQL assertions passed (atomic rollback, targeted cost and tenant/role isolation).`);
} finally { await db.close(); }
