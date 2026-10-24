"use client";

import { useId, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { saveTenantCalcDefaults } from "@/app/dashboard/_actions/tenant-calc-policy";
import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  parseTenantCalcDefaultsForm,
  type TenantCalcDefaultsField,
  type TenantCalcDefaultsFieldErrors,
  type TenantCalcDefaultsForm,
} from "@/lib/estimates/calc-policy-defaults";

type TenantCalcPolicyAdminClientProps = {
  engine: 2 | 3;
  initialForm: Omit<TenantCalcDefaultsForm, "changeReason">;
  lastChange: { reason: string; updatedAt: string } | null;
};

const ENGINE_LABELS: Record<2 | 3, string> = {
  2: "Moteur 2 (marge)",
  3: "Moteur 3 (coefficients de vente)",
};

/** Ordre des champs à l'écran : le premier refusé reçoit le focus. */
const FIELD_ORDER: readonly { field: TenantCalcDefaultsField; suffix: string }[] = [
  { field: "saleCoefficientFo", suffix: "fo" },
  { field: "saleCoefficientMo", suffix: "mo" },
  { field: "allowedTaxRates", suffix: "rates" },
  { field: "changeReason", suffix: "reason" },
];

const SAVED_MESSAGE = "Réglages enregistrés. Les coefficients valent pour les prochains devis, les taux de TVA dès le prochain gel d'un devis v3.";

const LAST_CHANGE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

type TextFieldProps = {
  id: string;
  field: TenantCalcDefaultsField;
  label: string;
  hint: string;
  value: string;
  error?: string;
  disabled: boolean;
  multiline?: boolean;
  onChange: (field: TenantCalcDefaultsField, value: string) => void;
};

function TextField({ id, field, label, hint, value, error, disabled, multiline = false, onChange }: Readonly<TextFieldProps>) {
  const describedBy = [`${id}-hint`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  const shared = {
    id,
    value,
    disabled,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  } as const;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldDescription id={`${id}-hint`} className="text-xs">{hint}</FieldDescription>
      {multiline ? (
        <Textarea {...shared} rows={2} maxLength={500} onChange={(event) => onChange(field, event.currentTarget.value)} />
      ) : (
        <Input
          {...shared}
          type="text"
          inputMode={field === "allowedTaxRates" ? "text" : "decimal"}
          autoComplete="off"
          onChange={(event) => onChange(field, event.currentTarget.value)}
        />
      )}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}

/**
 * Lot 3.2, entrée 5 (P-13) : un administrateur règle les coefficients de vente par défaut et les taux de TVA autorisés
 * de son entreprise. Le moteur des nouveaux devis est affiché sans être modifiable : il reste le levier de l'équipe.
 */
export function TenantCalcPolicyAdminClient({ engine, initialForm, lastChange }: Readonly<TenantCalcPolicyAdminClientProps>) {
  const router = useRouter();
  const fieldId = useId();
  const [form, setForm] = useState<TenantCalcDefaultsForm>({ ...initialForm, changeReason: "" });
  const [errors, setErrors] = useState<TenantCalcDefaultsFieldErrors>({});
  const [status, setStatus] = useState<{ kind: "success" | "danger"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function updateField(field: TenantCalcDefaultsField, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setStatus(null);
  }

  function showErrors(fieldErrors: TenantCalcDefaultsFieldErrors) {
    setErrors(fieldErrors);
    const first = FIELD_ORDER.find(({ field }) => fieldErrors[field]);
    if (first) document.getElementById(`${fieldId}-${first.suffix}`)?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseTenantCalcDefaultsForm(form);
    if (!parsed.ok) {
      showErrors(parsed.errors);
      setStatus({ kind: "danger", message: "Corrigez les champs signalés." });
      return;
    }
    startTransition(async () => {
      const result = await saveTenantCalcDefaults(form);
      if (result.ok) {
        setForm({ ...result.form, changeReason: "" });
        setErrors({});
        setStatus({ kind: "success", message: SAVED_MESSAGE });
        router.refresh();
      } else {
        showErrors(result.errors ?? {});
        setStatus({ kind: "danger", message: result.message });
      }
    });
  }

  return (
    <div className="animate-fade-in">
      <PageHeader
        breadcrumbs={[
          { label: "Administration", href: "/dashboard/admin" },
          { label: "Calcul des devis" },
        ]}
        title="Calcul des devis"
        description="Coefficients de vente par défaut et taux de TVA autorisés des devis v3 de l'entreprise."
      />

      <div className="flex max-w-3xl flex-col gap-6">
        {status ? <Alert variant={status.kind}>{status.message}</Alert> : null}

        <section
          aria-labelledby={`${fieldId}-engine`}
          className="min-w-0 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5"
        >
          <h2 id={`${fieldId}-engine`} className="text-sm font-semibold text-foreground">
            Moteur de calcul des nouveaux devis
          </h2>
          <p className="mt-1 text-base font-medium text-foreground" data-testid="tenant-calc-policy-engine">
            {ENGINE_LABELS[engine]}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Il est réglé par l&apos;équipe produit et ne se change pas ici.
          </p>
        </section>

        <form
          noValidate
          aria-labelledby={`${fieldId}-defaults`}
          onSubmit={handleSubmit}
          className="flex min-w-0 flex-col gap-5 rounded-lg border border-border bg-surface p-4 shadow-card sm:p-5"
        >
          <div>
            <h2 id={`${fieldId}-defaults`} className="text-sm font-semibold text-foreground">
              Coefficients par défaut et TVA autorisée
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Les nouveaux devis au moteur 3 partent de ces coefficients ; les devis existants gardent les leurs. Les
              taux de TVA sont relus à chaque gel d&apos;un devis v3.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id={`${fieldId}-fo`}
              field="saleCoefficientFo"
              label="Coefficient de vente FO par défaut"
              hint="Fournitures : nombre supérieur à 0 et au plus 10, 4 décimales au plus."
              value={form.saleCoefficientFo}
              error={errors.saleCoefficientFo}
              disabled={isPending}
              onChange={updateField}
            />
            <TextField
              id={`${fieldId}-mo`}
              field="saleCoefficientMo"
              label="Coefficient de vente MO par défaut"
              hint="Main-d'œuvre : même règle."
              value={form.saleCoefficientMo}
              error={errors.saleCoefficientMo}
              disabled={isPending}
              onChange={updateField}
            />
          </div>
          <TextField
            id={`${fieldId}-rates`}
            field="allowedTaxRates"
            label="Taux de TVA autorisés"
            hint="En pourcentage, séparés par « ; », par exemple 20 ; 10 ; 5,5 ; 2,1. Vérifiés à chaque gel d'un devis v3, brouillons en cours compris : un taux retiré bloque le gel des lignes qui l'utilisent."
            value={form.allowedTaxRates}
            error={errors.allowedTaxRates}
            disabled={isPending}
            onChange={updateField}
          />
          <TextField
            id={`${fieldId}-reason`}
            field="changeReason"
            label="Motif du changement"
            hint="Gardé dans le journal des réglages de l'entreprise."
            value={form.changeReason}
            error={errors.changeReason}
            disabled={isPending}
            multiline
            onChange={updateField}
          />
          {lastChange ? (
            <p className="text-xs text-muted-foreground">
              Dernier changement le {LAST_CHANGE_FORMAT.format(new Date(lastChange.updatedAt))} : « {lastChange.reason} »
            </p>
          ) : null}
          <div>
            <Button type="submit" size="lg" className="min-h-11 w-full sm:w-auto" disabled={isPending}>
              {isPending ? "Enregistrement…" : "Enregistrer les réglages"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
