"use client";

import { useCallback, useEffect, useState } from "react";
import { ChartLineIcon, PencilIcon, SearchIcon, TrashIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import type { MaterialIndex } from "@/components/catalogue/types";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { EmptyTableRow } from "@/components/layout/empty-state";
import { LoadingState } from "@/components/layout/loading-state";
import { PageSection } from "@/components/layout/page-section";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

const COLUMN_COUNT = 6;

function formatDate(value: string | undefined | null) {
  if (!value) return "-";
  return value;
}

function indexCode(item: MaterialIndex) {
  return item.index_code || item.code || "-";
}

export function IndicesManager() {
  const confirm = useConfirm();
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
    document.getElementById("index-code")?.focus();
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsedValue = Number(formState.index_value.replace(",", "."));
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      setError("Valeur d’indice invalide.");
      return;
    }

    if (!formState.index_code.trim() || !formState.label.trim()) {
      setError("Le code et le libellé de l’indice sont requis.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const item = {
      index_code: formState.index_code.trim(),
      label: formState.label.trim(),
      index_value: parsedValue,
      index_date: formState.index_date || null,
      unit: formState.unit.trim() || "base_100",
      source: formState.source.trim() || null,
    };

    try {
      await fetchApi<{ item: MaterialIndex }>("/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          editingId ? { action: "update", id: editingId, item } : { action: "create", item }
        ),
      });

      setSuccess(editingId ? "Indice mis à jour." : "Indice créé.");
      resetForm();
      await loadItems();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Impossible d’enregistrer l’indice."
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function onDelete(item: MaterialIndex) {
    const confirmed = await confirm({
      title: `Supprimer l’indice ${indexCode(item)} ?`,
      description: "Cette suppression est définitive.",
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

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

      setSuccess("Indice supprimé.");
      await loadItems();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Impossible de supprimer l’indice."
      );
    }
  }

  async function onBulkUpsert() {
    let parsedPayload: unknown;

    try {
      parsedPayload = JSON.parse(bulkPayload);
    } catch {
      setError("Le JSON de mise à jour en masse est invalide.");
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

      setSuccess(
        `Mise à jour en masse terminée : ${result.upserted_count} ligne${result.upserted_count > 1 ? "s" : ""} (${result.mode}).`
      );
      await loadItems();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Impossible d’exécuter la mise à jour en masse."
      );
    } finally {
      setIsBulkRunning(false);
    }
  }

  function updateField(key: keyof MaterialIndexFormState, value: string) {
    setFormState((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-6">
      {error ? <Alert variant="danger">{error}</Alert> : null}
      {success ? <Alert variant="success">{success}</Alert> : null}

      <PageSection
        title="Liste des indices"
        description="Valeurs de référence utilisées pour réviser les prix matière."
        flush
        actions={
          <form
            role="search"
            className="flex w-full min-w-0 items-center gap-2 sm:w-auto"
            onSubmit={(event) => {
              event.preventDefault();
              setActiveSearch(search.trim());
            }}
          >
            <Input
              type="search"
              size="sm"
              aria-label="Rechercher un indice par code ou libellé"
              className="sm:w-60"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Code ou libellé…"
            />
            <Button type="submit" variant="outline" size="md" leftIcon={<SearchIcon aria-hidden="true" />}>
              Rechercher
            </Button>
          </form>
        }
      >
        <div className="table-scroll relative overflow-x-auto" role="region" aria-label="Liste des indices" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Libellé</th>
                <th scope="col" className="text-right">Valeur</th>
                <th scope="col">Date d’effet</th>
                <th scope="col">Source</th>
                <th scope="col" className="text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={COLUMN_COUNT} className="p-0">
                    <LoadingState label="Chargement des indices…" className="py-8" />
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <EmptyTableRow
                  colSpan={COLUMN_COUNT}
                  variant="compact"
                  icon={<ChartLineIcon />}
                  title={activeSearch ? "Aucun indice ne correspond à la recherche" : "Aucun indice"}
                  description={
                    activeSearch
                      ? "Modifiez la recherche pour voir plus de résultats."
                      : "Ajoutez un indice avec le formulaire ci-dessous ou importez-les en masse."
                  }
                />
              ) : (
                items.map((item) => (
                  <tr key={item.id}>
                    <td className="font-semibold text-foreground">{indexCode(item)}</td>
                    <td>{item.label || "-"}</td>
                    <td className="text-right font-mono">
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
                        <Button
                          variant="outline"
                          size="sm"
                          aria-label={`Modifier l’indice ${indexCode(item)}`}
                          leftIcon={<PencilIcon aria-hidden="true" />}
                          onClick={() => onEdit(item)}
                        >
                          Modifier
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          aria-label={`Supprimer l’indice ${indexCode(item)}`}
                          leftIcon={<TrashIcon aria-hidden="true" />}
                          onClick={() => void onDelete(item)}
                        >
                          Supprimer
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection
        id="index-form-title"
        title={editingId ? "Modifier un indice" : "Ajouter un indice"}
      >
        <form className="grid gap-4 lg:grid-cols-2" onSubmit={onSubmit}>
          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="index-code">Code de l’indice *</FieldLabel>
            <Input
              id="index-code"
              value={formState.index_code}
              onChange={(event) => updateField("index_code", event.target.value)}
              placeholder="Ex. CU"
              autoComplete="off"
              required
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="index-label">Libellé *</FieldLabel>
            <Input
              id="index-label"
              value={formState.label}
              onChange={(event) => updateField("label", event.target.value)}
              placeholder="Ex. Cuivre"
              required
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="index-value">Valeur *</FieldLabel>
            <Input
              id="index-value"
              inputMode="decimal"
              value={formState.index_value}
              onChange={(event) => updateField("index_value", event.target.value)}
              placeholder="Ex. 112,4"
              required
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="index-date">Date d’effet</FieldLabel>
            <Input
              id="index-date"
              type="date"
              value={formState.index_date}
              onChange={(event) => updateField("index_date", event.target.value)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="index-unit">Unité</FieldLabel>
            <Input
              id="index-unit"
              value={formState.unit}
              onChange={(event) => updateField("unit", event.target.value)}
            />
          </div>

          <div className="flex min-w-0 flex-col gap-2">
            <FieldLabel htmlFor="index-source">Source</FieldLabel>
            <Input
              id="index-source"
              value={formState.source}
              onChange={(event) => updateField("source", event.target.value)}
              placeholder="Ex. INSEE"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:col-span-2">
            <Button type="submit" size="lg" loading={isSaving}>
              {editingId ? "Mettre à jour" : "Ajouter l’indice"}
            </Button>

            {editingId ? (
              <Button variant="outline" size="lg" onClick={resetForm} disabled={isSaving}>
                Annuler
              </Button>
            ) : null}
          </div>
        </form>
      </PageSection>

      <PageSection
        title="Mise à jour en masse"
        description="Collez un tableau JSON d’indices : les codes existants sont mis à jour, les autres créés."
      >
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor="indices-bulk-payload">Indices au format JSON</FieldLabel>
          <Textarea
            id="indices-bulk-payload"
            className="font-mono text-xs"
            aria-describedby="indices-bulk-hint"
            value={bulkPayload}
            onChange={(event) => setBulkPayload(event.target.value)}
            spellCheck={false}
            rows={12}
          />
          <FieldDescription id="indices-bulk-hint" className="text-xs">
            Champs attendus : index_code, label, index_value, index_date, unit, source.
          </FieldDescription>
        </div>

        <div className="mt-4">
          <Button variant="accent" size="lg" onClick={() => void onBulkUpsert()} loading={isBulkRunning}>
            Exécuter la mise à jour en masse
          </Button>
        </div>
      </PageSection>
    </div>
  );
}
