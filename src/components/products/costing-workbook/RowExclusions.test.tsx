import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { AssistantDockContext, type WorkbookStatus } from "@/components/assistant/dock-context";
import { inspectCostingWorkbookColumns } from "@/lib/catalogue/costing-workbook";

import { RowExclusions } from "./RowExclusions";

it("clears the selected proposal when the assistant prepares a different criterion", async () => {
  const user = userEvent.setup();
  const rows = [
    ["ID", "Type_ligne", "Caractéristique", "Matériau", "Unité", "PR. FO", "Fiabilité (/10)"],
    ["TUBE-20", "Art", "Tube", "Inox", "m", 10, 0],
  ];
  const setWorkbookStatus = vi.fn<(status: WorkbookStatus | null) => void>();
  const workbookControls = document.createElement("div");
  render(<AssistantDockContext.Provider value={{
    register: vi.fn(), setHeaderTarget: vi.fn(), setWorkbookStatus, workbookControls, workbookActive: true, contextOptions: [],
  }}>
    <div ref={(node) => { if (node) node.appendChild(workbookControls); }} />
    <RowExclusions rows={rows} originalRows={rows} inspection={inspectCostingWorkbookColumns(rows)} disabled={false} onApply={vi.fn()} />
  </AssistantDockContext.Provider>);

  const criterion = screen.getByRole("textbox", { name: "Quelles lignes souhaitez-vous supprimer ?" });
  await user.type(criterion, "Fiabilité à zéro");
  await user.click(screen.getByRole("button", { name: "Analyser 1 ligne" }));
  const selection = within(await screen.findByRole("dialog", { name: "Lignes dont la fiabilité Excel est à zéro" }));
  await user.click(selection.getByRole("checkbox"));
  expect(selection.getByRole("button", { name: "Écarter 1 ligne de l’import" })).toBeEnabled();
  await user.click(selection.getByRole("button", { name: "Fermer les résultats" }));

  const prepared = "Écarte les lignes en acier galvanisé";
  const status = setWorkbookStatus.mock.lastCall?.[0];
  expect(status?.result).toBe(true);
  act(() => status?.prepare(prepared));

  expect(criterion).toHaveValue(prepared);
  expect(screen.queryByRole("button", { name: "Consulter les résultats de l’analyse IA" })).not.toBeInTheDocument();
  expect(setWorkbookStatus).toHaveBeenLastCalledWith(expect.objectContaining({ result: false }));
});
