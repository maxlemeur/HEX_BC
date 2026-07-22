"use client";

import { useCallback, useMemo, useState } from "react";

export const ESTIMATE_LINE_TRUTH_INDICATOR_KEYS = [
  "source",
  "quantity",
  "confidence",
] as const;

export type EstimateLineTruthIndicatorKey =
  (typeof ESTIMATE_LINE_TRUTH_INDICATOR_KEYS)[number];

export type EstimateLineTruthVisibility = Record<
  EstimateLineTruthIndicatorKey,
  boolean
>;

export const DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY: EstimateLineTruthVisibility =
  {
    source: true,
    quantity: true,
    confidence: true,
  };

const STORAGE_KEY = "estimate-line-truth-visibility:v1";

function parseStoredVisibility(value: string | null): EstimateLineTruthVisibility {
  if (!value) {
    return DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY;
  }

  try {
    const parsed = JSON.parse(value) as Partial<EstimateLineTruthVisibility>;
    return {
      source:
        typeof parsed.source === "boolean"
          ? parsed.source
          : DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY.source,
      quantity:
        typeof parsed.quantity === "boolean"
          ? parsed.quantity
          : DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY.quantity,
      confidence:
        typeof parsed.confidence === "boolean"
          ? parsed.confidence
          : DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY.confidence,
    };
  } catch {
    return DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY;
  }
}

function loadVisibilityFromStorage() {
  if (typeof window === "undefined") {
    return DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY;
  }

  try {
    return parseStoredVisibility(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_ESTIMATE_LINE_TRUTH_VISIBILITY;
  }
}

function saveVisibilityToStorage(visibility: EstimateLineTruthVisibility) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    // L'affichage reste utilisable si le stockage du navigateur est indisponible.
  }
}

export function useEstimateLineTruthVisibility() {
  const [visibility, setVisibility] = useState<EstimateLineTruthVisibility>(
    loadVisibilityFromStorage,
  );

  const toggleIndicator = useCallback(
    (indicator: EstimateLineTruthIndicatorKey) => {
      setVisibility((current) => {
        const next = {
          ...current,
          [indicator]: !current[indicator],
        };
        saveVisibilityToStorage(next);
        return next;
      });
    },
    [],
  );

  return useMemo(
    () => ({ visibility, toggleIndicator }),
    [toggleIndicator, visibility],
  );
}
