import { expect } from "e2e";

import { armyTest, recordEvidence, type ArmyState } from "../critical/fixtures";
import {
  captureScreen, closePolicy, createV2Affaire, linkDpgfThroughHub, openPolicy3, openWizard, policySnapshot, seedV2Lines,
  sentExpectation, signUpCreatorOwner, storedVersions, submitWizard, type Ui,
} from "./engine-v3-creators-support";
import { switchToExpertMode } from "./engine-v3-editor-support";

// Démarrage du hub après une version chiffrée : résidu préexistant de la revue Codex de la PR #57
// (docs/testing/estimate-engine-v3-2.10a.md §10), décision du propriétaire du 18/10/2026 (option A,
// docs/testing/affaire-hub-fresh-start-decision.md) : le hub n'affiche son démarrage que si aucune version de
// l'affaire n'a de ligne, sans document ni DPGF lié.
// Défaillances observables, écrites avant la correction :
//  H1  Une V1 chiffrée suivie d'une V2 vierge (« Créer directement ») remet le hub à son démarrage
//      (`isAffaireFreshStartState`) : ni résumé financier, ni chronologie, ni registre, ni approbation.
//  H2  Même démarrage quand la V2 vierge est une v3 : l'avis de sa marge indisponible (« … : V2. ») n'apparaît pas.
// Gardes : sans ligne dans aucune version, le démarrage reste, même avec deux versions (HFS03) ; hors démarrage,
// l'analyse de marge ne lit toujours que la version courante (H3, option C écartée) et le badge « Étape 1 sur 6 · Dossier »
// suit les seuls documents (H4, non tranché). Propriétaire dédié par parcours (politique 2 explicite), en mode
// Expert, seul mode où le hub monte la carte de marge ; la politique 3 de HFS02 est refermée à 2 en fin de parcours.
// Parcours qui capturent : sans la session de campagne restaurée (engine-v3-creators.e2e.ts), une sélection faite
// d'eux seuls est refusée par le runner ; y joindre V3C01 par exemple.
const capturing = { tags: ["critical", "local", "affaire-hub", "fresh-start"], timeout: 600_000 } as const;
const HUB_CARDS = ["Résumé financier", "Analyse de marge", "Versions", "Registre hypothèses & pièces manquantes", "Approbation"] as const;
/** The full hub of a v1/v2 current version without a line: its margin analysis is empty, hence no card (H3). */
const WITHOUT_MARGIN = HUB_CARDS.filter((title) => title !== "Analyse de marge");
const V3_NOTICE_V2 = "Marge indisponible pour V2 : aucun déboursé calculable.";

/** One supply line at 2 × 100,00 € in a section of the V1, by the items API (v2). */
const pricedLine = (army: ArmyState) => ({
  title: `${army.runPrefix} V1 fourniture`, description: "u", line_nature: "supply_only", quantity: 2,
  unit_price_ht_cents: 10000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
});

/**
 * The hub's cards, the margin card's content and the timeline's count (`null` for an absent card), plus its entry
 * facts: the « Étape 1 sur 6 · Dossier » badge, the header's « Éditer Vn » link and the manual path's target version.
 */
async function readHub(ui: Ui, projectId: string) {
  await ui.app.open(`/dashboard/affaires/${projectId}`);
  // One render decides the layout: the financial summary (full hub) or the manual path of the upload card. The
  // intake region is no signal: in the fresh start it is rendered empty, hence hidden.
  const summary = ui.screen.getByRole("heading", "Résumé financier", { exact: true });
  const manual = ui.screen.getByRole("link", "Continuer en manuel", { exact: true });
  await expect.poll(async () => (await summary.isVisible()) || (await manual.isVisible()), { timeout: 60_000 }).toBe(true);
  return ui.browser.evaluate((cards) => {
    const text = (node: Element | null | undefined) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();
    const headingOf = (title: string) => Array.from(document.querySelectorAll("h2")).find((node) => text(node) === title) ?? null;
    const sectionOf = (title: string) => headingOf(title)?.closest("section") ?? null;
    const margin = sectionOf("Analyse de marge");
    const notice = margin?.querySelector("[data-testid=\"margin-evolution-v3-notice\"]");
    const versions = sectionOf("Versions");
    const links = Array.from(document.querySelectorAll("main a"));
    const manualLink = links.find((node) => text(node) === "Continuer en manuel");
    return {
      cards: cards.filter((title) => headingOf(title) !== null),
      margin: margin ? {
        notice: notice ? text(notice) : null,
        kpis: text(margin).includes("Marge globale"),
        chart: margin.querySelector("svg[role=\"img\"]") !== null,
      } : null,
      // The badge text runs into the first item (« 1 versionV1 … »): no word boundary after it.
      versionCount: versions ? (text(versions).match(/(\d+) versions?/)?.[1] ?? null) : null,
      newAffaire: text(document.querySelector("main")).includes("Étape 1 sur 6 · Dossier"),
      editLink: links.map((node) => text(node)).find((label) => /^Éditer V\d+$/.test(label)) ?? null,
      manualVersionId: manualLink?.getAttribute("href")?.match(/\/estimates\/([0-9a-f-]{36})\//i)?.[1] ?? null,
    };
  }, [...HUB_CARDS]);
}

type HubRead = Awaited<ReturnType<typeof readHub>>;
type Versions = Awaited<ReturnType<typeof storedVersions>>;

/** The pricing part of a hub read, asserted exactly. */
const pricing = ({ cards, margin, versionCount, editLink }: HubRead) => ({ cards, margin, versionCount, editLink });

/** A hub read with its entry facts: the « Étape 1 sur 6 · Dossier » badge and the version (1, 2) the manual path opens. */
const withEntry = (read: HubRead, versions: Versions) => ({
  ...pricing(read), newAffaire: read.newAffaire,
  manual: versions.find((version) => version.id === read.manualVersionId)?.versionNumber ?? null,
});

/** A v2 affaire whose V1 is priced (one section, one line), or left blank, the owner in Expert mode. */
async function v2Affaire(ui: Ui, army: ArmyState, projectName: string, input: { priced: boolean }) {
  const owner = await signUpCreatorOwner(ui, army);
  const anchor = await createV2Affaire(ui, army, projectName, {
    title: `${army.runPrefix} V1 ${input.priced ? "chiffrée" : "vierge"}`, margin_multiplier: 1.15, margin_bp: 1500,
  });
  if (input.priced) await seedV2Lines(ui, anchor.versionId, [pricedLine(army)]);
  await switchToExpertMode(ui);
  return { owner, anchor };
}

const versionFacts = (versions: Versions) =>
  versions.map((version) => [version.versionNumber, version.engine, version.totals[0] > 0]);

armyTest("HFS01 a priced V1 then a blank V2 from « Créer directement » keeps the full hub: summary, versions, register and approval, no margin card for a v2", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const { owner, anchor } = await v2Affaire(ui, army, `ARMY-HFS01-${army.runPrefix}`, { priced: true });
    const pricedV1 = await readHub(ui, anchor.projectId);
    await openWizard(ui, anchor.projectId);
    const created = await submitWizard(ui, army, "hfs01", { trigger: "quick", endpoint: "estimates" });
    const versions = await storedVersions(owner, anchor.projectId);
    const blankV2 = await readHub(ui, anchor.projectId);
    await captureScreen(ui, army, "hfs01-blank-v2-after-priced-v1");
    const linked = await linkDpgfThroughHub(ui, army, anchor.projectId);
    const withDpgf = await readHub(ui, anchor.projectId);
    const observed = {
      created: [created.status, created.code], versions: versionFacts(versions), pricedV1: pricing(pricedV1),
      blankV2: withEntry(blankV2, versions), withDpgf: pricing(withDpgf),
    };
    await recordEvidence(army, "hfs01", { owner, anchor, created, versions, linked, reads: { pricedV1, blankV2, withDpgf }, observed });
    expect(observed).toEqual({
      created: [201, null], versions: [[1, 2, true], [2, 2, false]],
      pricedV1: { cards: [...HUB_CARDS], margin: { notice: null, kpis: true, chart: false }, versionCount: "1", editLink: "Éditer V1" },
      blankV2: { cards: WITHOUT_MARGIN, margin: null, versionCount: "2", editLink: "Éditer V2", newAffaire: true, manual: 2 },
      withDpgf: { cards: WITHOUT_MARGIN, margin: null, versionCount: "2", editLink: "Éditer V2" },
    });
  });

armyTest("HFS02 a priced v2 V1 then a blank v3 V2 from « Créer directement » keeps the full hub, the margin card naming the v3 as unavailable", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const { owner, anchor } = await v2Affaire(ui, army, `ARMY-HFS02-${army.runPrefix}`, { priced: true });
    const policy = await openPolicy3(owner, army, "HFS02");
    try {
      await openWizard(ui, anchor.projectId);
      const created = await submitWizard(ui, army, "hfs02", { trigger: "quick", endpoint: "estimates" });
      const versions = await storedVersions(owner, anchor.projectId);
      const blankV3 = await readHub(ui, anchor.projectId);
      await browser.evaluate(() => {
        document.querySelector("[data-testid=\"margin-evolution-v3-notice\"]")?.scrollIntoView({ block: "center" });
        return true;
      });
      await captureScreen(ui, army, "hfs02-blank-v3-notice");
      const linked = await linkDpgfThroughHub(ui, army, anchor.projectId);
      const withDpgf = await readHub(ui, anchor.projectId);
      const notice = { notice: V3_NOTICE_V2, kpis: false, chart: false };
      const observed = {
        created: [created.status, created.code, sentExpectation(created)], versions: versionFacts(versions),
        blankV3: withEntry(blankV3, versions), withDpgf: pricing(withDpgf),
        policyUnchanged: JSON.stringify(await policySnapshot(owner)) === JSON.stringify(policy),
      };
      await recordEvidence(army, "hfs02", { owner, anchor, created, versions, linked, reads: { blankV3, withDpgf }, observed });
      expect(observed).toEqual({
        created: [201, null, 3], versions: [[1, 2, true], [2, 3, false]],
        blankV3: { cards: [...HUB_CARDS], margin: notice, versionCount: "2", editLink: "Éditer V2", newAffaire: true, manual: 2 },
        withDpgf: { cards: [...HUB_CARDS], margin: notice, versionCount: "2", editLink: "Éditer V2" },
        policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "HFS02");
    }
  });

armyTest("HFS03 guard: an affaire with no line in any version keeps its fresh start, a second blank version and a priced sibling affaire included", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const { owner, anchor } = await v2Affaire(ui, army, `ARMY-HFS03-${army.runPrefix}`, { priced: false });
    // The lines of another affaire of the same tenant never count: the read is bounded by the affaire's versions.
    const sibling = await createV2Affaire(ui, army, `ARMY-HFS03-voisine-${army.runPrefix}`, { title: `${army.runPrefix} voisine chiffrée` });
    await seedV2Lines(ui, sibling.versionId, [pricedLine(army)]);
    const blankV1 = await readHub(ui, anchor.projectId);
    await openWizard(ui, anchor.projectId);
    const created = await submitWizard(ui, army, "hfs03", { trigger: "quick", endpoint: "estimates" });
    const versions = await storedVersions(owner, anchor.projectId);
    const blankV2 = await readHub(ui, anchor.projectId);
    const observed = {
      created: [created.status, created.code], versions: versionFacts(versions),
      sibling: versionFacts(await storedVersions(owner, sibling.projectId)),
      blankV1: withEntry(blankV1, versions), blankV2: withEntry(blankV2, versions),
    };
    await recordEvidence(army, "hfs03", { owner, anchor, sibling, created, versions, reads: { blankV1, blankV2 }, observed });
    expect(observed).toEqual({
      created: [201, null], versions: [[1, 2, false], [2, 2, false]], sibling: [[1, 2, true]],
      blankV1: { cards: [], margin: null, versionCount: null, editLink: "Éditer V1", newAffaire: true, manual: 1 },
      blankV2: { cards: [], margin: null, versionCount: null, editLink: "Éditer V2", newAffaire: true, manual: 2 },
    });
  });
