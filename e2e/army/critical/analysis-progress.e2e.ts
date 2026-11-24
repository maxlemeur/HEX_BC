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
      ('${archived}', '${member.tenantId}', '${member.userId}', 'Dossier fictif archivé', false);
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
    INSERT INTO public.estimate_versions (project_id, version_number, calc_engine_version)
      SELECT id, 1, 2 FROM public.estimate_projects WHERE id IN ('${denied}', '${foreign}', '${archived}');
    INSERT INTO public.takeoff_jobs (project_id, estimate_version_id, tenant_id, created_by, level, status, source_file_name)
      SELECT p.id, v.id, p.tenant_id, p.user_id, 'B', 'pending', 'plan-fictif-restreint.pdf'
      FROM public.estimate_projects p JOIN public.estimate_versions v ON v.project_id = p.id
      WHERE p.id IN ('${denied}', '${foreign}', '${archived}');
    UPDATE public.estimate_projects SET is_archived = true WHERE id = '${archived}';
    COMMIT;`);

  await expect(button).toBeVisible({ timeout: 40_000 });
  const engineer = await apiRequest<{ data: { affaires: { id: string }[] } }>(browser, "GET", path);
  expect(engineer.status).toBe(200);
  expect(engineer.body.data.affaires.map(({ id }) => id)).toEqual([own]);
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
  await expect.poll(() => browser.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]").length,
    `mergeone:analysis-progress:completions:${member.tenantId}:${member.userId}`)).toBe(2);
  await panel.getByRole("link").filter({ hasText: "Dossier" }).tap();
  await expect(browser).toHaveURL(`/dashboard/affaires/${own}?view=dossier`);
  await expect(button).toBeHidden();
  const [returned] = await Promise.all([
    browser.waitForResponse(new RegExp(path), { timeout: 15_000 }),
    app.open("/dashboard"),
  ]);
  expect(returned.status).toBe(200);
  const { data: returnedPage } = await returned.json<{ data: { affaires: { lines: { state: string }[] }[] } }>();
  expect(returnedPage.affaires.flatMap(({ lines }) => lines).filter(({ state }) => state === "finished")).toHaveLength(2);
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

armyTest("Analysis progress round 2 keeps a late completion visible after reloading", {
  session: "army", tags: ["critical", "affaires"],
}, async ({ app, browser, screen, army }) => {
  const member = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LATEJOB" });
  const project = randomUUID(), version = randomUUID(), job = randomUUID();
  const path = "/api/affaires/analysis-progress";
  await querySql(`
    UPDATE public.feature_flags SET enabled = true WHERE tenant_id = '${member.tenantId}' AND flag_key = 'TAKEOFF_MODULE_ENABLED';
    INSERT INTO public.estimate_projects (id, tenant_id, user_id, name)
      VALUES ('${project}', '${member.tenantId}', '${member.userId}', 'Affaire fictive hors instantané');
    INSERT INTO public.estimate_versions (id, project_id, version_number, calc_engine_version) VALUES ('${version}', '${project}', 1, 2);
    INSERT INTO public.takeoff_jobs (id, project_id, estimate_version_id, tenant_id, created_by, level, status)
      VALUES ('${job}', '${project}', '${version}', '${member.tenantId}', '${member.userId}', 'B', 'processing');
  `);
  const [previous] = await Promise.all([browser.waitForResponse(new RegExp(path)), app.open("/dashboard")]);
  expect(previous.status).toBe(200);
  const { data: { observedAt } } = await previous.json<{ data: { observedAt: string } }>();
  const button = screen.getByRole("button", "Suivi des analyses", { exact: true });
  const panel = screen.getByRole("dialog", "Suivi des analyses", { exact: true });
  await button.tap();
  await expect(panel.getByText("En cours", { exact: true })).toBeVisible();
  await browser.keyboard.press("Escape");
  await expect(panel).toBeHidden();

  // Reproduce the snapshot/commit ordering without a timing sleep. The later
  // commit carries the earlier transaction timestamp.
  const completedAt = new Date(Date.parse(observedAt) - 1).toISOString();
  await querySql(`UPDATE public.takeoff_jobs SET status = 'canceled',
    analysis_finished_at = '${completedAt}', completed_at = '${completedAt}' WHERE id = '${job}';`);

  const [next] = await Promise.all([browser.waitForResponse(new RegExp(path)), app.open("/dashboard")]);
  expect(next.status).toBe(200);
  await expect(button).toBeVisible();
  await button.tap();
  await expect(panel.getByText("Analyse annulée", { exact: true })).toBeVisible();
});

armyTest("Analysis progress round 2 bounds the poll on a large tenant and offers the next page", {
  session: "army", tags: ["critical", "affaires"], timeout: 120_000,
}, async ({ app, browser, screen, army }) => {
  const member = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "PROGSIZE" });
  const path = "/api/affaires/analysis-progress";
  await app.open("/analysis-progress-probe");
  await querySql(`BEGIN;
    UPDATE public.feature_flags SET enabled = true WHERE tenant_id = '${member.tenantId}' AND flag_key = 'TAKEOFF_MODULE_ENABLED';
    CREATE TEMP TABLE progress_projects ON COMMIT DROP AS
      SELECT n, gen_random_uuid() project, gen_random_uuid() version FROM generate_series(1,240) n;
    INSERT INTO public.estimate_projects (id, tenant_id, user_id, name)
      SELECT project, '${member.tenantId}', '${member.userId}', 'Affaire fictive ' || n FROM progress_projects;
    INSERT INTO public.estimate_versions (id, project_id, version_number, calc_engine_version)
      SELECT version, project, 1, 2 FROM progress_projects;
    INSERT INTO public.takeoff_jobs (project_id, estimate_version_id, tenant_id, created_by, level, status, created_at, completed_at)
      SELECT project, version, '${member.tenantId}', '${member.userId}', 'B', 'completed',
        now() - interval '3 hours', CASE WHEN j = 10 THEN now() - interval '2 days' ELSE now() - interval '1 hour' END
      FROM progress_projects CROSS JOIN generate_series(1,10) j;
    INSERT INTO public.affaire_intake_uploads (project_id, created_by, status)
      SELECT project, '${member.userId}', 'processing' FROM progress_projects WHERE n = 1;
    INSERT INTO public.affaire_intake_documents (upload_id, created_by, file_name, size_bytes, storage_path, upload_status, classification_status)
      SELECT id, created_by, 'lecture-fictive.pdf', 14, project_id || '/lecture.pdf', 'uploaded', 'processing'
      FROM public.affaire_intake_uploads WHERE tenant_id = '${member.tenantId}';
    COMMIT;
    ANALYZE public.takeoff_jobs;
    ANALYZE public.estimate_projects;`);
  type Page = { data: { affaires: Array<{ lines: Array<{ id: string; state: string; completionKeys: string[] }> }>; nextCursor: string | null } };
  const request = `${path}?since=2026-01-01T00%3A00%3A00Z`;
  const stats = async () => JSON.parse((await querySql(`
    SELECT coalesce(json_object_agg(queryid, json_build_array(calls,total_exec_time,rows)), '{}')
    FROM extensions.pg_stat_statements
    WHERE userid = 'authenticated'::regrole AND toplevel AND query LIKE 'WITH pgrst_source%';
  `)).at(-1) ?? "{}") as Record<string, [number, number, number]>;
  const samples = [];
  let first: Awaited<ReturnType<typeof apiRequest<Page>>> | undefined;
  for (let sample = 0; sample < 7; sample++) {
    const before = await stats();
    const started = performance.now();
    const response = await apiRequest<Page>(browser, "GET", request);
    const httpMs = performance.now() - started;
    const after = await stats();
    const statements = Object.entries(after).flatMap(([queryId, [calls, ms, rows]]) => {
      const old = before[queryId] ?? [0, 0, 0];
      return calls > old[0] ? [{ queryId, calls: calls - old[0], ms: ms - old[1], rows: rows - old[2] }] : [];
    });
    samples.push({ httpMs, calls: statements.reduce((sum, statement) => sum + statement.calls, 0),
      sqlMs: statements.reduce((sum, statement) => sum + statement.ms, 0), statements });
    first ??= response;
  }
  if (!first) throw new Error("Missing poll sample");
  const firstLines = first.body.data.affaires.flatMap(({ lines }) => lines);
  await recordEvidence(army, "analysis-progress-budget", { projects: 240, jobs: 2400, olderThanWindow: 240,
    returned: firstLines.length, samples });
  expect(first.status).toBe(200);
  expect(firstLines.length).toBe(17);
  expect(samples.every(({ calls }) => calls > 0 && calls <= 9)).toBe(true);
  expect(firstLines.some(({ state }) => state === "reading")).toBe(true);
  expect(typeof first.body.data.nextCursor).toBe("string");
  const next = await apiRequest<Page>(browser, "GET", `${path}?cursor=${encodeURIComponent(first.body.data.nextCursor!)}`);
  expect(next.status).toBe(200);
  const prior = new Set(firstLines.map(({ id }) => id));
  expect(next.body.data.affaires.flatMap(({ lines }) => lines).some(({ id }) => !prior.has(id))).toBe(true);

  const plan = await querySql(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL request.jwt.claims = '{"sub":"${member.userId}","role":"authenticated"}';
    EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    SELECT j.id, j.created_at FROM public.takeoff_jobs j
    WHERE j.tenant_id = '${member.tenantId}' AND j.launch_request_id IS NULL
      AND j.status NOT IN ('pending', 'processing')
      AND (j.status <> 'failed' OR j.execution_provider <> 'chatgpt_local' OR j.next_retry_at IS NULL)
      AND coalesce(j.analysis_finished_at, j.completed_at, j.updated_at) > now() - interval '24 hours'
    ORDER BY j.id DESC LIMIT 17;
    ROLLBACK;`);
  await recordEvidence(army, "analysis-progress-terminal-plan", { plan: JSON.parse(plan.join("\n")) });

  await browser.setViewport({ width: 390, height: 650 });
  await app.open("/dashboard");
  const button = screen.getByRole("button", "Suivi des analyses", { exact: true });
  const panel = screen.getByRole("dialog", "Suivi des analyses", { exact: true });
  await button.tap();
  await expect(panel.getByRole("button", "Afficher la suite", { exact: true })).toBeVisible();
  const viewed = () => browser.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]").length as number,
    `mergeone:analysis-progress:completions:${member.tenantId}:${member.userId}`);
  await expect.poll(viewed).toBeGreaterThan(0);
  expect(await viewed()).toBeLessThan(firstLines.flatMap(({ completionKeys }) => completionKeys).length);
  await panel.getByRole("button", "Afficher la suite", { exact: true }).tap();
  await expect(panel.getByRole("button", "Première page des analyses", { exact: true })).toBeVisible();
});

armyTest("Analysis progress round 2 names the plan of a one-plan relaunch", {
  session: "army", tags: ["critical", "affaires"],
}, async ({ app, browser, army }) => {
  const member = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "PROGPLAN" });
  const project = randomUUID(), initial = randomUUID(), rerun = randomUUID();
  const set = randomUUID(), first = randomUUID(), second = randomUUID();
  const host = `urn:uuid:${randomUUID()}`;
  const source = `${member.tenantId}/${set}/${first}/plan-nord.pdf`;
  await app.open("/analysis-progress-probe");
  await querySql(`BEGIN;
    UPDATE public.feature_flags SET enabled = true WHERE tenant_id = '${member.tenantId}' AND flag_key = 'TAKEOFF_MODULE_ENABLED';
    INSERT INTO public.estimate_projects (id, tenant_id, user_id, name)
      VALUES ('${project}', '${member.tenantId}', '${member.userId}', 'Affaire fictive à deux plans');
    INSERT INTO public.plan_sets (id, tenant_id, project_id, name, created_by)
      VALUES ('${set}', '${member.tenantId}', '${project}', 'Plans fictifs', '${member.userId}');
    INSERT INTO public.plan_files (id, tenant_id, plan_set_id, file_path, file_name, file_size_bytes, file_type)
      VALUES ('${first}', '${member.tenantId}', '${set}', '${source}', 'plan-nord.pdf', 10, 'application/pdf'),
        ('${second}', '${member.tenantId}', '${set}', '${member.tenantId}/${set}/${second}/plan-sud.pdf', 'plan-sud.pdf', 10, 'application/pdf');
    SET LOCAL session_replication_role = replica;
    INSERT INTO public.takeoff_launch_requests
      (id, tenant_id, project_id, origin, intent, intent_key, state, confirmed_by, payer_id, mandate_kind,
       mandated_at, execution_host_id, mandate_selection, manifest, manifest_digest, preparation_snapshot,
       admitted_at, units_expected, units_succeeded, token_budget, cost_budget_cents, closed_at, outcome, completion_event_id,
       predecessor_request_id, command_digest)
      VALUES ('${initial}', '${member.tenantId}', '${project}', 'automatic', 'initial', '${initial}', 'closed',
        '${member.userId}', '${member.userId}', 'confirmation', now(), '${host}', '{"hostId":"${host}"}',
        '{"format_version":2}', repeat('a', 64), '{}', now(), 2, 2, 1000, 0, now(), 'success', gen_random_uuid(), null, null),
      ('${rerun}', '${member.tenantId}', '${project}', 'manual', 'reread_plans', '${rerun}', 'admitted',
        '${member.userId}', '${member.userId}', 'command', now(), '${host}', '{"hostId":"${host}"}',
        '{"format_version":2}', repeat('a', 64), '{}', now(), 1, 0, 1000, 0, null, null, null, '${initial}', repeat('b', 64));
    INSERT INTO public.takeoff_jobs
      (project_id, tenant_id, created_by, level, status, launch_request_id, launch_unit_key,
       plan_set_id, source_file_name, preparation_snapshot, execution_provider, execution_host_id, processing_strategy)
      VALUES ('${project}', '${member.tenantId}', '${member.userId}', 'C', 'processing', '${rerun}', 'plan:${first}',
        '${set}', 'nom du job à ignorer.pdf', '{"preparation":{"sources":[{"kind":"plan","active":true,"document_id":"${first}"}]}}',
        'chatgpt_local', '${host}', 'sync');
    COMMIT;`);
  const response = await apiRequest<{ data: { affaires: Array<{ lines: Array<{ href: string; detail: string; status: string }> }> } }>(
    browser, "GET", "/api/affaires/analysis-progress");
  expect(response.status).toBe(200);
  const lines = response.body.data.affaires.flatMap(({ lines }) => lines);
  expect(lines).toEqual(expect.arrayContaining([
    expect.objectContaining({ detail: expect.stringContaining("2 plans lus sur 2") }),
    expect.objectContaining({
      href: `/dashboard/affaires/${project}/takeoff?request=${rerun}`,
      detail: expect.stringContaining("Relance de l’analyse — plan-nord.pdf"),
    }),
  ]));
});

armyTest("Analysis progress round 2 keeps the same completion after a priority edit", {
  session: "army", tags: ["critical", "affaires"],
}, async ({ app, browser, army }) => {
  const member = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "PRIOPROG" });
  const project = randomUUID(), document = randomUUID();
  await app.open("/analysis-progress-probe");
  await querySql(`BEGIN;
    INSERT INTO public.estimate_projects (id, tenant_id, user_id, name)
      VALUES ('${project}', '${member.tenantId}', '${member.userId}', 'Affaire fictive de classement');
    INSERT INTO public.affaire_intake_uploads (project_id, created_by, status)
      VALUES ('${project}', '${member.userId}', 'ready');
    INSERT INTO public.affaire_intake_documents
      (id, upload_id, created_by, file_name, size_bytes, storage_path, upload_status, classification_status, document_kind, classified_at)
      SELECT '${document}', id, created_by, 'dpgf-fictif.xlsx', 20, project_id || '/dpgf.xlsx', 'uploaded', 'classified', 'dpgf', now()
      FROM public.affaire_intake_uploads WHERE project_id = '${project}';
    COMMIT;`);
  const read = async () => {
    const response = await apiRequest<{ data: { affaires: Array<{ lines: Array<{ updatedAt: string; completionKeys?: string[] }> }> } }>(
      browser, "GET", "/api/affaires/analysis-progress");
    expect(response.status).toBe(200);
    return response.body.data.affaires[0].lines[0];
  };
  const before = await read();
  await querySql(`UPDATE public.affaire_intake_documents SET document_priority = 'primary' WHERE id = '${document}';`);
  const after = await read();
  expect(after.updatedAt).toBe(before.updatedAt);
  expect(after.completionKeys?.length).toBe(1);
  expect(after.completionKeys).toEqual(before.completionKeys);
});
