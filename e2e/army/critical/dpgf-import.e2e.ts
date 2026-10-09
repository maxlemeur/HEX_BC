import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  readEstimate,
  recordEvidence,
  type ArmyEstimate,
  type ArmyItem,
} from "./fixtures";

type Envelope<T> = { ok: boolean; data: T };
type ImportRecord = {
  id: string;
  project_id: string;
  filename: string;
  source_format: string;
  status: string;
  parse_mode: string;
  row_count: number;
};
type Preview = {
  validation: { is_valid: boolean };
  rows: Array<{
    row_index: number;
    raw_row: Record<string, unknown>;
    mapped_row: Record<string, unknown>;
    missing_required_fields: string[];
  }>;
};
type ExpectedLine = {
  reference: string;
  title: string;
  quantityText: string;
  quantity: number;
  unit: string;
  priceText: string;
  priceCents: number;
  totalText: string;
  totalHtCents: number;
  taxCents: number;
  totalTtcCents: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function csvCell(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function metadata(item: ArmyItem): Record<string, unknown> {
  const value = item.source_metadata;
  expect(value !== null && typeof value === "object" && !Array.isArray(value)).toBe(true);
  return value as Record<string, unknown>;
}

function businessSnapshot(estimate: ArmyEstimate) {
  const version = estimate.version;
  return {
    project: estimate.project,
    version: {
      id: version.id,
      project_id: version.project_id,
      version_number: version.version_number,
      title: version.title,
      status: version.status,
      margin_mode: version.margin_mode,
      margin_multiplier: version.margin_multiplier,
      margin_bp: version.margin_bp,
      tax_rate_bp: version.tax_rate_bp,
      discount_bp: version.discount_bp,
      rounding_mode: version.rounding_mode,
      total_ht_cents: version.total_ht_cents,
      total_tax_cents: version.total_tax_cents,
      total_ttc_cents: version.total_ttc_cents,
    },
    items: estimate.items,
  };
}

(["business", "opaque"] as const).forEach((headerStyle) => armyTest(
  headerStyle === "business"
    ? "CSV DPGF becomes a new estimate with exact values, zero quantities and canonical provenance"
    : "opaque CSV DPGF headers preserve every row and canonical provenance",
  { session: "army", tags: ["critical", "dpgf"], requires: ["browser"], timeout: 120_000 },
  async ({ app, screen, browser, army }) => {
    let projectId: string | null = null;
    let initialVersionId: string | null = null;
    let importedVersionId: string | null = null;
    let importId: string | null = null;
    let mappingId: string | null = null;
    let stage = "create-estimate";
    const token = createHash("sha256").update(army.runPrefix).digest("hex").slice(0, 12);
    const headers = headerStyle === "business"
      ? ["Référence article", "Désignation", "Quantité", "Unité", "Prix fourniture", "Montant HT"]
        .map((label) => `${label} ${token}`)
      : ["a", "b", "c", "d", "e", "f"].map((suffix) => `h_${token}_${suffix}`);
    // The upload API exposes normalized source keys; retain accented CSV input.
    const sourceHeaders = headerStyle === "business"
      ? ["Reference_article", "Designation", "Quantite", "Unite", "Prix_fourniture", "Montant_HT"]
        .map((label) => `${label}_${token}`)
      : headers;
    const targets = ["hex_code", "designation", "quantity", "unit", "unit_price_ht", "total_ht"];
    const mapping = Object.fromEntries(sourceHeaders.map((header, index) => [header, targets[index]]));
    const expected: ExpectedLine[] = [
      {
        reference: `${army.projectName}-R01`, title: `${army.projectName} – Tube; cuivre`,
        quantityText: "2,5", quantity: 2.5, unit: "m", priceText: "12,50", priceCents: 1250,
        totalText: "31,25", totalHtCents: 3125, taxCents: 625, totalTtcCents: 3750,
      },
      {
        reference: `${army.projectName}-R02`, title: `${army.projectName} – Vanne "laiton"`,
        quantityText: "1", quantity: 1, unit: "u", priceText: "65,00", priceCents: 6500,
        totalText: "65,00", totalHtCents: 6500, taxCents: 1300, totalTtcCents: 7800,
      },
      {
        reference: `${army.projectName}-R03`, title: `${army.projectName} – Réserve à quantité zéro`,
        quantityText: "0", quantity: 0, unit: "u", priceText: "7,25", priceCents: 725,
        totalText: "0,00", totalHtCents: 0, taxCents: 0, totalTtcCents: 0,
      },
    ];
    const rows = expected.map((line) => [
      line.reference, line.title, line.quantityText, line.unit, line.priceText, line.totalText,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n")}\r\n`;
    const filename = `${army.projectName}-dpgf.csv`;
    const fixtureDirectory = path.resolve(".e2e/army/critical/artifacts/fixtures");
    await mkdir(fixtureDirectory, { recursive: true });
    const fixturePath = path.join(fixtureDirectory, filename);
    await writeFile(fixturePath, csv, "utf8");
    await recordEvidence(army, "dpgf-input", {
      fixturePath, filename, sha256: createHash("sha256").update(csv).digest("hex"),
      encoding: "utf-8-bom", delimiter: ";", headerStyle, mapping, expected,
      expectedTotals: { ht: 9625, tax: 1925, ttc: 11550 },
    });

    try {
      const initial = await createEstimateViaWizard(
        { app, screen, browser },
        { projectName: army.projectName, title: `${army.projectName} initial` },
        army
      );
      ({ projectId, versionId: initialVersionId } = initial);
      ownEstimate(army, initial);
      const before = await readEstimate(browser, initial.versionId);
      expect(before.version).toMatchObject({
        version_number: 1, margin_mode: "fixed", margin_multiplier: 1,
        tax_rate_bp: 2000, discount_bp: 0, rounding_mode: "none",
      });
      expect(before.items).toHaveLength(0);
      await recordEvidence(army, "dpgf-initial-version", businessSnapshot(before));

      stage = "upload-csv";
      await app.open(`/dashboard/affaires/${projectId}?created=1`);
      await screen.getByRole("button", "Importer la DPGF", { exact: true }).tap();
      await browser.locator('input[type="file"]').setInputFiles(fixturePath);
      await screen.getByRole("button", "Lancer l'import", { exact: true }).tap();

      const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
      const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
      await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), {
        timeout: 30_000,
      }).toBe(true);
      if (await editMapping.isVisible()) await editMapping.tap();
      await expect(nextMapping).toBeVisible();

      const imports = await apiRequest<Envelope<ImportRecord[]>>(
        browser, "GET", `/api/imports?project_id=${projectId}`
      );
      expect(imports.status).toBe(200);
      expect(imports.body.ok).toBe(true);
      expect(imports.body.data).toHaveLength(1);
      const imported = imports.body.data[0];
      importId = imported.id;
      expect(importId).toMatch(UUID);
      await recordEvidence(army, "dpgf-raw-import", imported);
      expect(imported).toMatchObject({
        project_id: projectId, filename, source_format: "csv", status: "completed",
        row_count: 3,
      });

      stage = "map-columns";
      const sourceRow = (header: string) => screen.getByRole("row")
        .filter({ has: screen.getByText(header, { exact: true }) });
      const column = (header: string) => sourceRow(header).getByRole("combobox");
      for (const header of sourceHeaders) await column(header).selectOption({ value: "" });
      await expect(nextMapping).toBeDisabled();
      await column(sourceHeaders[0]).selectOption({ value: "designation" });
      await column(sourceHeaders[1]).selectOption({ value: "designation" });
      await expect(nextMapping).toBeDisabled();
      await expect(sourceRow(sourceHeaders[1])).toContainText("Conflit");
      for (const [header, target] of Object.entries(mapping)) {
        await column(header).selectOption({ value: target });
      }
      await expect(nextMapping).toBeEnabled();
      await nextMapping.tap();

      const preview = await apiRequest<Envelope<Preview>>(browser, "POST", "/api/mappings", {
        action: "preview", import_id: importId, mapping, limit: 20,
      });
      expect(preview.status).toBe(200);
      expect(preview.body.ok).toBe(true);
      expect(preview.body.data.validation.is_valid).toBe(true);
      expect(preview.body.data.rows).toHaveLength(3);
      for (const [index, line] of expected.entries()) {
        const row = preview.body.data.rows[index];
        expect(row.row_index).toBe(index);
        expect(row.raw_row).toEqual(Object.fromEntries(sourceHeaders.map((header, cell) => [header, rows[index][cell]])));
        expect(row.mapped_row).toMatchObject({
          hex_code: line.reference, designation: line.title, quantity: line.quantityText,
          unit: line.unit, unit_price_ht: line.priceText, total_ht: line.totalText,
        });
        expect(row.missing_required_fields).toHaveLength(0);
      }
      await recordEvidence(army, "dpgf-mapping-preview", { importId, mapping, preview: preview.body.data });

      stage = "confirm-import";
      const nextPreview = screen.getByRole("button", "Suivant : Confirmation", { exact: true });
      await expect(nextPreview).toBeEnabled();
      await nextPreview.tap();
      const confirm = screen.getByRole("button", "Créer le chiffrage", { exact: true });
      await expect(confirm).toBeEnabled();
      await confirm.tap();
      await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 45_000 });
      await screen.getByRole("button", "Continuer", { exact: true }).tap();
      const skipPlans = screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
      await expect.poll(async () => {
        return /\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/i.test(await browser.url()) || await skipPlans.isVisible();
      }, { timeout: 30_000 }).toBe(true);
      if (await skipPlans.isVisible()) await skipPlans.tap();
      await expect(browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/, { timeout: 30_000 });
      importedVersionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1];
      ownEstimate(army, { projectId: initial.projectId, versionId: importedVersionId });
      expect(importedVersionId).not.toBe(initial.versionId);

      stage = "verify-persisted-estimate";
      await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
      const saved = await readEstimate(browser, importedVersionId);
      expect(saved.project).toEqual(before.project);
      expect(saved.version).toMatchObject({
        project_id: initial.projectId, version_number: 2,
        margin_mode: "fixed", margin_multiplier: 1, tax_rate_bp: 2000,
        discount_bp: 0, rounding_mode: "none",
        total_ht_cents: 9625, total_tax_cents: 1925, total_ttc_cents: 11550,
      });
      const sections = saved.items.filter((item) => item.item_type === "section");
      const lines = saved.items.filter((item) => item.item_type === "line");
      expect(sections).toHaveLength(1);
      expect(lines).toHaveLength(3);
      const root = sections[0];
      expect(root).toMatchObject({ parent_id: null, source_provider: "dpgf", source_file_name: filename });
      expect(metadata(root)).toMatchObject({ import_id: importId, kind: "import_root" });
      const observedMappingIds = new Set<string>();
      const mappedRowIds = new Set<string>();
      for (const [index, line] of expected.entries()) {
        const found = lines.filter((item) => item.title === line.title);
        expect(found).toHaveLength(1);
        const actual = found[0];
        expect(actual).toMatchObject({
          parent_id: root.id, position: index + 1, description: line.unit,
          quantity: line.quantity, unit_price_ht_cents: line.priceCents, tax_rate_bp: 2000,
          line_total_ht_cents: line.totalHtCents, line_tax_cents: line.taxCents,
          line_total_ttc_cents: line.totalTtcCents,
          source_provider: "dpgf", source_file_name: filename, source_job_id: null, source_page: null,
          selected_supplier_price_id: null,
        });
        const provenance = metadata(actual);
        expect(provenance).toMatchObject({ import_id: importId, row_index: index });
        expect(provenance).not.toHaveProperty("_timax_provenance");
        expect(provenance.mapping_id).toMatch(UUID);
        expect(provenance.mapped_row_id).toMatch(UUID);
        observedMappingIds.add(provenance.mapping_id as string);
        mappedRowIds.add(provenance.mapped_row_id as string);
        await expect(screen.getByLabel(`Quantité pour ${line.title}`, { exact: true })).toBeVisible();
      }
      expect(observedMappingIds.size).toBe(1);
      expect(mappedRowIds.size).toBe(3);
      mappingId = [...observedMappingIds][0];
      const initialAfter = await readEstimate(browser, initial.versionId);
      expect(businessSnapshot(initialAfter)).toEqual(businessSnapshot(before));
      await recordEvidence(army, "dpgf-persisted-result", {
        importId, mappingId, mappedRowIds: [...mappedRowIds],
        imported: businessSnapshot(saved), initialUnchanged: true,
      });

      stage = "verify-reload";
      await app.open(`/dashboard/estimates/${importedVersionId}/edit`);
      await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
      const reloaded = await readEstimate(browser, importedVersionId);
      expect(businessSnapshot(reloaded)).toEqual(businessSnapshot(saved));
      for (const line of expected) {
        await expect(screen.getByLabel(`Quantité pour ${line.title}`, { exact: true })).toBeVisible();
      }
      await recordEvidence(army, "dpgf-reloaded-result", {
        unchangedAfterReload: true, result: businessSnapshot(reloaded),
      });
      stage = "complete";
    } finally {
      // Retain own import IDs even if the flow fails before a version URL appears.
      const retainedImports = projectId === null ? null : await apiRequest<Envelope<ImportRecord[]>>(
        browser, "GET", `/api/imports?project_id=${projectId}`
      ).then((response) => response.status === 200 && response.body.ok
        ? response.body.data.map((item) => ({ id: item.id, projectId: item.project_id, filename: item.filename }))
        : null).catch(() => null);
      await recordEvidence(army, "dpgf-owned-identities", {
        stage, projectId, initialVersionId, importedVersionId, importId, mappingId,
        fixturePath, retainedImports, cleanup: "none", emails: "none",
      });
    }
  }
));
