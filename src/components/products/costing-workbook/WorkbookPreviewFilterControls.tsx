"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Combobox, matchesComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { CostingWorkbookColumn } from "@/lib/catalogue/costing-workbook";
import { workbookCellValue } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import {
  compileWorkbookColumnFilter,
  emptyWorkbookColumnFilter,
  inspectWorkbookColumnFilter,
  type WorkbookColumnFilter,
  type WorkbookColumnFilterMode,
} from "@/lib/catalogue/workbook-preview-filter";

const TEXT_MODES = [
  { mode: "values", label: "Choisir une valeur" },
  { mode: "contains", label: "Contient" },
  { mode: "exact", label: "Est exactement" },
] as const;
const NUMERIC_MODES = [
  { mode: "number", label: "Égal à (nombre)" },
  { mode: "range", label: "Entre deux nombres" },
] as const;
const MAX_VISIBLE_OPTIONS = 60;

export function WorkbookPreviewFilterControls({ rows, articles, index, field, label, filter, disabled, onChange }: Readonly<{
  rows: CostingWorkbookRows;
  articles: readonly { row: number }[];
  index: number;
  field?: CostingWorkbookColumn;
  label: string;
  filter?: WorkbookColumnFilter;
  disabled: boolean;
  onChange: (filter: WorkbookColumnFilter) => void;
}>) {
  const [query, setQuery] = useState("");
  const profile = useMemo(() => inspectWorkbookColumnFilter(
    articles.map(({ row }) => workbookCellValue(rows, row, index)), field,
  ), [articles, field, index, rows]);
  const current = filter ?? emptyWorkbookColumnFilter(profile.suggestedMode);
  const numericMode = current.mode === "number" || current.mode === "range";
  const modes = profile.numeric || numericMode ? [...TEXT_MODES, ...NUMERIC_MODES] : TEXT_MODES;
  const hasValue = current.mode === "range" ? Boolean(current.min.trim() || current.max.trim()) : Boolean(current.value.trim());
  const invalidNumber = numericMode && hasValue && compileWorkbookColumnFilter(current) === null;
  const selectedValue = current.mode === "values" ? current.value : null;
  const options = useMemo(() => {
    if (selectedValue === null) return [];
    const matches = profile.options.filter((option) => matchesComboboxOption(option, query)).slice(0, MAX_VISIBLE_OPTIONS);
    const selection = profile.options.find(({ value }) => value === selectedValue);
    if (selection && !matches.includes(selection)) matches.push(selection);
    return matches;
  }, [profile.options, query, selectedValue]);

  function selectMode(value: string) {
    const mode = modes.find((option) => option.mode === value)?.mode;
    if (!mode) return;
    setQuery("");
    onChange(emptyWorkbookColumnFilter(mode));
  }

  const clear = () => {
    setQuery("");
    onChange(emptyWorkbookColumnFilter(current.mode));
  };

  return (
    <>
      <label className="grid gap-1 text-xs font-medium">
        Mode de filtre
        <NativeSelect size="sm" value={current.mode} disabled={disabled} onChange={(event) => selectMode(event.currentTarget.value)}>
          {modes.map(({ mode, label: name }: { mode: WorkbookColumnFilterMode; label: string }) => (
            <option key={mode} value={mode}>{name}{mode === profile.suggestedMode ? " · suggéré" : ""}</option>
          ))}
        </NativeSelect>
      </label>
      {current.mode === "values" ? (
        <Combobox size="sm" aria-label={`Valeur exacte ${label}`} placeholder="Rechercher une valeur"
          disabled={disabled} options={options} value={current.value} onQueryChange={setQuery}
          onValueChange={(value) => { setQuery(""); onChange({ mode: "values", value }); }} />
      ) : current.mode === "range" ? (
        <div className="grid grid-cols-2 gap-2">
          <Input size="sm" inputMode="decimal" aria-label={`Minimum ${label}`} placeholder="Minimum" disabled={disabled}
            aria-invalid={invalidNumber} value={current.min} onChange={(event) => onChange({ ...current, min: event.currentTarget.value })} />
          <Input size="sm" inputMode="decimal" aria-label={`Maximum ${label}`} placeholder="Maximum" disabled={disabled}
            aria-invalid={invalidNumber} value={current.max} onChange={(event) => onChange({ ...current, max: event.currentTarget.value })} />
        </div>
      ) : (
        <Input size="sm" type={numericMode ? "text" : "search"} inputMode={numericMode ? "decimal" : undefined}
          aria-label={`Filtre ${label}`} disabled={disabled} aria-invalid={invalidNumber}
          value={current.value} onChange={(event) => onChange({ ...current, value: event.currentTarget.value })} />
      )}
      {invalidNumber ? <p role="status" className="text-xs text-danger">Saisissez un nombre valide ou des bornes dans l’ordre croissant.</p> : null}
      {hasValue ? <Button size="xs" variant="link" className="self-start" disabled={disabled} onClick={clear}>Effacer le filtre</Button> : null}
    </>
  );
}
