import { createHash, randomUUID } from "node:crypto";
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

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string; details?: { positions?: number[] } } };
type Line = {
  id: string; position: number; status: "draft" | "validated"; product_id: string | null; supplier_id: string | null;
  unit_price_ht_cents: number | null; price_per: number; price_quote_id: string | null;
};
type StoredFile = { id: string; quote_id: string | null; file_name: string; mime_type: string; byte_size: number };
type Detail = { request: { id: string }; lines: Line[]; files: StoredFile[] };
type Quote = {
  id: string; supplier_id: string; status: "requested" | "received" | "retained" | "closed"; with_references: boolean;
  message: string; received_at: string | null; retained_at: string | null; closed_at: string | null;
  amount_ht_cents: number | null; shipping_ht_cents: number | null; discount_ht_cents: number | null;
  lines: Array<{ line_id: string; unit_price_ht_cents: number | null; price_per: number }>; files: StoredFile[];
};

// TI-691, lot 2 « l'achat », delivery 2 « consultation ». Failure modes, written before the journey was first run
// against the product:
// - the usual supplier's message misses its reference there, or the competition message carries one (that
//   supplier's, the article's internal one, or the one the technician wrote): a competitor would learn who supplies us;
// - « Copier » hands the clipboard another text than the one shown, or « Consultation envoyée » records another
//   message, other lines or the wrong variant;
// - the supplier's PDF is not stored as dropped, is listed among the request's originals, or cannot be read back;
// - a typed price is saved as another amount (French decimals, integer cents), or a sub-cent price quoted for 100
//   units is saved, shown or totalled as if it were for one;
// - a quote is retained before it is received, or while one of its lines is a draft;
// - retaining the competitor's quote does not give the lines its supplier and unit prices, or leaves the first quote
//   open; a closed quote can still be changed.
// - (TI-691, 2026-11-22) a competitor the supplier list does not hold cannot be created from the competition's
//   search, is created under another name, is not the recipient selected, or its consultation records another text.
// - (TI-691, the owner's quote of 22/11/2026, « Fdp » in the notes) the gap between the supplier's total and its lines
//   cannot be counted as shipping from the card, the shipping or the discount is saved as another amount, or the
//   draft made from the request misses them, puts them before the articles or totals otherwise.
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
    // TI-691: today's message is asserted first; a template left by an interrupted run would change it. The member's
    // own is removed; the company's, when the session may remove it.
    expect((await apiRequest(browser, "DELETE", "/api/consultation-message-templates/personal")).status).toBe(200);
    expect([200, 403]).toContain((await apiRequest(browser, "DELETE", "/api/consultation-message-templates/company")).status);

    // Invented suppliers and articles: the elbow's reference at Alpha is known, the tee's is not.
    const supplier = async (name: string) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
        action: "create", item: { name, is_active: true },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The recipients of a group's consultation are vertical tabs, each beside its message (TI-691, mockup B).
    const recipientTab = (name: string) => screen.getByRole("tab", new RegExp(`^${escaped(name)},`));
    const quoteButton = (name: string) => screen.getByRole("button", new RegExp(`^Consulter le devis ${escaped(name)} du `));
    const alphaName = `${army.runPrefix} Négoce Alpha`;
    const betaName = `${army.runPrefix} Comptoir Bêta`;
    const alpha = await supplier(alphaName);
    const beta = await supplier(betaName);
    // A second competitor, for the template's {fournisseur} in each competitor's own message (TI-691).
    const gammaName = `${army.runPrefix} Dépôt Gamma`;
    await supplier(gammaName);
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
    // The request page shows one step at a time (1 lines, 2 quotes, 3 purchase orders): the lines are drafts, so it
    // opens on the lines, and the office goes to the quotes by the steps of the head.
    const openStep = (step: 1 | 2 | 3) => screen.getByRole("tab", new RegExp(`^Étape ${step} :`)).tap({ timeout: 60_000 });
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    await openStep(2);
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
    expect(alphaQuote.lines).toEqual(lineIds.map((line_id) => ({ line_id, unit_price_ht_cents: null, price_per: 1 })));

    // The competitor's message names no reference at all: neither Alpha's, nor ours, nor the technician's.
    const competitionEntry = screen.getByRole("button", `Mettre en concurrence les lignes de ${alphaName}`, { exact: true });
    await competitionEntry.tap();
    // The whole supplier list, searched by name (TI-691); the supplier added is the recipient selected.
    const competitor = screen.getByLabel("Ajouter un fournisseur", { exact: true });
    await competitor.fill(betaName);
    await screen.getByRole("option", betaName, { exact: true }).tap();
    await expect(recipientTab(betaName)).toHaveAttribute("aria-selected", "true");
    await expect(screen.getByRole("button", `Retirer ${betaName} de la mise en concurrence`, { exact: true })).toBeVisible();
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
    // TI-691: the office retouches the competitor's text before sending it; what is recorded is the text shown.
    const betaMessage = screen.getByLabel(`Message pour ${betaName}`, { exact: true });
    const betaRetouched = `${competition}\nRéponse souhaitée avant vendredi.`;
    await betaMessage.fill(betaRetouched);
    await expect(betaMessage).toHaveValue(betaRetouched);
    await screen.getByRole("button", `Consultation envoyée à ${betaName}`, { exact: true }).tap();
    const betaCard = screen.getByRole("article", `Devis ${betaName}`, { exact: true });
    await expect(betaCard).toBeVisible({ timeout: 30_000 });
    const betaQuote = (await quotes()).find((quote) => quote.supplier_id === beta)!;
    expect([betaQuote.status, betaQuote.with_references, betaQuote.message]).toEqual(["requested", false, betaRetouched]);

    // TI-691 (2026-11-22): a competitor the list does not hold is created from the search by its name, through the
    // catalogue's route, put in competition and selected; its consultation is recorded as shown.
    await quoteButton(alphaName).tap({ timeout: 60_000 });
    await expect(recipientTab(betaName)).toHaveAttribute("aria-label", new RegExp(`, Envoyée le \\d{2}/\\d{2}$`));
    await competitionEntry.tap();
    const deltaName = `${army.runPrefix} Quincaillerie Delta`;
    await screen.getByLabel("Ajouter un fournisseur", { exact: true }).fill(deltaName);
    await screen.getByRole("option", `Créer le fournisseur « ${deltaName} »`, { exact: true }).tap();
    await expect(recipientTab(deltaName)).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
    const deltaMessage = screen.getByLabel(`Message pour ${deltaName}`, { exact: true });
    await expect(deltaMessage).toHaveValue(competition);
    const listed = await apiRequest<Envelope<{ items: Array<{ id: string; name: string }> }>>(browser, "GET", "/api/suppliers");
    const deltaSuppliers = listed.body.data.items.filter((item) => item.name === deltaName);
    expect(deltaSuppliers).toHaveLength(1);
    const delta = deltaSuppliers[0].id;
    await screen.getByRole("button", `Consultation envoyée à ${deltaName}`, { exact: true }).tap();
    await expect(screen.getByRole("article", `Devis ${deltaName}`, { exact: true })).toBeVisible({ timeout: 30_000 });
    const deltaQuote = (await quotes()).find((quote) => quote.supplier_id === delta)!;
    expect([deltaQuote.status, deltaQuote.with_references, deltaQuote.message]).toEqual(["requested", false, competition]);
    expect(deltaQuote.lines.map((line) => line.line_id)).toEqual(lineIds);

    // TI-691: the member shapes their own message in « Mon profil », then retouches it before copying: the text
    // copied is the one shown. Their template is removed at the end, so the session's next journeys get today's.
    // The page is left below: what the browser answered to the copies so far is kept for the evidence.
    const copyOutcomes = [...(await copies()).outcomes];
    const templates = "/api/consultation-message-templates";
    const personalTemplate = {
      message_template: "Bonjour {fournisseur},\n{lignes}\n{livraison}",
      line_template: "{ligne}. {quantité} {désignation}[ (réf. {référence})]",
    };
    try {
      await browser.goto("/dashboard/profile#message-consultation", { waitUntil: "domcontentloaded" });
      const messageTemplate = screen.getByLabel("Modèle du message", { exact: true });
      await expect(messageTemplate).toBeVisible({ timeout: 60_000 });
      await messageTemplate.fill(personalTemplate.message_template);
      await screen.getByLabel("Modèle de chaque ligne", { exact: true }).fill(personalTemplate.line_template);
      await screen.getByRole("button", "Enregistrer le modèle", { exact: true }).tap();
      await expect(screen.getByText("Modèle enregistré. Il s’applique aux prochains messages.", { exact: true })).toBeVisible({ timeout: 30_000 });
      const stored = await apiRequest<Envelope<{ personal: typeof personalTemplate | null }>>(browser, "GET", templates);
      expect(stored.body.data.personal).toEqual(personalTemplate);

      await browser.goto(page, { waitUntil: "domcontentloaded" });
      await openStep(2);
      await quoteButton(alphaName).tap({ timeout: 60_000 });
      const shaped = [
        `Bonjour ${alphaName},`,
        `1. 10 u Coude 90° (réf. ${sku})`,
        "2. 4 u Té égal, DN 50, Inox 316L",
        "Livraison : chantier",
      ].join("\n");
      const alphaMessage = screen.getByLabel(`Message pour ${alphaName}`, { exact: true });
      await expect(alphaMessage).toHaveValue(shaped, { timeout: 60_000 });
      const retouched = `${shaped}\nMerci d’avance !`;
      await alphaMessage.fill(retouched);
      await expect(screen.getByRole("button", "Rétablir le texte généré", { exact: true })).toBeVisible();
      const retouchCopies = await observeCopies(browser);
      await screen.getByRole("button", `Copier le message pour ${alphaName}`, { exact: true }).tap();
      await expect.poll(async () => (await retouchCopies()).texts, { timeout: 15_000 }).toEqual([retouched]);
      copyOutcomes.push(...(await retouchCopies()).outcomes);
      await screen.getByRole("button", "Rétablir le texte généré", { exact: true }).tap();
      await expect(alphaMessage).toHaveValue(shaped);
      // The consultations recorded before the template keep their text.
      const recorded = await quotes();
      expect(recorded.find((quote) => quote.supplier_id === alpha)!.message).toBe(withReferences);
      expect(recorded.find((quote) => quote.supplier_id === beta)!.message).toBe(betaRetouched);

      // Each competitor's message names that competitor ({fournisseur}), without any reference.
      for (const name of [betaName, gammaName]) {
        await competitionEntry.tap();
        await screen.getByLabel("Ajouter un fournisseur", { exact: true }).fill(name);
        await screen.getByRole("option", name, { exact: true }).tap();
        await expect(recipientTab(name)).toHaveAttribute("aria-selected", "true");
      }
      const competing = (name: string) => [
        `Bonjour ${name},`,
        "1. 10 u Coude 90°, DN 50, Inox 316L",
        "2. 4 u Té égal, DN 50, Inox 316L",
        "Livraison : chantier",
      ].join("\n");
      await expect(screen.getByLabel(`Message pour ${gammaName}`, { exact: true })).toHaveValue(competing(gammaName));
      await recipientTab(betaName).tap();
      await expect(screen.getByLabel(`Message pour ${betaName}`, { exact: true })).toHaveValue(competing(betaName));
    } finally {
      const reset = await apiRequest<Envelope<{ personal: null }>>(browser, "DELETE", `${templates}/personal`);
      expect(reset.status).toBe(200);
    }
    await quoteButton(betaName).tap({ timeout: 60_000 });
    await expect(betaCard).toBeVisible({ timeout: 30_000 });

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
    // Served as an attachment: the link downloads it under its own name.
    await expect(betaCard.getByRole("link", "devis-beta.pdf", { exact: true })).toHaveAttribute("download", "devis-beta.pdf");

    // Prices typed in French decimals are saved in cents; the tees are quoted for 100 (0,038 € each), the choice
    // made before the price goes with it. The quote cannot be retained before it is received.
    const firstPrice = betaCard.getByLabel(`Prix unitaire HT, ligne 1, ${betaName}`, { exact: true });
    await firstPrice.fill("11,50");
    await firstPrice.press("Tab");
    await betaCard.getByLabel(`Prix donné pour, ligne 2, ${betaName}`, { exact: true }).selectOption({ value: "100" });
    const secondPrice = betaCard.getByLabel(`Prix unitaire HT, ligne 2, ${betaName}`, { exact: true });
    await secondPrice.fill("3,8");
    await secondPrice.press("Tab");
    await expect.poll(async () => (await quotes()).find((quote) => quote.id === betaQuote.id)!.lines, { timeout: 30_000 }).toEqual([
      { line_id: lineIds[0], unit_price_ht_cents: 1150, price_per: 1 },
      { line_id: lineIds[1], unit_price_ht_cents: 380, price_per: 100 },
    ]);
    // 10 × 11,50 € + 4 × 3,80 € ÷ 100 (0,152 €, rounded to the cent).
    await expect(betaCard.getByText("Total des lignes :", { exact: true })).toBeVisible();
    await expect(betaCard.getByText(/^115,15\s€ HT$/)).toBeVisible();
    const retain = screen.getByRole("button", `Retenir ce devis (${betaName})`, { exact: true });
    await expect(retain).toBeDisabled();
    await expect(betaCard.getByText("Pour retenir ce devis, marquez-le reçu.", { exact: true })).toBeVisible();
    const early = await apiRequest<Envelope<never>>(browser, "POST", `${one}/quotes/${betaQuote.id}/retain`);
    expect([early.status, early.body.error?.code]).toEqual([422, "MATERIAL_REQUEST_QUOTE_NOT_RECEIVED"]);

    await screen.getByRole("button", `Marquer reçu le devis ${betaName}`, { exact: true }).tap();

    // Received and priced, but its lines are drafts: what is bought must be what was checked.
    // The lines are named by what they ask: the page shows no line number to point at.
    await expect(betaCard.getByText(
      "Les lignes Coude 90° DN 50 et Té égal DN 50 ne sont pas validées : validez-les avant de retenir ce devis.", { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect(retain).toBeDisabled();
    const drafts = await apiRequest<Envelope<never>>(browser, "POST", `${one}/quotes/${betaQuote.id}/retain`);
    expect([drafts.status, drafts.body.error?.code, drafts.body.error?.details?.positions]).toEqual([
      422, "MATERIAL_REQUEST_QUOTE_LINES_NOT_VALIDATED", [1, 2],
    ]);
    expect((await read()).lines.map((line) => [line.status, line.price_quote_id])).toEqual([["draft", null], ["draft", null]]);

    // The supplier totals 124,00 € with 1,00 € off: the 9,85 € left over its lines and discount is its shipping, which
    // the office counts from the gap in one gesture. The card then totals lines + shipping - discount, without a gap.
    const discountField = betaCard.getByLabel(`Remise HT, devis ${betaName}`, { exact: true });
    await discountField.fill("1");
    await discountField.press("Tab");
    const amountField = betaCard.getByLabel(`Montant HT du devis (facultatif), ${betaName}`, { exact: true });
    await amountField.fill("124");
    await amountField.press("Tab");
    await betaCard.getByRole("button", /^Compter 9,85\s€ en port$/).tap({ timeout: 30_000 });
    await expect.poll(async () => {
      const quote = (await quotes()).find((entry) => entry.id === betaQuote.id)!;
      return [quote.amount_ht_cents, quote.shipping_ht_cents, quote.discount_ht_cents];
    }, { timeout: 30_000 }).toEqual([12400, 985, 100]);
    await expect(betaCard.getByText("Total du devis :", { exact: true })).toBeVisible();
    await expect(betaCard.getByText(/^124,00\s€ HT$/)).toBeVisible();
    await expect(betaCard.getByText(/d’écart$/)).toHaveCount(0);

    // Validated at the lines step, the quote may be retained back at the quotes: it kept what was typed there.
    await openStep(1);
    const originalViewport = await browser.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    await browser.setViewport({ width: 1280, height: 800 });
    const firstLineLayout = () => browser.evaluate(() => {
      const row = document.querySelector('[aria-label="Lignes de la demande"] > li');
      const toggle = row?.querySelector(":scope > button[aria-expanded]");
      if (!row || !toggle) return null;
      const offset = toggle.getBoundingClientRect().left - row.getBoundingClientRect().left;
      return {
        toggleOnLeft: offset >= 0 && offset < 24,
        selectionWidth: parseFloat(getComputedStyle(row).gridTemplateColumns.split(" ")[1]),
      };
    });
    await expect(screen.getByRole("checkbox", "Tout sélectionner", { exact: true })).toBeVisible();
    await expect.poll(firstLineLayout).toEqual({ toggleOnLeft: true, selectionWidth: 36 });
    const draftLinesScreenshot = await app.screenshot("material-request-draft-lines-chevron");
    await screen.getByRole("button", "Valider les lignes sans alerte (2)", { exact: true }).tap();
    await expect.poll(async () => (await read()).lines.map((line) => line.status), { timeout: 30_000 }).toEqual([
      "validated", "validated",
    ]);
    await expect(screen.getByRole("checkbox", "Tout sélectionner", { exact: true })).toHaveCount(0);
    await expect.poll(firstLineLayout).toEqual({ toggleOnLeft: true, selectionWidth: 0 });
    const validatedLinesScreenshot = await app.screenshot("material-request-validated-lines-chevron");
    await openStep(2);
    await expect(retain).toBeEnabled({ timeout: 30_000 });
    await retain.tap();
    await expect(betaCard.getByText("Retenu", { exact: true })).toBeVisible({ timeout: 30_000 });

    // The lines are bought from the competitor at its prices; Alpha's quote is closed, readable and read-only.
    const priced = (await read()).lines;
    expect(priced.map((line) => [line.supplier_id, line.unit_price_ht_cents, line.price_per, line.price_quote_id, line.status])).toEqual([
      [beta, 1150, 1, betaQuote.id, "validated"], [beta, 380, 100, betaQuote.id, "validated"],
    ]);
    const final = await quotes();
    const stateOf = (supplierId: string) => {
      const quote = final.find((entry) => entry.supplier_id === supplierId)!;
      return [quote.status, quote.closed_at !== null, quote.retained_at !== null];
    };
    expect([final.length, stateOf(alpha), stateOf(beta), stateOf(delta)]).toEqual([
      3, ["closed", true, false], ["retained", false, true], ["closed", true, false],
    ]);
    await openStep(1);
    await screen.getByRole("button", "Afficher les détails de la ligne 1", { exact: true }).tap();
    const firstDetails = screen.getByRole("complementary", "Détails de la ligne 1", { exact: true });
    await expect(firstDetails.getByText("Prix unitaire HT (devis retenu)", { exact: true })).toBeVisible();
    await expect(firstDetails.getByText(/^11,50\s€$/)).toBeVisible({ timeout: 15_000 });
    const secondToggle = screen.getByRole("button", "Afficher les détails de la ligne 2", { exact: true });
    await secondToggle.tap();
    const secondDetails = screen.getByRole("complementary", "Détails de la ligne 2", { exact: true });
    await expect(secondDetails.getByText("Prix unitaire HT (devis retenu)", { exact: true })).toBeVisible();
    await expect(secondDetails.getByText(/^3,80\s€ les 100$/)).toBeVisible();
    await expect(screen.getByLabel("Fournisseur, ligne 1", { exact: true })).toHaveCount(0);
    await browser.setViewport({ width: 390, height: 844 });
    await expect.poll(async () => (await firstLineLayout())?.toggleOnLeft).toBe(true);
    await secondToggle.tap();
    await expect(secondDetails).toHaveCount(0);
    const mobileLinesScreenshot = await app.screenshot("material-request-mobile-lines-chevron");
    await browser.setViewport(originalViewport);
    await openStep(2);
    await screen.getByRole("button", new RegExp(`^Consulter le devis ${alphaName} du`)).tap();
    const alphaCard = screen.getByRole("article", `Devis ${alphaName}`, { exact: true });
    await expect(alphaCard.getByText("Clos", { exact: true })).toBeVisible();
    await expect(alphaCard.getByText("Devis clos : il reste lisible, rien n’y change.", { exact: true })).toBeVisible();
    await expect(alphaCard.getByLabel(`Prix unitaire HT, ligne 1, ${alphaName}`, { exact: true })).toHaveCount(0);
    const changed = await apiRequest<Envelope<never>>(browser, "PATCH", `${one}/quotes/${alphaQuote.id}`, {
      lines: [{ line_id: lineIds[0], unit_price_ht_cents: 999, price_per: 1 }],
    });
    expect([changed.status, changed.body.error?.code]).toEqual([409, "MATERIAL_REQUEST_QUOTE_READ_ONLY"]);
    const recharged = await apiRequest<Envelope<never>>(browser, "PATCH", `${one}/quotes/${betaQuote.id}`, { shipping_ht_cents: 1 });
    expect([recharged.status, recharged.body.error?.code]).toEqual([409, "MATERIAL_REQUEST_QUOTE_READ_ONLY"]);

    // The draft made from the request carries the retained quote's shipping and discount after its articles.
    const ordered = await apiRequest<Envelope<{ orders: Array<{ id: string; line_count: number; total_ht_cents: number }> }>>(
      browser, "POST", `${one}/orders`, { idempotency_key: randomUUID() },
    );
    expect(ordered.status, JSON.stringify(ordered.body.error ?? null)).toBe(201);
    const madeOrders = ordered.body.data.orders;
    (army.ownedPurchaseOrders ??= []).push(...madeOrders.map((order) => ({ orderId: order.id, projectId: ids.projectId, versionId: ids.versionId })));
    expect(madeOrders.map((order) => [order.line_count, order.total_ht_cents])).toEqual([[2, 11515 + 985 - 100]]);
    const draftItems = await apiRequest<Envelope<{ items: Array<{
      line_kind?: string; designation: string; quantity: number; unit_price_ht_cents: number; line_total_ht_cents: number;
    }> }>>(browser, "GET", `/api/orders?view=items&order_id=${madeOrders[0].id}`);
    expect(draftItems.status, JSON.stringify(draftItems.body.error ?? null)).toBe(200);
    // In the order's own order (its positions).
    const sortedItems = draftItems.body.data.items;
    expect(sortedItems.map((item) => [item.line_kind, item.line_total_ht_cents])).toEqual([
      ["article", 11500], ["article", 15], ["shipping", 985], ["discount", -100],
    ]);
    expect(sortedItems.slice(2).map((item) => [item.designation, item.quantity, item.unit_price_ht_cents])).toEqual([
      ["Port", 1, 985], ["Remise", 1, 100],
    ]);

    await recordEvidence(army, "material-request-consultation", {
      ...ids, requestId, suppliers: { alpha, beta, delta }, elbow, tee, lineIds,
      quotes: final.map((quote) => ({ id: quote.id, supplier_id: quote.supplier_id, status: quote.status, with_references: quote.with_references })),
      pdf: { id: storedPdf.id, byte_size: storedPdf.byte_size, sha256: storedSha[1] },
      copies: copyOutcomes,
      lineScreenshots: [draftLinesScreenshot, validatedLinesScreenshot, mobileLinesScreenshot],
      lines: priced.map((line) => ({
        id: line.id, supplier_id: line.supplier_id, unit_price_ht_cents: line.unit_price_ht_cents, price_per: line.price_per,
      })),
    });
  },
);
