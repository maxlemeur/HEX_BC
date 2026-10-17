import {
  address,
  cents,
  choice,
  date,
  integer,
  invalid,
  MAX_CENTS,
  nullableText,
  nullableUuid,
  object,
  run,
  text,
  uuid,
  type RecordValue,
} from "@/lib/estimates/offer-contract-core";
import type { ClientContract1 } from "@/lib/estimates/offer-contract";
import { ESTIMATE_LINE_PRICING_STATUSES, type EstimateLinePricingStatus } from "@/lib/units/normalize";

/**
 * Lot 2, sous-lot 2.7 - analyse stricte du contrat client 2 (conception D7, D8, D14 ;
 * docs/testing/estimate-engine-v3-2.7.md §11). Réservé au moteur 3 : lignes BRUTES
 * (PT = ⌈Q × PU⌋), unité et statut, pied v3 (brut, remise, arrondi commercial, HT net, TVA par
 * taux sur la base nette, TTC). Aucune réparation, aucune consultation de données vivantes (ni le
 * référentiel d'unités, ni la version) : une copie altérée d'un centime, d'une clé ou d'un type
 * est refusée. Les blocs `version`, `project`, `issuer` et `company` reprennent les validateurs du
 * contrat 1. Module bas (sans dépendance d'exécution vers `offer-contract.ts`) : l'interface
 * publique est `offer-contract-v2.ts`.
 */

type SaleFoMo2 = { foSaleHtCents: number; moSaleHtCents: number };
type Section2 = {
  kind: "section";
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  number: string;
  title: string;
  saleHtCents: number;
};
type Line2 = {
  kind: "line";
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  title: string;
  quantity: number;
  /** Code du référentiel (`^[a-z][a-z0-9]*$`), nul sans unité. */
  unitCode: string | null;
  /** Libellé imprimé (symbole du référentiel), nul sans unité. */
  unitLabel: string | null;
  pricingStatus: EstimateLinePricingStatus;
  taxRateBp: number;
  /** PU brut publié, nul sur une ligne non chiffrée. */
  unitSaleHtCents: number | null;
  /** Brut de ligne ⌈Q × PU⌋ (0 sur une ligne non chiffrée). */
  saleHtCents: number;
};
export type CommercialRow2 = Section2 | Line2 | (Section2 & SaleFoMo2) | (Line2 & SaleFoMo2);
export type ClientContract2DiscountIntent = { kind: "none" | "amount" } | { kind: "rate"; rateBp: number };
export type ClientContract2TaxRate = { rateBp: number; baseHtCents: number; taxCents: number };

export type ClientContract2 = {
  schemaVersion: 2;
  version: Omit<ClientContract1["version"], "calcEngineVersion"> & { calcEngineVersion: 3 };
  project: ClientContract1["project"];
  issuer: ClientContract1["issuer"];
  company: ClientContract1["company"];
  rows: CommercialRow2[];
  totals: {
    grossHtCents: number;
    commercialDiscountCents: number;
    discountIntent: ClientContract2DiscountIntent;
    commercialRoundingCents: number;
    netHtCents: number;
    taxByRate: ClientContract2TaxRate[];
    taxCents: number;
    payableTtcCents: number;
    reverseCharge: boolean;
  };
  exclusions: string | null;
};

const UNIT_CODE_PATTERN = /^[a-z][a-z0-9]*$/;
const UNIT_CODE_MAX_LENGTH = 16;
/** `numeric(12,3)` : 0 à 999 999 999,999, au plus 3 décimales, sans écriture exponentielle. */
const QUANTITY_PATTERN = /^(0|[1-9]\d{0,8})(\.\d{1,3})?$/;
const TWO = BigInt(2);
const THOUSAND = BigInt(1000);
const BASIS = BigInt(10_000);

function kindOf(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, "kind")?.value : undefined;
}

/** Demi supérieur sur des entiers positifs exacts (D13). */
function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (TWO * numerator + denominator) / (TWO * denominator);
}

function quantity(value: unknown, location: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Object.is(value, -0)
    || !QUANTITY_PATTERN.test(String(value))) invalid(location);
  return value;
}

function thousandths(value: number): bigint {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole) * THOUSAND + BigInt(fraction.padEnd(3, "0"));
}

/** ⌈Q × PU⌋ en décimal exact (A4) : jamais en flottant (1,005 × 100 vaut 100,4999… en double). */
export function grossOfQuantity(quantityValue: number, unitSaleHtCents: number): bigint {
  return halfUp(thousandths(quantityValue) * BigInt(unitSaleHtCents), THOUSAND);
}

/** TVA d'un taux : ⌈base × taux / 10 000⌋ (A5), 0 en autoliquidation. */
export function taxOfRate(baseHtCents: number, rateBp: number, reverseCharge: boolean): number {
  return reverseCharge ? 0 : Number(halfUp(BigInt(baseHtCents) * BigInt(rateBp), BASIS));
}

function unitCode(value: unknown, location: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > UNIT_CODE_MAX_LENGTH || !UNIT_CODE_PATTERN.test(value)) invalid(location);
  return value;
}

function denseArray(value: unknown, location: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalid(location);
  // Array.map skips holes, so inspect density before copying any entry.
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) invalid(`${location}.sparse`);
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !("value" in descriptor)) invalid(location);
  }
  if (Reflect.ownKeys(value).some((key) => key !== "length"
    && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) invalid(location);
  return value;
}

function portionsOf(source: RecordValue, saleHtCents: number): SaleFoMo2 | Record<string, never> {
  if (!Object.hasOwn(source, "foSaleHtCents") && !Object.hasOwn(source, "moSaleHtCents")) return {};
  const portions = { foSaleHtCents: cents(source.foSaleHtCents, "rows.foSaleHtCents"),
    moSaleHtCents: cents(source.moSaleHtCents, "rows.moSaleHtCents") };
  if (portions.foSaleHtCents + portions.moSaleHtCents !== saleHtCents) invalid("rows.sale portions");
  return portions;
}

function row(value: unknown): CommercialRow2 {
  const kind = kindOf(value);
  const section = kind === "section";
  choice(kind, ["section", "line"], "rows.kind");
  const source = object(value, ["kind", "id", "parentId", "position", "depth", "title", "saleHtCents",
    ...(section ? ["number"] : ["quantity", "unitCode", "unitLabel", "pricingStatus", "taxRateBp", "unitSaleHtCents"])],
  "rows", ["foSaleHtCents", "moSaleHtCents"]);
  const common = {
    id: uuid(source.id, "rows.id"), parentId: nullableUuid(source.parentId, "rows.parentId"),
    position: integer(source.position, 0, MAX_CENTS, "rows.position"),
    depth: integer(source.depth, 0, section ? 3 : 4, "rows.depth"),
    title: text(source.title, "rows.title"), saleHtCents: cents(source.saleHtCents, "rows.saleHtCents"),
  };
  const portions = portionsOf(source, common.saleHtCents);
  if (section) return { kind: "section", ...common, number: text(source.number, "rows.number"), ...portions };
  const line: Line2 = {
    kind: "line", ...common, quantity: quantity(source.quantity, "rows.quantity"),
    unitCode: unitCode(source.unitCode, "rows.unitCode"), unitLabel: nullableText(source.unitLabel, "rows.unitLabel"),
    pricingStatus: choice(source.pricingStatus, ESTIMATE_LINE_PRICING_STATUSES, "rows.pricingStatus"),
    taxRateBp: integer(source.taxRateBp, 0, 10_000, "rows.taxRateBp"),
    unitSaleHtCents: source.unitSaleHtCents === null ? null : cents(source.unitSaleHtCents, "rows.unitSaleHtCents"),
  };
  if ((line.unitCode === null) !== (line.unitLabel === null)) invalid("rows.unit");
  if (line.pricingStatus === "priced") {
    if (line.unitCode === null || line.unitSaleHtCents === null) invalid("rows.priced");
    if (grossOfQuantity(line.quantity, line.unitSaleHtCents) !== BigInt(line.saleHtCents)) invalid("rows.saleHtCents");
  } else if (line.unitSaleHtCents !== null || line.saleHtCents !== 0) {
    invalid("rows.not priced");
  }
  return { ...line, ...portions };
}

function hasPortions(value: CommercialRow2): value is CommercialRow2 & SaleFoMo2 {
  return "foSaleHtCents" in value && "moSaleHtCents" in value;
}

function addCents(left: number, right: number, location = "rows.aggregate"): number {
  return cents(left + right, location);
}

function validateRows(rows: CommercialRow2[], grossHtCents: number): void {
  const byId = new Map(rows.map((entry) => [entry.id, entry]));
  if (byId.size !== rows.length) invalid("rows.duplicate");
  const portions = rows.length > 0 && hasPortions(rows[0]);
  for (const entry of rows) {
    if (hasPortions(entry) !== portions) invalid("rows.sale portions");
    const parent = entry.parentId === null ? null : byId.get(entry.parentId);
    if (entry.parentId !== null && (!parent || parent.kind !== "section")) invalid("rows.parent");
    if (entry.depth !== (parent ? parent.depth + 1 : 0)) invalid("rows.depth");
  }
  // Positive parent-depth increments with bounded depth exclude all cycles. Unlike engine 1,
  // engine 3 has no presented detail/footer exception: Σ gross lines = gross.
  const sectionTotals = new Map<string, { ht: number; fo: number; mo: number }>();
  for (const entry of rows) if (entry.kind === "section") sectionTotals.set(entry.id, { ht: 0, fo: 0, mo: 0 });
  let totalGross = 0;
  for (const entry of rows) {
    if (entry.kind !== "line") continue;
    totalGross = addCents(totalGross, entry.saleHtCents);
    let parentId = entry.parentId;
    while (parentId !== null) {
      const totals = sectionTotals.get(parentId)!;
      totals.ht = addCents(totals.ht, entry.saleHtCents);
      if (hasPortions(entry)) {
        totals.fo = addCents(totals.fo, entry.foSaleHtCents);
        totals.mo = addCents(totals.mo, entry.moSaleHtCents);
      }
      parentId = byId.get(parentId)!.parentId;
    }
  }
  if (totalGross !== grossHtCents) invalid("totals.grossHtCents");
  for (const entry of rows) {
    if (entry.kind !== "section") continue;
    const totals = sectionTotals.get(entry.id)!;
    if (entry.saleHtCents !== totals.ht || (hasPortions(entry)
      && (entry.foSaleHtCents !== totals.fo || entry.moSaleHtCents !== totals.mo))) invalid("rows.section totals");
  }
}

function discountIntent(value: unknown): ClientContract2DiscountIntent {
  const kind = choice(kindOf(value), ["none", "amount", "rate"] as const, "totals.discountIntent.kind");
  const source = object(value, kind === "rate" ? ["kind", "rateBp"] : ["kind"], "totals.discountIntent");
  return kind === "rate"
    ? { kind, rateBp: integer(source.rateBp, 1, 10_000, "totals.discountIntent.rateBp") }
    : { kind };
}

function taxRate(value: unknown): ClientContract2TaxRate {
  const source = object(value, ["rateBp", "baseHtCents", "taxCents"], "totals.taxByRate");
  return { rateBp: integer(source.rateBp, 0, 10_000, "totals.taxByRate.rateBp"),
    baseHtCents: cents(source.baseHtCents, "totals.taxByRate.baseHtCents"),
    taxCents: cents(source.taxCents, "totals.taxByRate.taxCents") };
}

function validateTotals(contract: ClientContract2): void {
  const totals = contract.totals;
  const gross = totals.grossHtCents;
  const net = gross - totals.commercialDiscountCents - totals.commercialRoundingCents;
  if (net < 0 || net !== totals.netHtCents) invalid("totals.netHtCents");
  const intent = totals.discountIntent;
  const expectedRate = intent.kind === "rate"
    ? Math.min(Number(halfUp(BigInt(gross) * BigInt(intent.rateBp), BASIS)), gross) : null;
  if ((intent.kind === "none" && totals.commercialDiscountCents !== 0)
    || (expectedRate !== null && totals.commercialDiscountCents !== expectedRate)
    || totals.commercialDiscountCents > gross) invalid("totals.commercialDiscountCents");
  if (totals.reverseCharge !== (contract.version.contractorRole === "subcontractor")) invalid("totals.reverseCharge");
  const priced = contract.rows.filter((entry): entry is Line2 => entry.kind === "line" && entry.pricingStatus === "priced");
  const rates = [...new Set(priced.map((entry) => entry.taxRateBp))].sort((left, right) => left - right);
  if (rates.length !== totals.taxByRate.length
    || totals.taxByRate.some((entry, index) => entry.rateBp !== rates[index])) invalid("totals.taxByRate rates");
  let bases = 0;
  let tax = 0;
  for (const entry of totals.taxByRate) {
    const grossOfRate = priced.filter((line) => line.taxRateBp === entry.rateBp)
      .reduce((sum, line) => addCents(sum, line.saleHtCents), 0);
    if (entry.baseHtCents > grossOfRate) invalid("totals.taxByRate.baseHtCents");
    if (entry.taxCents !== taxOfRate(entry.baseHtCents, entry.rateBp, totals.reverseCharge)) invalid("totals.taxByRate.taxCents");
    bases = addCents(bases, entry.baseHtCents, "totals.taxByRate");
    tax = addCents(tax, entry.taxCents, "totals.taxByRate");
  }
  if (bases !== totals.netHtCents) invalid("totals.taxByRate bases");
  if (tax !== totals.taxCents) invalid("totals.taxCents");
  if (addCents(totals.netHtCents, totals.taxCents, "totals.payableTtcCents") !== totals.payableTtcCents) invalid("totals.payableTtcCents");
}

/** Analyse interne (lève `InvalidValue`) : à appeler dans un `run` de `offer-contract-core.ts`. */
export function parseContract2(value: unknown): ClientContract2 {
  const source = object(value, ["schemaVersion", "version", "project", "issuer", "company", "rows", "totals", "exclusions"], "snapshot");
  choice(source.schemaVersion, [2], "snapshot.schemaVersion");
  const version = object(source.version, ["id", "tenantId", "projectId", "number", "contentRevision", "calcEngineVersion",
    "dateDevis", "validiteJours", "currency", "contractorRole", "taxRateBp"], "version");
  const project = object(source.project, ["name", "reference", "estimateReference", "clientName", "siteAddress"], "project");
  const issuer = object(source.issuer, ["userId", "displayName", "displayRole", "phone", "email"], "issuer");
  const company = object(source.company, ["name", "tagline", "address", "registeredOffice", "phone", "legal"], "company");
  const phone = object(company.phone, ["landline", "mobile"], "company.phone");
  const legal = object(company.legal, ["siret", "vat"], "company.legal");
  const totals = object(source.totals, ["grossHtCents", "commercialDiscountCents", "discountIntent", "commercialRoundingCents",
    "netHtCents", "taxByRate", "taxCents", "payableTtcCents", "reverseCharge"], "totals");
  const sourceRows = denseArray(source.rows, "rows");
  const sourceRates = denseArray(totals.taxByRate, "totals.taxByRate");
  const parsed: ClientContract2 = {
    schemaVersion: 2,
    version: {
      id: uuid(version.id, "version.id"), tenantId: uuid(version.tenantId, "version.tenantId"),
      projectId: uuid(version.projectId, "version.projectId"), number: integer(version.number, 1, MAX_CENTS, "version.number"),
      contentRevision: integer(version.contentRevision, 1, Number.MAX_SAFE_INTEGER, "version.contentRevision"),
      calcEngineVersion: choice(version.calcEngineVersion, [3], "version.calcEngineVersion"),
      dateDevis: date(version.dateDevis, "version.dateDevis"), validiteJours: integer(version.validiteJours, 0, MAX_CENTS, "version.validiteJours"),
      currency: choice(version.currency, ["EUR", "USD", "GBP"], "version.currency"),
      contractorRole: choice(version.contractorRole, ["principal", "subcontractor"], "version.contractorRole"),
      taxRateBp: integer(version.taxRateBp, 0, 10_000, "version.taxRateBp"),
    },
    project: { name: text(project.name, "project.name"), reference: nullableText(project.reference, "project.reference"),
      estimateReference: nullableText(project.estimateReference, "project.estimateReference"),
      clientName: nullableText(project.clientName, "project.clientName"), siteAddress: nullableText(project.siteAddress, "project.siteAddress") },
    issuer: { userId: uuid(issuer.userId, "issuer.userId"), displayName: text(issuer.displayName, "issuer.displayName"),
      displayRole: nullableText(issuer.displayRole, "issuer.displayRole"), phone: nullableText(issuer.phone, "issuer.phone"),
      email: nullableText(issuer.email, "issuer.email") },
    company: { name: text(company.name, "company.name"), tagline: text(company.tagline, "company.tagline"),
      address: address(company.address, "company.address"), registeredOffice: address(company.registeredOffice, "company.registeredOffice"),
      phone: { landline: text(phone.landline, "company.phone.landline"), mobile: text(phone.mobile, "company.phone.mobile") },
      legal: { siret: text(legal.siret, "company.legal.siret"), vat: text(legal.vat, "company.legal.vat") } },
    rows: sourceRows.map(row),
    totals: {
      grossHtCents: cents(totals.grossHtCents, "totals.grossHtCents"),
      commercialDiscountCents: cents(totals.commercialDiscountCents, "totals.commercialDiscountCents"),
      discountIntent: discountIntent(totals.discountIntent),
      commercialRoundingCents: cents(totals.commercialRoundingCents, "totals.commercialRoundingCents"),
      netHtCents: cents(totals.netHtCents, "totals.netHtCents"),
      taxByRate: sourceRates.map(taxRate),
      taxCents: cents(totals.taxCents, "totals.taxCents"),
      payableTtcCents: cents(totals.payableTtcCents, "totals.payableTtcCents"),
      reverseCharge: typeof totals.reverseCharge === "boolean" ? totals.reverseCharge : invalid("totals.reverseCharge"),
    },
    exclusions: nullableText(source.exclusions, "exclusions"),
  };
  validateRows(parsed.rows, parsed.totals.grossHtCents);
  validateTotals(parsed);
  return parsed;
}

/** Parts FO/MO présentes sur une ligne ou une section du contrat 2. */
export function hasContract2Portions(value: CommercialRow2): value is CommercialRow2 & SaleFoMo2 {
  return hasPortions(value);
}

/** Analyse stricte d'une copie commerciale v3, sans réparation ni donnée vivante. */
export function parseClientContract2Snapshot(value: unknown): ClientContract2 {
  return run("OFFER_CLIENT_CONTRACT_INVALID", () => parseContract2(value));
}
