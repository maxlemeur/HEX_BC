import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  type AffaireRegisterScopeOptions,
} from "@/lib/affaires/register";

import type { RegisterEntryFormState } from "./registerTypes";

type RegisterEntryFormProps = {
  form: RegisterEntryFormState;
  activeScopeOptions: AffaireRegisterScopeOptions["lots"] | AffaireRegisterScopeOptions["lines"];
  versionId: string | null;
  isMutationPending: boolean;
  isExpanded: boolean;
  canCreateEntry: boolean;
  formHint: string;
  formReadinessMessage: string;
  scopeHelpMessage: string | null;
  onToggleExpanded: (next: boolean) => void;
  onUpdateForm: <K extends keyof RegisterEntryFormState>(
    key: K,
    value: RegisterEntryFormState[K]
  ) => void;
  onScopeTypeChange: (value: RegisterEntryFormState["scopeType"]) => void;
  onCreateEntry: () => void;
};

export function RegisterEntryForm({
  form,
  activeScopeOptions,
  versionId,
  isMutationPending,
  isExpanded,
  canCreateEntry,
  formHint,
  formReadinessMessage,
  scopeHelpMessage,
  onToggleExpanded,
  onUpdateForm,
  onScopeTypeChange,
  onCreateEntry,
}: Readonly<RegisterEntryFormProps>) {
  if (!isExpanded) {
    return (
      <button
        type="button"
        className="mt-4 flex w-full items-center gap-2 rounded-2xl border border-dashed border-[var(--slate-300)] bg-[var(--slate-50)]/60 px-4 py-3 text-sm font-medium text-[var(--slate-600)] transition-colors hover:border-[var(--slate-400)] hover:bg-[var(--slate-100)]/80 hover:text-[var(--slate-800)]"
        onClick={() => onToggleExpanded(true)}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--slate-200)] text-xs font-bold text-[var(--slate-600)]">
          +
        </span>
        Ajouter un point
      </button>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            Ajouter un point manuel
          </h3>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Utilisez ce formulaire pour tracer une hypothèse métier ou une pièce
            manquante non détectée automatiquement.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-white px-2.5 py-1 text-xs text-[var(--slate-600)]">
            Création historisée
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-1 text-xs font-medium text-[var(--slate-600)] transition-colors hover:bg-[var(--slate-100)]"
            onClick={() => onToggleExpanded(false)}
          >
            Fermer
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--slate-500)]">{formHint}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-1">
          Type
          <select
            className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
            name="register-kind"
            autoComplete="off"
            value={form.kind}
            onChange={(event) =>
              onUpdateForm("kind", event.target.value as RegisterEntryFormState["kind"])
            }
          >
            {Object.entries(AFFAIRE_REGISTER_KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-1">
          Sévérité
          <select
            className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
            name="register-severity"
            autoComplete="off"
            value={form.severity}
            onChange={(event) =>
              onUpdateForm(
                "severity",
                event.target.value as RegisterEntryFormState["severity"]
              )
            }
          >
            {Object.entries(AFFAIRE_REGISTER_SEVERITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-1">
          Scope
          <select
            className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
            name="register-scope"
            autoComplete="off"
            value={form.scopeType}
            onChange={(event) =>
              onScopeTypeChange(
                event.target.value as RegisterEntryFormState["scopeType"]
              )
            }
          >
            {Object.entries(AFFAIRE_REGISTER_SCOPE_LABELS).map(([value, label]) => (
              <option
                key={value}
                value={value}
                disabled={value === "exception" && !versionId}
              >
                {label}
              </option>
            ))}
          </select>
        </label>
        {form.scopeType === "lot" || form.scopeType === "line" ? (
          <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-3">
            {form.scopeType === "lot" ? "Lot cible" : "Ligne cible"}
            <select
              aria-label={form.scopeType === "lot" ? "Lot cible" : "Ligne cible"}
              className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
              name={form.scopeType === "lot" ? "register-lot" : "register-line"}
              autoComplete="off"
              value={form.scopeId}
              onChange={(event) => onUpdateForm("scopeId", event.target.value)}
            >
              <option value="">
                {form.scopeType === "lot"
                  ? "Sélectionner un lot"
                  : "Sélectionner une ligne"}
              </option>
              {activeScopeOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {form.scopeType === "exception" ? (
          <>
            <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-2">
              Référence exception
              <input
                className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
                name="register-exception-ref"
                autoComplete="off"
                spellCheck={false}
                placeholder="Ex. EXC-12..."
                value={form.scopeRef}
                onChange={(event) => onUpdateForm("scopeRef", event.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-2">
              Libellé exception
              <input
                className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
                name="register-exception-label"
                autoComplete="off"
                placeholder="Ex. Reserve acoustique hall..."
                value={form.scopeLabel}
                onChange={(event) => onUpdateForm("scopeLabel", event.target.value)}
              />
            </label>
          </>
        ) : null}
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-4">
          Texte
          <textarea
            rows={3}
            className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
            name="register-text"
            placeholder="Décrivez le point à arbitrer, à confirmer ou la pièce attendue..."
            value={form.text}
            onChange={(event) => onUpdateForm("text", event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-2">
          Source documentaire (facultatif)
          <input
            className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
            name="register-source"
            autoComplete="off"
            placeholder="Ex. note-client-v3.pdf..."
            value={form.sourceFileName}
            onChange={(event) => onUpdateForm("sourceFileName", event.target.value)}
          />
        </label>
      </div>
      <p
        className={`mt-3 text-xs ${
          canCreateEntry
            ? "text-[var(--success)]"
            : scopeHelpMessage || form.text.trim().length > 0
              ? "text-[var(--warning)]"
              : "text-[var(--slate-500)]"
        }`}
        aria-live="polite"
      >
        {formReadinessMessage}
      </p>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!canCreateEntry || isMutationPending}
          onClick={onCreateEntry}
        >
          Ajouter au registre
        </button>
      </div>
    </div>
  );
}
