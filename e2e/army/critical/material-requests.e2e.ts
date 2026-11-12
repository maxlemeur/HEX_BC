import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  recordEvidence,
} from "./fixtures";

type Envelope<T> = {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: { blocked?: Array<{ id: string; codes: string[] }> } };
};
type Line = {
  id: string; position: number; original_text: string | null; quantity: number | null; unit: string | null;
  dimension: string | null; product_type: string | null; reference: string | null; material: string | null;
  duplicate_acknowledged: boolean; status: "draft" | "validated";
};
type Detail = {
  request: { id: string; presumed_material: string | null; material_confirmed: boolean };
  files: Array<{ id: string; file_name: string; mime_type: string; byte_size: number; rotation: number }>;
  lines: Line[];
};

// TI-690, delivery 2. Failure modes, written before the journey was first run against the product:
// - the pasted message is lost, or its pre-reading invents a quantity, a size or a material;
// - a line with a missing size, an unconfirmed presumed material or a possible duplicate is validated,
//   or one blocked line holds back the lines that are ready;
// - confirming the presumed material does not release the lines that were only waiting for it;
// - the possible duplicate is merged or dismissed for both lines at once;
// - editing a validated line leaves it validated although it no longer says what was validated;
// - changing or un-confirming the presumed material leaves validated the lines that relied on it;
// - the message to the technician asks about a greeting or a note, or misses a question;
// - deleting an original or a request leaves bytes behind or fails against the storage guards;
// - the stored photo is not the photo that was dropped (it goes straight to storage, never through the
//   application: request bodies are capped by the proxy and the hosting platform), it is listed before its
//   bytes are there, its rotation is not kept, or a HEIC photo is accepted and then cannot be displayed.

// A 1x1 PNG, generated here: no real photograph in a public repository.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// An invented message, in the shape technicians write: a greeting, quantities before or after the article,
// three ways of writing a size, a reference, the same line twice, and a note about the whole sheet.
const MESSAGE = [
  "Bonjour, pour le local technique :",
  "60 vanne eau chaude m/f rouge 20/27",
  "coude 25 90° - 30 pièces",
  "Tube DN 32 - 24 ml",
  "goujon M12 ref = 471205 x 150",
  "120 écrous",
  "120 écrous",
  "Tous les tubes en cuivre",
].join("\n");

armyTest(
  "MR01 a pasted request becomes clean lines: what is missing blocks its own line, never the others",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} demandes de matériel`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;

    const technicianName = `${army.runPrefix} Karim`;
    const technician = await apiRequest<Envelope<{ item: { id: string } }>>(
      browser, "POST", "/api/material-request-technicians", { name: technicianName, current_project_id: ids.projectId },
    );
    expect(technician.status).toBe(201);
    const sameName = await apiRequest<Envelope<never>>(
      browser, "POST", "/api/material-request-technicians", { name: `  ${technicianName.toUpperCase()} ` },
    );
    expect(sameName.status).toBe(409);

    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, {
      technician_id: technician.body.data.item.id,
      source_text: MESSAGE,
      presumed_material: "Cuivre",
      is_urgent: true,
    });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    expect(created.body.data.request.material_confirmed).toBe(false);

    const read = async () => {
      const response = await apiRequest<Envelope<Detail>>(browser, "GET", `${base}/${requestId}`);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    const statuses = (detail: Detail) => detail.lines.map((line) => line.status);

    // The screen: the message stays verbatim beside the work, and is pre-read on request only.
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByText("Message reçu", { exact: true })).toBeVisible({ timeout: 60_000 });
    expect((await read()).lines).toEqual([]);
    await screen.getByRole("button", "Découper le texte en lignes", { exact: true }).tap();
    await expect.poll(async () => (await read()).lines.length, { timeout: 30_000 }).toBe(8);

    const split = await read();
    expect(split.lines.map((line) => [
      line.position, line.original_text, line.quantity, line.unit, line.dimension, line.product_type, line.reference, line.material,
    ])).toEqual([
      [1, "Bonjour, pour le local technique :", null, null, null, null, null, null],
      [2, "60 vanne eau chaude m/f rouge 20/27", 60, "u", "20/27", "vanne eau chaude m/f rouge", null, null],
      [3, "coude 25 90° - 30 pièces", 30, "u", null, "coude 25 90°", null, null],
      [4, "Tube DN 32 - 24 ml", 24, "ml", "DN 32", "Tube", null, null],
      [5, "goujon M12 ref = 471205 x 150", 150, "u", "M12", "goujon", "471205", null],
      [6, "120 écrous", 120, "u", null, "écrous", null, null],
      [7, "120 écrous", 120, "u", null, "écrous", null, null],
      [8, "Tous les tubes en cuivre", null, null, null, null, null, null],
    ]);
    expect(statuses(split)).toEqual(Array(8).fill("draft"));
    const id = (position: number) => split.lines.find((line) => line.position === position)!.id;

    // Nothing can be validated while the presumed material is only a proposal, and the refusal says why.
    const refused = await apiRequest<Envelope<never>>(browser, "POST", `${base}/${requestId}/lines/validate`, {
      ids: [id(2), id(3), id(6)],
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe("MATERIAL_REQUEST_LINES_BLOCKED");
    expect(refused.body.error?.details?.blocked).toEqual([
      { id: id(2), codes: ["material_unconfirmed"] },
      { id: id(3), codes: ["dimension_missing", "material_unconfirmed"] },
      { id: id(6), codes: ["dimension_missing", "material_unconfirmed", "possible_duplicate"] },
    ]);
    expect(statuses(await read())).toEqual(Array(8).fill("draft"));

    // Confirming the material releases exactly the lines that only waited for it.
    await expect(screen.getByRole("button", "Valider les lignes sans alerte (0)", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Confirmer la matière", { exact: true }).tap();
    await expect.poll(async () => (await read()).request.material_confirmed, { timeout: 30_000 }).toBe(true);
    const validateReady = screen.getByRole("button", "Valider les lignes sans alerte (3)", { exact: true });
    await expect(validateReady).toBeVisible({ timeout: 15_000 });
    await validateReady.tap();
    await expect.poll(async () => statuses(await read()), { timeout: 30_000 }).toEqual([
      "draft", "validated", "draft", "validated", "validated", "draft", "draft", "draft",
    ]);

    // The office fills in what it knows: the line is then ready, alone.
    const size = screen.getByLabel("DN / dimension, ligne 3", { exact: true });
    await size.fill("DN25");
    await size.press("Enter");
    await expect.poll(async () => (await read()).lines[2].dimension, { timeout: 30_000 }).toBe("DN25");
    await screen.getByRole("button", "Valider la ligne 3", { exact: true }).tap();
    await expect.poll(async () => (await read()).lines[2].status, { timeout: 30_000 }).toBe("validated");

    // A possible duplicate is kept one line at a time, never merged.
    await screen.getByRole("button", "Doublon : garder la ligne 7", { exact: true }).tap();
    await expect.poll(async () => (await read()).lines[6].duplicate_acknowledged, { timeout: 30_000 }).toBe(true);
    const stillBlocked = await apiRequest<Envelope<never>>(browser, "POST", `${base}/${requestId}/lines/validate`, {
      ids: [id(6), id(7)],
    });
    expect(stillBlocked.status).toBe(422);
    expect(stillBlocked.body.error?.details?.blocked).toEqual([
      { id: id(6), codes: ["dimension_missing", "possible_duplicate"] },
      { id: id(7), codes: ["dimension_missing"] },
    ]);
    expect((await read()).lines).toHaveLength(8);

    // The message asks the technician only what he alone knows, about named articles only.
    await screen.getByRole("button", "Message au technicien", { exact: true }).tap();
    await expect(screen.getByLabel("Message à envoyer", { exact: true })).toHaveValue([
      `Bonjour ${technicianName}, il me manque quelques précisions pour ta demande :`,
      "- écrous : quelle dimension ?",
      "- écrous : quelle dimension ?",
      "Merci !",
    ].join("\n"));
    await browser.keyboard.press("Escape");

    // A validated line that is edited goes back to draft: it no longer says what was validated.
    const edited = await apiRequest<Envelope<{ line: Line }>>(
      browser, "PATCH", `${base}/${requestId}/lines/${id(2)}`, { quantity: 45 },
    );
    expect(edited.status).toBe(200);
    expect([edited.body.data.line.quantity, edited.body.data.line.status]).toEqual([45, "draft"]);

    // Withdrawing the confirmation of the material takes back the validations that rested on it.
    expect(statuses(await read())).toEqual([
      "draft", "draft", "validated", "validated", "validated", "draft", "draft", "draft",
    ]);
    const withdrawn = await apiRequest<Envelope<{ request: Detail["request"]; reopened_line_ids: string[] }>>(
      browser, "PATCH", `${base}/${requestId}`, { material_confirmed: false },
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.data.request.material_confirmed).toBe(false);
    expect([...withdrawn.body.data.reopened_line_ids].sort()).toEqual([id(3), id(4), id(5)].sort());
    expect(statuses(await read())).toEqual(Array(8).fill("draft"));
    const unconfirmed = await apiRequest<Envelope<never>>(browser, "POST", `${base}/${requestId}/lines/validate`, {
      ids: [id(4)],
    });
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.error?.details?.blocked).toEqual([{ id: id(4), codes: ["material_unconfirmed"] }]);

    // The original: the stored photo is the dropped photo, its rotation is kept, HEIC is refused in words.
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
    await mkdir(directory, { recursive: true });
    const photo = path.join(directory, "demande-papier.png");
    const heic = path.join(directory, "demande-papier.heic");
    await writeFile(photo, PNG);
    await writeFile(heic, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(12)]));
    const picker = browser.locator('input[type="file"][aria-label="Photos à ajouter"]').first();
    await picker.setInputFiles([photo]);
    await expect.poll(async () => (await read()).files.length, { timeout: 60_000 }).toBe(1);
    const [stored] = (await read()).files;
    expect([stored.file_name, stored.mime_type, stored.byte_size, stored.rotation]).toEqual([
      "demande-papier.png", "image/png", PNG.length, 0,
    ]);
    const storedSha = await browser.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      return [response.status, [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")];
    }, `${base}/${requestId}/files/${stored.id}`);
    expect(storedSha).toEqual([200, createHash("sha256").update(PNG).digest("hex")]);

    await screen.getByRole("button", "Tourner à droite", { exact: true }).tap();
    await expect.poll(async () => (await read()).files[0].rotation, { timeout: 30_000 }).toBe(90);

    // One large photo, or four ordinary ones, exceed what a request body may carry through the application:
    // the bytes travel straight to storage, and what is stored is still exactly what was dropped.
    const large = path.join(directory, "demande-grande.png");
    const largeBytes = Buffer.concat([PNG.subarray(0, 33), Buffer.alloc(12 * 1024 * 1024, 7)]);
    await writeFile(large, largeBytes);
    await picker.setInputFiles([large]);
    await expect.poll(async () => (await read()).files.length, { timeout: 120_000 }).toBe(2);
    const largeStored = (await read()).files.find((file) => file.file_name === "demande-grande.png")!;
    expect(largeStored.byte_size).toBe(largeBytes.length);
    const largeSha = await browser.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      return [response.status, [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")];
    }, `${base}/${requestId}/files/${largeStored.id}`);
    expect(largeSha).toEqual([200, createHash("sha256").update(largeBytes).digest("hex")]);

    await picker.setInputFiles([heic]);
    await expect(screen.getByText(
      "Les photos HEIC ne sont pas encore prises en charge : enregistrez la photo en JPEG, puis déposez-la à nouveau.",
      { exact: true },
    ).first()).toBeVisible({ timeout: 30_000 });
    expect((await read()).files).toHaveLength(2);

    const final = await read();

    // Removing an original removes its bytes with it, and removing the request removes the rest: the
    // application withdraws the row, deletes the object, then the row, against the real storage guards.
    const removed = await apiRequest<Envelope<{ deleted: boolean }>>(
      browser, "DELETE", `${base}/${requestId}/files/${stored.id}`,
    );
    expect([removed.status, removed.body.data?.deleted]).toEqual([200, true]);
    expect((await apiRequest(browser, "GET", `${base}/${requestId}/files/${stored.id}`)).status).toBe(404);
    expect((await read()).files.map((file) => file.id)).toEqual([largeStored.id]);
    const requestRemoved = await apiRequest<Envelope<{ deleted: boolean }>>(browser, "DELETE", `${base}/${requestId}`);
    expect([requestRemoved.status, requestRemoved.body.data?.deleted]).toEqual([200, true]);
    expect((await apiRequest(browser, "GET", `${base}/${requestId}`)).status).toBe(404);
    expect((await apiRequest(browser, "GET", `${base}/${requestId}/files/${largeStored.id}`)).status).toBe(404);

    await recordEvidence(army, "material-requests", {
      ...ids, requestId, statuses: statuses(final), files: final.files, refused: refused.body.error,
      stillBlocked: stillBlocked.body.error,
    });
  },
);
