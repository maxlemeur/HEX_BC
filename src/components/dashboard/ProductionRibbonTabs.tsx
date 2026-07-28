"use client";

import { useCallback, useRef } from "react";

export type ProductionRibbonTab = {
  id: string;
  label: string;
  panelId: string;
  badge?: number;
};

export function ProductionRibbonTabs({
  tabs,
  activeTab,
  onTabChange,
  ariaLabel,
}: Readonly<{
  tabs: ProductionRibbonTab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  ariaLabel: string;
}>) {
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());

  const moveFocus = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const activeIndex = tabs.findIndex((tab) => tab.id === activeTab);
      let nextIndex = activeIndex;

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        nextIndex = (activeIndex + 1) % tabs.length;
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        nextIndex = (activeIndex - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      event.preventDefault();
      const nextTab = tabs[nextIndex];
      onTabChange(nextTab.id);
      buttonRefs.current.get(nextTab.id)?.focus();
    },
    [activeTab, onTabChange, tabs]
  );

  return (
    <div
      className="production-ribbon__tabs"
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={moveFocus}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            ref={(element) => {
              if (element) {
                buttonRefs.current.set(tab.id, element);
              } else {
                buttonRefs.current.delete(tab.id);
              }
            }}
            id={`${tab.panelId}-tab`}
            type="button"
            role="tab"
            className="production-ribbon__tab"
            aria-selected={isActive}
            aria-controls={tab.panelId}
            tabIndex={isActive ? 0 : -1}
            data-active={isActive ? "true" : undefined}
            onClick={() => onTabChange(tab.id)}
          >
            {tab.label}
            {typeof tab.badge === "number" && tab.badge > 0 ? (
              <span className="production-ribbon__tab-badge">{tab.badge}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
