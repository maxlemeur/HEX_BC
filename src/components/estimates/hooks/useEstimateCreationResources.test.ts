import { renderHook,waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach,describe,expect,it,vi } from "vitest";

import { initialWizardData } from "@/components/estimates/estimate-creation-wizard/shared";
import { useEstimateCreationResources } from "@/components/estimates/hooks/useEstimateCreationResources";

import type {
StepErrors,
WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

vi.mock("@/lib/estimates/client", () => ({
  fetchEstimateTemplates: vi.fn().mockResolvedValue([]),
  fetchAffaireLinkedDpgfSource: vi.fn().mockResolvedValue(null),
}));

import {
fetchEstimateTemplates
} from "@/lib/estimates/client";

function useResourcesHarness(
  projectId?: string,
  initialData?: WizardData,
  initialErrors?: StepErrors
) {
  const [data, setData] = useState(initialData ?? initialWizardData());
  const [errors, setErrors] = useState<StepErrors>(initialErrors ?? {});
  const resources = useEstimateCreationResources({
    projectId,
    setData,
    setErrors,
  });

  return {
    data,
    errors,
    resources,
  };
}

describe("useEstimateCreationResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to blank creation when templates are unavailable", async () => {
    vi.mocked(fetchEstimateTemplates).mockResolvedValueOnce([]);

    const { result } = renderHook(() =>
      useResourcesHarness(
        undefined,
        {
          ...initialWizardData(),
          creationMode: "template",
          selectedTemplateId: "tpl-123",
        },
        { selectedTemplateId: "Veuillez sélectionner un template." }
      )
    );

    await waitFor(() => {
      expect(result.current.resources.templateModeUnavailable).toBe(true);
    });

    expect(result.current.data.creationMode).toBe("blank");
    expect(result.current.data.selectedTemplateId).toBe("");
    expect(result.current.errors.selectedTemplateId).toBeUndefined();
  });

  it("resets linked DPGF mode when no project is attached", async () => {
    const { result } = renderHook(() =>
      useResourcesHarness(undefined, {
        ...initialWizardData(),
        dpgfImportMode: "source",
      })
    );

    await waitFor(() => {
      expect(result.current.resources.isLoadingLinkedDpgfSource).toBe(false);
      expect(result.current.data.dpgfImportMode).toBe("none");
    });
  });
});
