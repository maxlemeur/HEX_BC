"use client";

import { createContext, useContext, type ReactNode } from "react";

export type EstimateEditorContextState = {
  visibleLineIdList: string[];
  selectedLineIdList: string[];
  selectedLineCount: number;
  hasSelectedLines: boolean;
  allVisibleSelected: boolean;
  bulkMajorationPercent: string;
  bulkMoveParentId: string;
  bulkCategoryId: string;
  bulkLaborRoleId: string;
};

export type EstimateEditorContextActions = {
  setBulkMajorationPercent: (value: string) => void;
  setBulkMoveParentId: (value: string) => void;
  setBulkCategoryId: (value: string) => void;
  setBulkLaborRoleId: (value: string) => void;
  toggleAllVisibleLines: (checked: boolean) => void;
  clearLineSelection: () => void;
};

export type EstimateEditorContextMeta = {
  hasVisibleRows: boolean;
  isReadOnly: boolean;
};

type EstimateEditorContextValue = {
  state: EstimateEditorContextState;
  actions: EstimateEditorContextActions;
  meta: EstimateEditorContextMeta;
};

const EstimateEditorContext = createContext<EstimateEditorContextValue | null>(null);

type EstimateEditorProviderProps = {
  value: EstimateEditorContextValue;
  children: ReactNode;
};

export function EstimateEditorProvider({
  value,
  children,
}: EstimateEditorProviderProps) {
  return (
    <EstimateEditorContext.Provider value={value}>
      {children}
    </EstimateEditorContext.Provider>
  );
}

export function useEstimateEditorContext() {
  const context = useContext(EstimateEditorContext);
  if (!context) {
    throw new Error("Estimate editor context is unavailable outside provider.");
  }
  return context;
}

export function useEstimateEditorActions() {
  return useEstimateEditorContext().actions;
}

export function useEstimateEditorMeta() {
  return useEstimateEditorContext().meta;
}
