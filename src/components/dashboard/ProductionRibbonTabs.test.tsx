import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ProductionRibbonTabs } from "@/components/dashboard/ProductionRibbonTabs";

afterEach(() => {
  cleanup();
});

const TABS = [
  { id: "estimate", label: "Chiffrage", panelId: "estimate-panel" },
  { id: "insert", label: "Insérer", panelId: "insert-panel" },
  { id: "display", label: "Affichage", panelId: "display-panel" },
];

function Harness() {
  const [activeTab, setActiveTab] = useState("estimate");
  return (
    <>
      <ProductionRibbonTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Ruban de test"
      />
      {TABS.map((tab) => (
        <div
          key={tab.id}
          id={tab.panelId}
          role="tabpanel"
          aria-labelledby={`${tab.panelId}-tab`}
          hidden={activeTab !== tab.id}
        >
          Panneau {tab.label}
        </div>
      ))}
    </>
  );
}

describe("ProductionRibbonTabs", () => {
  it("exposes the selected tab and its controlled panel", () => {
    render(<Harness />);

    const active = screen.getByRole("tab", { name: "Chiffrage" });
    expect(active).toHaveAttribute("aria-selected", "true");
    expect(active).toHaveAttribute("aria-controls", "estimate-panel");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(
      "Panneau Chiffrage"
    );
  });

  it("moves selection and focus with arrow, Home and End keys", () => {
    render(<Harness />);

    const estimateTab = screen.getByRole("tab", { name: "Chiffrage" });
    estimateTab.focus();
    fireEvent.keyDown(estimateTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Insérer" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "End" });
    expect(screen.getByRole("tab", { name: "Affichage" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(estimateTab).toHaveFocus();
  });
});
