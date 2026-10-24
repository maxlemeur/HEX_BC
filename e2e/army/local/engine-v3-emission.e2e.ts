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
import { waitForDraftLease } from "./engine-v3-editor-support";
import { setTenantCalcPolicy, useDedicatedV3Owner } from "./engine-v3-persistence-support";
import { admitCollectedResendDecision, allowOfferLifecycleTransition, offerTest, recordOfferEvidence } from "./resend-portal-fixtures";

// Lot 2, sous-lot 2.7 — document client, contrat client 2, charge de calcul 6, émission v3
// (docs/testing/estimate-engine-v3-2.7.md §3 ; conception §14 2.7). Défaillances observables,
// écrites avant le code :
//  V3M-01 Une v3 ne peut pas être émise (refus ESTIMATE_ENGINE_UNAVAILABLE ou ESTIMATE_V3_EMISSION_NOT_READY) :
//         premier rouge attendu avant M5 et le TS de 2.7.
//  V3M-02 Le PDF émis imprime d'autres montants que le §5 (provision FO 1,01, TI-534) : une ligne dont PT ≠ ⌈Q × PU⌋
//         (O1 20 ml 167,34 / 3 346,80, O4 1 139 ml 13,57 / 15 456,23), un net de ligne au lieu du brut,
//         pas de ligne « Remise commerciale −1,01 € », un « Total HT net » ≠ 69 472,53.
//  V3M-03 La TVA imprimée n'est pas calculée par taux sur la base nette (S2 : 20 % 69 472,53 /
//         13 894,51 ; S5 : 10 % 5 588,41 / 558,84 et 20 % 63 884,12 / 12 776,82, TTC 82 808,19).
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
// Ajoutés à la fusion de 2.6 (docs/testing/estimate-engine-v3-2.7.md §13), la fiche et l'éditeur v3 de 2.6
// ayant fermé jusqu'en 2.7 ce que 2.7 ouvre :
//  V3M-12 La fiche d'un brouillon v3 garde « Préparer le PDF » désactivé (raison de 2.6), ou le PDF préparé par
//         sa fenêtre n'est pas le document client v3 (« 1 u 13,13 € 13,13 € », TVA 20 % 13,13 / 2,63, TTC 15,76).
//  V3M-13 L'éditeur d'une v3 n'offre pas « Envoyer », ou son émission manuelle ne scelle pas la v3 (marqueur 5,
//         contrat 2, charge 6).
//  V3M-14 La fiche d'une v3 émise dit « Non scellé », ne propose ni le PDF original ni « Marquer accepté »,
//         l'acceptation par la fiche change le sceau, ou le modèle (2.8) y est proposé sans sa raison.
//  Sur les deux fiches, la carte de lecture v3 de 2.6 dit encore le document client et l'émission « pas encore
//  disponibles », ou titre « Brouillon » une v3 émise.
// Ajouté à la revue Codex de 3d78d662, voie A (docs/testing/estimate-engine-v3-2.7.md §13.8) :
//  V3M-15 L'impression d'une v3 émise imprime l'identité vivante au lieu de la copie émise que couvre son sceau
//         valide : « Émis par » est le profil du lecteur (un second administrateur du tenant), et le client, la
//         référence, l'affaire et l'adresse du chantier sont ceux modifiés après l'émission.
//  V3M-16 Le pied du portail d'une copie au contrat 2 avec remise met en bandeau « Total HT brut » au lieu de
//         « Total HT net », ou ne fait pas ressortir « Total TTC », contrairement à l'emphase que porte
//         buildEstimateV3FooterRows (HT net en bandeau, TTC en gras) et que suivent le PDF et l'impression.
// Ajouté à la revue de 8dd28c91 (docs/testing/estimate-engine-v3-2.7.md §13.9) :
//  V3M-17 L'impression d'une v3 émise ne reprend pas les CGV de sa copie scellée : la case « Joindre les CGV »
//         (`terms=1`) ou la politique courante du tenant ajoute les CGV du modèle vivant à une copie émise sans CGV, et
//         une mise en page qui ne les demande pas retire celles qu'une copie a scellées.
// Ajouté à la revue Codex de 5b740b2e et 37440c82 (docs/testing/estimate-engine-v3-2.7.md §13.14) :
//  V3M-18 L'impression d'une v3 émise ne reprend pas la mise en page de sa copie scellée : sans paramètre (toutes les
//         entrées de l'application) elle imprime la mise en page par défaut, et avec des paramètres (« Mise en page /
//         imprimer ») un autre niveau de détail, mode de prix, numérotation, sous-total ou densité que le PDF stocké et
//         le portail, sous le badge du sceau valide.
// V3M01, V3M03, V3M04, V3M05 et V3M06 s'exécutent dans la phase calc-v3 `emission-v3` (collecteur sentinelle, build
// de production possédé, `next start`) ; V3M02, sans courriel, dans la campagne critique locale sur le
// build de production. Chacun n'est défini que dans sa campagne : la phase calc-v3 exige son résultat
// exact par fichier.
const digest = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const UNIT_REQUIRED = "Une unité est requise sur chaque ligne chiffrée avant le gel.";
// Raison de la fiche d'une v3 depuis la fusion de 2.6 et 2.7 : seul l'enregistrement comme modèle reste fermé (2.8).
const TEMPLATE_REASON = "Moteur de calcul 3 : l’enregistrement comme modèle n’est pas encore disponible pour ce devis.";
const normalizeQuotes = (text: string | null | undefined) => (text ?? "").replace(/[\s  ]+/g, " ").replace(/[’']/g, "'").trim();
/** La ligne unique de V3M05 dans un texte de document normalisé : « 1 u PU PT », TVA 20 % (base, montant), TTC. */
const oneLineDocument = (text: string) => ({
  line: /(?:^| )1 u (?:[^€]{0,40} )?13,13 ?€(?: [^€]{0,40})? 13,13 ?€/u.test(text),
  tax: /TVA 20 ?%(?: [^€]{0,60})? (?:13,13 ?€(?: [^€]{0,40})? 2,63 ?€|2,63 ?€(?: [^€]{0,40})? 13,13 ?€)/u.test(text),
  ttc: /TTC(?: [^€]{0,30})? 15,76 ?€/u.test(text),
});
const ONE_LINE_DOCUMENT = { line: true, tax: true, ttc: true };
/**
 * CGV bac à sable du profil calc-v3 (`createDevelopmentEstimateTermsTemplate`, politique « default ») dans un texte
 * normalisé : titre et mention de version, imprimés par le PDF, l'impression et le portail (V3M-17). Le titre est lu
 * sans casse : l'en-tête de page de l'impression le met en capitales (`uppercase`, repris par `innerText`).
 */
const termsIn = (text: string) => ({
  title: /Projet de CGV [-–] Travaux B2B/iu.test(text),
  review: /Maquette CGV [-–] version 3 [-–] à valider, non contractuelle\./u.test(text),
});
const SANDBOX_TERMS = { title: true, review: true };
const NO_TERMS = { title: false, review: false };
type Presence = { count(): Promise<number>; isEnabled(): Promise<boolean> };
const presence = async (control: Presence) =>
  (await control.count()) === 1 ? { present: true, enabled: await control.isEnabled() } : { present: false, enabled: false };
type Ui ={ app: App; screen: Screen; browser: Browser; army: ArmyState };
type Receipt = { id: string; pdf: { sha256: string; bytes: number }; delivery: string };
type Packet = { id: string; payload: { html: string; attachments: { filename: string; content: string }[] } };
type EmissionFixture = {
  schemaVersion: "calc-v3-emission-v3-3";
  owner: { userId: string; tenantId: string; laborRoleId: string; displayName: string };
  /** Second administrateur du tenant dédié (V3M06), connecté par l'identifiant `viewer` du profil calc-v3. */
  viewer: { userId: string; tenantId: string; membershipId: string; displayName: string };
  v2Witness: { projectId: string; versionId: string; lineTitle: string; expected: { ht: number; tax: number; ttc: number } };
  /**
   * Affaire de V3M03 : sa propre règle d'approbation active à 5 000 € HT (portée « client ») et un brouillon
   * v3 vide aux coefficients de la politique (le garde de navigateur des offres n'admet une nouvelle version
   * que dans une nouvelle affaire) ; le parcours le remplit par l'application.
   */
  approvalProject: { projectId: string; versionId: string; ruleId: string; thresholdCents: number };
};

function emissionFixture(): EmissionFixture {
  const file = process.env.E2E_V3_EMISSION_FIXTURE_PATH;
  if (!file) throw new Error("The emission-v3 journeys require the calc-v3 emission-v3 fixture path.");
  const value = JSON.parse(readFileSync(file, "utf8")) as EmissionFixture;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (value.schemaVersion !== "calc-v3-emission-v3-3" || ![value.owner.userId, value.owner.tenantId, value.owner.laborRoleId,
    value.viewer.userId, value.viewer.membershipId, value.v2Witness.projectId, value.v2Witness.versionId,
    value.approvalProject.projectId, value.approvalProject.versionId, value.approvalProject.ruleId]
    .every((id) => uuid.test(id)) || value.approvalProject.thresholdCents !== 500000 || value.viewer.tenantId !== value.owner.tenantId
    || value.viewer.userId === value.owner.userId || !value.owner.displayName || !value.viewer.displayName
    || value.owner.displayName.includes(value.viewer.displayName) || value.viewer.displayName.includes(value.owner.displayName)) {
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

/** Connexion ordinaire par l'écran : le propriétaire dédié (`army`) ou le second administrateur du tenant (`viewer`). */
async function accountLogin(ui: Ui, name: "army" | "viewer" = "army") {
  await ui.app.clearState();
  await ui.app.open("/login");
  const show = ui.screen.getByRole("button", "Afficher le mot de passe", { exact: true });
  const hide = ui.screen.getByRole("button", "Masquer le mot de passe", { exact: true });
  await expect(show).toBeEnabled();
  await show.tap();
  await expect(hide).toBeVisible();
  await hide.tap();
  const account = credentials.user(name);
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

/**
 * Identité imprimée par l'aperçu d'impression (V3M-15) : bloc « Émis par », bloc « Devis » (référence, date,
 * version), cartes « Client » et « Chantier » du document visible, état du sceau de l'en-tête. Une adresse
 * électronique est relevée par le nom de son compte (`emails`), jamais en clair.
 */
async function printIdentity(ui: Ui, versionId: string, emails: Record<string, string>) {
  await ui.app.open(`/dashboard/estimates/${versionId}/print`);
  await expect(ui.screen.getByRole("heading", "Devis", { exact: true })).toBeVisible({ timeout: 30_000 });
  const read = await ui.browser.evaluate(() => {
    const visible = Array.from(document.querySelectorAll(".estimate-document")).find((node) => node.getClientRects().length > 0);
    const text = (node: Element) => (node.textContent ?? "").replace(/[\s  ]+/g, " ").trim();
    const lines = (root: Element | null | undefined) => Array.from(root?.querySelectorAll("p") ?? []).map(text).filter(Boolean);
    const issuerLabel = Array.from(visible?.querySelectorAll("p") ?? []).find((node) => text(node) === "Émis par");
    const heading = Array.from(visible?.querySelectorAll("h2") ?? []).find((node) => text(node) === "Devis");
    const card = (title: string) => Array.from(visible?.querySelectorAll("section") ?? [])
      .find((node) => node.querySelector("h3") && text(node.querySelector("h3")!) === title);
    return {
      issuer: lines(issuerLabel?.parentElement).filter((line) => line !== "Émis par"),
      devis: lines(heading?.parentElement),
      client: lines(card("Client")),
      site: lines(card("Chantier")),
      seal: Array.from(document.querySelectorAll("[data-seal-state]")).map((node) => node.getAttribute("data-seal-state")),
    };
  });
  const mask = (line: string) => Object.entries(emails).find(([, email]) => line === email)?.[0]
    ?? (line.includes("@") ? "<autre adresse>" : line);
  return { ...read, issuer: read.issuer.map(mask) };
}

/** CGV de l'aperçu d'impression sous la mise en page demandée (`query`), relevées sur toute la page (V3M-17). */
async function printedTerms(ui: Ui, versionId: string, query: string) {
  await ui.app.open(`/dashboard/estimates/${versionId}/print${query}`);
  await expect(ui.screen.getByRole("heading", "Devis", { exact: true })).toBeVisible({ timeout: 30_000 });
  return termsIn(normalizeQuotes(await ui.browser.evaluate(() => document.body.innerText)));
}

/** Préréglage « décision » de la fenêtre « Préparer le PDF », sous lequel V3M06 scelle sa copie (V3M-18). */
const DECISION_LAYOUT = { preset: "decision_summary", detailLevel: 2, priceMode: "total_only", density: "compact",
  showNumbering: true, showSectionSubtotals: true, conditionsPlacement: "auto", includeTerms: false } as const;

/**
 * Mise en page imprimée d'une v3 sous la requête `query` (V3M-18) : configuration de l'en-tête, en-têtes et lignes du
 * tableau du document visible (numéro, titre et dernier montant de chaque ligne, lus par `textContent`), « Total HT
 * brut » du pied et boutons d'impression proposés.
 */
async function printedLayout(ui: Ui, versionId: string, query: string) {
  await ui.app.open(`/dashboard/estimates/${versionId}/print${query}`);
  await expect(ui.screen.getByRole("heading", "Devis", { exact: true })).toBeVisible({ timeout: 30_000 });
  return ui.browser.evaluate(() => {
    const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/[\s  ]+/g, " ").trim();
    const visible = Array.from(document.querySelectorAll(".estimate-document")).find((node) => node.getClientRects().length > 0);
    const table = Array.from(visible?.querySelectorAll("table") ?? []).find((node) => node.querySelector("thead"));
    const gross = Array.from(visible?.querySelectorAll("[data-testid=\"estimate-v3-document-totals\"] > div") ?? [])
      .find((row) => text(row.querySelector("dt")) === "Total HT brut");
    const buttons = Array.from(document.querySelectorAll("button")).map(text);
    return {
      configuration: Array.from(document.querySelectorAll("span")).map(text).find((value) => value.startsWith("Configuration :")) ?? null,
      headings: Array.from(table?.querySelectorAll("thead th") ?? []).map(text),
      rows: Array.from(table?.querySelectorAll("tbody tr") ?? []).map((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        return { label: Array.from(cells[0]?.querySelectorAll("span") ?? []).map(text), amount: text(cells.at(-1)) };
      }),
      gross: text(gross?.querySelector("dd")),
      layoutButton: buttons.includes("Mise en page / imprimer"),
      printButton: buttons.includes("Imprimer"),
    };
  });
}

/**
 * Lignes du pied d'un document affiché (V3M-16) : libellé, emphase portée (`data-emphasis`), bandeau (même fond
 * que l'en-tête du tableau du document) et montant en gras (graisse d'au moins 600).
 */
async function footerRows(ui: Ui, scope: { root: string; rows: string }) {
  return ui.browser.evaluate((selectors) => {
    const root = Array.from(document.querySelectorAll(selectors.root)).find((node) => node.getClientRects().length > 0);
    const transparent = "rgba(0, 0, 0, 0)";
    const head = [root?.querySelector("thead"), root?.querySelector("thead tr")]
      .map((node) => (node ? getComputedStyle(node).backgroundColor : transparent)).find((color) => color !== transparent) ?? null;
    return Array.from(root?.querySelectorAll(selectors.rows) ?? []).map((row) => {
      const amount = row.querySelector("dd");
      return {
        label: (row.querySelector("dt")?.textContent ?? "").replace(/[\s  ]+/g, " ").trim(),
        emphasis: row.getAttribute("data-emphasis"),
        banner: head !== null && getComputedStyle(row).backgroundColor === head,
        strong: amount !== null && Number(getComputedStyle(amount).fontWeight) >= 600,
      };
    });
  }, scope);
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
      const accept = ui.screen.getByRole("button", "Accepter le devis", { exact: true });
      const modal = ui.screen.getByRole("dialog", "Accepter le devis", { exact: true });
      // PortalActions keeps its buttons disabled until hydration, so one click is the real user press.
      await expect(accept).toBeEnabled();
      await accept.click();
      await expect(modal).toBeVisible();
      await modal.getByRole("checkbox", "J’accepte ce devis et ses conditions", { exact: true }).check();
      const [decision] = await Promise.all([
        browser.waitForResponse(/\/api\/portal\/[a-f0-9-]{36}\/accept$/i, { timeout: 45_000 }),
        modal.getByRole("button", "Confirmer l’acceptation", { exact: true }).click(),
      ]);
      const decided = await decision.json<{ status?: string }>();
      await record("s5-portal-decision", { versionId: s5.versionId, status: decision.status, decision: decided.status ?? null });
      expect([decision.status, decided.status]).toEqual([200, "accepted"]);
      await accountLogin(ui);
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
  // (69 472,53 € HT) ; l'administrateur de l'entreprise approuve, puis la v3 est émise sous le contrat 2.
  offerTest("V3M03 a v3 above its approval threshold is approved, then issued under client contract 2 and payload 6 with its approval intact",
    { session: "army", trace: "off", tags: ["engine-v3", "offer-emission"], timeout: 600_000 }, async (ui) => {
      const { app, browser, army } = ui;
      const fixture = emissionFixture();
      const { projectId, versionId, ruleId } = fixture.approvalProject;
      const record: Evidence = (label, data) => recordOfferEvidence(army, `v3m03-${label}`, data);
      await app.open("/dashboard/affaires");
      await expectOfferGuardInstalled(record);
      const ids = { projectId, versionId };
      ownEstimate(army, ids);
      const seeded = await readEstimate(browser, versionId);
      await record("seeded", { versionId, actual: { engine: seeded.version.calc_engine_version, status: seeded.version.status, items: seeded.items.length } });
      expect([seeded.version.calc_engine_version, seeded.version.status, seeded.items.length]).toEqual([3, "draft", 0]);
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

  // V3M-12 à V3M-14 : par l'écran, dans cette phase (le garde de la campagne critique refuse toute écriture …/status).
  offerTest("V3M05 a v3 draft prepares its client PDF from its detail page and is issued from the editor; its issued detail page shows the valid seal, the original PDF and the status actions, keeps the template closed by name, and its printout keeps the CGV its copy sealed",
    { session: "army", trace: "off", tags: ["engine-v3", "offer-emission"], timeout: 600_000 }, async (ui) => {
      const { app, screen, browser, army } = ui;
      emissionFixture();
      const record: Evidence = (label, data) => recordOfferEvidence(army, `v3m05-${label}`, data);
      await app.open("/dashboard/affaires");
      await expectOfferGuardInstalled(record);
      const ids = await createV3(browser, army, record, "V3M05");
      // 1 u, PR FO 10,00 €, provision FO 1,01, c_FO 1,30 : PU 13,13 €, HT 13,13 €, TVA 20 % 2,63 €, TTC 15,76 € (sous toute
      // règle d'approbation).
      const settled = await settleOneLineV3(browser, army, record, "V3M05", ids, { unitCode: "u", pricingStatus: "priced" });
      expect([settled.version.total_ht_cents, settled.version.total_tax_cents, settled.version.total_ttc_cents]).toEqual([1313, 263, 1576]);
      // The API lease of this document goes back: the PDF dialog of the detail page and the editor take their own.
      expect((await apiRequest(browser, "DELETE", `/api/estimates/${ids.versionId}/lock`)).status).toBe(200);
      const detailActions = async () => {
        await screen.getByTestId("estimate-detail-more-actions").tap();
        const actions = browser.locator("[aria-label=\"Autres actions sur la version\"]");
        await expect(actions).toBeVisible({ timeout: 30_000 });
        return actions;
      };
      const templateClosed = async (actions: Awaited<ReturnType<typeof detailActions>>) => ({
        template: await presence(actions.getByRole("button", "Sauvegarder comme modèle", { exact: true })),
        reason: normalizeQuotes(await actions.textContent()).includes(normalizeQuotes(TEMPLATE_REASON)),
      });
      const editorReady = async () => {
        await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
        await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
        await waitForDraftLease({ app, screen, browser });
      };
      // The v3 reading card of the detail page (2.6) must not claim that the client document and emission are closed.
      const summaryCard = () => browser.evaluate(() => {
        const card = document.querySelector("[data-testid=\"estimate-v3-draft-summary\"]");
        return { heading: (card?.querySelector("h2")?.textContent ?? "").trim(), closedClaim: /pas encore disponibles/u.test(card?.textContent ?? "") };
      });

      // Observées d'abord, pour que le rouge les enregistre toutes deux : « Préparer le PDF » de la fiche (V3M-12) et
      // « Envoyer » de l'éditeur (V3M-13) d'un brouillon v3.
      await app.open(`/dashboard/estimates/${ids.versionId}`);
      const draftActions = await detailActions();
      const draftMenu = { prepare: await presence(draftActions.getByRole("button", "Préparer le PDF", { exact: true })),
        ...await templateClosed(draftActions), summary: await summaryCard() };
      const expectedDraftMenu = { prepare: { present: true, enabled: true }, template: { present: true, enabled: false }, reason: true,
        summary: { heading: "Brouillon au moteur de calcul 3", closedClaim: false } };
      await record("draft-detail-actions", { versionId: ids.versionId, expected: expectedDraftMenu, actual: draftMenu });
      expect.soft(draftMenu, "the v3 draft detail page opens the PDF and closes the template by name").toEqual(expectedDraftMenu);
      await editorReady();
      const editorSend = await presence(screen.getByTestId("estimate-page-toolbar-send-button"));
      await record("editor-send-action", { versionId: ids.versionId, expected: { present: true, enabled: true }, actual: editorSend });
      expect.soft(editorSend, "the v3 editor offers « Envoyer »").toEqual({ present: true, enabled: true });

      // V3M-12 : la fenêtre de la fiche prépare le document client v3 ; le brouillon reste un brouillon.
      await app.open(`/dashboard/estimates/${ids.versionId}`);
      const prepare = (await detailActions()).getByRole("button", "Préparer le PDF", { exact: true });
      await expect(prepare).toBeEnabled({ timeout: 30_000 });
      await prepare.click();
      const layout = screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
      await expect(layout).toBeVisible({ timeout: 30_000 });
      const generate = layout.getByRole("button", "Générer et télécharger", { exact: true });
      await expect(generate).toBeEnabled({ timeout: 60_000 });
      const pdfEndpoint = new URL(`/api/estimates/${ids.versionId}/pdf?force=1`, app.baseUrl!).href;
      const [generation] = await Promise.all([browser.waitForResponse(pdfEndpoint, { timeout: 120_000 }), generate.click()]);
      await expect.poll(async () => (await storedPdfState(browser, ids.versionId)).documentStatus, { timeout: 120_000 }).toBe("ready");
      await expect(layout).toBeHidden({ timeout: 30_000 });
      const draftPdf = await pdfText(await storedPdfBytes(browser, ids.versionId));
      const draft = await readEstimate(browser, ids.versionId);
      const prepared = { generation: [200, 202].includes(generation.status), status: draft.version.status, document: oneLineDocument(draftPdf.text) };
      const expectedPrepared = { generation: true, status: "draft", document: ONE_LINE_DOCUMENT };
      await record("detail-pdf", { versionId: ids.versionId, sha256: draftPdf.sha256, pages: draftPdf.pageCount,
        generationStatus: generation.status, expected: expectedPrepared, actual: prepared });
      expect(prepared).toEqual(expectedPrepared);

      // V3M-13 : « Envoyer » de l'éditeur émet la v3 (émission manuelle sous le bail de la page).
      await editorReady();
      const send = screen.getByTestId("estimate-page-toolbar-send-button");
      await expect(send).toBeEnabled({ timeout: 30_000 });
      await send.click();
      const gating = screen.getByRole("dialog", "Vérification avant envoi", { exact: true });
      await expect(gating).toBeVisible({ timeout: 30_000 });
      const confirm = gating.getByRole("button", "Envoyer", { exact: true });
      await expect(confirm).toBeEnabled({ timeout: 30_000 });
      const statusEndpoint = new URL(`/api/estimates/${ids.versionId}/status`, app.baseUrl!).href;
      const [emission] = await Promise.all([browser.waitForResponse(statusEndpoint, { timeout: 120_000 }), confirm.click()]);
      const sent = await readEstimate(browser, ids.versionId);
      const sentSeal = await verifySeal(browser, ids.versionId);
      const issued = { response: emission.status, version: [sent.version.status, sent.version.seal_payload_version,
        sent.version.total_ht_cents, sent.version.total_tax_cents, sent.version.total_ttc_cents] };
      const expectedIssued = { response: 200, version: ["sent", 5, 1313, 263, 1576] };
      await record("editor-issued", { versionId: ids.versionId, expected: expectedIssued, actual: issued, verified: sentSeal });
      expect(issued).toEqual(expectedIssued);
      expect(sentSeal).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: sent.version.seal_hash,
        computed_hash: sent.version.seal_hash, seal_payload_version: 5, client_contract_version: 2, calc_payload_version: 6 } });

      // V3M-14 : la fiche de la v3 émise dit son sceau, propose le PDF original et ses actions de statut ; « Marquer
      // accepté » garde le sceau ; le modèle reste fermé par son nom.
      const sealOf = () => browser.evaluate(() => Array.from(document.querySelectorAll("[data-seal-state]"))
        .map((node) => node.getAttribute("data-seal-state")));
      const statusOf = () => browser.evaluate(() => {
        const term = Array.from(document.querySelectorAll("dt")).find((node) => (node.textContent ?? "").trim() === "Statut");
        // The status badge is the first span of the « Statut » value (as in offer-emission's expectEstimateSummaryStatus).
        return (term?.parentElement?.querySelector(":scope > dd > span")?.textContent ?? "").replace(/[\s  ]+/g, " ").trim();
      });
      await app.open(`/dashboard/estimates/${ids.versionId}`);
      await expect(browser.locator("[data-seal-state]")).toHaveCount(1, { timeout: 30_000 });
      const accept = screen.getByRole("button", "Marquer accepté", { exact: true });
      // The status actions are a client island of the page: the first green run read them absent although the page,
      // read again at the failure, rendered them. Wait (bounded, no assertion) before recording what is shown.
      const acceptDeadline = Date.now() + 30_000;
      while (!(await presence(accept)).present && Date.now() < acceptDeadline) await new Promise((resolve) => setTimeout(resolve, 500));
      const acceptBefore = await presence(accept);
      const issuedActions = await detailActions();
      const issuedDetail = { seal: await sealOf(), status: await statusOf(), accept: acceptBefore, summary: await summaryCard(),
        download: await presence(issuedActions.getByRole("button", "Télécharger le PDF", { exact: true })), ...await templateClosed(issuedActions) };
      const expectedIssuedDetail = { seal: ["valid"], status: "Envoyé", accept: { present: true, enabled: true },
        summary: { heading: "Devis émis au moteur de calcul 3", closedClaim: false },
        download: { present: true, enabled: true }, template: { present: true, enabled: false }, reason: true };
      await record("issued-detail", { versionId: ids.versionId, expected: expectedIssuedDetail, actual: issuedDetail });
      expect(issuedDetail).toEqual(expectedIssuedDetail);
      await browser.keyboard.press("Escape");
      await expect(issuedActions).toBeHidden({ timeout: 30_000 });
      allowOfferLifecycleTransition(army, ids.versionId, "accepted");
      const [acceptance] = await Promise.all([browser.waitForResponse(statusEndpoint, { timeout: 120_000 }), accept.click()]);
      const acceptedState = await readEstimate(browser, ids.versionId);
      const acceptedSeal = await verifySeal(browser, ids.versionId);
      await browser.reload();
      await expect(browser.locator("[data-seal-state]")).toHaveCount(1, { timeout: 30_000 });
      const acceptedView = { response: acceptance.status, version: [acceptedState.version.status, acceptedState.version.seal_hash,
        acceptedState.version.seal_payload_version], seal: await sealOf(), status: await statusOf() };
      const expectedAccepted = { response: 200, version: ["accepted", sent.version.seal_hash, 5], seal: ["valid"], status: "Accepté" };
      await record("detail-accepted", { versionId: ids.versionId, expected: expectedAccepted, actual: acceptedView, verified: acceptedSeal });
      expect(acceptedView).toEqual(expectedAccepted);
      expect(acceptedSeal).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: sent.version.seal_hash,
        seal_payload_version: 5, client_contract_version: 2, calc_payload_version: 6 } });

      // V3M-17 : la fenêtre de la fiche propose les CGV de politique « default » du profil, que la copie scelle à
      // l'émission ; l'impression ouverte sans mise en page (`terms` absent, CGV non demandées) les garde.
      const sealedPdf = await pdfText(await storedPdfBytes(browser, ids.versionId));
      const terms = { sealed: termsIn(sealedPdf.text), printed: await printedTerms(ui, ids.versionId, "") };
      const expectedTerms = { sealed: SANDBOX_TERMS, printed: SANDBOX_TERMS };
      await record("issued-terms", { versionId: ids.versionId, sha256: sealedPdf.sha256, query: "", expected: expectedTerms, actual: terms });
      expect(terms).toEqual(expectedTerms);
    });

  // V3M-15 : l'identité imprimée d'une v3 émise est celle de sa copie au contrat 2, relevée trois fois : par le
  // propriétaire à l'émission, après la modification de l'affaire, puis par le second administrateur du tenant.
  // V3M-16 : le pied de son portail porte l'emphase du pied v3, comme l'impression. V3M-17 : ses CGV sont celles de sa
  // copie scellée (aucune), quelle que soit la mise en page demandée.
  offerTest("V3M06 a sent v3 prints the identity of its issued copy, not the affaire changed after emission nor the profile of a second admin who opens it, with its valid seal, its portal footer emphasises the net HT and the TTC as the print does, and its printout adds no CGV to a copy sealed without them",
    { session: "army", trace: "off", tags: ["engine-v3", "offer-emission"], timeout: 600_000 }, async (ui) => {
      const { app, screen, browser, army } = ui;
      const fixture = emissionFixture();
      const record: Evidence = (label, data) => recordOfferEvidence(army, `v3m06-${label}`, data);
      await app.open("/dashboard/affaires");
      await expectOfferGuardInstalled(record);
      const emails = { "<adresse du propriétaire>": credentials.user("army").username, "<adresse du lecteur>": credentials.user("viewer").username };
      // S2 : remise de 1,01 €, le pied porte brut, remise, HT net, TVA et TTC.
      const ids = await createV3(browser, army, record, "V3M06");
      await settleV3(browser, army, record, "V3M06", ids, S2, fixture.owner.laborRoleId);
      // V3M-18 : le PDF est préparé sous le préréglage « décision » (chapitres jusqu'au niveau 2, total HT, compact).
      await generatePdf(browser, record, "pdf", ids.versionId, DECISION_LAYOUT);
      const sent = await sendOffer(ui, record, "send", ids.versionId);
      const issued = await readEstimate(browser, ids.versionId);
      const verified = await verifySeal(browser, ids.versionId);
      await record("issued", { versionId: ids.versionId, status: issued.version.status, marker: issued.version.seal_payload_version, verified });
      expect([issued.version.status, issued.version.seal_payload_version, issued.project.name]).toEqual(["sent", 5, `${army.runPrefix}-V3M06`]);
      expect(verified).toMatchObject({ status: 200, ok: true, data: { valid: true, stored_hash: issued.version.seal_hash,
        seal_payload_version: 5, client_contract_version: 2, calc_payload_version: 6 } });
      const atEmission = await printIdentity(ui, ids.versionId, emails);

      // Après l'émission, l'affaire change par sa fiche (comme OF02) : nom, client, référence et adresse du chantier.
      const changed = { name: `RENOMMÉE ${army.runPrefix}`, client: "ARMY client modifié V3M06", reference: "ARMY-REF-V3M06",
        site: "ARMY chantier modifié V3M06" };
      await app.open(`/dashboard/affaires/${ids.projectId}`);
      await screen.getByRole("button", "Modifier la fiche", { exact: true }).click();
      await screen.getByLabel(/Nom du projet/).fill(changed.name);
      await screen.getByLabel("Client", { exact: true }).fill(changed.client);
      await screen.getByLabel("Référence", { exact: true }).fill(changed.reference);
      await screen.getByLabel("Adresse du chantier", { exact: true }).fill(changed.site);
      await screen.getByRole("button", "Enregistrer", { exact: true }).click();
      await expect(screen.getByLabel(/Nom du projet/)).toHaveCount(0);
      const current = await readEstimate(browser, ids.versionId);
      await record("affaire-changed", { projectId: ids.projectId, expected: changed.name, actual: current.project.name });
      expect(current.project.name).toBe(changed.name);
      const afterChange = await printIdentity(ui, ids.versionId, emails);

      // Le second administrateur du tenant ouvre la même impression ; le propriétaire se reconnecte ensuite.
      await accountLogin(ui, "viewer");
      const asViewer = await printIdentity(ui, ids.versionId, emails);
      await accountLogin(ui, "army");

      // La copie émise : l'émetteur et son adresse du profil au moment de l'envoi, l'affaire sans client, référence
      // ni adresse, et le bloc « Devis » relevé à l'émission ; sceau valide à chaque lecture.
      const captured = {
        issuer: [fixture.owner.displayName, "<adresse du propriétaire>"],
        devis: atEmission.devis,
        client: ["Client à renseigner"],
        site: [`${army.runPrefix}-V3M06`, "Adresse du chantier non renseignée"],
        seal: ["valid"],
      };
      const prints = { atEmission, afterChange, asViewer };
      const expectedPrints = { atEmission: captured, afterChange: captured, asViewer: captured };
      await record("print-identity", { versionId: ids.versionId, changed, viewer: fixture.viewer.displayName, expected: expectedPrints, actual: prints });
      expect(atEmission.devis).toContain("Version : V1");
      expect(prints).toEqual(expectedPrints);

      // V3M-16 : buildEstimateV3FooterRows met « Total HT net » en bandeau et « Total TTC » en gras ; « Total HT brut »,
      // la remise et la TVA restent des lignes de détail. L'impression (EstimateDocumentTotalsV3) suit déjà cette emphase.
      const footer = [
        { label: "Total HT brut", emphasis: "detail", banner: false, strong: false },
        { label: "Remise commerciale", emphasis: "detail", banner: false, strong: false },
        { label: "Total HT net", emphasis: "net", banner: true, strong: true },
        { label: "TVA 20 % sur 69 472,53 €", emphasis: "detail", banner: false, strong: false },
        { label: "Total TTC", emphasis: "payable", banner: false, strong: true },
      ];
      await printIdentity(ui, ids.versionId, emails);
      const printFooter = await footerRows(ui, { root: ".estimate-document", rows: "[data-testid=\"estimate-v3-document-totals\"] > div" });
      // V3M-17 : la copie de V3M06 est scellée sans CGV (PDF préparé par l'API, préréglage « décision »). Son
      // impression qui demande « Joindre les CGV » (`terms=1`, comme la case de la fenêtre) n'en ajoute aucune.
      const printTerms = await printedTerms(ui, ids.versionId, "?terms=1");
      const portalText = await openCollectedPortal(ui, sent.portalUrl);
      const portalFooter = await footerRows(ui, { root: "[role=\"region\"][aria-label=\"Document du devis\"]", rows: "dl > div" });
      const footers = { print: printFooter, portal: portalFooter };
      const expectedFooters = { print: footer.map((row) => ({ ...row, emphasis: null })), portal: footer };
      await record("footer-emphasis", { versionId: ids.versionId, portalUrlSha256: digest(sent.portalUrl), expected: expectedFooters, actual: footers });
      expect(footers).toEqual(expectedFooters);
      const terms = { sealed: termsIn((await pdfText(sent.pdf)).text), printed: printTerms, portal: termsIn(normalizeQuotes(portalText)) };
      const expectedTerms = { sealed: NO_TERMS, printed: NO_TERMS, portal: NO_TERMS };
      await record("issued-terms", { versionId: ids.versionId, sha256: digest(sent.pdf), query: "?terms=1", expected: expectedTerms, actual: terms });
      expect(terms).toEqual(expectedTerms);

      // V3M-18 : sans paramètre (toutes les entrées de l'application) comme avec une autre mise en page demandée,
      // l'impression reprend la mise en page scellée : configuration « décision », quatre colonnes, la seule section
      // numérotée 01 avec son sous-total (le HT brut de l'unique section), aucune ligne, et plus de fenêtre de mise en
      // page. Le portail, encore ouvert, rend la même copie sous les mêmes colonnes.
      const conflicting = "?preset=fo_mo&detail_level=lines&price_mode=fo_mo_and_total&density=comfortable&numbering=0&subtotals=0&conditions=new_page";
      const portalHeadings = await ui.browser.evaluate(() => Array.from(document.querySelectorAll(
        "[role=\"region\"][aria-label=\"Document du devis\"] thead th")).map((node) => (node.textContent ?? "").trim()));
      await accountLogin(ui, "army");
      const plain = await printedLayout(ui, ids.versionId, "");
      const requested = await printedLayout(ui, ids.versionId, conflicting);
      const sealedPrint = {
        configuration: "Configuration : chapitres jusqu'au niveau 2, total HT, densité compacte",
        headings: ["Designation", "Qte", "U", "Total HT"],
        rows: [{ label: ["01", `${army.runPrefix} V3M06 lot`], amount: plain.gross }],
        gross: plain.gross,
        layoutButton: false,
        printButton: true,
      };
      const layouts = { plain, requested, portalHeadings };
      const expectedLayouts = { plain: sealedPrint, requested: sealedPrint, portalHeadings: ["Désignation", "Qté", "Unité", "Total HT"] };
      await record("print-layout", { versionId: ids.versionId, sealed: DECISION_LAYOUT, queries: ["", conflicting], expected: expectedLayouts,
        actual: layouts });
      expect(plain.gross).toMatch(/\d €$/u);
      expect(layouts).toEqual(expectedLayouts);
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
