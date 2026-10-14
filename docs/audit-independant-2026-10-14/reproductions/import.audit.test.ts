/**
 * Audit indépendant 2026-10-14 — lecture des DPGF réelles du dossier par l'analyseur d'import de l'application.
 * Fonctions pures de la copie figée ; aucune base. Les fichiers sont lus depuis docs/prd_file de la copie.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseImportFile } from "@/lib/imports/parser";
import { readImportRowStructure } from "@/lib/imports/payload";

const docs = path.resolve(__dirname, "../../docs/prd_file");
const files = [
  "exemple demande DPGF client/HEX-DPGF-COLT-PAR2-LOT4.xlsx",
  "exemple chiffrage OPTIMA/BEING - DPGF HYDRAULIQUE.xlsx",
  "exemple chiffrage OPTIMA/BEING - DPGF PLOMBERIE.xlsx",
];

describe("I-01 Import des DPGF réelles fournies", () => {
  for (const rel of files) {
    it(`analyse ${path.basename(rel)}`, async () => {
      const full = path.join(docs, rel);
      const bytes = fs.readFileSync(full);
      const file = new File([bytes], path.basename(rel), {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const parsed = await parseImportFile(file);
      const kinds = { section: 0, line: 0, autre: 0 };
      for (const row of parsed.rows) {
        const s = readImportRowStructure(row as Record<string, unknown>) as { kind?: string } | null;
        if (s?.kind === "section") kinds.section++;
        else if (s?.kind === "line") kinds.line++;
        else kinds.autre++;
      }
      const sample = parsed.rows.slice(0, 4).map((r) =>
        Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_")).slice(0, 7))
      );
      console.log(
        `[AUDIT] ${path.basename(rel)} ${JSON.stringify({
          format: parsed.sourceFormat,
          entetes: parsed.headers.slice(0, 12),
          lignes: parsed.rows.length,
          structure: kinds,
          exemple: sample,
        })}`
      );
      expect(parsed.rows.length).toBeGreaterThan(0);
    });
  }
});
