"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui-legacy/Badge";
import { Button } from "@/components/ui-legacy/Button";
import { Modal } from "@/components/ui-legacy/Modal";
import type {
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonUnusedTakeoffItem,
} from "@/lib/takeoff/types";

import { buildManualLinkCandidates } from "@/components/takeoff/takeoff-dpgf-compare-view/manualLinkCandidates";
import {
  formatNumber,
  formatProofConfidence,
} from "@/components/takeoff/takeoff-dpgf-compare-view/utils";

type ManualLinkModalProps = {
  open: boolean;
  row: TakeoffDpgfComparisonRow | null;
  rows: TakeoffDpgfComparisonRow[];
  manualLinkCandidates: TakeoffDpgfComparisonUnusedTakeoffItem[];
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (takeoffItemIds: string[]) => Promise<void>;
  onSaveHypothesis: (hypothesisText: string) => Promise<void>;
};

export function ManualLinkModal({
  open,
  row,
  rows,
  manualLinkCandidates,
  saving,
  onOpenChange,
  onSave,
  onSaveHypothesis,
}: Readonly<ManualLinkModalProps>) {
  const [selectedIds, setSelectedIds] = useState<string[]>(
    () => row?.linked_takeoff_items.map((item) => item.item_id) ?? []
  );
  const [mode, setMode] = useState<"takeoff_items" | "hypothesis">("takeoff_items");
  const [hypothesisText, setHypothesisText] = useState("");

  const candidates = useMemo(() => {
    return buildManualLinkCandidates({
      row,
      rows,
      manualLinkCandidates,
    });
  }, [manualLinkCandidates, row, rows]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content className="max-w-3xl">
        <Modal.Header>
          <Modal.Title>Lier manuellement des items takeoff</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--slate-50)] p-4">
            <p className="text-xs uppercase tracking-[0.14em] text-[var(--slate-500)]">
              Ligne DPGF
            </p>
            <p className="mt-1 text-sm font-semibold text-[var(--slate-900)]">
              {row?.line_label ?? "Ligne inconnue"}
            </p>
            <p className="mt-1 text-sm text-[var(--slate-600)]">
              Quantité DPGF : {formatNumber(row?.dpgf_quantity ?? null)} {row?.dpgf.unit ?? ""}
            </p>
          </div>

          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mode === "takeoff_items"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              onClick={() => setMode("takeoff_items")}
            >
              Items takeoff
            </button>
            <button
              type="button"
              className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                mode === "hypothesis"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
              onClick={() => setMode("hypothesis")}
            >
              Hypothèse manuelle
            </button>
          </div>

          {mode === "takeoff_items" ? (
            <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
              {candidates.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--slate-50)] p-6 text-sm text-[var(--slate-600)]">
                  Aucun item takeoff disponible pour un lien manuel.
                </div>
              ) : (
                candidates.map((candidate) => {
                  const checked = selectedIds.includes(candidate.item_id);

                  return (
                    <label
                      key={candidate.item_id}
                      className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                        checked
                          ? "border-sky-300 bg-sky-50/80"
                          : "border-[var(--border)] bg-white hover:bg-[var(--slate-50)]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={() => {
                          setSelectedIds((current) =>
                            checked
                              ? current.filter((itemId) => itemId !== candidate.item_id)
                              : [...current, candidate.item_id]
                          );
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium text-[var(--slate-900)]">
                            {candidate.designation}
                          </p>
                          {candidate.is_current ? (
                            <Badge variant="info" size="sm">
                              Actuellement relié
                            </Badge>
                          ) : null}
                          {candidate.linked_line_label ? (
                            <Badge variant="warning" size="sm">
                              Relié à {candidate.linked_line_label}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--slate-600)]">
                          {formatNumber(candidate.quantity)} {candidate.unit} ·{" "}
                          {candidate.source_file_name ?? "Source inconnue"}
                          {candidate.source_page ? ` · p.${candidate.source_page}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-[var(--slate-500)]">
                          {formatProofConfidence(candidate.confidence_score)}
                        </p>
                        {candidate.evidence ? (
                          <p className="mt-2 text-xs text-[var(--slate-600)]">
                            {candidate.evidence}
                          </p>
                        ) : null}
                      </div>
                    </label>
                  );
                })
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-[var(--slate-600)]">
                Décrivez votre hypothèse de quantité ou de périmètre pour cette ligne. Elle sera
                enregistrée comme décision « corriger manuellement » et apparaîtra dans le panneau
                de preuves sous forme d&apos;hypothèse après rafraîchissement.
              </p>
              <textarea
                autoComplete="off"
                className="form-input min-h-[160px] py-3"
                value={hypothesisText}
                placeholder="Ex : La quantité DPGF semble inclure les réserves techniques non visibles sur les plans. Je retiens 120 m² en attendant confirmation du maître d'œuvre…"
                onChange={(event) => setHypothesisText(event.target.value)}
                maxLength={2000}
              />
              <p className="text-xs text-[var(--slate-500)]">
                {hypothesisText.length} / 2 000 caractères
              </p>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          {mode === "takeoff_items" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void onSave([])}
                disabled={saving || !row}
              >
                Retirer le lien manuel
              </Button>
              <Button
                size="sm"
                loading={saving}
                disabled={!row}
                onClick={() => void onSave(selectedIds)}
              >
                Enregistrer la sélection
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              loading={saving}
              disabled={!row || hypothesisText.trim().length === 0}
              onClick={() => void onSaveHypothesis(hypothesisText.trim())}
            >
              Enregistrer l&apos;hypothèse
            </Button>
          )}
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
