"use client";

import { NumberInput } from "@/components/ui-legacy/NumberInput";
import type {
  TakeoffMappingOverride,
  TakeoffPreviewConversionResponse,
} from "@/lib/takeoff/client";
import type { TakeoffJobItem } from "@/lib/takeoff/types";

import {
  AUTO_OVERRIDE_VALUE,
  OVERRIDE_ACTION_OPTIONS,
  summarizeAction,
} from "./shared";

type PreviewItem = TakeoffPreviewConversionResponse["items"][number];

export function TakeoffApplyPreviewTable({
  items,
  overridesByItemId,
  sourceByItemId,
  isSubmitting,
  onOverrideActionChange,
  onOverrideParamChange,
}: {
  items: PreviewItem[];
  overridesByItemId: Record<string, TakeoffMappingOverride>;
  sourceByItemId: Map<string, TakeoffJobItem>;
  isSubmitting: boolean;
  onOverrideActionChange: (item: PreviewItem, value: string) => void;
  onOverrideParamChange: (itemId: string, nextOverride: TakeoffMappingOverride) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground sm:hidden">
        Faites glisser le tableau horizontalement pour vérifier chaque paramètre.
      </p>
      <div
        aria-label="Preview détaillée des lignes à appliquer"
        className="max-h-[380px] overflow-auto rounded-xl border border-border"
        role="region"
        tabIndex={0}
      >
      <table className="min-w-[760px] text-sm">
        <thead className="bg-surface-subtle text-left text-xs uppercase tracking-wide text-slate-600">
          <tr>
            <th className="px-3 py-2">Item</th>
            <th className="px-3 py-2">Impact</th>
            <th className="px-3 py-2">Provenance</th>
            <th className="px-3 py-2">Override</th>
            <th className="px-3 py-2">Paramètre</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const override = overridesByItemId[item.item_id];
            const selectedAction = override?.action ?? AUTO_OVERRIDE_VALUE;
            const source = sourceByItemId.get(item.item_id);

            return (
              <tr key={item.item_id} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <p className="font-medium text-slate-800">{item.original.designation}</p>
                  <p className="text-xs text-muted-foreground">
                    Après: {item.transformed.designation}
                  </p>
                </td>
                <td className="px-3 py-2 text-xs text-foreground-secondary">
                  <p className="font-medium text-slate-800">
                    {summarizeAction(item)}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {item.transformed.quantity} {item.transformed.unit}
                  </p>
                </td>
                <td className="px-3 py-2 text-xs text-foreground-secondary">
                  {source ? (
                    <>
                      <p className="font-medium text-slate-800">
                        {source.source_file_name ?? "Source takeoff"}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        {source.source_page !== null
                          ? `page ${source.source_page}`
                          : "page non renseignee"}
                      </p>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      Provenance non remontee
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <select
                    className="form-input form-select w-full"
                    value={selectedAction}
                    onChange={(event) => onOverrideActionChange(item, event.target.value)}
                    disabled={isSubmitting}
                  >
                    <option value={AUTO_OVERRIDE_VALUE}>Règle auto</option>
                    {OVERRIDE_ACTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  {override?.action === "rename" && (
                    <input
                      className="form-input w-full"
                      value={override.action_params.designation}
                      onChange={(event) =>
                        onOverrideParamChange(item.item_id, {
                          ...override,
                          action_params: {
                            designation: event.target.value,
                          },
                        })
                      }
                    />
                  )}
                  {override?.action === "set_price" && (
                    <NumberInput
                      min={0}
                      className="form-input w-full"
                      value={override.action_params.unit_price_cents}
                      parseValue={(value) => {
                        const parsedValue = Number.parseInt(value, 10);
                        if (!Number.isFinite(parsedValue)) {
                          return null;
                        }
                        return Math.max(parsedValue, 0);
                      }}
                      emptyValue={0}
                      onValueChange={(unit_price_cents) =>
                        onOverrideParamChange(item.item_id, {
                          ...override,
                          action_params: {
                            unit_price_cents,
                          },
                        })
                      }
                    />
                  )}
                  {override?.action === "set_category" && (
                    <input
                      className="form-input w-full"
                      placeholder="UUID category"
                      value={override.action_params.category_id}
                      onChange={(event) =>
                        onOverrideParamChange(item.item_id, {
                          ...override,
                          action_params: {
                            category_id: event.target.value,
                          },
                        })
                      }
                    />
                  )}
                  {override?.action === "apply_assembly" && (
                    <input
                      className="form-input w-full"
                      placeholder="UUID assembly"
                      value={override.action_params.assembly_id}
                      onChange={(event) =>
                        onOverrideParamChange(item.item_id, {
                          ...override,
                          action_params: {
                            assembly_id: event.target.value,
                          },
                        })
                      }
                    />
                  )}
                  {(override?.action === "skip" || override?.action === "none") && (
                    <span className="text-xs text-muted-foreground">Aucun paramètre</span>
                  )}
                  {!override && (
                    <span className="text-xs text-muted-foreground">
                      Utiliser la règle proposee
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}
