import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { RowExclusions } from "@/components/products/costing-workbook/RowExclusions";
import { inspectCostingWorkbookColumns } from "@/lib/catalogue/costing-workbook";

import DashboardAssistantWorkspace from "./DashboardAssistantWorkspace";
import { useDashboardAssistant } from "./dock-context";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/products/import-workbook",
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/app/dashboard/_actions/assistant", () => ({
  loadAssistantAiOptions: vi.fn(async () => ({ ok: false, message: "Aucune source IA configurée." })),
}));

const rows = [
  ["ID", "Type_ligne", "Caractéristique", "Matériau", "Unité", "PR. FO"],
  ["TUBE-20", "Art", "Tube", "Inox", "m", 10],
];
const inspection = inspectCostingWorkbookColumns(rows);

function WorkbookPage({ loaded }: { loaded: boolean }) {
  const setHeaderTarget = useDashboardAssistant()?.setHeaderTarget;
  return <>
    <div ref={setHeaderTarget} />
    {loaded ? <RowExclusions rows={rows} originalRows={rows} inspection={inspection} disabled={false} onApply={vi.fn()} /> : null}
  </>;
}

it("offers analysis for a freshly loaded workbook from the conversation settings", async () => {
  const user = userEvent.setup();
  const workspace = (loaded: boolean) => <DashboardAssistantWorkspace userId="fixture-user" tenantId="fixture-tenant">
    <WorkbookPage loaded={loaded} />
  </DashboardAssistantWorkspace>;
  const { rerender } = render(workspace(false));
  await user.click(screen.getByRole("button", { name: "Assistant MergeOne" }));
  const settings = await screen.findByRole("button", { name: "Réglages IA" });
  await user.click(settings);
  expect(screen.queryByRole("button", { name: "Analyse du classeur" })).not.toBeInTheDocument();

  rerender(workspace(true));
  await user.click(await screen.findByRole("button", { name: "Analyse du classeur", pressed: false }));

  expect(screen.getByRole("textbox", { name: "Quelles lignes souhaitez-vous supprimer ?" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Conversation" }));
  expect(screen.getByRole("textbox", { name: "Votre message à l’assistant" })).toBeVisible();
});
