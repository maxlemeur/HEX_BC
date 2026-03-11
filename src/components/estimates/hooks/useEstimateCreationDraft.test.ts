import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  STORAGE_KEY,
  initialWizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";
import {
  clearEstimateCreationDraft,
  useEstimateCreationDraft,
} from "@/components/estimates/hooks/useEstimateCreationDraft";

describe("useEstimateCreationDraft", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("restores and persists the normalized draft", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        projectName: "Projet relu",
        creationMode: "template",
        selectedTemplateId: "tpl-1",
        dpgfImportMode: "later",
      })
    );

    const { result } = renderHook(() => useEstimateCreationDraft());

    expect(result.current.data.projectName).toBe("Projet relu");
    expect(result.current.data.creationMode).toBe("template");
    expect(result.current.data.dpgfImportMode).toBe("source");

    act(() => {
      result.current.updateField("title", "Version A");
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual(
      expect.objectContaining({
        projectName: "Projet relu",
        title: "Version A",
        creationMode: "template",
        selectedTemplateId: "tpl-1",
        dpgfImportMode: "source",
      })
    );
  });

  it("invalidates current and future validated steps when a field changes", () => {
    const { result } = renderHook(() => useEstimateCreationDraft());

    act(() => {
      result.current.markStepValidated(0);
      result.current.markStepValidated(1);
      result.current.markStepValidated(2);
    });

    act(() => {
      result.current.updateField("taxRateBp", "550");
    });

    expect([...result.current.validatedSteps]).toEqual([0]);
  });

  it("validates the current step and skips project-name validation for an existing project", () => {
    const { result: creationResult } = renderHook(() =>
      useEstimateCreationDraft()
    );

    act(() => {
      expect(creationResult.current.validateStep(0)).toBe(false);
    });

    expect(creationResult.current.errors.projectName).toBe("Champ obligatoire.");

    const { result: projectResult } = renderHook(() =>
      useEstimateCreationDraft("project-1")
    );

    act(() => {
      projectResult.current.setData((prev) => ({
        ...initialWizardData(),
        ...prev,
        projectName: "",
        title: "Version existante",
      }));
    });

    act(() => {
      expect(projectResult.current.validateStep(0)).toBe(true);
    });

    expect(projectResult.current.errors.projectName).toBeUndefined();
  });

  it("clears the persisted draft explicitly", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projectName: "Projet" }));

    clearEstimateCreationDraft();

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
