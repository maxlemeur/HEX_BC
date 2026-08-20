"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import { updateAffaireProjectMetadataAction } from "@/app/dashboard/affaires/_actions/project";
import {
  AffaireProjectDetailsCard,
  type AffaireProjectDetailsValues,
} from "@/components/affaires/AffaireProjectDetailsCard";
import { ProjectIconPicker, type ProjectIconKey } from "@/components/affaires/ProjectIconPicker";
import { useToast } from "@/components/ui-legacy/Toast";

type AffairePersistedProjectDetailsProps = {
  projectId: string;
  initialValues: AffaireProjectDetailsValues;
  /** External control of edit mode */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  /** DOM element to portal edit action buttons into (e.g. breadcrumb bar) */
  actionsPortalTarget?: HTMLElement | null;
  /** Toolbar slot rendered below the project details (e.g. ActionBar) */
  toolbar?: React.ReactNode;
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
  editing,
  onEditingChange,
  actionsPortalTarget,
  toolbar,
}: Readonly<AffairePersistedProjectDetailsProps>) {
  const toast = useToast();
  const [isPending, startTransition] = useTransition();
  const [internalMode, setInternalMode] = useState<"view" | "edit">("view");

  // Support controlled and uncontrolled mode
  const mode = editing !== undefined ? (editing ? "edit" : "view") : internalMode;
  const setMode = (m: "view" | "edit") => {
    setInternalMode(m);
    onEditingChange?.(m === "edit");
  };
  const [savedValues, setSavedValues] =
    useState<AffaireProjectDetailsValues>(initialValues);
  const [draftValues, setDraftValues] =
    useState<AffaireProjectDetailsValues>(initialValues);
  const [projectIcon, setProjectIcon] = useState<ProjectIconKey>("building");
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

  const cancel = () => {
    setDraftValues(savedValues);
    setProjectNameError(null);
    setErrorMessage(null);
    setMode("view");
  };

  const editButtons = mode === "edit" ? (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn btn-ghost btn-lg"
        onClick={cancel}
        disabled={isPending}
      >
        Annuler
      </button>
      <button
        type="button"
        className="btn btn-primary btn-lg"
        onClick={save}
        disabled={isPending}
      >
        {isPending ? "Enregistrement…" : "Enregistrer"}
      </button>
    </div>
  ) : null;

  return (
    <>
      {editButtons && actionsPortalTarget
        ? createPortal(editButtons, actionsPortalTarget)
        : editButtons}
      <AffaireProjectDetailsCard
        mode={mode}
        description="Renseignez ou corrigez le contexte projet sans quitter l'affaire."
        values={mode === "view" ? savedValues : draftValues}
        iconKey={projectIcon}
        iconSlot={
          mode === "edit"
            ? <ProjectIconPicker value={projectIcon} onChange={setProjectIcon} />
            : undefined
        }
        projectNameError={projectNameError}
        errorMessage={errorMessage}
        footer={mode === "view" ? toolbar : undefined}
        onEdit={mode === "view" ? () => setMode("edit") : undefined}
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
    </>
  );
}
