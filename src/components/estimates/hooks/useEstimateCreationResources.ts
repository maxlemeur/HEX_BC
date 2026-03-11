"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchAffaireLinkedDpgfSource,
  fetchEstimateTemplates,
} from "@/lib/estimates/client";
import {
  hasImportableLinkedDpgfSource,
  type WizardData,
} from "@/components/estimates/estimate-creation-wizard/shared";

import type { StepErrors } from "@/components/estimates/estimate-creation-wizard/shared";
import type {
  AffaireLinkedDpgfSource,
  EstimateTemplateSummary,
} from "@/lib/estimates/client";
import type { Dispatch, SetStateAction } from "react";

type UseEstimateCreationResourcesArgs = {
  projectId?: string;
  setData: Dispatch<SetStateAction<WizardData>>;
  setErrors: Dispatch<SetStateAction<StepErrors>>;
};

export function useEstimateCreationResources({
  projectId,
  setData,
  setErrors,
}: UseEstimateCreationResourcesArgs) {
  const [templates, setTemplates] = useState<EstimateTemplateSummary[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [linkedDpgfSource, setLinkedDpgfSource] =
    useState<AffaireLinkedDpgfSource>(null);
  const [isLoadingLinkedDpgfSource, setIsLoadingLinkedDpgfSource] =
    useState(Boolean(projectId));
  const [linkedDpgfSourceError, setLinkedDpgfSourceError] = useState<string | null>(null);

  const hasTemplates = templates.length > 0;
  const templateModeDisabled = !hasTemplates;
  const templateModeUnavailable = !isLoadingTemplates && !hasTemplates;
  const hasLinkedDpgfSource = hasImportableLinkedDpgfSource(linkedDpgfSource);

  useEffect(() => {
    let mounted = true;

    async function loadTemplates() {
      setIsLoadingTemplates(true);
      setTemplatesError(null);
      try {
        const list = await fetchEstimateTemplates({ limit: 10, order: "recent" });
        if (!mounted) return;
        setTemplates(list);
      } catch (error) {
        if (!mounted) return;
        setTemplatesError(
          error instanceof Error
            ? error.message
            : "Impossible de charger les templates."
        );
      } finally {
        if (mounted) setIsLoadingTemplates(false);
      }
    }

    void loadTemplates();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!projectId) {
      setLinkedDpgfSource(null);
      setLinkedDpgfSourceError(null);
      setIsLoadingLinkedDpgfSource(false);
      setData((prev) =>
        prev.dpgfImportMode === "source"
          ? { ...prev, dpgfImportMode: "none" }
          : prev
      );
      return;
    }

    const linkedProjectId = projectId;
    let mounted = true;
    setIsLoadingLinkedDpgfSource(true);
    setLinkedDpgfSourceError(null);

    async function loadLinkedSource() {
      try {
        const source = await fetchAffaireLinkedDpgfSource(linkedProjectId);
        if (!mounted) return;

        setLinkedDpgfSource(source);
        if (hasImportableLinkedDpgfSource(source)) {
          setData((prev) =>
            prev.dpgfImportMode === "none"
              ? { ...prev, dpgfImportMode: "source" }
              : prev
          );
          return;
        }

        setData((prev) =>
          prev.dpgfImportMode === "source"
            ? { ...prev, dpgfImportMode: "none" }
            : prev
        );
      } catch (error) {
        if (!mounted) return;
        setLinkedDpgfSource(null);
        setLinkedDpgfSourceError(
          error instanceof Error
            ? error.message
            : "Impossible de charger la source DPGF de l'affaire."
        );
      } finally {
        if (mounted) setIsLoadingLinkedDpgfSource(false);
      }
    }

    void loadLinkedSource();

    return () => {
      mounted = false;
    };
  }, [projectId, setData]);

  useEffect(() => {
    if (hasTemplates) return;
    setData((prev) => {
      if (prev.creationMode !== "template" || prev.selectedTemplateId) {
        return prev;
      }
      return {
        ...prev,
        creationMode: "blank",
      };
    });
  }, [hasTemplates, setData]);

  useEffect(() => {
    if (!templateModeUnavailable) return;
    setData((prev) => {
      if (prev.creationMode !== "template" && !prev.selectedTemplateId) {
        return prev;
      }
      return {
        ...prev,
        creationMode: "blank",
        selectedTemplateId: "",
      };
    });
    setErrors((prev) => {
      if (!prev.selectedTemplateId) return prev;
      const next = { ...prev };
      delete next.selectedTemplateId;
      return next;
    });
  }, [templateModeUnavailable, setData, setErrors]);

  return useMemo(
    () => ({
      templates,
      isLoadingTemplates,
      templatesError,
      linkedDpgfSource,
      isLoadingLinkedDpgfSource,
      linkedDpgfSourceError,
      templateModeDisabled,
      templateModeUnavailable,
      hasLinkedDpgfSource,
    }),
    [
      hasLinkedDpgfSource,
      isLoadingLinkedDpgfSource,
      isLoadingTemplates,
      linkedDpgfSource,
      linkedDpgfSourceError,
      templateModeDisabled,
      templateModeUnavailable,
      templates,
      templatesError,
    ]
  );
}
