"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui/Modal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Shortcut = {
  keys: string[];
  label: string;
};

type ShortcutGroup = {
  id: string;
  title: string;
  icon: React.ReactNode;
  shortcuts: Shortcut[];
};

type ShortcutContext = "navigation" | "editor" | "selection";

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function useIsMac() {
  const [isMac] = useState(() =>
    typeof navigator !== "undefined"
      ? /mac|iphone|ipad|ipod/i.test(navigator.userAgent)
      : false
  );
  return isMac;
}

function modKey(isMac: boolean) {
  return isMac ? "\u2318" : "Ctrl";
}

// ---------------------------------------------------------------------------
// Shortcut definitions
// ---------------------------------------------------------------------------

function buildShortcutGroups(isMac: boolean): ShortcutGroup[] {
  const mod = modKey(isMac);

  return [
    {
      id: "navigation",
      title: "Navigation",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
      ),
      shortcuts: [
        { keys: [mod, "K"], label: "Recherche rapide" },
        { keys: ["Esc"], label: "Fermer panneau / modale" },
        { keys: ["?"], label: "Raccourcis clavier" },
      ],
    },
    {
      id: "editor",
      title: "Éditeur de chiffrage",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect width="16" height="20" x="4" y="2" rx="2" />
          <path d="M8 7h8" />
          <path d="M8 11h2" />
          <path d="M14 11h2" />
          <path d="M8 15h2" />
          <path d="M14 15h2" />
        </svg>
      ),
      shortcuts: [
        { keys: [mod, "S"], label: "Sauvegarder" },
        { keys: [mod, "Z"], label: "Annuler" },
        { keys: [mod, "Y"], label: "Rétablir" },
        { keys: ["Tab"], label: "Cellule suivante" },
        { keys: ["Entrée"], label: "Éditer la cellule" },
        { keys: ["Suppr"], label: "Supprimer la sélection" },
        { keys: [mod, "C"], label: "Copier les lignes" },
        { keys: [mod, "Shift", "A"], label: "Insérer un assemblage" },
      ],
    },
    {
      id: "selection",
      title: "Sélection",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 3a2 2 0 0 0-2 2" />
          <path d="M19 3a2 2 0 0 1 2 2" />
          <path d="M21 19a2 2 0 0 1-2 2" />
          <path d="M5 21a2 2 0 0 1-2-2" />
          <path d="M9 3h1" />
          <path d="M9 21h1" />
          <path d="M14 3h1" />
          <path d="M14 21h1" />
          <path d="M3 9v1" />
          <path d="M21 9v1" />
          <path d="M3 14v1" />
          <path d="M21 14v1" />
        </svg>
      ),
      shortcuts: [
        { keys: [mod, "A"], label: "Tout sélectionner" },
        { keys: ["Shift", "Clic"], label: "Sélection de plage" },
        { keys: [mod, "Clic"], label: "Basculer une ligne" },
        { keys: ["Esc"], label: "Désélectionner tout" },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Kbd component
// ---------------------------------------------------------------------------

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md",
        "border border-[var(--border)] bg-[var(--muted)]",
        "px-1.5 font-mono text-[11px] font-medium text-[var(--muted-foreground)]",
        "shadow-[0_1px_0_1px_var(--border)]"
      )}
    >
      {children}
    </kbd>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type KeyboardShortcutsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current context to highlight the relevant group */
  activeContext?: ShortcutContext;
};

export function KeyboardShortcutsModal({
  open,
  onOpenChange,
  activeContext = "navigation",
}: KeyboardShortcutsModalProps) {
  const isMac = useIsMac();
  const groups = buildShortcutGroups(isMac);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content className="max-w-xl p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M6 8h.01" />
                <path d="M10 8h.01" />
                <path d="M14 8h.01" />
                <path d="M18 8h.01" />
                <path d="M8 12h.01" />
                <path d="M12 12h.01" />
                <path d="M16 12h.01" />
                <path d="M7 16h10" />
              </svg>
            </div>
            <div>
              <Modal.Title className="text-base font-semibold text-[var(--foreground)]">
                Raccourcis clavier
              </Modal.Title>
              <p className="text-xs text-[var(--muted-foreground)]">
                Accélérez votre travail dans l&apos;éditeur
              </p>
            </div>
          </div>
          <Modal.Close
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
            aria-label="Fermer"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </Modal.Close>
        </div>

        {/* Shortcut groups */}
        <div className="max-h-[60vh] overflow-y-auto overscroll-contain px-5 py-4 space-y-5">
          {groups.map((group) => {
            const isHighlighted = group.id === activeContext;

            return (
              <section
                key={group.id}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  isHighlighted
                    ? "border-[var(--brand-orange)]/30 bg-[var(--brand-orange)]/[0.04]"
                    : "border-[var(--border)] bg-transparent"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md",
                      isHighlighted
                        ? "bg-[var(--brand-orange)]/10 text-[var(--brand-orange)]"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    )}
                  >
                    {group.icon}
                  </span>
                  <h3
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wider",
                      isHighlighted
                        ? "text-[var(--brand-orange)]"
                        : "text-[var(--muted-foreground)]"
                    )}
                  >
                    {group.title}
                  </h3>
                  {isHighlighted ? (
                    <span className="ml-auto rounded-full bg-[var(--brand-orange)]/10 px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-orange)]">
                      Contexte actif
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.label}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--muted)]/50"
                    >
                      <span className="text-sm text-[var(--foreground)]">
                        {shortcut.label}
                      </span>
                      <span className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <span key={`${shortcut.label}-${key}-${i}`} className="flex items-center gap-1">
                            {i > 0 ? (
                              <span className="text-[10px] text-[var(--muted-foreground)]">
                                +
                              </span>
                            ) : null}
                            <Kbd>{key}</Kbd>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <p className="text-[11px] text-[var(--muted-foreground)]">
            Appuyez sur <Kbd>?</Kbd> pour ouvrir ce panneau
          </p>
          <Modal.Close className="text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors">
            Fermer
          </Modal.Close>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
