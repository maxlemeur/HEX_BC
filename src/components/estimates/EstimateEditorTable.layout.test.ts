import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveEstimateEditorGridStyle,
  resolveEstimateViewportColumns,
} from "@/components/estimates/EstimateEditorTable";
import { resolveSectionContextMenuTop } from "@/components/estimates/components/estimate-editor-table/EstimateEditorTableSectionDialogs";
import type { ColumnKey } from "@/hooks/useColumnVisibility";

const ALL_OPTIONAL_COLUMNS = new Set<ColumnKey>([
  "supply_type",
  "k_fo",
  "h_mo_majoration",
  "labor_role",
  "k_mo",
]);

function toCustomProperties(
  style: ReturnType<typeof resolveEstimateEditorGridStyle>,
) {
  return style as Record<string, string> | undefined;
}

describe("estimate editor responsive grid", () => {
  it("uses the existing essential columns on mobile without changing desktop preferences", () => {
    const desktopColumns = new Set<ColumnKey>(["supply_type", "k_fo"]);

    expect(resolveEstimateViewportColumns(desktopColumns, false)).toBe(
      desktopColumns,
    );
    expect(
      Array.from(resolveEstimateViewportColumns(desktopColumns, true)),
    ).toEqual([]);
    expect(desktopColumns).toEqual(new Set(["supply_type", "k_fo"]));
  });
  it("provides distinct desktop and tablet tracks for every visible column", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, false),
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(300px, 3fr) 64px 54px 88px 112px 56px 56px 104px 112px 56px 88px 100px 42px",
      "--estimate-grid-tablet":
        "minmax(260px, 3fr) 58px 50px 80px 100px 56px 56px 96px 100px 56px 82px 94px 40px",
      "--estimate-desktop-min-width": "1232px",
      "--estimate-tablet-min-width": "1128px",
    });
    expect(style).not.toHaveProperty("--estimate-grid");
  });

  it("removes hidden optional columns from both responsive grids", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(new Set<ColumnKey>(), false),
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(300px, 3fr) 64px 54px 88px 56px 88px 100px 42px",
      "--estimate-grid-tablet":
        "minmax(260px, 3fr) 58px 50px 80px 56px 82px 94px 40px",
      "--estimate-desktop-min-width": "792px",
      "--estimate-tablet-min-width": "900px",
    });
  });

  it("applies user widths to every grid track and updates the minimum width", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(new Set<ColumnKey>(), false, {
        designation: 420,
        quantity: 96,
        total_price: 140,
      }),
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "420px 96px 54px 88px 56px 88px 140px 42px",
      "--estimate-grid-tablet":
        "420px 96px 50px 80px 56px 82px 140px 40px",
      "--estimate-desktop-min-width": "984px",
      "--estimate-tablet-min-width": "964px",
    });
  });

  it("construit aussi la grille du mode MO éclatée, à l'identique du CSS qu'elle remplace", () => {
    // Le mode split retournait `undefined` et laissait `.estimate-table--labor-split`
    // décider. Ce second régime interdisait toute colonne optionnelle en mode
    // split — donc le sous-détail de prix y aurait été invisible. Les pistes
    // ci-dessous reprennent EXACTEMENT les valeurs de l'ancien CSS statique.
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, true),
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(300px, 3fr) 64px 54px 88px 112px 60px 96px 72px 104px 60px 72px 104px 60px 88px 100px 42px",
      "--estimate-grid-tablet":
        "minmax(260px, 3fr) 58px 50px 80px 100px 56px 88px 68px 96px 56px 68px 96px 56px 82px 94px 40px",
      "--estimate-desktop-min-width": "1476px",
      "--estimate-tablet-min-width": "1348px",
    });
  });

  it("insère le sous-détail de prix entre la main-d'œuvre et la vente", () => {
    const withMargin = toCustomProperties(
      resolveEstimateEditorGridStyle(
        new Set<ColumnKey>(["ds", "marge", "marque"]),
        false,
      ),
    );

    expect(withMargin).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(300px, 3fr) 64px 54px 88px 56px 100px 100px 78px 88px 100px 42px",
      "--estimate-desktop-min-width": "1070px",
    });
  });

  it("laisse la grille inchangée quand le sous-détail est masqué", () => {
    // Les colonnes sont optionnelles et absentes des presets « Essentiel » et
    // « Standard » : un utilisateur qui n'y touche pas ne voit aucun changement.
    const before = toCustomProperties(
      resolveEstimateEditorGridStyle(new Set<ColumnKey>(), false),
    );

    expect(before?.["--estimate-grid-desktop"]).toBe(
      "minmax(300px, 3fr) 64px 54px 88px 56px 88px 100px 42px",
    );
  });

  it("keeps the stylesheet contract that activates tablet and sticky tracks", () => {
    // Les regles .estimate-* ont ete extraites de globals.css vers cette
    // feuille dediee, qui reste hors @layer pour preserver la cascade.
    const css = readFileSync(
      join(process.cwd(), "src/styles/estimate-frozen.css"),
      "utf8",
    );

    expect(css).toContain("--estimate-grid: var(--estimate-grid-desktop);");
    expect(css).toContain("--density-row-h: 30px;");
    expect(css).toContain(".estimate-column-resize-handle {");
    expect(css).toContain("cursor: col-resize;");
    expect(css).toContain("--density-cell-px: 6px;");
    expect(css).toContain("--density-cell-py: 2px;");
    expect(css).not.toMatch(
      /@media \(min-width: 1025px\)[\s\S]*?\.estimate-table \.estimate-line-designation \{[\s\S]*?flex-direction: row;/,
    );
    // Le badge de provenance doit rester lisible en desktop : plus jamais
    // d'écrasement en pastille 10px illisible.
    expect(css).not.toMatch(
      /\.estimate-table \.estimate-line-truth__badge \{[\s\S]*?font-size: 0;/,
    );
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1024px\)[\s\S]*?--estimate-grid: var\(--estimate-grid-tablet\);/,
    );
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1279px\)[\s\S]*?\.dashboard-workspace-content \.estimate-table-scroll \{[\s\S]*?width: calc\(100% \+ 3rem\);[\s\S]*?margin-inline: -1\.5rem;[\s\S]*?border-inline: 0;[\s\S]*?border-radius: 0;/,
    );
    expect(css).toMatch(
      /@media \(min-width: 1280px\)[\s\S]*?\[data-testid="estimate-editor-table-shell"\]\[data-has-side-panel="false"\][\s\S]*?> \.estimate-table-scroll \{[\s\S]*?width: calc\(100% \+ 3rem\);[\s\S]*?margin-inline: -1\.5rem;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.dashboard-workspace-content \.estimate-table-scroll \{[\s\S]*?width: calc\(100% \+ 1\.5rem\);[\s\S]*?margin-inline: -0\.75rem;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.estimate-table-scroll\[data-mobile-view="compact"\] \{[\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.estimate-mobile-list \{[\s\S]*?display: block;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\[data-testid="estimate-editor-table-toolbar"\] \{[\s\S]*?display: none;/,
    );
    expect(css).toMatch(
      /\.estimate-row \.estimate-cell--designation \{[\s\S]*?position: sticky;[\s\S]*?left: 0;/,
    );
    expect(css).toMatch(
      /\.estimate-row--section \.estimate-cell--designation \{[\s\S]*?position: sticky;/,
    );
    expect(css).toMatch(
      /\.estimate-row--section \.estimate-cell--designation:has\(\.estimate-section-quick-actions__menu\) \{[\s\S]*?z-index: 20;[\s\S]*?overflow: visible;/,
    );
    expect(css).toMatch(
      /\.estimate-line-truth__badge \{[\s\S]*?white-space: nowrap;/,
    );
    expect(css).toMatch(
      /@media \(max-width: 1440px\)[\s\S]*?\.estimate-line-truth__badge \{[\s\S]*?padding-inline: 5px;[\s\S]*?font-size: 10px;/,
    );
    expect(css).toMatch(
      /\.estimate-catalogue-suggestions \{[\s\S]*?position: fixed;[\s\S]*?z-index: 60;[\s\S]*?display: flex;[\s\S]*?flex-direction: column;/,
    );
  });

  it("reserves the finalization inspector for wide screens without squeezing tablets", () => {
    const chromeSource = readFileSync(
      join(
        process.cwd(),
        "src/components/estimates/components/estimate-editor-table/EstimateEditorTableChrome.tsx",
      ),
      "utf8",
    );
    const checklistSource = readFileSync(
      join(process.cwd(), "src/components/estimates/EstimateChecklist.tsx"),
      "utf8",
    );
    const editorStateSource = readFileSync(
      join(process.cwd(), "src/hooks/useEstimateEditorState.impl.tsx"),
      "utf8",
    );
    expect(chromeSource).toContain(
      "grid gap-2 xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start xl:gap-x-3",
    );
    expect(chromeSource).toContain(
      "w-full xl:col-start-2 xl:row-span-2 xl:row-start-1",
    );
    expect(chromeSource).toContain(
      "estimate-table-scroll overflow-x-auto xl:col-start-1 xl:row-start-2",
    );
    expect(chromeSource).toContain(
      'data-has-side-panel={headerRight ? "true" : "false"}',
    );
    expect(checklistSource).toContain(
      "h-fit w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:sticky xl:top-4",
    );
    expect(editorStateSource).toContain(
      "onToggleFinalizationPanel: handleToggleFinalizationPanel,",
    );
    expect(editorStateSource).toContain(
      "headerRight: isFinalizationPanelOpen ? (",
    );
  });

  it("keeps section menus inside the viewport using their measured height", () => {
    expect(resolveSectionContextMenuTop(760, 295, 792)).toBe(489);
    expect(resolveSectionContextMenuTop(220, 295, 792)).toBe(220);
    expect(resolveSectionContextMenuTop(-20, 295, 792)).toBe(8);

    // Les regles .estimate-* ont ete extraites de globals.css vers cette
    // feuille dediee, qui reste hors @layer pour preserver la cascade.
    const css = readFileSync(
      join(process.cwd(), "src/styles/estimate-frozen.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.estimate-supplier-comparison-context-menu \{[\s\S]*?max-height: calc\(100dvh - 16px\);[\s\S]*?overflow-y: auto;/,
    );
  });
});
