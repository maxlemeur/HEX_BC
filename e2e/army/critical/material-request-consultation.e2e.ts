import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  recordEvidence,
} from "./fixtures";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Line = {
  id: string; position: number; product_id: string | null; supplier_id: string | null;
  unit_price_ht_cents: number | null; price_quote_id: string | null;
};
type StoredFile = { id: string; quote_id: string | null; file_name: string; mime_type: string; byte_size: number };
type Detail = { request: { id: string }; lines: Line[]; files: StoredFile[] };
type Quote = {
  id: string; supplier_id: string; status: "requested" | "received" | "retained" | "closed"; with_references: boolean;
  message: string; received_at: string | null; retained_at: string | null; closed_at: string | null;
  lines: Array<{ line_id: string; unit_price_ht_cents: number | null }>; files: StoredFile[];
};

// TI-691, lot 2 « l'achat », delivery 2 « consultation ». Failure modes, written before the journey was first run
// against the product:
// - the usual supplier's message misses its reference there, or the competition message carries one (that
//   supplier's, the article's internal one, or the one the technician wrote): a competitor would learn who supplies us;
// - « Copier » hands the clipboard another text than the one shown, or « Consultation envoyée » records another
//   message, other lines or the wrong variant;
// - the supplier's PDF is not stored as dropped, is listed among the request's originals, or cannot be read back;
// - a typed price is saved as another amount (French decimals, integer cents);
// - a quote is retained before it is received;
// - retaining the competitor's quote does not give the lines its supplier and unit prices, or leaves the first quote
//   open; a closed quote can still be changed.
// The clipboard is the browser's own: the journey records what the screen hands it and what the browser answered,
// and asserts the sentence the screen shows for that answer.

/** A one-page PDF with a line of text, built here with its cross-reference table: no real quote in a public repository. */
function inventedPdf(text: string): Buffer {
  const content = `BT /F1 14 Tf 24 100 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 160] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Records each text the screen hands to the clipboard and what the browser answered; the write itself is the browser's. */
async function observeCopies(browser: Browser) {
  const installed = await browser.evaluate(() => {
    const observed = { texts: [] as string[], outcomes: [] as string[] };
    (window as typeof window & { __consultationCopies?: typeof observed }).__consultationCopies = observed;
    const clipboard = navigator.clipboard;
    if (!clipboard?.writeText) return false;
    const writeText = clipboard.writeText.bind(clipboard);
    Object.defineProperty(clipboard, "writeText", {
      configurable: true,
      value: async (text: string) => {
        observed.texts.push(text);
        try {
          await writeText(text);
          observed.outcomes.push("copied");
        } catch (error) {
          observed.outcomes.push("refused");
          throw error;
        }
      },
    });
    return true;
  });
  // The page is served from localhost, a secure context: the browser gives it a clipboard.
  if (!installed) throw new Error("navigator.clipboard is missing on the request page.");
  return () => browser.evaluate(() => {
    const observed = (window as typeof window & { __consultationCopies?: { texts: string[]; outcomes: string[] } })
      .__consultationCopies;
    if (!observed) throw new Error("Clipboard observation is missing.");
    return observed;
  });
}

const COPY_SENTENCE: Record<string, string> = {
  copied: "Message copié.",
  refused: "La copie a été refusée par le navigateur : sélectionnez le texte et copiez-le à la main.",
};

armyTest(
  "MR05 a request is asked of its supplier with references and of a competitor without any, the competitor's PDF quote is priced and retained, the first one closed",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} consultation`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;

    // Invented suppliers and articles: the elbow's reference at Alpha is known, the tee's is not.
    const supplier = async (name: string) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
        action: "create", item: { name, is_active: true },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const alphaName = `${army.runPrefix} Négoce Alpha`;
    const betaName = `${army.runPrefix} Comptoir Bêta`;
    const alpha = await supplier(alphaName);
    const beta = await supplier(betaName);
    const supplyType = await apiRequest<Envelope<{ item: { id: string } }>>(
      browser, "POST", "/api/catalogue/supply-types", { name: `${army.runPrefix} inox` },
    );
    expect(supplyType.status).toBe(201);
    const product = async (item: Record<string, unknown>) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/products", {
        action: "create",
        item: {
          unit: "u", unit_price_cents: 100, supply_type_id: supplyType.body.data.item.id, catalogue_status: "validated",
          material: "Inox 316L", dimensions: "DN 50", ...item,
        },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const elbowReference = `${army.runPrefix}-CD50`;
    const teeReference = `${army.runPrefix}-TE50`;
    const elbow = await product({ designation: `${army.runPrefix} Coude 90° inox DN 50`, reference: elbowReference, product_type: "Coude 90°" });
    const tee = await product({ designation: `${army.runPrefix} Té égal inox DN 50`, reference: teeReference, product_type: "Té égal" });

    const sku = `${army.runPrefix}-NA-4471`;
    await browser.goto(`/dashboard/products?product_id=${elbow}`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("heading", "Fournisseurs de l’article", { exact: true })).toBeVisible({ timeout: 60_000 });
    await screen.getByRole("button", "Ajouter un fournisseur", { exact: true }).tap();
    await screen.getByLabel("Fournisseur à ajouter", { exact: true }).selectOption({ value: alpha });
    await screen.getByLabel("Référence chez ce fournisseur", { exact: true }).fill(sku);
    await screen.getByRole("button", "Ajouter ce fournisseur", { exact: true }).tap();
    await expect(screen.getByText(`Réf. ${sku}`, { exact: true })).toBeVisible({ timeout: 15_000 });

    // A request delivered on site; the technician wrote the internal references, which link the lines.
    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, {
      source_text: "Demande inventée", delivery_place: "site",
    });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const one = `${base}/${requestId}`;
    const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines`, {
      lines: [
        { original_text: "10 coudes inox 50", quantity: 10, unit: "u", product_type: "Coude 90°", dimension: "DN 50", material: "Inox 316L", reference: elbowReference },
        { original_text: "4 tés inox 50", quantity: 4, unit: "u", product_type: "Té égal", dimension: "DN 50", material: "Inox 316L", reference: teeReference },
      ],
    });
    expect(added.status).toBe(201);
    const lineIds = added.body.data.lines.map((line) => line.id);
    const read = async () => {
      const response = await apiRequest<Envelope<Detail>>(browser, "GET", one);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    const quotes = async () => {
      const response = await apiRequest<Envelope<{ items: Quote[] }>>(browser, "GET", `${one}/quotes`);
      expect(response.status).toBe(200);
      return response.body.data.items;
    };

    const page = `/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`;
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    const link = screen.getByRole("button", "Rattacher les références et noms connus (2)", { exact: true });
    await expect(link).toBeVisible({ timeout: 60_000 });
    await link.tap();
    await expect.poll(async () => (await read()).lines.map((line) => line.product_id), { timeout: 30_000 }).toEqual([elbow, tee]);
    const retained = await apiRequest<Envelope<{ lines: Line[]; skipped: string[] }>>(browser, "POST", `${one}/lines/retain-suppliers`, {
      choices: lineIds.map((line_id) => ({ line_id, supplier_id: alpha })),
    });
    expect([retained.status, retained.body.data.skipped]).toEqual([200, []]);

    // The usual supplier's message: its reference where it is known, the full designation otherwise.
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    const withReferences = [
      `Bonjour, pouvez-vous me faire un prix pour l’affaire ${army.projectName} :`,
      `- 10 u Coude 90° — réf. ${sku}`,
      "- 4 u Té égal, DN 50, Inox 316L",
      "Livraison : chantier",
      "Merci !",
    ].join("\n");
    await expect(screen.getByLabel(`Message pour ${alphaName}`, { exact: true })).toHaveValue(withReferences, { timeout: 60_000 });
    const copies = await observeCopies(browser);
    await screen.getByRole("button", `Copier le message pour ${alphaName}`, { exact: true }).tap();
    await expect.poll(async () => (await copies()).outcomes.length, { timeout: 15_000 }).toBe(1);
    const firstCopy = await copies();
    expect(firstCopy.texts).toEqual([withReferences]);
    await expect(screen.getByText(COPY_SENTENCE[firstCopy.outcomes[0]], { exact: true })).toBeVisible();
    expect(await quotes()).toEqual([]);

    await screen.getByRole("button", `Consultation envoyée à ${alphaName}`, { exact: true }).tap();
    await expect(screen.getByText(/^Consultation envoyée le \d{2}\/\d{2}\/\d{4}\.$/)).toBeVisible({ timeout: 30_000 });
    const [alphaQuote] = await quotes();
    expect([alphaQuote.supplier_id, alphaQuote.status, alphaQuote.with_references, alphaQuote.message]).toEqual([
      alpha, "requested", true, withReferences,
    ]);
    expect(alphaQuote.lines).toEqual(lineIds.map((line_id) => ({ line_id, unit_price_ht_cents: null })));

    // The competitor's message names no reference at all: neither Alpha's, nor ours, nor the technician's.
    await screen.getByRole("button", `Mettre en concurrence les lignes de ${alphaName}`, { exact: true }).tap();
    await screen.getByRole("checkbox", betaName, { exact: true }).check();
    const competition = [
      `Bonjour, pouvez-vous me faire un prix pour l’affaire ${army.projectName} :`,
      "- 10 u Coude 90°, DN 50, Inox 316L",
      "- 4 u Té égal, DN 50, Inox 316L",
      "Livraison : chantier",
      "Merci !",
    ].join("\n");
    await expect(screen.getByLabel(`Message pour ${betaName}`, { exact: true })).toHaveValue(competition);
    await screen.getByRole("button", `Copier le message pour ${betaName}`, { exact: true }).tap();
    await expect.poll(async () => (await copies()).outcomes.length, { timeout: 15_000 }).toBe(2);
    const copied = (await copies()).texts[1];
    expect(copied).toBe(competition);
    for (const reference of [sku, elbowReference, teeReference, "réf."]) expect(copied).not.toContain(reference);
    await screen.getByRole("button", `Consultation envoyée à ${betaName}`, { exact: true }).tap();
    const betaCard = screen.getByRole("article", `Devis ${betaName}`, { exact: true });
    await expect(betaCard).toBeVisible({ timeout: 30_000 });
    const betaQuote = (await quotes()).find((quote) => quote.supplier_id === beta)!;
    expect([betaQuote.status, betaQuote.with_references, betaQuote.message]).toEqual(["requested", false, competition]);

    // The competitor answers with a PDF: stored as dropped, with its quote, never among the originals.
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
    await mkdir(directory, { recursive: true });
    const pdfPath = path.join(directory, "devis-beta.pdf");
    const pdf = inventedPdf("Devis invente : coudes 11,50 - tes 3,80");
    await writeFile(pdfPath, pdf);
    const picker = browser.locator(`input[type="file"][aria-label="Pièces à joindre au devis ${betaName}"]`).first();
    await picker.setInputFiles([pdfPath]);
    await expect.poll(async () => (await quotes()).find((quote) => quote.id === betaQuote.id)!.files.length, { timeout: 60_000 }).toBe(1);
    const [storedPdf] = (await quotes()).find((quote) => quote.id === betaQuote.id)!.files;
    expect([storedPdf.quote_id, storedPdf.file_name, storedPdf.mime_type, storedPdf.byte_size]).toEqual([
      betaQuote.id, "devis-beta.pdf", "application/pdf", pdf.length,
    ]);
    const storedSha = await browser.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      return [response.status, [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")];
    }, `${one}/files/${storedPdf.id}`);
    expect(storedSha).toEqual([200, createHash("sha256").update(pdf).digest("hex")]);
    expect((await read()).files).toEqual([]);
    await expect(betaCard.getByRole("link", "devis-beta.pdf", { exact: true })).toBeVisible();

    // Prices typed in French decimals are saved in cents; the quote cannot be retained before it is received.
    const firstPrice = betaCard.getByLabel(`Prix unitaire HT, ligne 1, ${betaName}`, { exact: true });
    await firstPrice.fill("11,50");
    await firstPrice.press("Tab");
    const secondPrice = betaCard.getByLabel(`Prix unitaire HT, ligne 2, ${betaName}`, { exact: true });
    await secondPrice.fill("3,8");
    await secondPrice.press("Tab");
    await expect.poll(async () => (await quotes()).find((quote) => quote.id === betaQuote.id)!.lines, { timeout: 30_000 }).toEqual([
      { line_id: lineIds[0], unit_price_ht_cents: 1150 },
      { line_id: lineIds[1], unit_price_ht_cents: 380 },
    ]);
    const retain = screen.getByRole("button", `Retenir ce devis (${betaName})`, { exact: true });
    await expect(retain).toBeDisabled();
    await expect(betaCard.getByText("Pour retenir ce devis, marquez-le reçu.", { exact: true })).toBeVisible();
    const early = await apiRequest<Envelope<never>>(browser, "POST", `${one}/quotes/${betaQuote.id}/retain`);
    expect([early.status, early.body.error?.code]).toEqual([422, "MATERIAL_REQUEST_QUOTE_NOT_RECEIVED"]);

    await screen.getByRole("button", `Marquer reçu le devis ${betaName}`, { exact: true }).tap();
    await expect(retain).toBeEnabled({ timeout: 30_000 });
    await retain.tap();
    await expect(betaCard.getByText("Retenu", { exact: true })).toBeVisible({ timeout: 30_000 });

    // The lines are bought from the competitor at its prices; Alpha's quote is closed, readable and read-only.
    const priced = (await read()).lines;
    expect(priced.map((line) => [line.supplier_id, line.unit_price_ht_cents, line.price_quote_id])).toEqual([
      [beta, 1150, betaQuote.id], [beta, 380, betaQuote.id],
    ]);
    const final = await quotes();
    const stateOf = (supplierId: string) => {
      const quote = final.find((entry) => entry.supplier_id === supplierId)!;
      return [quote.status, quote.closed_at !== null, quote.retained_at !== null];
    };
    expect([final.length, stateOf(alpha), stateOf(beta)]).toEqual([2, ["closed", true, false], ["retained", false, true]]);
    await expect(screen.getByText(/^Prix unitaire HT : 11,50\s€ \(devis retenu\)$/)).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByText(/^Prix unitaire HT : 3,80\s€ \(devis retenu\)$/)).toBeVisible();
    await expect(screen.getByLabel("Fournisseur, ligne 1", { exact: true })).toHaveCount(0);
    const alphaCard = screen.getByRole("article", `Devis ${alphaName}`, { exact: true });
    await expect(alphaCard.getByText("Clos", { exact: true })).toBeVisible();
    await expect(alphaCard.getByText("Devis clos : il reste lisible, rien n’y change.", { exact: true })).toBeVisible();
    await expect(alphaCard.getByLabel(`Prix unitaire HT, ligne 1, ${alphaName}`, { exact: true })).toHaveCount(0);
    const changed = await apiRequest<Envelope<never>>(browser, "PATCH", `${one}/quotes/${alphaQuote.id}`, {
      lines: [{ line_id: lineIds[0], unit_price_ht_cents: 999 }],
    });
    expect([changed.status, changed.body.error?.code]).toEqual([409, "MATERIAL_REQUEST_QUOTE_READ_ONLY"]);

    await recordEvidence(army, "material-request-consultation", {
      ...ids, requestId, suppliers: { alpha, beta }, elbow, tee, lineIds,
      quotes: final.map((quote) => ({ id: quote.id, supplier_id: quote.supplier_id, status: quote.status, with_references: quote.with_references })),
      pdf: { id: storedPdf.id, byte_size: storedPdf.byte_size, sha256: storedSha[1] },
      copies: (await copies()).outcomes,
      lines: priced.map((line) => ({ id: line.id, supplier_id: line.supplier_id, unit_price_ht_cents: line.unit_price_ht_cents })),
    });
  },
);
