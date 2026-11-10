import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RuleForcingTable } from "@/components/takeoff/metrics/TakeoffMetricsDashboardTables";
import type { TakeoffRuleForcingRow } from "@/lib/takeoff/types";

// TI-686 D10: the admin metrics page has no journey; the rate it publishes per rule is read here as displayed.

afterEach(cleanup);

const row = (rule: TakeoffRuleForcingRow["rule"], label: string, failedLines: number, forcedLines: number,
  falsePositiveLines: number, falsePositiveRate: number | null): TakeoffRuleForcingRow =>
  ({ rule, label, failedLines, forcedLines, falsePositiveLines, falsePositiveRate });

describe("RuleForcingTable", () => {
  it("shows the observed rate with its count n/N, and no rate where no applied line failed", () => {
    render(<RuleForcingTable data={{ forcedLines: 6, rows: [
      row("dn_network", "DN et réseau", 11, 5, 3, 27.3),
      row("scale_dimension", "Échelle et cotes", 5, 0, 0, 0),
      row("room_overlap", "Pièces qui se chevauchent", 0, 0, 0, null),
    ] }} />);

    const table = screen.getByRole("table");
    const header = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(header).toEqual(["Règle", "Lignes en échec appliquées", "Forcées", "Faux positifs déclarés au forçage",
      "Taux observé (n/N)"]);
    const cells = (label: string) => within(screen.getByRole("row", { name: new RegExp(label) }))
      .getAllByRole("cell").map((cell) => cell.textContent);
    expect(cells("DN et réseau")).toEqual(["DN et réseau", "11", "5", "3", "27,3 % (3/11)"]);
    expect(cells("Échelle et cotes")).toEqual(["Échelle et cotes", "5", "0", "0", "0 % (0/5)"]);
    expect(cells("Pièces qui se chevauchent")).toEqual(["Pièces qui se chevauchent", "0", "0", "0", "-"]);
    expect(screen.getByText("Taux observé sur l’effectif affiché : un indicateur, pas une borne de fiabilité."))
      .toBeTruthy();
  });

  it("says so when no line was forced on the period", () => {
    render(<RuleForcingTable data={{ forcedLines: 0, rows: [row("dn_network", "DN et réseau", 2, 0, 0, 0)] }} />);

    expect(screen.getByText("Aucune ligne forcée sur la période.")).toBeTruthy();
    expect(screen.getByRole("row", { name: /DN et réseau/ })).toBeTruthy();
  });
});
