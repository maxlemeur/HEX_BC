import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildCanonicalEstimateSealPayload,
  computeEstimateSealHash,
} from "@/lib/estimates/estimate-seal";

// PRECODE: synthetic contract fixtures only. No DB/auth/server.ts/PDF/provider.
// Review api-contract.md and the exact schema BEFORE creating the future module.
const ROOT = process.cwd();
const VECTORS = path.resolve(ROOT, "src/test/fixtures/offer-contract-legacy-vectors.json");
const FUTURE_MODULE = path.resolve(ROOT, "src/lib/estimates/offer-contract.ts");
const ID = {
  version: "44444444-4444-4444-8444-444444444444",
  tenant: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  actor: "11111111-1111-4111-8111-111111111111",
  owner: "99999999-9999-4999-8999-999999999999",
  document: "55555555-5555-4555-8555-555555555555",
  claim: "66666666-6666-4666-8666-666666666666",
  dispatch: "77777777-7777-4777-8777-777777777777",
  section: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  child: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  rootA: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  rootB: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};
const CALCULATION_HASH = "c".repeat(64);
const PDF_HASH = "a".repeat(64);
const MAX_CENTS = 2_147_483_647;

type JsonObject = Record<string, unknown>;
type Options = { allowDevelopmentTerms?: boolean };
type PureAPI = {
  parseClientContractSnapshot: (value: unknown) => JsonObject;
  parseOfferDocumentProof: (value: unknown, options?: Options) => JsonObject;
  computeOfferSealHash: (input: {
    calculationHash: string; snapshot: unknown; documentProof: unknown;
  }, options?: Options) => string;
};
let api: PureAPI;
const copy = <T,>(value: T): T => structuredClone(value);

function setAt(value: unknown, dottedPath: string, replacement: unknown): void {
  const segments = dottedPath.split(".");
  let target = value as JsonObject;
  for (const segment of segments.slice(0, -1)) target = target[segment] as JsonObject;
  target[segments.at(-1)!] = replacement;
}
function removeAt(value: unknown, dottedPath: string): void {
  const segments = dottedPath.split(".");
  let target = value as JsonObject;
  for (const segment of segments.slice(0, -1)) target = target[segment] as JsonObject;
  delete target[segments.at(-1)!];
}
function expectInvalid(fn: () => unknown, code: string): void {
  let failure: unknown;
  try { fn(); } catch (error) { failure = error; }
  expect(failure, "corrupt input must throw, never normalize/fallback").toBeInstanceOf(Error);
  expect((failure as Error & { code?: string }).code).toBe(code);
}

function snapshot() {
  return {
    schemaVersion: 1,
    version: {
      id: ID.version, tenantId: ID.tenant, projectId: ID.project, number: 2,
      contentRevision: 7, calcEngineVersion: 2, dateDevis: "2026-10-13", validiteJours: 45,
      currency: "EUR", contractorRole: "principal", taxRateBp: 2000,
    },
    project: {
      name: "ARMY captured project A", reference: "ARMY-REF-A",
      estimateReference: "ARMY-EST-A_V2", clientName: "ARMY client A", siteAddress: "ARMY site A",
    },
    issuer: {
      userId: ID.actor, displayName: "ARMY actor A", displayRole: "Engineer",
      phone: "+33 1 00 00 00 01", email: "army-actor@example.invalid",
    },
    company: {
      name: "ARMY COMPANY A", tagline: "Synthetic test company",
      address: { street: "ARMY street A", postalCode: "75001", city: "Paris" },
      registeredOffice: { street: "ARMY office A", postalCode: "75002", city: "Paris" },
      phone: { landline: "+33 1 00 00 00 02", mobile: "+33 6 00 00 00 03" },
      legal: { siret: "ARMY-FIXTURE-A", vat: "ARMY-VAT-A" },
    },
    rows: [
      { kind: "section", id: ID.section, parentId: null as string | null, position: 0, depth: 0,
        number: "01", title: "ARMY section", saleHtCents: 10_000 },
      { kind: "line", id: ID.child, parentId: ID.section, position: 0, depth: 1,
        title: "ARMY child", quantity: 2, unit: "u", unitSaleHtCents: 5000, saleHtCents: 10_000 },
      { kind: "line", id: ID.rootA, parentId: null, position: 1, depth: 0,
        title: "ARMY root A", quantity: 3, unit: "m", unitSaleHtCents: 1000, saleHtCents: 3000 },
      { kind: "line", id: ID.rootB, parentId: null, position: 2, depth: 0,
        title: "ARMY root B", quantity: 2, unit: "m", unitSaleHtCents: 1000, saleHtCents: 2000 },
    ],
    totals: { saleHtCents: 15_000, taxCents: 3000, calculatedTtcCents: 18_000,
      payableTtcCents: 18_000, roundingAdjustmentCents: 0 },
    exclusions: "Synthetic limits A\n\nSecond paragraph — no real terms approval.",
  };
}
function layout(priceMode = "unit_and_total") {
  return {
    preset: "client_detailed", detailLevel: "lines", priceMode, density: "standard",
    showNumbering: true, showSectionSubtotals: true, conditionsPlacement: "auto", includeTerms: true,
  };
}
function terms() {
  return {
    templateId: "88888888-8888-4888-8888-888888888888", title: "Synthetic CGV fixture",
    body: "TEST FIXTURE ONLY. No genuine legal review or production CGV approval.\n\nSecond clause.",
    version: 1, legalReviewedAt: "2026-10-01T12:00:00.000Z", capturedAt: "2026-10-13T12:00:00.000Z",
  };
}
function proof(captured = snapshot()) {
  return {
    proofVersion: 1, documentId: ID.document, tenantId: ID.tenant, versionId: ID.version,
    projectId: ID.project, status: "ready",
    filePath: `${ID.tenant}/${ID.project}/${ID.version}/${PDF_HASH}.pdf`, sha256Hash: PDF_HASH,
    fileSizeBytes: 1234, generatedAt: "2026-10-13T12:00:00.123456Z", generatedBy: ID.actor,
    publishedGenerationToken: ID.claim, publishedPurpose: "email", publishedDispatchId: ID.dispatch,
    publishedContentRevision: 7, clientContractVersion: 1, clientContractSnapshot: copy(captured),
    layoutOptions: layout(), termsSnapshot: terms(),
  };
}
function legacyProof(): JsonObject {
  return {
    ...proof(), filePath: `${ID.tenant}/${ID.project}/HEX_ARMY_ORIGINAL_V2.pdf`,
    fileSizeBytes: null, generatedAt: null, generatedBy: null, publishedGenerationToken: null,
    publishedPurpose: "legacy", publishedDispatchId: null,
    clientContractVersion: null, clientContractSnapshot: null,
  };
}
function withFoMo(value = snapshot()) {
  const result = copy(value);
  result.rows.forEach((row) => {
    Object.assign(row, { foSaleHtCents: row.saleHtCents * 0.8, moSaleHtCents: row.saleHtCents * 0.2 });
  });
  return result;
}
function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseObjectKeys(child)]));
  }
  return value;
}
function canonicalOracle(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalOracle);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonicalOracle(child)]));
  }
  return value;
}
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

type FrozenVector = {
  id: string;
  input: Parameters<typeof buildCanonicalEstimateSealPayload>[0];
  options: Parameters<typeof buildCanonicalEstimateSealPayload>[1] | null;
  payloadJson: string; payloadUtf8Bytes: number; sha256: string;
};
const frozen = JSON.parse(readFileSync(VECTORS, "utf8")) as { status: string; vectors: FrozenVector[] };
if (frozen.status !== "executed-pure-builder-preimage" || frozen.vectors.length !== 38) {
  throw new Error("MISSING_PRECONDITION: complete frozen 38-vector preimage required.");
}
describe("C8 actual legacy builders preserve frozen serializer bytes", () => {
  it.each(frozen.vectors)("$id", (vector) => {
    const payload = buildCanonicalEstimateSealPayload(vector.input, vector.options ?? undefined);
    const bytes = JSON.stringify(payload);
    expect(bytes).toBe(vector.payloadJson);
    expect(Buffer.byteLength(bytes, "utf8")).toBe(vector.payloadUtf8Bytes);
    expect(computeEstimateSealHash(payload)).toBe(vector.sha256);
    expect(sha(bytes)).toBe(vector.sha256);
  });
});

describe("new Client1/Proof1/Seal5 precode contracts", () => {
  beforeAll(async () => {
    if (!existsSync(FUTURE_MODULE)) {
      throw new Error("MISSING_PRECONDITION: future offer-contract.ts absent; prepared tests are not exploit REDs.");
    }
    // Dynamic variable: C8 collection/runs remain independent of absent future module.
    api = await import(/* @vite-ignore */ FUTURE_MODULE) as PureAPI;
    expect(typeof api.parseClientContractSnapshot).toBe("function");
    expect(typeof api.parseOfferDocumentProof).toBe("function");
    expect(typeof api.computeOfferSealHash).toBe("function");
  });

  describe("C1 strict snapshot integrity", () => {
    const badValues: Array<[string, string, unknown]> = [
      ["future schema", "schemaVersion", 2], ["coerced schema", "schemaVersion", "1"],
      ["unsafe revision", "version.contentRevision", Number.MAX_SAFE_INTEGER + 1],
      ["missing revision sentinel", "version.contentRevision", 0],
      ["unknown engine", "version.calcEngineVersion", 3], ["invalid calendar", "version.dateDevis", "2026-02-30"],
      ["timestamp instead of date", "version.dateDevis", "2026-10-13T12:00:00Z"],
      ["unsupported currency", "version.currency", "CHF"], ["coerced cents", "rows.1.saleHtCents", "10000"],
      ["fractional cents", "rows.1.saleHtCents", 10000.5], ["overflow cents", "rows.1.saleHtCents", MAX_CENTS + 1],
      ["negative cents", "rows.1.saleHtCents", -1], ["NaN cents", "rows.1.saleHtCents", NaN],
      ["infinite cents", "rows.1.saleHtCents", Infinity], ["negative zero cents", "rows.1.unitSaleHtCents", -0],
      ["negative quantity", "rows.1.quantity", -1], ["infinite quantity", "rows.1.quantity", Infinity],
      ["negative zero quantity", "rows.1.quantity", -0], ["null quantity", "rows.1.quantity", null],
      ["blank company", "company.name", " "], ["blank optional identity", "project.clientName", ""],
      ["NUL legal field", "company.legal.siret", "A\u0000B"],
      ["unpaired surrogate", "issuer.displayName", "A\ud800B"],
      ["fractional position", "rows.1.position", 0.5], ["wrong depth", "rows.1.depth", 0],
      ["orphan", "rows.1.parentId", ID.owner], ["parent is line", "rows.1.parentId", ID.rootA],
      ["duplicate id", "rows.3.id", ID.rootA], ["unknown row kind", "rows.1.kind", "article"],
      ["self section cycle", "rows.0.parentId", ID.section],
    ];
    it.each(badValues)("rejects %s", (_name, target, value) => {
      const changed = snapshot(); setAt(changed, target, value);
      expectInvalid(() => api.parseClientContractSnapshot(changed), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it.each(["company.legal.vat", "issuer.userId", "version.contentRevision", "rows.1.unitSaleHtCents", "project.siteAddress", "totals.roundingAdjustmentCents"])(
      "rejects missing required %s", (target) => {
        const changed = snapshot(); removeAt(changed, target);
        expectInvalid(() => api.parseClientContractSnapshot(changed), "OFFER_CLIENT_CONTRACT_INVALID");
      },
    );
    it.each([
      "rows.1.unit_price_ht_cents", "rows.1.h_mo", "rows.1.labor_role_id", "rows.1.selected_supplier_price_id",
      "rows.1.source_metadata", "totals.costSubtotalCents", "version.margin_multiplier", "version.calc_snapshot_context",
      "issuer.ownerId", "company.legal.extra", "company.address.extra", "portalToken", "project.currentProfile",
    ])("rejects unknown/private key %s", (target) => {
      const changed = snapshot(); setAt(changed, target, "forbidden-private-field");
      expectInvalid(() => api.parseClientContractSnapshot(changed), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it("rejects a two-section cycle without hanging or repairing it", () => {
      const changed = snapshot();
      changed.rows.push({ ...changed.rows[0], id: ID.owner, parentId: ID.section, depth: 1 });
      changed.rows[0].parentId = ID.owner;
      expectInvalid(() => api.parseClientContractSnapshot(changed), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it("rejects unsupported JSON objects and sparse rows", () => {
      for (const candidate of [null, [], new Date(), Object.assign(Object.create({ inherited: true }), snapshot())]) {
        expectInvalid(() => api.parseClientContractSnapshot(candidate), "OFFER_CLIENT_CONTRACT_INVALID");
      }
      const changed = snapshot(); delete changed.rows[1];
      expectInvalid(() => api.parseClientContractSnapshot(changed), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it("keeps captured project whitespace and original actor identity without source fallback", () => {
      const captured = snapshot(); captured.project.name = "  Captured project A  ";
      const before = copy(captured);
      expect(api.parseClientContractSnapshot(captured)).toEqual(before);
      expect(captured).toEqual(before);
    });
  });

  describe("C5 financial presentation invariants", () => {
    it("counts root lines and rejects engine2 footer drift", () => {
      const captured = snapshot();
      expect(api.parseClientContractSnapshot(captured)).toEqual(captured);
      captured.totals.saleHtCents -= 2000;
      captured.totals.calculatedTtcCents -= 2000; captured.totals.payableTtcCents -= 2000;
      expectInvalid(() => api.parseClientContractSnapshot(captured), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it.each([25, -25])("keeps VAT separate from commercial rounding %s", (adjustment) => {
      const captured = snapshot(); captured.totals.roundingAdjustmentCents = adjustment;
      captured.totals.payableTtcCents += adjustment;
      expect(api.parseClientContractSnapshot(captured)).toEqual(captured);
      captured.totals.taxCents += adjustment;
      expectInvalid(() => api.parseClientContractSnapshot(captured), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it("refuses section drift, footer equations and additive overflow", () => {
      for (const target of ["rows.0.saleHtCents", "totals.calculatedTtcCents", "totals.payableTtcCents"]) {
        const captured = snapshot(); setAt(captured, target, 9999);
        expectInvalid(() => api.parseClientContractSnapshot(captured), "OFFER_CLIENT_CONTRACT_INVALID");
      }
      const captured = snapshot(); captured.rows[1].saleHtCents = MAX_CENTS;
      captured.rows[0].saleHtCents = MAX_CENTS;
      expectInvalid(() => api.parseClientContractSnapshot(captured), "OFFER_CLIENT_CONTRACT_INVALID");
    });
    it("allows zero quantity/free line and rounded unit×quantity display difference", () => {
      const captured = snapshot(); captured.rows[1].quantity = 0; captured.rows[1].unitSaleHtCents = 0;
      captured.rows[1].saleHtCents = 0; captured.rows[0].saleHtCents = 0;
      captured.totals = { saleHtCents: 5000, taxCents: 1000, calculatedTtcCents: 6000,
        payableTtcCents: 6000, roundingAdjustmentCents: 0 };
      expect(api.parseClientContractSnapshot(captured)).toEqual(captured);
      const rounded = snapshot(); rounded.rows[1].quantity = 3; rounded.rows[1].unitSaleHtCents = 3333;
      expect(api.parseClientContractSnapshot(rounded)).toEqual(rounded);
    });
    it("captures engine1's chosen presentation without silently reallocating its historic gap", () => {
      const captured = snapshot(); captured.version.calcEngineVersion = 1;
      captured.rows[1].saleHtCents = 9900;
      expect(api.parseClientContractSnapshot(captured)).toEqual(captured);
    });
    it("requires reverse-charge VAT/rounding zero without inferring from current rates", () => {
      const captured = snapshot(); captured.version.contractorRole = "subcontractor";
      captured.totals = { saleHtCents: 15000, taxCents: 0, calculatedTtcCents: 15000,
        payableTtcCents: 15000, roundingAdjustmentCents: 0 };
      expect(api.parseClientContractSnapshot(captured)).toEqual(captured);
      const bad = copy(captured); bad.totals.taxCents = 1;
      bad.totals.calculatedTtcCents = 15001; bad.totals.payableTtcCents = 15001;
      expectInvalid(() => api.parseClientContractSnapshot(bad), "OFFER_CLIENT_CONTRACT_INVALID");
    });
  });

  describe("C6 frozen layout and included terms", () => {
    it.each([
      ["unknown layout key", "layoutOptions.extra", true], ["coerced boolean", "layoutOptions.includeTerms", "true"],
      ["bad depth", "layoutOptions.detailLevel", 5], ["unknown density", "layoutOptions.density", "tiny"],
      ["bad price mode", "layoutOptions.priceMode", "cost_and_total"],
      ["missing included terms", "termsSnapshot", null], ["blank body", "termsSnapshot.body", " "],
      ["unknown terms key", "termsSnapshot.hiddenClause", "changed"], ["invalid review time", "termsSnapshot.legalReviewedAt", "yesterday"],
      ["no reviewed date", "termsSnapshot.legalReviewedAt", null], ["invalid capture date", "termsSnapshot.capturedAt", "2026-02-30T00:00:00Z"],
      ["false draft marker", "termsSnapshot.isDraft", false], ["coerced version", "termsSnapshot.version", "1"],
    ] as Array<[string, string, unknown]>)("refuses %s", (_name, target, value) => {
      const changed = proof(); setAt(changed, target, value);
      expectInvalid(() => api.parseOfferDocumentProof(changed), "OFFER_DOCUMENT_PROOF_INVALID");
    });
    it("requires each exact layout key and never applies a current default", () => {
      for (const target of ["layoutOptions.priceMode", "layoutOptions.showNumbering", "layoutOptions.conditionsPlacement"]) {
        const changed = proof(); removeAt(changed, target);
        expectInvalid(() => api.parseOfferDocumentProof(changed), "OFFER_DOCUMENT_PROOF_INVALID");
      }
    });
    it("accepts explicitly unused stored terms or null, while preserving their bytes", () => {
      const unused = proof(); unused.layoutOptions.includeTerms = false;
      expect(api.parseOfferDocumentProof(unused)).toEqual(unused);
      const omitted = copy(unused); setAt(omitted, "termsSnapshot", null);
      expect(api.parseOfferDocumentProof(omitted)).toEqual(omitted);
    });
    it("keeps development draft terms explicit and refuses them by default", () => {
      const development = proof(); setAt(development, "termsSnapshot.isDraft", true);
      setAt(development, "termsSnapshot.legalReviewedAt", null);
      expectInvalid(() => api.parseOfferDocumentProof(development), "OFFER_DOCUMENT_PROOF_INVALID");
      expect(api.parseOfferDocumentProof(development, { allowDevelopmentTerms: true })).toEqual(development);
    });
    it("requires uniform complete net FO/MO pairs matching the document price mode", () => {
      const captured = withFoMo();
      const correct = proof(captured); correct.layoutOptions.priceMode = "fo_mo_and_total";
      expect(api.parseOfferDocumentProof(correct)).toEqual(correct);
      const missingPair = copy(captured); removeAt(missingPair, "rows.1.moSaleHtCents");
      expectInvalid(() => api.parseClientContractSnapshot(missingPair), "OFFER_CLIENT_CONTRACT_INVALID");
      const mixed = copy(captured); removeAt(mixed, "rows.1.moSaleHtCents"); removeAt(mixed, "rows.1.foSaleHtCents");
      expectInvalid(() => api.parseClientContractSnapshot(mixed), "OFFER_CLIENT_CONTRACT_INVALID");
      const wrongSum = copy(captured); setAt(wrongSum, "rows.1.moSaleHtCents", 1);
      expectInvalid(() => api.parseClientContractSnapshot(wrongSum), "OFFER_CLIENT_CONTRACT_INVALID");
      const hidden = proof(captured);
      expectInvalid(() => api.parseOfferDocumentProof(hidden), "OFFER_DOCUMENT_PROOF_INVALID");
      const missing = proof(); missing.layoutOptions.priceMode = "fo_mo_and_total";
      expectInvalid(() => api.parseOfferDocumentProof(missing), "OFFER_DOCUMENT_PROOF_INVALID");
    });
  });

  describe("C7 document proof union/anchors", () => {
    it.each([
      ["marker without snapshot", "clientContractSnapshot", null], ["snapshot without marker", "clientContractVersion", null],
      ["downgrade marker", "clientContractVersion", 0], ["future marker", "clientContractVersion", 2],
      ["proof version", "proofVersion", 2], ["not ready", "status", "processing"],
      ["wrong tenant", "tenantId", ID.owner], ["wrong version", "versionId", ID.owner],
      ["wrong project", "projectId", ID.owner], ["wrong revision", "publishedContentRevision", 8],
      ["wrong publisher", "generatedBy", ID.owner], ["missing claim", "publishedGenerationToken", null],
      ["email missing dispatch", "publishedDispatchId", null], ["new legacy purpose", "publishedPurpose", "legacy"],
      ["zero bytes", "fileSizeBytes", 0], ["fractional bytes", "fileSizeBytes", 1.5],
      ["absent new generated date", "generatedAt", null], ["invalid generated date", "generatedAt", "2026-02-30T00:00:00Z"],
      ["hash path mismatch", "sha256Hash", "b".repeat(64)], ["invalid hash", "sha256Hash", "A".repeat(64)],
      ["traversal", "filePath", `${ID.tenant}/${ID.project}/../file.pdf`],
      ["encoded separator", "filePath", `${ID.tenant}/${ID.project}%2F${ID.version}/${PDF_HASH}.pdf`],
      ["external URL", "filePath", "https://example.invalid/file.pdf"],
      ["query path", "filePath", `${ID.tenant}/${ID.project}/${ID.version}/${PDF_HASH}.pdf?x=1`],
      ["caller valid flag", "valid", true],
    ] as Array<[string, string, unknown]>)("refuses %s", (_name, target, value) => {
      const changed = proof(); setAt(changed, target, value);
      expectInvalid(() => api.parseOfferDocumentProof(changed), "OFFER_DOCUMENT_PROOF_INVALID");
    });
    it("distinguishes manual/workflow publication from email without inventing a new dispatch", () => {
      for (const purpose of ["manual", "workflow"]) {
        const manual = proof(); manual.publishedPurpose = purpose; setAt(manual, "publishedDispatchId", null);
        expect(api.parseOfferDocumentProof(manual)).toEqual(manual);
        setAt(manual, "publishedDispatchId", ID.dispatch);
        expectInvalid(() => api.parseOfferDocumentProof(manual), "OFFER_DOCUMENT_PROOF_INVALID");
      }
    });
    it("retains PostgreSQL microseconds during proof timestamp normalization", () => {
      const captured = proof(); captured.generatedAt = "2026-10-13T14:00:00.123456+02:00";
      expect(api.parseOfferDocumentProof(captured).generatedAt).toBe("2026-10-13T12:00:00.123456Z");
      expect(captured.generatedAt).toBe("2026-10-13T14:00:00.123456+02:00");
    });
    it("preserves admissible original legacy metadata and refuses v5 construction", () => {
      const legacy = legacyProof();
      expect(api.parseOfferDocumentProof(legacy)).toEqual(legacy);
      expectInvalid(() => api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: snapshot(), documentProof: legacy }), "OFFER_SEAL_INPUT_INVALID");
      for (const target of ["clientContractVersion", "clientContractSnapshot", "termsSnapshot", "filePath"]) {
        const changed = copy(legacy);
        setAt(changed, target, target === "clientContractVersion" ? 1 : target === "clientContractSnapshot"
          ? snapshot() : target === "termsSnapshot" ? null : `${ID.owner}/${ID.project}/wrong.pdf`);
        expectInvalid(() => api.parseOfferDocumentProof(changed), "OFFER_DOCUMENT_PROOF_INVALID");
      }
    });
  });

  describe("C9 new5 canonical authenticity", () => {
    it("matches independent exact envelope SHA and ignores object insertion order", () => {
      const captured = snapshot(); const published = proof(captured);
      const envelope = {
        meta: { payloadVersion: 5, versionId: ID.version, tenantId: ID.tenant, projectId: ID.project,
          contentRevision: 7, calcEngineVersion: 2 },
        calculation: { payloadVersion: 4, sha256: CALCULATION_HASH },
        clientContract: captured,
        document: { sha256Hash: PDF_HASH, layoutOptions: published.layoutOptions, termsSnapshot: published.termsSnapshot },
      };
      const expected = sha(JSON.stringify(canonicalOracle(envelope)));
      const original = api.computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: published });
      expect(original).toBe(expected);
      expect(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: reverseObjectKeys(captured), documentProof: reverseObjectKeys(published) })).toBe(expected);
      expect(original).toMatch(/^[0-9a-f]{64}$/);
    });
    it.each([
      ["company.name", "ARMY COMPANY B"], ["company.legal.vat", "ARMY-VAT-B"],
      ["issuer.userId", ID.owner], ["issuer.displayName", "ARMY actor B"],
      ["project.clientName", "ARMY client B"], ["project.siteAddress", "ARMY site B"],
      ["project.estimateReference", "ARMY-EST-B_V2"], ["exclusions", "Changed limits"],
      ["rows.1.title", "Changed line"],
    ])("binds valid tamper %s", (target, replacement) => {
      const originalSnapshot = snapshot(); const originalProof = proof(originalSnapshot);
      const original = api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: originalSnapshot, documentProof: originalProof });
      const changed = copy(originalSnapshot); setAt(changed, target, replacement);
      const changedProof = proof(changed);
      if (target === "issuer.userId") changedProof.generatedBy = replacement;
      expect(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: changed, documentProof: changedProof })).not.toBe(original);
      expectInvalid(() => api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: changed, documentProof: originalProof }), "OFFER_SEAL_INPUT_INVALID");
    });
    it("preserves array order and binds changed PDF, CGV/layout and calculation hash", () => {
      const captured = snapshot(); const published = proof(captured);
      const original = api.computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: published });
      const reordered = copy(captured); [reordered.rows[2], reordered.rows[3]] = [reordered.rows[3], reordered.rows[2]];
      expect(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: reordered, documentProof: proof(reordered) })).not.toBe(original);
      const pdf = copy(published); pdf.sha256Hash = "b".repeat(64);
      pdf.filePath = `${ID.tenant}/${ID.project}/${ID.version}/${pdf.sha256Hash}.pdf`;
      const cgv = copy(published); cgv.termsSnapshot.body += "\n\nChanged included clause.";
      const changedLayout = copy(published); changedLayout.layoutOptions.density = "comfortable";
      for (const changedProof of [pdf, cgv, changedLayout]) {
        expect(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: changedProof })).not.toBe(original);
      }
      expect(api.computeOfferSealHash({ calculationHash: "d".repeat(64), snapshot: captured, documentProof: published })).not.toBe(original);
    });
    it("uses the same v5 envelope for engine1 while preserving legacy default policy", () => {
      const captured = snapshot(); captured.version.calcEngineVersion = 1;
      const input = { calculationHash: CALCULATION_HASH, snapshot: captured, documentProof: proof(captured) };
      const engine1 = api.computeOfferSealHash(input);
      expect(engine1).toMatch(/^[0-9a-f]{64}$/);
      expect(engine1).not.toBe(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: snapshot(), documentProof: proof() }));
    });
    it("binds a coherent changed sale/footer and retained quantity precision", () => {
      const originalSnapshot = snapshot();
      const original = api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: originalSnapshot, documentProof: proof(originalSnapshot) });
      const priced = copy(originalSnapshot); priced.rows[1].saleHtCents = 11000;
      priced.rows[1].unitSaleHtCents = 5500; priced.rows[0].saleHtCents = 11000;
      priced.totals = { saleHtCents: 16000, taxCents: 3200, calculatedTtcCents: 19200,
        payableTtcCents: 19200, roundingAdjustmentCents: 0 };
      const preciseQuantity = copy(originalSnapshot); preciseQuantity.rows[1].quantity = 2.0001;
      for (const changed of [priced, preciseQuantity]) {
        expect(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
          snapshot: changed, documentProof: proof(changed) })).not.toBe(original);
      }
    });
    it("binds displayed FO/MO net-sale portions without treating them as cost data", () => {
      const originalSnapshot = withFoMo(); const originalProof = proof(originalSnapshot);
      originalProof.layoutOptions.priceMode = "fo_mo_and_total";
      const original = api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: originalSnapshot, documentProof: originalProof });
      const changed = copy(originalSnapshot);
      for (const index of [0, 1]) {
        setAt(changed, `rows.${index}.foSaleHtCents`, 7000);
        setAt(changed, `rows.${index}.moSaleHtCents`, 3000);
      }
      const changedProof = proof(changed); changedProof.layoutOptions.priceMode = "fo_mo_and_total";
      expect(api.computeOfferSealHash({ calculationHash: CALCULATION_HASH,
        snapshot: changed, documentProof: changedProof })).not.toBe(original);
    });
    it.each(["not-a-hash", "A".repeat(64), "0".repeat(63)])("rejects malformed calculation proof %s", (hash) => {
      expectInvalid(() => api.computeOfferSealHash({ calculationHash: hash,
        snapshot: snapshot(), documentProof: proof() }), "OFFER_SEAL_INPUT_INVALID");
    });
  });
});
