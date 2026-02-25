"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

type PlanSetFormModalProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: { name: string; description: string | null }) => void;
  loading: boolean;
  error: string | null;
};

export function PlanSetFormModal({
  open,
  onClose,
  onSubmit,
  loading,
  error,
}: PlanSetFormModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    onSubmit({
      name: trimmedName,
      description: description.trim() || null,
    });
  }

  function handleClose() {
    if (loading) return;
    setName("");
    setDescription("");
    onClose();
  }

  return (
    <Modal.Root open={open} onOpenChange={(v) => !v && handleClose()}>
      <Modal.Content className="max-w-lg">
        <Modal.Header>
          <Modal.Title>Nouveau jeu de plans</Modal.Title>
          <Modal.Close disabled={loading} onClick={handleClose} />
        </Modal.Header>
        <form onSubmit={handleSubmit}>
          <Modal.Body>
            <div>
              <label
                htmlFor="plan-set-name"
                className="form-label"
              >
                Nom du jeu
              </label>
              <input
                id="plan-set-name"
                type="text"
                className="form-input"
                placeholder="ex: Plans architecte - Lot 01"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={255}
                required
                autoFocus
                disabled={loading}
              />
            </div>
            <div>
              <label
                htmlFor="plan-set-description"
                className="form-label"
              >
                Description (optionnel)
              </label>
              <textarea
                id="plan-set-description"
                className="form-input min-h-[80px] resize-y"
                placeholder="Notes supplementaires..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                disabled={loading}
              />
            </div>
            {error && (
              <div className="alert alert-error" role="alert">
                {error}
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={loading}
            >
              Annuler
            </Button>
            <Button
              type="submit"
              size="sm"
              loading={loading}
              disabled={!name.trim()}
            >
              Creer
            </Button>
          </Modal.Footer>
        </form>
      </Modal.Content>
    </Modal.Root>
  );
}
