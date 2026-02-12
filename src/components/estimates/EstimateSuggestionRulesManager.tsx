"use client";

import { useMemo, useState } from "react";

import type { Database } from "@/types/database";

type SuggestionRule =
  Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
type EstimateCategory =
  Database["public"]["Tables"]["estimate_categories"]["Row"];
type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

export type SuggestionRuleCreatePayload = {
  name: string;
  match_value: string;
  unit: string | null;
  category_id: string | null;
  k_fo: number | null;
  k_mo: number | null;
  labor_role_id: string | null;
  position: number | null;
  is_active: boolean;
};

type EstimateSuggestionRulesManagerProps = {
  rules: SuggestionRule[];
  categories: EstimateCategory[];
  laborRoles: LaborRole[];
  isSaving: boolean;
  error: string | null;
  onCreate: (payload: SuggestionRuleCreatePayload) => Promise<void>;
  onUpdate: (id: string, updates: Partial<SuggestionRule>) => Promise<void>;
};

type RuleDraft = {
  name: string;
  match_value: string;
  unit: string;
  category_id: string;
  k_fo: string;
  k_mo: string;
  labor_role_id: string;
  position: string;
  is_active: boolean;
};

function formatNumberInput(value: number | null) {
  if (!Number.isFinite(value ?? NaN)) return "";
  return (value ?? 0).toFixed(2);
}

function parseOptionalNumber(value: string) {
  const normalized = value.replace(",", ".").trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeKeywords(value: string) {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

export function EstimateSuggestionRulesManager({
  rules,
  categories,
  laborRoles,
  isSaving,
  error,
  onCreate,
  onUpdate,
}: EstimateSuggestionRulesManagerProps) {
  const [drafts, setDrafts] = useState<Record<string, RuleDraft>>({});
  const [newName, setNewName] = useState("");
  const [newKeywords, setNewKeywords] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [newKFo, setNewKFo] = useState("");
  const [newKMo, setNewKMo] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const mergedDrafts = useMemo(() => {
    const next = { ...drafts };
    rules.forEach((rule) => {
      if (!next[rule.id]) {
        next[rule.id] = {
          name: rule.name,
          match_value: rule.match_value,
          unit: rule.unit ?? "",
          category_id: rule.category_id ?? "",
          k_fo: formatNumberInput(rule.k_fo),
          k_mo: formatNumberInput(rule.k_mo),
          labor_role_id: rule.labor_role_id ?? "",
          position: String(rule.position),
          is_active: rule.is_active,
        };
      }
    });
    return next;
  }, [drafts, rules]);

  async function handleAddRule() {
    setFormError(null);
    const trimmedName = newName.trim();
    const keywords = normalizeKeywords(newKeywords);

    if (!trimmedName) {
      setFormError("Le nom de la regle est obligatoire.");
      return;
    }

    if (!keywords) {
      setFormError("Ajoutez au moins un mot-cle.");
      return;
    }

    const positionValue = Number.parseInt(newPosition, 10);
    const payload: SuggestionRuleCreatePayload = {
      name: trimmedName,
      match_value: keywords,
      unit: newUnit.trim() || null,
      category_id: newCategoryId || null,
      k_fo: parseOptionalNumber(newKFo),
      k_mo: parseOptionalNumber(newKMo),
      labor_role_id: newRoleId || null,
      position: Number.isFinite(positionValue) ? positionValue : null,
      is_active: true,
    };

    await onCreate(payload);
    setNewName("");
    setNewKeywords("");
    setNewUnit("");
    setNewCategoryId("");
    setNewKFo("");
    setNewKMo("");
    setNewRoleId("");
    setNewPosition("");
  }

  async function handleBlur(rule: SuggestionRule) {
    const draft = mergedDrafts[rule.id];
    if (!draft) return;

    const trimmedName = draft.name.trim();
    const normalizedKeywords = normalizeKeywords(draft.match_value);
    const unitValue = draft.unit.trim() || null;
    const categoryValue = draft.category_id || null;
    const kFoValue = parseOptionalNumber(draft.k_fo);
    const kMoValue = parseOptionalNumber(draft.k_mo);
    const roleValue = draft.labor_role_id || null;
    const positionValue = Number.parseInt(draft.position, 10);

    if (!trimmedName) {
      setDrafts((prev) => ({
        ...prev,
        [rule.id]: { ...draft, name: rule.name },
      }));
      return;
    }

    if (!normalizedKeywords) {
      setDrafts((prev) => ({
        ...prev,
        [rule.id]: { ...draft, match_value: rule.match_value },
      }));
      return;
    }

    if (!Number.isFinite(positionValue)) {
      setDrafts((prev) => ({
        ...prev,
        [rule.id]: { ...draft, position: String(rule.position) },
      }));
      return;
    }

    const updates: Partial<SuggestionRule> = {};

    if (trimmedName !== rule.name) updates.name = trimmedName;
    if (normalizedKeywords !== rule.match_value) {
      updates.match_value = normalizedKeywords;
    }
    if (unitValue !== rule.unit) updates.unit = unitValue;
    if (categoryValue !== rule.category_id) updates.category_id = categoryValue;
    if (kFoValue !== rule.k_fo) updates.k_fo = kFoValue;
    if (kMoValue !== rule.k_mo) updates.k_mo = kMoValue;
    if (roleValue !== rule.labor_role_id) {
      updates.labor_role_id = roleValue;
    }
    if (positionValue !== rule.position) updates.position = positionValue;
    if (draft.is_active !== rule.is_active) {
      updates.is_active = draft.is_active;
    }

    if (Object.keys(updates).length === 0) return;

    await onUpdate(rule.id, updates);
  }

  return (
    <div className="dashboard-card p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--slate-800)]">
            Base de chiffrage
          </h2>
          <p className="mt-1 text-sm text-[var(--slate-500)]">
            Definissez des regles pour suggerer Type FO, unite, coefficients et
            role MO.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error mt-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {error}
        </div>
      )}

      <div className="estimate-role-form mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.6fr_1fr_1fr_1fr_1fr_1fr_110px_auto]">
        <div>
          <label className="form-label" htmlFor="rule-name">
            Nom de regle
          </label>
          <input
            id="rule-name"
            className="form-input form-input--sm"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Ex: Tube cuivre"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="rule-keywords">
            Mots-cles (virgules)
          </label>
          <input
            id="rule-keywords"
            className="form-input form-input--sm"
            value={newKeywords}
            onChange={(event) => setNewKeywords(event.target.value)}
            placeholder="cuivre, tube, 20mm"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="rule-unit">
            Unite
          </label>
          <input
            id="rule-unit"
            className="form-input form-input--sm"
            value={newUnit}
            onChange={(event) => setNewUnit(event.target.value)}
            placeholder="u"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="rule-category">
            Type FO
          </label>
          <select
            id="rule-category"
            className="form-input form-input--sm form-select"
            value={newCategoryId}
            onChange={(event) => setNewCategoryId(event.target.value)}
          >
            <option value="">-</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="rule-kfo">
            K FO
          </label>
          <input
            id="rule-kfo"
            className="form-input form-input--sm"
            type="number"
            step="0.01"
            min={0}
            value={newKFo}
            onChange={(event) => setNewKFo(event.target.value)}
            placeholder="1.00"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="rule-kmo">
            K MO
          </label>
          <input
            id="rule-kmo"
            className="form-input form-input--sm"
            type="number"
            step="0.01"
            min={0}
            value={newKMo}
            onChange={(event) => setNewKMo(event.target.value)}
            placeholder="1.00"
          />
        </div>
        <div>
          <label className="form-label" htmlFor="rule-role">
            Role MO
          </label>
          <select
            id="rule-role"
            className="form-input form-input--sm form-select"
            value={newRoleId}
            onChange={(event) => setNewRoleId(event.target.value)}
          >
            <option value="">-</option>
            {laborRoles.map((role) => (
              <option key={role.id} value={role.id} disabled={!role.is_active}>
                {role.name}
                {!role.is_active ? " (inactif)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label" htmlFor="rule-position">
            Priorite
          </label>
          <input
            id="rule-position"
            className="form-input form-input--sm"
            type="number"
            min={1}
            value={newPosition}
            onChange={(event) => setNewPosition(event.target.value)}
            placeholder="Auto"
          />
        </div>
        <div className="flex items-end">
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={handleAddRule}
            disabled={isSaving}
          >
            Ajouter
          </button>
        </div>
      </div>

      {formError && (
        <p className="mt-3 text-sm text-[var(--error)]">{formError}</p>
      )}

      <div className="table-scroll mt-6">
        <table className="data-table">
          <thead>
            <tr>
              <th>Regle</th>
              <th>Mots-cles</th>
              <th>Unite</th>
              <th>Type FO</th>
              <th>K FO</th>
              <th>K MO</th>
              <th>Role MO</th>
              <th>Priorite</th>
              <th>Actif</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="text-sm text-[var(--slate-500)]">
                    Aucune regle definie.
                  </div>
                </td>
              </tr>
            ) : (
              rules.map((rule) => {
                const draft = mergedDrafts[rule.id] ?? {
                  name: rule.name,
                  match_value: rule.match_value,
                  unit: rule.unit ?? "",
                  category_id: rule.category_id ?? "",
                  k_fo: formatNumberInput(rule.k_fo),
                  k_mo: formatNumberInput(rule.k_mo),
                  labor_role_id: rule.labor_role_id ?? "",
                  position: String(rule.position),
                  is_active: rule.is_active,
                };
                return (
                  <tr key={rule.id}>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        value={draft.name}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: { ...draft, name: event.target.value },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        value={draft.match_value}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: {
                              ...draft,
                              match_value: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        value={draft.unit}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: { ...draft, unit: event.target.value },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                        placeholder="u"
                      />
                    </td>
                    <td>
                      <select
                        className="form-input form-input--sm form-select"
                        value={draft.category_id}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: {
                              ...draft,
                              category_id: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                      >
                        <option value="">-</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.k_fo}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: { ...draft, k_fo: event.target.value },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                        placeholder="1.00"
                      />
                    </td>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.k_mo}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: { ...draft, k_mo: event.target.value },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                        placeholder="1.00"
                      />
                    </td>
                    <td>
                      <select
                        className="form-input form-input--sm form-select"
                        value={draft.labor_role_id}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: {
                              ...draft,
                              labor_role_id: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                      >
                        <option value="">-</option>
                        {laborRoles.map((role) => (
                          <option
                            key={role.id}
                            value={role.id}
                            disabled={!role.is_active}
                          >
                            {role.name}
                            {!role.is_active ? " (inactif)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className="form-input form-input--sm"
                        type="number"
                        min={1}
                        value={draft.position}
                        onChange={(event) =>
                          setDrafts((prev) => ({
                            ...prev,
                            [rule.id]: {
                              ...draft,
                              position: event.target.value,
                            },
                          }))
                        }
                        onBlur={() => handleBlur(rule)}
                      />
                    </td>
                    <td>
                      <label className="estimate-toggle">
                        <input
                          type="checkbox"
                          checked={draft.is_active}
                          onChange={(event) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [rule.id]: {
                                ...draft,
                                is_active: event.target.checked,
                              },
                            }))
                          }
                          onBlur={() => handleBlur(rule)}
                        />
                        <span>{draft.is_active ? "Actif" : "Inactif"}</span>
                      </label>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
