"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  MappingRuleEditor,
  type MappingRuleEditorSubmitPayload,
} from "@/components/takeoff/MappingRuleEditor";
import { useConfirm } from "@/components/feedback/confirm-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  rename: "Renommer",
  set_price: "Fixer le prix",
  set_category: "Fixer la catégorie",
  apply_assembly: "Appliquer un ouvrage",
  skip: "Ignorer",
};

const MATCH_LABELS: Record<TakeoffMappingRule["match_type"], string> = {
  exact: "Exact",
  contains: "Contient",
  regex: "Expression régulière",
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
  const confirm = useConfirm();
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
          setSuccessMessage("Règle créée.");
        } else {
          await updateTakeoffMappingRule(
            editorState.rule.id,
            payload as UpdateTakeoffMappingRuleInput
          );
          setSuccessMessage("Règle mise à jour.");
        }

        setEditorState(null);
        await mutate();
      } catch (error) {
        setActionError(
          toErrorMessage(error, "Impossible d'enregistrer la règle de mapping.")
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
        setSuccessMessage(rule.is_active ? "Règle désactivée." : "Règle activée.");
        await mutate();
      } catch (error) {
        setActionError(
          toErrorMessage(error, "Impossible de modifier l'état actif/inactif.")
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
        "Corrigez les priorités invalides avant de sauvegarder l'ordre."
      );
      return;
    }

    if (updates.length === 0) {
      setSuccessMessage("Aucun changement de priorité.");
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
        setSuccessMessage("Ordre des priorités enregistré.");
      } catch {
        setActionError(null);
        setSuccessMessage(
          "Ordre des priorités enregistré. Impossible d'actualiser la liste pour le moment."
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
          "Impossible de sauvegarder l'ordre des priorités."
        )
      );
    } finally {
      setIsReordering(false);
    }
  }, [filteredRules, isEditorSubmitting, isReordering, mutate, priorityDraftById]);

  const confirmDelete = useCallback(async (targetRule: TakeoffMappingRule) => {
    if (busyRuleId || isReordering || isEditorSubmitting) return;

    const confirmed = await confirm({
      title: "Supprimer la règle",
      description: `La règle « ${targetRule.name} » sera supprimée définitivement.`,
      confirmLabel: "Supprimer la règle",
      tone: "danger",
    });
    if (!confirmed) return;

    setActionError(null);
    setSuccessMessage(null);
    setBusyRuleId(targetRule.id);

    try {
      await deleteTakeoffMappingRule(targetRule.id);
      setSuccessMessage("Règle supprimée.");
      await mutate();
    } catch (error) {
      setActionError(
        toErrorMessage(error, "Impossible de supprimer la règle de mapping.")
      );
    } finally {
      setBusyRuleId(null);
    }
  }, [busyRuleId, confirm, isEditorSubmitting, isReordering, mutate]);

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        className="mb-0 sm:mb-0"
        eyebrow="Administration"
        title="Règles d’enrichissement de l’extraction"
        description="Créez, testez et priorisez les règles d’enrichissement automatique des métrés."
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => {
                setEditorState({ mode: "create", rule: null });
                setActionError(null);
                setSuccessMessage(null);
              }}
              disabled={Boolean(editorState) || isEditorSubmitting || isReordering}
            >
              Nouvelle règle
            </Button>
            <Button
              variant="outline"
              onClick={() => void mutate()}
              loading={isRulesRefreshing}
            >
              Actualiser
            </Button>
          </>
        }
      />

      {rulesLoadError && rules.length === 0 ? (
        <Alert variant="danger">
          <AlertDescription>
            {toErrorMessage(rulesLoadError, "Impossible de charger les règles de mapping.")}
          </AlertDescription>
        </Alert>
      ) : null}
      {assembliesLoadError ? (
        <Alert variant="danger">
          <AlertDescription>
            {toErrorMessage(
              assembliesLoadError,
              "Impossible de charger les ouvrages pour l’action « Appliquer un ouvrage »."
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="danger">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      ) : null}
      {successMessage ? (
        <Alert variant="success">
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      ) : null}

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

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
          <div className="flex w-full max-w-md flex-col gap-1.5">
            <FieldLabel htmlFor="mapping-rules-search">Rechercher</FieldLabel>
            <Input
              id="mapping-rules-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nom, pattern ou action"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              onClick={() => void handleSaveOrder()}
              disabled={!hasPriorityChanges || isEditorSubmitting}
              loading={isReordering}
            >
              Enregistrer l&apos;ordre
            </Button>
            <span className="text-xs text-muted-foreground">
              {isAssembliesLoading ? "Ouvrages : chargement…" : `${assemblies.length} ouvrage(s)`}
            </span>
          </div>
        </div>

        {isRulesLoading ? (
          <LoadingState label="Chargement des règles de mapping…" />
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label="Règles de mapping"
            tabIndex={0}
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th>Priorité</th>
                  <th>État</th>
                  <th>Nom</th>
                  <th>Match</th>
                  <th>Action</th>
                  <th>Créée le</th>
                  <th>Opérations</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-muted-foreground">
                      Aucune règle de mapping.
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
                            <Input
                              type="number"
                              size="sm"
                              min={0}
                              max={100000}
                              step={1}
                              inputMode="numeric"
                              aria-invalid={priorityErrorById[rule.id] ? true : undefined}
                              aria-describedby={
                                priorityErrorById[rule.id] ? `mapping-rule-priority-error-${rule.id}` : undefined
                              }
                              aria-label={`Priorité de ${rule.name}`}
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
                              <p
                                id={`mapping-rule-priority-error-${rule.id}`}
                                className="mt-1 text-micro text-danger"
                              >
                                {priorityErrorById[rule.id]}
                              </p>
                            ) : null}
                          </div>
                        </td>
                        <td>
                          <Badge size="sm" variant={rule.is_active ? "success" : "neutral"} dot>
                            {rule.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td>
                          <div className="font-semibold text-foreground">{rule.name}</div>
                        </td>
                        <td>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {MATCH_LABELS[rule.match_type]}
                          </div>
                          <div className="mt-1 text-sm text-foreground-secondary">
                            {rule.match_pattern}
                          </div>
                        </td>
                        <td>
                          <div className="text-xs uppercase tracking-wide text-muted-foreground">
                            {ACTION_LABELS[rule.action]}
                          </div>
                          <div className="mt-1 text-sm text-foreground-secondary">
                            {renderActionDetails(rule, assembliesById)}
                          </div>
                        </td>
                        <td>{formatDate(rule.created_at)}</td>
                        <td>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Modifier ${rule.name}`}
                              onClick={() => {
                                setEditorState({ mode: "edit", rule });
                                setActionError(null);
                                setSuccessMessage(null);
                              }}
                              disabled={isBusy || isEditorSubmitting || isReordering}
                            >
                              Modifier
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`${rule.is_active ? "Désactiver" : "Activer"} ${rule.name}`}
                              onClick={() => void handleToggleActive(rule)}
                              disabled={isBusy || isEditorSubmitting || isReordering}
                            >
                              {rule.is_active ? "Désactiver" : "Activer"}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              aria-label={`Supprimer ${rule.name}`}
                              onClick={() => void confirmDelete(rule)}
                              disabled={isBusy || isEditorSubmitting || isReordering}
                            >
                              Supprimer
                            </Button>
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
      </Card>
    </div>
  );
}
