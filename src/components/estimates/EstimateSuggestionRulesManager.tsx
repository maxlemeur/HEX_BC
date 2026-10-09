"use client";

import { useMemo, useState } from "react";

import type { Database } from "@/types/database";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

const FIELD_CLASS = "flex min-w-0 flex-col gap-2";

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
      setFormError("Le nom de la règle est obligatoire.");
      return;
    }

    if (!keywords) {
      setFormError("Ajoutez au moins un mot-clé.");
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
    <Card className="p-5 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground">
            Base de chiffrage
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Définissez des règles pour suggérer le type FO, l&apos;unité, les
            coefficients et le rôle MO.
          </p>
        </div>
      </div>

      {error && (
        <Alert variant="danger" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="estimate-role-form mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1.6fr_1fr_1fr_1fr_1fr_1fr_110px_auto]">
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-name">Nom de règle</FieldLabel>
          <Input
            id="rule-name"
            size="sm"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="Ex. : Tube cuivre"
          />
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-keywords">Mots-clés (virgules)</FieldLabel>
          <Input
            id="rule-keywords"
            size="sm"
            value={newKeywords}
            onChange={(event) => setNewKeywords(event.target.value)}
            placeholder="cuivre, tube, 20mm"
          />
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-unit">Unité</FieldLabel>
          <Input
            id="rule-unit"
            size="sm"
            value={newUnit}
            onChange={(event) => setNewUnit(event.target.value)}
            placeholder="u"
          />
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-category">Type FO</FieldLabel>
          <NativeSelect
            id="rule-category"
            size="sm"
            value={newCategoryId}
            onChange={(event) => setNewCategoryId(event.target.value)}
          >
            <option value="">—</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-kfo">K FO</FieldLabel>
          <Input
            id="rule-kfo"
            size="sm"
            type="number"
            step="0.01"
            min={0}
            value={newKFo}
            onChange={(event) => setNewKFo(event.target.value)}
            placeholder="1.00"
          />
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-kmo">K MO</FieldLabel>
          <Input
            id="rule-kmo"
            size="sm"
            type="number"
            step="0.01"
            min={0}
            value={newKMo}
            onChange={(event) => setNewKMo(event.target.value)}
            placeholder="1.00"
          />
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-role">Rôle MO</FieldLabel>
          <NativeSelect
            id="rule-role"
            size="sm"
            value={newRoleId}
            onChange={(event) => setNewRoleId(event.target.value)}
          >
            <option value="">—</option>
            {laborRoles.map((role) => (
              <option key={role.id} value={role.id} disabled={!role.is_active}>
                {role.name}
                {!role.is_active ? " (inactif)" : ""}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className={FIELD_CLASS}>
          <FieldLabel htmlFor="rule-position">Priorité</FieldLabel>
          <Input
            id="rule-position"
            size="sm"
            type="number"
            min={1}
            value={newPosition}
            onChange={(event) => setNewPosition(event.target.value)}
            placeholder="Auto"
          />
        </div>
        <div className="flex items-end">
          <Button
            variant="primary"
            size="md"
            onClick={handleAddRule}
            disabled={isSaving}
          >
            Ajouter
          </Button>
        </div>
      </div>

      {formError && (
        <Alert variant="danger" className="mt-3">
          {formError}
        </Alert>
      )}

      <div
        className="table-scroll mt-6"
        role="region"
        aria-label="Règles de la base de chiffrage"
        tabIndex={0}
      >
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Règle</th>
              <th scope="col">Mots-clés</th>
              <th scope="col">Unité</th>
              <th scope="col">Type FO</th>
              <th scope="col">K FO</th>
              <th scope="col">K MO</th>
              <th scope="col">Rôle MO</th>
              <th scope="col">Priorité</th>
              <th scope="col">Actif</th>
            </tr>
          </thead>
          <tbody>
            {rules.length === 0 ? (
              <tr>
                <td colSpan={9}>
                  <div className="text-sm text-muted-foreground">
                    Aucune règle définie.
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
                const ruleLabel = `de la règle ${rule.name}`;
                return (
                  <tr key={rule.id}>
                    <td>
                      <Input
                        size="sm"
                        value={draft.name}
                        aria-label={`Libellé ${ruleLabel}`}
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
                      <Input
                        size="sm"
                        value={draft.match_value}
                        aria-label={`Mots-clés ${ruleLabel}`}
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
                      <Input
                        size="sm"
                        value={draft.unit}
                        aria-label={`Unité ${ruleLabel}`}
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
                      <NativeSelect
                        size="sm"
                        value={draft.category_id}
                        aria-label={`Type FO ${ruleLabel}`}
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
                        <option value="">—</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td>
                      <Input
                        size="sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.k_fo}
                        aria-label={`K FO ${ruleLabel}`}
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
                      <Input
                        size="sm"
                        type="number"
                        step="0.01"
                        min={0}
                        value={draft.k_mo}
                        aria-label={`K MO ${ruleLabel}`}
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
                      <NativeSelect
                        size="sm"
                        value={draft.labor_role_id}
                        aria-label={`Rôle MO ${ruleLabel}`}
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
                        <option value="">—</option>
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
                      </NativeSelect>
                    </td>
                    <td>
                      <Input
                        size="sm"
                        type="number"
                        min={1}
                        value={draft.position}
                        aria-label={`Priorité ${ruleLabel}`}
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
                          className="accent-primary"
                          checked={draft.is_active}
                          aria-label={`Règle ${rule.name} active`}
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
                        <span aria-hidden="true">{draft.is_active ? "Actif" : "Inactif"}</span>
                      </label>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
