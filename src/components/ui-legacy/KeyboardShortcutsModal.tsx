"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CalculatorIcon, KeyboardIcon, SearchIcon, SquareDashedIcon } from "lucide-react";

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
  return isMac ? "⌘" : "Ctrl";
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
      icon: <SearchIcon aria-hidden="true" className="size-3.5" />,
      shortcuts: [
        { keys: [mod, "K"], label: "Recherche rapide" },
        { keys: ["Échap"], label: "Fermer le panneau ou la fenêtre" },
        { keys: ["?"], label: "Raccourcis clavier" },
      ],
    },
    {
      id: "editor",
      title: "Éditeur de chiffrage",
      icon: <CalculatorIcon aria-hidden="true" className="size-3.5" />,
      shortcuts: [
        { keys: [mod, "S"], label: "Enregistrer" },
        { keys: [mod, "Z"], label: "Annuler" },
        { keys: [mod, "Y"], label: "Rétablir" },
        { keys: ["Tab"], label: "Cellule suivante" },
        { keys: ["Entrée"], label: "Modifier la cellule" },
        { keys: ["Suppr"], label: "Supprimer la sélection" },
        { keys: [mod, "C"], label: "Copier les lignes" },
        { keys: [mod, "Maj", "A"], label: "Insérer un ouvrage" },
      ],
    },
    {
      id: "selection",
      title: "Sélection",
      icon: <SquareDashedIcon aria-hidden="true" className="size-3.5" />,
      shortcuts: [
        { keys: [mod, "A"], label: "Tout sélectionner" },
        { keys: ["Maj", "Clic"], label: "Sélectionner une plage" },
        { keys: [mod, "Clic"], label: "Basculer une ligne" },
        { keys: ["Échap"], label: "Tout désélectionner" },
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
        "px-1.5 font-mono text-micro font-medium text-foreground-secondary",
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
    <Dialog open={open} onOpenChange={(next) => onOpenChange(next)}>
      <DialogContent size="lg" className="gap-0 overflow-hidden p-0 sm:max-w-xl sm:p-0">
        <DialogHeader className="flex-row items-center gap-2.5 border-b border-border px-5 py-4 pr-14">
          <span
            aria-hidden="true"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <KeyboardIcon className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="text-base font-semibold">Raccourcis clavier</DialogTitle>
            <DialogDescription className="text-xs">
              Accélérez votre travail dans l’éditeur.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
          {groups.map((group) => {
            const isHighlighted = group.id === activeContext;
            const headingId = `keyboard-shortcuts-${group.id}`;

            return (
              <section
                key={group.id}
                aria-labelledby={headingId}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  isHighlighted
                    ? "border-brand-orange/30 bg-brand-orange/[0.04]"
                    : "border-border bg-transparent"
                )}
              >
                <div className="mb-3 flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-6 items-center justify-center rounded-md",
                      isHighlighted
                        ? "bg-brand-orange/10 text-brand-orange-dark"
                        : "bg-muted text-muted-foreground"
                    )}
                  >
                    {group.icon}
                  </span>
                  <h3
                    id={headingId}
                    className={cn(
                      "text-xs font-semibold uppercase tracking-wider",
                      isHighlighted ? "text-brand-orange-dark" : "text-muted-foreground"
                    )}
                  >
                    {group.title}
                  </h3>
                  {isHighlighted ? (
                    <Badge variant="accent" size="sm" className="ml-auto">
                      Contexte actif
                    </Badge>
                  ) : null}
                </div>

                <dl className="space-y-1.5">
                  {group.shortcuts.map((shortcut) => (
                    <div
                      key={shortcut.label}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/50"
                    >
                      <dt className="text-sm text-foreground">{shortcut.label}</dt>
                      <dd className="flex shrink-0 items-center gap-1">
                        {shortcut.keys.map((key, i) => (
                          <span key={`${shortcut.label}-${key}-${i}`} className="flex items-center gap-1">
                            {i > 0 ? (
                              <span aria-hidden="true" className="text-micro text-muted-foreground">
                                +
                              </span>
                            ) : null}
                            <Kbd>{key}</Kbd>
                          </span>
                        ))}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            );
          })}
        </div>

        <DialogFooter className="mt-0 flex-row items-center justify-between gap-3 border-t border-border px-5 py-3 sm:justify-between">
          <p className="text-micro text-muted-foreground">
            Appuyez sur <Kbd>?</Kbd> pour ouvrir ce panneau
          </p>
          <DialogClose render={<Button variant="ghost" size="sm" />}>Fermer</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
