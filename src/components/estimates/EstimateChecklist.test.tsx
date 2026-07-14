import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EstimateChecklist } from "@/components/estimates/EstimateChecklist";
import type { EstimateChecklistResult } from "@/lib/estimates/checklist";

afterEach(cleanup);

const checklist: EstimateChecklistResult = {
  totalCount: 5,
  completedCount: 4,
  progressPercent: 80,
  status: "blocking",
  blockingCount: 1,
  warningCount: 0,
  criteria: [
    {
      key: "prices",
      label: "Prix",
      description: "Toutes les lignes ont un prix FO valide.",
      severity: "blocking",
      status: "blocking",
      isComplete: false,
      missingCount: 1,
      totalCount: 3,
      targetItemId: "line-1",
      qualityFlag: "missing_price",
    },
    {
      key: "quantities",
      label: "Quantités",
      description: "Toutes les quantités sont renseignées.",
      severity: "blocking",
      status: "complete",
      isComplete: true,
      missingCount: 0,
      totalCount: 3,
      targetItemId: null,
      qualityFlag: "missing_quantity",
    },
    {
      key: "labor_roles",
      label: "Rôles MO",
      description: "Les rôles sont renseignés.",
      severity: "warning",
      status: "complete",
      isComplete: true,
      missingCount: 0,
      totalCount: 3,
      targetItemId: null,
      qualityFlag: "missing_labor_role",
    },
    {
      key: "margin_defined",
      label: "Marge définie",
      description: "La marge est renseignée.",
      severity: "blocking",
      status: "complete",
      isComplete: true,
      missingCount: 0,
      totalCount: 1,
      targetItemId: null,
      qualityFlag: null,
    },
    {
      key: "validity_dates",
      label: "Dates de validité",
      description: "Les dates sont renseignées.",
      severity: "warning",
      status: "complete",
      isComplete: true,
      missingCount: 0,
      totalCount: 1,
      targetItemId: null,
      qualityFlag: null,
    },
  ],
};

function renderChecklist(
  overrides?: Partial<React.ComponentProps<typeof EstimateChecklist>>,
) {
  const onToggleCollapsed = vi.fn();
  const onCriterionClick = vi.fn();
  const onShowAnomalies = vi.fn();

  render(
    <EstimateChecklist
      checklist={checklist}
      isCollapsed
      anomalyCount={3}
      affectedLineCount={2}
      onToggleCollapsed={onToggleCollapsed}
      onCriterionClick={onCriterionClick}
      onShowAnomalies={onShowAnomalies}
      {...overrides}
    />,
  );

  return { onToggleCollapsed, onCriterionClick, onShowAnomalies };
}

describe("EstimateChecklist finalization inspector", () => {
  it("shows honest, dynamic completion and anomaly counts", () => {
    renderChecklist();

    expect(
      screen.getByRole("heading", { name: "Finalisation" }),
    ).toBeInTheDocument();
    expect(screen.getByText("4/5 critères validés")).toBeInTheDocument();
    expect(screen.getByText("1 critère bloquant")).toBeInTheDocument();
    expect(screen.getByText("3 anomalies")).toBeInTheDocument();
    expect(screen.getByText("2 lignes concernées")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "80",
    );
    expect(
      screen.getByText("Le contrôle complet sera relancé lors de l’envoi."),
    ).toBeInTheDocument();
  });

  it("routes the priority and anomaly actions", () => {
    const { onCriterionClick, onShowAnomalies } = renderChecklist();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Afficher la première ligne concernée",
      }),
    );
    expect(onCriterionClick).toHaveBeenCalledWith(checklist.criteria[0]);

    fireEvent.click(
      screen.getByRole("button", { name: "Afficher les lignes concernées" }),
    );
    expect(onShowAnomalies).toHaveBeenCalledTimes(1);
  });

  it("keeps criterion details behind an explicit disclosure", () => {
    const onToggleCollapsed = vi.fn();
    const { rerender } = render(
      <EstimateChecklist
        checklist={checklist}
        isCollapsed
        anomalyCount={0}
        affectedLineCount={0}
        onToggleCollapsed={onToggleCollapsed}
        onCriterionClick={vi.fn()}
        onShowAnomalies={vi.fn()}
      />,
    );

    const disclosure = screen.getByRole("button", {
      name: /Voir les critères/,
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(disclosure);
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);

    rerender(
      <EstimateChecklist
        checklist={checklist}
        isCollapsed={false}
        anomalyCount={0}
        affectedLineCount={0}
        onToggleCollapsed={onToggleCollapsed}
        onCriterionClick={vi.fn()}
        onShowAnomalies={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Masquer les critères/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Dates de validité")).toBeInTheDocument();
  });
});
