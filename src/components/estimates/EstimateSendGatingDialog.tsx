"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { Loader2Icon, XIcon } from "lucide-react";

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
import { formatEUR } from "@/lib/money";
import type { EstimateSendGatingFlag } from "@/lib/estimates/client";
import { ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS } from "@/lib/estimates/gating-policy";
import { OFFER_PROVISIONAL_QUANTITY_WARNING, OFFER_RESERVE_WARNING } from "@/lib/estimates/offer-choice";
import { provisionalMentionsOverflowMessage } from "@/lib/estimates/provisional-quantity";
import { buildSendBlockerRegisterHref, formatSendBlockerRegisterAction } from "@/lib/estimates/send-blocker-remedies";
import {
  ESTIMATE_STATUS_REASON_CODE_VALUES,
  ESTIMATE_STATUS_REASON_CODES,
  normalizeStatusReason,
  statusReasonError,
  type EstimateStatusReason,
  type EstimateStatusReasonCode,
} from "@/lib/estimates/status-reason";
import {
  ESTIMATE_READINESS_CATEGORY_LABELS,
  resolveEstimateReadinessCategoryFromGatingFlagKey,
} from "@/lib/estimates/readiness";

/** A line the send window names by its title and status (TI-682 lot C: lines excluded without a reason). */
export type EstimateSendGatingLine = { id: string; title: string; statusLabel: string };

/** A reserved line, by its title and its reserve's basis and reason (TI-682 lot C, PR 4: internal, for the issuer). */
export type EstimateSendGatingReserveLine = { id: string; title: string; description: string };

type EstimateSendGatingDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  phaseLabel: string | null;
  blockingFlags: EstimateSendGatingFlag[];
  warningFlags: EstimateSendGatingFlag[];
  canForce: boolean;
  projectId?: string | null;
  /** The lines of `excluded_without_reason`, by title and status. */
  statusReasonLines?: readonly EstimateSendGatingLine[];
  /** Saves the internal reason of a line, then checks the send again; absent for a reader who cannot write the line. */
  onSaveStatusReason?: (itemId: string, reason: EstimateStatusReason) => Promise<unknown> | void;
  /**
   * The reserved lines of `offer_reserve_declared` and `offer_limits_required`, by title and reserve; PR 5: the lines of
   * `provisional_quantity_mention_missing`, by title and the sentence the limits must carry, and those of
   * `takeoff_hypothesis_without_mention`, by title.
   */
  reserveLines?: readonly EstimateSendGatingReserveLine[];
  /** Opens the limits text, where the reserves are inserted and reviewed; absent for who cannot write it. */
  onOpenLimits?: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onForceConfirm: () => void;
};

function formatFlagCount(count: number) {
  return `${count} point${count > 1 ? "s" : ""} à traiter`;
}

function parseRegisterEntries(flag: EstimateSendGatingFlag) {
  const details = flag.details ?? {};

  return Array.isArray(details.register_entries)
    ? details.register_entries
        .map((entry, index) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }

          const record = entry as Record<string, unknown>;
          const scopeLabel = typeof record.scopeLabel === "string" ? record.scopeLabel.trim() : "";
          const text = typeof record.text === "string" ? record.text.trim() : "";
          const href = typeof record.href === "string" ? record.href.trim() : "";
          const kind = typeof record.kind === "string" ? record.kind.trim() : "";

          if (!text) {
            return null;
          }

          return {
            key: `${flag.key}-register-entry-${index}`,
            label: scopeLabel ? `${scopeLabel}: ${text}` : text,
            href: href || null,
            kind: kind || null,
          };
        })
        .filter(
          (
            entry
          ): entry is {
            key: string;
            label: string;
            href: string | null;
            kind: string | null;
          } => entry !== null
        )
    : [];
}

/** Flags whose lines the window names by their titles (never by identifiers). */
const LINES_BY_TITLE_FLAG_KEYS = new Set(["excluded_without_reason", "offer_reserve_declared", "offer_limits_required",
  "provisional_quantity_mention_missing", "takeoff_hypothesis_without_mention", "provisional_quantity_mention_stale",
  "offer_choice_unreadable"]);

function renderFlagDetails(flag: EstimateSendGatingFlag) {
  const details = flag.details ?? {};
  const detailsLines: Array<{
    key: string;
    text: string;
    href?: string | null;
  }> = [];
  const stalePriceDays = details.stale_price_days;
  const marginMode = details.margin_mode;
  const marginTiersCount = details.margin_tiers_count;
  const totalHtCents = details.total_ht_cents;
  const budgetCeilingHtCents = details.budget_ceiling_ht_cents;
  const registerEntries = parseRegisterEntries(flag);
  const ruleViolations = Array.isArray(details.violations)
    ? details.violations
        .map((entry) => {
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const message = record.message;
          if (typeof message === "string" && message.trim().length > 0) {
            return message.trim();
          }
          return null;
        })
        .filter((entry): entry is string => entry !== null)
    : [];

  if (typeof stalePriceDays === "number") {
    detailsLines.push({
      key: "stale-price-days",
      text: `Seuil d'obsolescence : ${stalePriceDays} jour(s).`,
    });
  }
  if (typeof marginMode === "string") {
    detailsLines.push({
      key: "margin-mode",
      text: `Mode de marge : ${marginMode}.`,
    });
  }
  if (typeof marginTiersCount === "number") {
    detailsLines.push({
      key: "margin-tiers-count",
      text: `Tranches configurées : ${marginTiersCount}.`,
    });
  }
  if (typeof totalHtCents === "number") {
    detailsLines.push({
      key: "total-ht",
      text: `Total HT courant : ${formatEUR(totalHtCents)}.`,
    });
  }
  if (typeof budgetCeilingHtCents === "number") {
    detailsLines.push({
      key: "budget-ceiling-ht",
      text: `Plafond budget HT : ${formatEUR(budgetCeilingHtCents)}.`,
    });
  }
  if (ruleViolations.length > 0) {
    ruleViolations.slice(0, 3).forEach((message, index) => {
      detailsLines.push({
        key: `rule-violation-${index}`,
        text: `Règle : ${message}`,
      });
    });
    if (ruleViolations.length > 3) {
      detailsLines.push({
        key: "rule-violation-overflow",
        text: `…${ruleViolations.length - 3} règle(s) supplémentaire(s).`,
      });
    }
  }
  if (registerEntries.length > 0) {
    const registerEntryPrefix = flag.category === "documents" ? "Documents" : "Registre";
    registerEntries.slice(0, 3).forEach((entry) => {
      detailsLines.push({
        key: entry.key,
        text: `${registerEntryPrefix}: ${entry.label}`,
        href: entry.href,
      });
    });
    if (registerEntries.length > 3) {
      detailsLines.push({
        key: "register-entry-overflow",
        text: `…${registerEntries.length - 3} entrée(s) de registre supplémentaire(s).`,
      });
    }
  }
  if (flag.itemIds.length > 0 && !LINES_BY_TITLE_FLAG_KEYS.has(flag.key)) {
    const preview = flag.itemIds.slice(0, 5).join(", ");
    detailsLines.push({
      key: "item-ids",
      text:
        flag.itemIds.length > 5
          ? `Lignes impactées (extrait) : ${preview}…`
          : `Lignes impactées : ${preview}`,
    });
  }

  if (detailsLines.length === 0) return null;

  return (
    <ul className="mt-1 list-disc pl-4 text-xs text-foreground-secondary">
      {detailsLines.map((line) => (
        <li key={line.key}>
          {line.href ? (
            <Link
              href={line.href}
              className="text-primary underline underline-offset-2"
            >
              {line.text}
            </Link>
          ) : (
            line.text
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * TI-682, lot C (D11, D25): one line excluded after « Non chiffrée » without its internal reason, entered on the spot.
 * The checks are the database's (statusReasonError); the reason never reaches the client.
 */
function StatusReasonEntry({
  line,
  disabled,
  onSave,
}: {
  line: EstimateSendGatingLine;
  disabled: boolean;
  onSave?: (itemId: string, reason: EstimateStatusReason) => Promise<unknown> | void;
}) {
  const id = useId();
  const [code, setCode] = useState<EstimateStatusReasonCode | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const save = async () => {
    if (!onSave) return;
    if (!code) {
      setError("Choisissez un motif.");
      return;
    }
    const message = statusReasonError({ code, note });
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSave(line.id, normalizeStatusReason({ code, note }));
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <li className="rounded-lg bg-surface px-2.5 py-2" data-testid="estimate-send-gating-status-reason-line">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{line.title}</span>
        <Badge variant="outline" size="sm">{line.statusLabel}</Badge>
      </div>
      {onSave ? (
        <div className="mt-2 grid gap-2">
          <select
            id={`${id}-code`}
            className="estimate-input h-8 w-full text-xs"
            aria-label={`Motif interne pour ${line.title}`}
            value={code}
            disabled={disabled || isSaving}
            onChange={(event) => setCode(event.target.value as EstimateStatusReasonCode | "")}
          >
            <option value="">Choisir un motif</option>
            {ESTIMATE_STATUS_REASON_CODE_VALUES.map((value) => (
              <option key={value} value={value}>{ESTIMATE_STATUS_REASON_CODES[value]}</option>
            ))}
          </select>
          <textarea
            className="estimate-input min-h-14 w-full text-xs"
            aria-label={`Précision du motif pour ${line.title}`}
            placeholder={code === "other" ? "Précision obligatoire (10 à 500 caractères)" : "Précision facultative (10 à 500 caractères)"}
            value={note}
            maxLength={2000}
            disabled={disabled || isSaving}
            onChange={(event) => setNote(event.target.value)}
          />
          {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
          <div>
            <Button
              variant="outline"
              size="sm"
              aria-label={`Enregistrer le motif de ${line.title}`}
              disabled={disabled || isSaving}
              onClick={() => void save()}
            >
              Enregistrer le motif
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function renderStatusReasonEntries(
  flag: EstimateSendGatingFlag,
  lines: readonly EstimateSendGatingLine[],
  disabled: boolean,
  onSave?: (itemId: string, reason: EstimateStatusReason) => Promise<unknown> | void,
) {
  if (flag.key !== "excluded_without_reason") return null;
  const byId = new Map(lines.map((line) => [line.id, line]));
  return (
    <div className="mt-2">
      <p className="mb-2 text-xs text-muted-foreground">
        Ce motif est interne : il n&apos;est jamais transmis au client.
      </p>
      <ul className="space-y-2">
        {flag.itemIds.map((itemId) => (
          <StatusReasonEntry
            key={itemId}
            line={byId.get(itemId) ?? { id: itemId, title: "Ligne sans titre", statusLabel: "" }}
            disabled={disabled}
            onSave={onSave}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * TI-682, lot C, PR 4 (D10, D28): the written reserves. The issuer reads each reserved line with the basis an
 * administrator declared (the tool records it, it cannot verify it); a reserve with empty limits is written, not forced.
 */
function renderReserveEntries(
  flag: EstimateSendGatingFlag,
  lines: readonly EstimateSendGatingReserveLine[],
  disabled: boolean,
  onInsert?: () => void,
) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  // TI-682, lot C, PR 5: a sentence of the limits no current line asks; the issuer rereads the text.
  if (flag.key === "provisional_quantity_mention_stale") {
    return onInsert ? (
      <div className="mt-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={onInsert}>
          Relire les précisions
        </Button>
      </div>
    ) : null;
  }
  // TI-682, lot C: the lines whose declared choice the tool cannot read back, by title; an administrator declares it again.
  if (flag.key === "offer_choice_unreadable") {
    return (
      <ul className="mt-2 space-y-2">
        {flag.itemIds.map((itemId) => (
          <li key={itemId} className="rounded-lg bg-surface px-2.5 py-2" data-testid="estimate-send-gating-unreadable-choice-line">
            <span className="block text-xs font-medium text-foreground">{byId.get(itemId)?.title ?? "Ligne sans titre"}</span>
          </li>
        ))}
      </ul>
    );
  }
  // TI-682, lot C, PR 5: each provisional quantity with the sentence its line asks today; the hypotheses nobody declared.
  if (flag.key === "provisional_quantity_mention_missing" || flag.key === "takeoff_hypothesis_without_mention") {
    const missing = flag.key === "provisional_quantity_mention_missing";
    const overflow = missing ? (flag.details?.limits_overflow as { missing_characters?: unknown } | undefined) : undefined;
    const missingCharacters = typeof overflow?.missing_characters === "number" ? overflow.missing_characters : 0;
    return (
      <div className="mt-2">
        {missingCharacters > 0 ? (
          <p className="mb-2 text-xs font-medium text-danger" data-testid="estimate-send-gating-provisional-overflow">
            {provisionalMentionsOverflowMessage(missingCharacters, "send")}
          </p>
        ) : null}
        {missing ? <p className="mb-2 text-xs text-warning">{OFFER_PROVISIONAL_QUANTITY_WARNING}</p> : null}
        <ul className="space-y-2">
          {flag.itemIds.map((itemId) => {
            const line = byId.get(itemId);
            return (
              <li key={itemId} className="rounded-lg bg-surface px-2.5 py-2" data-testid={missing
                ? "estimate-send-gating-provisional-line" : "estimate-send-gating-hypothesis-line"}>
                <span className="block text-xs font-medium text-foreground">{line?.title ?? "Ligne sans titre"}</span>
                {missing && line?.description ? <span className="block text-xs text-foreground-secondary">{line.description}</span> : null}
              </li>
            );
          })}
        </ul>
        {missing && onInsert ? (
          <Button className="mt-2" variant="outline" size="sm" disabled={disabled} onClick={onInsert}>
            Rédiger les précisions
          </Button>
        ) : null}
      </div>
    );
  }
  if (flag.key !== "offer_reserve_declared" && flag.key !== "offer_limits_required") return null;
  if (flag.key === "offer_limits_required") {
    return onInsert ? (
      <div className="mt-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={onInsert}>
          Rédiger les précisions
        </Button>
      </div>
    ) : null;
  }
  return (
    <div className="mt-2">
      <p className="mb-2 text-xs text-warning">{OFFER_RESERVE_WARNING}</p>
      <ul className="space-y-2">
        {flag.itemIds.map((itemId) => {
          const line = byId.get(itemId);
          return (
            <li key={itemId} className="rounded-lg bg-surface px-2.5 py-2" data-testid="estimate-send-gating-reserve-line">
              <span className="block text-xs font-medium text-foreground">{line?.title ?? "Ligne sans titre"}</span>
              {line?.description ? <span className="block text-xs text-foreground-secondary">{line.description}</span> : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        La base et le motif restent internes : le client lit « Non chiffrée » sur la ligne et vos précisions.
      </p>
    </div>
  );
}

function renderFlags(
  flags: EstimateSendGatingFlag[],
  projectId?: string | null,
  statusReason?: {
    lines: readonly EstimateSendGatingLine[];
    disabled: boolean;
    onSave?: (itemId: string, reason: EstimateStatusReason) => Promise<unknown> | void;
  },
  reserves?: {
    lines: readonly EstimateSendGatingReserveLine[];
    disabled: boolean;
    onInsert?: () => void;
  },
) {
  return (
    <ul className="space-y-2 text-sm">
      {flags.map((flag, index) => (
        (() => {
          const registerAction = formatSendBlockerRegisterAction(flag);
          const hasFocusedRegisterLinks = parseRegisterEntries(flag).some(
            (entry) => entry.href
          );
          const registerHref = projectId ? buildSendBlockerRegisterHref(projectId, flag) : null;
          const category =
            flag.category ?? resolveEstimateReadinessCategoryFromGatingFlagKey(flag.key);

          return (
            <li
              key={`${flag.key}-${flag.severity}-${index}`}
              className="rounded-lg border border-border bg-surface-subtle px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">
                    {flag.label}
                  </span>
                  <Badge variant="outline" size="sm">
                    {ESTIMATE_READINESS_CATEGORY_LABELS[category]}
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatFlagCount(flag.count)}
                </span>
              </div>
              <p className="mt-1 text-xs text-foreground-secondary">
                {flag.description}
              </p>
              {renderFlagDetails(flag)}
              {statusReason
                ? renderStatusReasonEntries(flag, statusReason.lines, statusReason.disabled, statusReason.onSave)
                : null}
              {reserves ? renderReserveEntries(flag, reserves.lines, reserves.disabled, reserves.onInsert) : null}
              {registerAction ? (
                <div className="mt-2 rounded-lg bg-surface px-2.5 py-2">
                  <p className="text-xs font-medium text-primary">
                    {registerAction}
                  </p>
                  {registerHref && !hasFocusedRegisterLinks ? (
                    <Link
                      href={registerHref}
                      className="mt-2 inline-flex text-xs font-medium text-primary underline underline-offset-2"
                    >
                      Ouvrir le registre affaire
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })()
      ))}
    </ul>
  );
}

export function EstimateSendGatingDialog({
  isOpen,
  isSubmitting,
  phaseLabel,
  blockingFlags,
  warningFlags,
  canForce,
  projectId,
  statusReasonLines = [],
  onSaveStatusReason,
  reserveLines = [],
  onOpenLimits,
  onClose,
  onConfirm,
  onForceConfirm,
}: Readonly<EstimateSendGatingDialogProps>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const hasBlocking = blockingFlags.length > 0;
  const hasWarnings = warningFlags.length > 0;
  const canConfirmWithoutForce = !hasBlocking;
  // TI-682 (D25): a « Non chiffrée » line is classified before sending, and a line excluded after it says why
  // (lot C); the server refuses any override meanwhile.
  const hasNotForceable = blockingFlags.some((flag) =>
    (ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS as readonly string[]).includes(flag.key));
  const hasNotPricedToClassify = blockingFlags.some((flag) => flag.key === "not_priced_unclassified");
  const hasExcludedWithoutReason = blockingFlags.some((flag) => flag.key === "excluded_without_reason");
  const hasLimitsRequired = blockingFlags.some((flag) => flag.key === "offer_limits_required");
  const hasProvisionalMentionMissing = blockingFlags.some((flag) => flag.key === "provisional_quantity_mention_missing");
  const reserves = { lines: reserveLines, disabled: isSubmitting, onInsert: onOpenLimits };

  return (
    <Dialog
      open={isOpen}
      disablePointerDismissal={isSubmitting}
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
    >
      <DialogContent size="lg" showCloseButton={false} initialFocus={closeButtonRef}>
        <DialogHeader>
          <DialogTitle>Vérification avant envoi</DialogTitle>
          <DialogDescription>
            Traitez les points bloquants avant de passer la version en statut envoyé.
          </DialogDescription>
        </DialogHeader>
        <Button
          ref={closeButtonRef}
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3 sm:top-4 sm:right-4"
          aria-label="Fermer"
          onClick={onClose}
          disabled={isSubmitting}
        >
          <XIcon aria-hidden="true" />
        </Button>

        {phaseLabel ? (
          <Alert variant="info" hideIcon>
            <span className="flex items-center gap-3">
              <Loader2Icon aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              <span>{phaseLabel}</span>
            </span>
          </Alert>
        ) : null}

        <DialogBody>
          {hasBlocking ? (
            <section aria-labelledby="estimate-send-gating-blocking">
              <h3 id="estimate-send-gating-blocking" className="mb-1 text-sm font-semibold text-danger">
                Bloquants ({blockingFlags.length})
              </h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Tant qu&apos;un point bloquant subsiste, l&apos;envoi au client reste en attente.
              </p>
              {renderFlags(blockingFlags, projectId, {
                lines: statusReasonLines,
                disabled: isSubmitting,
                onSave: onSaveStatusReason,
              }, reserves)}
              {hasNotPricedToClassify ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Une ligne qui ne peut pas être chiffrée aujourd&apos;hui peut partir « Non chiffrée » si l&apos;offre le dit : un administrateur déclare la réserve sur la ligne (bouton « Réserve »).
                </p>
              ) : null}
              {hasNotPricedToClassify && canForce ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Les lignes non chiffrées se classent avant l&apos;envoi : le forçage n&apos;est pas proposé tant qu&apos;il en reste.
                </p>
              ) : null}
              {hasExcludedWithoutReason && canForce ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Les lignes exclues après « Non chiffrée » se justifient avant l&apos;envoi : le forçage n&apos;est pas proposé tant qu&apos;un motif manque.
                </p>
              ) : null}
              {hasLimitsRequired && canForce ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Une offre qui réserve des lignes dit par écrit ce qu&apos;elle ne chiffre pas : le forçage n&apos;est pas proposé tant que les précisions sont vides.
                </p>
              ) : null}
              {hasProvisionalMentionMissing && canForce ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Une quantité provisionnelle se dit au client : le forçage n&apos;est pas proposé tant que sa phrase manque aux précisions.
                </p>
              ) : null}
            </section>
          ) : null}
          {hasWarnings ? (
            <section aria-labelledby="estimate-send-gating-warnings">
              <h3 id="estimate-send-gating-warnings" className="mb-1 text-sm font-semibold text-warning">
                Avertissements ({warningFlags.length})
              </h3>
              <p className="mb-2 text-xs text-muted-foreground">
                Ces signaux n&apos;interdisent pas toujours l&apos;envoi, mais ils doivent être assumés explicitement.
              </p>
              {renderFlags(warningFlags, projectId, undefined, reserves)}
            </section>
          ) : null}
          {!hasBlocking && !hasWarnings ? (
            <Alert variant="success">
              <AlertDescription>
                Aucun point bloquant ni avertissement : la version peut être envoyée.
              </AlertDescription>
            </Alert>
          ) : null}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={onClose} disabled={isSubmitting}>
            Annuler
          </Button>
          {hasBlocking && canForce && !hasNotForceable ? (
            <Button variant="danger" size="lg" onClick={onForceConfirm} disabled={isSubmitting}>
              Forcer l&apos;envoi
            </Button>
          ) : null}
          <Button
            variant="primary"
            size="lg"
            onClick={onConfirm}
            disabled={isSubmitting || !canConfirmWithoutForce}
          >
            Envoyer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
