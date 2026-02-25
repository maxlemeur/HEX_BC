"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  MappingRuleEditor,
  type MappingRuleEditorSubmitPayload,
} from "@/components/takeoff/MappingRuleEditor";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import {
  fetchEstimateAssemblies,
  type EstimateAssemblySummary,
} from "@/lib/estimates/client";
import {
  createTakeoffMappingRule,
  deleteTakeoffMappingRule,
  fetchTakeoffMappingRules,
  isTakeoffApiError,
  updateTakeoffMappingRule,
} from "@/lib/takeoff/client";
import type {
  CreateTakeoffMappingRuleInput,
  TakeoffMappingRule,
  UpdateTakeoffMappingRuleInput,
} from "@/lib/takeoff/types";

const ACTION_LABELS: Record<TakeoffMappingRule["action"], string> = {
  rename: "Rename",
  set_price: "Set price",
  set_category: "Set category",
  apply_assembly: "Apply assembly",
  skip: "Skip",
};

const MATCH_LABELS: Record<TakeoffMappingRule["match_type"], string> = {
  exact: "Exact",
  contains: "Contains",
  regex: "Regex",
};

type EditorState =
  | {
      mode: "create";
      rule: null;
    }
  | {
      mode: "edit";
      rule: TakeoffMappingRule;
    };

const EMPTY_RULES: TakeoffMappingRule[] = [];
const EMPTY_ASSEMBLIES: EstimateAssemblySummary[] = [];

function parsePriorityInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;

  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100000) {
    return null;
  }

  return parsed;
}

function toErrorMessage(error: unknown, fallback: string) {
  if (isTakeoffApiError(error)) {
    return error.message || fallback;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
}

function formatDate(dateIso: string) {
  const parsed = new Date(dateIso);
  if (Number.isNaN(parsed.getTime())) return "-";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const year = parsed.getFullYear();
  return `${day}/${month}/${year}`;
}

function renderActionDetails(
  rule: TakeoffMappingRule,
  assembliesById: Map<string, EstimateAssemblySummary>
) {
  switch (rule.action) {
    case "rename":
      return `=> ${rule.action_params.designation}`;
    case "set_price":
      return `${rule.action_params.unit_price_cents} cts`;
    case "set_category":
      return rule.action_params.category_id;
    case "apply_assembly": {
      const assembly = assembliesById.get(rule.action_params.assembly_id);
      return assembly
        ? `${assembly.name} (${assembly.itemCount} ligne(s))`
        : rule.action_params.assembly_id;
    }
    case "skip":
      return "Ignore l'item source";
    default: {
      const exhaustiveCheck: never = rule;
      return exhaustiveCheck;
    }
  }
}

export function MappingRulesManager() {
  const [search, setSearch] = useState("");
  const [editorState, setEditorState] = useState<EditorState | null>(null);
  const [isEditorSubmitting, setIsEditorSubmitting] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState<string | null>(null);
  const [priorityDraftById, setPriorityDraftById] = useState<Record<string, string>>(
    {}
  );
  const [priorityDirtyById, setPriorityDirtyById] = useState<Record<string, boolean>>(
    {}
  );
  const [priorityErrorById, setPriorityErrorById] = useState<Record<string, string>>(
    {}
  );
  const [deletingRule, setDeletingRule] = useState<TakeoffMappingRule | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const priorityDirtyByIdRef = useRef<Record<string, boolean>>({});

  useEffect(() => {
    priorityDirtyByIdRef.current = priorityDirtyById;
  }, [priorityDirtyById]);

  const {
    data: rules = EMPTY_RULES,
    error: rulesLoadError,
    isLoading: isRulesLoading,
    isValidating: isRulesRefreshing,
    mutate,
  } = useSWR<TakeoffMappingRule[]>(
    ["takeoff-mapping-rules"],
    () => fetchTakeoffMappingRules(),
    {
      revalidateOnFocus: true,
    }
  );

  const {
    data: assemblies = EMPTY_ASSEMBLIES,
    error: assembliesLoadError,
    isLoading: isAssembliesLoading,
  } = useSWR<EstimateAssemblySummary[]>(
    ["takeoff-mapping-assemblies"],
    () =>
      fetchEstimateAssemblies({
        limit: 100,
        order: "recent",
      }),
    {
      revalidateOnFocus: false,
    }
  );

  const sortedRules = useMemo(() => {
    return [...rules].sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return left.created_at.localeCompare(right.created_at);
    });
  }, [rules]);

  useEffect(() => {
    setPriorityDraftById((previousDrafts) => {
      const nextDrafts: Record<string, string> = {};

      sortedRules.forEach((rule) => {
        const hasDraft = Object.prototype.hasOwnProperty.call(
          previousDrafts,
          rule.id
        );
        const keepDraft = hasDraft && priorityDirtyByIdRef.current[rule.id];

        nextDrafts[rule.id] = keepDraft
          ? previousDrafts[rule.id] ?? String(rule.priority)
          : String(rule.priority);
      });

      const previousKeys = Object.keys(previousDrafts);
      const nextKeys = Object.keys(nextDrafts);
      if (previousKeys.length === nextKeys.length) {
        const unchanged = nextKeys.every(
          (key) => previousDrafts[key] === nextDrafts[key]
        );
        if (unchanged) {
          return previousDrafts;
        }
      }

      return nextDrafts;
    });

    setPriorityDirtyById((previousDirty) => {
      const nextDirty: Record<string, boolean> = {};
      sortedRules.forEach((rule) => {
        if (previousDirty[rule.id]) {
          nextDirty[rule.id] = true;
        }
      });

      const previousKeys = Object.keys(previousDirty);
      const nextKeys = Object.keys(nextDirty);
      if (previousKeys.length === nextKeys.length) {
        const unchanged = nextKeys.every((key) => previousDirty[key] === nextDirty[key]);
        if (unchanged) {
          return previousDirty;
        }
      }

      return nextDirty;
    });

    setPriorityErrorById((previousErrors) => {
      const nextErrors: Record<string, string> = {};
      sortedRules.forEach((rule) => {
        if (previousErrors[rule.id]) {
          nextErrors[rule.id] = previousErrors[rule.id] as string;
        }
      });

      const previousKeys = Object.keys(previousErrors);
      const nextKeys = Object.keys(nextErrors);
      if (previousKeys.length === nextKeys.length) {
        const unchanged = nextKeys.every(
          (key) => previousErrors[key] === nextErrors[key]
        );
        if (unchanged) {
          return previousErrors;
        }
      }

      return nextErrors;
    });
  }, [sortedRules]);

  const filteredRules = useMemo(() => {
    const token = search.trim().toLowerCase();
    if (!token) return sortedRules;

    return sortedRules.filter((rule) => {
      if (rule.name.toLowerCase().includes(token)) return true;
      if (rule.match_pattern.toLowerCase().includes(token)) return true;
      if (ACTION_LABELS[rule.action].toLowerCase().includes(token)) return true;
      return false;
    });
  }, [search, sortedRules]);

  const assembliesById = useMemo(() => {
    const map = new Map<string, EstimateAssemblySummary>();
    assemblies.forEach((assembly) => map.set(assembly.id, assembly));
    return map;
  }, [assemblies]);

  const hasPriorityChanges = useMemo(() => {
    return filteredRules.some((rule) => {
      const parsedDraft = parsePriorityInput(priorityDraftById[rule.id] ?? "");
      return parsedDraft !== null && parsedDraft !== rule.priority;
    });
  }, [filteredRules, priorityDraftById]);

  const nextCreatePriority = useMemo(() => {
    if (sortedRules.length === 0) return 10;
    return Math.max(...sortedRules.map((rule) => rule.priority)) + 10;
  }, [sortedRules]);

  const closeEditor = useCallback(() => {
    if (isEditorSubmitting) return;
    setEditorState(null);
  }, [isEditorSubmitting]);

  const handleEditorSubmit = useCallback(
    async (payload: MappingRuleEditorSubmitPayload) => {
      if (!editorState) return;

      setActionError(null);
      setSuccessMessage(null);
      setIsEditorSubmitting(true);

      try {
        if (editorState.mode === "create") {
          await createTakeoffMappingRule(payload as CreateTakeoffMappingRuleInput);
          setSuccessMessage("Regle creee.");
        } else {
          await updateTakeoffMappingRule(
            editorState.rule.id,
            payload as UpdateTakeoffMappingRuleInput
          );
          setSuccessMessage("Regle mise a jour.");
        }

        setEditorState(null);
        await mutate();
      } catch (error) {
        setActionError(
          toErrorMessage(error, "Impossible d'enregistrer la regle de mapping.")
        );
      } finally {
        setIsEditorSubmitting(false);
      }
    },
    [editorState, mutate]
  );

  const handleToggleActive = useCallback(
    async (rule: TakeoffMappingRule) => {
      if (busyRuleId || isEditorSubmitting || isReordering) return;
      setActionError(null);
      setSuccessMessage(null);
      setBusyRuleId(rule.id);

      try {
        await updateTakeoffMappingRule(rule.id, {
          is_active: !rule.is_active,
        });
        setSuccessMessage(rule.is_active ? "Regle desactivee." : "Regle activee.");
        await mutate();
      } catch (error) {
        setActionError(
          toErrorMessage(error, "Impossible de modifier l'etat actif/inactif.")
        );
      } finally {
        setBusyRuleId(null);
      }
    },
    [busyRuleId, isEditorSubmitting, isReordering, mutate]
  );

  const handleSaveOrder = useCallback(async () => {
    if (isReordering || isEditorSubmitting) return;

    setActionError(null);
    setSuccessMessage(null);

    const updates: Array<{
      id: string;
      previousPriority: number;
      nextPriority: number;
    }> = [];
    const nextFieldErrors: Record<string, string> = {};

    filteredRules.forEach((rule) => {
      const parsedDraft = parsePriorityInput(priorityDraftById[rule.id] ?? "");
      if (parsedDraft === null) {
        nextFieldErrors[rule.id] = "Entier 0-100000 attendu.";
        return;
      }
      if (parsedDraft !== rule.priority) {
        updates.push({
          id: rule.id,
          previousPriority: rule.priority,
          nextPriority: parsedDraft,
        });
      }
    });

    setPriorityErrorById(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setActionError(
        "Corrigez les priorites invalides avant de sauvegarder l'ordre."
      );
      return;
    }

    if (updates.length === 0) {
      setSuccessMessage("Aucun changement de priorite.");
      return;
    }

    setIsReordering(true);
    const appliedUpdates: Array<{ id: string; previousPriority: number }> = [];

    try {
      for (const update of updates) {
        await updateTakeoffMappingRule(update.id, {
          priority: update.nextPriority,
        });
        appliedUpdates.push({
          id: update.id,
          previousPriority: update.previousPriority,
        });
      }

      setPriorityDraftById((previousDrafts) => {
        const nextDrafts = { ...previousDrafts };
        updates.forEach((update) => {
          nextDrafts[update.id] = String(update.nextPriority);
        });
        return nextDrafts;
      });
      setPriorityDirtyById((previousDirty) => {
        const nextDirty = { ...previousDirty };
        updates.forEach((update) => {
          delete nextDirty[update.id];
        });
        return nextDirty;
      });
      setPriorityErrorById((previousErrors) => {
        const nextErrors = { ...previousErrors };
        updates.forEach((update) => {
          delete nextErrors[update.id];
        });
        return nextErrors;
      });

      try {
        await mutate();
        setSuccessMessage("Ordre des priorites enregistre.");
      } catch {
        setActionError(null);
        setSuccessMessage(
          "Ordre des priorites enregistre. Impossible d'actualiser la liste pour le moment."
        );
      }
    } catch (writeError) {
      await Promise.allSettled(
        appliedUpdates.map((update) =>
          updateTakeoffMappingRule(update.id, {
            priority: update.previousPriority,
          })
        )
      );
      await mutate().catch(() => undefined);
      setSuccessMessage(null);
      setActionError(
        toErrorMessage(
          writeError,
          "Impossible de sauvegarder l'ordre des priorites."
        )
      );
    } finally {
      setIsReordering(false);
    }
  }, [filteredRules, isEditorSubmitting, isReordering, mutate, priorityDraftById]);

  const confirmDelete = useCallback(async () => {
    if (!deletingRule) return;
    if (busyRuleId || isReordering || isEditorSubmitting) return;

    const targetRule = deletingRule;
    setDeletingRule(null);
    setActionError(null);
    setSuccessMessage(null);
    setBusyRuleId(targetRule.id);

    try {
      await deleteTakeoffMappingRule(targetRule.id);
      setSuccessMessage("Regle supprimee.");
      await mutate();
    } catch (error) {
      setActionError(
        toErrorMessage(error, "Impossible de supprimer la regle de mapping.")
      );
    } finally {
      setBusyRuleId(null);
    }
  }, [busyRuleId, deletingRule, isEditorSubmitting, isReordering, mutate]);

  return (
    <div className="animate-fade-in space-y-6">
      <header className="page-header flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Takeoff mapping rules</h1>
          <p className="page-description">
            Creez, testez et priorisez les regles d&apos;enrichissement automatique.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditorState({ mode: "create", rule: null });
              setActionError(null);
              setSuccessMessage(null);
            }}
            disabled={Boolean(editorState) || isEditorSubmitting || isReordering}
          >
            Nouvelle regle
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => void mutate()}
            disabled={isRulesRefreshing}
          >
            {isRulesRefreshing ? "Actualisation..." : "Actualiser"}
          </button>
        </div>
      </header>

      {rulesLoadError && rules.length === 0 ? (
        <div className="alert alert-error">
          {toErrorMessage(rulesLoadError, "Impossible de charger les regles de mapping.")}
        </div>
      ) : null}
      {assembliesLoadError ? (
        <div className="alert alert-error">
          {toErrorMessage(
            assembliesLoadError,
            "Impossible de charger les assemblages pour apply_assembly."
          )}
        </div>
      ) : null}
      {actionError ? <div className="alert alert-error">{actionError}</div> : null}
      {successMessage ? <div className="alert alert-success">{successMessage}</div> : null}

      {editorState ? (
        <MappingRuleEditor
          key={editorState.mode === "edit" ? editorState.rule.id : "create"}
          mode={editorState.mode}
          initialRule={editorState.rule}
          assemblies={assemblies}
          defaultPriority={nextCreatePriority}
          isSubmitting={isEditorSubmitting}
          onCancel={closeEditor}
          onSubmit={handleEditorSubmit}
        />
      ) : null}

      <section className="dashboard-card overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--slate-200)] px-6 py-4">
          <div className="w-full max-w-md">
            <label className="form-label" htmlFor="mapping-rules-search">
              Rechercher
            </label>
            <input
              id="mapping-rules-search"
              className="form-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, pattern ou action"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleSaveOrder()}
              disabled={!hasPriorityChanges || isReordering || isEditorSubmitting}
            >
              {isReordering ? "Sauvegarde..." : "Enregistrer l'ordre"}
            </button>
            <span className="text-xs text-[var(--slate-500)]">
              {isAssembliesLoading ? "Assemblages: chargement..." : `${assemblies.length} assemblage(s)`}
            </span>
          </div>
        </div>

        {isRulesLoading ? (
          <div className="px-6 py-8 text-sm text-[var(--slate-500)]">
            Chargement des regles de mapping...
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Priorite</th>
                  <th>Etat</th>
                  <th>Nom</th>
                  <th>Match</th>
                  <th>Action</th>
                  <th>Cree le</th>
                  <th>Operations</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[var(--slate-500)]">
                      Aucune regle de mapping.
                    </td>
                  </tr>
                ) : (
                  filteredRules.map((rule) => {
                    const draftPriority = priorityDraftById[rule.id] ?? String(rule.priority);
                    const isBusy = busyRuleId === rule.id;
                    return (
                      <tr key={rule.id}>
                        <td>
                          <div className="w-[110px]">
                            <input
                              type="number"
                              min={0}
                              max={100000}
                              step={1}
                              inputMode="numeric"
                              className={`form-input form-input--sm ${
                                priorityErrorById[rule.id] ? "border-[var(--error)]" : ""
                              }`}
                              aria-label={`Priorite de ${rule.name}`}
                              value={draftPriority}
                              onChange={(event) => {
                                setPriorityDraftById((previous) => ({
                                  ...previous,
                                  [rule.id]: event.target.value,
                                }));
                                setPriorityDirtyById((previous) => ({
                                  ...previous,
                                  [rule.id]: true,
                                }));
                                setPriorityErrorById((previous) => {
                                  if (!previous[rule.id]) return previous;
                                  const next = { ...previous };
                                  delete next[rule.id];
                                  return next;
                                });
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                void handleSaveOrder();
                              }}
                              disabled={isBusy || isReordering}
                            />
                            {priorityErrorById[rule.id] ? (
                              <p className="mt-1 text-[11px] text-rose-700">
                                {priorityErrorById[rule.id]}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${
                              rule.is_active
                                ? "bg-emerald-50 text-emerald-700"
                                : "bg-[var(--slate-100)] text-[var(--slate-600)]"
                            }`}
                          >
                            {rule.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td>
                          <div className="font-semibold text-[var(--slate-800)]">{rule.name}</div>
                        </td>
                        <td>
                          <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                            {MATCH_LABELS[rule.match_type]}
                          </div>
                          <div className="mt-1 text-sm text-[var(--slate-700)]">
                            {rule.match_pattern}
                          </div>
                        </td>
                        <td>
                          <div className="text-xs uppercase tracking-wide text-[var(--slate-500)]">
                            {ACTION_LABELS[rule.action]}
                          </div>
                          <div className="mt-1 text-sm text-[var(--slate-700)]">
                            {renderActionDetails(rule, assembliesById)}
                          </div>
                        </td>
                        <td>{formatDate(rule.created_at)}</td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => {
                                setEditorState({ mode: "edit", rule });
                                setActionError(null);
                                setSuccessMessage(null);
                              }}
                              disabled={isBusy || isEditorSubmitting || isReordering}
                            >
                              Editer
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => void handleToggleActive(rule)}
                              disabled={isBusy || isEditorSubmitting || isReordering}
                            >
                              {rule.is_active ? "Desactiver" : "Activer"}
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              aria-label={`Supprimer ${rule.name}`}
                              onClick={() => setDeletingRule(rule)}
                              disabled={isBusy || isEditorSubmitting || isReordering}
                            >
                              Supprimer
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <ConfirmModal
        open={deletingRule !== null}
        title="Supprimer la regle"
        message={
          deletingRule
            ? `Confirmez la suppression definitive de la regle "${deletingRule.name}" ?`
            : ""
        }
        confirmLabel="Supprimer la regle"
        variant="danger"
        onCancel={() => setDeletingRule(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
