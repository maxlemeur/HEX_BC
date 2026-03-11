"use client";

import { useEffect, useState, useTransition } from "react";

import { updateAffaireProjectMetadataAction } from "@/app/dashboard/affaires/_actions/project";
import {
  AffaireProjectDetailsCard,
  type AffaireProjectDetailsValues,
} from "@/components/affaires/AffaireProjectDetailsCard";
import { useToast } from "@/components/ui/Toast";

type AffairePersistedProjectDetailsProps = {
  projectId: string;
  initialValues: AffaireProjectDetailsValues;
};

function validateProjectName(value: string) {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "Le nom du projet est obligatoire.";
  }
  if (trimmed.length > 200) {
    return "Le nom du projet ne doit pas depasser 200 caracteres.";
  }
  return null;
}

export function AffairePersistedProjectDetails({
  projectId,
  initialValues,
}: Readonly<AffairePersistedProjectDetailsProps>) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [savedValues, setSavedValues] =
    useState<AffaireProjectDetailsValues>(initialValues);
  const [draftValues, setDraftValues] =
    useState<AffaireProjectDetailsValues>(initialValues);
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setSavedValues(initialValues);
    setDraftValues(initialValues);
  }, [initialValues]);

  const save = () => {
    const nextError = validateProjectName(draftValues.projectName);
    if (nextError) {
      setProjectNameError(nextError);
      return;
    }

    startTransition(async () => {
      try {
        const result = await updateAffaireProjectMetadataAction({
          projectId,
          projectName: draftValues.projectName,
          clientName: draftValues.clientName || null,
          reference: draftValues.reference || null,
        });

        const nextValues = {
          projectName: result.projectName,
          clientName: result.clientName ?? "",
          reference: result.reference ?? "",
        };

        setSavedValues(nextValues);
        setDraftValues(nextValues);
        setMode("view");
        setErrorMessage(null);
        setProjectNameError(null);
        toast.success({ title: "Affaire mise a jour" });
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Impossible de mettre a jour l'affaire."
        );
      }
    });
  };

  return (
    <AffaireProjectDetailsCard
      mode={mode}
      description="Renseignez ou corrigez le contexte projet sans quitter l'affaire."
      values={mode === "view" ? savedValues : draftValues}
      projectNameError={projectNameError}
      errorMessage={errorMessage}
      primaryAction={
        mode === "view"
          ? {
              label: "Modifier",
              onClick: () => {
                setDraftValues(savedValues);
                setProjectNameError(null);
                setErrorMessage(null);
                setMode("edit");
              },
            }
          : {
              label: "Enregistrer",
              onClick: save,
              loading: isPending,
            }
      }
      secondaryAction={
        mode === "edit"
          ? {
              label: "Annuler",
              onClick: () => {
                setDraftValues(savedValues);
                setProjectNameError(null);
                setErrorMessage(null);
                setMode("view");
              },
              disabled: isPending,
            }
          : undefined
      }
      onProjectNameChange={(value) => {
        setDraftValues((current) => ({ ...current, projectName: value }));
        if (projectNameError) {
          setProjectNameError(null);
        }
      }}
      onClientNameChange={(value) => {
        setDraftValues((current) => ({ ...current, clientName: value }));
        if (errorMessage) {
          setErrorMessage(null);
        }
      }}
      onReferenceChange={(value) => {
        setDraftValues((current) => ({ ...current, reference: value }));
        if (errorMessage) {
          setErrorMessage(null);
        }
      }}
    />
  );
}
