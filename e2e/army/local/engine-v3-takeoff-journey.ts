import { confirmPreparedCsv } from "../takeoff/prepared-takeoff";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";
import { ownEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { createPlanSet, ownedTakeoffJobs, requireLocalPlansBackend, uploadSamplePlan } from "../critical/plans-support";
import { fillTakeoffPreparation, openTakeoffPreparation, saveTakeoffPreparation } from "../critical/preparation-support";
import { querySql } from "./calculation-gate-support";
import { callServerAction, captureScreen, closePolicy, confirmTakeoffPreparationViaAction, createV2Affaire, createV3Version,
  openPolicy3, policySnapshot, seedSupplyLine, serverActionId, storedVersions, TAKEOFF_V3_REASON, versionInsertsLogged, type Ui,
} from "./engine-v3-creators-support";
import { switchToExpertMode } from "./engine-v3-editor-support";
import type { V3Owner } from "./engine-v3-persistence-support";

const samePolicy = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Preserve V3 admission, source-copy and replay coverage on the only supported AI runtime. */
export async function verifyV3TakeoffCreation(ui: Ui, army: ArmyState, owner: V3Owner, actionManifest: string) {
  const { app, screen, browser } = ui;
    requireLocalPlansBackend();
    if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("V3C08 requires the campaign's worker-blocking server guard.");
    const anchor = await createV2Affaire(ui, army, `ARMY-L2-V3C08-${army.runPrefix}`);
    const policy = await openPolicy3(owner, army, "V3C08");
    let jobs: ReturnType<typeof ownedTakeoffJobs> | null = null;
    let copyJobs: ReturnType<typeof ownedTakeoffJobs> | null = null;
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
      await app.open(`/dashboard/affaires/${anchor.projectId}?view=estimate`);
      const prompt = screen.getByRole("region", "Préparation du métré", { exact: true });
      await expect(prompt).toBeVisible({ timeout: 60_000 });
      const prepare = prompt.getByRole("button", "Préparer le métré", { exact: true });
      const preparationEnabled = await prepare.isEnabled();
      await prepare.click();
      let dialog = screen.getByRole("dialog", "Préparer le métré", { exact: true });
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
      // The prerequisite uses the API; reload the hub to read its committed line count.
      await browser.reload();
      await waitForHydration(browser);
      await expect(screen.getByRole("heading", "Plans, preuves & exceptions", { exact: true })).toBeVisible({ timeout: 60_000 });
      await openTakeoffPreparation({ ...ui, army });
      dialog = await fillTakeoffPreparation({ ...ui, army }, { sources: [plan.file_name] });
      const target = await dialog.getByLabel("Version cible", { exact: true }).inputValue();
      const reasonShown = (await dialog.getByText(TAKEOFF_V3_REASON, { exact: true }).count()) > 0;
      const launchEnabled = await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).isEnabled();
      await captureScreen(ui, army, "v3c08-takeoff-dialog");
      await saveTakeoffPreparation({ ...ui, army });
      await browser.keyboard.press("Escape");
      // Une préparation niveau A d'un fichier de métré confirmée sur la v3 : le jeu de plans la refuse ensuite.
      const csvName = `${army.runPrefix}-metre.csv`;
      const csvPath = path.resolve(".e2e/army/critical/artifacts/fixtures", csvName);
      await mkdir(path.dirname(csvPath), { recursive: true });
      await writeFile(csvPath, "designation;quantity;unit\nBloc beton;12;u");
      await confirmPreparedCsv(ui, estimate, csvPath, "chatgpt", actionManifest);
      // R1 : action serveur « Créer un brouillon depuis V… » du hub, sur la v3. La copie garde le moteur 3 (P-15) et
      // l'analyse du jeu de plans est lancée sur elle (niveau C).
      await openPlanPreparation();
      await fillTakeoffPreparation({ ...ui, army }, { sources: [plan.file_name] });
      await saveTakeoffPreparation({ ...ui, army });
      const preparationRevision = async () => {
        const [row] = await querySql(`select revision from public.takeoff_preparations where project_id='${anchor.projectId}' and tenant_id='${owner.tenantId}' and current_user='postgres';`);
        if (!row || !/^\d+$/.test(row)) throw new Error("Owned v3 preparation revision unavailable.");
        return Number(row);
      };
      const confirmation = await confirmTakeoffPreparationViaAction(browser, {
        actionId: await serverActionId("confirmTakeoffPreparationAction", actionManifest),
        previewActionId: await serverActionId("loadTakeoffExecutionPreviewAction", actionManifest),
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
      expect(savedProcessing).toEqual({ level: "C", provider: "chatgpt" });
      const versionsBefore = await storedVersions(owner, anchor.projectId);
      const insertsBefore = await versionInsertsLogged(owner, anchor.projectId);
      const action = await callServerAction(browser, await serverActionId("launchPreparedTakeoffFromSourceVersionPlanSetAction", actionManifest),
        { projectId: anchor.projectId, planSetId: planSet.id, sourceVersionId: versionId, level: "C", provider: "chatgpt", preparationRevision: confirmation.revision });
      expect(action).toMatchObject({ status: 200, digest: null, ok: true, errorCode: null });
      const versionsAfter = await storedVersions(owner, anchor.projectId);
      const copy = versionsAfter.find((version) => !versionsBefore.some((known) => known.id === version.id)) ?? null;
      if (copy) {
        ownEstimate(army, { projectId: anchor.projectId, versionId: copy.id });
        copyJobs = ownedTakeoffJobs(browser, { projectId: anchor.projectId, versionId: copy.id });
      }
      const fromSource = { status: action.status, masked: action.digest !== null,
        versionsAdded: versionsAfter.length - versionsBefore.length,
        versionsInserted: (await versionInsertsLogged(owner, anchor.projectId)) - insertsBefore,
        copyEngine: copy?.engine ?? null, copyJobLevels: copyJobs ? (await copyJobs.list()).map((job) => job.level) : [] };
      if (!copy || !copyJobs) throw new Error("The source-version launch did not create its owned fork.");
      const forkJobs = await copyJobs.list();
      const beforeReopenRevision = await preparationRevision();
      const reopenedDialog = await openPlanPreparation();
      const reopenedTarget = await reopenedDialog.getByLabel("Version cible", { exact: true }).inputValue();
      await expect(reopenedDialog.getByText("Analyse détaillée avec votre forfait ChatGPT", { exact: true })).toBeVisible();
      expect(await preparationProcessing()).toEqual(savedProcessing);
      await expect(reopenedDialog.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
      await reopenedDialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
      await expect(reopenedDialog.getByRole("link", /Centre d'activit/i)).toBeVisible();
      const replayedForkJobs = await copyJobs.list();
      const reopen = { targetIsCopy: reopenedTarget === copy.id,
        preparationRevisionPreserved: await preparationRevision() === beforeReopenRevision,
        versionsAdded: (await storedVersions(owner, anchor.projectId)).length - versionsAfter.length,
        sameJobIds: JSON.stringify(replayedForkJobs.map((job) => job.id)) === JSON.stringify(forkJobs.map((job) => job.id)) };
      const written = await jobs.list();
      const observed = { proposal, dialog: { targetIsV3: target === versionId, reasonShown, launchEnabled },
        fromSource, reopen, jobLevels: written.map((job) => job.level),
        policyUnchanged: samePolicy(await policySnapshot(owner), policy) };
      await recordEvidence(army, "v3c08", { owner, estimate, planSetId: planSet.id, action, copyId: copy?.id ?? null, written, observed, savedProcessing,
        replayBoundary: "Reopen retains the detailed ChatGPT analysis; same preparation, fork and job IDs." });
      expect(observed).toEqual({
        proposal: { targetsV3: true, reasonShown: false, launchEnabled: true },
        dialog: { targetIsV3: true, reasonShown: false, launchEnabled: true },
        fromSource: { status: 200, masked: false, versionsAdded: 1, versionsInserted: 1, copyEngine: 3, copyJobLevels: ["C"] },
        reopen: { targetIsCopy: true, preparationRevisionPreserved: true, versionsAdded: 0, sameJobIds: true },
        jobLevels: [], policyUnchanged: true,
      });
    } finally {
      try {
        if (jobs) await jobs.cancel();
        if (copyJobs) await copyJobs.cancel();
      } finally {
        await closePolicy(owner, army, "V3C08");
      }
    }
}
