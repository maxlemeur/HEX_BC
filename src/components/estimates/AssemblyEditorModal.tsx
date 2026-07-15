"use client";

import { useMemo, useState } from "react";

import type {
  CreateEstimateAssemblyPayload,
  EstimateAssemblyDetail,
} from "@/lib/estimates/client";

export type AssemblyEditorInput = {
  name: string;
  description?: string | null;
  items: CreateEstimateAssemblyPayload["items"];
};

type AssemblyDraftItem = {
  key: string;
  title: string;
  unit: string;
  kFo: string;
  kMo: string;
  laborRoleId: string;
  defaultQuantity: string;
  position: string;
};

type AssemblyEditorModalProps = {
  isSubmitting: boolean;
  initialValue?: EstimateAssemblyDetail | null;
  onClose: () => void;
  onSubmit: (input: AssemblyEditorInput) => Promise<void> | void;
};

function toDraftItems(
  initialValue: EstimateAssemblyDetail | null | undefined
): AssemblyDraftItem[] {
  if (!initialValue?.items?.length) {
    return [
      {
        key: "item-1",
        title: "",
        unit: "",
        kFo: "1",
        kMo: "1",
        laborRoleId: "",
        defaultQuantity: "1",
        position: "1",
      },
    ];
  }

  return initialValue.items.map((item, index) => ({
    key: `${item.id}-${index}`,
    title: item.title ?? "",
    unit: item.unit ?? "",
    kFo: String(item.k_fo ?? 1),
    kMo: String(item.k_mo ?? 1),
    laborRoleId: item.labor_role_id ?? "",
    defaultQuantity:
      item.default_quantity === null || item.default_quantity === undefined
        ? ""
        : String(item.default_quantity),
    position: String(item.position ?? index + 1),
  }));
}

function readFiniteNumber(value: string, fallback: number) {
  const normalized = value.trim().replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readPositiveInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export function AssemblyEditorModal({
  isSubmitting,
  initialValue,
  onClose,
  onSubmit,
}: AssemblyEditorModalProps) {
  const isEditMode = Boolean(initialValue);
  const [name, setName] = useState(() => initialValue?.name ?? "");
  const [description, setDescription] = useState(
    () => initialValue?.description ?? ""
  );
  const [items, setItems] = useState<AssemblyDraftItem[]>(() =>
    toDraftItems(initialValue)
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const modalTitle = useMemo(
    () => (isEditMode ? "Modifier l'ouvrage" : "Nouvel ouvrage"),
    [isEditMode]
  );

  function updateItem(
    index: number,
    patch: Partial<AssemblyDraftItem>
  ) {
    setItems((prev) =>
      prev.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item
      )
    );
  }

  function addItem() {
    const nextPosition =
      items.reduce((max, item) => Math.max(max, readPositiveInteger(item.position, 1)), 0) +
      1;
    setItems((prev) => [
      ...prev,
      {
        key: `item-${Date.now()}`,
        title: "",
        unit: "",
        kFo: "1",
        kMo: "1",
        laborRoleId: "",
        defaultQuantity: "1",
        position: String(nextPosition),
      },
    ]);
  }

  function removeItem(index: number) {
    if (items.length <= 1) return;
    setItems((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("Le nom de l'ouvrage est obligatoire.");
      return;
    }
    if (items.length === 0) {
      setValidationError("L'ouvrage doit contenir au moins une ligne.");
      return;
    }
    if (items.length > 50) {
      setValidationError("L'ouvrage ne peut pas contenir plus de 50 lignes.");
      return;
    }

    const payloadItems: AssemblyEditorInput["items"] = [];
    const usedPositions = new Set<number>();

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const title = item.title.trim();
      if (!title) {
        setValidationError(`La désignation de la ligne ${index + 1} est obligatoire.`);
        return;
      }

      const position = readPositiveInteger(item.position, index + 1);
      if (usedPositions.has(position)) {
        setValidationError("Les positions des lignes doivent être uniques.");
        return;
      }
      usedPositions.add(position);

      const kFo = Math.max(readFiniteNumber(item.kFo, 1), 0);
      const kMo = Math.max(readFiniteNumber(item.kMo, 1), 0);
      const defaultQuantityRaw = item.defaultQuantity.trim();
      const defaultQuantity =
        defaultQuantityRaw.length > 0
          ? Math.max(readFiniteNumber(defaultQuantityRaw, 1), 0)
          : null;

      payloadItems.push({
        title,
        unit: item.unit.trim() || null,
        kFo,
        kMo,
        laborRoleId: item.laborRoleId.trim() || null,
        defaultQuantity,
        position,
      });
    }

    setValidationError(null);
    await onSubmit({
      name: trimmedName,
      description: description.trim() || null,
      items: payloadItems,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        className="dashboard-card w-full max-w-6xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="assembly-editor-title"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="assembly-editor-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              {modalTitle}
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Configurez des lignes réutilisables pour les insérer dans l&apos;éditeur.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Fermer
          </button>
        </div>

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="form-label" htmlFor="assembly-name">
                Nom de l&apos;ouvrage *
              </label>
              <input
                id="assembly-name"
                className="form-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
              />
            </div>

            <div>
              <label className="form-label" htmlFor="assembly-description">
                Description
              </label>
              <input
                id="assembly-description"
                className="form-input"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optionnel"
              />
            </div>
          </div>

          <div className="table-scroll rounded-lg border border-[var(--slate-200)]">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Désignation</th>
                  <th>Unité</th>
                  <th>K FO</th>
                  <th>K MO</th>
                  <th>Rôle MO (UUID)</th>
                  <th>Qté par défaut</th>
                  <th>Position</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.key}>
                    <td>
                      <input
                        className="estimate-input"
                        value={item.title}
                        onChange={(event) =>
                          updateItem(index, { title: event.target.value })
                        }
                        placeholder="Désignation"
                      />
                    </td>
                    <td>
                      <input
                        className="estimate-input"
                        value={item.unit}
                        onChange={(event) =>
                          updateItem(index, { unit: event.target.value })
                        }
                        placeholder="u, ml, m2..."
                      />
                    </td>
                    <td>
                      <input
                        className="estimate-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.kFo}
                        onChange={(event) =>
                          updateItem(index, { kFo: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="estimate-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.kMo}
                        onChange={(event) =>
                          updateItem(index, { kMo: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="estimate-input"
                        value={item.laborRoleId}
                        onChange={(event) =>
                          updateItem(index, { laborRoleId: event.target.value })
                        }
                        placeholder="Optionnel"
                      />
                    </td>
                    <td>
                      <input
                        className="estimate-input"
                        type="number"
                        min={0}
                        step="0.01"
                        value={item.defaultQuantity}
                        onChange={(event) =>
                          updateItem(index, {
                            defaultQuantity: event.target.value,
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="estimate-input"
                        type="number"
                        min={1}
                        step={1}
                        value={item.position}
                        onChange={(event) =>
                          updateItem(index, { position: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => removeItem(index)}
                        disabled={isSubmitting || items.length <= 1}
                      >
                        Retirer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={addItem}
              disabled={isSubmitting || items.length >= 50}
            >
              + Ligne ouvrage
            </button>
          </div>

          {validationError ? <div className="alert alert-error">{validationError}</div> : null}

          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
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
  );
}
