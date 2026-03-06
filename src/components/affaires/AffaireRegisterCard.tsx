"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import {
  createAffaireRegisterEntryAction,
  updateAffaireRegisterEntryStatusAction,
} from "@/app/dashboard/affaires/_actions/register";
import { useToast } from "@/components/ui/Toast";
import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_ORIGIN_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  buildAffaireRegisterSearchHref,
  type AffaireRegisterEntry,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterPageResult,
  type AffaireRegisterScopeOptions,
} from "@/lib/affaires/register";

type AffaireRegisterCardProps = {
  projectId: string;
  versionId: string | null;
  registerPage: AffaireRegisterPageResult | null;
  scopeOptions: AffaireRegisterScopeOptions;
  isReadOnly?: boolean;
  errorMessage?: string;
};

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_TONE: Record<AffaireRegisterEntryStatus, string> = {
  open: "bg-[var(--warning)]/10 text-[var(--warning)]",
  validated: "bg-[var(--success)]/10 text-[var(--success)]",
  rejected: "bg-[var(--danger)]/10 text-[var(--danger)]",
  clarify_with_client: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
};

const SEVERITY_TONE: Record<AffaireRegisterEntrySeverity, string> = {
  info: "bg-[var(--slate-100)] text-[var(--slate-600)]",
  warning: "bg-[var(--warning)]/10 text-[var(--warning)]",
  critical: "bg-[var(--danger)]/10 text-[var(--danger)]",
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return DATE_TIME_FORMATTER.format(date);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Une erreur est survenue sur le registre affaire.";
}

export function AffaireRegisterCard({
  projectId,
  versionId,
  registerPage,
  scopeOptions,
  isReadOnly = false,
  errorMessage,
}: Readonly<AffaireRegisterCardProps>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [isFilterPending, startFilterTransition] = useTransition();
  const [isMutationPending, startMutationTransition] = useTransition();
  const [pendingEntryId, setPendingEntryId] = useState<string | null>(null);
  const [form, setForm] = useState({
    kind: "assumption" as AffaireRegisterEntryKind,
    severity: "warning" as AffaireRegisterEntrySeverity,
    text: "",
    scopeType: "project" as "project" | "lot" | "line" | "exception",
    scopeId: "",
    scopeRef: "",
    scopeLabel: "",
    sourceFileName: "",
  });

  const items = registerPage?.items ?? [];
  const activeScopeOptions =
    form.scopeType === "lot"
      ? scopeOptions.lots
      : form.scopeType === "line"
        ? scopeOptions.lines
        : [];
  const filterStatus = registerPage?.filters.status ?? "";
  const filterSeverity = registerPage?.filters.severity ?? "";
  const filterKind = registerPage?.filters.kind ?? "";
  const hasActiveFilters = Boolean(filterStatus || filterSeverity || filterKind);

  function applyFilters(next: {
    status?: AffaireRegisterEntryStatus | null;
    severity?: AffaireRegisterEntrySeverity | null;
    kind?: AffaireRegisterEntryKind | null;
    cursor?: string | null;
  }) {
    const nextStatus =
      "status" in next ? next.status ?? null : registerPage?.filters.status ?? null;
    const nextSeverity =
      "severity" in next
        ? next.severity ?? null
        : registerPage?.filters.severity ?? null;
    const nextKind = "kind" in next ? next.kind ?? null : registerPage?.filters.kind ?? null;
    const nextCursor =
      "cursor" in next ? next.cursor ?? null : registerPage?.filters.cursor ?? null;
    const href = buildAffaireRegisterSearchHref({
      pathname,
      searchParams: new URLSearchParams(searchParams.toString()),
      status: nextStatus,
      severity: nextSeverity,
      kind: nextKind,
      cursor: nextCursor,
    });

    startFilterTransition(() => {
      router.replace(href, { scroll: false });
    });
  }

  function resetFilters() {
    applyFilters({
      status: null,
      severity: null,
      kind: null,
      cursor: null,
    });
  }

  const scopeHelpMessage =
    form.scopeType === "exception" && !versionId
      ? "Une version courante est requise pour lier une exception."
      : (form.scopeType === "lot" || form.scopeType === "line") &&
          activeScopeOptions.length === 0
        ? form.scopeType === "lot"
          ? "Aucun lot disponible sur la version courante."
          : "Aucune ligne disponible sur la version courante."
        : null;
  const canCreateEntry =
    !isReadOnly &&
    form.text.trim().length > 0 &&
    !scopeHelpMessage &&
    (form.scopeType === "project" ||
      (form.scopeType === "exception" &&
        form.scopeRef.trim().length > 0 &&
        form.scopeLabel.trim().length > 0) ||
      ((form.scopeType === "lot" || form.scopeType === "line") &&
        form.scopeId.trim().length > 0));

  async function handleCreateEntry() {
    startMutationTransition(() => {
      void (async () => {
        try {
          const result = await createAffaireRegisterEntryAction({
            projectId,
            versionId,
            kind: form.kind,
            text: form.text,
            severity: form.severity,
            scopeType: form.scopeType,
            scopeId:
              form.scopeType === "lot" || form.scopeType === "line"
                ? form.scopeId || null
                : null,
            scopeRef: form.scopeType === "exception" ? form.scopeRef || null : null,
            scopeLabel:
              form.scopeType === "exception" ? form.scopeLabel || null : null,
            sourceFileName: form.sourceFileName || null,
          });

          setForm((current) => ({
            ...current,
            text: "",
            scopeId: "",
            scopeRef: "",
            scopeLabel: "",
            sourceFileName: "",
          }));
          toast.success({
            title: "Entree ajoutee",
            description: `${AFFAIRE_REGISTER_KIND_LABELS[result.entry.kind]} enregistree dans le registre.`,
          });
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Creation impossible",
            description: getErrorMessage(error),
          });
        }
      })();
    });
  }

  async function handleStatusChange(
    entryId: string,
    status: AffaireRegisterEntryStatus
  ) {
    setPendingEntryId(entryId);
    startMutationTransition(() => {
      void (async () => {
        try {
          const result = await updateAffaireRegisterEntryStatusAction({
            projectId,
            versionId,
            entryId,
            status,
          });
          toast.success({
            title: "Statut mis a jour",
            description: `Entree passe en ${AFFAIRE_REGISTER_STATUS_LABELS[result.entry.status].toLowerCase()}.`,
          });
          router.refresh();
        } catch (error) {
          toast.error({
            title: "Mise a jour impossible",
            description: getErrorMessage(error),
          });
        } finally {
          setPendingEntryId(null);
        }
      })();
    });
  }

  function renderEntryActions(entry: AffaireRegisterEntry) {
    if (isReadOnly) {
      return null;
    }

    const isPendingEntry = isMutationPending && pendingEntryId === entry.id;

    if (entry.status === "validated" || entry.status === "rejected") {
      return (
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={isPendingEntry}
          onClick={() => void handleStatusChange(entry.id, "open")}
        >
          Rouvrir
        </button>
      );
    }

    if (entry.status === "clarify_with_client") {
      return (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPendingEntry}
            onClick={() => void handleStatusChange(entry.id, "open")}
          >
            Rouvrir
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPendingEntry}
            onClick={() => void handleStatusChange(entry.id, "validated")}
          >
            Valider
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPendingEntry}
            onClick={() => void handleStatusChange(entry.id, "rejected")}
          >
            Rejeter
          </button>
        </div>
      );
    }

    return (
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={isPendingEntry}
          onClick={() => void handleStatusChange(entry.id, "validated")}
        >
          Valider
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={isPendingEntry}
          onClick={() => void handleStatusChange(entry.id, "rejected")}
        >
          Rejeter
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={isPendingEntry}
          onClick={() => void handleStatusChange(entry.id, "clarify_with_client")}
        >
          A clarifier avec client
        </button>
      </div>
    );
  }

  if (errorMessage) {
    return (
      <section className="dashboard-card p-5">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">
          Registre hypotheses & pieces manquantes
        </h2>
        <div className="mt-3 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5 px-3 py-2 text-sm text-[var(--slate-700)]">
          {errorMessage}
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-card p-5" aria-busy={isFilterPending || isMutationPending}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">
            Registre hypotheses & pieces manquantes
          </h2>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Zones grises persistantes du dossier, historisees et actionnables.
          </p>
        </div>
        {isReadOnly ? (
          <div className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs text-[var(--slate-600)]">
            Consultation uniquement
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <select
          aria-label="Filtrer par statut"
          className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
          value={filterStatus}
          onChange={(event) =>
            applyFilters({
              status: (event.target.value as AffaireRegisterEntryStatus) || null,
              cursor: null,
            })
          }
        >
          <option value="">Tous les statuts</option>
          {Object.entries(AFFAIRE_REGISTER_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrer par severite"
          className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
          value={filterSeverity}
          onChange={(event) =>
            applyFilters({
              severity: (event.target.value as AffaireRegisterEntrySeverity) || null,
              cursor: null,
            })
          }
        >
          <option value="">Toutes les severites</option>
          {Object.entries(AFFAIRE_REGISTER_SEVERITY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Filtrer par type"
          className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
          value={filterKind}
          onChange={(event) =>
            applyFilters({
              kind: (event.target.value as AffaireRegisterEntryKind) || null,
              cursor: null,
            })
          }
        >
          <option value="">Tous les types</option>
          {Object.entries(AFFAIRE_REGISTER_KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        {hasActiveFilters ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={resetFilters}
          >
            Reinitialiser
          </button>
        ) : null}
      </div>

      {!isReadOnly ? (
        <div className="mt-4 rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/80 p-4">
          <div className="grid gap-3 lg:grid-cols-6">
            <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-1">
              Type
              <select
                className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                value={form.kind}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    kind: event.target.value as AffaireRegisterEntryKind,
                  }))
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
              Severite
              <select
                className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                value={form.severity}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    severity: event.target.value as AffaireRegisterEntrySeverity,
                  }))
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
                className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                value={form.scopeType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    scopeType: event.target.value as "project" | "lot" | "line" | "exception",
                    scopeId: "",
                    scopeRef: "",
                    scopeLabel: "",
                  }))
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
            {(form.scopeType === "lot" || form.scopeType === "line") ? (
              <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-3">
                {form.scopeType === "lot" ? "Lot cible" : "Ligne cible"}
                <select
                  aria-label={form.scopeType === "lot" ? "Lot cible" : "Ligne cible"}
                  className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                  value={form.scopeId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      scopeId: event.target.value,
                    }))
                  }
                >
                  <option value="">
                    {form.scopeType === "lot" ? "Selectionner un lot" : "Selectionner une ligne"}
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
                  Reference exception
                  <input
                    className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                    value={form.scopeRef}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scopeRef: event.target.value,
                      }))
                    }
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-2">
                  Libelle exception
                  <input
                    className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                    value={form.scopeLabel}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        scopeLabel: event.target.value,
                      }))
                    }
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
                className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                value={form.text}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    text: event.target.value,
                  }))
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[var(--slate-600)] lg:col-span-2">
              Source documentaire (facultatif)
              <input
                className="rounded-lg border border-[var(--slate-200)] bg-white px-3 py-2 text-sm text-[var(--slate-700)]"
                value={form.sourceFileName}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    sourceFileName: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          {scopeHelpMessage ? (
            <p className="mt-3 text-xs text-[var(--warning)]">{scopeHelpMessage}</p>
          ) : null}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canCreateEntry || isMutationPending}
              onClick={() => void handleCreateEntry()}
            >
              Ajouter au registre
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-4 py-8 text-center text-sm text-[var(--slate-500)]">
            Aucune entree du registre pour ces filtres.
          </div>
        ) : (
          items.map((entry) => (
            <article
              key={entry.id}
              className="rounded-2xl border border-[var(--slate-200)] bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                      {AFFAIRE_REGISTER_KIND_LABELS[entry.kind]}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${SEVERITY_TONE[entry.severity]}`}
                    >
                      {AFFAIRE_REGISTER_SEVERITY_LABELS[entry.severity]}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[entry.status]}`}
                    >
                      {AFFAIRE_REGISTER_STATUS_LABELS[entry.status]}
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-[var(--slate-800)]">{entry.text}</p>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate-500)]">
                    <span>
                      Scope: {AFFAIRE_REGISTER_SCOPE_LABELS[entry.scopeType]} · {entry.scopeLabel}
                    </span>
                    <span>Origine: {AFFAIRE_REGISTER_ORIGIN_LABELS[entry.originKind]}</span>
                    <span>
                      MAJ: {formatDateTime(entry.updatedAt)}
                      {entry.updatedByName ? ` · ${entry.updatedByName}` : ""}
                    </span>
                    {entry.sourceFileName ? (
                      <span>Source: {entry.sourceFileName}</span>
                    ) : null}
                  </div>
                </div>
                {renderEntryActions(entry)}
              </div>
            </article>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-between gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!registerPage?.filters.cursor || isFilterPending}
          onClick={() => applyFilters({ cursor: null })}
        >
          Retour debut
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!registerPage?.nextCursor || isFilterPending}
          onClick={() =>
            applyFilters({
              cursor: registerPage?.nextCursor ?? null,
            })
          }
        >
          Page suivante
        </button>
      </div>
    </section>
  );
}
