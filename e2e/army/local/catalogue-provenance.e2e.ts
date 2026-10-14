import { readFile } from "node:fs/promises";

import { expect } from "e2e";

import type { ReferencePriceResponse } from "../../../src/lib/catalogue/reference-price-schemas";
import { apiRequest, armyTest, recordEvidence, type ArmyState } from "../critical/fixtures";

type Browser = Parameters<typeof apiRequest>[0];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type HttpFixture = {
  apiUrl: string;
  userId: string;
  tenantId: string;
  otherTenantId: string;
  importA1: string;
  importA2: string;
  importB1: string;
  rowA1: string;
  rowA2: string;
  rowB1: string;
};
type SourcePair = { source_import_id: string | null; source_mapped_row_id: string | null };
type Price = SourcePair & {
  id: string;
  tenant_id: string;
  unit_price_cents: number;
  updated_at: string;
  [key: string]: unknown;
};

// Failure plan: docs/testing/catalogue-provenance-e2e.md. No direct DB client.
async function localFixture(): Promise<HttpFixture> {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" || backend.username || backend.password) {
    throw new Error("Catalogue provenance requires the isolated loopback Supabase.");
  }
  const raw = JSON.parse(await readFile(".e2e/catalogue-provenance/http-fixture.json", "utf8")) as HttpFixture & { status: string };
  expect(raw.status).toBe("ready");
  const fixture: HttpFixture = {
    apiUrl: raw.apiUrl, userId: raw.userId, tenantId: raw.tenantId, otherTenantId: raw.otherTenantId,
    importA1: raw.importA1, importA2: raw.importA2, importB1: raw.importB1,
    rowA1: raw.rowA1, rowA2: raw.rowA2, rowB1: raw.rowB1,
  };
  expect(fixture.apiUrl).toBe(backend.origin);
  for (const key of ["userId", "tenantId", "otherTenantId", "importA1", "importA2", "importB1", "rowA1", "rowA2", "rowB1"] as const) {
    expect(fixture[key], `Fixture ${key} must be an explicit UUID`).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }
  expect(fixture.tenantId).not.toBe(fixture.otherTenantId);
  expect(new Set([fixture.importA1, fixture.importA2, fixture.importB1]).size).toBe(3);
  expect(new Set([fixture.rowA1, fixture.rowA2, fixture.rowB1]).size).toBe(3);
  return fixture;
}

async function readOffers(browser: Browser, productId: string): Promise<Price[]> {
  const response = await apiRequest<Envelope<{ items: Price[] }>>(browser, "GET", `/api/prices?product_id=${productId}`);
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  return response.body.data.items.sort((left, right) => left.id.localeCompare(right.id));
}

async function readProposal(browser: Browser, productId: string) {
  const response = await apiRequest<Envelope<ReferencePriceResponse>>(browser, "GET",
    `/api/catalogue/reference-price?product_id=${productId}&quantity=100&transport_mode=excluded`);
  expect(response.status).toBe(200);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

function referenceState(data: ReferencePriceResponse) {
  return {
    productId: data.proposal.product_id,
    cents: data.proposal.current_price_cents,
    validationId: data.proposal.validation_id,
    productUpdatedAt: data.proposal.product_updated_at,
    latestValidation: data.latest_validation,
  };
}

function sourcePair(offer: Price): SourcePair {
  return { source_import_id: offer.source_import_id, source_mapped_row_id: offer.source_mapped_row_id };
}

function withoutUpdateTimestamp(offer: Price) {
  return Object.fromEntries(Object.entries(offer).filter(([key]) => key !== "updated_at"));
}

async function createPrice(
  browser: Browser,
  army: ArmyState,
  owner: { productId: string; supplierId: string },
  index: number,
  sources: SourcePair = { source_import_id: null, source_mapped_row_id: null },
) {
  const result = await apiRequest<Envelope<{ item: Price }>>(browser, "POST", "/api/prices", {
    action: "create",
    item: {
      product_id: owner.productId, supplier_id: owner.supplierId,
      supplier_sku: `${army.runPrefix}-provenance`, unit: "m", currency: "EUR",
      min_quantity: index + 1, unit_price_cents: 1000 + index,
      notes: `${army.runPrefix} owned source fixture ${index}`, ...sources,
    },
  });
  expect(result.status).toBe(201);
  expect(result.body.ok).toBe(true);
  await recordEvidence(army, `provenance-offer-${index}`, { ...owner, price: result.body.data.item });
  return result.body.data.item;
}

async function createCampaign(browser: Browser, army: ArmyState, fixture: HttpFixture) {
  const product = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/products", {
    action: "create", item: { designation: `${army.runPrefix} provenance tube`, unit: "m", unit_price_cents: 777 },
  });
  expect(product.status).toBe(201);
  const productId = product.body.data.item.id;
  await recordEvidence(army, "provenance-product", { productId, fixture });
  const supplier = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
    action: "create", item: { name: `${army.runPrefix} provenance supplier` },
  });
  expect(supplier.status).toBe(201);
  const supplierId = supplier.body.data.item.id;
  const owner = { productId, supplierId };
  const createdWitness = await createPrice(browser, army, owner, 0);
  // POST enriches the created item with catalogue fields that GET omits.
  // Compare unchanged offers through the same complete GET projection.
  const witness = (await readOffers(browser, productId)).find((offer) => offer.id === createdWitness.id);
  if (!witness) throw new Error("The created witness offer must be present in the ordinary price list.");
  expect(witness.tenant_id).toBe(fixture.tenantId);
  const proposal = await readProposal(browser, productId);
  const validation = await apiRequest(browser, "POST", "/api/catalogue/reference-price", {
    action: "validate", product_id: productId, quantity: 100, transport_mode: "excluded",
    fingerprint: proposal.proposal.fingerprint, manual_price_cents: 777,
    justification: `${army.runPrefix} explicit reference for provenance integrity`,
  });
  expect(validation.status).toBe(200);
  const reference = referenceState(await readProposal(browser, productId));
  expect(reference.cents).toBe(777);
  expect(reference.latestValidation).toMatchObject({ mode: "manual", unit_price_cents: 777, validated_by: fixture.userId });
  await recordEvidence(army, "provenance-reference-validated", { ...owner, witnessId: witness.id, reference, validation });
  return { ...owner, reference, witness };
}

armyTest("local catalogue provenance rejects six invalid final source pairs without changing a validated reference", {
  session: "army", trace: "off", timeout: 240_000,
}, async ({ app, browser, army }) => {
  const fixture = await localFixture();
  await app.open("/dashboard/products");
  const owner = await createCampaign(browser, army, fixture);
  const empty: SourcePair = { source_import_id: null, source_mapped_row_id: null };
  const pairA1: SourcePair = { source_import_id: fixture.importA1, source_mapped_row_id: fixture.rowA1 };
  const cases: Array<{ name: string; initial: SourcePair; patch: Partial<SourcePair> }> = [
    { name: "foreign-import", initial: empty, patch: { source_import_id: fixture.importB1 } },
    { name: "foreign-row", initial: empty, patch: { source_mapped_row_id: fixture.rowB1 } },
    { name: "foreign-pair", initial: empty, patch: { source_import_id: fixture.importB1, source_mapped_row_id: fixture.rowB1 } },
    { name: "mismatched-own-pair", initial: empty, patch: { source_import_id: fixture.importA1, source_mapped_row_id: fixture.rowA2 } },
    { name: "partial-import", initial: pairA1, patch: { source_import_id: fixture.importA2 } },
    { name: "partial-row", initial: pairA1, patch: { source_mapped_row_id: fixture.rowA2 } },
  ];
  for (const [index, candidate] of cases.entries()) {
    const subject = await createPrice(browser, army, owner, index + 1, candidate.initial);
    expect(subject.tenant_id).toBe(fixture.tenantId);
    expect(sourcePair(subject)).toEqual(candidate.initial);
    const before = await readOffers(browser, owner.productId);
    const response = await apiRequest(browser, "POST", "/api/prices", { action: "update", id: subject.id, item: candidate.patch });
    const after = await readOffers(browser, owner.productId);
    const afterReference = referenceState(await readProposal(browser, owner.productId));
    await recordEvidence(army, `provenance-reject-${candidate.name}`, {
      subjectId: subject.id, patch: candidate.patch, expectedStatus: 400,
      response, before, after, expectedReference: owner.reference, afterReference,
    });

    const beforeSubject = before.find((offer) => offer.id === subject.id)!;
    const afterSubject = after.find((offer) => offer.id === subject.id)!;
    // Preserve the counterexample first, then repair only this owned fixture's
    // source IDs so the next migration can validate all local rows.
    if (JSON.stringify(sourcePair(afterSubject)) !== JSON.stringify(sourcePair(beforeSubject))) {
      const restoredResponse = await apiRequest(browser, "POST", "/api/prices", {
        action: "update", id: subject.id, item: sourcePair(beforeSubject),
      });
      const restoredOffers = await readOffers(browser, owner.productId);
      const restored = restoredOffers.find((offer) => offer.id === subject.id)!;
      await recordEvidence(army, `provenance-restored-${candidate.name}`, {
        subjectId: subject.id, restoredResponse, expected: sourcePair(beforeSubject), actual: restored,
      });
      expect(restoredResponse.status, "Owned invalid fixture must be restored before continuing").toBe(200);
      expect(withoutUpdateTimestamp(restored)).toEqual(withoutUpdateTimestamp(beforeSubject));
    }

    expect.soft(response.status, `${candidate.name} must reject the invalid final pair`).toBe(400);
    expect.soft(after, `${candidate.name} must not mutate any offer`).toEqual(before);
    expect.soft(afterReference, `${candidate.name} must preserve the validated reference`).toEqual(owner.reference);
    expect.soft(after.find((offer) => offer.id === owner.witness.id)).toEqual(owner.witness);
  }
});

armyTest("local catalogue provenance preserves valid partial sources omissions and explicit clearing", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, browser, army }) => {
  const fixture = await localFixture();
  await app.open("/dashboard/products");
  const owner = await createCampaign(browser, army, fixture);
  const subject = await createPrice(browser, army, owner, 1);
  const pairA1: SourcePair = { source_import_id: fixture.importA1, source_mapped_row_id: fixture.rowA1 };
  const cases: Array<{ name: string; patch: Partial<SourcePair> & { notes?: string }; expected: SourcePair }> = [
    { name: "valid-pair", patch: pairA1, expected: pairA1 },
    { name: "omitted-sources", patch: { notes: `${army.runPrefix} keep both source IDs` }, expected: pairA1 },
    { name: "import-only", patch: { source_mapped_row_id: null }, expected: { source_import_id: fixture.importA1, source_mapped_row_id: null } },
    { name: "row-only", patch: { source_import_id: null, source_mapped_row_id: fixture.rowA2 }, expected: { source_import_id: null, source_mapped_row_id: fixture.rowA2 } },
    { name: "clear-both", patch: { source_import_id: null, source_mapped_row_id: null }, expected: { source_import_id: null, source_mapped_row_id: null } },
  ];
  for (const candidate of cases) {
    const before = await readOffers(browser, owner.productId);
    const response = await apiRequest(browser, "POST", "/api/prices", { action: "update", id: subject.id, item: candidate.patch });
    const after = await readOffers(browser, owner.productId);
    const actual = after.find((offer) => offer.id === subject.id)!;
    const reference = referenceState(await readProposal(browser, owner.productId));
    await recordEvidence(army, `provenance-accept-${candidate.name}`, {
      subjectId: subject.id, patch: candidate.patch, expected: candidate.expected,
      response, before, after, reference,
    });
    expect(response.status).toBe(200);
    expect(sourcePair(actual)).toEqual(candidate.expected);
    if (candidate.patch.notes !== undefined) expect(actual.notes).toBe(candidate.patch.notes);
    expect(actual.unit_price_cents).toBe(subject.unit_price_cents);
    expect(actual.tenant_id).toBe(fixture.tenantId);
    expect(after.filter((offer) => offer.id !== subject.id)).toEqual(before.filter((offer) => offer.id !== subject.id));
    expect(reference).toEqual(owner.reference);
    expect(after.find((offer) => offer.id === owner.witness.id)).toEqual(owner.witness);
  }
});
