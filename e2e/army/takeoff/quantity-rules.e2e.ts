import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, type JsonValue } from "e2e";
import type { Browser } from "@e2e-dev/web";
import * as XLSX from "xlsx";

import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, resolveDownload,
} from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { ownedTakeoffJobs } from "../critical/plans-support";
import { TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS } from "../../../src/lib/takeoff/hypothesis";
import { localTakeoffFixture, localTakeoffWorkerClient } from "./fixtures";
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
async function seedZoneJobs(ui: WorkerUi, journey: string, tag: string, title: string, revision?: "A" | "C") {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const owner = await signUpWorkerOwner(ui, tag);
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${journey}`, title }, ui.army);
  const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} lot plomberie`);
  expect(target.parent_id).toMatch(/^[0-9a-f-]{36}$/i);
  const { client, tenantId } = await localTakeoffWorkerClient(ui.army, ids.versionId, owner.email, owner.password);
  expect(tenantId).toBe(owner.tenantId);
  const jobs: Record<"Z1" | "Z2", string> = { Z1: "", Z2: "" };
  async function addZone(zone: "Z1" | "Z2", revision?: "A" | "B" | "C") {
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

armyTest("TKR01 a run drawn on two zone plans warns with its reason and can be corrected to count once", options,
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

    // TI-681: the duplicate stays explained and localizable, without applying
    // this job before the optional correction exercised by this journey.
    const apply = { strategy: "append", target_section_id: target.parent_id };
    expect(reason?.code).toBe("ZONE_OVERLAP_DUPLICATE");
    await recordEvidence(ui.army, "TKR01-nonblocking-warning", { ids, jobs, itemId: duplicate.id, reason });

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
// a reason (E) on Z1, accepted (V) on Z2. Since TI-682 (D11) the application refuses a measured run beside a length
// the model read on the same page: the stub pipe names no network, nothing proves it is another run (TKQ03 asserts
// the refusal). Z2's accepted pipe is therefore left out before the application; the valve count stays beside the run.
armyTest("TKR02 the targeted review lists a Z1/Z2 duplicate with its reason, the user settles it by keyboard, kept after a reload, counted once", options,
  async (ui) => {
    const { ids, target, jobs, client } = await seedZoneJobs(ui, "TKR02", "RUL2", "Revue ciblée Z1 Z2");
    // The drawings must reveal their overlap while both vector alternatives are still excluded. No setup
    // inclusion may be needed to find the duplicate, and finding it must not retain either quantity.
    const alternatives: Record<string, Item> = {};
    for (const zone of ["Z1", "Z2"] as const) {
      const ef = (await readItems(ui, jobs[zone])).find((item) => item.designation === ZONE_PLANS.designation) as Item;
      expect(ef).toMatchObject({ is_excluded: true, quantity: ZONE_PLANS.zones[zone].length_m });
      expect(ef.rule_results?.find((entry) => entry.rule === "zone_overlap")).toMatchObject({
        code: "ZONE_OVERLAP_DUPLICATE", details: { overlap_m: 1 } });
      alternatives[zone] = ef;
    }
    // The editor's draft lock goes back: the application takes its own from the review.
    expect((await apiRequest<{ data: { released: boolean } }>(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`)).status).toBe(200);
    const screen = ui.screen;
    const targeted = (jobId: string) => `/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review/targeted?versionId=${ids.versionId}`;
    for (const zone of ["Z2", "Z1"] as const) {
      await ui.app.open(`${targeted(jobs[zone])}&line=${alternatives[zone].id}`);
      const candidate = screen.getByRole("region", "Décision sur la ligne", { exact: true });
      await expect(candidate).toContainText("ZONE_OVERLAP_DUPLICATE");
      await expect(candidate).toContainText("Longueur commune à comparer : 1,00 m");
      await expect(candidate.getByRole("button", /^Accepter/)).toBeDisabled();
      await expect(candidate.getByRole("button", /^Retirer/)).toHaveCount(0);
      await ui.browser.reload();
      await expect(candidate).toContainText("Lecture non retenue au devis.");
      expect((await readItems(ui, jobs[zone])).find(item => item.id === alternatives[zone].id))
        .toMatchObject({ is_excluded: true, quantity: ZONE_PLANS.zones[zone].length_m });
      await recordEvidence(ui.army, `TKR02-unselected-${zone}`, { item: alternatives[zone],
        screenshot: await ui.app.screenshot(`takeoff-unselected-overlap-${zone}`) });
      const included = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs[zone]}/items`);
      await candidate.getByRole("button", /^Inclure/).click();
      expect((await included).status).toBe(200);
      expect((await readItems(ui, jobs[zone])).find(item => item.id === alternatives[zone].id)?.is_excluded).toBe(false);
    }

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
    await expect(applyButton).toBeEnabled();
    await expect(screen.getByText("2 lignes à trancher avant l’application.", { exact: true })).toHaveCount(0);

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
    await expect(screen.getByText("1 ligne à trancher avant l’application.", { exact: true })).toHaveCount(0);
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
    await expect(screen.getByText("Aucune recommandation affichée. Vérifiez aussi la couverture du périmètre attendu.", { exact: true })).toBeVisible();
    await expect(applyButton).toBeEnabled();

    // Kept after a reload: nothing left to settle, the line at 4.00 m on the server, both lines settled.
    await ui.browser.reload();
    await expect(screen.getByText("Aucune recommandation affichée. Vérifiez aussi la couverture du périmètre attendu.", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Appliquer au devis", { exact: true })).toBeEnabled();
    const z1 = (await readItems(ui, jobs.Z1)).find((item) => item.designation === ZONE_PLANS.designation);
    expect(z1).toMatchObject({ quantity: 4, is_excluded: false });
    expect(zoneCode(z1)).toBe("ZONE_OVERLAP_RESOLVED");
    expect(zoneCode((await readItems(ui, jobs.Z2)).find((item) => item.designation === ZONE_PLANS.designation))).toBe("ZONE_OVERLAP_RESOLVED");

    // Each job applies through the wizard of its targeted review. Z2's stub line is first accepted by keyboard (V) with
    // its coded reason, then left out: a length the model read on the page of the measured run cannot be applied with it.
    for (const zone of ["Z1", "Z2"] as const) {
      if (zone === "Z2") {
        await ui.app.open(targeted(jobs.Z2));
        await expect(list.getByRole("option")).toHaveCount(1);
        await list.getByRole("option", /^ARMY worker pipe/).click();
        const accepted = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z2}/items`);
        await ui.browser.keyboard.press("v");
        const justification = screen.getByRole("dialog", "Justifier l’acceptation", { exact: true });
        await justification.getByLabel("Motif", { exact: true }).selectOption({ value: "system_documented" });
        await justification.getByLabel("Référence du système", { exact: true }).fill("Fabricant fictif, gamme G, certificat C : ligne vérifiée sur le plan.");
        await justification.getByRole("button", "Confirmer l’acceptation", { exact: true }).click();
        expect((await accepted).status).toBe(200);
        await expect(list.getByRole("option")).toHaveCount(0);
        const pipe = (await readItems(ui, jobs.Z2)).find((item) => item.designation === "ARMY worker pipe") as Item;
        expect(pipe).toMatchObject({ is_verified: true, is_excluded: false });
        await patchItems(ui, jobs.Z2, [{ item: pipe, fields: { is_excluded: true, exclusion_reason: "Lecture du plan écartée : tronçon mesuré retenu." } }]);
        await ui.app.open(targeted(jobs.Z2));
        await expect(screen.getByRole("button", "Appliquer au devis", { exact: true })).toBeEnabled();
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
    // TI-682: the page counts one reading of its lengths, the measured run; the model's pipe never reached the estimate
    // (TKQ01 holds the rounding of a sold length).
    expect(estimate.items.filter((item) => item.title === "ARMY worker pipe")).toEqual([]);
    await recordEvidence(ui.army, "TKR02-applied-once", { ids, jobs, estimateRuns: runs, target: target.parent_id });
  });

armyTest("TKR03 corrects a weld unit without attesting its quantity and reopens a verified run on the revised zone plan", options,
  async (ui) => {
    const { ids, jobs, addZone } = await seedZoneJobs(ui, "TKR03", "REV", "Revue détail unité", "A");
    const { screen } = ui;
    const list = screen.getByRole("listbox", "Lignes à trancher", { exact: true });
    const panel = screen.getByRole("region", "Décision sur la ligne", { exact: true });
    const weld = (await readItems(ui, jobs.Z1)).find((item) => item.designation === "Soudures atelier")!;
    // TI-682 D11: the weld count is an hypothesis; it arrives excluded with its reason, and stays in the list to enter.
    expect(weld).toMatchObject({ quantity: 2, unit: "kg", is_excluded: true,
      exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable });
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

    // TI-686 D12: the former attestation flag is refused with its request (422), never stored as an entry.
    const former = await apiRequest<{ ok: boolean; error?: { code?: string } }>(ui.browser, "PATCH", `/api/takeoff/jobs/${jobs.Z1}/items`,
      { items: [{ item_id: saved.id, updated_at: saved.updated_at, fields: { quantity: 2, quantity_entered: true } }] });
    expect([former.status, former.body.ok, former.body.error?.code]).toEqual([422, false, "VALIDATION_ERROR"]);
    expect((await readItems(ui, jobs.Z1)).find((item) => item.id === weld.id)).toMatchObject({ updated_at: saved.updated_at,
      quantity_entered_by: null, quantity_entry_category: null });

    // The workshop sheet confirms the proposed count. Only the quantity entry attests it, with what it rests on.
    await panel.getByLabel("Quantité à saisir", { exact: true }).click();
    await ui.browser.keyboard.press("Enter");
    const entry = screen.getByRole("dialog", "Justifier la quantité saisie", { exact: true });
    await entry.getByLabel("Justification", { exact: true }).selectOption({ value: "written_confirmation" });
    await entry.getByLabel("Ce qui fonde la quantité", { exact: true }).fill("Fiche atelier A-07");
    const attested = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z1}/items`);
    await entry.getByRole("button", "Enregistrer la quantité", { exact: true }).click();
    expect((await attested).status).toBe(200);
    await expect(list.getByRole("option", /^Soudures atelier/)).toHaveCount(0);
    // Entering the quantity with what it rests on is the decision that includes the line (TI-682 D11).
    expect((await readItems(ui, jobs.Z1)).find((item) => item.id === weld.id)).toMatchObject({ is_excluded: false, exclusion_reason: null,
      quantity_entry_category: "written_confirmation" });

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
    await expect(screen.getByText("Aucune recommandation affichée. Vérifiez aussi la couverture du périmètre attendu.", { exact: true })).toBeVisible();
    const final = await readItems(ui, jobs.Z1);
    expect(final.find((item) => item.id === weld.id)).toMatchObject({ unit: "u", quantity: 2,
      quantity_entry_category: "written_confirmation", quantity_entry_note: "Fiche atelier A-07",
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
    await patchItems(ui, job, [{ item: pipe, fields: { is_verified: true, verification_justification: { reason_code: "system_documented", system_reference: "Fabricant fictif, gamme G, certificat C" } } }]);
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
    await expect(applyButton).toBeEnabled();
    const accepted = ui.browser.waitForResponse(`**/api/takeoff/jobs/${job}/items`);
    await line.getByRole("button", /^Accepter/).click();
    const justification = ui.screen.getByRole("dialog", "Justifier l’acceptation", { exact: true });
    await justification.getByLabel("Motif", { exact: true }).selectOption({ value: "system_documented" });
    await justification.getByLabel("Référence du système", { exact: true }).fill("Fabricant fictif, gamme G, certificat C : confirmé par C.");
    await justification.getByRole("button", "Confirmer l’acceptation", { exact: true }).click();
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

// TI-685: a technical failure needs a coded reason and system reference; V cannot erase it silently.
armyTest("TKR05 network material justification persists and blocked gas cannot be accepted", options, async (ui) => {
  const { ids, client, jobs } = await seedZoneJobs(ui, "TKR05", "MAT", "Justification réseau matériau");
  for (const job of Object.values(jobs)) {
    const items = await readItems(ui, job);
    await patchItems(ui, job, items.map((item) => ({ item, fields: { is_excluded: true, exclusion_reason: "Hors cas matériau fictif." } })));
  }
  const peId = randomUUID();
  const blockedId = randomUUID();
  const items = [
    { id: peId, designation: "GAZ PEHD Ø 32", material: "pehd", dn: "Ø 32" },
    { id: blockedId, designation: "GAZ multicouche Ø 26", material: "multicouche", dn: "Ø 26" },
  ];
  const job = await client.from("takeoff_jobs").select("tenant_id").eq("id", jobs.Z1).single();
  expect(job.error).toBeNull();
  expect((await client.from("takeoff_items").insert(items.map(({ id, designation, material, dn }) => ({
    id, tenant_id: job.data!.tenant_id, job_id: jobs.Z1, designation, quantity: 5, unit: "ml", confidence: 0.95,
    evidence: "Tronçon fictif sur la page 1", source_page: 1, source_file_name: "plan-fictif.pdf", rules_stale: true,
    metadata: { rule_inputs: { version: 1, source: "designation", kind: "network", network: "GAZ", material, dn,
      non_observable: null, model_quantity: 5 } },
  })) as never)).error).toBeNull();
  let pe = (await readItems(ui, jobs.Z1)).find((item) => item.id === peId)!;
  await patchItems(ui, jobs.Z1, [{ item: pe, fields: { quantity: 5 } }]);
  pe = (await readItems(ui, jobs.Z1)).find((item) => item.id === peId)!;
  expect(pe.rule_results?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "fail", acceptable: true });
  const unqualified = await apiRequest<{ data: { failed: number } }>(ui.browser, "PATCH", `/api/takeoff/jobs/${jobs.Z1}/items`,
    { items: [{ item_id: pe.id, updated_at: pe.updated_at, fields: { is_verified: true } }] });
  expect(unqualified.body.data.failed).toBe(1);
  const url = `/dashboard/affaires/${ids.projectId}/takeoff/${jobs.Z1}/review/targeted?versionId=${ids.versionId}`;
  await ui.app.open(`${url}&line=${peId}`);
  await ui.screen.getByRole("button", "Accepter", { exact: false }).click();
  const dialog = ui.screen.getByRole("dialog");
  await expect(dialog.getByRole("heading", "Justifier l’acceptation")).toBeVisible();
  await expect(dialog.getByRole("button", "Confirmer l’acceptation")).toBeDisabled();
  await dialog.getByLabel("Motif").selectOption({ value: "gas_pe_buried_outside" });
  await dialog.getByLabel("Référence du système").fill("Fabricant fictif, gamme G, certificat C, enterré hors emprise");
  await dialog.getByRole("button", "Confirmer l’acceptation").click();
  await expect(ui.screen.getByText("Ligne acceptée avec justification", { exact: true })).toBeVisible();
  await ui.app.open(`${url}&line=${peId}`);
  const stored = await client.from("takeoff_items").select("is_verified,verification_justification").eq("id", peId).single();
  expect(stored.data).toMatchObject({ is_verified: true, verification_justification: { reason_code: "gas_pe_buried_outside" } });
  await ui.app.open(`${url}&line=${blockedId}`);
  await expect(ui.screen.getByRole("button", "Accepter", { exact: false })).toBeDisabled();
  const blocked = (await readItems(ui, jobs.Z1)).find((item) => item.id === blockedId)!;
  expect(blocked.rule_results?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "fail", acceptable: false });
  await recordEvidence(ui.army, "network-material-justification", { peId, blockedId, stored: stored.data, blocked: blocked.rule_results });
});

// TI-686 D9: a cote that contradicts the title block's scale fails every length of its page. V settles it only with a
// coded reason and what was checked; the dialog asks for nothing else, and the quantity stays as read. The model's stub
// pipe names no network (TKR01: its DN rule fails too), so the line here is a run of that page whose network, material
// and DN agree: the scale is its only failure.
armyTest("TKR06 a contradicted scale is accepted with a coded reason and what was checked, the quantity unchanged", options,
  async (ui) => {
    const { ids, client, jobs } = await seedZoneJobs(ui, "TKR06", "SCL", "Échelle contredite", "C");
    // The worker read Z1 revision C with its cote: the page's scale is contradicted.
    const pages = await client.from("takeoff_vector_pages").select("source_file_name,source_page,reading").eq("job_id", jobs.Z1);
    expect(pages.error).toBeNull();
    expect((pages.data ?? []).map((page) => (page.reading as { scale?: { status?: string; reason?: string } }).scale))
      .toEqual([expect.objectContaining({ status: "unverified", reason: "dimension_mismatch" })]);
    const page = pages.data![0]!;
    // Setup only: an EF copper DN 22 run of that page (its upload and page number, no other document named), read again.
    const job = await client.from("takeoff_jobs").select("tenant_id").eq("id", jobs.Z1).single();
    expect(job.error).toBeNull();
    const runId = randomUUID();
    expect((await client.from("takeoff_items").insert({ id: runId, tenant_id: job.data!.tenant_id, job_id: jobs.Z1,
      designation: "EF cuivre DN 22 sous la cote", quantity: 5, unit: "ml", confidence: 0.95,
      evidence: "Tronçon fictif sous la cote 4,00 de la page 1", source_page: page.source_page, source_file_name: page.source_file_name,
      rules_stale: true, metadata: { rule_inputs: { version: 1, source: "designation", kind: "network", network: "EF",
        material: "cuivre", dn: "DN 22", non_observable: null, model_quantity: 5 } } } as never)).error).toBeNull();
    await patchItems(ui, jobs.Z1, [{ item: (await readItems(ui, jobs.Z1)).find((item) => item.id === runId)!, fields: { quantity: 5 } }]);
    const run = (await readItems(ui, jobs.Z1)).find((item) => item.id === runId)!;
    expect(run).toMatchObject({ quantity: 5, rules_stale: false, is_verified: false });
    expect(run.rule_results?.find((entry) => entry.rule === "dn_network")).toMatchObject({ status: "pass", code: "DN_NETWORK_COMPATIBLE" });
    expect(run.rule_results?.filter((entry) => entry.status === "fail")).toEqual([expect.objectContaining({ rule: "scale_dimension",
      code: "SCALE_DIMENSION_MISMATCH", version: 2, acceptable: true })]);

    const bare = await apiRequest<{ ok: boolean; data: { results: Array<{ success: boolean; error?: string }> } }>(ui.browser, "PATCH",
      `/api/takeoff/jobs/${jobs.Z1}/items`, { items: [{ item_id: run.id, updated_at: run.updated_at, fields: { is_verified: true } }] });
    expect([bare.status, bare.body.ok]).toEqual([200, true]);
    expect(bare.body.data.results[0]).toMatchObject({ success: false,
      error: "Une cote de la page contredit l’échelle : un motif codé et ce qui a été vérifié (10 à 500 caractères) sont obligatoires." });

    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobs.Z1}/review/targeted?versionId=${ids.versionId}&line=${run.id}`);
    const panel = ui.screen.getByRole("region", "Décision sur la ligne", { exact: true });
    await expect(panel).toContainText("SCALE_DIMENSION_MISMATCH");
    await expect(panel).toContainText("Accepter (V) exige un motif.");
    await panel.getByRole("button", /^Accepter/).click();
    const dialog = ui.screen.getByRole("dialog");
    await expect(dialog.getByRole("heading", "Justifier l’acceptation")).toBeVisible();
    await expect(dialog.getByLabel("Référence du système")).toHaveCount(0);
    await expect(dialog.getByLabel("Motif de surface")).toHaveCount(0);
    const confirm = dialog.getByRole("button", "Confirmer l’acceptation", { exact: true });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel("Motif d’échelle", { exact: true }).selectOption({ value: "dimension_not_to_scale" });
    const note = "Cote 4,00 du plan Z1 indice C relue : tronçon interrompu, hors échelle.";
    await dialog.getByLabel("Ce qui a été vérifié", { exact: true }).fill(note);
    await confirm.click();
    await expect(ui.screen.getByText("Ligne acceptée avec justification", { exact: true })).toBeVisible();

    const stored = (await readItems(ui, jobs.Z1)).find((item) => item.id === run.id)!;
    expect(stored).toMatchObject({ is_verified: true, quantity: 5,
      verification_justification: { scale_dimension: { reason_code: "dimension_not_to_scale", note } } });
    await recordEvidence(ui.army, "TKR06-scale-reason", { ids, jobs, run: run.id, page: { source_file_name: page.source_file_name,
      source_page: page.source_page }, failure: run.rule_results, stored: stored.verification_justification ?? null });
  });

// TI-686 D12: a quantity the plan cannot show is entered with what it rests on; an hypothesis says what it assumes
// and what remains to confirm. The complete review never enters a quantity still to enter by a bare edit: it sends it
// to the targeted review, unsaved, where it is justified.
armyTest("TKR07 the complete review sends a weld count to the targeted review, where an hypothesis says what it assumes", options,
  async (ui) => {
    const { ids, jobs } = await seedZoneJobs(ui, "TKR07", "HYP", "Saisie sur hypothèse", "A");
    const { screen } = ui;
    const panel = screen.getByRole("region", "Décision sur la ligne", { exact: true });
    const weld = (await readItems(ui, jobs.Z1)).find((item) => item.designation === "Soudures atelier")!;
    expect(weld).toMatchObject({ quantity: 2, unit: "kg", quantity_entry_category: null, is_excluded: true,
      exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable });

    // The complete review: a new count typed on the line leads to the targeted review, unsaved.
    await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobs.Z1}/review?versionId=${ids.versionId}&reviewMode=production`);
    const row = screen.getByRole("row").filter({ hasText: "Soudures atelier" });
    // The line's quantity cell, by its grid identity (row id and column), never by a text another cell could show.
    await ui.browser.locator(`[data-cell-id="${weld.id}::quantity"]`).click();
    await ui.browser.keyboard.press("F2");
    await row.getByLabel("Quantité", { exact: true }).fill("6");
    await expect(screen.getByText("Une quantité à saisir se justifie dans la revue ciblée.", { exact: true })).toBeVisible();
    await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/affaires/${ids.projectId}/takeoff/${jobs.Z1}/review/targeted\\?`
      + `versionId=${ids.versionId}&line=${weld.id}$`));
    await expect(panel).toContainText("NON_OBSERVABLE_TO_ENTER");
    expect((await readItems(ui, jobs.Z1)).find((item) => item.id === weld.id)).toMatchObject({ quantity: 2,
      updated_at: weld.updated_at, quantity_entry_category: null });
    await recordEvidence(ui.army, "TKR07-redirected", { ids, jobs, line: weld.id });

    // The targeted review: F2, 6, Enter, then what the count rests on. An hypothesis without its note is not saved.
    await ui.browser.keyboard.press("F2");
    await ui.browser.keyboard.press("6");
    await expect(panel.getByLabel("Quantité à saisir", { exact: true })).toHaveValue("6");
    await ui.browser.keyboard.press("Enter");
    const dialog = screen.getByRole("dialog", "Justifier la quantité saisie", { exact: true });
    const save = dialog.getByRole("button", "Enregistrer la quantité", { exact: true });
    await dialog.getByLabel("Justification", { exact: true }).selectOption({ value: "hypothesis" });
    await expect(save).toBeDisabled();
    const assumed = "6 soudures supposées : 3 piquages × 2, à confirmer au relevé.";
    await dialog.getByLabel("Ce qui fonde la quantité", { exact: true }).fill(assumed);
    await expect(save).toBeEnabled();
    const entered = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobs.Z1}/items`);
    await save.click();
    expect((await entered).status).toBe(200);
    const stored = (await readItems(ui, jobs.Z1)).find((item) => item.id === weld.id)!;
    // An hypothesis its reviewer entered and justified is included by that decision (TI-682 D11); it reaches the
    // estimate as an internal provision (TI-686 D12).
    expect(stored).toMatchObject({ quantity: 6, quantity_entry_category: "hypothesis", quantity_entry_note: assumed,
      is_excluded: false, exclusion_reason: null,
      rule_results: expect.arrayContaining([expect.objectContaining({ code: "NON_OBSERVABLE_ENTERED" })]) });
    await recordEvidence(ui.army, "TKR07-hypothesis", { ids, jobs, line: weld.id, quantity: stored.quantity,
      category: stored.quantity_entry_category ?? null, note: stored.quantity_entry_note ?? null });
  });

// TI-682 lot C: an estimate (metadata.quantity_nature « estimated ») arrives excluded as an hypothesis (lot B). Its
// reviewer includes it with « I » in the targeted review, without entering its quantity, and applies the job: the line
// reaches the estimate as an hypothesis provision. The internal line truth and the internal CSV say « Hypothèse » and why;
// the line measured beside it stays measured; the printed estimate shows an ordinary priced line (H9). No worker: the
// job is seeded as the worker writes it, and the insert trigger excludes the estimate.
armyTest("TKR08 an estimate included with I, without entry, reaches the estimate as an hypothesis in its line truth and the CSV", options,
  async (ui) => {
    const { app, screen, browser, army } = ui;
    await browser.emulateMedia({ reducedMotion: "reduce" });
    const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-TKR08`, title: "Inclusion sans saisie" }, army);
    const target = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} lot supports`);
    expect(target.parent_id).toMatch(/^[0-9a-f-]{36}$/i);
    const estimated = `${army.runPrefix} Supports estimés`;
    const measured = `${army.runPrefix} Vannes relevées`;
    const seed = await (await localTakeoffFixture(army, ids)).seed("B", [
      { designation: estimated, quantity: 14, unit: "u", confidence: 0.9, metadata: { quantity_nature: "estimated" } },
      { designation: measured, quantity: 3, unit: "u", confidence: 0.9 },
    ]);
    const arrived = await readItems(ui, seed.jobId);
    const line = (designation: string) => arrived.find((item) => item.designation === designation)!;
    expect([estimated, measured].map((designation) => ({ designation, is_excluded: line(designation).is_excluded,
      exclusion_reason: line(designation).exclusion_reason, quantity_entry_category: line(designation).quantity_entry_category })))
      .toEqual([
        { designation: estimated, is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated,
          quantity_entry_category: null },
        { designation: measured, is_excluded: false, exclusion_reason: null, quantity_entry_category: null },
      ]);

    // The targeted review: the estimate is listed as an hypothesis; « I » includes it, unentered.
    expect((await apiRequest<{ data: { released: boolean } }>(browser, "DELETE", `/api/estimates/${ids.versionId}/lock`)).status).toBe(200);
    await app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${seed.jobId}/review/targeted?versionId=${ids.versionId}`);
    await expect(screen.getByRole("heading", "Revue ciblée", { exact: true })).toBeVisible();
    const list = screen.getByRole("listbox", "Lignes à trancher", { exact: true });
    const option = list.getByRole("option", new RegExp(`^${estimated}`));
    await expect(option).toContainText("Hypothèse");
    await option.click();
    await expect(screen.getByRole("region", "Décision sur la ligne", { exact: true }))
      .toContainText(TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.estimated);
    const included = browser.waitForResponse(`**/api/takeoff/jobs/${seed.jobId}/items`);
    await browser.keyboard.press("i");
    expect((await included).status).toBe(200);
    await expect(list.getByRole("option", new RegExp(`^${estimated}`))).toHaveCount(0);
    const decided = (await readItems(ui, seed.jobId)).find((item) => item.designation === estimated)!;
    expect(decided).toMatchObject({ quantity: 14, is_excluded: false, exclusion_reason: null, quantity_entry_category: null,
      quantity_entry_note: null });
    await recordEvidence(army, "TKR08-included", { ids, jobId: seed.jobId, line: decided.id, quantity: decided.quantity,
      category: decided.quantity_entry_category ?? null });

    // Applied through the wizard of the targeted review.
    await screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
    const wizard = screen.getByRole("dialog", "Appliquer au devis", { exact: true });
    await wizard.getByLabel("Section cible", { exact: true }).selectOption({ value: String(target.parent_id) });
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    await wizard.getByRole("radio", /^Ajouter sans effacer/).check();
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    await expect(wizard).toContainText(estimated);
    await wizard.getByRole("button", "Suivant", { exact: true }).click();
    const applied = browser.waitForResponse(`**/api/takeoff/jobs/${seed.jobId}/apply`);
    await wizard.getByRole("button", "Confirmer l'application", { exact: true }).click();
    const response = await applied;
    const body = await response.json<Envelope<{ job: { status: string } }>>();
    await recordEvidence(army, "TKR08-applied", { ids, jobId: seed.jobId, status: response.status, job: body.data?.job ?? null,
      errorCode: body.error?.code ?? null });
    expect([response.status, body.data?.job?.status]).toEqual([200, "applied"]);
    await expect(wizard).toBeHidden();

    // The line truth of the internal estimate: « Hypothèse », because the quantity is estimated and was not entered.
    const estimate = await readEstimate(browser, ids.versionId);
    const truth = (title: string) => (estimate.items.find((item) => item.title === title)?.line_truth as
      { qtyStatus?: { code?: string; label?: string; detail?: string } } | null | undefined)?.qtyStatus;
    expect(estimate.items.filter((item) => item.title === estimated).map((item) => Number(item.quantity))).toEqual([14]);
    expect(truth(estimated)).toEqual({ code: "hypothesis", label: "Hypothèse",
      detail: "Quantité estimée au métré, sans mesure sur un plan, comptée sans saisie : provision à confirmer ; le client voit une "
        + "ligne ordinaire." });
    expect(truth(measured)?.code).toBe("measured");
    await recordEvidence(army, "TKR08-line-truth", { ids, lines: [estimated, measured].map((title) => ({ title, qtyStatus: truth(title) ?? null })) });

    // The internal CSV the editor downloads names the estimate « Hypothèse »; the measured line and the line created by
    // hand stay empty.
    await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible({ timeout: 60_000 });
    const exportMenu = screen.getByRole("button", "Exporter", { exact: true });
    await expect(exportMenu).toBeEnabled({ timeout: 30_000 });
    await exportMenu.tap();
    const csvItem = screen.getByRole("button", "Fichier CSV (.csv)", { exact: true });
    await expect(csvItem).toBeEnabled({ timeout: 30_000 });
    const csvFile = await browser.waitForDownload(() => csvItem.tap(), { timeout: 60_000 });
    const csvPath = await resolveDownload(csvFile);
    const csvBytes = await readFile(csvPath);
    const book = XLSX.read(csvBytes, { type: "buffer", raw: true, FS: ";" });
    const rows = XLSX.utils.sheet_to_json<string[]>(book.Sheets[book.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const header = (rows[0] ?? []).map((cell) => String(cell));
    const provisionOf = (title: string) =>
      rows.find((row) => row[header.indexOf("Désignation")] === title)?.[header.indexOf("Provision métré")] ?? null;
    const titles = [estimated, measured, `${army.runPrefix} lot supports`];
    const csv = { column: header.at(-1) ?? null, lines: titles.map((title) => [title, provisionOf(title)]) };
    await recordEvidence(army, "TKR08-csv", { ids, engine: estimate.version.calc_engine_version, path: csvPath,
      bytes: csvBytes.length, csv });
    expect(csv).toEqual({ column: "Provision métré", lines: [[titles[0], "Hypothèse"], [titles[1], ""], [titles[2], ""]] });

    // The printed estimate: an ordinary priced line, never the hypothesis (H9).
    await browser.goto(`/dashboard/estimates/${ids.versionId}/print?price_mode=unit_and_total&detail_level=lines`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible();
    const printed = await browser.evaluate(() => Array.from(document.querySelectorAll(".estimate-document"))
      .filter((element) => element.getClientRects().length > 0).map((element) => element.textContent ?? "").join(" "));
    await recordEvidence(army, "TKR08-print", { versionId: ids.versionId, printed });
    expect(printed).toContain(estimated);
    expect(printed).not.toMatch(/Provision interne|Hypothèse|provision à confirmer|forç|dérogation/);
  });
