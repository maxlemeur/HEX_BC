import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  OfferContractError,
  parseClientContractSnapshot,
  parseOfferDocumentProof,
} from "@/lib/estimates/offer-contract";

// Lot 2, sous-lot 2.7 (docs/testing/estimate-engine-v3-2.7-vitest.md, F27-V01 à F27-V12).
// Isolation justifiée (parseur strict, intégrité du document émis) : une copie commerciale v3
// altérée d'un centime, d'une clé ou d'un type ne peut pas être fabriquée par un parcours E2E
// (l'application n'écrit que des copies cohérentes) ; seul le parseur la refuse avant le sceau.
// Le module `offer-contract-v2.ts` n'existe pas encore : il est chargé par une variable pour que
// le build de production (qui vérifie aussi les tests) reste vert et que le rouge porte sur le
// contrat absent. Le type ci-dessous recopie le contrat attendu (D14) ; l'implémentation le
// remplace par `import type { ClientContract2 } from "@/lib/estimates/offer-contract-v2"`.
const MODULE = path.resolve(process.cwd(), "src/lib/estimates/offer-contract-v2.ts");
const MAX_CENTS = 2_147_483_647;
const PDF_HASH = "a".repeat(64);
const ID = {
  version: "44444444-4444-4444-8444-444444444444",
  tenant: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  actor: "11111111-1111-4111-8111-111111111111",
  other: "99999999-9999-4999-8999-999999999999",
  document: "55555555-5555-4555-8555-555555555555",
  claim: "66666666-6666-4666-8666-666666666666",
  sectionA: "a0000000-0000-4000-8000-00000000000a",
  sectionB: "b0000000-0000-4000-8000-00000000000b",
  sectionB1: "b1000000-0000-4000-8000-0000000000b1",
};
const lineId = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

type PricingStatus = "priced" | "included" | "for_memory" | "not_priced" | "out_of_scope" | "not_applicable";
type Portions = { foSaleHtCents?: number; moSaleHtCents?: number };
type Section2 = Portions & {
  kind: "section"; id: string; parentId: string | null; position: number; depth: number;
  number: string; title: string; saleHtCents: number;
};
type Line2 = Portions & {
  kind: "line"; id: string; parentId: string | null; position: number; depth: number; title: string;
  quantity: number; unitCode: string | null; unitLabel: string | null; pricingStatus: PricingStatus;
  taxRateBp: number; unitSaleHtCents: number | null; saleHtCents: number;
};
type Contract2 = {
  schemaVersion: 2;
  version: {
    id: string; tenantId: string; projectId: string; number: number; contentRevision: number;
    calcEngineVersion: 3; dateDevis: string; validiteJours: number; currency: "EUR" | "USD" | "GBP";
    contractorRole: "principal" | "subcontractor"; taxRateBp: number;
  };
  project: { name: string; reference: string | null; estimateReference: string | null; clientName: string | null; siteAddress: string | null };
  issuer: { userId: string; displayName: string; displayRole: string | null; phone: string | null; email: string | null };
  company: {
    name: string; tagline: string;
    address: { street: string; postalCode: string; city: string };
    registeredOffice: { street: string; postalCode: string; city: string };
    phone: { landline: string; mobile: string };
    legal: { siret: string; vat: string };
  };
  rows: Array<Section2 | Line2>;
  totals: {
    grossHtCents: number;
    commercialDiscountCents: number;
    discountIntent: { kind: "none" | "amount" } | { kind: "rate"; rateBp: number };
    commercialRoundingCents: number;
    netHtCents: number;
    taxByRate: Array<{ rateBp: number; baseHtCents: number; taxCents: number }>;
    taxCents: number;
    payableTtcCents: number;
    reverseCharge: boolean;
  };
  exclusions: string | null;
};
type V2API = { parseClientContract2Snapshot: (value: unknown) => Contract2 };
let api: V2API;

const copy = <T,>(value: T): T => structuredClone(value);
type JsonObject = Record<string, unknown>;
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
function expectInvalid(fn: () => unknown, code = "OFFER_CLIENT_CONTRACT_INVALID"): void {
  let failure: unknown;
  try { fn(); } catch (error) { failure = error; }
  expect(failure, "une copie altérée doit être refusée, jamais réparée").toBeInstanceOf(OfferContractError);
  expect((failure as OfferContractError).code).toBe(code);
}

/* ---------- oracle indépendant des invariants (BigInt, demi supérieur) ---------- */

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (BigInt(2) * numerator + denominator) / (BigInt(2) * denominator);
}
function thousandths(quantity: number): bigint {
  const [whole, fraction = ""] = String(quantity).split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
}
/** ⌈Q × PU⌋ en décimal exact (jamais en flottant : 1,005 × 100 vaut 100,4999… en double). */
function grossOf(quantity: number, unitSaleHtCents: number): number {
  return Number(halfUp(thousandths(quantity) * BigInt(unitSaleHtCents), BigInt(1000)));
}
function rateTax(baseHtCents: number, rateBp: number, reverseCharge: boolean): number {
  return reverseCharge ? 0 : Number(halfUp(BigInt(baseHtCents) * BigInt(rateBp), BigInt(10_000)));
}
const lines = (contract: Contract2) => contract.rows.filter((row): row is Line2 => row.kind === "line");
/** Bases, TVA et TTC depuis le HT net (le dernier taux absorbe l'écart de base). */
function rebase(contract: Contract2): Contract2 {
  const totals = contract.totals;
  const others = totals.taxByRate.slice(0, -1).reduce((sum, row) => sum + row.baseHtCents, 0);
  if (totals.taxByRate.length > 0) totals.taxByRate.at(-1)!.baseHtCents = totals.netHtCents - others;
  for (const row of totals.taxByRate) row.taxCents = rateTax(row.baseHtCents, row.rateBp, totals.reverseCharge);
  totals.taxCents = totals.taxByRate.reduce((sum, row) => sum + row.taxCents, 0);
  totals.payableTtcCents = totals.netHtCents + totals.taxCents;
  return contract;
}
/** HT net depuis brut, remise et arrondi, puis `rebase`. */
function refooter(contract: Contract2): Contract2 {
  const totals = contract.totals;
  totals.netHtCents = totals.grossHtCents - totals.commercialDiscountCents - totals.commercialRoundingCents;
  return rebase(contract);
}
/** Sous-totaux de section, brut, puis `refooter` : une seule grandeur altérée reste isolée. */
function recompute(contract: Contract2): Contract2 {
  const byId = new Map(contract.rows.map((row) => [row.id, row]));
  for (const row of contract.rows) {
    if (row.kind !== "section") continue;
    row.saleHtCents = 0;
    if ("foSaleHtCents" in row) { row.foSaleHtCents = 0; row.moSaleHtCents = 0; }
  }
  for (const row of lines(contract)) {
    let parentId = row.parentId;
    while (parentId !== null) {
      const section = byId.get(parentId)!;
      section.saleHtCents += row.saleHtCents;
      if ("foSaleHtCents" in section) {
        section.foSaleHtCents! += row.foSaleHtCents!;
        section.moSaleHtCents! += row.moSaleHtCents!;
      }
      parentId = section.parentId;
    }
  }
  contract.totals.grossHtCents = lines(contract).reduce((sum, row) => sum + row.saleHtCents, 0);
  return refooter(contract);
}

/* ---------- copies commerciales v3 valides (valeurs §5.1, §5.2 de la conception) ---------- */

function priced(n: number, parentId: string | null, position: number, depth: number, quantity: number,
  unitCode: string, unitLabel: string, unitSaleHtCents: number, saleHtCents: number): Line2 {
  return { kind: "line", id: lineId(n), parentId, position, depth, title: `ARMY O${n}`, quantity, unitCode, unitLabel,
    pricingStatus: "priced", taxRateBp: 2000, unitSaleHtCents, saleHtCents };
}

/** S2 : O1–O7 à 1,30 / 1,20, remise de 1,01 €, TVA 20 %, une ligne « pour mémoire » à 5,5 %. */
function contract(): Contract2 {
  return {
    schemaVersion: 2,
    version: {
      id: ID.version, tenantId: ID.tenant, projectId: ID.project, number: 3, contentRevision: 9,
      calcEngineVersion: 3, dateDevis: "2026-10-17", validiteJours: 30, currency: "EUR",
      contractorRole: "principal", taxRateBp: 2000,
    },
    project: { name: "ARMY v3 project", reference: "ARMY-L2-27", estimateReference: "ARMY-L2-27_V3",
      clientName: "ARMY client", siteAddress: "ARMY site" },
    issuer: { userId: ID.actor, displayName: "ARMY actor", displayRole: "Engineer", phone: null, email: "army@example.invalid" },
    company: {
      name: "ARMY COMPANY", tagline: "Synthetic test company",
      address: { street: "ARMY street", postalCode: "75001", city: "Paris" },
      registeredOffice: { street: "ARMY office", postalCode: "75002", city: "Paris" },
      phone: { landline: "+33 1 00 00 00 02", mobile: "+33 6 00 00 00 03" },
      legal: { siret: "ARMY-FIXTURE", vat: "ARMY-VAT" },
    },
    rows: [
      { kind: "section", id: ID.sectionA, parentId: null, position: 0, depth: 0, number: "01", title: "ARMY réseaux", saleHtCents: 555_461 },
      priced(1, ID.sectionA, 0, 1, 20, "ml", "ml", 16_663, 333_260),
      priced(2, ID.sectionA, 1, 1, 3, "u", "u", 20_832, 62_496),
      priced(3, ID.sectionA, 2, 1, 21, "m2", "m²", 7605, 159_705),
      { kind: "line", id: lineId(8), parentId: ID.sectionA, position: 3, depth: 1, title: "ARMY pour mémoire", quantity: 1,
        unitCode: null, unitLabel: null, pricingStatus: "for_memory", taxRateBp: 550, unitSaleHtCents: null, saleHtCents: 0 },
      { kind: "section", id: ID.sectionB, parentId: null, position: 1, depth: 0, number: "02", title: "ARMY sanitaires", saleHtCents: 6_290_891 },
      { kind: "section", id: ID.sectionB1, parentId: ID.sectionB, position: 0, depth: 1, number: "02.01", title: "ARMY sous-lot", saleHtCents: 1_572_467 },
      priced(4, ID.sectionB1, 0, 2, 1139, "ml", "ml", 1353, 1_541_067),
      priced(5, ID.sectionB1, 1, 2, 1, "u", "u", 31_400, 31_400),
      priced(6, ID.sectionB, 1, 1, 282, "ml", "ml", 16_732, 4_718_424),
      priced(7, null, 2, 0, 8, "ml", "ml", 7388, 59_104),
    ],
    totals: {
      grossHtCents: 6_905_456, commercialDiscountCents: 101, discountIntent: { kind: "amount" },
      commercialRoundingCents: 0, netHtCents: 6_905_355,
      taxByRate: [{ rateBp: 2000, baseHtCents: 6_905_355, taxCents: 1_381_071 }],
      taxCents: 1_381_071, payableTtcCents: 8_286_426, reverseCharge: false,
    },
    exclusions: "Synthetic limits\n\nSecond paragraph.",
  };
}
const row = (value: Contract2, id: string) => value.rows.find((entry) => entry.id === id)!;
const lineRow = (value: Contract2, n: number) => row(value, lineId(n)) as Line2;

/** S5 : O1–O3 à 10 %, O4–O7 à 20 % (bases 555 453 et 6 349 902, TTC 8 230 880). */
function s5(): Contract2 {
  const value = contract();
  for (const n of [1, 2, 3]) lineRow(value, n).taxRateBp = 1000;
  value.totals.taxByRate = [
    { rateBp: 1000, baseHtCents: 555_453, taxCents: 55_545 },
    { rateBp: 2000, baseHtCents: 6_349_902, taxCents: 1_269_980 },
  ];
  value.totals.taxCents = 1_325_525;
  value.totals.payableTtcCents = 8_230_880;
  return value;
}
function s1(): Contract2 {
  const value = contract();
  value.totals = { ...value.totals, commercialDiscountCents: 0, discountIntent: { kind: "none" }, netHtCents: 6_905_456,
    taxByRate: [{ rateBp: 2000, baseHtCents: 6_905_456, taxCents: 1_381_091 }], taxCents: 1_381_091, payableTtcCents: 8_286_547 };
  return value;
}
function s3(): Contract2 {
  const value = contract();
  value.totals = { ...value.totals, commercialDiscountCents: 690_546, discountIntent: { kind: "rate", rateBp: 1000 },
    netHtCents: 6_214_910, taxByRate: [{ rateBp: 2000, baseHtCents: 6_214_910, taxCents: 1_242_982 }],
    taxCents: 1_242_982, payableTtcCents: 7_457_892 };
  return value;
}
function s4(): Contract2 {
  const value = contract();
  value.totals = { ...value.totals, commercialRoundingCents: 5355, netHtCents: 6_900_000,
    taxByRate: [{ rateBp: 2000, baseHtCents: 6_900_000, taxCents: 1_380_000 }], taxCents: 1_380_000, payableTtcCents: 8_280_000 };
  return value;
}
function reverseCharge(): Contract2 {
  const value = contract();
  value.version.contractorRole = "subcontractor";
  value.totals.reverseCharge = true;
  return rebase(value);
}
/** Parts FO/MO brutes du moteur v3 sur S2 (sections : sommes). */
function withPortions(): Contract2 {
  const value = contract();
  const portions: Record<string, [number, number]> = {
    [lineId(1)]: [142_119, 191_141], [lineId(2)]: [37_296, 25_200], [lineId(3)]: [159_705, 0], [lineId(8)]: [0, 0],
    [lineId(4)]: [447_304, 1_093_763], [lineId(5)]: [2600, 28_800], [lineId(6)]: [3_367_547, 1_350_877],
    [lineId(7)]: [9183, 49_921], [ID.sectionA]: [339_120, 216_341], [ID.sectionB1]: [449_904, 1_122_563],
    [ID.sectionB]: [3_817_451, 2_473_440],
  };
  for (const entry of value.rows) {
    const [fo, mo] = portions[entry.id];
    entry.foSaleHtCents = fo;
    entry.moSaleHtCents = mo;
  }
  return value;
}
/** Une ligne racine seule, totaux recalculés par l'oracle. */
function single(quantity: number, unitSaleHtCents: number, taxRateBp = 2000, saleHtCents = grossOf(quantity, unitSaleHtCents)): Contract2 {
  const value = contract();
  value.rows = [{ ...priced(1, null, 0, 0, quantity, "u", "u", unitSaleHtCents, saleHtCents), taxRateBp }];
  value.totals = { ...value.totals, commercialDiscountCents: 0, discountIntent: { kind: "none" },
    taxByRate: [{ rateBp: taxRateBp, baseHtCents: 0, taxCents: 0 }] };
  return recompute(value);
}
/** T-HALF3 : Q 1,005 × PU 100 c = 101 c (100,5 arrondi au demi supérieur). */
const tHalf3 = () => single(1.005, 100);

function contract1() {
  return {
    schemaVersion: 1,
    version: { ...contract().version, calcEngineVersion: 2 },
    project: contract().project, issuer: contract().issuer, company: contract().company,
    rows: [{ kind: "line", id: lineId(1), parentId: null, position: 0, depth: 0, title: "ARMY line", quantity: 2,
      unit: "u", unitSaleHtCents: 5000, saleHtCents: 10_000 }],
    totals: { saleHtCents: 10_000, taxCents: 2000, calculatedTtcCents: 12_000, payableTtcCents: 12_000, roundingAdjustmentCents: 0 },
    exclusions: null,
  };
}
function layout(priceMode = "unit_and_total") {
  return { preset: "client_detailed", detailLevel: "lines", priceMode, density: "standard",
    showNumbering: true, showSectionSubtotals: true, conditionsPlacement: "auto", includeTerms: false };
}
function proof(captured: unknown = contract(), clientContractVersion: number = 2) {
  return {
    proofVersion: 1, documentId: ID.document, tenantId: ID.tenant, versionId: ID.version, projectId: ID.project,
    status: "ready", filePath: `${ID.tenant}/${ID.project}/${ID.version}/${PDF_HASH}.pdf`, sha256Hash: PDF_HASH,
    fileSizeBytes: 4321, generatedAt: "2026-10-17T12:00:00.123456Z", generatedBy: ID.actor,
    publishedGenerationToken: ID.claim, publishedPurpose: "manual", publishedDispatchId: null,
    publishedContentRevision: 9, clientContractVersion, clientContractSnapshot: copy(captured),
    layoutOptions: layout(), termsSnapshot: null,
  };
}

describe("ClientContract2 : analyse stricte (D14, sous-lot 2.7)", () => {
  // Chaque cas échoue seul (et non « ignoré ») tant que le module manque.
  beforeAll(async () => {
    if (existsSync(MODULE)) api = await import(/* @vite-ignore */ MODULE) as V2API;
  });
  beforeEach(() => {
    if (!api) throw new Error("MISSING_PRECONDITION: src/lib/estimates/offer-contract-v2.ts absent (contrat client 2 non livré).");
    expect(typeof api.parseClientContract2Snapshot).toBe("function");
  });

  describe("F27-V01 copies valides, rendues à l'identique", () => {
    const valid: Array<[string, () => Contract2]> = [
      ["S2 (remise 1,01 €, sections imbriquées, ligne racine, ligne pour mémoire)", contract],
      ["S1 sans remise", s1], ["S3 remise de 10 %", s3], ["S4 arrondi commercial 53,55 €", s4],
      ["S5 deux taux", s5], ["autoliquidation", reverseCharge], ["parts FO/MO brutes", withPortions],
      ["T-HALF3 1,005 × 100 c = 101 c", tHalf3], ["T-TVA ½↑ 99 c à 20 % → 20 c", () => single(1, 99)],
      ["½↑ et non ½ pair : 300 c à 5,5 % → 17 c", () => single(1, 300, 550)],
      ["quantité nulle", () => single(0, 3250)],
      ["remise plafonnée à l'assiette (CAP)", () => {
        const value = single(1, 40_000); value.totals.discountIntent = { kind: "amount" };
        value.totals.commercialDiscountCents = 40_000; return refooter(value);
      }],
      ["remise de 100 %", () => {
        const value = single(3, 1001); value.totals.discountIntent = { kind: "rate", rateBp: 10_000 };
        value.totals.commercialDiscountCents = 3003; return refooter(value);
      }],
    ];
    it.each(valid)("%s", (_name, build) => {
      const source = build();
      const before = copy(source);
      expect(recompute(copy(source)), "fixture cohérente selon l'oracle du test").toEqual(source);
      const parsed = api.parseClientContract2Snapshot(source);
      expect(parsed).toEqual(before);
      expect(parsed).not.toBe(source);
      expect(source).toEqual(before);
    });
  });

  describe("F27-V02 clés exactes : absente", () => {
    it.each([
      "schemaVersion", "version", "version.calcEngineVersion", "version.taxRateBp", "version.contractorRole",
      "project", "project.siteAddress", "issuer.userId", "company.legal.vat", "company.registeredOffice.city",
      "rows", "rows.0.number", "rows.1.unitCode", "rows.1.unitLabel", "rows.1.pricingStatus", "rows.1.taxRateBp",
      "rows.1.unitSaleHtCents", "rows.4.unitSaleHtCents", "rows.4.unitCode", "rows.1.quantity", "rows.1.saleHtCents",
      "totals", "totals.grossHtCents", "totals.commercialDiscountCents", "totals.discountIntent", "totals.discountIntent.kind",
      "totals.commercialRoundingCents", "totals.netHtCents", "totals.taxByRate", "totals.taxByRate.0.rateBp",
      "totals.taxByRate.0.baseHtCents", "totals.taxByRate.0.taxCents", "totals.taxCents", "totals.payableTtcCents",
      "totals.reverseCharge", "exclusions",
    ])("refuse l'absence de %s", (target) => {
      const changed = contract(); removeAt(changed, target);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un taux de remise sans `rateBp`", () => {
      const changed = s3(); removeAt(changed, "totals.discountIntent.rateBp");
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une part FO sans part MO", () => {
      const changed = withPortions(); removeAt(changed, "rows.1.moSaleHtCents");
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V03 clés exactes : en trop (contrat 1, données privées, champs inventés)", () => {
    it.each([
      "totals.saleHtCents", "totals.calculatedTtcCents", "totals.roundingAdjustmentCents", "rows.1.unit",
      "rows.1.unit_code", "rows.1.h_mo_per_unit", "rows.1.unit_price_ht_cents", "rows.1.costHtCents",
      "rows.1.netHtCents", "rows.1.reductionCents", "rows.1.taxCents", "rows.0.unitCode", "rows.0.pricingStatus",
      "totals.costSubtotalCents", "totals.realizedSaleCoefficient", "totals.discountIntent.requestedCents",
      "totals.discountIntent.rateBp", "totals.taxByRate.0.label", "version.saleCoefficientFo",
      "version.calcSnapshotContext", "project.extra", "issuer.ownerId", "company.legal.extra", "layoutOptions", "sealHash",
    ])("refuse la clé %s", (target) => {
      const changed = contract(); setAt(changed, target, target.endsWith("rateBp") ? 1000 : "forbidden-field");
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V04 types et domaines", () => {
    const badValues: Array<[string, string, unknown]> = [
      ["contrat 1", "schemaVersion", 1], ["schéma en chaîne", "schemaVersion", "2"], ["schéma futur", "schemaVersion", 3],
      ["moteur 2", "version.calcEngineVersion", 2], ["moteur 1", "version.calcEngineVersion", 1],
      ["moteur en chaîne", "version.calcEngineVersion", "3"], ["moteur 4", "version.calcEngineVersion", 4],
      ["taux de version hors bornes", "version.taxRateBp", 10_001], ["taux de version fractionnaire", "version.taxRateBp", 19.6],
      ["montant en chaîne", "rows.1.saleHtCents", "333260"], ["montant fractionnaire", "rows.1.saleHtCents", 333_260.5],
      ["montant négatif", "rows.1.saleHtCents", -1], ["montant NaN", "rows.1.saleHtCents", Number.NaN],
      ["montant infini", "rows.1.saleHtCents", Number.POSITIVE_INFINITY], ["montant au-delà de l'int32", "rows.1.saleHtCents", MAX_CENTS + 1],
      ["PU négatif", "rows.1.unitSaleHtCents", -16_663], ["PU zéro négatif", "rows.1.unitSaleHtCents", -0],
      ["PU en chaîne", "rows.1.unitSaleHtCents", "16663"], ["quantité négative", "rows.1.quantity", -1],
      ["quantité en chaîne", "rows.1.quantity", "20"], ["quantité infinie", "rows.1.quantity", Number.POSITIVE_INFINITY],
      ["quantité à 4 décimales", "rows.1.quantity", 20.0001], ["quantité nulle (null)", "rows.1.quantity", null],
      ["quantité au-delà de numeric(12,3)", "rows.1.quantity", 1_000_000_000],
      ["unité vide", "rows.1.unitCode", ""], ["unité en majuscules", "rows.1.unitCode", "ML"],
      ["unité hors format", "rows.1.unitCode", "m²"], ["unité avec espace", "rows.1.unitCode", " ml"],
      ["unité trop longue", "rows.1.unitCode", "a".repeat(17)], ["unité numérique", "rows.1.unitCode", 7],
      ["libellé d'unité blanc", "rows.1.unitLabel", " "], ["libellé d'unité numérique", "rows.1.unitLabel", 7],
      ["statut inconnu", "rows.1.pricingStatus", "hors_lot"], ["statut en majuscules", "rows.1.pricingStatus", "PRICED"],
      ["statut nul", "rows.1.pricingStatus", null], ["taux de ligne négatif", "rows.1.taxRateBp", -1],
      ["taux de ligne hors bornes", "rows.1.taxRateBp", 10_001], ["taux de ligne fractionnaire", "rows.1.taxRateBp", 19.6],
      ["taux de ligne en chaîne", "rows.1.taxRateBp", "2000"], ["titre blanc", "rows.1.title", " "],
      ["titre avec NUL", "rows.1.title", "A\u0000B"], ["intention inconnue", "totals.discountIntent.kind", "percent"],
      ["intention nulle", "totals.discountIntent.kind", null], ["intention en chaîne", "totals.discountIntent", "amount"],
      ["autoliquidation en chaîne", "totals.reverseCharge", "false"], ["autoliquidation numérique", "totals.reverseCharge", 0],
      ["autoliquidation nulle", "totals.reverseCharge", null], ["récapitulatif objet", "totals.taxByRate", {}],
      ["récapitulatif nul", "totals.taxByRate", null], ["taux du récapitulatif en chaîne", "totals.taxByRate.0.rateBp", "2000"],
      ["taux du récapitulatif fractionnaire", "totals.taxByRate.0.rateBp", 2000.5],
      ["arrondi commercial négatif", "totals.commercialRoundingCents", -1], ["remise négative", "totals.commercialDiscountCents", -101],
      ["devise inconnue", "version.currency", "CHF"], ["date impossible", "version.dateDevis", "2026-02-30"],
    ];
    it.each(badValues)("refuse %s", (_name, target, value) => {
      const changed = contract(); setAt(changed, target, value);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it.each([0, 10_001, 1.5, "1000"])("refuse un taux de remise %s", (rateBp) => {
      const changed = s3(); setAt(changed, "totals.discountIntent.rateBp", rateBp);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V05 brut : Σ lignes et sous-totaux de section", () => {
    it("refuse un brut décalé d'1 c de la somme des lignes (pied par ailleurs cohérent)", () => {
      const changed = contract(); changed.totals.grossHtCents += 1; refooter(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un sous-total de section décalé d'1 c", () => {
      const changed = contract(); row(changed, ID.sectionA).saleHtCents += 1;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
      const nested = contract(); row(nested, ID.sectionB).saleHtCents -= 1;
      expectInvalid(() => api.parseClientContract2Snapshot(nested));
    });
    it("refuse une part FO de section décalée d'1 c, même si FO + MO = total", () => {
      const changed = withPortions(); const section = row(changed, ID.sectionB1);
      section.foSaleHtCents! += 1; section.moSaleHtCents! -= 1;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une ligne dont FO + MO ≠ brut", () => {
      const changed = withPortions(); lineRow(changed, 1).foSaleHtCents! += 1;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un brut qui dépasse l'int32 par addition", () => {
      const changed = contract(); const root = lineRow(changed, 7);
      root.quantity = 1; root.unitSaleHtCents = MAX_CENTS; root.saleHtCents = MAX_CENTS; recompute(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V06 ligne : PT = ⌈Q × PU⌋ (A4) et statuts", () => {
    it.each([16_664, 16_662])("refuse un PU de %s c avec le PT de 16 663 c", (unitSaleHtCents) => {
      const changed = contract(); lineRow(changed, 1).unitSaleHtCents = unitSaleHtCents;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse T-HALF3 tronqué ou calculé en flottant (100 c au lieu de 101 c)", () => {
      const changed = tHalf3(); lineRow(changed, 1).saleHtCents = 100; recompute(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un montant sur une ligne non chiffrée, même reporté au pied", () => {
      const changed = contract(); lineRow(changed, 8).saleHtCents = 5; recompute(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un PU sur une ligne non chiffrée", () => {
      const changed = contract(); lineRow(changed, 8).unitSaleHtCents = 0;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une ligne chiffrée sans PU, sans unité ou avec une unité sans libellé", () => {
      const noPrice = contract(); lineRow(noPrice, 1).unitSaleHtCents = null;
      expectInvalid(() => api.parseClientContract2Snapshot(noPrice));
      const noUnit = contract(); Object.assign(lineRow(noUnit, 1), { unitCode: null, unitLabel: null });
      expectInvalid(() => api.parseClientContract2Snapshot(noUnit));
      const noLabel = contract(); lineRow(noLabel, 1).unitLabel = null;
      expectInvalid(() => api.parseClientContract2Snapshot(noLabel));
    });
    it("refuse un libellé d'unité sans code d'unité", () => {
      const changed = contract(); lineRow(changed, 8).unitLabel = "u";
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V07 pied : net = brut − remise − arrondi, remise conforme à l'intention", () => {
    it("refuse une remise ou un arrondi décalé d'1 c à net inchangé", () => {
      const discount = contract(); discount.totals.commercialDiscountCents += 1;
      expectInvalid(() => api.parseClientContract2Snapshot(discount));
      const rounding = s4(); rounding.totals.commercialRoundingCents += 1;
      expectInvalid(() => api.parseClientContract2Snapshot(rounding));
    });
    it("refuse un net décalé d'1 c, bases, TVA et TTC réalignées", () => {
      const changed = contract(); changed.totals.netHtCents -= 1; rebase(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une remise sans intention", () => {
      const changed = s1(); changed.totals.commercialDiscountCents = 1; refooter(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it.each([690_545, 690_547])("refuse une remise de 10 %% appliquée à %s c (attendu ⌈G × 10 %%⌋ = 690 546)", (applied) => {
      const changed = s3(); changed.totals.commercialDiscountCents = applied; refooter(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un taux de remise qui ne produit pas la remise appliquée", () => {
      const changed = s3(); changed.totals.discountIntent = { kind: "rate", rateBp: 999 };
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une remise supérieure au brut", () => {
      const changed = single(1, 101); changed.totals.discountIntent = { kind: "amount" };
      changed.totals.commercialDiscountCents = 102; refooter(changed);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V08 TVA par taux sur la base nette (A5)", () => {
    it("refuse une TVA totale ≠ Σ TVA par taux (TTC réaligné)", () => {
      const changed = contract(); changed.totals.taxCents += 1; changed.totals.payableTtcCents += 1;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une TVA de taux ≠ ⌈base × taux⌋ (Σ et TTC réalignés)", () => {
      const changed = contract(); changed.totals.taxByRate[0].taxCents += 1;
      changed.totals.taxCents += 1; changed.totals.payableTtcCents += 1;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une TVA tronquée (19 c pour 99 c à 20 %) et une TVA arrondie au pair (16 c pour 300 c à 5,5 %)", () => {
      for (const [changed, tax] of [[single(1, 99), 19], [single(1, 300, 550), 16]] as const) {
        changed.totals.taxByRate[0].taxCents = tax; changed.totals.taxCents = tax;
        changed.totals.payableTtcCents = changed.totals.netHtCents + tax;
        expectInvalid(() => api.parseClientContract2Snapshot(changed));
      }
    });
    it("refuse un TTC ≠ net + TVA", () => {
      for (const delta of [1, -1]) {
        const changed = contract(); changed.totals.payableTtcCents += delta;
        expectInvalid(() => api.parseClientContract2Snapshot(changed));
      }
    });
    it("refuse Σ bases ≠ HT net (S5, TVA inchangée)", () => {
      const changed = s5(); changed.totals.taxByRate[0].baseHtCents -= 1;
      expect(rateTax(555_452, 1000, false)).toBe(55_545);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse une base de taux supérieure au brut chiffré de ce taux (S5, Σ et TVA inchangées)", () => {
      const changed = s5();
      changed.totals.taxByRate = [
        { rateBp: 1000, baseHtCents: 555_462, taxCents: 55_546 },
        { rateBp: 2000, baseHtCents: 6_349_893, taxCents: 1_269_979 },
      ];
      expect(changed.totals.taxByRate.reduce((sum, entry) => sum + entry.taxCents, 0)).toBe(changed.totals.taxCents);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un récapitulatif dont les taux ne sont pas ceux des lignes chiffrées", () => {
      const lineRate = contract(); lineRow(lineRate, 7).taxRateBp = 1000;
      const absentRate = contract(); absentRate.totals.taxByRate.unshift({ rateBp: 1000, baseHtCents: 0, taxCents: 0 });
      const duplicated = contract(); duplicated.totals.taxByRate.push({ rateBp: 2000, baseHtCents: 0, taxCents: 0 });
      const unsorted = s5(); unsorted.totals.taxByRate.reverse();
      const notPriced = contract(); notPriced.totals.taxByRate.unshift({ rateBp: 550, baseHtCents: 0, taxCents: 0 });
      const empty = contract(); empty.totals.taxByRate = []; empty.totals.taxCents = 0;
      empty.totals.payableTtcCents = empty.totals.netHtCents;
      for (const changed of [lineRate, absentRate, duplicated, unsorted, notPriced, empty]) {
        expectInvalid(() => api.parseClientContract2Snapshot(changed));
      }
    });
    it("refuse une TVA en autoliquidation, ou un indicateur contraire au rôle d'entreprise", () => {
      const taxed = reverseCharge(); taxed.totals.taxByRate[0].taxCents = 1_381_071;
      taxed.totals.taxCents = 1_381_071; taxed.totals.payableTtcCents = 8_286_426;
      const flagOnly = contract(); flagOnly.totals.reverseCharge = true; rebase(flagOnly);
      const roleOnly = contract(); roleOnly.version.contractorRole = "subcontractor";
      for (const changed of [taxed, flagOnly, roleOnly]) expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
  });

  describe("F27-V09 arbre et forme JSON", () => {
    it.each([
      ["identifiant en double", "rows.10.id", lineId(6)], ["parent inconnu", "rows.1.parentId", ID.other],
      ["parent qui est une ligne", "rows.2.parentId", lineId(1)], ["profondeur fausse", "rows.1.depth", 0],
      ["position fractionnaire", "rows.1.position", 0.5], ["section auto-parente", "rows.0.parentId", ID.sectionA],
      ["genre inconnu", "rows.1.kind", "article"], ["identifiant non uuid", "rows.1.id", "line-1"],
    ] as Array<[string, string, unknown]>)("refuse %s", (_name, target, value) => {
      const changed = contract(); setAt(changed, target, value);
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse un cycle de deux sections sans boucler", () => {
      const changed = contract();
      changed.rows.push({ ...row(changed, ID.sectionA), id: ID.other, parentId: ID.sectionA, depth: 1 } as Section2);
      row(changed, ID.sectionA).parentId = ID.other;
      expectInvalid(() => api.parseClientContract2Snapshot(changed));
    });
    it("refuse les objets non simples, les tableaux creux, les accesseurs et les prototypes hérités", () => {
      const sparse = contract(); delete (sparse.rows as unknown[])[3];
      const accessor = contract();
      Object.defineProperty(accessor.totals, "taxCents", { enumerable: true, get: () => 1_381_071 });
      const inherited = Object.assign(Object.create({ inherited: true }), contract());
      for (const candidate of [null, [], new Date(), "contract", sparse, accessor, inherited]) {
        expectInvalid(() => api.parseClientContract2Snapshot(candidate));
      }
    });
    it("n'expose jamais la valeur d'une entrée hostile", () => {
      const hostile = new Proxy(contract(), { ownKeys() { throw new Error("SECRET-VALUE-42"); } });
      let failure: unknown;
      try { api.parseClientContract2Snapshot(hostile); } catch (error) { failure = error; }
      expect(failure).toBeInstanceOf(OfferContractError);
      expect((failure as Error).message).not.toContain("SECRET-VALUE-42");
    });
  });

  describe("F27-V10 appariement : v3 ⇔ contrat 2, v1/v2 ⇔ contrat 1", () => {
    it("le parseur 2 refuse une copie de contrat 1 valide", () => {
      expect(parseClientContractSnapshot(contract1())).toEqual(contract1());
      expectInvalid(() => api.parseClientContract2Snapshot(contract1()));
    });
    it("le parseur 1 refuse une copie de contrat 2 valide (validateurs du contrat 1 inchangés)", () => {
      expect(api.parseClientContract2Snapshot(contract())).toEqual(contract());
      expectInvalid(() => parseClientContractSnapshot(contract()));
    });
  });
});

describe("Preuve de document au marqueur de contrat 2 (D14, offer-contract.ts)", () => {
  it("F27-V11 accepte une preuve `clientContractVersion: 2` portant une copie de contrat 2 stricte", () => {
    const published = proof();
    expect(parseOfferDocumentProof(published)).toEqual(published);
    const portions = proof(withPortions()); portions.layoutOptions = layout("fo_mo_and_total");
    expect(parseOfferDocumentProof(portions)).toEqual(portions);
  });
  it("F27-V12 refuse un appariement croisé, une ancre fausse ou un mode de prix contraire", () => {
    const crossed1 = proof(contract1(), 2);
    const crossed2 = proof(contract(), 1);
    const corrupted = proof(contract()); setAt(corrupted, "clientContractSnapshot.totals.taxCents", 1_381_072);
    const wrongVersion = proof(); wrongVersion.versionId = ID.other;
    const wrongRevision = proof(); wrongRevision.publishedContentRevision = 8;
    const wrongPublisher = proof(); wrongPublisher.generatedBy = ID.other;
    const hiddenPortions = proof(withPortions());
    const missingPortions = proof(); missingPortions.layoutOptions = layout("fo_mo_and_total");
    const legacyPurpose = proof(); legacyPurpose.publishedPurpose = "legacy";
    for (const changed of [crossed1, crossed2, corrupted, wrongVersion, wrongRevision, wrongPublisher,
      hiddenPortions, missingPortions, legacyPurpose]) {
      expectInvalid(() => parseOfferDocumentProof(changed), "OFFER_DOCUMENT_PROOF_INVALID");
    }
  });
});
