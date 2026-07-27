import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("extract-audit-artifact", () => {
  it("regenerates the complete published ledger byte-for-byte from the normalized canonical source", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "hex-bc-audit-canonical-")
    );
    temporaryDirectories.push(directory);
    const firstOutputPath = join(directory, "audit-first.md");
    const secondOutputPath = join(directory, "audit-second.md");
    const sourcePath = join(
      process.cwd(),
      "docs/user_story/AUDIT-2026-07-source.normalized.json"
    );
    const ledgerPath = join(
      process.cwd(),
      "docs/user_story/AUDIT-2026-07-inventaire.md"
    );

    const runGenerator = (outputPath: string) =>
      execFileSync(
        process.execPath,
        ["scripts/extract-audit-artifact.mjs", sourcePath, outputPath],
        {
          cwd: process.cwd(),
          stdio: "pipe",
        }
      );

    runGenerator(firstOutputPath);
    runGenerator(secondOutputPath);

    const source = JSON.parse(readFileSync(sourcePath, "utf8")) as {
      source_kind: string;
      provenance: {
        original_html_available: boolean;
        note: string;
      };
      expected_counts: {
        bugs: number;
        ux: number;
      };
      inventory: {
        bugs: Array<{ id: string; statut: string }>;
        ux: Array<{ id: string; statut: string }>;
        campaign: { heading: string } | null;
      };
    };
    const ledger = readFileSync(ledgerPath, "utf8");
    const firstGeneration = readFileSync(firstOutputPath, "utf8");
    const secondGeneration = readFileSync(secondOutputPath, "utf8");

    expect(firstGeneration).toBe(ledger);
    expect(secondGeneration).toBe(firstGeneration);
    expect(source.source_kind).toBe("normalized_audit_ledger");
    expect(source.provenance.original_html_available).toBe(false);
    expect(source.provenance.note).toContain("n'est pas l'HTML brut");
    expect(source.expected_counts).toEqual({
      bugs: 27,
      ux: 73,
    });
    expect(source.inventory.bugs).toHaveLength(27);
    expect(source.inventory.ux).toHaveLength(73);
    expect(
      source.inventory.bugs.find((bug) => bug.id === "B06")?.statut
    ).toContain("traité");
    expect(
      source.inventory.bugs.find((bug) => bug.id === "B17")?.statut
    ).toContain("traité");
    expect(source.inventory.campaign?.heading).toBe(
      "### Campagne d'accents FR (UX10, UX23, UX34, UX52) — close sur les surfaces principales"
    );
    expect(
      firstGeneration.match(/^#### B\d{2} — /gm)
    ).toHaveLength(27);
    expect(
      firstGeneration.match(/^\| UX\d{2} \|/gm)
    ).toHaveLength(73);
  });

  it("keeps the historical HTML import deterministic when an export is available", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "hex-bc-audit-artifact-")
    );
    temporaryDirectories.push(directory);
    const inputPath = join(directory, "audit.html");
    const outputPath = join(directory, "audit.md");
    writeFileSync(
      inputPath,
      [
        '<article class="card bug" data-sev="haut">',
        '<span class="status">Vérifié</span>',
        '<span class="tag">calcul</span>',
        '<span class="cluster">Exports</span>',
        '<h3 class="bug-title">Écart contrôlé</h3>',
        '<span class="loc"><code>src/example.ts:1</code></span>',
        '<p class="desc">Description accentuée.</p>',
        "</article>",
        '<section class="persona">',
        "<h3>Chiffreur</h3><div class=\"pcounts\"></div>",
        '<div class="ux item">',
        '<span class="sev">Mineur</span>',
        '<span class="tag">copy</span>',
        '<span class="area">Éditeur</span>',
        '<p class="ux-obs">Observation accentuée.</p>',
        '<div class="ux-ev">Preuve.</div>',
        '<p class="ux-reco">Recommandation.</p>',
        "</div>",
        "</section>",
      ].join("\n"),
      "utf8"
    );

    const runGenerator = () =>
      execFileSync(
        process.execPath,
        ["scripts/extract-audit-artifact.mjs", inputPath, outputPath],
        {
          cwd: process.cwd(),
          stdio: "pipe",
        }
      );

    runGenerator();
    const firstGeneration = readFileSync(outputPath, "utf8");
    runGenerator();
    const secondGeneration = readFileSync(outputPath, "utf8");

    expect(secondGeneration).toBe(firstGeneration);
    expect(firstGeneration).toContain(
      "ont été rapprochés du code AU HEAD : la référence de l'audit a été rouverte"
    );

    expect(firstGeneration).toContain(
      "### Campagne d'accents FR (UX10, UX23, UX34, UX52)"
    );
  });
});
