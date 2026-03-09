import { describe, expect, it } from "vitest";

import {
  getBusinessLevelLabel,
  getBusinessStatusLabel,
  getConfidenceLabel,
  getConfidenceBadgeVariant,
  isCoverageLow,
} from "./takeoff-job-list-shared";

describe("getBusinessLevelLabel", () => {
  it("maps A to Rapide", () => {
    expect(getBusinessLevelLabel("A")).toBe("Rapide");
  });

  it("maps B to Standard", () => {
    expect(getBusinessLevelLabel("B")).toBe("Standard");
  });

  it("maps C to Detaille", () => {
    expect(getBusinessLevelLabel("C")).toBe("Detaille");
  });

  it("returns raw value for unknown level", () => {
    expect(getBusinessLevelLabel("X")).toBe("X");
  });
});

describe("getBusinessStatusLabel", () => {
  it("maps completed to Analyse terminee", () => {
    expect(getBusinessStatusLabel("completed")).toBe("Analyse terminee");
  });

  it("maps processing to Analyse en cours", () => {
    expect(getBusinessStatusLabel("processing")).toBe("En traitement");
  });

  it("maps queued to En file", () => {
    expect(getBusinessStatusLabel("queued")).toBe("En file");
  });

  it("maps provider_pending to En attente provider", () => {
    expect(getBusinessStatusLabel("provider_pending")).toBe("En attente provider");
  });

  it("maps review_required to Revue requise", () => {
    expect(getBusinessStatusLabel("review_required")).toBe("Revue requise");
  });

  it("maps action_required to Echec a corriger", () => {
    expect(getBusinessStatusLabel("action_required")).toBe("Echec a corriger");
  });

  it("returns raw value for unknown status", () => {
    expect(getBusinessStatusLabel("unknown")).toBe("unknown");
  });
});

describe("getConfidenceLabel", () => {
  it("returns Elevee for >= 0.8", () => {
    expect(getConfidenceLabel(0.9)).toBe("Elevee");
    expect(getConfidenceLabel(0.8)).toBe("Elevee");
    expect(getConfidenceLabel(1.0)).toBe("Elevee");
  });

  it("returns Moyenne for 0.5-0.79", () => {
    expect(getConfidenceLabel(0.6)).toBe("Moyenne");
    expect(getConfidenceLabel(0.5)).toBe("Moyenne");
    expect(getConfidenceLabel(0.79)).toBe("Moyenne");
  });

  it("returns Faible for < 0.5", () => {
    expect(getConfidenceLabel(0.3)).toBe("Faible");
    expect(getConfidenceLabel(0.0)).toBe("Faible");
    expect(getConfidenceLabel(0.49)).toBe("Faible");
  });

  it("returns Inconnue for null", () => {
    expect(getConfidenceLabel(null)).toBe("Inconnue");
  });
});

describe("getConfidenceBadgeVariant", () => {
  it("maps Elevee to success", () => {
    expect(getConfidenceBadgeVariant("Elevee")).toBe("success");
  });

  it("maps Moyenne to warning", () => {
    expect(getConfidenceBadgeVariant("Moyenne")).toBe("warning");
  });

  it("maps Faible to error", () => {
    expect(getConfidenceBadgeVariant("Faible")).toBe("error");
  });

  it("maps unknown to neutral", () => {
    expect(getConfidenceBadgeVariant("Inconnue")).toBe("neutral");
    expect(getConfidenceBadgeVariant("anything")).toBe("neutral");
  });
});

describe("isCoverageLow", () => {
  it("returns true below 50%", () => {
    expect(isCoverageLow(30)).toBe(true);
    expect(isCoverageLow(0)).toBe(true);
    expect(isCoverageLow(49)).toBe(true);
  });

  it("returns false at 50% and above", () => {
    expect(isCoverageLow(50)).toBe(false);
    expect(isCoverageLow(72)).toBe(false);
    expect(isCoverageLow(100)).toBe(false);
  });
});
