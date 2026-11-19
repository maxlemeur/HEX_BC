import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "@e2e-dev/web";
import { expect, type App } from "e2e";
import { z } from "zod";
import { createEmptyTakeoffPreparation } from "@/lib/takeoff/preparation";
import { querySql } from "../local/calculation-gate-support";
import { callServerAction, confirmTakeoffPreparationViaAction, serverActionId } from "../local/engine-v3-creators-support";

/** The level-A upload API still accepts a confirmed preparation. Exercise it from an owned affaire. */
export async function submitPreparedCsv(
  ui: { app: App; browser: Browser },
  ids: { projectId: string; versionId: string },
  filePath: string,
  provider: "chatgpt" | "auto",
  manifest?: string,
) {
  const projectId = z.uuid().parse(ids.projectId);
  const versionId = z.uuid().parse(ids.versionId);
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
  const text = await readFile(filePath, "utf8");
  const name = path.basename(filePath);
  const hash = createHash("sha256").update(text).digest("hex");
  const draft = createEmptyTakeoffPreparation({ estimateVersionId: versionId });
  draft.objective = "extract_quantities";
  draft.objective_confirmed = true;
  draft.scope = { ...draft.scope, inclusions: ["Toutes les lignes du fichier"], confirmed: true };
  draft.sources = [{ document_id: `upload:${hash}`, document_name: name, kind: "plan", revision: "A",
    source_version: hash, content_hash: hash, pages: [], active: true, confirmed: true, plan_set_id: null,
    file_path: null, page_count: null, logical_document_id: null, source_updated_at: null, mime_type: "text/csv", page_triage: null }];
  draft.conventions = { ...draft.conventions, unit: "Unités des lignes sources", measurement_basis: "documented", confirmed: true };
  draft.destination.confirmed = true;
  draft.processing = { level: "A", provider };
  const rows = await querySql(`SELECT revision FROM public.takeoff_preparations WHERE project_id='${projectId}'
    AND EXISTS (SELECT 1 FROM public.estimate_versions v WHERE v.id='${versionId}' AND v.project_id='${projectId}');`);
  const expectedRevision = rows.length ? Number(rows[0]) : null;
  const saved = await callServerAction(ui.browser, await serverActionId("saveTakeoffPreparationAction", manifest),
    { projectId, draft, expectedRevision });
  expect(saved).toMatchObject({ ok: true, status: 200 });
  const confirmation = await confirmTakeoffPreparationViaAction(ui.browser, {
    actionId: await serverActionId("confirmTakeoffPreparationAction", manifest),
    projectId, expectedRevision: (expectedRevision ?? 0) + 1,
  });
  expect(confirmation.ok).toBe(true);
  return ui.browser.evaluate(async input => {
    const form = new FormData();
    form.set("file", new File([input.text], input.name, { type: "text/csv" }));
    form.set("estimate_version_id", input.versionId);
    form.set("preparation_revision", String(input.revision));
    form.set("level", "A");
    form.set("provider", input.provider);
    const created = await fetch("/api/takeoff/jobs", {
      method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: form,
    });
    const body = await created.json() as { data?: { id: string }; error?: { code: string; message: string } };
    return { status: created.status, id: body.data?.id ?? null,
      code: body.error?.code ?? null, message: body.error?.message ?? null };
  }, { text, name, versionId, revision: confirmation.revision, provider });
}
