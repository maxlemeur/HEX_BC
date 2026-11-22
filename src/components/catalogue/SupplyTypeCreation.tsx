"use client";

import { useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { PlusIcon } from "lucide-react";

import { fetchApi } from "@/components/catalogue/api";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** A supply type of the tenant, as `POST /api/catalogue/supply-types` returns it. */
export type CreatedSupplyType = { id: string; code: string; name: string };

/**
 * `md` beside a form's default fields (the article form of the catalogue), `sm` beside the compact fields of
 * a side sheet (the article created from a material request line).
 */
type CreationSize = "md" | "sm";

const BUTTON_PROPS: Record<CreationSize, { size: "lg" | "sm"; className: string }> = {
  md: { size: "lg", className: "shrink-0" },
  sm: { size: "sm", className: "h-9 shrink-0" },
};

/**
 * The creation of a supply type beside the select that lists them, without leaving the form (TI-690). The
 * server keeps it to administrators (`createSupplyType`): a form shows these controls to them only. Once
 * created, the type is handed to `onCreated` (which adds and selects it), the focus goes back to the select and
 * the field closes. A refusal keeps the name typed.
 */
export function useSupplyTypeCreation({
  selectRef,
  onCreated,
}: Readonly<{
  selectRef: RefObject<HTMLSelectElement | null>;
  onCreated: (supplyType: CreatedSupplyType) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError(null);
    try {
      const { item } = await fetchApi<{ item: CreatedSupplyType }>("/api/catalogue/supply-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      // The select lists the new type (and is enabled, if the list was empty) before it takes the focus, and it
      // takes it before the field closes: a dialog would otherwise move the focus of the removed field to itself.
      flushSync(() => onCreated(item));
      selectRef.current?.focus();
      setName("");
      setOpen(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Création du type de fourniture impossible.");
    } finally {
      setBusy(false);
    }
  }

  return {
    open,
    name,
    error,
    busy,
    setName,
    toggle: () => {
      setError(null);
      setOpen((current) => !current);
    },
    create,
  };
}

export type SupplyTypeCreation = ReturnType<typeof useSupplyTypeCreation>;

/** `idPrefix` names the panel `<prefix>-supply-type-creation`, the field `<prefix>-new-supply-type`. */
function creationIds(idPrefix: string) {
  return {
    panel: `${idPrefix}-supply-type-creation`,
    field: `${idPrefix}-new-supply-type`,
    error: `${idPrefix}-new-supply-type-error`,
  };
}

/** « Nouveau type », beside the select: opens and closes the field that names the new type. */
export function NewSupplyTypeButton({
  creation,
  idPrefix,
  size = "md",
}: Readonly<{ creation: SupplyTypeCreation; idPrefix: string; size?: CreationSize }>) {
  const button = BUTTON_PROPS[size];
  return (
    <Button
      type="button"
      variant="outline"
      size={button.size}
      className={button.className}
      leftIcon={<PlusIcon aria-hidden="true" />}
      aria-expanded={creation.open}
      aria-controls={creationIds(idPrefix).panel}
      onClick={creation.toggle}
    >
      Nouveau type
    </Button>
  );
}

/** The field that names the new type and its « Créer », shown while « Nouveau type » is open. */
export function NewSupplyTypePanel({
  creation,
  idPrefix,
  size = "md",
}: Readonly<{ creation: SupplyTypeCreation; idPrefix: string; size?: CreationSize }>) {
  if (!creation.open) return null;
  const ids = creationIds(idPrefix);
  const button = BUTTON_PROPS[size];
  return (
    <div id={ids.panel} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-subtle p-3">
      <FieldLabel htmlFor={ids.field}>Nom du nouveau type de fourniture</FieldLabel>
      <div className={cn("flex gap-2", size === "md" && "flex-col sm:flex-row")}>
        <Input
          id={ids.field}
          size={size}
          autoFocus
          autoComplete="off"
          maxLength={80}
          placeholder="Ex. Tuyauterie inox"
          aria-invalid={creation.error ? true : undefined}
          aria-describedby={creation.error ? ids.error : undefined}
          value={creation.name}
          onChange={(event) => creation.setName(event.target.value)}
          onKeyDown={(event) => {
            // Enter creates the type; it must never submit the article form around it.
            if (event.key !== "Enter") return;
            event.preventDefault();
            void creation.create();
          }}
        />
        <Button
          type="button"
          size={button.size}
          className={button.className}
          loading={creation.busy}
          disabled={creation.name.trim().length === 0}
          onClick={() => void creation.create()}
        >
          Créer
        </Button>
      </div>
      {creation.error ? (
        <p id={ids.error} role="alert" className="text-xs font-medium text-danger">
          {creation.error}
        </p>
      ) : null}
    </div>
  );
}
