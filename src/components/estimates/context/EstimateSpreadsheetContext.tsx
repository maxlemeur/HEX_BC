"use client";

import { createContext, useContext, type ReactNode } from "react";

import { type SpreadsheetNavigationResult } from "@/hooks/useSpreadsheetNavigation";

type EstimateSpreadsheetContextValue = SpreadsheetNavigationResult;

const EstimateSpreadsheetContext =
  createContext<EstimateSpreadsheetContextValue | null>(null);

type EstimateSpreadsheetProviderProps = {
  navigation: EstimateSpreadsheetContextValue;
  children: ReactNode;
};

export function EstimateSpreadsheetProvider({
  navigation,
  children,
}: EstimateSpreadsheetProviderProps) {
  return (
    <EstimateSpreadsheetContext.Provider value={navigation}>
      {children}
    </EstimateSpreadsheetContext.Provider>
  );
}

export function useEstimateSpreadsheetNavigation() {
  const context = useContext(EstimateSpreadsheetContext);
  if (!context) {
    throw new Error(
      "Estimate spreadsheet context is unavailable outside provider."
    );
  }
  return context;
}
