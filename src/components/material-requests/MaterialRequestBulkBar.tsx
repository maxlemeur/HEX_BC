"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  MATERIAL_REQUEST_IMPUTATION_LABELS,
  MATERIAL_REQUEST_IMPUTATIONS,
  type BulkUpdateMaterialRequestLinesInput,
  type MaterialRequestImputation,
} from "@/lib/material-requests/contracts";

import { plural } from "./format";

type BulkPatch = BulkUpdateMaterialRequestLinesInput["patch"];
type BulkField = "material" | "material_precision" | "unit" | "zone" | "imputation";

const BULK_FIELDS: ReadonlyArray<{ key: BulkField; label: string; maxLength?: number }> = [
  { key: "material", label: "Matière", maxLength: 120 },
  { key: "material_precision", label: "Précision / norme", maxLength: 120 },
  { key: "unit", label: "Unité", maxLength: 20 },
  { key: "zone", label: "Repère", maxLength: 80 },
  { key: "imputation", label: "Imputation" },
];

/** Only the chosen column leaves: one material or one zone often holds for a whole sheet, nothing more. */
function buildPatch(field: BulkField, value: string, imputation: MaterialRequestImputation, category: string): BulkPatch | null {
  if (field === "imputation") {
    if (imputation === "project") return { imputation, overhead_category: null };
    const trimmed = category.trim();
    return trimmed ? { imputation, overhead_category: trimmed } : { imputation };
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (field === "material") return { material: trimmed };
  if (field === "material_precision") return { material_precision: trimmed };
  if (field === "unit") return { unit: trimmed };
  return { zone: trimmed };
}

export function MaterialRequestBulkBar({
  selectedCount,
  busy,
  onApply,
  onValidate,
  onClear,
  materialListId,
  unitListId,
}: Readonly<{
  selectedCount: number;
  busy: boolean;
  onApply: (patch: BulkPatch) => Promise<boolean>;
  onValidate: () => void;
  onClear: () => void;
  materialListId: string;
  unitListId: string;
}>) {
  const fieldId = useId();
  const valueId = useId();
  const categoryId = useId();
  const [field, setField] = useState<BulkField>("material");
  const [value, setValue] = useState("");
  const [imputation, setImputation] = useState<MaterialRequestImputation>("project");
  const [category, setCategory] = useState("");
  const none = selectedCount === 0;
  const patch = buildPatch(field, value, imputation, category);
  const definition = BULK_FIELDS.find((entry) => entry.key === field) ?? BULK_FIELDS[0];
  const list = field === "material" ? materialListId : field === "unit" ? unitListId : undefined;

  const apply = async () => {
    if (!patch || none) return;
    if (await onApply(patch)) {
      setValue("");
      setCategory("");
    }
  };

  return (
    <div
      role="group"
      aria-label="Actions sur la sélection"
      className="rounded-lg border border-border bg-surface-subtle p-3"
    >
      <p className="text-sm font-medium text-foreground" aria-live="polite">
        {none
          ? "Cochez des lignes pour les remplir ou les valider ensemble."
          : `${plural(selectedCount, "ligne sélectionnée", "lignes sélectionnées")}`}
      </p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void apply();
        }}
      >
        <div className="w-full sm:w-44">
          <label htmlFor={fieldId} className="mb-1 block text-xs font-medium text-muted-foreground">
            Champ à remplir
          </label>
          <NativeSelect
            id={fieldId}
            size="sm"
            value={field}
            disabled={none}
            onChange={(event) => {
              setField(event.currentTarget.value as BulkField);
              setValue("");
            }}
          >
            {BULK_FIELDS.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="w-full min-w-0 sm:w-56">
          <label htmlFor={valueId} className="mb-1 block text-xs font-medium text-muted-foreground">
            Valeur à appliquer
          </label>
          {field === "imputation" ? (
            <NativeSelect
              id={valueId}
              size="sm"
              value={imputation}
              disabled={none}
              onChange={(event) => setImputation(event.currentTarget.value as MaterialRequestImputation)}
            >
              {MATERIAL_REQUEST_IMPUTATIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {MATERIAL_REQUEST_IMPUTATION_LABELS[entry]}
                </option>
              ))}
            </NativeSelect>
          ) : (
            <Input
              id={valueId}
              size="sm"
              value={value}
              list={list}
              maxLength={definition.maxLength}
              disabled={none}
              autoComplete="off"
              onChange={(event) => setValue(event.currentTarget.value)}
            />
          )}
        </div>
        {field === "imputation" && imputation === "overhead" ? (
          <div className="w-full min-w-0 sm:w-48">
            <label htmlFor={categoryId} className="mb-1 block text-xs font-medium text-muted-foreground">
              Catégorie (facultatif)
            </label>
            <Input
              id={categoryId}
              size="sm"
              value={category}
              maxLength={80}
              placeholder="ex. EPI"
              disabled={none}
              autoComplete="off"
              onChange={(event) => setCategory(event.currentTarget.value)}
            />
          </div>
        ) : null}
        <Button type="submit" variant="secondary" disabled={none || !patch || busy}>
          Appliquer à la sélection
        </Button>
        <Button type="button" variant="outline" disabled={none || busy} onClick={onValidate}>
          Valider la sélection
        </Button>
        {none ? null : (
          <Button type="button" variant="ghost" onClick={onClear}>
            Tout décocher
          </Button>
        )}
      </form>
    </div>
  );
}
