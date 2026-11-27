"use client";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  useEstimateEditorActions,
  useEstimateEditorContext,
  useEstimateEditorMeta,
} from "@/components/estimates/context/EstimateEditorContext";
import {
  formatMajorationCoefficient,
  MAJORATION_PERCENT_ERROR,
  readMajorationPercent,
} from "@/lib/estimates/majoration";
import { NUMERIC_INPUT_ERROR } from "@/lib/numeric-input/parsers";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

export type EstimateCategory = Database["public"]["Tables"]["estimate_categories"]["Row"];
export type LaborRole = Database["public"]["Tables"]["labor_roles"]["Row"];

export type BulkMoveDestination = {
  id: string | null;
  label: string;
};

type EstimateBulkSelectionBarProps = {
  bulkMoveDestinations: BulkMoveDestination[];
  categories: EstimateCategory[];
  laborRoles: LaborRole[];
  onApplyBulkMove: () => Promise<void>;
  onApplyBulkMajoration: () => Promise<void>;
  onApplyBulkCategory: () => Promise<void>;
  onApplyBulkLaborRole: () => Promise<void>;
  onBulkDeleteSelection: () => Promise<void>;
};

const ROOT_KEY = "root";

export function EstimateBulkSelectionBar({
  bulkMoveDestinations,
  categories,
  laborRoles,
  onApplyBulkMove,
  onApplyBulkMajoration,
  onApplyBulkCategory,
  onApplyBulkLaborRole,
  onBulkDeleteSelection,
}: EstimateBulkSelectionBarProps) {
  const state = useEstimateEditorContext().state;
  const actions = useEstimateEditorActions();
  const meta = useEstimateEditorMeta();
  // P-11 : le coefficient résultant est montré avant « Appliquer » ; vide ou invalide n'applique rien.
  const bulkMajoration = readMajorationPercent(state.bulkMajorationPercent);

  if (!state.hasSelectedLines) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-xl border border-info-border bg-info-subtle px-3 py-2"
      role="group"
      data-testid="estimate-editor-bulk-selection-bar"
      aria-label="Actions sur les lignes sélectionnées"
    >
      <Badge variant="info">
        {state.selectedLineCount} ligne
        {state.selectedLineCount > 1 ? "s" : ""} sélectionnée
        {state.selectedLineCount > 1 ? "s" : ""}
      </Badge>

      <label className="sr-only" htmlFor="estimate-bulk-move-target">
        Déplacer les lignes sélectionnées vers
      </label>
      <NativeSelect
        id="estimate-bulk-move-target"
        size="sm"
        wrapperClassName="w-auto min-w-[170px]"
        value={state.bulkMoveParentId}
        onChange={(event) =>
          actions.setBulkMoveParentId(event.target.value)
        }
        disabled={meta.isReadOnly}
        title="Choisir le lot ou chapitre de destination."
      >
        {bulkMoveDestinations.map((destination) => (
          <option
            key={destination.id ?? ROOT_KEY}
            value={destination.id ?? ""}
          >
            {destination.label}
          </option>
        ))}
      </NativeSelect>
      <Button
        type="button"
        variant="outline"
        size="md"
        onClick={() => void onApplyBulkMove()}
        disabled={meta.isReadOnly}
        title="Déplacer toutes les lignes sélectionnées vers la destination choisie."
        data-testid="estimate-editor-bulk-move-apply-button"
      >
        Déplacer
      </Button>

      <details className="relative">
        <summary
          className={cn(
            buttonVariants({ variant: "outline", size: "md" }),
            "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
          )}
          title="Modifier la majoration, la catégorie ou le rôle de main-d’œuvre."
        >
          Modifier les attributs
        </summary>
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(360px,calc(100vw-32px))] space-y-3 rounded-xl border border-border bg-surface p-3 shadow-dropdown">
          <div>
            <label
              className="text-xs font-medium text-foreground-secondary"
              htmlFor="estimate-bulk-majoration"
            >
              Majoration MO (%)
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                id="estimate-bulk-majoration"
                size="sm"
                className="min-w-0 flex-1"
                type="text"
                inputMode="decimal"
                placeholder="100"
                value={state.bulkMajorationPercent}
                onChange={(event) =>
                  actions.setBulkMajorationPercent(event.target.value)
                }
                disabled={meta.isReadOnly}
                aria-label="Majoration MO en pourcentage"
                aria-invalid={bulkMajoration.status === "invalid" || undefined}
                aria-describedby="estimate-bulk-majoration-coefficient"
              />
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => void onApplyBulkMajoration()}
                disabled={meta.isReadOnly || bulkMajoration.status !== "valid"}
                aria-label="Appliquer majoration"
                data-testid="estimate-editor-bulk-majoration-apply-button"
              >
                Appliquer
              </Button>
            </div>
            <p
              id="estimate-bulk-majoration-coefficient"
              className={cn(
                "mt-1 text-xs",
                bulkMajoration.status === "invalid" ? "text-danger" : "text-muted-foreground",
              )}
              aria-live="polite"
              data-testid="estimate-editor-bulk-majoration-coefficient"
            >
              {bulkMajoration.status === "valid"
                ? `Coefficient appliqué aux heures : ${formatMajorationCoefficient(bulkMajoration.coefficient)} (100 % = ×1, neutre)`
                : bulkMajoration.status === "empty"
                  ? "Saisissez un pourcentage : 100 = neutre."
                  : bulkMajoration.error === "number"
                    ? NUMERIC_INPUT_ERROR
                    : MAJORATION_PERCENT_ERROR}
            </p>
          </div>
          <div>
            <label
              className="text-xs font-medium text-foreground-secondary"
              htmlFor="estimate-bulk-category"
            >
              Catégorie
            </label>
            <div className="mt-1 flex gap-2">
              <NativeSelect
                id="estimate-bulk-category"
                size="sm"
                wrapperClassName="min-w-0 flex-1"
                value={state.bulkCategoryId}
                onChange={(event) =>
                  actions.setBulkCategoryId(event.target.value)
                }
                disabled={meta.isReadOnly}
              >
                <option value="">Aucune</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => void onApplyBulkCategory()}
                disabled={meta.isReadOnly}
                aria-label="Appliquer la catégorie"
                data-testid="estimate-editor-bulk-category-apply-button"
              >
                Appliquer
              </Button>
            </div>
          </div>
          <div>
            <label
              className="text-xs font-medium text-foreground-secondary"
              htmlFor="estimate-bulk-labor-role"
            >
              Rôle de main-d’œuvre
            </label>
            <div className="mt-1 flex gap-2">
              <NativeSelect
                id="estimate-bulk-labor-role"
                size="sm"
                wrapperClassName="min-w-0 flex-1"
                value={state.bulkLaborRoleId}
                onChange={(event) =>
                  actions.setBulkLaborRoleId(event.target.value)
                }
                disabled={meta.isReadOnly}
              >
                <option value="">Aucun</option>
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
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={() => void onApplyBulkLaborRole()}
                disabled={meta.isReadOnly}
                aria-label="Appliquer le rôle de main-d’œuvre"
                data-testid="estimate-editor-bulk-labor-role-apply-button"
              >
                Appliquer
              </Button>
            </div>
          </div>
        </div>
      </details>

      <div className="min-w-0 flex-1" />
      <Button
        type="button"
        variant="ghost"
        size="md"
        onClick={actions.clearLineSelection}
        disabled={meta.isReadOnly}
        title="Retirer la sélection sans modifier les lignes."
      >
        Désélectionner
      </Button>
      <Button
        type="button"
        variant="danger"
        size="md"
        onClick={() => void onBulkDeleteSelection()}
        disabled={meta.isReadOnly}
        title="Supprimer définitivement les lignes sélectionnées."
        data-testid="estimate-editor-bulk-delete-selection-button"
      >
        Supprimer
      </Button>
    </div>
  );
}
