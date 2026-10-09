"use client";

import Link from "next/link";
import { useRef } from "react";
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
import { buildAffaireRegisterSearchHref } from "@/lib/affaires/register";
import { formatEUR } from "@/lib/money";
import type { EstimateSendGatingFlag } from "@/lib/estimates/client";
import {
  ESTIMATE_READINESS_CATEGORY_LABELS,
  resolveEstimateReadinessCategoryFromGatingFlagKey,
} from "@/lib/estimates/readiness";

type EstimateSendGatingDialogProps = {
  isOpen: boolean;
  isSubmitting: boolean;
  phaseLabel: string | null;
  blockingFlags: EstimateSendGatingFlag[];
  warningFlags: EstimateSendGatingFlag[];
  canForce: boolean;
  projectId?: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onForceConfirm: () => void;
};

function formatFlagCount(count: number) {
  return `${count} point${count > 1 ? "s" : ""} à traiter`;
}

function formatRegisterAction(flag: EstimateSendGatingFlag) {
  switch (flag.key) {
    case "critical_missing_pieces":
      return "Récupérez ou requalifiez ces pièces critiques avant de reprendre l'envoi.";
    case "critical_open_questions":
      return "Traitez ces points critiques dans le registre affaire avant de reprendre l'envoi.";
    case "client_missing_documents_required":
      return "Revenez sur les demandes de pièces client pour solder ou requalifier ces attentes documentaires.";
    case "client_clarification_required":
      return "Revenez sur le registre affaire pour lever ou requalifier ces clarifications client.";
    case "missing_pieces_pending":
      return "Passez par le registre affaire pour solder ou assumer explicitement ces pièces manquantes.";
    case "open_questions_pending":
      return "Passez par le registre affaire pour solder ou assumer explicitement ces points ouverts.";
    default:
      return null;
  }
}

function buildRegisterHref(projectId: string, flag: EstimateSendGatingFlag) {
  switch (flag.key) {
    case "critical_missing_pieces":
      return buildAffaireRegisterSearchHref({
        pathname: `/dashboard/affaires/${projectId}`,
        searchParams: new URLSearchParams(),
        status: "open",
        severity: "critical",
        kind: "missing_piece",
        cursor: null,
      });
    case "critical_open_questions":
      return buildAffaireRegisterSearchHref({
        pathname: `/dashboard/affaires/${projectId}`,
        searchParams: new URLSearchParams(),
        status: "open",
        severity: "critical",
        kind: "assumption",
        cursor: null,
      });
    case "client_missing_documents_required":
      return buildAffaireRegisterSearchHref({
        pathname: `/dashboard/affaires/${projectId}`,
        searchParams: new URLSearchParams(),
        status: "clarify_with_client",
        severity: null,
        kind: "missing_piece",
        cursor: null,
      });
    case "client_clarification_required":
      return buildAffaireRegisterSearchHref({
        pathname: `/dashboard/affaires/${projectId}`,
        searchParams: new URLSearchParams(),
        status: "clarify_with_client",
        severity: null,
        kind: "assumption",
        cursor: null,
      });
    case "missing_pieces_pending":
      return buildAffaireRegisterSearchHref({
        pathname: `/dashboard/affaires/${projectId}`,
        searchParams: new URLSearchParams(),
        status: "open",
        severity: null,
        kind: "missing_piece",
        cursor: null,
      });
    case "open_questions_pending":
      return buildAffaireRegisterSearchHref({
        pathname: `/dashboard/affaires/${projectId}`,
        searchParams: new URLSearchParams(),
        status: "open",
        severity: null,
        kind: "assumption",
        cursor: null,
      });
    default:
      return `/dashboard/affaires/${projectId}`;
  }
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
  if (flag.itemIds.length > 0) {
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

function renderFlags(flags: EstimateSendGatingFlag[], projectId?: string | null) {
  return (
    <ul className="space-y-2 text-sm">
      {flags.map((flag, index) => (
        (() => {
          const registerAction = formatRegisterAction(flag);
          const hasFocusedRegisterLinks = parseRegisterEntries(flag).some(
            (entry) => entry.href
          );
          const registerHref = projectId ? buildRegisterHref(projectId, flag) : null;
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
  onClose,
  onConfirm,
  onForceConfirm,
}: Readonly<EstimateSendGatingDialogProps>) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const hasBlocking = blockingFlags.length > 0;
  const hasWarnings = warningFlags.length > 0;
  const canConfirmWithoutForce = !hasBlocking;

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
              {renderFlags(blockingFlags, projectId)}
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
              {renderFlags(warningFlags, projectId)}
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
          {hasBlocking && canForce ? (
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
