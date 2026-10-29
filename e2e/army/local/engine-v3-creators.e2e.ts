import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import {
  apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyEstimate, type ArmyItem,
} from "../critical/fixtures";
import { createPlanSet, ownedTakeoffJobs, requireLocalPlansBackend, uploadSamplePlan } from "../critical/plans-support";
import { fillTakeoffPreparation, openTakeoffPreparation, saveTakeoffPreparation } from "../critical/preparation-support";
import { querySql } from "./calculation-gate-support";
import {
  ENGINE_UNAVAILABLE, TAKEOFF_V3_REASON,
  callServerAction, captureScreen, chooseRounding, chooseTemplate, chooseV2FixedMargin, closePolicy, confirmTakeoffPreparationViaAction,
  createAffaireFromOnboarding, createLaborRole, createTuyauteur, createV2Affaire, createV2Version, createV3Version,
  estimateFacts, fillLabelled, fillProjectStep, insertTemplateOracle, instantiateTemplate, linkDpgfThroughHub, nextStep,
  openPolicy3, openWizard, ownedProjectIdsNamed, policySnapshot, readPricingStep, saveTemplate, seedSupplyLine, seedV2Lines,
  seedV2TemplateLines, seedV3TemplateLines, sentExpectation, sentVersion, serverActionId, signUpCreatorOwner,
  signUpTenantAdmin, storedVersions, submitWizard, takeLease, templateLines, tenantEstimateCounts, v3Settings,
  versionInsertsLogged, waitPageText,
  type Envelope, type StoredVersion, type Ui, type WizardOutcome,
} from "./engine-v3-creators-support";
import { grid, releaseVersion, switchToExpertMode, waitForDraftLease } from "./engine-v3-editor-support";

// Lot 2, sous-lot 2.10a — créateurs prêts pour le moteur 3 (docs/testing/estimate-engine-v3-2.10a.md). Défaillances
// observables, écrites avant le code (§1) :
//  F1, F2  L'assistant (vierge, « Créer directement ») n'envoie aucune attente : 409 CONTEXT_CHANGED en boucle.
//  F3      L'étape de prix propose marge et tranches, aucun coefficient de vente.
//  F4-F7   « Depuis un modèle » est refusé (cause perdue en 500) ; aucune règle P-12 ni rapport pour un modèle v2,
//          aucun chemin pour un modèle v3.
//  F8      Le DPGF lié, choisi par défaut, est normalisé pour la v2 puis refusé.
//  F9      L'accueil « Créer l'affaire » crée sans attente : CONTEXT_CHANGED.
//  F12     Le métré d'une v3 est lancé, puis refusé à l'application seulement.
//  F13     La structure IA d'une v3 s'ouvre, puis est refusée à la génération.
//  F14     L'évolution de la marge retire les v3 sans le dire.
//  F15     Gardes : sous une politique 2 explicite (retrait par entreprise depuis M8, 2.10b), chaque créateur
//          rend la même v2 qu'avant la bascule.
// Revue (§9) :
//  R1      Le métré lancé depuis une source v3 copie d'abord cette source (P-15), puis la copie est refusée.
// M2 v0.1 (métré sur le moteur 3, 25/10/2026) : F12 et R1 ne se corrigent plus par un refus. Une v3 reçoit le métré
// comme une v2 (proposition, dialogue, API) et une source v3 est copiée en v3 avant l'analyse.
// Contrat courant du 29/10 : le lancement exige ChatGPT local. V3C08 vérifie en mode production le refus
// avant toute création de job ou copie ; les parcours ChatGPT locaux gardent l'admission avec forfait fictif.
// Lot 3.2, entrée 2 (structure IA sur le moteur 3, 25/10/2026) : F13 ne se corrige plus par un refus. L'assistant d'une
// v3 s'ouvre, génère sa preview et l'applique sous le contrat d'écrivain (V3C09 ; application détaillée : IO08).
//  R2      Les refus nommés de M6 et les heures atelier / chantier n'ont aucune preuve sur le chemin de création.
// Revue Codex (PR #57) :
//  C1      Une v3 sans section (vierge) rend l'analyse vide : la carte disparaît, l'avis A16 avec elle.
// Lot 3.2, entrée 4 (D-d revue, décision du 24/10/2026) :
//  L1      L'évolution de la marge ne trace aucune v3 (une affaire neuve n'a jamais de graphique), et le résumé
//          financier dit « Indisponible » pour la marge d'un brouillon v3 sans gel, que la Direction calcule en direct.
// Chaque parcours a son propriétaire dédié ; la politique 3 (1,30 / 1,20) est refermée à 2 en fin de parcours.
const options = { session: "army", tags: ["critical", "local", "engine-v3", "creators"], timeout: 600_000 } as const;
// Parcours qui capturent un état visible pour la pull request : sans la session de campagne restaurée, dont la saisie
// du mot de passe retient toute capture ; le propriétaire dédié remplace de toute façon ses cookies. Ils ne lancent
// donc pas la connexion : une sélection faite d'eux seuls est refusée par le runner, y joindre V3C01 par exemple.
const capturing = { tags: options.tags, timeout: options.timeout } as const;
const V2_ONLY_KEYS = ["margin_mode", "margin_bp", "margin_multiplier", "global_coefficient", "discount_steps"] as const;
const V3_BLANK = { engine: 3, coefficients: [1.3, 1.2], neutral: ["fixed", 1, 1, "simple", []], rounding: ["none"] };
const field = (item: object, key: string) => (item as Record<string, unknown>)[key];

/** The version created by a wizard outcome, read back in SQL. */
function createdOf(versions: StoredVersion[], outcome: WizardOutcome | { versionId: string | null }) {
  return versions.find((version) => version.id === outcome.versionId) ?? null;
}

/** v2 settings that a creator must keep unchanged under an explicit policy 2 (F15). */
function v2Settings(version: StoredVersion | null) {
  return version ? {
    engine: version.engine, coefficients: [version.fo, version.mo],
    margin: [version.marginMode, version.marginMultiplier, version.marginBp], global: version.globalCoefficient,
    discount: [version.discountMode, version.discountSteps], rounding: [version.roundingMode, version.roundingStepCents],
  } : null;
}

const samePolicy = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/* ---------- N1 : assistant ---------- */

armyTest("V3C01 the wizard creates a blank v3 under policy 3, stating its expectation, at the policy's 1,30 / 1,20", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const projectName = `ARMY-L2-V3C01-${army.runPrefix}`;
    const policy = await openPolicy3(owner, army, "V3C01");
    try {
      await openWizard(ui);
      await fillProjectStep(ui, { projectName, title: `${army.runPrefix} vierge` });
      await nextStep(ui);
      await nextStep(ui);
      await expect(screen.getByRole("heading", "Import", { exact: true })).toBeVisible();
      const outcome = await submitWizard(ui, army, "v3c01", { trigger: "create", endpoint: "estimates" });
      const projects = await ownedProjectIdsNamed(owner, projectName);
      const versions = projects.length === 1 ? await storedVersions(owner, projects[0]!) : [];
      const observed = {
        status: outcome.status, code: outcome.code, expectation: sentExpectation(outcome), projects: projects.length,
        versions: versions.map(v3Settings), totals: versions.map((version) => version.totals),
        editorOpened: outcome.versionId !== null && outcome.versionId === versions[0]?.id,
        policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c01", { owner, projectName, policy, versions, observed });
      expect(observed).toEqual({
        status: 201, code: null, expectation: 3, projects: 1, versions: [V3_BLANK], totals: [[0, 0, 0]],
        editorOpened: true, policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C01");
    }
  });

armyTest("V3C02 the wizard pricing step offers the v3 sale coefficients only and creates a v3 at 1,25 / 1,15 rounded down", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const projectName = `ARMY-L2-V3C02-${army.runPrefix}`;
    const policy = await openPolicy3(owner, army, "V3C02");
    try {
      await openWizard(ui);
      await fillProjectStep(ui, { projectName, title: `${army.runPrefix} prix v3` });
      await nextStep(ui);
      // A4 : coefficients de la politique, aucune marge ni tranche, arrondi « Aucun » ou palier inférieur seulement.
      const offered = await readPricingStep(ui);
      await captureScreen(ui, army, "v3c02-pricing-step");
      await recordEvidence(army, "v3c02-offered", { offered });
      expect(offered).toEqual({ saleCoefficientFo: "1,30", saleCoefficientMo: "1,20", marginControls: [], roundingOutsideV3: [] });
      await fillLabelled(ui, "Coefficient de vente FO", "1,25");
      await fillLabelled(ui, "Coefficient de vente MO", "1,15");
      await chooseRounding(ui, "100,00 € — palier inférieur");
      await nextStep(ui);
      await expect(screen.getByRole("heading", "Import", { exact: true })).toBeVisible();
      // Legacy DPGF wizard parity: a fresh tenant without a template can still
      // create a blank estimate; the unavailable template mode cannot trap it.
      await expect(screen.getByText("Aucun modèle disponible actuellement. Création en mode Nouveau (vide).", { exact: true })).toBeVisible();
      await expect(screen.getByRole("button", "Depuis un modèle", { exact: true })).toBeDisabled();
      await expect(screen.getByRole("button", "Nouveau (vide)", { exact: true })).toHaveAttribute("aria-pressed", "true");
      const outcome = await submitWizard(ui, army, "v3c02", { trigger: "create", endpoint: "estimates" });
      const sent = sentVersion(outcome) ?? {};
      const projects = await ownedProjectIdsNamed(owner, projectName);
      const versions = projects.length === 1 ? await storedVersions(owner, projects[0]!) : [];
      const observed = {
        status: outcome.status, expectation: sentExpectation(outcome),
        sent: [sent.sale_coefficient_fo ?? null, sent.sale_coefficient_mo ?? null, sent.rounding_mode ?? null, sent.rounding_step_cents ?? null],
        sentV2Keys: V2_ONLY_KEYS.filter((key) => key in sent),
        versions: versions.map(v3Settings), policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c02", { owner, projectName, versions, observed });
      expect(observed).toEqual({
        status: 201, expectation: 3, sent: [1.25, 1.15, "down", 10000], sentV2Keys: [],
        versions: [{ ...V3_BLANK, coefficients: [1.25, 1.15], rounding: ["down", 10000] }], policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C02");
    }
  });

armyTest("V3C03 « Créer directement » adds a v3 to an affaire with a v2 anchor, the anchor unchanged", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C03-${army.runPrefix}`);
    const before = await storedVersions(owner, anchor.projectId);
    const policy = await openPolicy3(owner, army, "V3C03");
    try {
      await openWizard(ui, anchor.projectId);
      const outcome = await submitWizard(ui, army, "v3c03", { trigger: "quick", endpoint: "estimates" });
      const after = await storedVersions(owner, anchor.projectId);
      const created = createdOf(after, outcome);
      const observed = {
        status: outcome.status, code: outcome.code, expectation: sentExpectation(outcome),
        engines: after.map((version) => version.engine), anchorUnchanged: samePolicy(after[0], before[0]),
        created: created ? v3Settings(created) : null, policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c03", { owner, before, after, observed });
      expect(observed).toEqual({
        status: 201, code: null, expectation: 3, engines: [2, 3], anchorUnchanged: true, created: V3_BLANK, policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C03");
    }
  });

/* ---------- A1 : modèles ---------- */

armyTest("V3C04 the wizard instantiates two v2 templates as v3s equal to their M6 insertion, listing converted lines and dropped settings", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const titles = templateLines(army);
    // T1 : marge 15 %, coefficient global 1,02, arrondi au palier supérieur de 10 € ; T2 : tranches, remise en cascade.
    const source = await createV2Affaire(ui, army, `ARMY-L2-V3C04-${army.runPrefix}`, {
      title: `${army.runPrefix} source T1`, margin_multiplier: 1.15, margin_bp: 1500, global_coefficient: 1.02,
      rounding_mode: "up", rounding_step_cents: 1000,
    });
    const roleId = await createTuyauteur(ui, army, source.versionId);
    await seedV2TemplateLines(ui, army, source.versionId, roleId);
    const t1 = await saveTemplate(ui, army, source.versionId, `${army.runPrefix} modele marge`);
    const t2SourceId = await createV2Version(ui, army, source.projectId, `${army.runPrefix} source T2`, {
      margin_mode: "tiered", discount_mode: "cascade", discount_steps: [1000, 500],
    });
    await seedV2TemplateLines(ui, army, t2SourceId, roleId);
    const t2 = await saveTemplate(ui, army, t2SourceId, `${army.runPrefix} modele tranches`);
    const sources = await storedVersions(owner, source.projectId);
    await recordEvidence(army, "v3c04-sources", { owner, source, t2SourceId, t1, t2, sources });

    const policy = await openPolicy3(owner, army, "V3C04");
    try {
      // Oracle M6 (V3T01 du plan) : T1 inséré dans une v3 vierge de l'affaire ; T2 porte les mêmes lignes.
      const oracle = await insertTemplateOracle(ui, army, source.projectId, t1, "t1");
      const oracleFacts = estimateFacts(await readEstimate(browser, oracle.versionId));
      expect(oracle.convertedLines).toEqual([{ title: titles.collier, template_hours: 1, converted_hours: 0.9 }]);
      const cases = [
        { label: "t1", templateId: t1, dropped: ["margin_multiplier", "global_coefficient", "rounding_mode"],
          labels: ["Marge 15 %", "Coefficient global 1,02", "Arrondi au palier supérieur de 10,00 €"] },
        { label: "t2", templateId: t2, dropped: ["margin_mode", "discount_mode"],
          labels: ["Marge par tranche", "Remise en cascade 10 % puis 5 %"] },
      ];
      const observed: Record<string, unknown> = {};
      const expected: Record<string, unknown> = {};
      for (const entry of cases) {
        const before = await storedVersions(owner, source.projectId);
        await openWizard(ui, source.projectId);
        await fillProjectStep(ui, { title: `${army.runPrefix} assistant ${entry.label}` });
        await nextStep(ui);
        await nextStep(ui);
        await chooseTemplate(ui, entry.templateId);
        const outcome = await submitWizard(ui, army, `v3c04-${entry.label}`, { trigger: "create", endpoint: "instantiate" });
        const report = outcome.versionId
          ? await waitPageText(ui, ["Modèle converti au moteur de calcul 3", "Réglages du modèle non repris :", ...entry.labels,
            "Lignes converties :", `${titles.collier} : 1 h → 0,9 h`])
          : null;
        if (report?.missing.length === 0) await captureScreen(ui, army, `v3c04-template-warning-${entry.label}`);
        const after = await storedVersions(owner, source.projectId);
        const created = createdOf(after, outcome);
        const facts = created ? estimateFacts(await readEstimate(browser, created.id)) : null;
        const data = outcome.responseData ?? {};
        const converted = field(data, "converted_lines") as Array<{ title: string; template_hours: number; converted_hours: number }> | undefined;
        const dropped = field(data, "dropped_settings") as Array<{ setting: string }> | undefined;
        observed[entry.label] = {
          status: outcome.status, code: outcome.code, expectation: sentExpectation(outcome), versionsAdded: after.length - before.length,
          settings: created ? v3Settings(created) : null,
          sameAsOracle: facts !== null && samePolicy(facts, oracleFacts),
          tube: facts?.lines.filter((line) => line.title === titles.tube).map((line) => [line.pu, line.net])[0] ?? null,
          convertedLines: converted?.map((line) => [line.title, line.template_hours, line.converted_hours]) ?? null,
          droppedSettings: dropped?.map((entry) => entry.setting) ?? null,
          reportMissing: report?.missing ?? null,
        };
        expected[entry.label] = {
          status: 201, code: null, expectation: 3, versionsAdded: 1, settings: V3_BLANK, sameAsOracle: true,
          // Tube, sans type FO (provision 1,01, TI-534) : 10,00 € × 1,01 × FO 1,30 + 0,5 h/u × 40 €/h × MO 1,20 = 37,13 € par
          // unité, 5 h du modèle gardées.
          tube: [3713, 37130], convertedLines: [[titles.collier, 1, 0.9]], droppedSettings: entry.dropped, reportMissing: [],
        };
        await recordEvidence(army, `v3c04-${entry.label}`, { outcome, created, facts, oracleFacts, report, observed: observed[entry.label] });
      }
      observed.policyUnchanged = samePolicy(await policySnapshot(owner), policy);
      expected.policyUnchanged = true;
      expect(observed).toEqual(expected);
    } finally {
      await closePolicy(owner, army, "V3C04");
    }
  });

armyTest("V3C05 the wizard instantiates a template saved from a v3 at its own 1,10 / 1,05 with its hours per unit", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const titles = templateLines(army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C05-${army.runPrefix}`);
    const roleId = await createTuyauteur(ui, army, anchor.versionId);
    const policy = await openPolicy3(owner, army, "V3C05");
    try {
      const sourceId = await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} source v3`,
        { sale_coefficient_fo: 1.1, sale_coefficient_mo: 1.05 });
      await seedV3TemplateLines(ui, army, sourceId, roleId);
      const sourceFacts = estimateFacts(await readEstimate(browser, sourceId));
      // Tube, sans type FO (provision 1,01, TI-534) : 10,00 € × 1,01 × FO 1,10 + 0,5 h/u × 40 €/h × MO 1,05 = 32,11 € par unité.
      expect(sourceFacts.lines.filter((line) => line.title === titles.tube).map((line) => [line.pu, line.net])).toEqual([[3211, 32110]]);
      const templateId = await saveTemplate(ui, army, sourceId, `${army.runPrefix} modele v3`);
      const before = await storedVersions(owner, anchor.projectId);
      await openWizard(ui, anchor.projectId);
      await fillProjectStep(ui, { title: `${army.runPrefix} assistant modele v3` });
      await nextStep(ui);
      await nextStep(ui);
      await chooseTemplate(ui, templateId);
      const outcome = await submitWizard(ui, army, "v3c05", { trigger: "create", endpoint: "instantiate" });
      const after = await storedVersions(owner, anchor.projectId);
      const created = createdOf(after, outcome);
      const facts = created ? estimateFacts(await readEstimate(browser, created.id)) : null;
      const data = outcome.responseData ?? {};
      const observed = {
        status: outcome.status, code: outcome.code, expectation: sentExpectation(outcome), versionsAdded: after.length - before.length,
        settings: created ? v3Settings(created) : null, sameAsSource: facts !== null && samePolicy(facts, sourceFacts),
        perUnit: facts?.lines.map((line) => [line.title, line.unitCode, line.hPerUnit]) ?? null,
        convertedLines: field(data, "converted_lines") ?? null, droppedSettings: field(data, "dropped_settings") ?? null,
        policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c05", { owner, sourceId, templateId, sourceFacts, outcome, created, facts, observed });
      expect(observed).toEqual({
        status: 201, code: null, expectation: 3, versionsAdded: 1, settings: { ...V3_BLANK, coefficients: [1.1, 1.05] },
        sameAsSource: true, perUnit: [[titles.collier, "u", 0.0003], [titles.tube, "ml", 0.5]],
        convertedLines: [], droppedSettings: [], policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C05");
    }
  });

/* ---------- A3 : DPGF lié ---------- */

armyTest("V3C06 the wizard's default linked DPGF source creates a v3 through the import normalization", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C06-${army.runPrefix}`);
    const linked = await linkDpgfThroughHub(ui, army, anchor.projectId);
    const policy = await openPolicy3(owner, army, "V3C06");
    try {
      const before = await storedVersions(owner, anchor.projectId);
      await openWizard(ui, anchor.projectId);
      await fillProjectStep(ui, { title: `${army.runPrefix} dpgf lie` });
      await nextStep(ui);
      await nextStep(ui);
      const source = screen.getByRole("button", "DPGF source à importer", { exact: true });
      await expect(source).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
      await expect(screen.getByText("La version sera créée avec les lignes du DPGF source lié.", { exact: true })).toBeVisible();
      const outcome = await submitWizard(ui, army, "v3c06", { trigger: "create", endpoint: "estimates" });
      await screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
      await expect(screen.getByRole("menuitem", "Importer le DPGF source", { exact: true })).toBeVisible();
      await browser.keyboard.press("Escape");
      const after = await storedVersions(owner, anchor.projectId);
      const created = createdOf(after, outcome);
      const state = created ? await readEstimate(browser, created.id) : null;
      const facts = state ? estimateFacts(state) : null;
      const lines = state?.items.filter((item) => item.item_type === "line") ?? [];
      const observed = {
        creationMode: field(outcome.requestBodies.at(-1) ?? {}, "creation_mode") ?? null,
        status: outcome.status, code: outcome.code, expectation: sentExpectation(outcome), versionsAdded: after.length - before.length,
        settings: created ? v3Settings(created) : null, sections: facts?.sections ?? null,
        lines: facts?.lines.map((line) => [line.title, line.unitCode, line.status, line.quantity, line.prFo, line.hPerUnit, line.pu, line.net, line.tax]) ?? null,
        totals: created?.totals ?? null,
        provenance: lines.length > 0 && lines.every((line: ArmyItem) => field(line, "source_provider") === "dpgf" &&
          field((field(line, "source_metadata") ?? {}) as object, "import_id") === linked.importId),
        policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c06", { owner, linked, outcome, created, facts, observed });
      expect(observed).toEqual({
        creationMode: "linked_dpgf_source", status: 201, code: null, expectation: 3, versionsAdded: 1, settings: V3_BLANK,
        sections: [`Import DPGF - ${linked.filename}`],
        // PR FO × provision 1,01 (sans type FO, TI-534) × FO 1,30 : 12,50 € → 16,41 € (« m » → ml) ; 65,00 € → 85,35 €.
        lines: [[linked.lines.robinet, "u", "priced", 1, 6500, null, 8535, 8535, 1707], [linked.lines.tube, "ml", "priced", 2, 1250, null, 1641, 3282, 656]],
        totals: [11817, 2363, 14180], provenance: true, policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C06");
    }
  });

/* ---------- N1 : accueil ---------- */

armyTest("V3C07 « Créer l'affaire » from the onboarding creates the affaire and a blank v3 under policy 3", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const projectName = `ARMY-L2-V3C07-${army.runPrefix}`;
    const policy = await openPolicy3(owner, army, "V3C07");
    try {
      const outcome = await createAffaireFromOnboarding(ui, army, projectName, "v3c07");
      const projects = await ownedProjectIdsNamed(owner, projectName);
      const versions = projects.length === 1 ? await storedVersions(owner, projects[0]!) : [];
      if (projects.length === 1 && outcome.versionId) ownEstimate(army, { projectId: projects[0]!, versionId: outcome.versionId });
      const observed = {
        alert: outcome.alert, projects: projects.length, versions: versions.map(v3Settings),
        editorOpened: outcome.versionId !== null && outcome.versionId === versions[0]?.id,
        policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c07", { owner, projectName, outcome, versions, observed });
      expect(observed).toEqual({ alert: null, projects: 1, versions: [V3_BLANK], editorOpened: true, policyUnchanged: true });
    } finally {
      await closePolicy(owner, army, "V3C07");
    }
  });

/* ---------- N3 : métré, structure IA, version zéro ---------- */

armyTest("V3C08 v3 takeoff remains available and requires a local ChatGPT plan before creating a job or source copy", capturing,
  async ({ app, screen, browser, army }) => {
    requireLocalPlansBackend();
    if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("V3C08 requires the campaign's worker-blocking server guard.");
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C08-${army.runPrefix}`);
    const policy = await openPolicy3(owner, army, "V3C08");
    let jobs: ReturnType<typeof ownedTakeoffJobs> | null = null;
    try {
      const versionId = await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} cible metre v3`);
      const estimate = { projectId: anchor.projectId, versionId };
      jobs = ownedTakeoffJobs(browser, estimate);
      await switchToExpertMode(ui);
      const planSet = await createPlanSet(ui, army, estimate, `${army.runPrefix} lot metre v3`);
      const plan = await uploadSamplePlan(ui, army, planSet);
      const openPlanPreparation = async () => {
        // The hub follows a pending request; the plan center remains the explicit
        // entry for consulting its preparation and recovering the same request.
        await app.open(`/dashboard/affaires/${anchor.projectId}/plans`);
        await screen.getByRole("heading", planSet.name, { exact: true }).click();
        const link = screen.getByRole("link", "Analyser ce jeu", { exact: true });
        await expect(link).toHaveAttribute("href", `/dashboard/affaires/${anchor.projectId}/takeoff?launch=1&launchPlanSet=${planSet.id}`);
        await link.click();
        const preparation = screen.getByRole("dialog", "Préparer le métré", { exact: true });
        await expect(preparation).toBeVisible();
        return preparation;
      };
      // La préparation du hub reste accessible sur une v3, avant toute ligne de devis.
      await app.open(`/dashboard/affaires/${anchor.projectId}`);
      const prompt = screen.getByRole("region", "Préparation du métré", { exact: true });
      await expect(prompt).toBeVisible({ timeout: 60_000 });
      const prepare = prompt.getByRole("button", "Préparer le métré", { exact: true });
      const preparationEnabled = await prepare.isEnabled();
      await prepare.click();
      let dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
      await dialog.getByRole("button", /Vérifier et lancer$/).click();
      const proposal = {
        targetsV3: await dialog.getByLabel("Version cible", { exact: true }).inputValue() === versionId,
        reasonShown: (await dialog.getByText(TAKEOFF_V3_REASON, { exact: true }).count()) > 0,
        launchEnabled: preparationEnabled,
      };
      await captureScreen(ui, army, "v3c08-takeoff-proposal");
      await browser.keyboard.press("Escape");
      // Une ligne dans la v3 conserve l'accès manuel à la même préparation (HUB01).
      await seedSupplyLine(ui, versionId, `${army.runPrefix} ligne metre`, 3);
      await app.open(`/dashboard/affaires/${anchor.projectId}#plans`);
      await expect(screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true })).toBeVisible({ timeout: 60_000 });
      await openTakeoffPreparation({ ...ui, army });
      dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [plan.file_name], processing: { level: "B", provider: "auto" } });
      const target = await dialog.getByLabel("Version cible", { exact: true }).inputValue();
      const reasonShown = (await dialog.getByText(TAKEOFF_V3_REASON, { exact: true }).count()) > 0;
      const launchEnabled = await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).isEnabled();
      await captureScreen(ui, army, "v3c08-takeoff-dialog");
      await saveTakeoffPreparation({ ...ui, army });
      await browser.keyboard.press("Escape");
      // Current local-only provider contract: engine 3 remains available, but
      // this production-mode campaign has no connected local plan. Refuse
      // admission before any job or source-version copy, just as for engine 2.
      const csvName = `${army.runPrefix}-metre.csv`;
      const csvPath = path.resolve(".e2e/army/critical/artifacts/fixtures", csvName);
      await mkdir(path.dirname(csvPath), { recursive: true });
      await writeFile(csvPath, "designation;quantity;unit\nBloc beton;12;u");
      await app.open(`/dashboard/estimates/${versionId}/takeoff/new`);
      const upload = screen.getByLabel("Fichier source", { exact: true });
      await expect(upload).toBeEnabled();
      await upload.setInputFiles(csvPath);
      const uploadPreparation = await fillTakeoffPreparation({ ...ui, army }, { sources: [csvName], objective: "extract_quantities", unit: "u",
        inclusions: "Toutes les lignes du fichier", levels: "Tous", zones: "Toutes", exclusions: "" }, browser.locator("form").last());
      await expect(uploadPreparation.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeDisabled();
      await expect(uploadPreparation.getByText("Le niveau enregistré n’est pas compatible avec les documents sélectionnés. Choisissez explicitement un niveau compatible dans les options avancées.", { exact: true })).toBeVisible();
      await uploadPreparation.getByText("Options avancées", { exact: true }).click();
      await uploadPreparation.getByRole("radio", /Niveau A/).check();
      await expect(uploadPreparation.getByRole("radio", /Niveau A/)).toBeChecked();
      await expect(uploadPreparation.getByLabel("Fournisseur IA", { exact: true })).toHaveValue("auto");
      const [created] = await Promise.all([browser.waitForResponse("**/api/takeoff/jobs"),
        screen.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click()]);
      const uploaded = await created.json<{ error?: { code?: string; message?: string } }>();
      const api = { status: created.status, code: uploaded.error?.code ?? null, message: uploaded.error?.message ?? null };
      // A rejected source launch must not insert even a temporary business
      // version. The audit count catches a copy created then deleted as well.
      await openPlanPreparation();
      await fillTakeoffPreparation({ ...ui, army }, { sources: [plan.file_name], processing: { level: "B", provider: "auto" } });
      await saveTakeoffPreparation({ ...ui, army });
      const preparationRevision = async () => {
        const [row] = await querySql(`select revision from public.takeoff_preparations where project_id='${anchor.projectId}' and tenant_id='${owner.tenantId}' and current_user='postgres';`);
        if (!row || !/^\d+$/.test(row)) throw new Error("Owned v3 preparation revision unavailable.");
        return Number(row);
      };
      const confirmation = await confirmTakeoffPreparationViaAction(browser, {
        actionId: await serverActionId("confirmTakeoffPreparationAction"),
        projectId: anchor.projectId, expectedRevision: await preparationRevision(),
      });
      expect(confirmation).toMatchObject({ status: 200, digest: null, ok: true, errorCode: null });
      expect(confirmation.revision).toBeGreaterThan(0);
      const preparationProcessing = async () => {
        const [row] = await querySql(`select draft->'processing' from public.takeoff_preparations where project_id='${anchor.projectId}' and tenant_id='${owner.tenantId}' and current_user='postgres';`);
        if (!row) throw new Error("Owned preparation processing unavailable.");
        return JSON.parse(row) as { level: string; provider: string };
      };
      const savedProcessing = await preparationProcessing();
      expect(savedProcessing).toEqual({ level: "B", provider: "auto" });
      const versionsBefore = await storedVersions(owner, anchor.projectId);
      const insertsBefore = await versionInsertsLogged(owner, anchor.projectId);
      const action = await callServerAction(browser, await serverActionId("launchPreparedTakeoffFromSourceVersionPlanSetAction"),
        { projectId: anchor.projectId, planSetId: planSet.id, sourceVersionId: versionId, level: "B", provider: "auto", preparationRevision: confirmation.revision });
      expect(action).toEqual({ status: 200, digest: null, ok: false, errorStatus: 422, errorCode: "AI_PROVIDER",
        errorMessage: "Le forfait ChatGPT est disponible dans MergeOne local sur le Mac connecté." });
      const versionsAfter = await storedVersions(owner, anchor.projectId);
      const fromSource = { status: action.status, masked: action.digest !== null,
        versionsAdded: versionsAfter.length - versionsBefore.length,
        versionsInserted: (await versionInsertsLogged(owner, anchor.projectId)) - insertsBefore,
        jobLevels: (await jobs.list()).map((job) => job.level) };
      const priorJobs = await jobs.list();
      const beforeReopenRevision = await preparationRevision();
      const reopenedDialog = await openPlanPreparation();
      await reopenedDialog.getByRole("button", /Vérifier et lancer$/).click();
      const reopenedTarget = await reopenedDialog.getByLabel("Version cible", { exact: true }).inputValue();
      await reopenedDialog.getByText("Options avancées", { exact: true }).click();
      const replayLevel = reopenedDialog.getByRole("radio", "Standard", { exact: true });
      await expect(replayLevel).toBeChecked();
      await expect(reopenedDialog.getByLabel("Fournisseur IA", { exact: true })).toHaveValue("auto");
      expect(await preparationProcessing()).toEqual(savedProcessing);
      await expect(reopenedDialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
      await reopenedDialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
      await expect(reopenedDialog.getByRole("alert").getByText("Le forfait ChatGPT est disponible dans MergeOne local sur le Mac connecté.", { exact: true })).toBeVisible();
      const replayedJobs = await jobs.list();
      const reopen = { targetIsSource: reopenedTarget === versionId,
        preparationRevisionPreserved: await preparationRevision() === beforeReopenRevision,
        versionsAdded: (await storedVersions(owner, anchor.projectId)).length - versionsAfter.length,
        sameJobIds: JSON.stringify(replayedJobs.map((job) => job.id)) === JSON.stringify(priorJobs.map((job) => job.id)) };
      const written = await jobs.list();
      const observed = { proposal, dialog: { targetIsV3: target === versionId, reasonShown, launchEnabled },
        api: [api.status, api.code], fromSource, reopen, jobLevels: written.map((job) => job.level),
        policyUnchanged: samePolicy(await policySnapshot(owner), policy) };
      await recordEvidence(army, "v3c08", { owner, estimate, planSetId: planSet.id, api, action, written, observed, savedProcessing,
        replayBoundary: "Reopen preserves Standard B and automatic local ChatGPT choice. No provider is connected in this production-mode campaign: neither job nor source-version copy may be created." });
      expect(observed).toEqual({
        proposal: { targetsV3: true, reasonShown: false, launchEnabled: true },
        dialog: { targetIsV3: true, reasonShown: false, launchEnabled: true },
        api: [422, "AI_PROVIDER"],
        fromSource: { status: 200, masked: false, versionsAdded: 0, versionsInserted: 0, jobLevels: [] },
        reopen: { targetIsSource: true, preparationRevisionPreserved: true, versionsAdded: 0, sameJobIds: true },
        jobLevels: [], policyUnchanged: true,
      });
    } finally {
      try {
        if (jobs) await jobs.cancel();
      } finally {
        await closePolicy(owner, army, "V3C08");
      }
    }
  });

armyTest("V3C09 the AI structure opens on a v3 without a reason, by its button and by its auto-open, and applies a lot of the affaire's history; no version-zero entry", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C09-${army.runPrefix}`);
    // Lot 3.2, entrée 2 : l'historique de l'affaire est la source de la preview (l'IA est coupée en recette, repli
    // heuristique) ; la v2 porte un lot que la v3 n'a pas.
    const historic = `${army.runPrefix} chauffage IA`;
    await takeLease(browser, anchor.versionId);
    const anchorState = await readEstimate(browser, anchor.versionId);
    const anchorSection = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${anchor.versionId}/items`,
      { item_type: "section", position: 1, title: historic }, { "if-match": anchorState.version.updated_at });
    expect([anchorSection.status, anchorSection.body.ok]).toEqual([201, true]);
    await releaseVersion(browser, anchor.versionId);
    const policy = await openPolicy3(owner, army, "V3C09");
    try {
      const versionId = await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} structure v3`);
      await takeLease(browser, versionId);
      const empty = await readEstimate(browser, versionId);
      const section = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${versionId}/items`,
        { item_type: "section", position: 1, title: `${army.runPrefix} lot` }, { "if-match": empty.version.updated_at });
      expect([section.status, section.body.ok]).toEqual([201, true]);
      await releaseVersion(browser, versionId);
      await switchToExpertMode(ui);
      await app.open(`/dashboard/estimates/${versionId}/edit`);
      await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
      await waitForDraftLease(ui);
      await screen.getByRole("tab", /^Insérer(?: \d+)?$/).tap();
      await screen.getByTestId("estimate-editor-insert-button").tap();
      const structure = screen.getByTestId("estimate-editor-open-structure-draft-button");
      await expect(structure).toBeVisible({ timeout: 30_000 });
      const button = await browser.evaluate(() => {
        const node = document.querySelector("[data-testid=\"estimate-editor-open-structure-draft-button\"]");
        const ids = (node?.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        const description = ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
        return { disabled: node instanceof HTMLButtonElement ? node.disabled : null, description: description || null };
      });
      await captureScreen(ui, army, "v3c09-structure-enabled");
      await browser.keyboard.press("Escape");
      // Suggestion du hub (cockpit) : l'éditeur ouvert par ?openStructureDraft=1 ouvre l'assistant, qui génère la preview.
      await app.open(`/dashboard/estimates/${versionId}/edit?openStructureDraft=1`);
      await expect(grid(ui)).toBeVisible({ timeout: 60_000 });
      const dialog = screen.getByRole("dialog", "Structure IA", { exact: true });
      await expect(dialog).toBeVisible({ timeout: 30_000 });
      const proceed = dialog.getByRole("button", "Continuer", { exact: true });
      await expect.poll(() => proceed.isEnabled(), { timeout: 90_000 }).toBe(true);
      const preview = { engineRefusal: (await dialog.getByText(ENGINE_UNAVAILABLE, { exact: false }).count()) > 0 };
      await captureScreen(ui, army, "v3c09-structure-preview");
      await proceed.tap();
      const proposed = (await dialog.getByText(historic, { exact: true }).count()) > 0;
      await proceed.tap();
      await dialog.getByRole("button", "Appliquer la structure", { exact: true }).tap();
      await expect(dialog.getByRole("heading", "Structure appliquée", { exact: true })).toBeVisible({ timeout: 60_000 });
      await captureScreen(ui, army, "v3c09-structure-applied");
      await dialog.getByRole("button", "Fermer", { exact: true }).first().tap();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      const summary = (await screen.getByText("1 section(s) créée(s), 0 fusion(s), 0 ignoree(s).", { exact: true }).count()) > 0;
      const stored = await readEstimate(browser, versionId);
      const created = stored.items.filter((item) => item.title === historic);
      // TI-582 : la version zéro n'a aucune entrée d'interface, sur aucun moteur (refus d'API : IO08).
      const versionZeroEntries = await screen.getByRole("button", "Préparer un brouillon IA", { exact: true }).count();
      const observed = { disabled: button.disabled, description: button.description, ...preview, proposed, summary,
        created: created.map((item) => [item.item_type, item.parent_id, item.position, field(item, "source_provider"),
          (field(item, "source_metadata") as { kind?: string } | null)?.kind ?? null]),
        engine: stored.version.calc_engine_version, itemCount: stored.items.length, versionZeroEntries,
        policyUnchanged: samePolicy(await policySnapshot(owner), policy) };
      await recordEvidence(army, "v3c09", { owner, versionId, observed });
      expect(observed).toEqual({ disabled: false, description: null, engineRefusal: false, proposed: true, summary: true,
        created: [["section", null, 2, "ai_structure", "ai_structure"]], engine: 3, itemCount: 2, versionZeroEntries: 0, policyUnchanged: true });
    } finally {
      await closePolicy(owner, army, "V3C09");
    }
  });

/* ---------- A16 : évolution de la marge ---------- */

/** One priced supply line in a section, by the items API (v2) or one committed batch (v3). */

armyTest("V3C10 the hub margin evolution traces each priced v3 at its margin on cost, a non-current v3 draft computed live, names a blank v3, and the hub shows the live net margin of the current v3 draft", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C10-${army.runPrefix}`, { margin_multiplier: 1.15, margin_bp: 1500 });
    await seedSupplyLine(ui, anchor.versionId, `${army.runPrefix} V1`, 2);
    const v2Id = await createV2Version(ui, army, anchor.projectId, `${army.runPrefix} V2`, { margin_multiplier: 1.1, margin_bp: 1000 });
    await seedSupplyLine(ui, v2Id, `${army.runPrefix} V2`, 2);
    const policy = await openPolicy3(owner, army, "V3C10");
    try {
      // V3 vierge, sans déboursé ; V4 : PR 100,00 € × 1,01 (provision FO sans type, TI-534) × c_FO 1,30 = 131,30 € HT,
      // déboursé 101,00 € ; V5 (courante) : c_FO 1,10, 111,10 € HT.
      await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} V3 vierge`);
      const v4Id = await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} V4`);
      await seedSupplyLine(ui, v4Id, `${army.runPrefix} V4`, 3);
      const v5Id = await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} V5`, { sale_coefficient_fo: 1.1, sale_coefficient_mo: 1.05 });
      await seedSupplyLine(ui, v5Id, `${army.runPrefix} V5`, 3);
      const versions = await storedVersions(owner, anchor.projectId);
      expect(versions.map((version) => [version.versionNumber, version.engine, version.totals[0]]))
        .toEqual([[1, 2, 11500], [2, 2, 11000], [3, 3, 0], [4, 3, 13130], [5, 3, 11110]]);
      await switchToExpertMode(ui);
      await app.open(`/dashboard/affaires/${anchor.projectId}`);
      await expect(screen.getByRole("heading", "Analyse de marge", { exact: true })).toBeVisible({ timeout: 60_000 });
      const read = await browser.evaluate(() => {
        const clean = (text: string | null | undefined) => (text ?? "").replace(/[\s\u00a0\u202f]+/g, " ").trim();
        const heading = Array.from(document.querySelectorAll("h2")).find((node) => clean(node.textContent) === "Analyse de marge");
        const section = heading?.closest("section");
        const chart = section?.querySelector("svg[role=\"img\"]");
        const labels = chart ? Array.from(chart.querySelectorAll("text")).map((node) => clean(node.textContent)) : null;
        const applied = Array.from(document.querySelectorAll("#financial p")).find((node) => clean(node.textContent) === "Marge appliquée");
        return {
          text: clean(section?.textContent),
          chartVersions: labels ? labels.filter((label) => /^V\d+$/.test(label)) : null,
          chartPercents: labels ? labels.filter((label) => /%$/.test(label)) : null,
          notice: clean(section?.querySelector("[data-testid=\"margin-evolution-v3-notice\"]")?.textContent) || null,
          applied: clean(applied?.parentElement?.textContent).replace(/^Marge appliquée ?/, ""),
        };
      });
      await browser.evaluate(() => {
        const heading = Array.from(document.querySelectorAll("h2")).find((node) => (node.textContent ?? "").trim() === "Analyse de marge");
        heading?.closest("section")?.querySelector("svg[role=\"img\"]")?.scrollIntoView({ block: "center" });
        return true;
      });
      await captureScreen(ui, army, "v3c10-margin-chart");
      const observed = {
        chartVersions: read.chartVersions, chartPercents: read.chartPercents,
        // « Marge globale » de la carte (marge sur déboursé de V5) : le dernier point du graphique la reprend.
        global: read.text.match(/Marge globale ?(-?\d+\.\d)%/)?.[1] ?? null,
        notice: read.notice,
        // Marque nette en direct du brouillon V5 sans gel : (111,10 − 101,00) / 111,10 = 909 pb.
        applied: read.applied,
        policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c10", { owner, versions, read, observed });
      expect(observed).toEqual({
        chartVersions: ["V1", "V2", "V4", "V5"], chartPercents: ["15.0%", "10.0%", "30.0%", "10.0%"], global: "10.0",
        notice: "Marge indisponible pour V3 : aucun déboursé calculable.",
        applied: "9.1 %", policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C10");
    }
  });

/** The hub's « Analyse de marge » card, read once the hub is out of its fresh start ; `null` when it is absent. */
async function readMarginCard(ui: Ui, projectId: string) {
  await ui.app.open(`/dashboard/affaires/${projectId}`);
  // Same server render as the margin card (the Expert mode is the profile's) : the card is decided once this shows.
  await expect(ui.screen.getByRole("heading", "Résumé financier", { exact: true })).toBeVisible({ timeout: 60_000 });
  return ui.browser.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("h2")).find((node) => (node.textContent ?? "").trim() === "Analyse de marge");
    const section = heading?.closest("section");
    if (!section) return null;
    const notice = section.querySelector("[data-testid=\"margin-evolution-v3-notice\"]");
    return {
      notice: notice ? (notice.textContent ?? "").replace(/\s+/g, " ").trim() : null,
      kpis: (section.textContent ?? "").includes("Marge globale"),
      chart: section.querySelector("svg[role=\"img\"]") !== null,
    };
  });
}

armyTest("V3C14 the hub margin card names a blank v3 without a section as having no computable margin; a blank v2 still shows no card", capturing,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C14-${army.runPrefix}`);
    // A linked DPGF keeps the hub out of its fresh start, where no analysis card is shown whatever the engine.
    const linked = await linkDpgfThroughHub(ui, army, anchor.projectId);
    await switchToExpertMode(ui);
    // Guard: a v1/v2 affaire without a section keeps today's hub, no card.
    const v2Only = await readMarginCard(ui, anchor.projectId);
    const policy = await openPolicy3(owner, army, "V3C14");
    try {
      const v3Id = await createV3Version(ui, army, anchor.projectId, `${army.runPrefix} v3 vierge`);
      const versions = await storedVersions(owner, anchor.projectId);
      const v3Items = (await readEstimate(browser, v3Id)).items.length;
      const withV3 = await readMarginCard(ui, anchor.projectId);
      await browser.evaluate(() => {
        document.querySelector("[data-testid=\"margin-evolution-v3-notice\"]")?.scrollIntoView({ block: "center" });
        return true;
      });
      await captureScreen(ui, army, "v3c14-margin-notice-blank-v3");
      const observed = {
        versions: versions.map((version) => [version.versionNumber, version.engine]), v3Items, v2Only, withV3,
        policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c14", { owner, linked, versions, observed });
      expect(observed).toEqual({
        versions: [[1, 2], [2, 3]], v3Items: 0, v2Only: null,
        withV3: { notice: "Marge indisponible pour V2 : aucun déboursé calculable.", kpis: false, chart: false },
        policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C14");
    }
  });

/* ---------- F15 : gardes sous une politique 2 explicite (depuis M8, une politique absente vaut 3) ---------- */

armyTest("V3C11 guard: under an explicit policy 2 the wizard (margin, tiers, quick) and the onboarding still create today's v2", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const policyBefore = await policySnapshot(owner);
    const projectName = `ARMY-L2-V3C11-${army.runPrefix}`;
    const onboardingName = `ARMY-L2-V3C11-accueil-${army.runPrefix}`;

    // Assistant vierge, marge fixe 15 % et palier inférieur de 100 € (v2 de 2.0).
    await openWizard(ui);
    await fillProjectStep(ui, { projectName, title: `${army.runPrefix} marge 15` });
    await nextStep(ui);
    await chooseV2FixedMargin(ui, "15");
    await chooseRounding(ui, "100,00 € — palier inférieur");
    await nextStep(ui);
    const margin = await submitWizard(ui, army, "v3c11-margin", { trigger: "create", endpoint: "estimates" });
    const [projectId] = await ownedProjectIdsNamed(owner, projectName);
    expect(projectId).toBeTruthy();

    // Même affaire : « Marge par tranche », puis « Créer directement » (réglages hérités de la dernière version).
    await openWizard(ui, projectId);
    await fillProjectStep(ui, { title: `${army.runPrefix} tranches` });
    await nextStep(ui);
    await screen.getByRole("button", "Marge par tranche", { exact: true }).tap();
    await nextStep(ui);
    const tiered = await submitWizard(ui, army, "v3c11-tiered", { trigger: "create", endpoint: "estimates" });
    await openWizard(ui, projectId);
    const quick = await submitWizard(ui, army, "v3c11-quick", { trigger: "quick", endpoint: "estimates" });
    const versions = await storedVersions(owner, projectId!);

    const onboarding = await createAffaireFromOnboarding(ui, army, onboardingName, "v3c11");
    const [onboardingProjectId] = await ownedProjectIdsNamed(owner, onboardingName);
    if (onboardingProjectId && onboarding.versionId) ownEstimate(army, { projectId: onboardingProjectId, versionId: onboarding.versionId });
    const onboardingVersions = onboardingProjectId ? await storedVersions(owner, onboardingProjectId) : [];

    const created = [margin, tiered, quick].map((outcome) => createdOf(versions, outcome));
    const observed = {
      statuses: [margin.status, tiered.status, quick.status],
      expectations: [margin, tiered, quick].map((outcome) => [null, 2].includes(sentExpectation(outcome) as number | null)),
      margin: v2Settings(created[0]!),
      tiered: v2Settings(created[1]!),
      quickInheritsTiered: created[2] !== null && samePolicy(v2Settings(created[2]), v2Settings(created[1])),
      onboarding: v2Settings(onboardingVersions.find((version) => version.id === onboarding.versionId) ?? null),
      policyAfter: await policySnapshot(owner),
    };
    await recordEvidence(army, "v3c11", { owner, policyBefore, versions, onboardingVersions, observed });
    // Sub-lot 2.10b (D-i): the dedicated owner holds the explicit policy 2, the per-tenant opt-out of M8.
    expect(policyBefore).toMatchObject({ engine: 2, fo: null, mo: null, events: 1 });
    expect(observed).toEqual({
      statuses: [201, 201, 201], expectations: [true, true, true],
      margin: { engine: 2, coefficients: [null, null], margin: ["fixed", 1.15, 1500], global: 1, discount: ["simple", []], rounding: ["down", 10000] },
      // Le pas d'arrondi n'est pas envoyé pour « Aucun » : il est hérité de la version précédente (10 000).
      tiered: { engine: 2, coefficients: [null, null], margin: ["tiered", 1.15, 1500], global: 1, discount: ["simple", []], rounding: ["none", 10000] },
      quickInheritsTiered: true,
      onboarding: { engine: 2, coefficients: [null, null], margin: ["fixed", 1, 0], global: 1, discount: ["simple", []], rounding: ["none", 1] },
      policyAfter: policyBefore,
    });
  });

armyTest("V3C12 guard: under an explicit policy 2 the wizard from a v2 template and from a linked DPGF still create today's v2", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const policyBefore = await policySnapshot(owner);
    const source = await createV2Affaire(ui, army, `ARMY-L2-V3C12-${army.runPrefix}`, {
      title: `${army.runPrefix} source T1`, margin_multiplier: 1.15, margin_bp: 1500, global_coefficient: 1.02,
      rounding_mode: "up", rounding_step_cents: 1000,
    });
    const roleId = await createTuyauteur(ui, army, source.versionId);
    await seedV2TemplateLines(ui, army, source.versionId, roleId);
    const sourceFacts = estimateFacts(await readEstimate(browser, source.versionId));
    const templateId = await saveTemplate(ui, army, source.versionId, `${army.runPrefix} modele marge`);
    const [sourceVersion] = await storedVersions(owner, source.projectId);

    // Modèle v2 sur une nouvelle affaire : réglages et heures du modèle, mêmes lignes que sa source.
    const templateProject = `ARMY-L2-V3C12-modele-${army.runPrefix}`;
    await openWizard(ui);
    await fillProjectStep(ui, { projectName: templateProject, title: `${army.runPrefix} depuis modele` });
    await nextStep(ui);
    await nextStep(ui);
    await chooseTemplate(ui, templateId);
    const fromTemplate = await submitWizard(ui, army, "v3c12-template", { trigger: "create", endpoint: "instantiate" });
    const [templateProjectId] = await ownedProjectIdsNamed(owner, templateProject);
    const templateVersions = templateProjectId ? await storedVersions(owner, templateProjectId) : [];
    const templateFacts = fromTemplate.versionId ? estimateFacts(await readEstimate(browser, fromTemplate.versionId)) : null;

    // DPGF lié par le hub sur une affaire à ancre v2 neutre.
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C12-dpgf-${army.runPrefix}`);
    const linked = await linkDpgfThroughHub(ui, army, anchor.projectId);
    await openWizard(ui, anchor.projectId);
    await fillProjectStep(ui, { title: `${army.runPrefix} dpgf lie v2` });
    await nextStep(ui);
    await nextStep(ui);
    await expect(screen.getByRole("button", "DPGF source à importer", { exact: true })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
    const fromDpgf = await submitWizard(ui, army, "v3c12-dpgf", { trigger: "create", endpoint: "estimates" });
    const dpgfVersions = await storedVersions(owner, anchor.projectId);
    const dpgfFacts = fromDpgf.versionId ? estimateFacts(await readEstimate(browser, fromDpgf.versionId)) : null;

    const data = fromTemplate.responseData ?? {};
    const emptyOrAbsent = (value: unknown) => value === undefined || (Array.isArray(value) && value.length === 0);
    const observed = {
      statuses: [fromTemplate.status, fromDpgf.status],
      expectations: [fromTemplate, fromDpgf].map((outcome) => [null, 2].includes(sentExpectation(outcome) as number | null)),
      template: v2Settings(templateVersions[0] ?? null),
      templateSameAsSource: templateFacts !== null && samePolicy(templateFacts, sourceFacts),
      templateHours: templateFacts?.lines.map((line) => [line.title, line.description, line.hMo, line.hPerUnit]) ?? null,
      templateReportEmpty: emptyOrAbsent(field(data, "converted_lines")) && emptyOrAbsent(field(data, "dropped_settings")),
      dpgf: v2Settings(createdOf(dpgfVersions, fromDpgf)),
      dpgfLines: dpgfFacts?.lines.map((line) => [line.title, line.description, line.unitCode, line.quantity, line.prFo, line.pu, line.net, line.tax]) ?? null,
      dpgfTotals: createdOf(dpgfVersions, fromDpgf)?.totals ?? null,
      policyAfter: await policySnapshot(owner),
    };
    await recordEvidence(army, "v3c12", { owner, policyBefore, sourceVersion, sourceFacts, templateFacts, linked, dpgfFacts, observed });
    const titles = templateLines(army);
    // Sub-lot 2.10b (D-i): the dedicated owner holds the explicit policy 2, the per-tenant opt-out of M8.
    expect(policyBefore).toMatchObject({ engine: 2, fo: null, mo: null, events: 1 });
    expect(observed).toEqual({
      statuses: [201, 201], expectations: [true, true],
      template: v2Settings(sourceVersion ?? null),
      templateSameAsSource: true,
      templateHours: [[titles.collier, "u", 1, null], [titles.tube, "ml", 5, null]],
      templateReportEmpty: true,
      dpgf: { engine: 2, coefficients: [null, null], margin: ["fixed", 1, 0], global: 1, discount: ["simple", []], rounding: ["none", 1] },
      dpgfLines: [[linked.lines.robinet, "u", null, 1, 6500, 6500, 6500, 1300], [linked.lines.tube, "m", null, 2, 1250, 1250, 2500, 500]],
      dpgfTotals: [9000, 1800, 10800],
      policyAfter: policyBefore,
    });
  });

/* ---------- R2 : refus nommés et heures atelier / chantier à la création depuis un modèle ---------- */

/** Lines of a version with their workshop and site hours per unit and roles, and its totals. */
function splitFacts(state: ArmyEstimate) {
  const number = (value: unknown) => (value === null || value === undefined ? null : Number(value));
  return {
    lines: state.items.filter((item) => item.item_type === "line").map((item) => [
      item.title, field(item, "unit_code") ?? null, number(item.quantity), number(field(item, "h_mo_per_unit")),
      number(field(item, "h_mo_atelier_per_unit")), number(field(item, "h_mo_chantier_per_unit")),
      field(item, "labor_role_atelier_id") ?? null, field(item, "labor_role_chantier_id") ?? null,
      number(field(item, "pu_ht_cents")), number(item.line_total_ht_cents),
    ]),
    totals: [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents],
  };
}

armyTest("V3C13 creating from a template refuses by name hours without quantity and a foreign labour role, nothing written, and converts workshop and site hours like its M6 insertion", options,
  async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    const owner = await signUpCreatorOwner(ui, army);
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C13-${army.runPrefix}`);
    const tuyauteur = await createTuyauteur(ui, army, anchor.versionId);
    const soudeur = await createLaborRole(ui, army, anchor.versionId, "Soudeur", 5000, "v3c13-labor-role-soudeur");
    // Main-d'œuvre éclatée (EST_031) : les moteurs valorisent alors les heures atelier et chantier par leurs rôles.
    const flag = await apiRequest<Envelope<{ flag: { flag_key: string; enabled: boolean } }>>(browser, "PATCH", "/api/feature-flags",
      { tenant_id: owner.tenantId, flag_key: "EST_031_LABOR_SPLIT", enabled: true });
    await recordEvidence(army, "v3c13-split-flag", flag);
    expect([flag.status, flag.body.ok, flag.body.data?.flag?.enabled]).toEqual([200, true, true]);
    const titles = { q0: `${army.runPrefix} sans quantite`, split: `${army.runPrefix} atelier chantier` };
    const q0Source = await createV2Version(ui, army, anchor.projectId, `${army.runPrefix} source sans quantite`);
    await seedV2Lines(ui, q0Source, [
      { title: titles.q0, description: "u", quantity: 0, h_mo: 2, unit_price_ht_cents: 1000, labor_role_id: tuyauteur },
    ]);
    const q0Template = await saveTemplate(ui, army, q0Source, `${army.runPrefix} modele sans quantite`);
    // 3 u, 3 h dont 1 h d'atelier (Tuyauteur, 40 €/h) et 2 h de chantier (Soudeur, 50 €/h).
    const splitSource = await createV2Version(ui, army, anchor.projectId, `${army.runPrefix} source eclatee`);
    await seedV2Lines(ui, splitSource, [{
      title: titles.split, description: "u", quantity: 3, h_mo: 3, unit_price_ht_cents: 1000, labor_role_id: tuyauteur,
      h_mo_atelier: 1, k_mo_atelier: 1, labor_role_atelier_id: tuyauteur, h_mo_chantier: 2, k_mo_chantier: 1, labor_role_chantier_id: soudeur,
    }]);
    const splitTemplate = await saveTemplate(ui, army, splitSource, `${army.runPrefix} modele eclate`);

    const policy = await openPolicy3(owner, army, "V3C13");
    try {
      // Heures sans quantité : refus nommé de M6, la ligne nommée ; ni affaire ni version.
      const q0Name = `ARMY-L2-V3C13-q0-${army.runPrefix}`;
      const q0Before = await tenantEstimateCounts(owner);
      const q0 = await instantiateTemplate(ui, army, q0Template,
        { project_name: q0Name, version_title: `${army.runPrefix} q0`, expected_calc_engine_version: 3 }, "v3c13-q0");
      const q0Written = { named: (await ownedProjectIdsNamed(owner, q0Name)).length, counts: await tenantEstimateCounts(owner) };

      // Heures atelier et chantier : la v3 créée égale l'insertion M6 du même modèle dans une v3 vierge.
      const oracle = await insertTemplateOracle(ui, army, anchor.projectId, splitTemplate, "v3c13-split");
      const oracleFacts = splitFacts(await readEstimate(browser, oracle.versionId));
      const splitName = `ARMY-L2-V3C13-split-${army.runPrefix}`;
      const split = await instantiateTemplate(ui, army, splitTemplate,
        { project_name: splitName, version_title: `${army.runPrefix} eclatee`, expected_calc_engine_version: 3 }, "v3c13-split");
      const splitVersionId = split.body.data?.versionId ?? null;
      const splitCreated = splitVersionId ? splitFacts(await readEstimate(browser, splitVersionId)) : null;
      const [splitProjectId] = await ownedProjectIdsNamed(owner, splitName);
      const splitStored = splitProjectId ? await storedVersions(owner, splitProjectId) : [];

      // Rôle MO d'un autre compte : un second administrateur de l'entreprise crée une affaire depuis le modèle du
      // propriétaire, dont les lignes portent les rôles de ce dernier.
      const roleName = `ARMY-L2-V3C13-role-${army.runPrefix}`;
      const roleBefore = await tenantEstimateCounts(owner);
      const member = await signUpTenantAdmin(ui, army, owner);
      const role = await instantiateTemplate(ui, army, splitTemplate,
        { project_name: roleName, version_title: `${army.runPrefix} role`, expected_calc_engine_version: 3 }, "v3c13-role");
      const roleWritten = { named: (await ownedProjectIdsNamed(owner, roleName)).length, counts: await tenantEstimateCounts(owner) };

      const refusal = (response: typeof q0, title?: string) => [response.status, response.body.ok, response.body.error?.code ?? null,
        title === undefined ? null : (response.body.error?.message ?? "").includes(title)];
      const data = split.body.data ?? {};
      const observed = {
        q0: refusal(q0, titles.q0), q0Written,
        split: [split.status, split.body.ok, field(data, "converted_lines") ?? null, field(data, "dropped_settings") ?? null],
        splitSettings: splitStored.map(v3Settings), splitLines: splitCreated?.lines ?? null,
        sameAsOracle: splitCreated !== null && samePolicy(splitCreated, oracleFacts), oracleConverted: oracle.convertedLines,
        role: refusal(role), roleWritten, policyUnchanged: samePolicy(await policySnapshot(owner), policy),
      };
      await recordEvidence(army, "v3c13", { owner, member, anchor, q0Template, splitTemplate, oracle, oracleFacts, splitCreated, splitStored, observed });
      expect(observed).toEqual({
        q0: [400, false, "ESTIMATE_V3_TEMPLATE_HOURS_WITHOUT_QUANTITY", true], q0Written: { named: 0, counts: q0Before },
        split: [201, true, [], []], splitSettings: [V3_BLANK],
        // h/u = arrondi(h / 3, 4) : 1 ; atelier 0,3333 ; chantier 0,6667. PU = 10,00 € × 1,01 (provision FO) × FO 1,30
        // + (0,3333 h × 40 € + 0,6667 h × 50 €) × MO 1,20 = 13,13 + 56,0004 → 69,13 € ; 3 u → 207,39 €.
        splitLines: [[titles.split, "u", 3, 1, 0.3333, 0.6667, tuyauteur, soudeur, 6913, 20739]],
        sameAsOracle: true, oracleConverted: [],
        role: [400, false, "ESTIMATE_TEMPLATE_LABOR_ROLE_REQUIRED", null], roleWritten: { named: 0, counts: roleBefore },
        policyUnchanged: true,
      });
    } finally {
      await closePolicy(owner, army, "V3C13");
    }
  });
