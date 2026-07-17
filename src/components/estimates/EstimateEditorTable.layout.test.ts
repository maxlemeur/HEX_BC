import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveEstimateEditorGridStyle } from "@/components/estimates/EstimateEditorTable";
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
  it("provides distinct desktop and tablet tracks for every visible column", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, false),
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(260px, 3fr) 64px 54px 88px 112px 64px 64px 104px 112px 64px 88px 100px 42px",
      "--estimate-grid-tablet":
        "minmax(220px, 3fr) 58px 50px 80px 100px 60px 60px 96px 100px 60px 82px 94px 40px",
      "--estimate-desktop-min-width": "1216px",
      "--estimate-tablet-min-width": "1100px",
    });
    expect(style).not.toHaveProperty("--estimate-grid");
  });

  it("removes hidden optional columns from both responsive grids", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(new Set<ColumnKey>(), false),
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(260px, 3fr) 64px 54px 88px 64px 88px 100px 42px",
      "--estimate-grid-tablet":
        "minmax(220px, 3fr) 58px 50px 80px 60px 82px 94px 40px",
      "--estimate-desktop-min-width": "760px",
      "--estimate-tablet-min-width": "900px",
    });
  });

  it("keeps the dedicated labor split grid untouched", () => {
    expect(
      resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, true),
    ).toBeUndefined();
  });

  it("keeps the stylesheet contract that activates tablet and sticky tracks", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(css).toContain("--estimate-grid: var(--estimate-grid-desktop);");
    expect(css).toContain("--density-row-h: 30px;");
    expect(css).toContain("--density-cell-px: 6px;");
    expect(css).toContain("--density-cell-py: 2px;");
    expect(css).toMatch(
      /@media \(min-width: 1025px\)[\s\S]*?\.estimate-table \.estimate-line-designation \{[\s\S]*?flex-direction: row;[\s\S]*?\.estimate-table \.estimate-line-truth__badge \{[\s\S]*?width: 10px;/,
    );
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1024px\)[\s\S]*?--estimate-grid: var\(--estimate-grid-tablet\);/,
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
      /\.estimate-catalogue-suggestions \{[\s\S]*?position: absolute;[\s\S]*?top: calc\(100% \+ 6px\);[\s\S]*?z-index: 30;/,
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

    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8",
    );

    expect(css).toMatch(
      /\.estimate-supplier-comparison-context-menu \{[\s\S]*?max-height: calc\(100dvh - 16px\);[\s\S]*?overflow-y: auto;/,
    );
  });
});
