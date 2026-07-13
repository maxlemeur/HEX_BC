import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveEstimateEditorGridStyle } from "@/components/estimates/EstimateEditorTable";
import type { ColumnKey } from "@/hooks/useColumnVisibility";

const ALL_OPTIONAL_COLUMNS = new Set<ColumnKey>([
  "supply_type",
  "k_fo",
  "h_mo_majoration",
  "labor_role",
  "k_mo",
]);

function toCustomProperties(style: ReturnType<typeof resolveEstimateEditorGridStyle>) {
  return style as Record<string, string> | undefined;
}

describe("estimate editor responsive grid", () => {
  it("provides distinct desktop and tablet tracks for every visible column", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, false)
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(320px, 3fr) 80px 80px 110px 140px 88px 80px 130px 130px 92px 110px 120px 50px",
      "--estimate-grid-tablet":
        "minmax(240px, 3fr) 70px 70px 90px 120px 76px 70px 110px 110px 80px 90px 100px 44px",
      "--estimate-desktop-min-width": "1530px",
      "--estimate-tablet-min-width": "1270px",
    });
    expect(style).not.toHaveProperty("--estimate-grid");
  });

  it("removes hidden optional columns from both responsive grids", () => {
    const style = toCustomProperties(
      resolveEstimateEditorGridStyle(new Set<ColumnKey>(), false)
    );

    expect(style).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(320px, 3fr) 80px 80px 110px 80px 110px 120px 50px",
      "--estimate-grid-tablet":
        "minmax(240px, 3fr) 70px 70px 90px 70px 90px 100px 44px",
      "--estimate-desktop-min-width": "950px",
      "--estimate-tablet-min-width": "900px",
    });
  });

  it("keeps the dedicated labor split grid untouched", () => {
    expect(
      resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, true)
    ).toBeUndefined();
  });

  it("keeps the stylesheet contract that activates tablet and sticky tracks", () => {
    const css = readFileSync(
      join(process.cwd(), "src/app/globals.css"),
      "utf8"
    );

    expect(css).toContain("--estimate-grid: var(--estimate-grid-desktop);");
    expect(css).toMatch(
      /@media \(min-width: 768px\) and \(max-width: 1024px\)[\s\S]*?--estimate-grid: var\(--estimate-grid-tablet\);/
    );
    expect(css).toMatch(
      /\.estimate-row \.estimate-cell--designation \{[\s\S]*?position: sticky;[\s\S]*?left: 0;/
    );
    expect(css).toMatch(
      /\.estimate-row--section \.estimate-cell--designation \{[\s\S]*?position: sticky;/
    );
    expect(css).toMatch(
      /\.estimate-line-truth__badge \{[\s\S]*?white-space: nowrap;/
    );
    expect(css).toMatch(
      /@media \(max-width: 1440px\)[\s\S]*?\.estimate-line-truth__badge \{[\s\S]*?padding-inline: 5px;[\s\S]*?font-size: 10px;/
    );
  });

  it("stacks checklist and toolbar instead of squeezing them on mobile", () => {
    const chromeSource = readFileSync(
      join(
        process.cwd(),
        "src/components/estimates/components/estimate-editor-table/EstimateEditorTableChrome.tsx"
      ),
      "utf8"
    );
    const checklistSource = readFileSync(
      join(process.cwd(), "src/components/estimates/EstimateChecklist.tsx"),
      "utf8"
    );

    expect(chromeSource).toContain(
      "flex flex-col gap-3 md:flex-row md:items-start md:gap-4"
    );
    expect(chromeSource).toContain(
      "order-2 w-full min-w-0 flex-1 md:order-1"
    );
    expect(chromeSource).toContain(
      "order-1 w-full md:order-2 md:w-auto md:shrink-0"
    );
    expect(checklistSource).toContain(
      "dashboard-card h-fit w-full p-3 sm:p-4 md:min-w-[260px]"
    );
  });
});
