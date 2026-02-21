"use client";

import { useCallback, useEffect, useState } from "react";

import { fetchApi } from "@/components/catalogue/api";
import type { MaterialIndex } from "@/components/catalogue/types";

type IndicesListResponse = {
  items: MaterialIndex[];
};

type MaterialIndexFormState = {
  index_code: string;
  label: string;
  index_value: string;
  index_date: string;
  unit: string;
  source: string;
};

const EMPTY_FORM: MaterialIndexFormState = {
  index_code: "",
  label: "",
  index_value: "",
  index_date: "",
  unit: "base_100",
  source: "",
};

function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  return value;
}

export function IndicesManager() {
  const [items, setItems] = useState<MaterialIndex[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [formState, setFormState] = useState<MaterialIndexFormState>(EMPTY_FORM);
  const [bulkPayload, setBulkPayload] = useState(
    JSON.stringify(
      [
        {
          index_code: "CU",
          label: "Cuivre",
          index_value: 100,
          index_date: null,
          unit: "base_100",
          source: null,
          metadata: {},
        },
      ],
      null,
      2
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const query = new URLSearchParams();
      query.set("limit", "400");
      if (activeSearch.trim()) {
        query.set("search", activeSearch.trim());
      }

      const data = await fetchApi<IndicesListResponse>(`/api/indices?${query.toString()}`);
      setItems(data.items ?? []);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Impossible de charger les indices."
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeSearch]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  function resetForm() {
    setEditingId(null);
    setFormState(EMPTY_FORM);
  }

  function onEdit(item: MaterialIndex) {
    setEditingId(item.id);
    setFormState({
      index_code: item.index_code ?? item.code ?? "",
      label: item.label ?? "",
      index_value:
        typeof item.index_value === "number"
          ? String(item.index_value)
          : typeof item.value === "number"
            ? String(item.value)
            : "",
      index_date: item.index_date ?? item.effective_date ?? "",
      unit: item.unit ?? "base_100",
      source: item.source ?? "",
    });
    setError(null);
    setSuccess(null);
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedValue = Number(formState.index_value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setError("Valeur d'indice invalide.");
      return;
    }

    if (!formState.index_code.trim() || !formState.label.trim()) {
      setError("index_code et label sont requis.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingId) {
        await fetchApi<{ item: MaterialIndex }>("/api/indices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "update",
            id: editingId,
            item: {
              index_code: formState.index_code.trim(),
              label: formState.label.trim(),
              index_value: parsedValue,
              index_date: formState.index_date || null,
              unit: formState.unit.trim() || "base_100",
              source: formState.source.trim() || null,
            },
          }),
        });

        setSuccess("Indice mis a jour.");
      } else {
        await fetchApi<{ item: MaterialIndex }>("/api/indices", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            item: {
              index_code: formState.index_code.trim(),
              label: formState.label.trim(),
              index_value: parsedValue,
              index_date: formState.index_date || null,
              unit: formState.unit.trim() || "base_100",
              source: formState.source.trim() || null,
            },
          }),
        });

        setSuccess("Indice cree.");
      }

      resetForm();
      await loadItems();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Impossible d'enregistrer l'indice."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(item: MaterialIndex) {
    if (!window.confirm("Supprimer cet indice ?")) {
      return;
    }

    setError(null);
    setSuccess(null);

    try {
      await fetchApi<{ deleted_id: string }>("/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          id: item.id,
        }),
      });

      if (editingId === item.id) {
        resetForm();
      }

      setSuccess("Indice supprime.");
      await loadItems();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer l'indice."
      );
    }
  }

  async function onBulkUpsert() {
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(bulkPayload);
    } catch {
      setError("Le JSON de bulk upsert est invalide.");
      return;
    }

    setIsBulkRunning(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchApi<{ upserted_count: number; mode: string }>("/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "bulk-upsert",
          items: parsedPayload,
        }),
      });

      setSuccess(`Bulk upsert termine: ${result.upserted_count} lignes (${result.mode}).`);
      await loadItems();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Impossible d'executer le bulk upsert."
      );
    } finally {
      setIsBulkRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="dashboard-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--slate-900)]">Indices matiere</h2>
            <p className="text-sm text-[var(--slate-500)]">
              CRUD + bulk upsert pour la base d&apos;indices.
            </p>
          </div>

          <form
            className="flex w-full max-w-md items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              setActiveSearch(search.trim());
            }}
          >
            <input
              className="form-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Recherche code/label"
            />
            <button type="submit" className="btn btn-secondary">
              Rechercher
            </button>
          </form>
        </div>

        {error ? <div className="alert alert-error mt-4">{error}</div> : null}
        {success ? <div className="alert alert-success mt-4">{success}</div> : null}

        <div className="mt-4 table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Label</th>
                <th>Valeur</th>
                <th>Date effet</th>
                <th>Source</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={6} className="text-center text-[var(--slate-500)]">
                    Chargement...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center text-[var(--slate-500)]">
                    Aucun indice disponible.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td className="font-semibold text-[var(--slate-900)]">
                      {item.index_code || item.code || "-"}
                    </td>
                    <td>{item.label || "-"}</td>
                    <td>
                      {typeof item.index_value === "number"
                        ? item.index_value.toFixed(3)
                        : typeof item.value === "number"
                          ? item.value.toFixed(3)
                          : "-"}
                    </td>
                    <td>{formatDate(item.index_date ?? item.effective_date)}</td>
                    <td>{item.source || "-"}</td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => onEdit(item)}
                        >
                          Modifier
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={() => void onDelete(item)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-card p-6">
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">
          {editingId ? "Modifier un indice" : "Ajouter un indice"}
        </h2>

        <form className="mt-4 grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
          <div>
            <label className="form-label" htmlFor="index-code">
              Index code
            </label>
            <input
              id="index-code"
              className="form-input"
              value={formState.index_code}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, index_code: event.target.value }))
              }
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="index-label">
              Label
            </label>
            <input
              id="index-label"
              className="form-input"
              value={formState.label}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, label: event.target.value }))
              }
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="index-value">
              Valeur
            </label>
            <input
              id="index-value"
              className="form-input"
              value={formState.index_value}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, index_value: event.target.value }))
              }
              required
            />
          </div>

          <div>
            <label className="form-label" htmlFor="index-date">
              Date effet
            </label>
            <input
              id="index-date"
              type="date"
              className="form-input"
              value={formState.index_date}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, index_date: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="index-unit">
              Unite
            </label>
            <input
              id="index-unit"
              className="form-input"
              value={formState.unit}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, unit: event.target.value }))
              }
            />
          </div>

          <div>
            <label className="form-label" htmlFor="index-source">
              Source
            </label>
            <input
              id="index-source"
              className="form-input"
              value={formState.source}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, source: event.target.value }))
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            <button type="submit" className="btn btn-primary" disabled={isSaving}>
              {isSaving ? "Enregistrement..." : editingId ? "Mettre a jour" : "Ajouter"}
            </button>

            {editingId ? (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={resetForm}
                disabled={isSaving}
              >
                Annuler
              </button>
            ) : null}
          </div>
        </form>
      </section>

      <section className="dashboard-card p-6">
        <h2 className="text-lg font-semibold text-[var(--slate-900)]">Bulk upsert indices</h2>
        <p className="mt-1 text-sm text-[var(--slate-500)]">
          Envoi direct vers `/api/indices` action `bulk-upsert`.
        </p>

        <textarea
          className="form-input form-textarea mt-4 font-mono text-xs"
          value={bulkPayload}
          onChange={(event) => setBulkPayload(event.target.value)}
          spellCheck={false}
          rows={12}
        />

        <div className="mt-4">
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => void onBulkUpsert()}
            disabled={isBulkRunning}
          >
            {isBulkRunning ? "Traitement..." : "Executer bulk upsert"}
          </button>
        </div>
      </section>
    </div>
  );
}
