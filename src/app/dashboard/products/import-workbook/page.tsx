"use client";

import { useDashboardAssistant } from "@/components/assistant/AssistantDock";
import WorkbookImportWorkspace from "@/components/products/costing-workbook/WorkbookImportWorkspace";

export default function ImportCostingWorkbookPage() {
  const assistant = useDashboardAssistant();
  return assistant ? null : <WorkbookImportWorkspace />;
}
