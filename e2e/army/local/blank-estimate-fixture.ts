import { expect } from "e2e";

import { ownEstimate, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";
import { createVersion, type Ui } from "./engine-v3-creators-support";

/** The blank v2 draft the wizard would create, for journeys starting after creation. */
export async function createBlankEstimateFixture(ui: Ui, army: ArmyState, title: string) {
  const page = new URL(await ui.browser.url());
  if (!army.projectName.startsWith("ARMY-") || page.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(page.hostname) || page.origin !== new URL(ui.app.baseUrl!).origin) {
    throw new Error("An ARMY draft fixture requires its signed-in local application.");
  }
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const created = await createVersion(ui, {
    creation_mode: "blank", project: { name: army.projectName },
    version: { title, expected_calc_engine_version: 2, date_devis: date, validite_jours: 30,
      margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000, rounding_mode: "none" },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const ids = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, ids);
  const draft = await readEstimate(ui.browser, ids.versionId);
  expect(draft.project).toMatchObject({ id: ids.projectId, name: army.projectName });
  expect(draft.version).toMatchObject({ id: ids.versionId, title, status: "draft", calc_engine_version: 2 });
  await recordEvidence(army, "creation-observed", { ...ids, projectName: army.projectName, title, status: created.status, source: "api" });
  return ids;
}
