"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  OFFER_EXCLUSION_REASON_CODES,
  OFFER_EXCLUSION_REASON_LABELS,
  OFFER_RESERVE_BASES,
  OFFER_RESERVE_BASIS_LABELS,
  OFFER_RESERVE_TEXT_MAX_LENGTH,
  OFFER_TREATMENT_NOTE_MAX_LENGTH,
  buildOfferReserveSentence,
  normalizeOfferTreatmentText,
  type OfferExclusionReasonCode,
  type OfferReserveBasis,
} from "@/lib/estimates/offer-treatment";
import {
  buildOfferTreatmentDecisions,
  buildOfferTreatmentRows,
  initialOfferReserveBasis,
  initialOfferTreatmentValues,
  type OfferTreatmentDraftItem,
  type OfferTreatmentDraftRow,
  type OfferTreatmentDraftValue,
} from "@/lib/estimates/offer-treatment-draft";
import type { SetOfferTreatmentsInput } from "@/lib/estimates/offer-treatment-plan";

type EstimateOfferTreatmentsDialogProps = {
  isOpen: boolean;
  /** Sections and lines of the estimate as the editor holds them: reread after each save. */
  items: readonly OfferTreatmentDraftItem[];
  /** « Précisions et limites de prestation » of the estimate as the editor holds it. */
  limitsText: string | null;
  isReadOnly: boolean;
  projectId: string | null;
  onClose: () => void;
  /** Saves the changed lines and rereads the estimate; rejects with the message to show. */
  onSave: (decisions: SetOfferTreatmentsInput["decisions"]) => Promise<void>;
};

const EMPTY_VALUE: OfferTreatmentDraftValue = { reasonCode: "", note: "", reserveText: "" };
const sectionTitleClass = "text-sm font-semibold text-foreground";
const rowClass = "rounded-lg border border-border bg-surface-subtle px-3 py-2";
const compactTextareaClass = "min-h-16 px-3 py-2 text-sm";

function RowHeading({ row, children }: Readonly<{ row: OfferTreatmentDraftRow; children?: React.ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium text-foreground">{row.title}</span>
      <Badge variant="outline" size="sm">{row.statusLabel}</Badge>
      {row.hasTakeoffProvision ? <Badge variant="outline" size="sm">Provision métré</Badge> : null}
      {row.sectionTitle ? <span className="text-xs text-muted-foreground">{row.sectionTitle}</span> : null}
      {children}
    </div>
  );
}

/**
 * TI-682 (D12) : « Motifs et réserves » d'un devis du moteur 3. Le motif d'une ligne laissée hors du prix reste
 * interne ; la réserve d'une ligne chiffrée ou non chiffrée est écrite dans « Précisions et limites de prestation »,
 * telle que le client la lira. Rien n'est enregistré avant « Enregistrer » ; seules les lignes changées partent,
 * 500 au plus par enregistrement : au-delà, la fenêtre reste ouverte et enregistre la suite au clic suivant.
 */
export function EstimateOfferTreatmentsDialog({
  isOpen,
  items,
  limitsText,
  isReadOnly,
  projectId,
  onClose,
  onSave,
}: Readonly<EstimateOfferTreatmentsDialogProps>) {
  // The rows follow the estimate, reread after a save; what the estimator typed is kept by line.
  const rows = useMemo(() => buildOfferTreatmentRows(items, limitsText), [items, limitsText]);
  const [values, setValues] = useState(() => initialOfferTreatmentValues(rows));
  const [basis, setBasis] = useState<OfferReserveBasis | "">(() => initialOfferReserveBasis(rows));
  const [addedIds, setAddedIds] = useState<readonly string[]>([]);
  const [bulkReserveText, setBulkReserveText] = useState("");
  const [bulkReason, setBulkReason] = useState<OfferExclusionReasonCode | "">("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const disabled = isReadOnly || isSaving;

  const notPricedRows = useMemo(() => rows.filter((row) => row.group === "not_priced"), [rows]);
  const expectedRows = useMemo(() => rows.filter((row) => row.group === "exclusion" && row.reasonExpected), [rows]);
  const optionalRows = useMemo(() => rows.filter((row) => row.group === "exclusion" && !row.reasonExpected), [rows]);
  const pricedRows = useMemo(
    () => rows.filter((row) => row.group === "priced" && (row.listed || addedIds.includes(row.id))),
    [addedIds, rows]
  );
  const addableRows = useMemo(
    () => rows.filter((row) => row.group === "priced" && !row.listed && !addedIds.includes(row.id)),
    [addedIds, rows]
  );
  const built = useMemo(() => buildOfferTreatmentDecisions({ rows, values, basis }), [basis, rows, values]);
  const changeCount = built.ok ? built.decisions.length : null;
  const remainingCount = built.ok ? built.remaining : 0;
  const unclassifiedCount = notPricedRows
    .filter((row) => normalizeOfferTreatmentText(values[row.id]?.reserveText ?? "") === "").length;
  const missingReasonCount = expectedRows.filter((row) => (values[row.id]?.reasonCode ?? "") === "").length;

  const patch = (id: string, change: Partial<OfferTreatmentDraftValue>) => {
    setError(null);
    setValues((previous) => ({ ...previous, [id]: { ...(previous[id] ?? EMPTY_VALUE), ...change } }));
  };

  const applyBulkReserve = () => {
    const text = normalizeOfferTreatmentText(bulkReserveText);
    if (text === "") return;
    setError(null);
    setValues((previous) => {
      const next = { ...previous };
      for (const row of notPricedRows) {
        if (normalizeOfferTreatmentText(next[row.id]?.reserveText ?? "") === "") {
          next[row.id] = { ...(next[row.id] ?? EMPTY_VALUE), reserveText: text };
        }
      }
      return next;
    });
    setBulkReserveText("");
  };

  const applyBulkReason = () => {
    if (bulkReason === "") return;
    setError(null);
    setValues((previous) => {
      const next = { ...previous };
      for (const row of expectedRows) {
        if ((next[row.id]?.reasonCode ?? "") === "") next[row.id] = { ...(next[row.id] ?? EMPTY_VALUE), reasonCode: bulkReason };
      }
      return next;
    });
  };

  const save = async () => {
    if (!built.ok) {
      setError(built.message);
      return;
    }
    if (built.decisions.length === 0) return;
    setError(null);
    setNotice(null);
    setIsSaving(true);
    try {
      await onSave(built.decisions);
      if (built.remaining === 0) onClose();
      else setNotice(`${built.decisions.length} lignes enregistrées. Il en reste ${built.remaining} : enregistrez de nouveau.`);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : "Impossible d’enregistrer motifs et réserves.");
    } finally {
      setIsSaving(false);
    }
  };

  const renderReserveRow = (row: OfferTreatmentDraftRow) => {
    const text = values[row.id]?.reserveText ?? "";
    const normalized = normalizeOfferTreatmentText(text);
    return (
      <li key={row.id} className={rowClass} data-testid={`offer-treatment-row-${row.id}`}>
        <RowHeading row={row} />
        {row.unreadable ? (
          <p className="mt-1 text-xs text-danger">
            La décision enregistrée sur cette ligne est illisible : elle sera remplacée à l’enregistrement.
          </p>
        ) : null}
        {row.reserveToRewrite ? (
          <p className="mt-1 text-xs text-warning">
            La phrase de cette réserve n’est plus à jour dans le texte de l’offre : elle y sera réécrite à l’enregistrement.
          </p>
        ) : null}
        <Textarea
          className={`mt-2 ${compactTextareaClass}`}
          aria-label={`Réserve dans l’offre : ${row.title}`}
          placeholder={row.group === "not_priced"
            ? "Ex. : non chiffré, à définir après relevé sur site."
            : "Ex. : quantité provisoire, à ajuster sur plans d’exécution."}
          maxLength={OFFER_RESERVE_TEXT_MAX_LENGTH}
          rows={2}
          value={text}
          disabled={disabled}
          onChange={(event) => patch(row.id, { reserveText: event.target.value })}
        />
        {normalized !== "" ? (
          <p className="mt-1 text-xs text-foreground-secondary">
            Dans l’offre : <span className="font-medium">{buildOfferReserveSentence(row.title, normalized)}</span>
          </p>
        ) : row.group === "not_priced" ? (
          <p className="mt-1 text-xs text-warning">
            Sans réserve, cette ligne bloque l’envoi : chiffrez-la ou donnez-lui un autre statut dans la grille.
          </p>
        ) : null}
      </li>
    );
  };

  const renderExclusionRow = (row: OfferTreatmentDraftRow) => {
    const value = values[row.id] ?? EMPTY_VALUE;
    return (
      <li key={row.id} className={rowClass} data-testid={`offer-treatment-row-${row.id}`}>
        <RowHeading row={row} />
        {row.staleReserve ? (
          <p className="mt-1 text-xs text-warning">
            Une réserve écrite avant le changement de statut de cette ligne sera retirée de l’offre à l’enregistrement.
          </p>
        ) : null}
        {row.unreadable ? (
          <p className="mt-1 text-xs text-danger">
            La décision enregistrée sur cette ligne est illisible : elle sera remplacée à l’enregistrement.
          </p>
        ) : null}
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
          <NativeSelect
            size="sm"
            aria-label={`Motif d’exclusion : ${row.title}`}
            value={value.reasonCode}
            disabled={disabled}
            onChange={(event) => patch(row.id, { reasonCode: event.target.value as OfferExclusionReasonCode | "" })}
          >
            <option value="">{row.reasonExpected ? "Motif à choisir" : "Sans motif"}</option>
            {OFFER_EXCLUSION_REASON_CODES.map((code) => (
              <option key={code} value={code}>{OFFER_EXCLUSION_REASON_LABELS[code]}</option>
            ))}
          </NativeSelect>
          <Input
            size="sm"
            aria-label={`Précision du motif : ${row.title}`}
            placeholder={value.reasonCode === "other" ? "Précision obligatoire" : "Précision (facultative)"}
            maxLength={OFFER_TREATMENT_NOTE_MAX_LENGTH}
            value={value.note}
            disabled={disabled || value.reasonCode === ""}
            onChange={(event) => patch(row.id, { note: event.target.value })}
          />
        </div>
      </li>
    );
  };

  return (
    <Dialog
      open={isOpen}
      disablePointerDismissal
      onOpenChange={(open) => {
        if (!open && !isSaving) onClose();
      }}
    >
      <DialogContent size="xl" data-testid="estimate-offer-treatments-dialog">
        <DialogHeader>
          <DialogTitle>Motifs et réserves</DialogTitle>
          <DialogDescription>
            Avant l’envoi, chaque prestation non chiffrée est classée. Le motif d’une exclusion reste interne.
            Une réserve est écrite dans l’offre, sous « Précisions et limites de prestation », telle que le client la lira.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-5">
          {isReadOnly ? (
            <Alert variant="info" hideIcon>
              <AlertDescription>Cette version est en lecture seule : les décisions sont affichées sans pouvoir être modifiées.</AlertDescription>
            </Alert>
          ) : null}

          <section aria-labelledby="offer-treatments-basis-title" className="space-y-2">
            <h3 id="offer-treatments-basis-title" className={sectionTitleClass}>Base des réserves</h3>
            <NativeSelect
              aria-labelledby="offer-treatments-basis-title"
              data-testid="offer-treatments-basis"
              value={basis}
              disabled={disabled}
              onChange={(event) => {
                setError(null);
                setBasis(event.target.value as OfferReserveBasis | "");
              }}
            >
              <option value="">Aucune base choisie</option>
              {OFFER_RESERVE_BASES.map((entry) => (
                <option key={entry} value={entry}>{OFFER_RESERVE_BASIS_LABELS[entry]}</option>
              ))}
            </NativeSelect>
            <p className="text-xs text-foreground-secondary">
              Une réserve ne s’écrit que pour un devis privé, ou si le règlement de consultation déclare les quantités
              indicatives. En marché public sans quantités indicatives, aucune réserve : posez la question à l’acheteur
              ou chiffrez une provision.{" "}
              {projectId ? (
                <Link href={`/dashboard/affaires/${projectId}`} className="text-primary underline underline-offset-2">
                  Ouvrir le registre de l’affaire
                </Link>
              ) : null}
            </p>
          </section>

          <section aria-labelledby="offer-treatments-not-priced-title" className="space-y-2">
            <h3 id="offer-treatments-not-priced-title" className={sectionTitleClass}>
              Lignes non chiffrées ({notPricedRows.length})
            </h3>
            {notPricedRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune ligne « Non chiffrée » dans ce devis.</p>
            ) : (
              <>
                <p className="text-xs text-foreground-secondary">
                  {unclassifiedCount === 0
                    ? "Toutes les lignes non chiffrées portent une réserve."
                    : `${unclassifiedCount} sans réserve : ${unclassifiedCount > 1 ? "elles bloquent" : "elle bloque"} l’envoi.`}
                </p>
                {notPricedRows.length > 1 && !isReadOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      size="sm"
                      className="min-w-0 flex-1"
                      aria-label="Même réserve pour les lignes non chiffrées sans réserve"
                      placeholder="Même réserve pour les lignes sans réserve"
                      maxLength={OFFER_RESERVE_TEXT_MAX_LENGTH}
                      value={bulkReserveText}
                      disabled={disabled}
                      onChange={(event) => setBulkReserveText(event.target.value)}
                    />
                    <Button type="button" variant="outline" size="sm" onClick={applyBulkReserve}
                      disabled={disabled || normalizeOfferTreatmentText(bulkReserveText) === "" || unclassifiedCount === 0}>
                      Appliquer aux lignes sans réserve
                    </Button>
                  </div>
                ) : null}
                <ul className="space-y-2 text-sm">{notPricedRows.map(renderReserveRow)}</ul>
              </>
            )}
          </section>

          <section aria-labelledby="offer-treatments-exclusions-title" className="space-y-2">
            <h3 id="offer-treatments-exclusions-title" className={sectionTitleClass}>
              Hors lot et Sans objet ({expectedRows.length})
            </h3>
            {expectedRows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune ligne « Hors lot » ou « Sans objet » dans ce devis.</p>
            ) : (
              <>
                <p className="text-xs text-foreground-secondary">
                  {missingReasonCount === 0
                    ? "Chaque exclusion porte son motif interne."
                    : `${missingReasonCount} sans motif interne : le contrôle d’envoi ${missingReasonCount > 1 ? "les" : "la"} signale.`}
                </p>
                {expectedRows.length > 1 && !isReadOnly ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <NativeSelect
                      size="sm"
                      wrapperClassName="w-auto min-w-56 flex-1"
                      aria-label="Même motif pour les exclusions sans motif"
                      value={bulkReason}
                      disabled={disabled}
                      onChange={(event) => setBulkReason(event.target.value as OfferExclusionReasonCode | "")}
                    >
                      <option value="">Même motif pour les lignes sans motif</option>
                      {OFFER_EXCLUSION_REASON_CODES.filter((code) => code !== "other").map((code) => (
                        <option key={code} value={code}>{OFFER_EXCLUSION_REASON_LABELS[code]}</option>
                      ))}
                    </NativeSelect>
                    <Button type="button" variant="outline" size="sm" onClick={applyBulkReason}
                      disabled={disabled || bulkReason === "" || missingReasonCount === 0}>
                      Appliquer aux lignes sans motif
                    </Button>
                  </div>
                ) : null}
                <ul className="space-y-2 text-sm">{expectedRows.map(renderExclusionRow)}</ul>
              </>
            )}
            {optionalRows.length > 0 ? (
              <details className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Inclus et Pour mémoire ({optionalRows.length}) : motif facultatif
                </summary>
                <ul className="mt-2 space-y-2 text-sm">{optionalRows.map(renderExclusionRow)}</ul>
              </details>
            ) : null}
          </section>

          <section aria-labelledby="offer-treatments-priced-title" className="space-y-2">
            <h3 id="offer-treatments-priced-title" className={sectionTitleClass}>
              Lignes chiffrées sous réserve ({pricedRows.length})
            </h3>
            <p className="text-xs text-foreground-secondary">
              Pour une quantité provisoire : la ligne reste chiffrée et la réserve dit au client ce qui peut changer.
            </p>
            {pricedRows.length > 0 ? <ul className="space-y-2 text-sm">{pricedRows.map(renderReserveRow)}</ul> : null}
            {addableRows.length > 0 && !isReadOnly ? (
              <NativeSelect
                size="sm"
                aria-label="Ajouter une réserve à une ligne chiffrée"
                value=""
                disabled={disabled}
                onChange={(event) => {
                  const id = event.target.value;
                  if (id) setAddedIds((previous) => [...previous, id]);
                }}
              >
                <option value="">Ajouter une réserve à une ligne chiffrée…</option>
                {addableRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.sectionTitle ? `${row.title} (${row.sectionTitle})` : row.title}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
          </section>

          {notice ? (
            <Alert variant="info" hideIcon role="status" data-testid="offer-treatments-notice">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="danger" role="alert" data-testid="offer-treatments-error">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          {!isReadOnly && changeCount !== null ? (
            <span className="mr-auto text-xs text-muted-foreground" aria-live="polite">
              {changeCount === 0 ? "Aucun changement à enregistrer."
                : remainingCount > 0 ? `${changeCount} lignes à enregistrer maintenant, ${remainingCount} ensuite.`
                : `${changeCount} ligne${changeCount > 1 ? "s" : ""} à enregistrer.`}
            </span>
          ) : null}
          <Button type="button" variant="outline" size="lg" onClick={onClose} disabled={isSaving}>
            {isReadOnly ? "Fermer" : "Annuler"}
          </Button>
          {isReadOnly ? null : (
            <Button type="button" variant="primary" size="lg" onClick={() => void save()}
              disabled={isSaving || changeCount === 0} data-testid="offer-treatments-save">
              {isSaving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
