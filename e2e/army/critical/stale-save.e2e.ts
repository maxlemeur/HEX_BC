import { expect } from "e2e";

import { apiRequest, armyTest, createEstimateViaWizard, ownEstimate, readEstimate, recordEvidence } from "./fixtures";

armyTest(
  "an obsolete save returns VERSION_CONFLICT and preserves the newer persisted title",
  { session: "army", tags: ["critical"], timeout: 120_000 },
  async ({ app, screen, browser, army }) => {
    const ids = await createEstimateViaWizard({ app, screen, browser }, {
      projectName: army.projectName, title: "ARMY original revision",
    }, army);
    ownEstimate(army, ids);
    const initial = await readEstimate(browser, ids.versionId);
    const lock = await apiRequest(browser, "POST", `/api/estimates/${ids.versionId}/lock`);
    expect(lock.status).toBe(201);
    const newerTitle = `${army.runPrefix} newer saved title`;
    const first = await apiRequest(browser, "PATCH", `/api/estimates/${ids.versionId}`, {
      title: newerTitle, updated_at: initial.version.updated_at,
      expected_content_revision: initial.version.content_revision,
    });
    expect(first.status).toBe(200);
    const saved = await readEstimate(browser, ids.versionId);
    expect(saved.version.title).toBe(newerTitle);
    expect(saved.version.updated_at).not.toBe(initial.version.updated_at);
    const obsolete = await apiRequest(browser, "PATCH", `/api/estimates/${ids.versionId}`, {
      title: "ARMY obsolete title must not persist", updated_at: initial.version.updated_at,
      expected_content_revision: initial.version.content_revision,
    });
    expect(obsolete.status).toBe(409);
    expect(obsolete.body).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
    const staleHeader = await apiRequest(browser, "PATCH", `/api/estimates/${ids.versionId}`, {
      title: "ARMY obsolete header must not persist", updated_at: saved.version.updated_at,
      expected_content_revision: saved.version.content_revision,
    }, { "if-match": initial.version.updated_at });
    expect(staleHeader.status).toBe(409);
    expect(staleHeader.body).toMatchObject({ ok: false, error: { code: "VERSION_CONFLICT" } });
    const after = await readEstimate(browser, ids.versionId);
    expect(after.version.title).toBe(newerTitle);
    expect(after.version.updated_at).toBe(saved.version.updated_at);
    await browser.reload();
    await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
    expect((await readEstimate(browser, ids.versionId)).version.title).toBe(newerTitle);
    await recordEvidence(army, "stale-save", {
      ...ids,
      initialRevision: initial.version.updated_at,
      savedRevision: saved.version.updated_at,
      obsoleteStatus: obsolete.status,
      obsoleteCode: "VERSION_CONFLICT",
      staleHeaderStatus: staleHeader.status,
      headerPriority: "obsolete If-Match wins over fresh body.updated_at",
      persistedTitle: after.version.title,
      persistedRevision: after.version.updated_at,
    });
  }
);
