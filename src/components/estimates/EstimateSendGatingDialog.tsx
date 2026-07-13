"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

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

const FOCUSABLE_ELEMENT_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENT_SELECTOR)
  ).filter((element) => element.getAttribute("aria-hidden") !== "true");
}

function formatFlagCount(count: number) {
  return `${count} point${count > 1 ? "s" : ""} a traiter`;
}

function formatRegisterAction(flag: EstimateSendGatingFlag) {
  switch (flag.key) {
    case "critical_missing_pieces":
      return "Recuperez ou requalifiez ces pieces critiques avant de reprendre l'envoi.";
    case "critical_open_questions":
      return "Traitez ces points critiques dans le registre affaire avant de reprendre l'envoi.";
    case "client_missing_documents_required":
      return "Revenez sur les demandes de pieces client pour solder ou requalifier ces attentes documentaires.";
    case "client_clarification_required":
      return "Revenez sur le registre affaire pour lever ou requalifier ces clarifications client.";
    case "missing_pieces_pending":
      return "Passez par le registre affaire pour solder ou assumer explicitement ces pieces manquantes.";
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
      text: `Seuil d'obsolescence: ${stalePriceDays} jour(s).`,
    });
  }
  if (typeof marginMode === "string") {
    detailsLines.push({
      key: "margin-mode",
      text: `Mode de marge: ${marginMode}.`,
    });
  }
  if (typeof marginTiersCount === "number") {
    detailsLines.push({
      key: "margin-tiers-count",
      text: `Tranches configurees: ${marginTiersCount}.`,
    });
  }
  if (typeof totalHtCents === "number") {
    detailsLines.push({
      key: "total-ht",
      text: `Total HT courant: ${formatEUR(totalHtCents)}.`,
    });
  }
  if (typeof budgetCeilingHtCents === "number") {
    detailsLines.push({
      key: "budget-ceiling-ht",
      text: `Plafond budget HT: ${formatEUR(budgetCeilingHtCents)}.`,
    });
  }
  if (ruleViolations.length > 0) {
    ruleViolations.slice(0, 3).forEach((message, index) => {
      detailsLines.push({
        key: `rule-violation-${index}`,
        text: `Regle: ${message}`,
      });
    });
    if (ruleViolations.length > 3) {
      detailsLines.push({
        key: "rule-violation-overflow",
        text: `...${ruleViolations.length - 3} regle(s) supplementaire(s).`,
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
        text: `...${registerEntries.length - 3} entree(s) registre supplementaire(s).`,
      });
    }
  }
  if (flag.itemIds.length > 0) {
    const preview = flag.itemIds.slice(0, 5).join(", ");
    detailsLines.push({
      key: "item-ids",
      text:
        flag.itemIds.length > 5
          ? `Lignes impactees (extrait): ${preview}...`
          : `Lignes impactees: ${preview}`,
    });
  }

  if (detailsLines.length === 0) return null;

  return (
    <ul className="mt-1 list-disc pl-4 text-xs text-[var(--slate-600)]">
      {detailsLines.map((line) => (
        <li key={line.key}>
          {line.href ? (
            <Link
              href={line.href}
              className="text-[var(--brand-blue)] underline underline-offset-2"
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
  if (flags.length === 0) {
    return (
      <p className="text-sm text-[var(--slate-500)]">
        Aucun element.
      </p>
    );
  }

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
              className="rounded-lg border border-[var(--slate-200)] bg-[var(--surface-subtle)] px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[var(--slate-800)]">
                    {flag.label}
                  </span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-[var(--slate-500)]">
                    {ESTIMATE_READINESS_CATEGORY_LABELS[category]}
                  </span>
                </div>
                <span className="text-xs text-[var(--slate-500)]">
                  {formatFlagCount(flag.count)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--slate-600)]">
                {flag.description}
              </p>
              {renderFlagDetails(flag)}
              {registerAction ? (
                <div className="mt-2 rounded-lg bg-white px-2.5 py-2">
                  <p className="text-xs font-medium text-[var(--brand-blue)]">
                    {registerAction}
                  </p>
                  {registerHref && !hasFocusedRegisterLinks ? (
                    <Link
                      href={registerHref}
                      className="mt-2 inline-flex text-xs font-medium text-[var(--brand-blue)] underline underline-offset-2"
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const dialog = dialogRef.current;
    const initialFocusTarget =
      closeButtonRef.current && !closeButtonRef.current.disabled
        ? closeButtonRef.current
        : dialog
          ? getFocusableElements(dialog)[0] ?? dialog
          : null;
    initialFocusTarget?.focus();

    return () => {
      const previouslyFocusedElement = previouslyFocusedElementRef.current;
      previouslyFocusedElementRef.current = null;
      if (previouslyFocusedElement?.isConnected) {
        previouslyFocusedElement.focus();
      }
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!isSubmitting) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        return;
      }

      if (event.key !== "Tab") return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusableElements = getFocusableElements(dialog);
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstFocusableElement = focusableElements[0];
      const lastFocusableElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey) {
        if (
          activeElement === firstFocusableElement ||
          !dialog.contains(activeElement)
        ) {
          event.preventDefault();
          lastFocusableElement.focus();
        }
        return;
      }

      if (
        activeElement === lastFocusableElement ||
        !dialog.contains(activeElement)
      ) {
        event.preventDefault();
        firstFocusableElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  const hasBlocking = blockingFlags.length > 0;
  const canConfirmWithoutForce = !hasBlocking;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,6,23,0.45)] p-4">
      <div
        ref={dialogRef}
        className="dashboard-card w-full max-w-2xl p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-send-gating-title"
        tabIndex={-1}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2
              id="estimate-send-gating-title"
              className="text-lg font-semibold text-[var(--slate-800)]"
            >
              Verification avant envoi
            </h2>
            <p className="mt-1 text-sm text-[var(--slate-500)]">
              Traitez les blocants metier avant de passer la version en statut envoye.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Fermer
          </button>
        </div>

        {phaseLabel ? (
          <div className="alert alert-info mb-4 flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--slate-300)] border-t-[var(--brand-blue)]" />
            <span>{phaseLabel}</span>
          </div>
        ) : null}

        <div className="space-y-4">
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--danger)]">
              Bloquants ({blockingFlags.length})
            </h3>
            <p className="mb-2 text-xs text-[var(--slate-500)]">
              Tant qu&apos;un blocant subsiste, l&apos;envoi client doit rester en attente.
            </p>
            {renderFlags(blockingFlags, projectId)}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[var(--warning)]">
              Avertissements ({warningFlags.length})
            </h3>
            <p className="mb-2 text-xs text-[var(--slate-500)]">
              Ces signaux n&apos;interdisent pas toujours l&apos;envoi, mais ils doivent etre assumes explicitement.
            </p>
            {renderFlags(warningFlags, projectId)}
          </section>
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Annuler
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={isSubmitting || !canConfirmWithoutForce}
          >
            Envoyer
          </button>
          {hasBlocking && canForce ? (
              <button
                type="button"
                className="btn btn-danger"
                onClick={onForceConfirm}
                disabled={isSubmitting}
              >
                Forcer l&apos;envoi
              </button>
            ) : null}
        </div>
      </div>
    </div>
  );
}
