import { randomUUID } from "node:crypto";
import { expect } from "e2e";

import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { apiRequest, armyTest, recordEvidence } from "./fixtures";

armyTest("Analysis progress follows readable affaires while working elsewhere", {
  session: "army", tags: ["critical", "affaires"], timeout: 120_000,
}, async ({ app, browser, screen, army }) => {
  const other = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "PROGOTH" });
  const member = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "PROGOWN" });
  const path = "/api/affaires/analysis-progress";
  const button = screen.getByRole("button", "Suivi des analyses", { exact: true });
  const panel = screen.getByRole("dialog", "Suivi des analyses", { exact: true });
  const own = randomUUID();
  const denied = randomUUID();
  const foreign = randomUUID();
  const archived = randomUUID();
  const job = randomUUID();
  const version = randomUUID();
  const request = randomUUID();

  const [firstRead] = await Promise.all([
    browser.waitForResponse(new RegExp(path), { timeout: 15_000 }),
    app.open("/dashboard"),
  ]);
  expect(firstRead.status).toBe(200);
  expect(firstRead.headers["cache-control"]).toBe("private, no-store");
  await expect(button).toBeHidden();

  await querySql(`BEGIN;
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES ('${member.tenantId}', '${other.userId}', 'engineer'),
             ('${other.tenantId}', '${member.userId}', 'director');
    UPDATE public.feature_flags SET enabled = true WHERE tenant_id = '${member.tenantId}' AND flag_key = 'TAKEOFF_MODULE_ENABLED';
    UPDATE public.tenant_memberships SET role = 'engineer'
      WHERE tenant_id = '${member.tenantId}' AND user_id = '${member.userId}';
    INSERT INTO public.estimate_projects (id, tenant_id, user_id, name, is_archived) VALUES
      ('${own}', '${member.tenantId}', '${member.userId}', 'Dossier fictif du membre', false),
      ('${denied}', '${member.tenantId}', '${other.userId}', 'Dossier fictif de la collègue', false),
      ('${foreign}', '${other.tenantId}', '${other.userId}', 'Dossier fictif autre tenant', false),
      ('${archived}', '${member.tenantId}', '${member.userId}', 'Dossier fictif archivé', true);
    INSERT INTO public.affaire_intake_uploads (project_id, created_by, status)
      SELECT id, user_id, 'processing' FROM public.estimate_projects
      WHERE id IN ('${own}', '${denied}', '${foreign}', '${archived}');
    INSERT INTO public.affaire_intake_documents (upload_id, created_by, file_name, mime_type,
      size_bytes, storage_path, upload_status, classification_status)
      SELECT id, created_by, 'piece-fictive.txt', 'text/plain', 14, project_id || '/piece-fictive.txt', 'uploaded', 'processing'
      FROM public.affaire_intake_uploads WHERE project_id IN ('${own}', '${denied}', '${foreign}', '${archived}');
    INSERT INTO public.estimate_versions (id, project_id, version_number, calc_engine_version)
      VALUES ('${version}', '${own}', 1, 2);
    INSERT INTO public.takeoff_jobs (id, project_id, estimate_version_id, tenant_id, created_by, level, status, source_file_name)
      VALUES ('${job}', '${own}', '${version}', '${member.tenantId}', '${member.userId}', 'B', 'pending', 'plan-fictif.pdf');
    COMMIT;`);

  await expect(button).toBeVisible({ timeout: 40_000 });
  await button.tap();
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Dossier fictif du membre", { exact: true })).toBeVisible();
  await expect(panel.getByText("1 pièce en cours", { exact: true })).toBeVisible();
  await expect(panel.getByText("En attente du Mac", { exact: true })).toBeVisible();
  for (const name of ["Dossier fictif de la collègue", "Dossier fictif autre tenant", "Dossier fictif archivé", "plan-fictif.pdf", "piece-fictive.txt"]) {
    await expect(panel.getByText(name, { exact: true })).toBeHidden();
  }
  await browser.evaluate(async () => {
    const panel = document.querySelector("[data-slot='popover-content']");
    await Promise.all(panel?.getAnimations().map((motion) => motion.finished) ?? []);
    return null;
  });
  await app.screenshot("analysis-progress-desktop");
  await browser.setViewport({ width: 390, height: 844 });
  await expect(panel.getByText("En attente du Mac", { exact: true })).toBeVisible();
  await app.screenshot("analysis-progress-mobile");

  await querySql(`BEGIN;
    UPDATE public.affaire_intake_documents SET classification_status = 'classified', document_kind = 'annexes', confidence = 0.9
      WHERE project_id = '${own}';
    UPDATE public.takeoff_jobs SET status = 'canceled', completed_at = clock_timestamp() WHERE id = '${job}';
    COMMIT;`);
  await expect(panel.getByText("1 pièce classée", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText("Analyse annulée", { exact: true })).toBeVisible();
  await panel.getByRole("link").filter({ hasText: "Dossier" }).tap();
  await expect(browser).toHaveURL(`/dashboard/affaires/${own}?view=dossier`);
  await expect(button).toBeHidden();
  const [returned] = await Promise.all([
    browser.waitForResponse(new RegExp(path), { timeout: 15_000 }),
    app.open("/dashboard"),
  ]);
  expect(returned.status).toBe(200);
  expect(new URL(returned.url).searchParams.has("since")).toBe(true);
  await expect(button).toBeHidden();

  await querySql(`BEGIN;
    UPDATE public.tenant_memberships SET role = 'director'
      WHERE tenant_id = '${member.tenantId}' AND user_id = '${member.userId}';
    INSERT INTO public.takeoff_launch_requests
      (id, tenant_id, project_id, origin, intent, intent_key, state, confirmed_by, payer_id, mandate_kind,
       mandated_at, execution_host_id, mandate_selection, manifest, manifest_digest, preparation_snapshot,
       admitted_at, units_expected, units_succeeded, token_budget, cost_budget_cents)
      VALUES ('${request}', '${member.tenantId}', '${denied}', 'automatic', 'initial', '${request}', 'admitted',
        '${other.userId}', '${other.userId}', 'confirmation', now(), 'mac-fictif', '{"hostId":"mac-fictif"}',
        '{"format_version":2}', repeat('a', 64), '{}', now(), 5, 2, 1000, 0);
    COMMIT;`);
  const director = await apiRequest<{ data: { affaires: { id: string; lines: unknown[] }[] } }>(browser, "GET", path);
  expect(director.status).toBe(200);
  expect(director.body.data.affaires.map(({ id }) => id)).toEqual([own, denied]);
  expect(director.body.data.affaires[1].lines).toEqual(expect.arrayContaining([expect.objectContaining({
    kind: "takeoff", detail: expect.stringContaining("2 plans lus sur 5"),
    href: `/dashboard/affaires/${denied}/takeoff?request=${request}`,
  })]));
  await recordEvidence(army, "analysis-progress", {
    own, denied, foreign, archived, reachedWithoutNavigation: true, completedWhileOpen: true,
    dismissedAcrossNavigation: true, directorOrder: [own, denied],
  });
});
