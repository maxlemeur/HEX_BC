import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";
import { apiRequest } from "../critical/fixtures";
import { hydratedUi, signIn, waitForHydration } from "../critical/hydration-support";
import { readOwnedIntakeLaunchDiagnostics, readOwnedPayerNoticeBasis } from "./automatic-start-support";
import { localChatGptClient, type ChatGptLocalServer } from "./chatgpt-local-journey-support";

// These requests share the CI runner with the other worker and the built application.
export const DEV_SERVER_WORK = { timeout: 60_000 };
export const PAYER_NOTICE = "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.";

type IntakeReadiness = Pick<AffaireIntakeWorkspace, "launchRunning" | "briefDraft" | "pendingUploadIds">;
type DossierAnalysisOptions = {
  launchRunning?: boolean;
  onRead?: (workspace: IntakeReadiness) => Promise<void>;
};

export function createIntakePlanActions(getServer: () => Pick<ChatGptLocalServer, "origin" | "transportLog">) {
  /** Signs `email` in on this file's server, after leaving any session this browser context holds there. */
  async function signInAs(ui: Parameters<typeof signIn>[0], email: string) {
    await ui.browser.clearCookies({ domain: new URL(getServer().origin).hostname });
    await signIn(ui, getServer().origin, email);
  }
  async function uploadDossierPlan(ui: ReturnType<typeof hydratedUi>, projectId: string, name: string, email: string,
    dossier: "empty" | "opened" = "empty", until: "classified" | "classifying" = "classified",
    /** Runs on the page once it is open, before the plan is added. */
    onOpened?: () => Promise<void>, pdfBytes?: Uint8Array) {
    const { client } = await localChatGptClient(email);
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", projectId);
    await mkdir(directory, { recursive: true });
    const file = path.join(directory, name);
    // Bytes of its own for each plan (a comment after the end of the PDF): the dossier refuses a second identical copy.
    await writeFile(file, pdfBytes ?? Buffer.concat([await readFile(path.resolve("e2e/fixtures/sample-plan.pdf")), Buffer.from(`\n% ${name}\n`)]));
    if (dossier === "empty") {
      // An affaire without a dossier offers its drop surface on the page.
      await ui.app.open(`/dashboard/affaires/${projectId}`);
      await onOpened?.();
      await ui.browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first().setInputFiles(file);
    } else {
      // A dossier already opened adds its pieces from « Ajouter des pièces ».
      await ui.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
      await ui.screen.getByRole("button", "Ajouter des pièces", { exact: true }).click();
      await ui.screen.getByRole("dialog", "Ajouter des documents", { exact: true })
        .getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(file);
    }
    await ui.screen.getByRole("button", "Lancer l’analyse", { exact: true }).click();
    await expect.poll(async () => {
      const { data } = await client.from("affaire_intake_documents").select("file_name,classification_status,document_kind").eq("project_id", projectId);
      return (data ?? []).some((doc) => doc.file_name === name && (until === "classifying"
        ? ["queued", "processing"].includes(doc.classification_status)
        : doc.classification_status === "classified" && doc.document_kind === "plans"));
    }, DEV_SERVER_WORK).toBe(true);
  }
  /** Wait at the same dossier read the page uses. Publication can precede closure. */
  async function waitForDossierAnalysis(ui: ReturnType<typeof hydratedUi>, projectId: string,
    { launchRunning = false, onRead }: DossierAnalysisOptions = {}) {
    let observed: { status: number; launchRunning: boolean | null; brief: string | null } | undefined;
    try {
      await expect.poll(async () => {
        const response = await apiRequest<{ data?: { workspace: IntakeReadiness } }>(
          ui.browser, "GET", `/api/affaires/${projectId}/intake`);
        const workspace = response.body?.data?.workspace;
        observed = { status: response.status, launchRunning: workspace?.launchRunning ?? null,
          brief: workspace?.briefDraft?.status ?? null };
        if (workspace) await onRead?.(workspace);
        return observed;
      }, DEV_SERVER_WORK).toEqual({ status: 200, launchRunning, brief: "a_confirmer" });
    } catch (cause) {
      const launches = await readOwnedIntakeLaunchDiagnostics(projectId).catch(() => "unavailable");
      throw new Error(`Dossier ${projectId} did not reach brief confirmation readiness (launchRunning=${launchRunning}). ` +
        `Last dossier API state: ${JSON.stringify(observed ?? null)}. Intake worker launches: ${JSON.stringify(launches)}.`, { cause });
    }
  }
  /**
   * Opens the brief of the affaire for `memberId` on a page the server rendered once what its payer notice depends on is
   * stored, with (`notice`) or without the automatic start. The server reads the notice once, when it renders the page,
   * and only for a brief to confirm; the hub's own reads of the dossier then bring the brief over that render without it.
   * The page the upload opened was rendered before the brief existed, and opening its address again only moves to the
   * fragment: its button showed the brief those reads brought, with a dialog that had no notice (CI run 44999469481,
   * AUTO03 then AUTO01). The page is therefore loaded again after the stored state is read. The hub opens the brief's
   * section from the address once hydrated, and `next dev` hydrates only after the `load` a reload waits for.
   */
  async function openBriefConfirmation(ui: ReturnType<typeof hydratedUi>, projectId: string, memberId: string, notice: boolean,
    launchState: "closed" | "running" = "closed") {
    await waitForDossierAnalysis(ui, projectId, { launchRunning: launchState === "running" });
    await expect.poll(() => readOwnedPayerNoticeBasis(projectId, memberId), DEV_SERVER_WORK)
      .toEqual({ brief: "a_confirmer", active: notice, payer: true });
    const confirm = ui.screen.getByRole("button", "Confirmer le brief", { exact: true });
    await ui.app.open(`/dashboard/affaires/${projectId}#brief`);
    await ui.browser.reload();
    await waitForHydration(ui.browser);
    await expect(confirm).toBeVisible(DEV_SERVER_WORK);
    return confirm;
  }
  const planCalls = async () => (await readFile(getServer().transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
    .filter(entry => entry.provider === "chatgpt-fixture" && entry.inputKind === "pdf");
  const planReads = async () => (await planCalls()).length;
  const forbiddenRequests = async () => (await readFile(getServer().transportLog, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line))
    .filter(entry => entry.provider === "forbidden").length;

  return { signInAs, uploadDossierPlan, waitForDossierAnalysis, openBriefConfirmation, planCalls, planReads, forbiddenRequests };
}
