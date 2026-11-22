"use client";

import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { AlertTriangleIcon, PlusIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  PRODUCT_PACKAGING_DUPLICATE,
  PRODUCT_PACKAGING_LABEL_MAX,
  PRODUCT_PACKAGING_UNIT_REQUIRED_MESSAGE,
  PRODUCT_PACKAGING_LABEL_SUGGESTIONS,
  PRODUCT_PACKAGING_QUANTITY_MAX,
  describePackaging,
  normalizePackagingLabel,
  packagingKey,
  packagingUnitLabel,
  type ProductPackaging,
  type ProductPackagings as ProductPackagingList,
} from "@/lib/catalogue/packagings";
import {
  createProductPackaging,
  deleteProductPackaging,
  fetchProductPackagings,
  updateProductPackaging,
} from "@/lib/catalogue/packagings-client";
import { catalogueErrorMessage } from "@/lib/catalogue/supplier-items-client";
import { formatDecimalInput, parseQuantity } from "@/lib/numeric-input/parsers";

import { useSerialSave } from "./useSerialSave";

type PackagingsState =
  | { productId: string; status: "ready"; list: ProductPackagingList }
  | { productId: string; status: "error" };

type RowDraft = { label: string; quantity: string };
type AddDraft = RowDraft & { isUsual: boolean };

/** The notice that says why nothing can be added: the form's unit field refers to it (aria-describedby). */
export const PRODUCT_PACKAGINGS_UNIT_NOTICE_ID = "product-packagings-unit-notice";

const EMPTY_ADD_DRAFT: AddDraft = { label: "", quantity: "", isUsual: false };
const QUANTITY_REFUSAL = "La quantité doit être un nombre supérieur à zéro, avec trois décimales au plus.";

/** Enter saves the row it is typed in; it must never submit the article form around it. */
function onEnter(action: () => void) {
  return (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    action();
  };
}

/** The label and quantity as the server will hold them, or the sentence that says why not. */
function readPackaging(
  draft: RowDraft,
  others: readonly ProductPackaging[],
): { label: string; quantity: number } | { refusal: string } {
  const label = normalizePackagingLabel(draft.label);
  if (!label) return { refusal: "Renseignez le conditionnement (par exemple « Barre »)." };
  if (label.length > PRODUCT_PACKAGING_LABEL_MAX) {
    return { refusal: `${PRODUCT_PACKAGING_LABEL_MAX} caractères au plus pour le conditionnement.` };
  }
  const quantity = parseQuantity(draft.quantity);
  if (quantity === null || quantity <= 0 || quantity > PRODUCT_PACKAGING_QUANTITY_MAX) return { refusal: QUANTITY_REFUSAL };
  const key = packagingKey(label, quantity);
  if (others.some((other) => packagingKey(other.label, other.quantity) === key)) return { refusal: PRODUCT_PACKAGING_DUPLICATE };
  return { label, quantity };
}

function QuantityInput({
  id,
  unitLabel,
  ariaLabel,
  value,
  describedBy,
  onChange,
  onSubmit,
}: Readonly<{
  id: string;
  unitLabel: string;
  ariaLabel: string;
  value: string;
  describedBy?: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}>) {
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        placeholder="Ex. 6"
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        className={unitLabel ? "pr-12" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onEnter(onSubmit)}
      />
      {unitLabel ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-subtle-foreground"
        >
          {unitLabel}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The sale packagings of an article (« conditionnements de vente »): how it is sold, a label and a quantity in the
 * article's unit (a bar of 6 m for an article in ml), one of them usual. Informative only. Like its suppliers, each
 * change is saved at once; the server decides who may make it (`can_edit` tells the screen beforehand).
 * Each packaging carries the unit it was added in, the article's: the server refuses to change the unit of an
 * article that has packagings, and gives none to an article without a unit. `unit` is the unit chosen in the form,
 * `savedUnit` the one stored: while they differ the section says what to do and adds nothing, since a packaging
 * takes the stored unit.
 */
export function ProductPackagings({
  productId,
  unit,
  savedUnit,
}: Readonly<{
  productId: string;
  unit: string;
  savedUnit: string | null;
}>) {
  const ids = useId();
  const [state, setState] = useState<PackagingsState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState<AddDraft>(EMPTY_ADD_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  /** The last usual choice, while its save is on its way: shown until its answer. */
  const [pendingUsual, setPendingUsual] = useState<{ id: string; value: boolean } | null>(null);
  const saveUsual = useSerialSave();

  useEffect(() => {
    const abort = new AbortController();
    fetchProductPackagings(productId, abort.signal)
      .then((list) => {
        if (!abort.signal.aborted) setState({ productId, status: "ready", list });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ productId, status: "error" });
      });
    return () => abort.abort();
  }, [productId]);

  const current = state?.productId === productId ? state : null;
  const items = current?.status === "ready" ? current.list.items : [];
  const canEdit = current?.status === "ready" && current.list.can_edit;
  const storedUnit = (savedUnit ?? "").trim();
  const unitLabel = packagingUnitLabel(storedUnit);
  const unitChanged = storedUnit !== unit.trim();
  /** Why nothing can be added now, if anything prevents it. */
  const addBlocker = !storedUnit
    ? PRODUCT_PACKAGING_UNIT_REQUIRED_MESSAGE
    : unitChanged && items.length > 0
      ? `Retirez les conditionnements de vente avant de changer l’unité de l’article : leurs quantités sont exprimées en ${unitLabel}.`
      : unitChanged
        ? "Enregistrez d’abord la nouvelle unité de l’article pour lui ajouter des conditionnements de vente."
        : null;

  /** What the server holds now replaces the list; the rows it no longer has lose their unsaved text. */
  const apply = (list: ProductPackagingList, settledId?: string) => {
    setState({ productId, status: "ready", list });
    setDrafts((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([id]) => id !== settledId && list.items.some((item) => item.id === id)),
      ),
    );
  };

  const start = (key: string) => {
    setBusy(key);
    setError(null);
    setSaved(null);
  };

  const rowDraft = (item: ProductPackaging): RowDraft =>
    drafts[item.id] ?? { label: item.label, quantity: formatDecimalInput(item.quantity) };

  const isDirty = (item: ProductPackaging) => {
    const draft = drafts[item.id];
    if (!draft) return false;
    return normalizePackagingLabel(draft.label) !== item.label || parseQuantity(draft.quantity) !== item.quantity;
  };

  const saveRow = async (item: ProductPackaging) => {
    if (busy || pendingUsual || !isDirty(item)) return;
    const read = readPackaging(rowDraft(item), items.filter((other) => other.id !== item.id));
    if ("refusal" in read) {
      setSaved(null);
      setError(read.refusal);
      return;
    }
    start(item.id);
    try {
      apply(await updateProductPackaging(productId, item.id, { label: read.label, quantity: read.quantity }), item.id);
      setSaved("Conditionnement enregistré.");
    } catch (failure) {
      setError(catalogueErrorMessage(failure, "Le conditionnement n’a pas pu être enregistré."));
    } finally {
      setBusy(null);
    }
  };

  // Not disabled while its own saves are on their way: they leave one after another, and the last answer speaks.
  // The other writes (add, change, remove) wait for them, and they wait for the other writes, so an answer never
  // describes a list older than the one on screen. Only the marks are taken from the answer, as a second guard.
  const chooseUsual = async (item: ProductPackaging, value: boolean) => {
    if (busy) return;
    setPendingUsual({ id: item.id, value });
    setError(null);
    setSaved(null);
    const outcome = await saveUsual(() => updateProductPackaging(productId, item.id, { is_usual: value }));
    if (outcome.ok) {
      const marks = new Map(outcome.value.items.map((answered) => [answered.id, answered.is_usual]));
      setState((previous) =>
        previous?.status === "ready" && previous.productId === productId
          ? {
              ...previous,
              list: {
                ...previous.list,
                items: previous.list.items.map((shown) => ({ ...shown, is_usual: marks.get(shown.id) ?? shown.is_usual })),
              },
            }
          : previous,
      );
    }
    if (!outcome.latest) return;
    setPendingUsual(null);
    if (outcome.ok) setSaved(value ? "Conditionnement usuel enregistré." : "Plus aucun conditionnement usuel.");
    else setError(catalogueErrorMessage(outcome.error, "Le conditionnement usuel n’a pas pu être enregistré."));
  };

  const remove = async (item: ProductPackaging) => {
    if (busy || pendingUsual) return;
    start(`remove-${item.id}`);
    try {
      apply(await deleteProductPackaging(productId, item.id), item.id);
      setSaved("Conditionnement retiré.");
    } catch (failure) {
      setError(catalogueErrorMessage(failure, "Le conditionnement n’a pas pu être retiré."));
    } finally {
      setBusy(null);
    }
  };

  const add = async () => {
    if (busy || pendingUsual) return;
    const read = readPackaging(addDraft, items);
    if ("refusal" in read) {
      setSaved(null);
      setError(read.refusal);
      return;
    }
    start("add");
    try {
      apply(await createProductPackaging(productId, { label: read.label, quantity: read.quantity, is_usual: addDraft.isUsual }));
      setAddDraft(EMPTY_ADD_DRAFT);
      setAdding(false);
      setSaved("Conditionnement ajouté.");
    } catch (failure) {
      setError(catalogueErrorMessage(failure, "Le conditionnement n’a pas pu être ajouté."));
    } finally {
      setBusy(null);
    }
  };

  const isUsualShown = (item: ProductPackaging) => {
    if (!pendingUsual) return item.is_usual;
    if (pendingUsual.id === item.id) return pendingUsual.value;
    return pendingUsual.value ? false : item.is_usual;
  };

  const headingId = `${ids}-heading`;
  const hintId = `${ids}-hint`;
  /** A write is on its way: the others wait. */
  const writing = busy !== null || pendingUsual !== null;
  const suggestionsId = `${ids}-suggestions`;
  const unitInWords = unitLabel ? `en ${unitLabel}` : "dans l’unité de l’article";

  return (
    <section aria-labelledby={headingId} className="border-t border-border pt-4">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        Conditionnements de vente
      </h3>
      <p id={hintId} className="mt-1 text-xs text-muted-foreground">
        Quantité d’unités de l’article dans un conditionnement, {unitInWords} : « Barre » et 6 pour une barre de
        6 mètres d’un article au mètre linéaire.{canEdit ? " Chaque changement est enregistré aussitôt." : ""}
      </p>
      {/* Always rendered once the list is read, so that the notice is announced when it appears. */}
      {canEdit ? (
        <div role="status" aria-live="polite">
          {addBlocker ? (
            <p id={PRODUCT_PACKAGINGS_UNIT_NOTICE_ID} className="mt-2 flex items-start gap-1.5 text-xs font-medium text-warning">
              <AlertTriangleIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>{addBlocker}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {current === null ? <p className="mt-2 text-sm text-muted-foreground">Chargement…</p> : null}
      {current?.status === "error" ? (
        <p className="mt-2 text-sm text-danger">Les conditionnements n’ont pas pu être chargés.</p>
      ) : null}
      {current?.status === "ready" && items.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Aucun conditionnement renseigné.</p>
      ) : null}

      {current?.status === "ready" && items.length > 0 && !canEdit ? (
        <ul aria-label="Conditionnements de l’article" className="mt-2 flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-3 py-0.5 text-sm text-foreground"
            >
              <span className="min-w-0 break-words">{describePackaging(item, item.unit)}</span>
              {item.is_usual ? (
                <Badge variant="info" size="sm">
                  usuel
                </Badge>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {current?.status === "ready" && items.length > 0 && canEdit ? (
        <ul aria-label="Conditionnements de l’article" className="mt-2 divide-y divide-border rounded-lg border border-border">
          {items.map((item) => {
            const draft = rowDraft(item);
            const dirty = isDirty(item);
            const rowPrefix = `${ids}-row-${item.id}`;
            const rowUnit = packagingUnitLabel(item.unit);
            // What tells this row's controls from the others' for a screen reader: the packaging as stored.
            const named = describePackaging(item, item.unit);
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 basis-40">
                  <Input
                    id={`${rowPrefix}-label`}
                    list={suggestionsId}
                    autoComplete="off"
                    maxLength={PRODUCT_PACKAGING_LABEL_MAX}
                    aria-label={`Conditionnement : ${named}`}
                    value={draft.label}
                    onChange={(event) => setDrafts((previous) => ({ ...previous, [item.id]: { ...draft, label: event.target.value } }))}
                    onKeyDown={onEnter(() => void saveRow(item))}
                  />
                </div>
                <div className="w-32 shrink-0">
                  <QuantityInput
                    id={`${rowPrefix}-quantity`}
                    unitLabel={rowUnit}
                    ariaLabel={`${rowUnit ? `Quantité en ${rowUnit}` : "Quantité"} : ${named}`}
                    describedBy={hintId}
                    value={draft.quantity}
                    onChange={(quantity) => setDrafts((previous) => ({ ...previous, [item.id]: { ...draft, quantity } }))}
                    onSubmit={() => void saveRow(item)}
                  />
                </div>
                <label className="inline-flex min-h-8 shrink-0 items-center gap-1.5 text-sm text-foreground-secondary">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    aria-label={`Usuel : ${named}`}
                    checked={isUsualShown(item)}
                    disabled={busy !== null}
                    onChange={(event) => void chooseUsual(item, event.target.checked)}
                  />
                  Usuel
                </label>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  {dirty ? (
                    <Button
                      type="button"
                      size="sm"
                      loading={busy === item.id}
                      disabled={pendingUsual !== null || (busy !== null && busy !== item.id)}
                      aria-label={`Enregistrer : ${named}`}
                      onClick={() => void saveRow(item)}
                    >
                      Enregistrer
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    loading={busy === `remove-${item.id}`}
                    disabled={pendingUsual !== null || (busy !== null && busy !== `remove-${item.id}`)}
                    aria-label={`Retirer le conditionnement ${named}`}
                    onClick={() => void remove(item)}
                  >
                    <XIcon aria-hidden="true" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {canEdit ? (
        <datalist id={suggestionsId}>
          {PRODUCT_PACKAGING_LABEL_SUGGESTIONS.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}

      {canEdit && !addBlocker ? (
        <div className="mt-3">
          {adding ? (
            <div className="space-y-3 rounded-lg border border-border bg-surface-subtle p-3">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel htmlFor={`${ids}-add-label`}>Nouveau conditionnement</FieldLabel>
                  <Input
                    id={`${ids}-add-label`}
                    list={suggestionsId}
                    autoComplete="off"
                    autoFocus
                    maxLength={PRODUCT_PACKAGING_LABEL_MAX}
                    placeholder="Ex. Barre, Touret, Boîte"
                    value={addDraft.label}
                    onChange={(event) => setAddDraft({ ...addDraft, label: event.target.value })}
                    onKeyDown={onEnter(() => void add())}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <FieldLabel htmlFor={`${ids}-add-quantity`}>Quantité</FieldLabel>
                  <QuantityInput
                    id={`${ids}-add-quantity`}
                    unitLabel={unitLabel}
                    ariaLabel={`Quantité du nouveau conditionnement ${unitInWords}`}
                    describedBy={hintId}
                    value={addDraft.quantity}
                    onChange={(quantity) => setAddDraft({ ...addDraft, quantity })}
                    onSubmit={() => void add()}
                  />
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={addDraft.isUsual}
                  onChange={(event) => setAddDraft({ ...addDraft, isUsual: event.target.checked })}
                />
                Conditionnement usuel
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  loading={busy === "add"}
                  disabled={pendingUsual !== null || (busy !== null && busy !== "add")}
                  onClick={() => void add()}
                >
                  Ajouter ce conditionnement
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label="Annuler l’ajout du conditionnement"
                  onClick={() => {
                    setAdding(false);
                    setAddDraft(EMPTY_ADD_DRAFT);
                    setError(null);
                  }}
                >
                  Annuler
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              leftIcon={<PlusIcon aria-hidden="true" />}
              disabled={writing}
              onClick={() => {
                setError(null);
                setSaved(null);
                setAdding(true);
              }}
            >
              Ajouter un conditionnement
            </Button>
          )}
          {items.length > 1 ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Un seul conditionnement est usuel : en cocher un autre lui transfère la mention.
            </p>
          ) : null}
        </div>
      ) : null}

      <p role="status" className="mt-2 text-xs text-success empty:hidden">
        {saved ?? ""}
      </p>
      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
