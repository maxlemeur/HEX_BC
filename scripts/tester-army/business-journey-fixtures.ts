import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";

import { ensureSourceReferenceBucket } from "./storage-fixtures";

import type { AffaireIntakeExtractedMetadata } from "../../src/lib/affaires/intake";
import { checked, createActor, executePlan, sqlTransport, versionDefaults, writeFixture,
  type CalcV3FixtureContext, type PlanRecord } from "./calc-v3-fixtures";

// Prerequisites only. Each selected journey gets fresh owned UUIDs; its browser
// still performs the mutation, authorization, file and persistence assertions.
export const BUSINESS_JOURNEY_FILES = [
  "article-association.e2e.ts", "brief-evidence.e2e.ts", "catalogue-provenance.e2e.ts",
  "purchase-decimals.e2e.ts", "purchase-draft-eligibility.e2e.ts", "purchase-preparation.e2e.ts",
  "purchase-readiness.e2e.ts", "reference-price.e2e.ts", "source-reference-read.e2e.ts", "source-reference.e2e.ts",
] as const;

type Line = { label: string; lineId: string; productId: string; priceId: string; reference: string;
  quantity: number; price: number; ht: number; tax: number; ttc: number; supplierId: string };
const decimalValues = [
  { label: "integer", quantity: 2, price: 1200, ht: 2400, tax: 480, ttc: 2880 },
  { label: "half", quantity: 12.5, price: 123, ht: 1538, tax: 308, ttc: 1846 },
  { label: "eighth", quantity: 0.125, price: 777, ht: 97, tax: 19, ttc: 116 },
  { label: "thousandth", quantity: 0.001, price: 500, ht: 1, tax: 0, ttc: 1 },
];
function prefix(kind: string) { return `ARMY-${kind}-${randomUUID().slice(0, 8)}`; }
function common(context: CalcV3FixtureContext) { return { tenant_id: context.owner.tenantId }; }
function record(table: string, row: Record<string, unknown>): PlanRecord { return { table, row }; }

function projectPlan(context: CalcV3FixtureContext, name: string, projectId = randomUUID(), versionId = randomUUID()) {
  return { projectId, versionId, records: [
    record("estimate_projects", { ...common(context), id: projectId, user_id: context.owner.userId, name }),
    record("estimate_versions", { ...common(context), ...versionDefaults, id: versionId, project_id: projectId,
      title: name, calc_engine_version: 2 }),
  ] };
}

async function purchaseBase(context: CalcV3FixtureContext, name: string,
  values = decimalValues, separateSuppliers = false) {
  const project = projectPlan(context, name);
  const deliverySiteId = randomUUID(), supplierId = randomUUID(), sectionId = randomUUID();
  const totals = values.reduce((sum, line) => [sum[0] + line.ht, sum[1] + line.tax, sum[2] + line.ttc], [0, 0, 0]);
  Object.assign(project.records[1].row, { total_ht_cents: totals[0], total_tax_cents: totals[1], total_ttc_cents: totals[2] });
  const records = [...project.records, record("delivery_sites", { ...common(context), id: deliverySiteId,
    name: `${name} chantier`, address: "1 rue du Test", city: "Paris", postal_code: "75001", is_active: true })];
  records.push(record("estimate_items", { ...common(context), id: sectionId, version_id: project.versionId,
    parent_id: null, item_type: "section", position: 0, title: `${name} lot` }));
  const supplierIds = separateSuppliers ? values.map(() => randomUUID()) : [supplierId];
  for (const id of supplierIds) records.push(record("suppliers", { ...common(context), id, name: `${name} fournisseur ${id.slice(0, 4)}`, is_active: true }));
  const lines: Line[] = values.map((value, index) => {
    const productId = randomUUID(), priceId = randomUUID(), lineId = randomUUID(), catalogId = randomUUID();
    const selectedSupplier = separateSuppliers ? supplierIds[index] : supplierId;
    const reference = `${name}-${value.label}`;
    records.push(record("products", { ...common(context), id: productId, reference,
      designation: `${name} ${value.label}`, unit: "m", unit_price_cents: value.price, is_active: true }));
    records.push(record("supplier_catalog_items", { ...common(context), id: catalogId, supplier_id: selectedSupplier,
      product_id: productId, supplier_sku: reference, is_active: true }));
    records.push(record("supplier_pricebook", { ...common(context), id: priceId, supplier_id: selectedSupplier,
      product_id: productId, supplier_catalog_item_id: catalogId, supplier_sku: reference,
      unit: "m", min_quantity: value.label === "half" ? 1 : Math.min(1, value.quantity),
      unit_price_cents: separateSuppliers ? (index === 0 ? 1800 : 999) : value.price,
      currency: "EUR", is_active: true, valid_from: new Date().toISOString().slice(0, 10),
      valid_to: new Date(Date.now() + 180 * 86400_000).toISOString().slice(0, 10), created_by: context.owner.userId }));
    records.push(record("estimate_items", { ...common(context), id: lineId, version_id: project.versionId,
      parent_id: sectionId, item_type: "line", position: index + 1,
      title: separateSuppliers ? `${name} ligne ${value.label}` : `${name} ${value.label}`,
      description: "m", quantity: value.quantity, unit_price_ht_cents: value.price, tax_rate_bp: 2000,
      product_id: productId, selected_supplier_price_id: priceId, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
      line_nature: "supply_only", pu_ht_cents: value.price, line_total_ht_cents: value.ht, line_tax_cents: value.tax, line_total_ttc_cents: value.ttc }));
    return { ...value, lineId, productId, priceId, reference, supplierId: selectedSupplier };
  });
  await executePlan(context, name, records);
  const site = await checked(`${name}:delivery site`, context.admin.from("delivery_sites").select("updated_at").eq("id", deliverySiteId).single());
  return { status: "ready", apiUrl: context.backend, prefix: name, projectId: project.projectId,
    versionId: project.versionId, supplierId: lines[0].supplierId, deliverySiteId, deliverySiteUpdatedAt: site.updated_at, lines };
}

type PurchaseBase = Awaited<ReturnType<typeof purchaseBase>>;
async function seedOrder(context: CalcV3FixtureContext, base: PurchaseBase, label: string,
  lines: Line[], options: { linked?: boolean; count?: number; status?: "sent" | "confirmed" | "received" | "canceled" } = {}) {
  const id = randomUUID(), reference = `${base.prefix}-${label}`;
  const count = options.count ?? lines.length;
  const items = Array.from({ length: count }, (_, index) => {
    const line = lines[index % lines.length];
    return { ...common(context), id: randomUUID(), purchase_order_id: id, position: index + 1,
      // Historical transfers retain the source line's title as their snapshot.
      designation: options.status ? `${base.prefix} ligne ${line.label}` :
        label === "note" ? `${base.prefix} note witness` : `${reference} ligne ${index + 1}`,
      reference: options.count ? `${reference}-${index + 1}` : line.reference,
      quantity: line.quantity, unit_price_ht_cents: line.price, tax_rate_bp: 2000, unit: "m", price_unit: "m",
      product_id: line.productId, ...(options.linked ? { source_estimate_item_id: line.lineId,
        source_selected_supplier_price_id: line.priceId } : {}) };
  });
  await executePlan(context, reference, [record("purchase_orders", { ...common(context), id,
    user_id: context.owner.userId, reference, supplier_id: lines[0].supplierId, delivery_site_id: base.deliverySiteId,
    source_estimate_version_id: options.linked ? base.versionId : null, status: "draft", currency: "EUR", notes: "ARMY original note" }),
  ...items.map((item) => record("purchase_order_items", item))]);
  // Recompute headers through the ordinary invariant trigger after inserting the items.
  const header = await checked(`${reference}:totals`, context.admin.from("purchase_orders").update({ notes: "ARMY original note" })
    .eq("id", id).eq("tenant_id", context.owner.tenantId).select("edit_revision,total_ht_cents,total_tax_cents,total_ttc_cents").single());
  const expected = items.reduce((totals, item) => {
    const ht = Math.round(item.quantity * item.unit_price_ht_cents), tax = Math.round(ht * item.tax_rate_bp / 10000);
    return [totals[0] + ht, totals[1] + tax, totals[2] + ht + tax];
  }, [0, 0, 0]);
  if (JSON.stringify([header.total_ht_cents, header.total_tax_cents, header.total_ttc_cents]) !== JSON.stringify(expected)) {
    throw new Error(`Business fixture ${reference}: persisted order totals differ.`);
  }
  if (options.status) await checked(`${reference}:historical status`, context.admin.from("purchase_orders")
    .update({ status: options.status }).eq("id", id).eq("tenant_id", context.owner.tenantId).select("id").single());
  return { id, reference, label, template: lines[0], itemIds: items.map((item) => item.id), itemCount: count, ...header };
}

// Faithful synthetic restoration of a pre-unit migration row, not a migration
// execution claim. ACCESS EXCLUSIVE is acquired before the named trigger is
// disabled, and it is re-enabled and checked before commit. RLS stays enabled.
async function restoreLegacyUnknownUnit(context: CalcV3FixtureContext, orderId: string, itemId: string) {
  if (![orderId, itemId, context.owner.tenantId, context.owner.userId].every((id) => /^[0-9a-f-]{36}$/.test(id))) throw new Error("Invalid legacy ownership.");
  const transport = sqlTransport(context);
  const sql = `BEGIN;
LOCK TABLE public.purchase_order_items IN ACCESS EXCLUSIVE MODE;
ALTER TABLE public.purchase_order_items DISABLE TRIGGER zz_normalize_purchase_order_item;
DO $legacy$ DECLARE changed integer; BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres' THEN RAISE EXCEPTION 'LEGACY_SEED_OWNER'; END IF;
  UPDATE public.purchase_order_items i SET unit=NULL,price_unit=NULL
    FROM public.purchase_orders o WHERE i.id='${itemId}'::uuid AND i.purchase_order_id=o.id AND o.id='${orderId}'::uuid
      AND o.tenant_id='${context.owner.tenantId}'::uuid AND o.user_id='${context.owner.userId}'::uuid
      AND o.status='draft' AND o.reference LIKE 'ARMY-DECIMAL-%' AND i.is_source_linked;
  GET DIAGNOSTICS changed = ROW_COUNT;
  IF changed <> 1 THEN RAISE EXCEPTION 'LEGACY_SEED_SCOPE'; END IF;
END $legacy$;
ALTER TABLE public.purchase_order_items ENABLE TRIGGER zz_normalize_purchase_order_item;
DO $legacy$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.purchase_order_items'::regclass
    AND tgname='zz_normalize_purchase_order_item' AND tgenabled='O')
    OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.purchase_order_items'::regclass)
  THEN RAISE EXCEPTION 'LEGACY_SEED_GUARD_NOT_RESTORED'; END IF;
END $legacy$;
COMMIT;
SELECT 'BUSINESS_LEGACY_RESTORED';`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(transport.executable, transport.args, { env: transport.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    const timer = setTimeout(() => { child.kill(); }, 60_000);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.resume();
    child.stdin.on("error", () => {});
    child.once("error", () => { clearTimeout(timer); reject(new Error("Legacy fixture native transport unavailable.")); });
    child.once("close", (code) => { clearTimeout(timer);
      if (code === 0 && stdout.includes("BUSINESS_LEGACY_RESTORED")) resolve();
      else reject(new Error("Legacy fixture transaction failed; no fixture published and transactional trigger change rolled back."));
    });
    child.stdin.end(sql);
  });
}

async function decimalFixture(context: CalcV3FixtureContext, label: string, options: { legacy?: boolean; volume?: boolean } = {}) {
  const base = await purchaseBase(context, prefix(`DECIMAL-${label}`));
  const note = await seedOrder(context, base, "note", [base.lines[0]], { linked: true });
  const quantity = await seedOrder(context, base, "quantity", [base.lines[0]]);
  if (options.legacy) await restoreLegacyUnknownUnit(context, note.id, note.itemIds[0]);
  const noteItemBefore = await checked(`${label}:note`, context.admin.from("purchase_order_items").select("*").eq("id", note.itemIds[0]).single());
  const volume: Record<string, unknown> = {};
  if (options.volume) {
    for (const key of ["bulk", "bulkConcurrent"]) {
      const bulkPrefix = `${base.prefix}-${key === "bulk" ? "export-static" : "export-concurrent"}`;
      const bulkBase = { ...base, prefix: bulkPrefix };
      volume[key] = { prefix: bulkPrefix, orders: [
        await seedOrder(context, bulkBase, "A", [base.lines[1]], { count: 600 }),
        await seedOrder(context, bulkBase, "B", [base.lines[2]], { count: 600 }),
      ] };
    }
    const oversized = await seedOrder(context, base, "oversized", [base.lines[1]], { count: 1001 });
    volume.oversizedOrderId = oversized.id;
    volume.oversized = { itemIds: oversized.itemIds, itemCount: oversized.itemCount, reference: oversized.reference };
  }
  return { ...base, noteOrderId: note.id, noteItemId: note.itemIds[0], quantityOrderId: quantity.id,
    quantityItemId: quantity.itemIds[0], unitColumnPresent: !options.legacy, noteItemBefore,
    legacyOrigin: options.legacy ? "synthetic restoration of a pre-unit row; named normalizer enabled and RLS enabled before commit" : null, ...volume };
}

async function preparationFixture(context: CalcV3FixtureContext) {
  const scenarios: Record<string, unknown> = {};
  for (const key of ["stale-quantity", "stale-cost", "sent", "confirmed", "received", "canceled", "valid", "same-intent", "different-intents", "ui-recovery"]) {
    const base = await purchaseBase(context, prefix(`PURCHASE-${key}`), [
      { label: "A", quantity: 2, price: 1200, ht: 2400, tax: 480, ttc: 2880 },
      { label: "B", quantity: 3, price: 777, ht: 2331, tax: 466, ttc: 2797 },
    ], true);
    const sourceOrderIds: string[] = [];
    if (["sent", "confirmed", "received", "canceled"].includes(key)) {
      for (const line of base.lines) sourceOrderIds.push((await seedOrder(context, base, line.label, [line],
        { linked: true, status: key as "sent" | "confirmed" | "received" | "canceled" })).id);
    }
    scenarios[key] = { ...base, sourceOrderIds, lines: base.lines.map((line, index) => ({ ...line,
      unitPriceCents: line.price, cataloguePriceCents: index === 0 ? 1800 : 999 })) };
  }
  return { status: "ready", apiUrl: context.backend, tenantId: context.owner.tenantId, userId: context.owner.userId, scenarios };
}

async function documentsFixture(context: CalcV3FixtureContext, kind: "brief" | "source" | "source-read") {
  const name = prefix(kind === "brief" ? "BRIEF" : "REFERENCE");
  const project = projectPlan(context, name), uploadId = randomUUID();
  const files: Array<{ id: string; revision: string; fileName: string; bytes: Uint8Array; mimeType: string }> = [];
  for (const revision of kind === "brief" ? ["A"] : ["A", "B"]) {
    const fileName = kind === "brief" ? "ARMY-CCTP-reference.txt" : "ARMY-reference.pdf";
    let bytes: Uint8Array;
    if (kind === "brief") bytes = Buffer.from("ARMY fictional CCTP. Supportage associe au document.\n");
    else {
      const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
      for (let page = 1; page <= 3; page++) pdf.addPage().drawText(`ARMY fictional source ${revision}, page ${page}`, { font, x: 40, y: 750, size: 16 });
      bytes = await pdf.save();
    }
    files.push({ id: randomUUID(), revision, fileName, bytes, mimeType: kind === "brief" ? "text/plain" : "application/pdf" });
  }
  const records = [...project.records, record("affaire_intake_uploads", { ...common(context), id: uploadId,
    project_id: project.projectId, created_by: context.owner.userId, status: "ready", completed_at: new Date().toISOString() })];
  for (const file of files) {
    // These fictional names already satisfy the intake path contract. Keep the
    // supervisor independent of application modules edited during a dev loop.
    if (!/^[A-Za-z0-9_-]+\.(?:pdf|txt)$/.test(file.fileName)) throw new Error("Owned document filename differs from the fixture contract.");
    const storagePath = [context.owner.tenantId, project.projectId, uploadId, file.id, file.fileName].join("/");
    const extractedMetadata: AffaireIntakeExtractedMetadata = {
      projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [],
    };
    await checked(`${name}:storage`, context.admin.storage.from("affaire-intake").upload(storagePath, file.bytes, { contentType: file.mimeType, upsert: false }));
    records.push(record("affaire_intake_documents", { ...common(context), id: file.id, project_id: project.projectId,
      upload_id: uploadId, created_by: context.owner.userId, storage_path: storagePath, file_name: file.fileName,
      mime_type: file.mimeType, size_bytes: file.bytes.length, upload_status: "uploaded", classification_status: "classified",
      document_kind: "cctp", confidence: 1, classification_source: "manual", classified_by: context.owner.userId,
      classified_at: new Date().toISOString(), extracted_metadata: extractedMetadata }));
  }
  if (kind === "brief") {
    const briefId = randomUUID();
    records.push(record("affaire_briefs", { ...common(context), id: briefId, project_id: project.projectId,
      upload_id: uploadId, created_by: context.owner.userId, updated_by: context.owner.userId, confirmed_by: context.owner.userId,
      status: "confirme", summary: "ARMY brief synthétique", project_object: "ARMY travaux fictifs",
      scope: ["ARMY calorifuge sans justificatif", "ARMY supportage associé au document"],
      missing_elements: ["Plans manquants"], confirmed_at: new Date().toISOString() }));
    records.push(record("affaire_brief_source_links", { ...common(context), id: randomUUID(), project_id: project.projectId,
      brief_id: briefId, source_document_id: files[0].id, created_by: context.owner.userId,
      block_key: "scope", entry_index: 1, source_file_name: files[0].fileName }));
  }
  await executePlan(context, name, records);
  const directory = path.join(context.directory, `${kind}-corpus`);
  await mkdir(path.join(directory, "fixtures"), { recursive: true });
  const documents = [];
  for (const file of files) {
    const relative = `fixtures/${file.revision}.${kind === "brief" ? "txt" : "pdf"}`;
    await writeFile(path.join(directory, relative), file.bytes, { flag: "wx" });
    documents.push({ revision: file.revision, path: relative, fileName: file.fileName,
      sha256: createHash("sha256").update(file.bytes).digest("hex"), byteSize: file.bytes.length, pageCount: kind === "brief" ? 0 : 3 });
  }
  const manifest = JSON.stringify({ documents }, null, 2) + "\n";
  await writeFile(path.join(directory, "fixtures/manifest.json"), manifest, { flag: "wx" });
  return { status: "ready", schemaVersion: "source-reference-http-fixture-1", prefix: name,
    apiUrl: context.backend, tenantId: context.owner.tenantId, ownerId: context.owner.userId,
    projectId: project.projectId, versionId: project.versionId, documents: { A: files[0].id, B: files[1]?.id },
    corpusManifestSha256: createHash("sha256").update(manifest).digest("hex"), directory };
}

export async function prepareBusinessJourneyFixtures(context: CalcV3FixtureContext, options: { files?: readonly string[] } = {}) {
  // Reuse the exact native owner/loopback validator even when only a storage seed is selected.
  sqlTransport(context);
  const selected = new Set((options.files ?? [...BUSINESS_JOURNEY_FILES, "business-lifecycle.e2e.ts"]).map((file) => path.basename(file)));
  const env: Record<string, string> = {}, secretEnv: Record<string, string> = {}, identities: Record<string, unknown> = {};
  async function publish(name: string, variable: string, value: unknown) {
    env[variable] = await writeFixture(context, name, value); identities[name] = value;
  }
  if (selected.has("article-association.e2e.ts") || selected.has("reference-price.e2e.ts")) {
    const products = [{ id: randomUUID(), reference: "ARMY-CUIVRE", designation: `${prefix("ARTICLE")} cuivre`, unit: "m", unit_price_cents: 1234 },
      { id: randomUUID(), reference: "ARMY-ACIER", designation: `${prefix("ARTICLE")} acier`, unit: "u", unit_price_cents: 2500 }];
    await executePlan(context, "article prerequisites", products.map((product) => record("products", { ...common(context), ...product, is_active: true })));
    await publish("business-article", "E2E_LOCAL_ARTICLE_FIXTURE_PATH", { apiUrl: context.backend, userId: context.owner.userId, products });
  }
  if (selected.has("catalogue-provenance.e2e.ts")) {
    const foreign = await createActor(context, "business", "foreign-provenance");
    const fixture: Record<string, unknown> = { status: "ready", apiUrl: context.backend, userId: context.owner.userId,
      tenantId: context.owner.tenantId, otherTenantId: foreign.tenantId };
    const records: PlanRecord[] = [];
    for (const label of ["A1", "A2", "B1"]) {
      const owner = label === "B1" ? foreign : context.owner;
      const importId = randomUUID(), rawId = randomUUID(), rowId = randomUUID();
      fixture[`import${label}`] = importId; fixture[`row${label}`] = rowId;
      records.push(record("dpgf_imports", { id: importId, tenant_id: owner.tenantId, user_id: owner.userId,
        filename: `ARMY-${label}.csv`, source_format: "csv", parse_mode: "server", status: "completed", row_count: 1 }));
      records.push(record("dpgf_rows_raw", { id: rawId, tenant_id: owner.tenantId, import_id: importId, row_index: 0, payload: { designation: `ARMY ${label}` } }));
      records.push(record("dpgf_rows_mapped", { id: rowId, tenant_id: owner.tenantId, import_id: importId, raw_row_id: rawId, status: "mapped", payload: { designation: `ARMY ${label}` } }));
    }
    await executePlan(context, "catalogue provenance", records);
    await publish("business-catalogue-provenance", "E2E_CATALOGUE_PROVENANCE_FIXTURE_PATH", fixture);
  }
  if (selected.has("brief-evidence.e2e.ts")) {
    const fixture = await documentsFixture(context, "brief");
    env.E2E_BRIEF_EVIDENCE_PROJECT_ID = fixture.projectId; env.E2E_BRIEF_EVIDENCE_DOCUMENT_ID = fixture.documents.A;
    identities.brief = fixture;
  }
  if (selected.has("source-reference.e2e.ts")) {
    identities.sourceReferenceBucket = await ensureSourceReferenceBucket(context);
  }
  for (const [file, kind, variable] of [
    ["source-reference.e2e.ts", "source", "E2E_SOURCE_REFERENCE_FIXTURE_PATH"],
    ["source-reference-read.e2e.ts", "source-read", "E2E_SOURCE_REFERENCE_READ_FIXTURE_PATH"],
  ] as const) if (selected.has(file)) {
    const fixture = await documentsFixture(context, kind);
    await publish(`business-${kind}`, variable, fixture);
    if (kind === "source") env.E2E_SOURCE_REFERENCE_CORPUS_DIRECTORY = fixture.directory;
  }
  if (selected.has("purchase-draft-eligibility.e2e.ts")) {
    const base = await purchaseBase(context, prefix("PURCHASE-eligibility"), [decimalValues[0]]);
    await checked("eligibility catalogue cost", context.admin.from("supplier_pricebook").update({ unit_price_cents: 1800 })
      .eq("id", base.lines[0].priceId).eq("tenant_id", context.owner.tenantId).select("id").single());
    await publish("business-eligibility", "E2E_PURCHASE_DRAFT_FIXTURE_PATH", { ...base, lineId: base.lines[0].lineId, priceId: base.lines[0].priceId });
  }
  if (selected.has("purchase-preparation.e2e.ts")) await publish("business-preparation", "E2E_PURCHASE_PREPARATION_FIXTURE_PATH", await preparationFixture(context));
  if (selected.has("purchase-decimals.e2e.ts")) {
    await publish("business-decimals", "E2E_PURCHASE_DECIMALS_FIXTURE_PATH", await decimalFixture(context, "current", { volume: true }));
    await publish("business-decimals-legacy", "E2E_PURCHASE_DECIMALS_LEGACY_FIXTURE_PATH", await decimalFixture(context, "legacy", { legacy: true }));
  }
  if (selected.has("purchase-readiness.e2e.ts")) {
    await publish("business-readiness", "E2E_PURCHASE_READINESS_FIXTURE_PATH", await decimalFixture(context, "readiness"));
    await publish("business-readiness-failure", "E2E_PURCHASE_READINESS_FAILURE_FIXTURE_PATH", await decimalFixture(context, "readiness-failure"));
  }
  if (selected.has("business-lifecycle.e2e.ts")) {
    const engineer = await createActor(context, "business-lifecycle", "engineer");
    const director = await createActor(context, "business-lifecycle", "director");
    const observer = await createActor(context, "business-lifecycle", "revoked-engineer");
    const actors = { engineer, director, observer };
    for (const [label, actor] of Object.entries(actors)) {
      secretEnv[`E2E_BUSINESS_${label.toUpperCase()}_EMAIL`] = actor.email;
      secretEnv[`E2E_BUSINESS_${label.toUpperCase()}_PASSWORD`] = actor.password;
      // No notification address: this journey proves in-app review, not email delivery.
      await checked(`business ${label} profile`, context.admin.from("profiles").update({ full_name: `ARMY business ${label}`, work_email: null })
        .eq("id", actor.userId).select("id").single());
    }
    for (const [actor, role] of [[director, "director"], [observer, "engineer"]] as const) {
      const membership = await checked("business shared membership", context.admin.from("tenant_memberships")
        .insert({ tenant_id: engineer.tenantId, user_id: actor.userId, role: "admin", is_default: false }).select("id").single());
      const ordinary = createClient(context.backend, context.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
      try {
        const auth = await ordinary.auth.signInWithPassword({ email: actor.email, password: actor.password });
        if (auth.error || auth.data.user?.id !== actor.userId) throw new Error("Business actor login failed.");
        await checked("business active tenant", ordinary.rpc("set_active_tenant_membership_default", { p_membership_id: membership.id }));
      } finally { await ordinary.auth.signOut({ scope: "local" }); }
      // The ordinary tenant-switch RPC requires an admin target. Provisioning
      // ends with the intended role; no test ever receives the temporary role.
      const finalMembership = await checked(`business ${role} final membership`, context.admin.from("tenant_memberships")
        .update({ role }).eq("id", membership.id).eq("user_id", actor.userId).eq("tenant_id", engineer.tenantId)
        .select("id,tenant_id,role,is_default").single());
      if (finalMembership.id !== membership.id || finalMembership.tenant_id !== engineer.tenantId ||
          finalMembership.role !== role || !finalMembership.is_default) throw new Error("Business actor final active role differs.");
      actor.membershipId = finalMembership.id;
      actor.tenantId = finalMembership.tenant_id;
    }
    const engineerMembership = await checked("business engineer role", context.admin.from("tenant_memberships").update({ role: "engineer" })
      .eq("id", engineer.membershipId).eq("user_id", engineer.userId).eq("tenant_id", engineer.tenantId)
      .select("id,tenant_id,role,is_default").single());
    if (engineerMembership.id !== engineer.membershipId || engineerMembership.role !== "engineer" ||
        engineerMembership.tenant_id !== engineer.tenantId || !engineerMembership.is_default) throw new Error("Business requester final active role differs.");
    const ownedContext = { ...context, owner: { ...context.owner, userId: engineer.userId, tenantId: engineer.tenantId } };
    const approval = await purchaseBase(ownedContext, prefix("APPROVAL"), [decimalValues[0]]);
    const ruleId = randomUUID();
    await executePlan(ownedContext, "business approval rule", [record("estimate_rules", {
      ...common(ownedContext), id: ruleId, rule_type: "require_approval", scope_type: "client", scope_id: approval.projectId,
      threshold_value: 1000, action: "require_approval", is_active: true,
    })]);
    // Access witness belongs to the observer so it is readable before revocation,
    // and its estimate is independent from the review/correction journey.
    const access = await purchaseBase({ ...ownedContext, owner: { ...ownedContext.owner, userId: observer.userId } }, prefix("REVOKED"), [decimalValues[0]]);
    const purchase = await purchaseBase(context, prefix("LIFECYCLE"), [decimalValues[0]]);
    await publish("business-lifecycle", "E2E_BUSINESS_LIFECYCLE_FIXTURE_PATH", {
      status: "ready", apiUrl: context.backend, approval: { ...approval, ruleId }, access, purchase,
      actors: Object.fromEntries(Object.entries(actors).map(([label, actor]) => [label,
        { userId: actor.userId, tenantId: actor.tenantId, membershipId: actor.membershipId }])),
    });
  }
  return { env, secretEnv, identities };
}
