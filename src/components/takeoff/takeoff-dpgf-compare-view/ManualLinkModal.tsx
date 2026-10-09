"use client";

import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  TakeoffDpgfComparisonRow,
  TakeoffDpgfComparisonUnusedTakeoffItem,
} from "@/lib/takeoff/types";

import { buildManualLinkCandidates } from "@/components/takeoff/takeoff-dpgf-compare-view/manualLinkCandidates";
import {
  formatNumber,
  formatProofConfidence,
} from "@/components/takeoff/takeoff-dpgf-compare-view/utils";
import { Textarea } from "@/components/ui/textarea";

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

  const modeClass = (active: boolean) =>
    cn(
      "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "bg-surface text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground-secondary"
    );

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
    >
      <DialogContent size="xl" className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Lier manuellement des éléments de métré</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="rounded-xl border border-border bg-surface-subtle p-4">
            <p className="text-xs tracking-[0.14em] text-muted-foreground uppercase">
              Ligne DPGF
            </p>
            <p className="mt-1 text-sm font-semibold text-foreground">
              {row?.line_label ?? "Ligne inconnue"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Quantité DPGF : {formatNumber(row?.dpgf_quantity ?? null)} {row?.dpgf.unit ?? ""}
            </p>
          </div>

          <div className="flex gap-1 rounded-xl bg-muted p-1">
            <button
              type="button"
              aria-pressed={mode === "takeoff_items"}
              className={modeClass(mode === "takeoff_items")}
              onClick={() => setMode("takeoff_items")}
            >
              Éléments de métré
            </button>
            <button
              type="button"
              aria-pressed={mode === "hypothesis"}
              className={modeClass(mode === "hypothesis")}
              onClick={() => setMode("hypothesis")}
            >
              Hypothèse manuelle
            </button>
          </div>

          {mode === "takeoff_items" ? (
            <div
              role="group"
              aria-label="Éléments de métré à lier"
              className="max-h-[420px] space-y-3 overflow-y-auto pr-1"
            >
              {candidates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border bg-surface-subtle p-6 text-sm text-muted-foreground">
                  Aucun élément de métré disponible pour un lien manuel.
                </div>
              ) : (
                candidates.map((candidate) => {
                  const checked = selectedIds.includes(candidate.item_id);

                  return (
                    <label
                      key={candidate.item_id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition has-focus-visible:ring-2 has-focus-visible:ring-ring",
                        checked
                          ? "border-info-border bg-info-subtle"
                          : "border-border bg-surface hover:bg-surface-subtle"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-primary"
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
                          <p className="text-sm font-medium text-foreground">
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
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatNumber(candidate.quantity)} {candidate.unit} ·{" "}
                          {candidate.source_file_name ?? "Source inconnue"}
                          {candidate.source_page ? ` · p. ${candidate.source_page}` : ""}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatProofConfidence(candidate.confidence_score)}
                        </p>
                        {candidate.evidence ? (
                          <p className="mt-2 text-xs text-muted-foreground">
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
              <p id="manual-link-hypothesis-hint" className="text-sm text-muted-foreground">
                Décrivez votre hypothèse de quantité ou de périmètre pour cette ligne. Elle sera
                enregistrée comme décision « corriger manuellement » et apparaîtra dans le panneau
                de preuves sous forme d’hypothèse après rafraîchissement.
              </p>
              <Textarea
                aria-label="Hypothèse manuelle"
                aria-describedby="manual-link-hypothesis-hint manual-link-hypothesis-count"
                autoComplete="off"
                className="min-h-[160px] py-3"
                value={hypothesisText}
                placeholder="Ex : La quantité DPGF semble inclure les réserves techniques non visibles sur les plans. Je retiens 120 m² en attendant confirmation du maître d'œuvre…"
                onChange={(event) => setHypothesisText(event.target.value)}
                maxLength={2000}
              />
              <p id="manual-link-hypothesis-count" className="text-xs text-muted-foreground">
                {hypothesisText.length} / 2 000 caractères
              </p>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />} disabled={saving}>
            Annuler
          </DialogClose>
          {mode === "takeoff_items" ? (
            <>
              <Button
                variant="secondary"
                onClick={() => void onSave([])}
                disabled={saving || !row}
              >
                Retirer le lien manuel
              </Button>
              <Button
                loading={saving}
                disabled={!row}
                onClick={() => void onSave(selectedIds)}
              >
                Enregistrer la sélection
              </Button>
            </>
          ) : (
            <Button
              loading={saving}
              disabled={!row || hypothesisText.trim().length === 0}
              onClick={() => void onSaveHypothesis(hypothesisText.trim())}
            >
              Enregistrer l’hypothèse
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
