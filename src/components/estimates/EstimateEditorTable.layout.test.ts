import { describe,expect,it } from "vitest";

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

  it("ajoute la provision FO devant le K FO sur une v3 seulement (TI-534)", () => {
    const withKFo = new Set<ColumnKey>(["k_fo"]);
    expect(
      toCustomProperties(resolveEstimateEditorGridStyle(withKFo, false))?.["--estimate-grid-desktop"],
    ).toBe("minmax(300px, 3fr) 64px 54px 88px 56px 56px 88px 100px 42px");
    expect(
      toCustomProperties(
        resolveEstimateEditorGridStyle(withKFo, false, {}, undefined, true),
      ),
    ).toMatchObject({
      "--estimate-grid-desktop":
        "minmax(300px, 3fr) 64px 54px 88px 64px 56px 56px 88px 100px 42px",
      "--estimate-desktop-min-width": "912px",
    });
    // Sans K FO affiché, pas de provision non plus.
    expect(
      toCustomProperties(
        resolveEstimateEditorGridStyle(new Set<ColumnKey>(), false, {}, undefined, true),
      )?.["--estimate-grid-desktop"],
    ).toBe("minmax(300px, 3fr) 64px 54px 88px 56px 88px 100px 42px");
    // En MO éclatée, les colonnes de coût sont forcées : la provision aussi.
    expect(
      toCustomProperties(
        resolveEstimateEditorGridStyle(ALL_OPTIONAL_COLUMNS, true, {}, undefined, true),
      )?.["--estimate-grid-desktop"],
    ).toBe(
      "minmax(300px, 3fr) 64px 54px 88px 112px 64px 60px 96px 72px 104px 60px 72px 104px 60px 88px 100px 42px",
    );
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

  it("keeps section menus inside the viewport using their measured height", () => {
    expect(resolveSectionContextMenuTop(760, 295, 792)).toBe(489);
    expect(resolveSectionContextMenuTop(220, 295, 792)).toBe(220);
    expect(resolveSectionContextMenuTop(-20, 295, 792)).toBe(8);

  });
});
