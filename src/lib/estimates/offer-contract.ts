import { createHash } from "node:crypto";

import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

type SaleFoMo1 = { foSaleHtCents: number; moSaleHtCents: number };
type Section1 = {
  kind: "section";
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  number: string;
  title: string;
  saleHtCents: number;
};
type Line1 = {
  kind: "line";
  id: string;
  parentId: string | null;
  position: number;
  depth: number;
  title: string;
  quantity: number;
  unit: string;
  unitSaleHtCents: number;
  saleHtCents: number;
};
export type CommercialRow1 = Section1 | Line1 | (Section1 & SaleFoMo1) | (Line1 & SaleFoMo1);

export type ClientContract1 = {
  schemaVersion: 1;
  version: {
    id: string;
    tenantId: string;
    projectId: string;
    number: number;
    contentRevision: number;
    calcEngineVersion: 1 | 2;
    dateDevis: string;
    validiteJours: number;
    currency: "EUR" | "USD" | "GBP";
    contractorRole: "principal" | "subcontractor";
    taxRateBp: number;
  };
  project: {
    name: string;
    reference: string | null;
    estimateReference: string | null;
    clientName: string | null;
    siteAddress: string | null;
  };
  issuer: {
    userId: string;
    displayName: string;
    displayRole: string | null;
    phone: string | null;
    email: string | null;
  };
  company: {
    name: string;
    tagline: string;
    address: { street: string; postalCode: string; city: string };
    registeredOffice: { street: string; postalCode: string; city: string };
    phone: { landline: string; mobile: string };
    legal: { siret: string; vat: string };
  };
  rows: CommercialRow1[];
  totals: {
    saleHtCents: number;
    taxCents: number;
    calculatedTtcCents: number;
    payableTtcCents: number;
    roundingAdjustmentCents: number;
  };
  exclusions: string | null;
};

type TermsFields = {
  templateId: string;
  title: string;
  body: string;
  version: number;
  capturedAt: string;
};
export type OfferTermsSnapshot =
  | (TermsFields & { legalReviewedAt: string })
  | (TermsFields & { legalReviewedAt: string | null; isDraft: true });
type ProofFields = {
  proofVersion: 1;
  documentId: string;
  tenantId: string;
  versionId: string;
  projectId: string;
  status: "ready";
  filePath: string;
  sha256Hash: string;
  publishedDispatchId: string | null;
  publishedContentRevision: number;
  layoutOptions: EstimatePdfLayoutOptions;
  termsSnapshot: OfferTermsSnapshot | null;
};
export type DocumentProof1 = ProofFields & (
  | {
      clientContractVersion: 1;
      clientContractSnapshot: ClientContract1;
      fileSizeBytes: number;
      generatedAt: string;
      generatedBy: string;
      publishedGenerationToken: string;
      publishedPurpose: "manual" | "email" | "workflow";
    }
  | {
      clientContractVersion: null;
      clientContractSnapshot: null;
      fileSizeBytes: number | null;
      generatedAt: string | null;
      generatedBy: string | null;
      publishedGenerationToken: string | null;
      publishedPurpose: "legacy" | "manual" | "email" | "workflow";
    }
);
export type Seal5 = {
  meta: {
    payloadVersion: 5;
    versionId: string;
    tenantId: string;
    projectId: string;
    contentRevision: number;
    calcEngineVersion: 1 | 2;
  };
  calculation: { payloadVersion: 4; sha256: string };
  clientContract: ClientContract1;
  document: {
    sha256Hash: string;
    layoutOptions: EstimatePdfLayoutOptions;
    termsSnapshot: OfferTermsSnapshot | null;
  };
};
export type OfferProofParseOptions = { allowDevelopmentTerms?: boolean };
export type OfferPresentation = {
  contract: ClientContract1;
  layout: EstimatePdfLayoutOptions;
  terms: OfferTermsSnapshot | null;
};
export type OfferContractErrorCode =
  | "OFFER_CLIENT_CONTRACT_INVALID"
  | "OFFER_DOCUMENT_PROOF_INVALID"
  | "OFFER_SEAL_INPUT_INVALID"
  | "OFFER_PRESENTATION_INVALID";

export class OfferContractError extends Error {
  constructor(public readonly code: OfferContractErrorCode, message: string) {
    super(message);
    this.name = "OfferContractError";
  }
}

const MAX_CENTS = 2_147_483_647;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
type RecordValue = Record<string, unknown>;

class InvalidValue extends Error {}

function invalid(location: string): never {
  throw new InvalidValue(`Invalid offer contract at ${location}.`);
}

function object(value: unknown, required: readonly string[], location: string, optional: readonly string[] = []): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(location);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(location);
  const allowed = new Set([...required, ...optional]);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !allowed.has(key)) invalid(location);
    const descriptor = descriptors[key];
    if (!descriptor.enumerable || !("value" in descriptor)) invalid(location);
  }
  if (required.some((key) => !Object.hasOwn(descriptors, key))) invalid(location);
  return value as RecordValue;
}

function text(value: unknown, location: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) invalid(location);
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(location);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid(location);
    }
  }
  return value;
}

function nullableText(value: unknown, location: string): string | null {
  return value === null ? null : text(value, location);
}

function integer(value: unknown, minimum: number, maximum: number, location: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0)
    || value < minimum || value > maximum) invalid(location);
  return value;
}

function cents(value: unknown, location: string): number {
  return integer(value, 0, MAX_CENTS, location);
}

function uuid(value: unknown, location: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) invalid(location);
  return value;
}

function nullableUuid(value: unknown, location: string): string | null {
  return value === null ? null : uuid(value, location);
}

function hash(value: unknown, location: string): string {
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) invalid(location);
  return value;
}

function choice<T extends string | number | null>(value: unknown, values: readonly T[], location: string): T {
  if (!values.includes(value as T)) invalid(location);
  return value as T;
}

function boolean(value: unknown, location: string): boolean {
  if (typeof value !== "boolean") invalid(location);
  return value;
}

function validCalendar(year: number, month: number, day: number): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function date(value: unknown, location: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(location);
  const [year, month, day] = value.split("-").map(Number);
  if (!validCalendar(year, month, day)) invalid(location);
  return value;
}

function instant(value: unknown, location: string): { original: string; utc: string } {
  if (typeof value !== "string") invalid(location);
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([Zz]|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) invalid(location);
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  if (!validCalendar(year, month, day) || hour > 23 || minute > 59 || second > 59
    || offsetHour > 23 || offsetMinute > 59) invalid(location);
  const offset = (offsetHour * 60 + offsetMinute) * (match[9] === "-" ? -1 : 1);
  const wholeSecond = new Date(0);
  wholeSecond.setUTCFullYear(year, month - 1, day);
  wholeSecond.setUTCHours(hour, minute, second, 0);
  const utc = new Date(wholeSecond.getTime() - offset * 60_000).toISOString();
  if (!/^\d{4}-/.test(utc) || utc.startsWith("0000-")) invalid(location);
  // Date handles only whole seconds/zone arithmetic. Never pass the microseconds
  // through its millisecond precision; preserve them as an independent fraction.
  return { original: value, utc: `${utc.slice(0, -5)}.${(match[7] ?? "").padEnd(6, "0")}Z` };
}

function calendarOrInstant(value: unknown, location: string): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value, location);
  return instant(value, location).original;
}

function address(value: unknown, location: string): ClientContract1["company"]["address"] {
  const source = object(value, ["street", "postalCode", "city"], location);
  return {
    street: text(source.street, `${location}.street`),
    postalCode: text(source.postalCode, `${location}.postalCode`),
    city: text(source.city, `${location}.city`),
  };
}

function row(value: unknown): CommercialRow1 {
  const kind = typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, "kind")?.value : undefined;
  const section = kind === "section";
  choice(kind, ["section", "line"], "rows.kind");
  const source = object(value, ["kind", "id", "parentId", "position", "depth", "title", "saleHtCents",
    ...(section ? ["number"] : ["quantity", "unit", "unitSaleHtCents"])], "rows", ["foSaleHtCents", "moSaleHtCents"]);
  const common = {
    id: uuid(source.id, "rows.id"), parentId: nullableUuid(source.parentId, "rows.parentId"),
    position: integer(source.position, 0, MAX_CENTS, "rows.position"),
    depth: integer(source.depth, 0, section ? 3 : 4, "rows.depth"),
    title: text(source.title, "rows.title"), saleHtCents: cents(source.saleHtCents, "rows.saleHtCents"),
  };
  let portions: SaleFoMo1 | Record<string, never> = {};
  if (Object.hasOwn(source, "foSaleHtCents") || Object.hasOwn(source, "moSaleHtCents")) {
    portions = { foSaleHtCents: cents(source.foSaleHtCents, "rows.foSaleHtCents"),
      moSaleHtCents: cents(source.moSaleHtCents, "rows.moSaleHtCents") };
    if (portions.foSaleHtCents + portions.moSaleHtCents !== common.saleHtCents) invalid("rows.sale portions");
  }
  if (section) return { kind: "section", ...common, number: text(source.number, "rows.number"), ...portions };
  if (typeof source.quantity !== "number" || !Number.isFinite(source.quantity)
    || Object.is(source.quantity, -0) || source.quantity < 0 || source.quantity > Number.MAX_SAFE_INTEGER) invalid("rows.quantity");
  return { kind: "line", ...common, quantity: source.quantity, unit: text(source.unit, "rows.unit"),
    unitSaleHtCents: cents(source.unitSaleHtCents, "rows.unitSaleHtCents"), ...portions };
}

function hasPortions(value: CommercialRow1): value is CommercialRow1 & SaleFoMo1 {
  return "foSaleHtCents" in value && "moSaleHtCents" in value;
}

function addCents(left: number, right: number): number {
  return cents(left + right, "rows.aggregate");
}

function validateRows(rows: CommercialRow1[], contract: ClientContract1): void {
  const byId = new Map(rows.map((entry) => [entry.id, entry]));
  if (byId.size !== rows.length) invalid("rows.duplicate");
  const portions = rows.length > 0 && hasPortions(rows[0]);
  for (const entry of rows) {
    if (hasPortions(entry) !== portions) invalid("rows.sale portions");
    const parent = entry.parentId === null ? null : byId.get(entry.parentId);
    if (entry.parentId !== null && (!parent || parent.kind !== "section")) invalid("rows.parent");
    if (entry.depth !== (parent ? parent.depth + 1 : 0)) invalid("rows.depth");
  }
  // Positive parent-depth increments with bounded depth exclude all cycles.
  // Engine1 deliberately retains its original presented detail/footer mismatch.
  if (contract.version.calcEngineVersion === 1) return;
  const sectionTotals = new Map<string, { ht: number; fo: number; mo: number }>();
  for (const entry of rows) if (entry.kind === "section") sectionTotals.set(entry.id, { ht: 0, fo: 0, mo: 0 });
  let totalHt = 0;
  for (const entry of rows) {
    if (entry.kind !== "line") continue;
    totalHt = addCents(totalHt, entry.saleHtCents);
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
  if (totalHt !== contract.totals.saleHtCents) invalid("totals.saleHtCents");
  for (const entry of rows) {
    if (entry.kind !== "section") continue;
    const totals = sectionTotals.get(entry.id)!;
    if (entry.saleHtCents !== totals.ht || (hasPortions(entry)
      && (entry.foSaleHtCents !== totals.fo || entry.moSaleHtCents !== totals.mo))) invalid("rows.section totals");
  }
}

function parseSnapshot(value: unknown): ClientContract1 {
  const source = object(value, ["schemaVersion", "version", "project", "issuer", "company", "rows", "totals", "exclusions"], "snapshot");
  choice(source.schemaVersion, [1], "snapshot.schemaVersion");
  const version = object(source.version, ["id", "tenantId", "projectId", "number", "contentRevision", "calcEngineVersion",
    "dateDevis", "validiteJours", "currency", "contractorRole", "taxRateBp"], "version");
  const project = object(source.project, ["name", "reference", "estimateReference", "clientName", "siteAddress"], "project");
  const issuer = object(source.issuer, ["userId", "displayName", "displayRole", "phone", "email"], "issuer");
  const company = object(source.company, ["name", "tagline", "address", "registeredOffice", "phone", "legal"], "company");
  const phone = object(company.phone, ["landline", "mobile"], "company.phone");
  const legal = object(company.legal, ["siret", "vat"], "company.legal");
  const totals = object(source.totals, ["saleHtCents", "taxCents", "calculatedTtcCents", "payableTtcCents", "roundingAdjustmentCents"], "totals");
  const sourceRows = source.rows;
  if (!Array.isArray(sourceRows) || Object.getPrototypeOf(sourceRows) !== Array.prototype) invalid("rows");
  // Array.map skips holes, so inspect density before copying any row.
  for (let index = 0; index < sourceRows.length; index += 1) {
    if (!Object.hasOwn(sourceRows, index)) invalid("rows.sparse");
    const descriptor = Object.getOwnPropertyDescriptor(sourceRows, String(index));
    if (!descriptor || !("value" in descriptor)) invalid("rows");
  }
  if (Reflect.ownKeys(sourceRows).some((key) => key !== "length"
    && (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= sourceRows.length))) invalid("rows");
  const parsed: ClientContract1 = {
    schemaVersion: 1,
    version: {
      id: uuid(version.id, "version.id"), tenantId: uuid(version.tenantId, "version.tenantId"),
      projectId: uuid(version.projectId, "version.projectId"), number: integer(version.number, 1, MAX_CENTS, "version.number"),
      contentRevision: integer(version.contentRevision, 1, Number.MAX_SAFE_INTEGER, "version.contentRevision"),
      calcEngineVersion: choice(version.calcEngineVersion, [1, 2], "version.calcEngineVersion"),
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
    totals: { saleHtCents: cents(totals.saleHtCents, "totals.saleHtCents"), taxCents: cents(totals.taxCents, "totals.taxCents"),
      calculatedTtcCents: cents(totals.calculatedTtcCents, "totals.calculatedTtcCents"), payableTtcCents: cents(totals.payableTtcCents, "totals.payableTtcCents"),
      roundingAdjustmentCents: integer(totals.roundingAdjustmentCents, -MAX_CENTS, MAX_CENTS, "totals.roundingAdjustmentCents") },
    exclusions: nullableText(source.exclusions, "exclusions"),
  };
  const amounts = parsed.totals;
  if (addCents(amounts.saleHtCents, amounts.taxCents) !== amounts.calculatedTtcCents
    || amounts.calculatedTtcCents + amounts.roundingAdjustmentCents !== amounts.payableTtcCents) invalid("totals");
  if (parsed.version.contractorRole === "subcontractor" && (amounts.taxCents !== 0 || amounts.roundingAdjustmentCents !== 0)) invalid("totals.reverse charge");
  validateRows(parsed.rows, parsed);
  return parsed;
}

function parseLayout(value: unknown): EstimatePdfLayoutOptions {
  const source = object(value, ["preset", "detailLevel", "priceMode", "density", "showNumbering", "showSectionSubtotals", "conditionsPlacement", "includeTerms"], "layoutOptions");
  return {
    preset: choice(source.preset, ["client_detailed", "decision_summary", "fo_mo"], "layoutOptions.preset"),
    detailLevel: choice(source.detailLevel, [1, 2, 3, 4, "lines"], "layoutOptions.detailLevel"),
    priceMode: choice(source.priceMode, ["total_only", "unit_and_total", "fo_mo_and_total"], "layoutOptions.priceMode"),
    density: choice(source.density, ["compact", "standard", "comfortable"], "layoutOptions.density"),
    showNumbering: boolean(source.showNumbering, "layoutOptions.showNumbering"),
    showSectionSubtotals: boolean(source.showSectionSubtotals, "layoutOptions.showSectionSubtotals"),
    conditionsPlacement: choice(source.conditionsPlacement, ["auto", "new_page"], "layoutOptions.conditionsPlacement"),
    includeTerms: boolean(source.includeTerms, "layoutOptions.includeTerms"),
  };
}

function parseTerms(value: unknown, options: OfferProofParseOptions): OfferTermsSnapshot | null {
  if (value === null) return null;
  const source = object(value, ["templateId", "title", "body", "version", "legalReviewedAt", "capturedAt"], "termsSnapshot", ["isDraft"]);
  const draft = Object.hasOwn(source, "isDraft");
  if (draft && (source.isDraft !== true || options.allowDevelopmentTerms !== true)) invalid("termsSnapshot.isDraft");
  const fields: TermsFields = { templateId: text(source.templateId, "termsSnapshot.templateId"), title: text(source.title, "termsSnapshot.title"),
    body: text(source.body, "termsSnapshot.body"), version: integer(source.version, 1, Number.MAX_SAFE_INTEGER, "termsSnapshot.version"),
    capturedAt: instant(source.capturedAt, "termsSnapshot.capturedAt").original };
  if (draft) return { ...fields, legalReviewedAt: source.legalReviewedAt === null ? null : calendarOrInstant(source.legalReviewedAt, "termsSnapshot.legalReviewedAt"), isDraft: true };
  return { ...fields, legalReviewedAt: calendarOrInstant(source.legalReviewedAt, "termsSnapshot.legalReviewedAt") };
}

function parseProof(value: unknown, options: OfferProofParseOptions): DocumentProof1 {
  const source = object(value, ["proofVersion", "documentId", "tenantId", "versionId", "projectId", "status", "filePath", "sha256Hash", "fileSizeBytes",
    "generatedAt", "generatedBy", "publishedGenerationToken", "publishedPurpose", "publishedDispatchId", "publishedContentRevision", "clientContractVersion",
    "clientContractSnapshot", "layoutOptions", "termsSnapshot"], "documentProof");
  const marker = choice(source.clientContractVersion, [1, null] as const, "documentProof.clientContractVersion");
  const layout = parseLayout(source.layoutOptions);
  const terms = parseTerms(source.termsSnapshot, options);
  if (layout.includeTerms && terms === null) invalid("documentProof.termsSnapshot");
  const common: ProofFields = {
    proofVersion: choice(source.proofVersion, [1], "documentProof.proofVersion"), documentId: uuid(source.documentId, "documentProof.documentId"),
    tenantId: uuid(source.tenantId, "documentProof.tenantId"), versionId: uuid(source.versionId, "documentProof.versionId"),
    projectId: uuid(source.projectId, "documentProof.projectId"), status: choice(source.status, ["ready"], "documentProof.status"),
    filePath: text(source.filePath, "documentProof.filePath"), sha256Hash: hash(source.sha256Hash, "documentProof.sha256Hash"),
    publishedDispatchId: nullableUuid(source.publishedDispatchId, "documentProof.publishedDispatchId"),
    publishedContentRevision: integer(source.publishedContentRevision, 1, Number.MAX_SAFE_INTEGER, "documentProof.publishedContentRevision"),
    layoutOptions: layout, termsSnapshot: terms,
  };
  const purpose = choice(source.publishedPurpose, ["legacy", "manual", "email", "workflow"], "documentProof.publishedPurpose");
  const canonicalPath = `${common.tenantId}/${common.projectId}/${common.versionId}/${common.sha256Hash}.pdf`;
  if (marker === null) {
    if (source.clientContractSnapshot !== null || !layout.includeTerms || !terms) invalid("documentProof.legacy");
    const prefix = `${common.tenantId}/${common.projectId}/`;
    const filename = common.filePath.slice(prefix.length);
    const originalFlatPath = purpose === "legacy" && common.filePath.startsWith(prefix)
      && filename.length > 4 && !filename.includes("/") && filename.endsWith(".pdf");
    if (common.filePath !== canonicalPath && !originalFlatPath) invalid("documentProof.filePath");
    return { ...common, clientContractVersion: null, clientContractSnapshot: null,
      fileSizeBytes: source.fileSizeBytes === null ? null : integer(source.fileSizeBytes, 1, Number.MAX_SAFE_INTEGER, "documentProof.fileSizeBytes"),
      generatedAt: source.generatedAt === null ? null : instant(source.generatedAt, "documentProof.generatedAt").utc,
      generatedBy: nullableUuid(source.generatedBy, "documentProof.generatedBy"),
      publishedGenerationToken: nullableUuid(source.publishedGenerationToken, "documentProof.publishedGenerationToken"), publishedPurpose: purpose };
  }
  if (purpose === "legacy" || common.filePath !== canonicalPath) invalid("documentProof.publication");
  const captured = parseSnapshot(source.clientContractSnapshot);
  const generatedBy = uuid(source.generatedBy, "documentProof.generatedBy");
  if (captured.version.id !== common.versionId || captured.version.tenantId !== common.tenantId
    || captured.version.projectId !== common.projectId || captured.version.contentRevision !== common.publishedContentRevision
    || captured.issuer.userId !== generatedBy) invalid("documentProof.anchors");
  if ((purpose === "email") !== (common.publishedDispatchId !== null)) invalid("documentProof.publishedDispatchId");
  if (captured.rows.some((entry) => hasPortions(entry) !== (layout.priceMode === "fo_mo_and_total"))) invalid("documentProof.priceMode");
  return { ...common, clientContractVersion: 1, clientContractSnapshot: captured,
    fileSizeBytes: integer(source.fileSizeBytes, 1, Number.MAX_SAFE_INTEGER, "documentProof.fileSizeBytes"),
    generatedAt: instant(source.generatedAt, "documentProof.generatedAt").utc, generatedBy,
    publishedGenerationToken: uuid(source.publishedGenerationToken, "documentProof.publishedGenerationToken"), publishedPurpose: purpose };
}

function run<T>(code: OfferContractErrorCode, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    // Unknown input can contain throwing proxies. Do not echo their values or
    // messages; the public interface exposes only a stable code and location.
    throw new OfferContractError(code, error instanceof InvalidValue ? error.message : "Invalid offer contract.");
  }
}

/** Parse a strict commercial copy without repairing or consulting live data. */
export function parseClientContractSnapshot(value: unknown): ClientContract1 {
  return run("OFFER_CLIENT_CONTRACT_INVALID", () => parseSnapshot(value));
}

/** Parse the stored proof image. This does not attest bytes, delivery or legal approval. */
export function parseOfferDocumentProof(value: unknown, options: OfferProofParseOptions = {}): DocumentProof1 {
  return run("OFFER_DOCUMENT_PROOF_INVALID", () => parseProof(value, options));
}

/** Validate presentation before PDF bytes exist, without fabricating a ready proof. */
export function parseOfferPresentation(value: unknown, options: OfferProofParseOptions = {}): OfferPresentation {
  return run("OFFER_PRESENTATION_INVALID", () => {
    const source = object(value, ["contract", "layout", "terms"], "presentation");
    const contract = parseSnapshot(source.contract);
    const layout = parseLayout(source.layout);
    const terms = parseTerms(source.terms, options);
    if (layout.includeTerms && terms === null) invalid("presentation.terms");
    if (contract.rows.some((entry) => hasPortions(entry) !== (layout.priceMode === "fo_mo_and_total"))) invalid("presentation.priceMode");
    return { contract, layout, terms };
  });
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object" && value !== null) {
    const source = value as RecordValue;
    return Object.fromEntries(Object.keys(source).sort().map((key) => [key, canonicalValue(source[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/** Seal5 binds a caller-supplied actual builder4 hash to the captured copy/PDF. */
export function computeOfferSealHash(input: {
  calculationHash: string;
  snapshot: unknown;
  documentProof: unknown;
}, options: OfferProofParseOptions = {}): string {
  return run("OFFER_SEAL_INPUT_INVALID", () => {
    const source = object(input, ["calculationHash", "snapshot", "documentProof"], "seal input");
    const calculationHash = hash(source.calculationHash, "seal calculationHash");
    const captured = parseSnapshot(source.snapshot);
    const proof = parseProof(source.documentProof, options);
    if (proof.clientContractVersion !== 1 || canonicalJson(captured) !== canonicalJson(proof.clientContractSnapshot)) invalid("seal document copy");
    const payload: Seal5 = {
      meta: { payloadVersion: 5, versionId: captured.version.id, tenantId: captured.version.tenantId,
        projectId: captured.version.projectId, contentRevision: captured.version.contentRevision, calcEngineVersion: captured.version.calcEngineVersion },
      calculation: { payloadVersion: 4, sha256: calculationHash },
      clientContract: captured,
      document: { sha256Hash: proof.sha256Hash, layoutOptions: proof.layoutOptions, termsSnapshot: proof.termsSnapshot },
    };
    return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
  });
}
