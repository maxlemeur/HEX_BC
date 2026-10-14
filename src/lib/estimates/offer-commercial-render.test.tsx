import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { beforeAll, describe, expect, it } from "vitest";

import { COMPANY_INFO } from "@/lib/company-info";
import type { ClientContract1, OfferTermsSnapshot } from "@/lib/estimates/offer-contract";
import type { EstimatePdfLayoutOptions } from "@/lib/estimates/pdf-layout";

// PRECODE ONLY: renderer absent, not executed. No auth/DB/server.ts imports,
// mock/getter substitution, fake EstimateItems, prices recalculation or real CGV.
type Props = { contract: ClientContract1; layout: EstimatePdfLayoutOptions; terms: OfferTermsSnapshot | null; allowDevelopmentTerms?: boolean };
type RenderAPI = {
  CommercialEstimateDocument: ComponentType<Props>;
  buildCommercialEstimatePdfDocument: (input: Props & { logoDataUri: string | null }) => Parameters<typeof renderToBuffer>[0];
};
const MODULE = path.resolve("src/components/estimate-document/CommercialEstimateDocument.tsx");
const mutableCompany = COMPANY_INFO as unknown as ClientContract1["company"];
const originalCompany = structuredClone(mutableCompany);
const companyB: ClientContract1["company"] = {
  name: "CAPTURED COMPANY B", tagline: "CAPTURED TAGLINE B",
  address: { street: "CAPTURED STREET B", postalCode: "11111", city: "CAPTURED CITY B" },
  registeredOffice: { street: "CAPTURED OFFICE B", postalCode: "22222", city: "CAPTURED OFFICE CITY B" },
  phone: { landline: "CAPTURED LANDLINE B", mobile: "CAPTURED MOBILE B" },
  legal: { siret: "CAPTURED SIRET B", vat: "CAPTURED VAT B" },
};
let frozenCompanyB = structuredClone(companyB);
let renderer: RenderAPI;

function captured(): ClientContract1 {
  return {
    schemaVersion: 1,
    version: { id: "44444444-4444-4444-8444-444444444444", tenantId: "22222222-2222-4222-8222-222222222222",
      projectId: "33333333-3333-4333-8333-333333333333", number: 2, contentRevision: 7,
      calcEngineVersion: 2, dateDevis: "2026-10-13", validiteJours: 45, currency: "EUR",
      contractorRole: "principal", taxRateBp: 2000 },
    project: { name: "CAPTURED PROJECT A", reference: "CAPTURED REFERENCE A", estimateReference: "CAPTURED_OFFER_A_V2",
      clientName: "CAPTURED CLIENT A", siteAddress: "CAPTURED SITE A" },
    issuer: { userId: "11111111-1111-4111-8111-111111111111", displayName: "CAPTURED ISSUER A",
      displayRole: "CAPTURED ROLE A", phone: "01 00 00 00 01", email: "captured-issuer@example.invalid" },
    company: structuredClone(frozenCompanyB),
    rows: [{ kind: "line", id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", parentId: null, position: 0, depth: 0,
      title: "CAPTURED LINE A", quantity: 2, unit: "u", unitSaleHtCents: 7500, saleHtCents: 15000 }],
    totals: { saleHtCents: 15000, taxCents: 3000, calculatedTtcCents: 18000, payableTtcCents: 18000, roundingAdjustmentCents: 0 },
    exclusions: "CAPTURED LIMITS A",
  };
}
function layout(): EstimatePdfLayoutOptions {
  return { preset: "client_detailed", detailLevel: "lines", priceMode: "unit_and_total", density: "standard",
    showNumbering: true, showSectionSubtotals: true, conditionsPlacement: "auto", includeTerms: true };
}
function terms(): OfferTermsSnapshot {
  return { templateId: "88888888-8888-4888-8888-888888888888", title: "CAPTURED SYNTHETIC TERMS A",
    body: "TEST FIXTURE ONLY. No genuine legal review. CAPTURED CLAUSE A.", version: 1,
    legalReviewedAt: "2026-10-01T12:00:00.000Z", capturedAt: "2026-10-13T12:00:00.000Z" };
}
const normalized = (value: string) => value.replace(/\s+/g, " ").trim();
function htmlText(value: string): string {
  return normalized(value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&"));
}

// PDF.js reads ACTUAL PDF bytes in a terminable worker. Standard fonts are local;
// no URLs/auth/DB, and a timer can really terminate CPU work in this worker.
const PDF_TEXT_WORKER = `
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const pdfjs = await import(workerData.moduleUrl);
  const loading = pdfjs.getDocument({ data: new Uint8Array(workerData.bytes),
    standardFontDataUrl: workerData.fonts, useWorkerFetch: false,
    useWasm: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: true });
  try {
    const document = await loading.promise;
    const pages = [];
    for (let page = 1; page <= document.numPages; page++) {
      const content = await (await document.getPage(page)).getTextContent({ disableNormalization: true });
      pages.push(content.items.filter(item => typeof item.str === "string").map(item => item.str).join(" "));
    }
    parentPort.postMessage({ pages });
  } finally { await loading.destroy(); }
})().catch(error => parentPort.postMessage({ error: String(error.message) }));
`;

async function pdfText(bytes: Buffer): Promise<string[]> {
  const requireFromRepo = createRequire(path.resolve("package.json"));
  const worker = new Worker(PDF_TEXT_WORKER, { eval: true, workerData: {
    bytes: Uint8Array.from(bytes), moduleUrl: pathToFileURL(requireFromRepo.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href,
    fonts: path.resolve("node_modules/pdfjs-dist/standard_fonts").replace(/\\/g, "/") + "/",
  } });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { void worker.terminate(); reject(new Error("PDF_TEXT_WORKER_TIMEOUT")); }, 10_000);
    worker.once("error", (error) => { clearTimeout(timeout); void worker.terminate(); reject(error); });
    worker.once("message", (result: { pages?: string[]; error?: string }) => {
      clearTimeout(timeout); void worker.terminate();
      if (result.error || !result.pages) reject(new Error(result.error ?? "Missing actual PDF text"));
      else resolve(result.pages.map(normalized));
    });
    worker.once("exit", (code) => { if (code !== 0) { clearTimeout(timeout); reject(new Error(`PDF worker exited ${code}`)); } });
  });
}

describe("captured commercial company — real HTML/PDF integration before renderer code", () => {
  beforeAll(async () => {
    if (!existsSync(MODULE)) throw new Error("MISSING_PRECONDITION: proposed commercial renderer absent; no company RED/PASS.");
    // Capture real configuration B, then restore actual current A BEFORE renderer
    // import: cached or live current-company defaults must both fail the witness.
    Object.assign(mutableCompany, structuredClone(companyB));
    try { frozenCompanyB = structuredClone(mutableCompany); }
    finally { Object.assign(mutableCompany, structuredClone(originalCompany)); }
    renderer = await import(/* @vite-ignore */ MODULE) as RenderAPI;
  });

  it("renders captured company B with actual current company configuration A, preserving net PDF footer", async () => {
    const input: Props = { contract: captured(), layout: layout(), terms: terms() };
    const before = structuredClone(input);
    Object.assign(mutableCompany, structuredClone(originalCompany));
    try {
      const html = htmlText(renderToStaticMarkup(createElement(renderer.CommercialEstimateDocument, input)));
      const bytes = await renderToBuffer(renderer.buildCommercialEstimatePdfDocument({ ...input, logoDataUri: null }));
      expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
      const pdf = normalized((await pdfText(bytes)).join(" "));
      for (const actual of [html, pdf]) {
        for (const expected of [frozenCompanyB.address.street, frozenCompanyB.phone.landline, frozenCompanyB.phone.mobile,
          frozenCompanyB.registeredOffice.street, frozenCompanyB.legal.siret, frozenCompanyB.legal.vat,
          input.contract.issuer.displayName, input.contract.project.clientName!, input.contract.project.siteAddress!]) {
          expect(actual).toContain(normalized(expected));
        }
        for (const current of [originalCompany.address.street, originalCompany.registeredOffice.street, originalCompany.legal.siret, originalCompany.legal.vat]) {
          expect(actual).not.toContain(current);
        }
        expect(actual).toMatch(/150,00\s*€/); expect(actual).toMatch(/30,00\s*€/); expect(actual).toMatch(/180,00\s*€/);
        expect(actual).not.toContain("Remise");
      }
      expect(input).toEqual(before);
    } finally { Object.assign(mutableCompany, structuredClone(originalCompany)); }
  }, 20_000);

  it("keeps captured legal chrome on actual continuation/conditions/terms PDF pages", async () => {
    const input: Props = { contract: captured(), layout: { ...layout(), conditionsPlacement: "new_page" }, terms: terms() };
    input.terms!.body = Array.from({ length: 90 }, (_, index) => `Clause ${index + 1} - CAPTURED TERMS A. Synthetic text only, no genuine approval.`).join("\n\n");
    Object.assign(mutableCompany, structuredClone(originalCompany));
    try {
      const bytes = await renderToBuffer(renderer.buildCommercialEstimatePdfDocument({ ...input, logoDataUri: null }));
      const pages = await pdfText(bytes);
      expect(pages.length).toBeGreaterThanOrEqual(3);
      for (const page of pages) {
        expect(page).toContain(frozenCompanyB.legal.siret); expect(page).toContain(frozenCompanyB.legal.vat);
        expect(page).not.toContain(originalCompany.legal.siret); expect(page).not.toContain(originalCompany.legal.vat);
      }
      expect(pages.join(" ")).toContain("CAPTURED LIMITS A");
      expect(pages.join(" ")).toContain("CAPTURED TERMS A");
    } finally { Object.assign(mutableCompany, structuredClone(originalCompany)); }
  }, 20_000);

  it("refuses missing captured company or incomplete included terms before rendering", () => {
    const missingCompany = { contract: { ...captured(), company: null }, layout: layout(), terms: terms() };
    const missingTerms = { contract: captured(), layout: layout(), terms: null };
    for (const invalid of [missingCompany, missingTerms]) {
      expect(() => renderToStaticMarkup(createElement(renderer.CommercialEstimateDocument, invalid as unknown as Props))).toThrow();
      expect(() => renderer.buildCommercialEstimatePdfDocument({ ...invalid, logoDataUri: null } as unknown as Props & { logoDataUri: null })).toThrow();
    }
  });

  it("keeps draft terms behind the explicit trusted development context", async () => {
    const draft: Props = { contract: captured(), layout: layout(), terms: {
      ...terms(), legalReviewedAt: null, isDraft: true,
    } };
    expect(() => renderToStaticMarkup(createElement(renderer.CommercialEstimateDocument, draft))).toThrow();
    expect(() => renderer.buildCommercialEstimatePdfDocument({ ...draft, logoDataUri: null })).toThrow();
    const local: Props = { ...draft, allowDevelopmentTerms: true };
    expect(htmlText(renderToStaticMarkup(createElement(renderer.CommercialEstimateDocument, local))))
      .toContain("CAPTURED SYNTHETIC TERMS A");
    const bytes = await renderToBuffer(renderer.buildCommercialEstimatePdfDocument({ ...local, logoDataUri: null }));
    expect((await pdfText(bytes)).join(" ")).toContain("CAPTURED SYNTHETIC TERMS A");
  }, 20_000);
});
