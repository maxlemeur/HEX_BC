"use client";

import { useState } from "react";

import { Button } from "@/components/ui-legacy/Button";
import { Input } from "@/components/ui-legacy/Input";
import { Modal } from "@/components/ui-legacy/Modal";
import { useToast } from "@/components/ui-legacy/Toast";
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
  const toast = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function openModal() {
    setNameError(null);
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
      setNameError("Le nom du template est obligatoire.");
      return;
    }

    setNameError(null);
    setIsSubmitting(true);

    try {
      await createEstimateTemplate({
        sourceVersionId: versionId,
        name: trimmedName,
        description: description.trim() || null,
      });

      setIsSubmitting(false);
      setIsOpen(false);
      toast.success({
        title: "Template enregistre",
        description: "Le modèle a été ajouté à votre bibliothèque.",
      });
    } catch (error) {
      setIsSubmitting(false);
      toast.error({
        title: "Enregistrement impossible",
        description:
          error instanceof Error ? error.message : "Impossible d'enregistrer le template.",
      });
    }
  }

  return (
    <>
      <Button className={className} variant="secondary" size="sm" type="button" onClick={openModal}>
        Sauvegarder comme modele
      </Button>

      <Modal.Root open={isOpen} onOpenChange={setIsOpen}>
        <Modal.Content className="max-w-xl">
          <Modal.Header>
            <div>
              <Modal.Title>Sauvegarder comme modele</Modal.Title>
              <p className="mt-1 text-sm text-[var(--slate-500)]">
                Le modele reprend sections, lignes et parametres de cette version.
              </p>
            </div>
            <Modal.Close disabled={isSubmitting} />
          </Modal.Header>

          <form className="grid gap-4" onSubmit={onSubmit}>
            <Input
              id="template-name"
              label="Nom du modèle *"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) {
                  setNameError(null);
                }
              }}
              error={nameError ?? undefined}
              required
            />

            <div>
              <label className="block text-xs font-semibold text-[var(--slate-700)]" htmlFor="template-description">
                Description
              </label>
              <textarea
                id="template-description"
                className="form-input form-textarea mt-1"
                placeholder="Optionnel"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <Modal.Footer>
              <Button type="button" variant="secondary" onClick={closeModal} disabled={isSubmitting}>
                Annuler
              </Button>
              <Button type="submit" loading={isSubmitting}>
                {isSubmitting ? "Enregistrement..." : "Enregistrer"}
              </Button>
            </Modal.Footer>
          </form>
        </Modal.Content>
      </Modal.Root>
    </>
  );
}
