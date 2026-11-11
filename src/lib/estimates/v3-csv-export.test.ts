import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { buildEstimateV3CsvRows, estimateV3CsvHeader, writeEstimateV3Csv } from "@/lib/estimates/v3-csv-export";
import type { EstimateV3ExportDocument } from "@/lib/estimates/v3-export";
import { frozenV3ExportDocument, takeoffProvisionMetadata as marker } from "@/lib/estimates/v3-export-document.fixtures";

// The browser journey checks the export's business values. Spreadsheet formula
// interpretation happens after download, so this checks the serialized cells.
describe("v3 estimate CSV spreadsheet boundary", () => {
  it("keeps formula-like titles inert and preserves ordinary cells", () => {
    const csv = writeEstimateV3Csv([
      ["Désignation", "Quantité", "Total HT"],
      ["=1+1", 2, 12.5],
      [" \t@SUM(1)", 3, 0],
      ["\u200b+1+2", 4, 7],
      ["-1+2", 5, 8],
      ["Normal; \"devis\"", 6, 9],
    ]);
    const workbook = XLSX.read(csv.slice(1), { type: "string", raw: true, FS: ";" });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: true,
    });

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(rows).toEqual([
      ["Désignation", "Quantité", "Total HT"],
      ["'=1+1", "2", "12.5"],
      ["' \t@SUM(1)", "3", "0"],
      ["'\u200b+1+2", "4", "7"],
      ["'-1+2", "5", "8"],
      ["Normal; \"devis\"", "6", "9"],
    ]);
    expect(csv).toContain('"Normal; ""devis""";6;9');
  });

  it("keeps carriage returns inside quoted cells so they cannot create formula rows", () => {
    const csv = writeEstimateV3Csv([
      ["Désignation", "Quantité"],
      ["Avant\r=1+1", 2],
      ["\r@SUM(1)", 3],
    ]);
    const workbook = XLSX.read(csv.slice(1), { type: "string", raw: true, FS: ";" });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: true,
    });

    expect(rows).toEqual([
      ["Désignation", "Quantité"],
      ["Avant\r=1+1", "2"],
      ["'\r@SUM(1)", "3"],
    ]);
    expect(csv).toContain('"Avant\r=1+1";"2"');
  });
});

// TI-682 lot C, PR 1 (H12 lifted for the CSV): the internal CSV of a v3 says which lines come from a takeoff provision.
// The marker lives in source_metadata.takeoff_provision (readTakeoffProvision). The DPGF, standard and BDC workbooks
// can reach a client or a supplier and never carry it (dpgf-export, bdc-export and export-stream tests).
const PROVISION_HEADER = "Provision métré";

const MARKED_LINES = [
  { title: "ARMY sans marqueur", metadata: {}, expected: "" },
  { title: "ARMY forcée", metadata: marker({ forced: true, forced_reason: "additional_evidence" }), expected: "Provision interne" },
  { title: "ARMY hypothèse saisie", metadata: marker({ entry_category: "hypothesis" }), expected: "Hypothèse" },
  { title: "ARMY hypothèse chiffrée", metadata: marker({ forced: true, forced_reason: "priced_hypothesis" }), expected: "Hypothèse" },
  { title: "ARMY marqueur illisible", metadata: { takeoff_provision: { version: 2, sources: "?" } }, expected: "Provision interne" },
  { title: "ARMY autre métadonnée", metadata: { dpgf_row_id: "row-1" }, expected: "" },
] as const;

const frozenV3Document = (laborSplit = false) => frozenV3ExportDocument(MARKED_LINES, { laborSplit });

function csvRows(document: EstimateV3ExportDocument) {
  return buildEstimateV3CsvRows({
    document, supplyTypeById: new Map(), laborRoleNameById: new Map(), supplierLabels: () => ["", "", ""],
  });
}

describe("v3 estimate CSV takeoff provision column (TI-682)", () => {
  it("states for each line whether it comes from a takeoff provision, an hypothesis, or neither", () => {
    const rows = csvRows(frozenV3Document());
    const header = rows[0] as string[];
    const designation = header.indexOf("Désignation");
    const provision = header.indexOf(PROVISION_HEADER);
    expect(provision).toBeGreaterThan(-1);
    const lines = rows.slice(1, 1 + MARKED_LINES.length);
    expect(lines.map((row) => [row[designation], row[provision]]))
      .toEqual(MARKED_LINES.map((line) => [line.title, line.expected]));
  });

  it("appends the column after every existing one and leaves the footer cells of the column empty", () => {
    // The columns as they were before TI-682, in their order: a consumer reading them by position keeps working.
    const base = ["Chemin chapitre", "Poste", "Désignation", "Unité", "Quantité", "Statut", "Prix unitaire HT (EUR)", "Type FO",
      "Fournisseur 1", "Fournisseur 2", "Fournisseur 3", "Provision FO", "K FO", "h MO / unité", "Majoration MO (%)", "Rôle MO", "K MO",
      "PU HT (EUR)", "Total HT (EUR)", "TVA (%)", "Transport FO"];
    const split = ["h MO atelier / unité", "Rôle MO atelier", "K MO atelier", "h MO chantier / unité", "Rôle MO chantier", "K MO chantier"];
    for (const laborSplit of [false, true]) {
      const rows = csvRows(frozenV3Document(laborSplit));
      expect(rows[0]).toEqual([...base, ...(laborSplit ? split : []), PROVISION_HEADER]);
      expect(estimateV3CsvHeader("EUR", laborSplit)).toEqual(rows[0]);
      expect(rows.filter((row) => row.length > 0).every((row) => row.length === rows[0].length)).toBe(true);
      const footer = rows.slice(rows.findIndex((row) => row.length === 0) + 1);
      expect(footer.length).toBeGreaterThan(0);
      expect(footer.map((row) => row.at(-1))).toEqual(footer.map(() => ""));
    }
  });

  it("serializes the labels unchanged", () => {
    const csv = writeEstimateV3Csv(csvRows(frozenV3Document()));
    const workbook = XLSX.read(csv.slice(1), { type: "string", raw: true, FS: ";" });
    const parsed = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: "" });
    const provision = parsed[0].indexOf(PROVISION_HEADER);
    expect(parsed.slice(1, 1 + MARKED_LINES.length).map((row) => row[provision])).toEqual(MARKED_LINES.map((line) => line.expected));
  });
});
