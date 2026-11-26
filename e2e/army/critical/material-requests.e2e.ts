import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import ExcelJS from "exceljs";

import { MATERIAL_REQUEST_WORKBOOK_MIME_TYPE, type MaterialRequestFileUploads } from "@/lib/material-requests/contracts";

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

armyTest(
  "MR12 selected draft lines can be deleted together while other lines are kept",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ids = await createEstimateViaWizard({ app, screen, browser }, {
      projectName: army.projectName,
      title: `${army.runPrefix} suppression de lignes`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;
    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, {
      source_text: "Demande initiale à conserver.",
    });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const requestPath = `${base}/${requestId}`;
    const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${requestPath}/lines`, {
      lines: [
        { quantity: 2, unit: "u", product_type: "Coude", dimension: "DN 15", material: "Cuivre" },
        { quantity: 3, unit: "u", product_type: "Manchon", dimension: "DN 20", material: "Cuivre" },
        { quantity: 4, unit: "u", product_type: "Vanne", dimension: "DN 25", material: "Cuivre" },
        { quantity: 5, unit: "u", product_type: "Té", dimension: "DN 32", material: "Cuivre" },
      ],
    });
    expect(added.status).toBe(201);
    const [first, second, validated, other] = added.body.data.lines;
    const validation = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${requestPath}/lines/validate`, {
      ids: [validated.id],
    });
    expect(validation.status).toBe(200);
    const refused = await apiRequest<Envelope<never>>(browser, "POST", `${requestPath}/lines/delete`, {
      ids: [first.id, validated.id],
    });
    expect(refused.status).toBe(409);
    expect(refused.body.error?.code).toBe("MATERIAL_REQUEST_LINES_KEPT");

    const read = async () => {
      const response = await apiRequest<Envelope<Detail>>(browser, "GET", requestPath);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    const page = `/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`;
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    await screen.getByRole("checkbox", "Sélectionner la ligne 1", { exact: true }).check({ timeout: 60_000 });
    await screen.getByRole("checkbox", "Sélectionner la ligne 2", { exact: true }).check();
    const selection = screen.getByRole("button", "Supprimer la sélection", { exact: true });
    const confirmation = screen.getByRole("alertdialog", "Supprimer 2 lignes ?", { exact: true });
    await selection.tap();
    await confirmation.getByRole("button", "Annuler", { exact: true }).tap();
    expect((await read()).lines.map((line) => line.id)).toEqual([first.id, second.id, validated.id, other.id]);
    await selection.tap();
    await confirmation.getByRole("button", "Supprimer", { exact: true }).tap();
    const retained = [[validated.id, 3, 4, "validated"], [other.id, 4, 5, "draft"]];
    await expect.poll(async () => (await read()).lines.map((line) => [
      line.id, line.position, line.quantity, line.status,
    ]), { timeout: 30_000 }).toEqual(retained);
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("checkbox", "Sélectionner la ligne 4", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByRole("checkbox", "Sélectionner la ligne 1", { exact: true })).toHaveCount(0);
    await expect(screen.getByRole("checkbox", "Sélectionner la ligne 2", { exact: true })).toHaveCount(0);
    expect((await read()).request).toMatchObject({ source_text: "Demande initiale à conserver." });
    await recordEvidence(army, "material-request-bulk-delete", {
      selected: [first.id, second.id],
      retained,
      validatedRefusal: refused.status,
    });
  },
);

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
//   bytes are there, or its rotation is not kept;
// - an iPhone HEIC photo is refused, stored as HEIC (unreadable in most browsers), or converted into
//   something other than the photo; an unreadable HEIC is stored anyway or blocks the screen silently.

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

    // The original keeps the message verbatim and only splits it on request.
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`, { waitUntil: "domcontentloaded" });
    const showOriginal = screen.getByRole("button", "Voir l’original", { exact: true });
    const original = screen.getByRole("dialog", "Original de la demande", { exact: true });
    await showOriginal.tap({ timeout: 60_000 });
    await expect(original.getByRole("heading", "Message reçu", { exact: true })).toBeVisible();
    expect((await read()).lines).toEqual([]);
    await original.getByRole("button", "Découper le texte en lignes", { exact: true }).tap();
    await expect.poll(async () => (await read()).lines.length, { timeout: 30_000 }).toBe(8);
    await original.getByRole("button", "Fermer", { exact: true }).tap();

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
    // No cell carries a duplicate: the line says it once unfolded, where it is kept.
    await screen.getByRole("button", "Détails de la ligne 7", { exact: true }).tap();
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

    // The original: the stored photo is the dropped photo, its rotation is kept, HEIC is converted to JPEG.
    await showOriginal.tap();
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
    await mkdir(directory, { recursive: true });
    const photo = path.join(directory, "demande-papier.png");
    const heic = path.join(directory, "demande-abimee.heic");
    await writeFile(photo, PNG);
    await writeFile(heic, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(12)]));
    const picker = browser.locator('input[type="file"][aria-label="Fichiers à ajouter"]').first();
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

    await original.getByRole("button", "Tourner à droite", { exact: true }).tap();
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

    // An iPhone photo: a real HEIC (e2e/fixtures/material-requests/papier-carreaux.heic, 160 x 120, an invented
    // sheet of squared paper made with macOS `sips -s format heic`). The screen converts it to JPEG in the
    // browser; the JPEG is what is announced, stored and served.
    await picker.setInputFiles([path.resolve("e2e/fixtures/material-requests/papier-carreaux.heic")]);
    await expect.poll(async () => (await read()).files.length, { timeout: 120_000 }).toBe(3);
    const converted = (await read()).files.find((file) => file.file_name === "papier-carreaux.jpg")!;
    expect(converted.mime_type).toBe("image/jpeg");
    const convertedRead = await browser.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      const blob = await response.blob();
      const head = Array.from(new Uint8Array(await blob.slice(0, 3).arrayBuffer()));
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      // A blue "written" band of the invented sheet, and its paper: the JPEG shows the photo.
      const ink = Array.from(context.getImageData(60, 24, 1, 1).data.slice(0, 3));
      const paper = Array.from(context.getImageData(5, 5, 1, 1).data.slice(0, 3));
      return { status: response.status, type: response.headers.get("content-type"), head, width: bitmap.width, height: bitmap.height, ink, paper };
    }, `${base}/${requestId}/files/${converted.id}`);
    expect([convertedRead.status, convertedRead.type, convertedRead.head, convertedRead.width, convertedRead.height])
      .toEqual([200, "image/jpeg", [0xff, 0xd8, 0xff], 160, 120]);
    expect(convertedRead.ink[2]).toBeGreaterThan(convertedRead.ink[0] + 50);
    expect(Math.min(...convertedRead.paper)).toBeGreaterThan(220);

    // A HEIC that cannot be read is refused in words, and nothing of it is stored.
    await picker.setInputFiles([heic]);
    await expect(screen.getByText(
      "« demande-abimee.heic » n’a pas pu être convertie en JPEG. Aucune pièce n’a été gardée : enregistrez-la en JPEG sur le téléphone, puis déposez-la à nouveau.",
      { exact: true },
    ).first()).toBeVisible({ timeout: 60_000 });
    expect((await read()).files).toHaveLength(3);

    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Matériel").addRows([["Article", "Quantité"], ["Coude fictif", 4]]);
    const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const workbookName = "Liste matériel.xlsx";
    const workbookPath = path.join(directory, workbookName);
    await writeFile(workbookPath, workbookBytes);
    await picker.setInputFiles([workbookPath]);
    await expect.poll(async () => (await read()).files.length, { timeout: 60_000 }).toBe(4);
    const workbookFile = (await read()).files.find((file) => file.file_name === workbookName)!;
    expect([workbookFile.mime_type, workbookFile.byte_size]).toEqual([MATERIAL_REQUEST_WORKBOOK_MIME_TYPE, workbookBytes.length]);
    await expect(original.getByText(workbookName, { exact: true })).toBeVisible();
    const workbookUrl = `${base}/${requestId}/files/${workbookFile.id}`;
    await expect(original.getByRole("link", "Télécharger", { exact: true })).toHaveAttribute("href", workbookUrl);
    const workbookDownload = await browser.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "same-origin" });
      const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
      const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return [response.status, response.headers.get("content-type"), response.headers.get("content-disposition"), hash];
    }, workbookUrl);
    expect(workbookDownload).toEqual([
      200, MATERIAL_REQUEST_WORKBOOK_MIME_TYPE, "attachment; filename=\"Liste_mat_riel.xlsx\"; filename*=UTF-8''Liste%20mat%C3%A9riel.xlsx",
      createHash("sha256").update(workbookBytes).digest("hex"),
    ]);

    const final = await read();

    // Removing an original removes its bytes with it, and removing the request removes the rest: the
    // application withdraws the row, deletes the object, then the row, against the real storage guards.
    const removed = await apiRequest<Envelope<{ deleted: boolean }>>(
      browser, "DELETE", `${base}/${requestId}/files/${stored.id}`,
    );
    expect([removed.status, removed.body.data?.deleted]).toEqual([200, true]);
    expect((await apiRequest(browser, "GET", `${base}/${requestId}/files/${stored.id}`)).status).toBe(404);
    expect((await read()).files.map((file) => file.id)).toEqual([largeStored.id, converted.id, workbookFile.id]);
    const requestRemoved = await apiRequest<Envelope<{ deleted: boolean }>>(browser, "DELETE", `${base}/${requestId}`);
    expect([requestRemoved.status, requestRemoved.body.data?.deleted]).toEqual([200, true]);
    expect((await apiRequest(browser, "GET", `${base}/${requestId}`)).status).toBe(404);
    expect((await apiRequest(browser, "GET", `${base}/${requestId}/files/${largeStored.id}`)).status).toBe(404);

    await recordEvidence(army, "material-requests", {
      ...ids, requestId, statuses: statuses(final), files: final.files, workbookDownload, refused: refused.body.error,
      stillBlocked: stillBlocked.body.error,
    });
  },
);

// TI-695: metadata can disappear while the original remains a real object. Verify actual Storage
// reads around the ordinary DELETE and the existing recovery endpoint on the owned native stack.
armyTest(
  "MR11 deleting an affaire schedules removal of its originals while a refused affaire keeps its photos",
  { session: "army", tags: ["critical", "material-requests", "affaires"], timeout: 240_000, trace: "off" },
  async ({ app, screen, browser, army }) => {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    const appOrigin = new URL(app.baseUrl!);
    const cronSecret = process.env.E2E_ARMY_LOCAL_RECOVERY_SECRET;
    if (backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !backend.port ||
      ["45585", "33485"].includes(backend.port) ||
      appOrigin.hostname !== "localhost" || !cronSecret || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("MR11 requires the owned native Supabase stack and its local recovery route.");
    }
    const options = { auth: { persistSession: false, autoRefreshToken: false } };
    const storage = createClient(backend.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, options)
      .storage.from("material-requests");
    const admin = createClient(backend.href, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
    const inspected = admin.storage.from("material-requests");

    const prepareAffaire = async (label: string, filenames: string[]) => {
      const ids = await createEstimateViaWizard({ app, screen, browser }, {
        projectName: `${army.projectName} ${label}`,
        title: `${army.runPrefix} ${label}`,
      }, army);
      ownEstimate(army, ids);
      const projectUrl = `/api/affaires/${ids.projectId}`;
      const created = await apiRequest<Envelope<Detail>>(browser, "POST", `${projectUrl}/material-requests`, {
        source_text: "Photo de la demande fictive",
      });
      expect(created.status).toBe(201);
      const requestUrl = `${projectUrl}/material-requests/${created.body.data.request.id}`;
      const prepared = await apiRequest<Envelope<MaterialRequestFileUploads>>(browser, "POST", `${requestUrl}/files`, {
        files: filenames.map((name) => ({ name, byte_size: PNG.length, mime_type: "image/png" })),
      });
      expect(prepared.status).toBe(201);
      const uploads = prepared.body.data.uploads;
      for (const upload of uploads) {
        const result = await storage.uploadToSignedUrl(upload.path, upload.token, PNG, { contentType: "image/png" });
        expect(result.error).toBeNull();
      }
      // When there are two uploads, the second has bytes but the confirmation was interrupted.
      expect((await apiRequest(browser, "POST", `${requestUrl}/files/complete`, {
        ids: [uploads[0].file.id],
      })).status).toBe(200);
      return { projectId: ids.projectId, projectUrl, requestUrl, uploads };
    };

    const deleted = await prepareAffaire("Photos à nettoyer", ["original.png", "non-finalise.png"]);
    const kept = await prepareAffaire("Photos à garder", ["original.png"]);
    const archived = await apiRequest<Envelope<{ archivedIds: string[] }>>(browser, "POST", "/api/affaires/bulk-archive", {
      projectIds: [kept.projectId],
    });
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedIds).toEqual([kept.projectId]);
    const retainedPath = kept.uploads[0].path;
    const deletedPaths = deleted.uploads.map((upload) => upload.path);
    const originalHash = createHash("sha256").update(PNG).digest("hex");
    const readHash = async (key: string) => {
      const { data, error } = await inspected.download(key);
      expect(error).toBeNull();
      return createHash("sha256").update(Buffer.from(await data!.arrayBuffer())).digest("hex");
    };
    for (const key of [...deletedPaths, retainedPath]) {
      expect(await readHash(key)).toBe(originalHash);
    }

    const success = await apiRequest<Envelope<{ deleted: boolean }>>(browser, "DELETE", deleted.projectUrl);
    const refusal = await apiRequest(browser, "DELETE", kept.projectUrl);
    expect([success.status, success.body.data.deleted, refusal.status]).toEqual([200, true, 403]);
    expect((await apiRequest(browser, "GET", deleted.requestUrl)).status).toBe(404);

    const recovery = await fetch(new URL("/api/internal/workflows/recover", appOrigin), {
      headers: { authorization: `Bearer ${cronSecret}` },
      redirect: "error",
    });
    expect(recovery.status).toBe(200);
    const { procurementStorageCleanup } = await recovery.json() as {
      procurementStorageCleanup: { removed: number; failed: number; skipped: boolean };
    };
    expect(procurementStorageCleanup.removed).toBeGreaterThanOrEqual(deletedPaths.length);
    expect(procurementStorageCleanup).toMatchObject({ failed: 0, skipped: false });
    for (const key of deletedPaths) {
      const listing = await inspected.list(path.posix.dirname(key), { search: path.posix.basename(key) });
      expect(listing.error).toBeNull();
      expect(listing.data).toEqual([]);
      const missing = await inspected.download(key);
      expect(missing.data).toBeNull();
      expect(missing.error).not.toBeNull();
    }
    expect(await readHash(retainedPath)).toBe(originalHash);
    await recordEvidence(army, "material-request-affaire-storage-cleanup", {
      deletedProjectId: deleted.projectId, refusedProjectId: kept.projectId, deletedPaths, retainedPath,
      deleteStatus: success.status, refusalStatus: refusal.status, recoveryStatus: recovery.status,
      removed: procurementStorageCleanup.removed,
    });
  },
);

// TI-691, the owner's walk of 2026-11-14. Failure modes, written before the journey was first run:
// - the affaire gives no visible way to its purchasing (the entry hid behind « Chiffrage › Plus »);
// - « 50 coudes DN50, 10 manchons DN15, » becomes one wrong line, without a warning;
// - a corrected message cannot be split again without deleting each line by hand, or splitting it again
//   adds lines after the old ones, or replaces a validated line;
// - with nothing to link or retain, the bulk actions leave the screen without a word on why, or on what to do
//   (TI-690: a bulk action at zero is no longer shown as a grey button; its sentence stays).
armyTest(
  "MR10 a corrected message is split again in place of its draft lines, never over a validated one, and the purchasing is one click from the affaire",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} redécoupage du message`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;

    // The affaire leads to its purchasing from its left column.
    await browser.goto(`/dashboard/affaires/${ids.projectId}`, { waitUntil: "domcontentloaded" });
    const navigation = screen.getByRole("navigation", "Navigation de l'affaire", { exact: true });
    await navigation.getByRole("link", "Achats Demandes de matériel, coût des fournitures", { exact: true }).tap({ timeout: 60_000 });
    await expect(browser).toHaveURL(new RegExp(`/dashboard/affaires/${ids.projectId}/demandes-materiel$`), { timeout: 60_000 });
    await expect(screen.getByRole("heading", "Demandes de matériel", { exact: true })).toBeVisible({ timeout: 60_000 });

    // An SMS that writes its articles on one line, separated by commas.
    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, { source_text: "50 coudes DN50, 10 manchons DN15," });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const read = async () => {
      const response = await apiRequest<Envelope<Detail>>(browser, "GET", `${base}/${requestId}`);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    const readLines = async () => (await read()).lines.map((line) => [line.position, line.original_text, line.quantity, line.unit, line.dimension, line.product_type]);

    const page = `/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`;
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    const showOriginal = screen.getByRole("button", "Voir l’original", { exact: true });
    const original = screen.getByRole("dialog", "Original de la demande", { exact: true });
    await showOriginal.tap({ timeout: 60_000 });
    await original.getByRole("button", "Découper le texte en lignes", { exact: true }).tap();
    await expect.poll(readLines, { timeout: 30_000 }).toEqual([
      [1, "50 coudes DN50", 50, "u", "DN 50", "coudes"],
      [2, "10 manchons DN15,", 10, "u", "DN 15", "manchons"],
    ]);
    const first = (await read()).lines.map((line) => line.id);

    // Bulk actions with nothing to do are not offered; the screen says why, and what to do.
    await original.getByRole("button", "Fermer", { exact: true }).tap();
    const proposalDetails = screen.getByRole("button", "Détails des propositions", { exact: true });
    await expect(proposalDetails).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByRole("button", /^Rattacher les références et noms connus \(\d+\)$/)).toHaveCount(0);
    await expect(screen.getByRole("button", /^Retenir les fournisseurs proposés \(\d+\)$/)).toHaveCount(0);
    await proposalDetails.tap();
    await expect(screen.getByText(
      "Rien à rattacher d’un coup : aucune ligne ne porte une référence ou un nom usuel connus, sans réserve. Rattachez les articles ligne par ligne (« Rattacher », « Chercher ou créer ») ; un nom usuel mémorisé au rattachement sera reconnu ensuite.",
      { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText(
      "Aucun fournisseur à retenir : un fournisseur se propose une fois l’article de la ligne rattaché.",
      { exact: true },
    )).toBeVisible();

    // The message is corrected: the lines do not follow by themselves, and splitting it again replaces them.
    await showOriginal.tap();
    await original.getByRole("button", "Modifier le message", { exact: true }).tap();
    await screen.getByLabel("Message reçu, tel quel", { exact: true }).fill("50 coudes DN50, 10 manchons DN15\n4 tés égaux DN50");
    await screen.getByRole("button", "Enregistrer le message", { exact: true }).tap();
    await expect(screen.getByText(
      "Message enregistré. Les lignes ne suivent pas d’elles-mêmes : redécoupez le message pour les remplacer.",
      { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await screen.getByRole("button", "Redécouper le message", { exact: true }).tap();
    await screen.getByRole("button", "Remplacer les 2 lignes", { exact: true }).tap();
    await expect.poll(readLines, { timeout: 30_000 }).toEqual([
      [1, "50 coudes DN50", 50, "u", "DN 50", "coudes"],
      [2, "10 manchons DN15", 10, "u", "DN 15", "manchons"],
      [3, "4 tés égaux DN50", 4, "u", "DN 50", "tés égaux"],
    ]);
    const second = await read();
    expect(second.lines.map((line) => line.id).filter((id) => first.includes(id))).toEqual([]);
    expect(second.lines.map((line) => line.status)).toEqual(["draft", "draft", "draft"]);

    // Once a line is validated, the message is no longer split over it.
    const confirmed = await apiRequest<Envelope<unknown>>(browser, "PATCH", `${base}/${requestId}`, {
      presumed_material: "Cuivre", material_confirmed: true,
    });
    expect(confirmed.status).toBe(200);
    const validated = await apiRequest<Envelope<unknown>>(browser, "POST", `${base}/${requestId}/lines/validate`, { ids: [second.lines[0].id] });
    expect(validated.status).toBe(200);
    const kept = await apiRequest<Envelope<never>>(browser, "POST", `${base}/${requestId}/lines/replace`, {
      replaced_ids: second.lines.map((line) => line.id), lines: [{ original_text: "1 coude DN50" }],
    });
    // The refusal names the line by what it asks (its type and size, else the technician's words): no number shows on screen.
    const keptLine = second.lines[0];
    const keptName = keptLine.product_type?.trim()
      ? [keptLine.product_type.trim(), keptLine.dimension?.trim()].filter(Boolean).join(" ")
      : `« ${keptLine.original_text?.trim()} »`;
    expect([kept.status, kept.body.error?.code, kept.body.error?.message]).toEqual([
      409, "MATERIAL_REQUEST_LINES_KEPT", `Les lignes n’ont pas été remplacées : la ligne ${keptName} est validée. Corrigez les lignes dans le tableau.`,
    ]);
    expect((await read()).lines.map((line) => [line.id, line.status])).toEqual(
      second.lines.map((line, index) => [line.id, index === 0 ? "validated" : "draft"]),
    );
    await browser.goto(page, { waitUntil: "domcontentloaded" });
    await showOriginal.tap({ timeout: 60_000 });
    await expect(original.getByRole("button", "Modifier le message", { exact: true })).toBeVisible();
    await expect(original.getByRole("button", "Redécouper le message", { exact: true })).toHaveCount(0);

    await recordEvidence(army, "material-request-resplit", {
      ...ids, requestId, first, second: second.lines.map((line) => line.id), kept: kept.body.error,
    });
  },
);
