"use client";

import { useMemo, useState } from "react";

import { createEstimateTemplate } from "@/lib/estimates/client";

type SaveAsTemplateButtonProps = {
  versionId: string;
  className?: string;
};

function buildDefaultTemplateName() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const year = String(now.getFullYear()).slice(-2);
  return `Template ${day}/${month}/${year}`;
}

export function SaveAsTemplateButton({ versionId, className }: SaveAsTemplateButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const buttonClassName = useMemo(() => {
    const base = "btn btn-secondary btn-sm";
    return className ? `${base} ${className}` : base;
  }, [className]);

  function openModal() {
    setActionError(null);
    setSuccessMessage(null);
    setName(buildDefaultTemplateName());
    setDescription("");
    setIsOpen(true);
  }

  function closeModal() {
    if (isSubmitting) return;
    setIsOpen(false);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!versionId || isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setActionError("Le nom du template est obligatoire.");
      return;
    }

    setActionError(null);
    setIsSubmitting(true);

    try {
      await createEstimateTemplate({
        sourceVersionId: versionId,
        name: trimmedName,
        description: description.trim() || null,
      });

      setIsSubmitting(false);
      setIsOpen(false);
      setSuccessMessage("Template enregistre avec succes.");
    } catch (error) {
      setIsSubmitting(false);
      setActionError(
        error instanceof Error ? error.message : "Impossible d'enregistrer le template."
      );
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button className={buttonClassName} type="button" onClick={openModal}>
        Sauvegarder comme modele
      </button>

      {successMessage ? (
        <div className="alert alert-success px-3 py-2 text-xs">{successMessage}</div>
      ) : null}

      {actionError ? (
        <div className="alert alert-error px-3 py-2 text-xs">{actionError}</div>
      ) : null}

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
          <div
            className="dashboard-card w-full max-w-xl p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-template-title"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="save-template-title" className="text-lg font-semibold text-[var(--slate-800)]">
                  Sauvegarder comme modele
                </h2>
                <p className="mt-1 text-sm text-[var(--slate-500)]">
                  Le modele reprend sections, lignes et parametres de cette version.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={closeModal}
                disabled={isSubmitting}
              >
                Fermer
              </button>
            </div>

            <form className="grid gap-4" onSubmit={onSubmit}>
              <div>
                <label className="form-label" htmlFor="template-name">
                  Nom du modele *
                </label>
                <input
                  id="template-name"
                  className="form-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>

              <div>
                <label className="form-label" htmlFor="template-description">
                  Description
                </label>
                <textarea
                  id="template-description"
                  className="form-input form-textarea"
                  placeholder="Optionnel"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </div>

              {actionError ? <div className="alert alert-error">{actionError}</div> : null}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={closeModal}
                  disabled={isSubmitting}
                >
                  Annuler
                </button>
                <button type="submit" className="btn btn-primary" disabled={isSubmitting}>
                  {isSubmitting ? "Enregistrement..." : "Enregistrer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
