import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { assertOwnedLocalBackend } from "../local/legacy-v1-draft-support";
import { apiRequest, armyTest, createLineViaApi, ownEstimate, recordEvidence } from "./fixtures";

const options = { session: "army", trace: "off" as const, tags: ["critical", "affaires", "manager-queue"], timeout: 120_000 };
const BARE_AFFAIRES = 27;

// The list qualifies its whole portfolio with a fixed number of reads (src/lib/affaires/server.ts) instead of about
// eight requests per affaire, which exhausted its 6.5 s budget on a fifteen-affaire portfolio of the shared backend.
// This journey checks those portfolio reads against the real API: thirty affaires are qualified, each relance has
// its exact count and its filter keeps the right affaires. Request counts are asserted by the unit tests.
armyTest("MGRQ01 the affaires list qualifies a thirty-affaire portfolio and filters it by manager relance", options,
  async ({ app, browser, screen, army }) => {
    assertOwnedLocalBackend();
    const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "MGRQ", uiMode: "expert" });
    await app.open("/dashboard/affaires");

    const create = async (label: string) => {
      const name = `${army.runPrefix}-${label}`;
      const response = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(
        browser, "POST", "/api/estimates", { project: { name }, version: { title: "Version de travail" } });
      expect(response.status).toBe(201);
      const ids = { projectId: response.body.data.project.id, versionId: response.body.data.version.id };
      ownEstimate(army, ids);
      return { name, ...ids };
    };
    // No brief and no line: not ready. A line gives a working basis: ready under reserves, the brief still missing.
    const followUp = await create("relance");
    const reserves = await create("reserves");
    const revalidation = await create("revalidation");
    await createLineViaApi(browser, reserves.versionId, "Base de travail");
    await createLineViaApi(browser, revalidation.versionId, "Base de travail");
    const requestedAt = new Date().toISOString();
    const metadata = JSON.stringify({ revalidationRequest: { status: "required", requestedAt, requestedByUserId: owner.userId,
      previousStatus: "validated", cause: "addendum_received", impactedStages: ["submission_readiness"] } });
    await querySql(
      "INSERT INTO public.affaire_register_entries(id, tenant_id, project_id, kind, text, severity, status, scope_type, scope_label, created_by, updated_by, metadata) " +
      `VALUES ('${randomUUID()}', '${owner.tenantId}', '${revalidation.projectId}', 'assumption', 'Hypothèse à revalider', 'warning', 'open', 'project', 'Affaire ARMY', '${owner.userId}', '${owner.userId}', '${metadata}'::jsonb);`,
    );
    // The rest of the portfolio: bare drafts, each one more affaire to qualify.
    const bare = Array.from({ length: BARE_AFFAIRES }, (_, index) => ({
      projectId: randomUUID(), versionId: randomUUID(), name: `${army.runPrefix}-portefeuille-${String(index + 1).padStart(2, "0")}`,
    }));
    const literal = `'${JSON.stringify(bare)}'::jsonb`;
    await querySql(
      "INSERT INTO public.estimate_projects(id, name, tenant_id, user_id) " +
      `SELECT r."projectId", r.name, '${owner.tenantId}', '${owner.userId}' FROM jsonb_to_recordset(${literal}) AS r("projectId" uuid, name text); ` +
      "INSERT INTO public.estimate_versions(id, project_id, tenant_id, version_number, status, calc_engine_version) " +
      `SELECT r."versionId", r."projectId", '${owner.tenantId}', 1, 'draft', 2 FROM jsonb_to_recordset(${literal}) AS r("projectId" uuid, "versionId" uuid);`,
    );
    for (const affaire of bare) ownEstimate(army, { projectId: affaire.projectId, versionId: affaire.versionId });

    await browser.setViewport({ width: 1440, height: 900 });
    await app.open(`/dashboard/affaires?q=${encodeURIComponent(army.runPrefix)}`);
    const chips = screen.getByRole("group", "Filtrer par relance manager", { exact: true });
    const followUpChip = chips.getByRole("button", `À relancer en priorité (${BARE_AFFAIRES + 1})`, { exact: true });
    const reservesChip = chips.getByRole("button", "À revoir sous réserves (1)", { exact: true });
    const revalidationChip = chips.getByRole("button", "À rouvrir en revalidation (1)", { exact: true });
    await expect(followUpChip).toBeEnabled();
    await expect(reservesChip).toBeEnabled();
    await expect(revalidationChip).toBeEnabled();
    await expect(screen.getByText(/Qualification manager (indisponible|incomplète)/)).toHaveCount(0);

    const row = (name: string) => screen.getByRole("checkbox", `Sélectionner l'affaire ${name}`, { exact: true });
    for (const [chip, kept, param] of [
      [reservesChip, reserves, "reservations"], [revalidationChip, revalidation, "revalidation"],
    ] as const) {
      await chip.tap();
      await expect(browser).toHaveURL(new RegExp(`manager=${param}`));
      await expect(row(kept.name)).toBeVisible();
      for (const other of [followUp, reserves, revalidation].filter((affaire) => affaire !== kept)) {
        await expect(row(other.name)).toHaveCount(0);
      }
      // The filtered page carries the same qualification of the whole portfolio.
      await expect(followUpChip).toBeEnabled();
    }
    // Twenty-eight affaires to relance span two pages: narrow the portfolio to one affaire to place it exactly.
    const narrowed = (name: string) => `/dashboard/affaires?q=${encodeURIComponent(name)}&manager=follow_up`;
    await app.open(narrowed(followUp.name));
    await expect(chips.getByRole("button", "À relancer en priorité (1)", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(row(followUp.name)).toBeVisible();
    await app.open(narrowed(reserves.name));
    await expect(chips.getByRole("button", "À relancer en priorité (0)", { exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(reservesChip).toBeEnabled();
    await expect(row(reserves.name)).toHaveCount(0);

    await recordEvidence(army, "manager-queue-portfolio", {
      tenantId: owner.tenantId, affaires: BARE_AFFAIRES + 3, followUp: BARE_AFFAIRES + 1, reservations: 1, revalidation: 1,
      signals: { followUp: followUp.projectId, reserves: reserves.projectId, revalidation: revalidation.projectId },
    });
  });
