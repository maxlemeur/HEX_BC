import { randomUUID } from "node:crypto";

import { expect, type JsonValue } from "e2e";
import type { Browser } from "@e2e-dev/web";

import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";

import { apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { ownedTakeoffJobs } from "../critical/plans-support";
import { localTakeoffWorkerClient } from "./fixtures";
import { signUpWorkerOwner, startOwnedWorker, type WorkerUi } from "./worker-support";
import { ZONE_PLANS, buildZonePlanPdf } from "./zone-plans-fixture";

// TI-664 (métré L5): the fixed rules decide, the user settles what fails. Two zone plans of one level, read by the
// real worker (vector reading and rules on) as two level C jobs of one estimate version, draw the same EF run over
// 1.00 m. The duplicate blocks the application with its reason; the user removes that length from one line; the
// choice is kept after a reload and the estimate counts the shared length once. TKR01 goes through the API the
// review uses (the application is the review's own call, with its page lease); TKR02 through the targeted review
// and the application wizard (TI-664 L5c). Fictional plans only.

const options = { session: "army", trace: "off" as const, tags: ["critical", "takeoff-worker", "local"], timeout: 240_000 };

type Item = TakeoffJobDetailResponse["items"]["data"][number];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; details?: { blocked_items?: Array<{ item_id: string; reasons: string[];
  rule_codes?: string[]; rule_reasons?: string[] }> } } };

async function applyWithLease(browser: Browser, versionId: string, jobId: string, body: unknown) {
  return browser.evaluate(async (input) => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessionId = scope.__miaouffrageEstimateDraftLockSessions?.get(input.versionId) ??
      sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`);
    if (!sessionId) throw new Error("The owned page lease is missing.");
    const response = await fetch(`/api/takeoff/jobs/${input.jobId}/apply`, {
      method: "POST", credentials: "same-origin", body: input.body,
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": sessionId },
    });
    return { status: response.status, body: await response.json() as JsonValue };
  }, { versionId, jobId, body: JSON.stringify(body) });
}

async function readItems(ui: WorkerUi, jobId: string) {
  const read = await apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}?items_limit=200`);
  expect([read.status, read.body.ok]).toEqual([200, true]);
  return read.body.data.items.data;
}

async function patchItems(ui: WorkerUi, jobId: string, items: Array<{ item: Item; fields: Record<string, unknown> }>) {
  const patched = await apiRequest<{ ok: boolean; data: { results: Array<{ item_id: string; success: boolean; item?: Item; error?: string }> } }>(
    ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`,
    { items: items.map(({ item, fields }) => ({ item_id: item.id, updated_at: item.updated_at, fields })) });
  expect([patched.status, patched.body.ok]).toEqual([200, true]);
  expect(patched.body.data.results.map((result) => [result.item_id, result.success, result.error ?? null]))
    .toEqual(items.map(({ item }) => [item.id, true, null]));
  return new Map(patched.body.data.results.map((result) => [result.item_id, result.item as Item]));
}

const zoneCode = (item: Item | undefined) => item?.rule_results?.find((entry) => entry.rule === "zone_overlap")?.code ?? null;

/** Z1 then Z2: two level C jobs of one estimate version, each read by the real worker with the vector reading and the rules. */
async function seedZoneJobs(ui: WorkerUi, journey: string, tag: string, title: string, revision?: "A") {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const owner = await signUpWorkerOwner(ui, tag);
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${journey}`, title }, ui.army);
  const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} lot plomberie`);
  expect(target.parent_id).toMatch(/^[0-9a-f-]{36}$/i);
  const { client, tenantId } = await localTakeoffWorkerClient(ui.army, ids.versionId, owner.email, owner.password);
  expect(tenantId).toBe(owner.tenantId);
  const jobs: Record<"Z1" | "Z2", string> = { Z1: "", Z2: "" };
  async function addZone(zone: "Z1" | "Z2", revision?: "A" | "B") {
    const fileName = revision ? `revue-${revision}-R+1-${zone}.pdf` : ZONE_PLANS.zones[zone].fileName;
    const bytes = Buffer.from(await buildZonePlanPdf(zone, revision));
    const jobId = randomUUID();
    const sourcePath = `${tenantId}/${jobId}/${fileName}`;
    (ui.army.ownedTakeoffUploads ??= []).push({ projectId: ids.projectId, tenantId, jobId });
    expect((await client.storage.from("takeoff-files").upload(sourcePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
    const inserted = await client.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: ids.versionId,
      created_by: owner.userId, level: "C", status: "pending", source_file_name: fileName, source_file_path: sourcePath,
      source_file_type: "application/pdf", source_file_size_bytes: bytes.length, execution_provider: "gemini" } as never).select("id").single();
    expect(inserted.error).toBeNull();
    const completed = await startOwnedWorker(ui, ids, jobId, "success", { vectors: true, rules: true, owner }).done;
    expect(completed.job).toMatchObject({ status: "completed", level: "C" });
    return jobId;
  }
  for (const zone of ["Z1", "Z2"] as const) jobs[zone] = await addZone(zone, revision);
  expect((await ownedTakeoffJobs(ui.browser, ids).list()).map((job) => job.status)).toEqual(["completed", "completed"]);
  return { owner, ids, target, client, jobs, addZone };
}

armyTest("TKR01 a run drawn on two zone plans of one level blocks the application with its reason until one line removes it, then counts once", options,
  async (ui) => {
    // Z1 then Z2: two level C jobs of the version, each read by the real worker with the vector reading and the rules.
    const { ids, target, client, jobs } = await seedZoneJobs(ui, "TKR01", "RUL", "Règles fixes Z1 Z2");

    // The vector EF line of each zone is excluded by default (TI-662); the provider's stub pipe names no network, so the
    // DN rule fails it (« Triplet absent : échec »): the user excludes it and includes the measured EF line.
    const lines: Record<"Z1" | "Z2", { ef: Item; stub: Item }> = { Z1: {} as never, Z2: {} as never };
    for (const zone of ["Z1", "Z2"] as const) {
      const items = await readItems(ui, jobs[zone]);
      const ef = items.find((item) => item.designation === ZONE_PLANS.designation);
      const stub = items.find((item) => item.designation === "ARMY worker pipe");
      expect(ef).toMatchObject({ quantity: ZONE_PLANS.zones[zone].length_m, unit: "ml", is_excluded: true, rules_stale: false });
      expect(ef?.rule_results?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "pass", code: "DN_NETWORK_COMPATIBLE" });
      expect(stub?.rule_results?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "fail", code: "DN_NETWORK_NETWORK_MISSING" });
      lines[zone] = { ef: ef as Item, stub: stub as Item };
      const saved = await patchItems(ui, jobs[zone], [
        { item: lines[zone].ef, fields: { is_excluded: false } },
        { item: lines[zone].stub, fields: { is_excluded: true, exclusion_reason: "Ligne du fournisseur fictif, sans réseau." } },
      ]);
      lines[zone].ef = saved.get(lines[zone].ef.id) as Item;
    }
    // Both EF lines included: each is the duplicate of the other over 1.00 m, the other zone's line named.
    const duplicate = (await readItems(ui, jobs.Z1)).find((item) => item.id === lines.Z1.ef.id) as Item;
    const reason = duplicate.rule_results?.find((entry) => entry.rule === "zone_overlap");
    expect(reason).toMatchObject({ status: "fail", code: "ZONE_OVERLAP_DUPLICATE", acceptable: true,
      details: { overlap_m: ZONE_PLANS.overlap_m, partners: [{ item_id: lines.Z2.ef.id, zone: "Z2", overlap_m: ZONE_PLANS.overlap_m, resolved: false }] } });
    expect(reason?.reason).toContain("1,00 m");
    expect(zoneCode(lines.Z2.ef)).toBe("ZONE_OVERLAP_DUPLICATE");
    // Registered from the building: Z2's page metres reach Z1's frame by +4 m (the sheet shift), written on its geometry.
    const geometry = await client.from("takeoff_item_geometries").select("geometry").eq("takeoff_item_id", lines.Z2.ef.id).single();
    expect((geometry.data as { geometry: { transform: number[] } } | null)?.geometry.transform).toEqual([1, 0, 0, 1, ZONE_PLANS.shift_m, 0]);
    await recordEvidence(ui.army, "TKR01-duplicate", { ids, jobs, z1: { id: duplicate.id, results: duplicate.rule_results },
      z2: { id: lines.Z2.ef.id, results: lines.Z2.ef.rule_results }, transform: (geometry.data as { geometry: unknown } | null)?.geometry,
      boundary: "Owned worker with MERGEONE_TAKEOFF_VECTORS=1 and MERGEONE_TAKEOFF_RULES=1 on two fictional zone plans uploaded directly." });

    // The application is blocked, with the line and its reason.
    const apply = { strategy: "append", target_section_id: target.parent_id };
    const blocked = await applyWithLease(ui.browser, ids.versionId, jobs.Z1, apply);
    const failure = blocked.body as Envelope<unknown>;
    await recordEvidence(ui.army, "TKR01-blocked", { ids, jobs, status: blocked.status, body: failure });
    expect([blocked.status, failure.ok, failure.error?.code]).toEqual([422, false, "TAKEOFF_APPLY_GUARD_FAILED"]);
    const blockedItems = failure.error?.details?.blocked_items ?? [];
    expect(blockedItems.map((entry) => [entry.item_id, entry.reasons, entry.rule_codes]))
      .toEqual([[lines.Z1.ef.id, ["rule_failed"], ["ZONE_OVERLAP_DUPLICATE"]]]);
    expect(blockedItems[0]?.rule_reasons?.[0]).toContain("1,00 m");

    // A second session still shows Z2 before Z1's decision. Its guided reduction must not deduct the same metre.
    const z2BeforeDecision = (await readItems(ui, jobs.Z2)).find((item) => item.id === lines.Z2.ef.id) as Item;
    // The user settles it: the Z1 line loses the shared length (5.00 → 4.00 m). Both lines are settled.
    const corrected = (await patchItems(ui, jobs.Z1, [{ item: duplicate, fields: { quantity: ZONE_PLANS.zones.Z1.length_m - ZONE_PLANS.overlap_m } }]))
      .get(duplicate.id) as Item;
    expect(corrected).toMatchObject({ quantity: 4, rules_stale: false });
    expect(zoneCode(corrected)).toBe("ZONE_OVERLAP_RESOLVED");

    const staleDecision = await apiRequest<{ ok: boolean; data: { results: Array<{ success: boolean }> } }>(ui.browser,
      "PATCH", `/api/takeoff/jobs/${jobs.Z2}/items`, { items: [{ item_id: z2BeforeDecision.id,
        updated_at: z2BeforeDecision.updated_at, expected_rules_evaluated_at: z2BeforeDecision.rules_evaluated_at,
        fields: { quantity: 2 } }] });
    expect([staleDecision.status, staleDecision.body.data.results[0]?.success]).toEqual([200, false]);
    expect((await readItems(ui, jobs.Z2)).find((item) => item.id === z2BeforeDecision.id)?.quantity).toBe(3);

    // An interrupted recomputation has an explicit recovery action; it changes no quantity, even with the worker
    // flag off on the web server (the existing rule inputs still have to be protected).
    expect((await client.from("takeoff_items").update({ rules_stale: true, rules_stale_at: new Date().toISOString() } as never)
      .eq("id", duplicate.id)).error).toBeNull();
    const recovered = await apiRequest<{ ok: boolean; data: { pending: boolean } }>(ui.browser,
      "POST", `/api/takeoff/jobs/${jobs.Z1}/rules/recompute`, {});
    expect([recovered.status, recovered.body.data.pending]).toEqual([200, false]);
    expect((await readItems(ui, jobs.Z1)).find((item) => item.id === duplicate.id)).toMatchObject({ quantity: 4, rules_stale: false });

    // Kept after a reload: both lines read back settled, the correction persisted.
    await ui.browser.reload();
    // The reloaded editor gives its draft lock back and takes it again: applying before it holds it is refused (409).
    await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/);
    const reread = (await readItems(ui, jobs.Z1)).find((item) => item.id === duplicate.id);
    expect(reread).toMatchObject({ quantity: 4, is_excluded: false });
    expect(zoneCode(reread)).toBe("ZONE_OVERLAP_RESOLVED");
    expect(zoneCode((await readItems(ui, jobs.Z2)).find((item) => item.id === lines.Z2.ef.id))).toBe("ZONE_OVERLAP_RESOLVED");

    // Both zones apply; the estimate counts the shared metre once: 4.00 + 3.00 = 7.00 m, never 8.00 m.
    for (const zone of ["Z1", "Z2"] as const) {
      const applied = await applyWithLease(ui.browser, ids.versionId, jobs[zone], apply);
      expect([zone, applied.status, (applied.body as Envelope<{ job: { status: string } }>).data?.job?.status]).toEqual([zone, 200, "applied"]);
    }
    // Z2 applied after Z1: its last computation, just before its application, read Z1 as an applied (frozen) partner.
    const z2Applied = (await readItems(ui, jobs.Z2)).find((item) => item.id === lines.Z2.ef.id);
    expect(z2Applied?.rule_results?.find((entry) => entry.rule === "zone_overlap")).toMatchObject({ code: "ZONE_OVERLAP_RESOLVED",
      details: { partners: [expect.objectContaining({ item_id: lines.Z1.ef.id, zone: "Z1" })] } });
    const estimate = await readEstimate(ui.browser, ids.versionId);
    const runs = estimate.items.filter((item) => item.title === ZONE_PLANS.designation).map((item) => Number(item.quantity)).sort();
    expect(runs).toEqual([3, 4]);
    expect(runs.reduce((sum, quantity) => sum + quantity, 0)).toBe(ZONE_PLANS.zones.Z1.length_m + ZONE_PLANS.zones.Z2.length_m - ZONE_PLANS.overlap_m);
    await recordEvidence(ui.army, "TKR01-applied-once", { ids, jobs, estimateRuns: runs, target: target.parent_id });
  });

// TI-664 L5c: the same two zone plans, settled in the targeted review (tool layout) by keyboard: the duplicate is
// listed with its reason (1.00 m counted twice, the Z2 line), the application stays closed, the user removes the
// shared metre from the Z1 line by direct entry, the decision holds after a reload, both jobs apply through the
// wizard and the estimate counts the metre once. The providers' stub lines are settled in the UI too: excluded with
// a reason (E) on Z1, accepted (V) on Z2.
armyTest("TKR02 the targeted review lists a Z1/Z2 duplicate with its reason, the user settles it by keyboard, kept after a reload, counted once", options,
  async (ui) => {
    const { ids, target, jobs, client } = await seedZoneJobs(ui, "TKR02", "RUL2", "Revue ciblée Z1 Z2");
    // Setup only: the vector EF lines arrive excluded (TI-662); both included, the duplicate appears.
    for (const zone of ["Z1", "Z2"] as const) {
      const ef = (await readItems(ui, jobs[zone])).find((item) => item.designation === ZONE_PLANS.designation) as Item;
      await patchItems(ui, jobs[zone], [{ item: ef, fields: { is_excluded: false } }]);
    }
    // The editor's draft lock goes back: the application takes its own from the review.
    expect((await apiRequest<{ data: { released: boolean } }>(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`)).status).toBe(200);
    const screen = ui.screen;
    const targeted = (jobId: string) => `/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review/targeted?versionId=${ids.versionId}`;

    // Recover an interrupted computation through the UI without changing a business quantity.
    expect((await client.from("takeoff_items").update({ rules_stale: true, rules_stale_at: new Date().toISOString() } as never)
      .eq("job_id", jobs.Z1)).error).toBeNull();
    await ui.browser.setViewport({ width: 1440, height: 900 });
    await ui.app.open(targeted(jobs.Z1));
    await expect(screen.getByRole("heading", "Revue ciblée", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Recalculer les règles", { exact: true }).click();
    await expect(screen.getByRole("button", "Recalculer les règles", { exact: true })).toHaveCount(0);
    expect((await readItems(ui, jobs.Z1)).find((item) => item.designation === ZONE_PLANS.designation))
      .toMatchObject({ quantity: 5, rules_stale: false });
    const list = screen.getByRole("listbox", "Lignes à trancher", { exact: true });
    await expect(list.getByRole("option")).toHaveCount(2);
    await expect(screen.getByRole("button", /^Règle en échec 2$/)).toBeVisible();
    const applyButton = screen.getByRole("button", "Appliquer au devis", { exact: true });
    await expect(applyButton).toBeDisabled();
    await expect(screen.getByText("2 lignes à trancher avant l’application.", { exact: true })).toBeVisible();

    // The stub line names no network: excluded with its reason (E).
    await list.getByRole("option", /^ARMY worker pipe/).click();
    await expect(screen.getByRole("region", "Décision sur la ligne", { exact: true })).toContainText("DN_NETWORK_NETWORK_MISSING");
    await ui.browser.keyboard.press("e");
    const dialog = screen.getByRole("dialog", "Exclure 1 item", { exact: true });
    await dialog.getByLabel("Motif d'exclusion (obligatoire)", { exact: true }).fill("Ligne du fournisseur fictif, sans réseau.");
    const excluded = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z1}/items`);
    await dialog.getByRole("button", "Exclure", { exact: true }).click();
    expect((await excluded).status).toBe(200);
    await expect(list.getByRole("option")).toHaveCount(1);

    // The duplicate: its reason, the length counted twice and the Z2 line, the Z2 review one click away.
    const decision = screen.getByRole("region", "Décision sur la ligne", { exact: true });
    await list.getByRole("option", new RegExp(`^${ZONE_PLANS.designation}`)).click();
    await expect(decision).toContainText("ZONE_OVERLAP_DUPLICATE");
    await expect(decision.getByText(/^Longueur comptée deux fois/)).toContainText("1,00 m");
    const others = decision.getByRole("list", "Lignes des autres zones", { exact: true });
    await expect(others).toContainText("Z2");
    await expect(others).toContainText(ZONE_PLANS.designation);
    await expect(others.getByRole("link", "Ouvrir Z2", { exact: true })).toHaveAttribute("href", new RegExp(`/takeoff/${jobs.Z2}/review/targeted\\?versionId=${ids.versionId}&line=`));
    await expect(decision.getByRole("button", /^Retirer 1,00 m/)).toBeVisible();
    await expect(screen.getByText("1 ligne à trancher avant l’application.", { exact: true })).toBeVisible();
    // Tool layout (TI-658): the page never scrolls, only its panels, at 1440 × 900 and 1920 × 1080.
    const screenshots: string[] = [];
    for (const size of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }]) {
      await ui.browser.setViewport(size);
      await expect(screen.getByRole("listbox", "Lignes à trancher", { exact: true })).toBeVisible();
      // Never the page, and nothing the screen needs cut off at its bottom: the application and the decisions are in view,
      // the plan has its height, the line is drawn in focus.
      const layout = await ui.browser.evaluate(() => {
        const bottom = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().bottom ?? Infinity;
        return { scroll: document.scrollingElement!.scrollHeight <= window.innerHeight,
          apply: [...document.querySelectorAll("button")].find((button) => button.textContent === "Appliquer au devis")!.getBoundingClientRect().bottom <= window.innerHeight,
          decisions: bottom("[role='toolbar'][aria-label='Décisions']") <= window.innerHeight,
          plan: (document.querySelector("svg[aria-label='Géométrie mesurée']")?.getBoundingClientRect().height ?? 0) > 100,
          focus: document.querySelectorAll("[data-focus='true']").length > 0 };
      });
      expect([size.width, layout]).toEqual([size.width, { scroll: true, apply: true, decisions: true, plan: true, focus: true }]);
      screenshots.push(await ui.app.screenshot(`takeoff-targeted-review-duplicate-${size.width}`));
    }
    await recordEvidence(ui.army, "TKR02-blocked-in-review", { ids, jobs, reason: await decision.textContent(), screenshots });

    // Settled by direct entry: 4 then Enter on the Z1 line (5.00 → 4.00 m); the answer carries the rule state of the
    // job's lines (the Z1 job only: the Z2 line is read by its own review).
    await ui.browser.keyboard.press("4");
    await expect(decision.getByLabel("Quantité", { exact: true })).toHaveValue("4");
    const corrected = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z1}/items`);
    await ui.browser.keyboard.press("Enter");
    const answer = await corrected;
    const patched = await answer.json<Envelope<{ results: Array<{ item: Item }>; rule_states?: Array<{ item_id: string; rule_results: Item["rule_results"] }> }>>();
    await recordEvidence(ui.army, "TKR02-settled", { ids, jobs, status: answer.status, body: patched });
    expect(answer.status).toBe(200);
    expect(patched.data.results[0]?.item).toMatchObject({ quantity: 4, rules_stale: false });
    expect(zoneCode(patched.data.results[0]?.item)).toBe("ZONE_OVERLAP_RESOLVED");
    const stateIds = patched.data.rule_states?.map((state) => state.item_id) ?? [];
    const z1Lines = await readItems(ui, jobs.Z1);
    expect(stateIds).toContain(patched.data.results[0]?.item.id);
    expect(stateIds).toContain(z1Lines.find((item) => item.designation === "ARMY worker pipe")?.id);
    expect(stateIds.filter((id) => !z1Lines.some((item) => item.id === id))).toEqual([]);
    await expect(list.getByRole("option")).toHaveCount(0);
    await expect(screen.getByText("Aucune ligne à trancher : le contrôle du métré est complet.", { exact: true })).toBeVisible();
    await expect(applyButton).toBeEnabled();

    // Kept after a reload: nothing left to settle, the line at 4.00 m on the server, both lines settled.
    await ui.browser.reload();
    await expect(screen.getByText("Aucune ligne à trancher : le contrôle du métré est complet.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Appliquer au devis", { exact: true })).toBeEnabled();
    const z1 = (await readItems(ui, jobs.Z1)).find((item) => item.designation === ZONE_PLANS.designation);
    expect(z1).toMatchObject({ quantity: 4, is_excluded: false });
    expect(zoneCode(z1)).toBe("ZONE_OVERLAP_RESOLVED");
    expect(zoneCode((await readItems(ui, jobs.Z2)).find((item) => item.designation === ZONE_PLANS.designation))).toBe("ZONE_OVERLAP_RESOLVED");

    // Each job applies through the wizard of its targeted review; Z2's stub line is accepted (V) first.
    for (const zone of ["Z1", "Z2"] as const) {
      if (zone === "Z2") {
        await ui.app.open(targeted(jobs.Z2));
        await expect(list.getByRole("option")).toHaveCount(1);
        await list.getByRole("option", /^ARMY worker pipe/).click();
        const accepted = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z2}/items`);
        await ui.browser.keyboard.press("v");
        expect((await accepted).status).toBe(200);
        await expect(list.getByRole("option")).toHaveCount(0);
      }
      await screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
      const wizard = screen.getByRole("dialog", "Appliquer au devis", { exact: true });
      await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: String(target.parent_id) });
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      await wizard.getByRole("radio", /^Ajouter sans effacer/).check();
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      await expect(wizard).toContainText(ZONE_PLANS.designation);
      await wizard.getByRole("button", "Suivant", { exact: true }).click();
      const applied = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs[zone]}/apply`);
      await wizard.getByRole("button", "Confirmer l'application", { exact: true }).click();
      const response = await applied;
      const body = await response.json<Envelope<{ job: { status: string } }>>();
      await recordEvidence(ui.army, `TKR02-applied-${zone}`, { ids, jobs, status: response.status, body });
      expect([zone, response.status, body.data?.job?.status]).toEqual([zone, 200, "applied"]);
      await expect(wizard).toBeHidden();
      await expect(screen.getByText("Ce métré a déjà été appliqué au chiffrage.", { exact: true })).toBeVisible();
    }

    // The estimate counts the shared metre once: 4.00 + 3.00 = 7.00 m, never 8.00 m.
    const estimate = await readEstimate(ui.browser, ids.versionId);
    const runs = estimate.items.filter((item) => item.title === ZONE_PLANS.designation).map((item) => Number(item.quantity)).sort();
    expect(runs).toEqual([3, 4]);
    expect(runs.reduce((sum, quantity) => sum + quantity, 0)).toBe(ZONE_PLANS.zones.Z1.length_m + ZONE_PLANS.zones.Z2.length_m - ZONE_PLANS.overlap_m);
    expect(estimate.items.filter((item) => item.title === "ARMY worker pipe").map((item) => Number(item.quantity))).toEqual([12.5]);
    await recordEvidence(ui.army, "TKR02-applied-once", { ids, jobs, estimateRuns: runs, target: target.parent_id });
  });

armyTest("TKR03 corrects a weld unit without attesting its quantity and reopens a verified run on the revised zone plan", options,
  async (ui) => {
    const { ids, jobs, addZone } = await seedZoneJobs(ui, "TKR03", "REV", "Revue détail unité", "A");
    const { screen } = ui;
    const list = screen.getByRole("listbox", "Lignes à trancher", { exact: true });
    const panel = screen.getByRole("region", "Décision sur la ligne", { exact: true });
    const weld = (await readItems(ui, jobs.Z1)).find((item) => item.designation === "Soudures atelier")!;
    expect(weld).toMatchObject({ quantity: 2, unit: "kg" });
    const target = `/dashboard/affaires/${ids.projectId}/takeoff/${jobs.Z1}/review/targeted?versionId=${ids.versionId}&line=${weld.id}`;
    await ui.app.open(target);
    await expect(panel).toContainText("NON_OBSERVABLE_TO_ENTER");
    const actions: string[] = [];
    const start = performance.now();
    const act = async (name: string, action: () => Promise<unknown>) => { await action(); actions.push(name); };

    await act("Ouvrir la correction d’unité", () => panel.getByRole("button", "Corriger l’unité (kg)", { exact: true }).click());
    const unitDialog = screen.getByRole("dialog", "Corriger l’unité", { exact: true });
    await act("Saisir l’unité", () => unitDialog.getByLabel("Unité", { exact: true }).fill("u"));
    await act("Enregistrer", () => unitDialog.getByRole("button", "Enregistrer", { exact: true }).click());
    await expect(unitDialog).toBeHidden();

    await expect(panel).toContainText("NON_OBSERVABLE_TO_ENTER");
    await expect(panel.getByRole("button", /^Accepter/)).toBeDisabled();
    const saved = (await readItems(ui, jobs.Z1)).find((item) => item.id === weld.id)!;
    expect(saved).toMatchObject({ quantity: 2, unit: "u", is_verified: false });
    await recordEvidence(ui.army, "TKR03-unit", { actions, durationMs: Math.round(performance.now() - start),
      line: weld.id, file: saved.source_file_name, result: [saved.quantity, saved.unit], boundary: "Actions automatisées, fiche atelier A-07, aucun chronométrage humain." });

    // The workshop sheet confirms the proposed count. Only the quantity entry attests it.
    await panel.getByLabel("Quantité à saisir", { exact: true }).click();
    const attested = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z1}/items`);
    await ui.browser.keyboard.press("Enter");
    expect((await attested).status).toBe(200);
    await expect(list.getByRole("option", /^Soudures atelier/)).toHaveCount(0);

    await list.getByRole("option", /^ARMY worker pipe/).click();
    await panel.getByRole("button", /^Exclure/).click();
    const dialog = screen.getByRole("dialog", "Exclure 1 item", { exact: true });
    const exclude = dialog.getByRole("button", "Exclure", { exact: true });
    await expect(exclude).toBeDisabled();
    const motif = "Aucune canalisation supplémentaire sur le plan Z1.";
    await dialog.getByLabel("Motif d'exclusion (obligatoire)", { exact: true }).fill(motif);
    await exclude.click();
    await expect(list.getByRole("option", /^ARMY worker pipe/)).toHaveCount(0);

    const ef = async (jobId: string) => (await readItems(ui, jobId)).find((item) => item.designation === ZONE_PLANS.designation)!;
    const first = await ef(jobs.Z1);
    await patchItems(ui, jobs.Z1, [{ item: first, fields: { is_excluded: false } }]);
    await patchItems(ui, jobs.Z2, [{ item: await ef(jobs.Z2), fields: { is_excluded: false } }]);
    expect(zoneCode(await ef(jobs.Z1))).toBe("ZONE_OVERLAP_NONE");
    await patchItems(ui, jobs.Z1, [{ item: await ef(jobs.Z1), fields: { is_verified: true } }]);
    expect((await ef(jobs.Z1)).is_verified).toBe(true);

    // Z2/A ends at the joint. Z2/B replaces it and extends one metre into Z1.
    await patchItems(ui, jobs.Z2, [{ item: await ef(jobs.Z2), fields: { is_excluded: true, exclusion_reason: "Indice A remplacé par B." } }]);
    const revised = await addZone("Z2", "B");
    await patchItems(ui, revised, [{ item: await ef(revised), fields: { is_excluded: false } }]);
    await ui.browser.reload();
    await list.getByRole("option", new RegExp(`^${ZONE_PLANS.designation}`)).click();
    await expect(panel).toContainText("ZONE_OVERLAP_DUPLICATE");
    expect(await ef(jobs.Z1)).toMatchObject({ is_verified: false });
    await panel.getByRole("button", /^Retirer 1,00 m/).click();
    await expect(list.getByRole("option")).toHaveCount(0);
    await ui.browser.reload();
    await expect(list.getByRole("option")).toHaveCount(0);
    await expect(screen.getByText("Aucune ligne à trancher : le contrôle du métré est complet.", { exact: true })).toBeVisible();
    const final = await readItems(ui, jobs.Z1);
    expect(final.find((item) => item.id === weld.id)).toMatchObject({ unit: "u", quantity: 2,
      rule_results: expect.arrayContaining([expect.objectContaining({ code: "NON_OBSERVABLE_ENTERED" })]) });
    expect(final.find((item) => item.designation === "ARMY worker pipe")).toMatchObject({ is_excluded: true, exclusion_reason: motif });
    expect(await ef(jobs.Z1)).toMatchObject({ quantity: 4 });
    expect(await ef(revised)).toMatchObject({ quantity: 3 });
    expect(zoneCode(await ef(jobs.Z1))).toBe("ZONE_OVERLAP_RESOLVED");
    await recordEvidence(ui.army, "TKR03-reopened", { ids, jobs, revised, motif, lengths: [4, 3] });
  });

armyTest("TKR04 complete review preserves an unchanged verification and never reattests on exclusion or inclusion", options,
  async (ui) => {
    const { ids, jobs, owner, client } = await seedZoneJobs(ui, "TKR04", "VRF", "Auteurs de la revue");
    const job = jobs.Z1;
    const readPipe = async () => (await readItems(ui, job)).find((item) => item.designation === "ARMY worker pipe")!;
    const pipe = await readPipe();
    await patchItems(ui, job, [{ item: pipe, fields: { is_verified: true } }]);
    const original = await readPipe();
    expect(original).toMatchObject({ is_verified: true, verified_by: owner.userId });
    const path = `/dashboard/affaires/${ids.projectId}/takeoff/${job}/review`;
    const full = `${path}?versionId=${ids.versionId}&reviewMode=production`;
    const targeted = `${path}/targeted?versionId=${ids.versionId}&line=${pipe.id}`;
    // Only the three fictional accounts and memberships of this owned stack participate.
    const asReviewer = async (tag: string) => {
      const reviewer = await signUpWorkerOwner(ui, tag);
      await querySql(`begin;
        update public.tenant_memberships set is_default=false where user_id='${reviewer.userId}' and tenant_id='${reviewer.tenantId}';
        insert into public.tenant_memberships (user_id,tenant_id,role,is_default)
          values ('${reviewer.userId}','${owner.tenantId}','admin',true);
        commit;`);
      await ui.app.open(full);
      return reviewer.userId;
    };
    const b = await asReviewer("VRFB");
    await ui.screen.getByRole("tab", /^Assisté/).click();
    await expect(ui.screen.getByText(/^Parcourez chaque item/)).toBeVisible();
    await ui.screen.getByRole("tab", /^Production/).click();
    const row = ui.screen.getByRole("row").filter({ hasText: "ARMY worker pipe" });
    // Commit an unchanged cell as B. Saving another actual edit later must not transfer A's signature.
    await row.getByText("m", { exact: true }).click();
    await ui.browser.keyboard.press("F2");
    await ui.browser.keyboard.press("Enter");
    const valve = ui.screen.getByRole("row").filter({ hasText: "ARMY worker valve" });
    await valve.getByText("u", { exact: true }).click();
    await ui.browser.keyboard.press("F2");
    const otherSaved = ui.browser.waitForResponse(`**/api/takeoff/jobs/${job}/items`);
    await valve.getByLabel("Unité", { exact: true }).fill("pièce");
    await ui.browser.keyboard.press("Enter");
    expect((await otherSaved).status).toBe(200);
    await ui.browser.reload();
    expect(await readPipe()).toMatchObject({ is_verified: true, verified_by: owner.userId, verified_at: original.verified_at });
    await expect(row.getByRole("button", "Exclure ARMY worker pipe", { exact: true })).toBeEnabled();
    await row.getByRole("button", "Exclure ARMY worker pipe", { exact: true }).click();
    const dialog = ui.screen.getByRole("dialog", "Exclure 1 item", { exact: true });
    const reason = "Absent du plan Z1.";
    await dialog.getByLabel("Motif d'exclusion (obligatoire)", { exact: true }).fill(reason);
    const saved = ui.browser.waitForResponse(`**/api/takeoff/jobs/${job}/items`);
    await dialog.getByRole("button", "Exclure", { exact: true }).click();
    expect((await saved).status).toBe(200);
    await ui.browser.reload();
    expect(await readPipe()).toMatchObject({ is_excluded: true, exclusion_reason: reason,
      is_verified: false, verified_by: null, verified_at: null });
    const c = await asReviewer("VRFC");
    const included = ui.browser.waitForResponse(`**/api/takeoff/jobs/${job}/items`);
    await row.getByRole("button", "Inclure ARMY worker pipe", { exact: true }).click();
    expect((await included).status).toBe(200);
    await ui.browser.reload();
    expect(await readPipe()).toMatchObject({ is_excluded: false, exclusion_reason: null, is_verified: false, verified_by: null });
    await ui.app.open(targeted);
    const line = ui.screen.getByRole("region", "Décision sur la ligne", { exact: true });
    await expect(line).toContainText("DN_NETWORK_NETWORK_MISSING");
    const applyButton = ui.screen.getByRole("button", "Appliquer au devis", { exact: true });
    await expect(applyButton).toBeDisabled();
    const accepted = ui.browser.waitForResponse(`**/api/takeoff/jobs/${job}/items`);
    await line.getByRole("button", /^Accepter/).click();
    expect((await accepted).status).toBe(200);
    await ui.browser.reload();
    await expect(applyButton).toBeEnabled();
    expect(await readPipe()).toMatchObject({ is_verified: true, verified_by: c });
    const rows = await client.from("audit_logs").select("user_id,action,after_data").eq("record_id", job)
      .in("action", ["takeoff.item.modified", "takeoff.item.excluded"]).order("created_at");
    expect(rows.error).toBeNull();
    const events = (rows.data ?? []).map((event) => ({ actor: event.user_id, action: event.action,
      data: event.after_data.metadata })).filter((event) => event.data.item_id === pipe.id);
    expect(events.filter((event) => event.data.field === "is_verified").map((event) => [event.actor, event.data.previous_value, event.data.next_value]))
      .toEqual([[owner.userId, false, true], [b, true, false], [c, false, true]]);
    expect(events.filter((event) => event.action === "takeoff.item.excluded").map((event) => [event.actor, event.data.reason]))
      .toEqual([[b, reason]]);
    expect(events.filter((event) => event.data.field === "is_excluded").map((event) => [event.actor, event.data.next_value]))
      .toEqual([[c, false]]);
    await recordEvidence(ui.army, "TKR04-verifications", { ids, job, pipe: pipe.id, events });
  });
