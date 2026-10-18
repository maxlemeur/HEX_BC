import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { credentials, expect, secrets, type App, type Screen } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import {
  approvalFromJourneyProcess, createV3, documentChecks, expectedDocumentChecks, expectedExportChecks, exportChecks, exportWorkbook,
  generatePdf, moveToS5, pdfText, printText, readApproval, retakeLease, S2, S5, settleOneLineV3, settleV3, storedPdfBytes,
  storedPdfState, verifySeal, type Envelope, type Evidence, type Scenario,
} from "./engine-v3-emission-support";
import { setTenantCalcPolicy, useDedicatedV3Owner } from "./engine-v3-persistence-support";
import { admitCollectedResendDecision, offerTest, recordOfferEvidence } from "./resend-portal-fixtures";

// Lot 2, sous-lot 2.7 — document client, contrat client 2, charge de calcul 6, émission v3
// (docs/testing/estimate-engine-v3-2.7.md §3 ; conception §14 2.7). Défaillances observables,
// écrites avant le code :
//  V3M-01 Une v3 ne peut pas être émise (refus ESTIMATE_ENGINE_UNAVAILABLE ou ESTIMATE_V3_EMISSION_NOT_READY) :
//         premier rouge attendu avant M5 et le TS de 2.7.
//  V3M-02 Le PDF émis imprime d'autres montants que le §5 : une ligne dont PT ≠ ⌈Q × PU⌋ (O1 20 ml
//         166,63 / 3 332,60, O4 1 139 ml 13,53 / 15 410,67), un net de ligne au lieu du brut,
//         pas de ligne « Remise commerciale −1,01 € », un « Total HT net » ≠ 69 053,55.
//  V3M-03 La TVA imprimée n'est pas calculée par taux sur la base nette (S2 : 20 % 69 053,55 /
//         13 810,71 ; S5 : 10 % 5 554,53 / 555,45 et 20 % 63 499,02 / 12 699,80, TTC 82 308,80).
//  V3M-04 Le sceau d'une v3 n'est pas marqué 5, n'est pas lié au contrat 2 et à la charge 6, ou ne se
//         vérifie pas ; le PDF joint n'est pas le document stocké.
//  V3M-05 L'impression, le portail ou les exports XLSX et DPGF montrent d'autres PU, PT, remise ou
//         TVA que le PDF.
//  V3M-06 Deux générations d'un même devis figé ou deux envois d'une même version scellée ne
//         produisent pas le même document.
//  V3M-07 L'acceptation au portail d'une v3 échoue ou change son sceau.
//  V3M-08 Régression : une v2 émise avant (contrat 1, charge 4, marqueur 5) ne se vérifie plus ou
//         change de SHA-256 de PDF après les émissions v3.
// Ajoutés à la revue 2.7 (docs/testing/estimate-engine-v3-2.7.md §12) :
//  V3M-09 Le résumé d'approbation d'une version émise (GET …/approval, lu par la fiche et l'affaire)
//         échoue : la relecture tente l'écriture que guard_estimate_versions_readonly refuse (régression
//         de e4fc30cf ; le panneau d'approbation disparaît).
//  V3M-10 Une v3 au-dessus du seuil d'approbation ne peut pas être émise une fois approuvée, ou son
//         approbation ne survit pas au gel du document, au PDF et à l'envoi.
//  V3M-11 L'envoi d'une v3 que le moteur 3 ne peut pas figer (ligne chiffrée sans unité), avec un
//         fournisseur configuré, réussit, échoue sans son nom, ou laisse un document, un reçu, un
//         changement de statut ou de version.
// V3M01, V3M03 et V3M04 s'exécutent dans la phase calc-v3 `emission-v3` (collecteur sentinelle, build
// de production possédé, `next start`) ; V3M02, sans courriel, dans la campagne critique locale sur le
// build de production. Chacun n'est défini que dans sa campagne : la phase calc-v3 exige son résultat
// exact par fichier.
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const UNIT_REQUIRED = "Une unité est requise sur chaque ligne chiffrée avant le gel.";
type Ui ={ app: App; screen: Screen; browser: Browser; army: ArmyState };
type Receipt = { id: string; pdf: { sha256: string; bytes: number }; delivery: string };
type Packet = { id: string; payload: { html: string; attachments: { filename: string; content: string }[] } };
type EmissionFixture = {
  schemaVersion: "calc-v3-emission-v3-2";
  owner: { userId: string; tenantId: string; laborRoleId: string };
  v2Witness: { projectId: string; versionId: string; lineTitle: string; expected: { ht: number; tax: number; ttc: number } };
  /** Affaire de V3M03 portant sa propre règle d'approbation active à 5 000 € HT (portée « client »). */
  approvalProject: { projectId: string; ruleId: string; thresholdCents: number };
};

function emissionFixture(): EmissionFixture {
  const file = process.env.E2E_V3_EMISSION_FIXTURE_PATH;
  if (!file) throw new Error("The emission-v3 journeys require the calc-v3 emission-v3 fixture path.");
  const value = JSON.parse(readFileSync(file, "utf8")) as EmissionFixture;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (value.schemaVersion !== "calc-v3-emission-v3-2" || ![value.owner.userId, value.owner.tenantId, value.owner.laborRoleId,
    value.v2Witness.projectId, value.v2Witness.versionId, value.approvalProject.projectId, value.approvalProject.ruleId]
    .every((id) => uuid.test(id)) || value.approvalProject.thresholdCents !== 500000) {
    throw new Error("The emission-v3 fixture shape differs.");
  }
  return value;
}

/**
 * V3M-09 : le résumé d'approbation d'une version émise se relit (200), sans l'écriture vouée au refus
 * de guard_estimate_versions_readonly (e4fc30cf) ; la fiche et l'affaire le lisent par cette route.
 */
async function expectIssuedApprovalRead(ui: Ui, record: Evidence, label: string, versionId: string, approvalStatus: string) {
  const read = await readApproval(ui.browser, versionId);
  const actual = { status: read.status, ok: read.ok, code: read.code, approvalStatus: read.approvalStatus };
  const expected = { status: 200, ok: true, code: null, approvalStatus };
  await record(`${label}-approval-read`, { versionId, expected, actual });
  expect(actual).toEqual(expected);
}

/** Noms des reçus du collecteur (un répertoire par message reçu). */
async function receiptNames() {
  return (await readdir(collectorReceipts())).filter((entry) => /^[a-f0-9]{64}$/.test(entry)).sort();
}

function collectorReceipts() {
  const configured = process.env.E2E_OFFER_COLLECTOR_DIRECTORY;
  if (!configured) throw new Error("Explicit private collector directory required.");
  return path.resolve(configured, "receipts");
}

/** Le reçu du collecteur pour cet identifiant de fournisseur : PDF archivé = pièce jointe = reçu. */
async function collected(messageId: string) {
  let match: { directory: string; receipt: Receipt } | undefined;
  for (const name of (await readdir(collectorReceipts())).filter((entry) => /^[a-f0-9]{64}$/.test(entry))) {
    const directory = path.join(collectorReceipts(), name);
    const receipt = JSON.parse(await readFile(path.join(directory, "public/receipt.json"), "utf8")) as Receipt;
    if (receipt.id === messageId) {
      if (match) throw new Error("Duplicate provider ID in collector.");
      match = { directory, receipt };
    }
  }
  if (!match) throw new Error("Successful app response has no committed local receipt.");
  const packet = JSON.parse(await readFile(path.join(match.directory, "private/payload.json"), "utf8")) as Packet;
  const pdf = await readFile(path.join(match.directory, "private/attachment.pdf"));
  expect([packet.id, pdf.subarray(0, 5).toString("ascii"), digest(pdf), match.receipt.delivery])
    .toEqual([messageId, "%PDF-", match.receipt.pdf.sha256, "local-collection-only"]);
  expect(digest(Buffer.from(packet.payload.attachments[0].content, "base64"))).toBe(match.receipt.pdf.sha256);
  const links = [...packet.payload.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((link) => link[2].replace(/<[^>]*>/g, "").trim() === "Consulter le devis");
  expect(links.length).toBe(1);
  return { ...match, pdf, portalUrl: links[0][1].replace(/&amp;/g, "&") };
}

async function expectOfferGuardInstalled(record: Evidence) {
  const networkFile = process.env.E2E_OFFER_NETWORK_LOG;
  if (!networkFile) throw new Error("App preload network witness required before confirmation.");
  const entries = (await readFile(networkFile, "utf8")).trim().split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; pid: number });
  const installed = entries.filter((entry) => entry.kind === "guard-installed" && entry.pid !== process.pid).length;
  await record("offer-guard", { installed });
  expect(installed > 0).toBe(true);
}

/** Envoi réel par la route que la fenêtre d'envoi appelle (POST …/send), vers le collecteur sentinelle. */
async function sendOffer(ui: Ui, record: Evidence, label: string, versionId: string) {
  const before = await readEstimate(ui.browser, versionId);
  if (before.version.status === "draft") await retakeLease(ui.browser, versionId);
  const response = await apiRequest<Envelope<{ message_id: string }>>(ui.browser, "POST", `/api/estimates/${versionId}/send`, {
    to: `army-${label}@offer.invalid`, subject: `${label} offre commerciale v3`, message: "Veuillez consulter notre proposition et son PDF contractuel.",
  }, { "idempotency-key": randomUUID(), "if-match": before.version.updated_at });
  await record(`${label}-send`, { versionId, status: response.status, ok: response.body.ok, error: response.body.error ?? null,
    statusBefore: before.version.status });
  expect({ status: response.status, code: response.body.error?.code ?? null }).toEqual({ status: 200, code: null });
  const result = await collected(response.body.data.message_id);
  await record(`${label}-receipt`, { versionId, receipt: result.receipt, portalUrlSha256: digest(result.portalUrl) });
  return result;
}

async function ownerLogin(ui: Ui) {
  await ui.app.clearState();
  await ui.app.open("/login");
  const show = ui.screen.getByRole("button", "Afficher le mot de passe", { exact: true });
  const hide = ui.screen.getByRole("button", "Masquer le mot de passe", { exact: true });
  await expect.poll(async () => {
    if (await hide.isVisible()) return true;
    if (await show.isVisible()) await show.tap();
    return await hide.isVisible();
  }, { timeout: 30_000 }).toBe(true);
  await hide.tap();
  const account = credentials.user("army");
  await ui.screen.getByLabel("Email", { exact: true }).fill(account.username);
  await ui.screen.getByLabel(/Mot de passe/).fill(account.password);
  await ui.screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(ui.browser).toHaveURL(/\/dashboard(?:\/.*)?$/, { timeout: 45_000 });
}

/** Le portail anonyme du lien collecté (pointeur privé, jamais d'argument d'assertion du navigateur). */
async function openCollectedPortal(ui: Ui, portalUrl: string) {
  const pointer = process.env.E2E_OFFER_SECRET_POINTER;
  if (!pointer) throw new Error("Explicit private capability pointer required.");
  const target = new URL(portalUrl);
  const token = target.pathname.match(/^\/portal\/([0-9a-f-]{36})$/i)?.[1];
  if (target.origin !== new URL(ui.app.baseUrl!).origin || !token) throw new Error("Collected CTA points outside the owned portal.");
  await mkdir(path.dirname(path.resolve(pointer)), { recursive: true });
  await writeFile(pointer, `${JSON.stringify({ portalUrl, portalToken: token })}\n`, { mode: 0o600 });
  await ui.app.clearState();
  const bridge = new URL("/__army_offer_secret_bridge", ui.app.baseUrl!).href;
  await ui.browser.route(bridge, async (route) => route.fulfill({ headers: { "content-type": "text/html; charset=utf-8" }, body:
    '<!doctype html><html><head><meta charset="utf-8"></head><body><form onsubmit="event.preventDefault();location.assign(document.getElementById(\'target\').value)"><label for="target">Lien privé collecté</label><input id="target"><label for="token">Capacité privée</label><input id="token"><button type="submit">Ouvrir le lien collecté</button></form></body></html>' }));
  await ui.app.open("/__army_offer_secret_bridge");
  await ui.screen.getByLabel("Lien privé collecté", { exact: true }).fill(secrets.get("portalUrl"));
  await ui.screen.getByLabel("Capacité privée", { exact: true }).fill(secrets.get("portalToken"));
  await ui.screen.getByRole("button", "Ouvrir le lien collecté", { exact: true }).click();
  await expect(ui.browser).toHaveURL(/\/portal\//, { timeout: 30_000 });
  await expect.poll(async () => ui.browser.evaluate(() => document.readyState !== "loading" && document.body.innerText.trim().length > 0),
    { timeout: 30_000 }).toBe(true);
  return ui.browser.evaluate(() => document.body.innerText);
}

/** PDF reçu, impression et exports d'une v3 émise : mêmes montants, au centime (V3M-02, V3M-03, V3M-05). */
async function expectIssuedDocument(ui: Ui, record: Evidence, label: string, versionId: string, scenario: Scenario, pdf: Buffer) {
  const text = await pdfText(pdf);
  const pdfChecks = documentChecks(text.text, scenario);
  await record(`${label}-pdf-text`, { versionId, sha256: text.sha256, pages: text.pageCount, characters: text.characters,
    expected: expectedDocumentChecks(scenario), actual: pdfChecks });
  expect(pdfChecks).toEqual(expectedDocumentChecks(scenario));
  const print = documentChecks(await printText(ui.app, ui.screen, ui.browser, versionId), scenario);
  await record(`${label}-print`, { versionId, expected: expectedDocumentChecks(scenario), actual: print });
  expect(print).toEqual(expectedDocumentChecks(scenario));
  for (const mode of ["standard", "dpgf"] as const) {
    const workbook = await exportWorkbook(ui.browser, versionId, mode);
    const checks = exportChecks(workbook.rows, ui.army.runPrefix);
    await record(`${label}-export-${mode}`, { versionId, sha256: workbook.sha256, bytes: workbook.bytes, expected: expectedExportChecks(), actual: checks });
    expect(checks).toEqual(expectedExportChecks());
  }
  return text;
}

if (process.env.E2E_ARMY_SUITE === "calc-v3" && process.env.E2E_CALC_V3_PHASE === "emission-v3") {
  offerTest("V3M01 a v3 issued in S2 then S5 under client contract 2 and payload 6 prints, seals, exports and is accepted with the oracle amounts",
    { session: "army", trace: "off", tags: ["engine-v3", "offer-emission"], timeout: 900_000 }, async (ui) => {
      const { app, browser, army } = ui;
      const fixture = emissionFixture();
      const record: Evidence = (label, data) => recordOfferEvidence(army, `v3m01-${label}`, data);
      await app.open("/dashboard/affaires");

      // Préparation, témoin v2 (contrat 1, charge 4, marqueur 5) émis avant toute v3 : comportement existant.
      const witness = fixture.v2Witness;
      ownEstimate(army, { projectId: witness.projectId, versionId: witness.versionId });
      const witnessLock = await apiRequest(browser, "POST", `/api/estimates/${witness.versionId}/lock`);
      expect(witnessLock.status).toBe(201);
      await generatePdf(browser, record, "v2-witness", witness.versionId);
      await expectOfferGuardInstalled(record);
      const witnessSent = await sendOffer(ui, record, "v2-witness", witness.versionId);
      // Sending a draft renders its email PDF again (preparePdfForDispatch, force) : the attachment
      // must be the document stored after the send, as in OF00.
      const witnessStored = await storedPdfState(browser, witness.versionId);
      const witnessText = await pdfText(witnessSent.pdf);
      const witnessState = await readEstimate(browser, witness.versionId);
      const witnessVerified = await verifySeal(browser, witness.versionId);
      const witnessBefore = {
        receiptMatchesDocument: witnessSent.receipt.pdf.sha256 === witnessStored.sha256,
        line: /(?:^| )1 u 20,00 ?€ 20,00 ?€/u.test(witnessText.text),
        version: [witnessState.version.calc_engine_version, witnessState.version.status, witnessState.version.seal_payload_version,
          witnessState.version.total_ht_cents, witnessState.version.total_tax_cents, witnessState.version.total_ttc_cents],
        verified: [witnessVerified.status, witnessVerified.data?.valid ?? null],
      };
      await record("v2-witness-issued", { versionId: witness.versionId, sha256: witnessSent.receipt.pdf.sha256, actual: witnessBefore });
      expect(witnessBefore).toEqual({ receiptMatchesDocument: true, line: true,
        version: [2, "sent", 5, witness.expected.ht, witness.expected.tax, witness.expected.ttc], verified: [200, true] });

      // S2 : v3 créée et réglée par l'API de 2.5, puis émise (premier rouge attendu avant M5 : génération du PDF).
      const s2 = await createV3(browser, army, record, "V3M-S2");
      await settleV3(browser, army, record, "V3M-S2", s2, S2, fixture.owner.laborRoleId);
      await generatePdf(browser, record, "s2", s2.versionId);
      const s2Sent = await sendOffer(ui, record, "s2", s2.versionId);
      expect((await storedPdfState(browser, s2.versionId)).sha256).toBe(s2Sent.receipt.pdf.sha256);
      const s2State = await readEstimate(browser, s2.versionId);
      const s2Verified = await verifySeal(browser, s2.versionId);
      await record("s2-seal", { versionId: s2.versionId, status: s2State.version.status, marker: s2State.version.seal_payload_version, verified: s2Verified });
      expect([s2State.version.status, s2State.version.seal_payload_version, s2State.version.total_ht_cents,
        s2State.version.total_tax_cents, s2State.version.total_ttc_cents]).toEqual(["sent", 5, ...S2.totals]);
      expect(s2Verified).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: s2State.version.seal_hash,
        computed_hash: s2State.version.seal_hash, seal_payload_version: 5, client_contract_version: 2, calc_payload_version: 6 } });
      // V3M-09 : S2, créé, réglé et envoyé par l'API, n'a jamais été évalué en brouillon (règle par défaut désactivée).
      await expectIssuedApprovalRead(ui, record, "s2", s2.versionId, "not_required");
      await expectIssuedDocument(ui, record, "s2", s2.versionId, S2, s2Sent.pdf);

      // S5 : O1–O3 à 10 %, O4–O7 à 20 % ; émis, renvoyé (même document), puis accepté au portail.
      await app.open("/dashboard/affaires");
      const s5 = await createV3(browser, army, record, "V3M-S5");
      await settleV3(browser, army, record, "V3M-S5", s5, S5, fixture.owner.laborRoleId);
      await generatePdf(browser, record, "s5", s5.versionId);
      const s5Sent = await sendOffer(ui, record, "s5", s5.versionId);
      expect((await storedPdfState(browser, s5.versionId)).sha256).toBe(s5Sent.receipt.pdf.sha256);
      const s5State = await readEstimate(browser, s5.versionId);
      const s5Verified = await verifySeal(browser, s5.versionId);
      await record("s5-seal", { versionId: s5.versionId, status: s5State.version.status, marker: s5State.version.seal_payload_version, verified: s5Verified });
      expect([s5State.version.status, s5State.version.seal_payload_version, s5State.version.total_ht_cents,
        s5State.version.total_tax_cents, s5State.version.total_ttc_cents]).toEqual(["sent", 5, ...S5.totals]);
      expect(s5Verified).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: s5State.version.seal_hash,
        computed_hash: s5State.version.seal_hash, seal_payload_version: 5, client_contract_version: 2, calc_payload_version: 6 } });
      await expectIssuedApprovalRead(ui, record, "s5", s5.versionId, "not_required");
      const s5Text = await expectIssuedDocument(ui, record, "s5", s5.versionId, S5, s5Sent.pdf);
      await app.open(`/dashboard/estimates/${s5.versionId}`);
      const s5Resent = await sendOffer(ui, record, "s5-resend", s5.versionId);
      const resentText = await pdfText(s5Resent.pdf);
      const resend = { distinctReceipt: s5Resent.receipt.id !== s5Sent.receipt.id, distinctPortal: s5Resent.portalUrl !== s5Sent.portalUrl,
        samePdf: s5Resent.receipt.pdf.sha256 === s5Sent.receipt.pdf.sha256, sameText: resentText.text === s5Text.text };
      await record("s5-resend-same-document", { versionId: s5.versionId, actual: resend });
      expect(resend).toEqual({ distinctReceipt: true, distinctPortal: true, samePdf: true, sameText: true });

      await admitCollectedResendDecision(army, { ...s5, receiptDirectory: s5Resent.directory, providerId: s5Resent.receipt.id,
        initialProviderId: s5Sent.receipt.id, portalUrl: s5Resent.portalUrl, initialPortalUrl: s5Sent.portalUrl, decision: "accept", reason: null });
      const portal = documentChecks(await openCollectedPortal(ui, s5Resent.portalUrl), S5);
      await record("s5-portal", { versionId: s5.versionId, portalUrlSha256: digest(s5Resent.portalUrl), expected: expectedDocumentChecks(S5), actual: portal });
      expect(portal).toEqual(expectedDocumentChecks(S5));
      // The portal actions are a client island: under next dev a click that lands before hydration
      // opens nothing, so click again until the modal shows (as ownerLogin does for its toggle).
      const accept = ui.screen.getByRole("button", "Accepter le devis", { exact: true });
      const modal = ui.screen.getByRole("dialog", "Accepter le devis", { exact: true });
      await expect.poll(async () => {
        if (!(await modal.isVisible())) await accept.click();
        return modal.isVisible();
      }, { timeout: 30_000 }).toBe(true);
      await expect(modal).toBeVisible();
      await modal.getByRole("checkbox", "J’accepte ce devis et ses conditions", { exact: true }).check();
      const [decision] = await Promise.all([
        browser.waitForResponse(/\/api\/portal\/[a-f0-9-]{36}\/accept$/i, { timeout: 45_000 }),
        modal.getByRole("button", "Confirmer l’acceptation", { exact: true }).click(),
      ]);
      const decided = await decision.json<{ status?: string }>();
      await record("s5-portal-decision", { versionId: s5.versionId, status: decision.status, decision: decided.status ?? null });
      expect([decision.status, decided.status]).toEqual([200, "accepted"]);
      await ownerLogin(ui);
      const accepted = await readEstimate(browser, s5.versionId);
      expect([accepted.version.status, accepted.version.seal_hash, accepted.version.seal_payload_version, accepted.version.total_ttc_cents])
        .toEqual(["accepted", s5State.version.seal_hash, 5, S5.totals[2]]);

      // V3M-08 : le témoin v2 émis avant les v3 se vérifie toujours, contrat 1 et charge 4, même PDF.
      const witnessAfter = await verifySeal(browser, witness.versionId);
      const witnessDocument = await storedPdfState(browser, witness.versionId);
      await record("v2-witness-regression", { versionId: witness.versionId, verified: witnessAfter, document: witnessDocument,
        expectedSha256: witnessSent.receipt.pdf.sha256 });
      expect(witnessAfter).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: witnessState.version.seal_hash,
        seal_payload_version: 5, client_contract_version: 1, calc_payload_version: 4 } });
      expect([witnessDocument.status, witnessDocument.documentStatus, witnessDocument.sha256]).toEqual([200, "ready", witnessSent.receipt.pdf.sha256]);
    });

  // V3M-10 : la règle d'approbation de l'affaire de la fixture (5 000 € HT, portée « client ») s'applique à S2
  // (69 053,55 € HT) ; l'administrateur de l'entreprise approuve, puis la v3 est émise sous le contrat 2.
  offerTest("V3M03 a v3 above its approval threshold is approved, then issued under client contract 2 and payload 6 with its approval intact",
    { session: "army", trace: "off", tags: ["engine-v3", "offer-emission"], timeout: 600_000 }, async (ui) => {
      const { app, browser, army } = ui;
      const fixture = emissionFixture();
      const { projectId, ruleId } = fixture.approvalProject;
      const record: Evidence = (label, data) => recordOfferEvidence(army, `v3m03-${label}`, data);
      await app.open("/dashboard/affaires");
      await expectOfferGuardInstalled(record);
      const ids = await createV3(browser, army, record, "V3M-approval", projectId);
      await settleV3(browser, army, record, "V3M-approval", ids, S2, fixture.owner.laborRoleId);

      const required = await readApproval(browser, ids.versionId);
      const requiredView = { status: required.status, approvalStatus: required.approvalStatus,
        rule: required.reasons.some((reason) => reason.ruleId === ruleId) };
      await record("required", { versionId: ids.versionId, ruleId, expected: { status: 200, approvalStatus: "required", rule: true },
        actual: requiredView });
      expect(requiredView).toEqual({ status: 200, approvalStatus: "required", rule: true });
      const submitted = await approvalFromJourneyProcess(app, browser, ids.versionId,
        { action: "submit_for_review", rule_ids: [ruleId], submission_message: `${army.runPrefix} approbation v3` });
      const inReview = await readEstimate(browser, ids.versionId);
      const decided = await approvalFromJourneyProcess(app, browser, ids.versionId, { action: "decide", decision: "approved", comments: [] });
      const approved = await readEstimate(browser, ids.versionId);
      const approvedRead = await readApproval(browser, ids.versionId);
      const approval = {
        submitted: [submitted.status, submitted.ok], inReview: inReview.version.approval_status,
        decided: [decided.status, decided.ok], approved: approved.version.approval_status,
        read: [approvedRead.status, approvedRead.approvalStatus],
        totals: [approved.version.total_ht_cents, approved.version.total_tax_cents, approved.version.total_ttc_cents],
      };
      const expectedApproval = { submitted: [201, true], inReview: "in_review", decided: [200, true], approved: "approved",
        read: [200, "approved"], totals: [...S2.totals] };
      await record("approval", { versionId: ids.versionId, expected: expectedApproval, actual: approval, submitted, decided });
      expect(approval).toEqual(expectedApproval);

      // Gel du document, PDF puis envoi : l'approbation et la révision survivent ; sceau du contrat 2 et de la charge 6.
      await generatePdf(browser, record, "pdf", ids.versionId);
      const afterPdf = await readEstimate(browser, ids.versionId);
      const sent = await sendOffer(ui, record, "send", ids.versionId);
      const stored = await storedPdfState(browser, ids.versionId);
      const issued = await readEstimate(browser, ids.versionId);
      const verified = await verifySeal(browser, ids.versionId);
      const text = await pdfText(sent.pdf);
      const actual = {
        afterPdf: [afterPdf.version.status, afterPdf.version.approval_status, afterPdf.version.content_revision],
        issued: [issued.version.status, issued.version.approval_status, issued.version.content_revision, issued.version.seal_payload_version,
          issued.version.total_ht_cents, issued.version.total_tax_cents, issued.version.total_ttc_cents],
        receiptMatchesDocument: sent.receipt.pdf.sha256 === stored.sha256,
        document: documentChecks(text.text, S2),
      };
      const expected = {
        afterPdf: ["draft", "approved", approved.version.content_revision],
        issued: ["sent", "approved", approved.version.content_revision, 5, ...S2.totals],
        receiptMatchesDocument: true,
        document: expectedDocumentChecks(S2),
      };
      await record("issued", { versionId: ids.versionId, sha256: text.sha256, expected, actual, verified });
      expect(actual).toEqual(expected);
      expect(verified).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: issued.version.seal_hash,
        computed_hash: issued.version.seal_hash, seal_payload_version: 5, client_contract_version: 2, calc_payload_version: 6 } });
      await expectIssuedApprovalRead(ui, record, "issued", ids.versionId, "approved");
    });

  // V3M-11 : E2E-03 de 2.1 avec un fournisseur configuré (le collecteur) ; V3FC02 n'en fait qu'un contrôle de configuration.
  offerTest("V3M04 sending a v3 that engine 3 cannot freeze is refused by name with a provider configured, leaving no document, receipt or status change",
    { session: "army", trace: "off", tags: ["engine-v3", "offer-emission"], timeout: 300_000 }, async (ui) => {
      const { app, browser, army } = ui;
      emissionFixture();
      const record: Evidence = (label, data) => recordOfferEvidence(army, `v3m04-${label}`, data);
      await app.open("/dashboard/affaires");
      await expectOfferGuardInstalled(record);
      const ids = await createV3(browser, army, record, "V3M-unitless");
      await settleOneLineV3(browser, army, record, "V3M-unitless", ids, { unitCode: null, pricingStatus: "priced" });
      await retakeLease(browser, ids.versionId);
      const before = await readEstimate(browser, ids.versionId);
      const receiptsBefore = await receiptNames();
      const refused = await apiRequest<Envelope<unknown>>(browser, "POST", `/api/estimates/${ids.versionId}/send`, {
        to: "army-unitless@offer.invalid", subject: "V3M-unitless offre commerciale v3", message: "Tentative d'envoi d'une v3 sans unité.",
      }, { "idempotency-key": randomUUID(), "if-match": before.version.updated_at });
      const after = await readEstimate(browser, ids.versionId);
      const document = await storedPdfState(browser, ids.versionId);
      const actual = {
        send: { status: refused.status, ok: refused.body.ok ?? null, code: refused.body.error?.code ?? null,
          message: refused.body.error?.message ?? null },
        state: [after.version.status, after.version.updated_at, after.version.content_revision],
        document: [document.status, document.documentStatus],
        receipts: await receiptNames(),
      };
      const expected = {
        send: { status: 400, ok: false, code: "ESTIMATE_V3_UNIT_REQUIRED", message: UNIT_REQUIRED },
        state: ["draft", before.version.updated_at, before.version.content_revision],
        document: [404, null],
        receipts: receiptsBefore,
      };
      await record("send-refused", { versionId: ids.versionId, expected, actual });
      expect(actual).toEqual(expected);
    });
}

if (process.env.E2E_ARMY_SUITE === "critical") {
  armyTest("V3M02 a v3 in S2 then S5 renders its client document, print and exports with the oracle amounts on the production build, and a v3 without a priced line keeps its version VAT rate",
    { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 600_000 }, async ({ app, screen, browser, army }) => {
      const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
      if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
        !process.env.E2E_ARMY_LOCAL_DB_URL) throw new Error("V3M02 requires the owned local Supabase stack and its SQL route.");
      const ui: Ui = { app, screen, browser, army };
      const record: Evidence = (label, data) => recordEvidence(army, `v3m02-${label}`, data);
      // A policy at 3 on the shared campaign tenant would make concurrent creations fail (V3P01, §9.5).
      const owner = await useDedicatedV3Owner(browser, app.baseUrl!, army.runPrefix);
      await app.open("/dashboard/affaires");
      const policy = await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} recette 2.7 document v3` });
      expect(policy).toMatchObject({ engine: 3, fo: 1.3, mo: 1.2, allowedTaxRatesBp: [2000, 1000, 550, 210] });
      const ids = await createV3(browser, army, record, "V3M02");
      const lock = await apiRequest(browser, "POST", `/api/estimates/${ids.versionId}/lock`);
      expect(lock.status).toBe(201);
      const role = await apiRequest<Envelope<{ labor_role: { id: string; hourly_rate_cents: number } }>>(browser, "POST",
        `/api/estimates/${ids.versionId}/labor-roles`, { name: "Tuyauteur", hourly_rate_cents: 4000 });
      expect([role.status, role.body.ok, role.body.data?.labor_role?.hourly_rate_cents]).toEqual([201, true, 4000]);
      await settleV3(browser, army, record, "V3M02", ids, S2, role.body.data.labor_role.id);

      // S2 : deux générations du même devis figé donnent le même texte (premier rouge attendu avant M5).
      await generatePdf(browser, record, "s2", ids.versionId);
      const first = await expectIssuedDocument(ui, record, "s2", ids.versionId, S2, await storedPdfBytes(browser, ids.versionId));
      await generatePdf(browser, record, "s2-again", ids.versionId);
      const second = await pdfText(await storedPdfBytes(browser, ids.versionId));
      await record("s2-two-generations", { versionId: ids.versionId, first: first.sha256, second: second.sha256, sameText: second.text === first.text });
      expect(second.text).toBe(first.text);

      // S5 sur le même brouillon : deux taux au pied, mêmes lignes brutes.
      await app.open("/dashboard/affaires");
      await moveToS5(browser, record, "V3M02", ids.versionId);
      await generatePdf(browser, record, "s5", ids.versionId);
      await expectIssuedDocument(ui, record, "s5", ids.versionId, S5, await storedPdfBytes(browser, ids.versionId));

      // Revue 2.7 (§12) : une v3 sans ligne chiffrée a un récapitulatif de TVA vide ; l'en-tête de validité du
      // document client reprend le taux par défaut de la version (3a8e576a ; rouge sans lui : « TVA : » vide).
      await app.open("/dashboard/affaires");
      const unpriced = await createV3(browser, army, record, "V3M02-unpriced");
      await settleOneLineV3(browser, army, record, "V3M02-unpriced", unpriced, { unitCode: "u", pricingStatus: "included" });
      await generatePdf(browser, record, "unpriced", unpriced.versionId);
      const unpricedText = await pdfText(await storedPdfBytes(browser, unpriced.versionId));
      const header = { versionRate: /Validité : 30 jours [—–-] TVA : 20 %/u.test(unpricedText.text) };
      await record("unpriced-header", { versionId: unpriced.versionId, sha256: unpricedText.sha256, expected: { versionRate: true },
        actual: { ...header, excerpt: /Validité : .{0,40}/u.exec(unpricedText.text)?.[0] ?? null } });
      expect(header).toEqual({ versionRate: true });
    });
}
