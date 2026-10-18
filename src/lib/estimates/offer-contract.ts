import { createHash } from "node:crypto";

import { isLegacyEngine } from "@/lib/estimates/engine/capabilities";
import {
  address,
  canonicalJson,
  cents,
  choice,
  date,
  hash,
  instant,
  integer,
  invalid,
  MAX_CENTS,
  nullableText,
  nullableUuid,
  object,
  parseLayout,
  parseTerms,
  run,
  text,
  uuid,
  type OfferProofParseOptions,
  type OfferTermsSnapshot,
} from "@/lib/estimates/offer-contract-core";
import {
  hasContract2Portions,
  parseContract2,
  type ClientContract2,
} from "@/lib/estimates/offer-contract-v2-parser";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

export {
  OfferContractError,
  type OfferContractErrorCode,
  type OfferProofParseOptions,
  type OfferTermsSnapshot,
} from "@/lib/estimates/offer-contract-core";

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
      // Lot 2, sous-lot 2.7 (D14) : marqueur du contrat client 2, réservé au moteur 3.
      clientContractVersion: 2;
      clientContractSnapshot: ClientContract2;
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
export type OfferPresentation = {
  /** Contrat client 1 (moteurs 1 et 2) ou contrat client 2 (moteur 3, sous-lot 2.7, D14). */
  contract: ClientContract1 | ClientContract2;
  layout: EstimatePdfLayoutOptions;
  terms: OfferTermsSnapshot | null;
};

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
  if (isLegacyEngine(contract.version.calcEngineVersion)) return;
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

function parseProof(value: unknown, options: OfferProofParseOptions): DocumentProof1 {
  const source = object(value, ["proofVersion", "documentId", "tenantId", "versionId", "projectId", "status", "filePath", "sha256Hash", "fileSizeBytes",
    "generatedAt", "generatedBy", "publishedGenerationToken", "publishedPurpose", "publishedDispatchId", "publishedContentRevision", "clientContractVersion",
    "clientContractSnapshot", "layoutOptions", "termsSnapshot"], "documentProof");
  const marker = choice(source.clientContractVersion, [1, 2, null] as const, "documentProof.clientContractVersion");
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
  // Lot 2, sous-lot 2.7 (D14) : le marqueur choisit le contrat, jamais l'inverse. Un contrat 1
  // sous le marqueur 2 (ou l'inverse) est refusé par l'analyseur du marqueur ; mêmes ancres.
  const captured = marker === 2 ? parseContract2(source.clientContractSnapshot) : parseSnapshot(source.clientContractSnapshot);
  const generatedBy = uuid(source.generatedBy, "documentProof.generatedBy");
  if (captured.version.id !== common.versionId || captured.version.tenantId !== common.tenantId
    || captured.version.projectId !== common.projectId || captured.version.contentRevision !== common.publishedContentRevision
    || captured.issuer.userId !== generatedBy) invalid("documentProof.anchors");
  if ((purpose === "email") !== (common.publishedDispatchId !== null)) invalid("documentProof.publishedDispatchId");
  if (rowPortions(captured).some((portions) => portions !== (layout.priceMode === "fo_mo_and_total"))) invalid("documentProof.priceMode");
  const published = {
    fileSizeBytes: integer(source.fileSizeBytes, 1, Number.MAX_SAFE_INTEGER, "documentProof.fileSizeBytes"),
    generatedAt: instant(source.generatedAt, "documentProof.generatedAt").utc, generatedBy,
    publishedGenerationToken: uuid(source.publishedGenerationToken, "documentProof.publishedGenerationToken"), publishedPurpose: purpose };
  return captured.schemaVersion === 2
    ? { ...common, clientContractVersion: 2, clientContractSnapshot: captured, ...published }
    : { ...common, clientContractVersion: 1, clientContractSnapshot: captured, ...published };
}

/** Parts FO/MO de chaque ligne et section, quel que soit le contrat. */
function rowPortions(contract: ClientContract1 | ClientContract2): boolean[] {
  return contract.schemaVersion === 2 ? contract.rows.map(hasContract2Portions) : contract.rows.map(hasPortions);
}

function schemaVersionOf(value: unknown): unknown {
  return typeof value === "object" && value !== null
    ? Object.getOwnPropertyDescriptor(value, "schemaVersion")?.value : undefined;
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
    // Lot 2, sous-lot 2.7 : une copie au schéma 2 (moteur 3) passe par l'analyseur strict du contrat 2.
    const contract = schemaVersionOf(source.contract) === 2 ? parseContract2(source.contract) : parseSnapshot(source.contract);
    const layout = parseLayout(source.layout);
    const terms = parseTerms(source.terms, options);
    if (layout.includeTerms && terms === null) invalid("presentation.terms");
    if (rowPortions(contract).some((portions) => portions !== (layout.priceMode === "fo_mo_and_total"))) invalid("presentation.priceMode");
    return { contract, layout, terms };
  });
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
