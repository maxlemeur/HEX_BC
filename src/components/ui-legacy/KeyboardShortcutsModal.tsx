"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Modal } from "@/components/ui-legacy/Modal";
import { CalculatorIcon, KeyboardIcon, SearchIcon, SquareDashedIcon, XIcon } from "lucide-react";

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
        <SearchIcon aria-hidden="true" size={16} />
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
        <CalculatorIcon aria-hidden="true" size={16} />
      ),
      shortcuts: [
        { keys: [mod, "S"], label: "Sauvegarder" },
        { keys: [mod, "Z"], label: "Annuler" },
        { keys: [mod, "Y"], label: "Rétablir" },
        { keys: ["Tab"], label: "Cellule suivante" },
        { keys: ["Entrée"], label: "Éditer la cellule" },
        { keys: ["Suppr"], label: "Supprimer la sélection" },
        { keys: [mod, "C"], label: "Copier les lignes" },
        { keys: [mod, "Shift", "A"], label: "Insérer un ouvrage" },
      ],
    },
    {
      id: "selection",
      title: "Sélection",
      icon: (
        <SquareDashedIcon aria-hidden="true" size={16} />
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
        "border border-border bg-muted",
        "px-1.5 font-mono text-[11px] font-medium text-muted-foreground",
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
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyboardIcon aria-hidden="true" size={16} />
            </div>
            <div>
              <Modal.Title className="text-base font-semibold text-foreground">
                Raccourcis clavier
              </Modal.Title>
              <p className="text-xs text-muted-foreground">
                Accélérez votre travail dans l&apos;éditeur
              </p>
            </div>
          </div>
          <Modal.Close
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label="Fermer"
          >
            <XIcon aria-hidden="true" size={16} />
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
                    ? "border-brand-orange/30 bg-brand-orange/[0.04]"
                    : "border-border bg-transparent"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md",
                      isHighlighted
                        ? "bg-brand-orange/10 text-brand-orange"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {group.icon}
                  </span>
                  <h3
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wider",
                      isHighlighted
                        ? "text-brand-orange"
                        : "text-muted-foreground"
                    )}
                  >
                    {group.title}
                  </h3>
                  {isHighlighted ? (
                    <span className="ml-auto rounded-full bg-brand-orange/10 px-2 py-0.5 text-[10px] font-semibold text-brand-orange">
                      Contexte actif
                    </span>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.label}
                      className="flex items-center justify-between rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="text-sm text-foreground">
                        {shortcut.label}
                      </span>
                      <span className="flex items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <span key={`${shortcut.label}-${key}-${i}`} className="flex items-center gap-1">
                            {i > 0 ? (
                              <span className="text-[10px] text-muted-foreground">
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
        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <p className="text-[11px] text-muted-foreground">
            Appuyez sur <Kbd>?</Kbd> pour ouvrir ce panneau
          </p>
          <Modal.Close className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            Fermer
          </Modal.Close>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
