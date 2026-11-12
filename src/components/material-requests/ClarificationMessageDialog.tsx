"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { buildClarificationMessage, type AlertContext } from "@/lib/material-requests/alerts";

/**
 * The short message the office sends to the technician about what the technician alone can answer.
 * The wording comes from the shared rules; this dialog only shows it and copies it.
 */
export function ClarificationMessageDialog({
  open,
  onOpenChange,
  technicianName,
  context,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technicianName: string | null;
  context: AlertContext;
}>) {
  const [copy, setCopy] = useState<{ message: string; state: "copied" | "refused" } | null>(null);
  const message = open ? buildClarificationMessage({ technicianName, lines: context.lines, context }) : null;
  const copyState = copy && copy.message === message ? copy.state : null;

  async function handleCopy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopy({ message: text, state: "copied" });
    } catch {
      setCopy({ message: text, state: "refused" });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Message au technicien</DialogTitle>
          <DialogDescription>
            Seulement ce que le technicien est seul à savoir. À coller dans un SMS ou une messagerie.
          </DialogDescription>
        </DialogHeader>
        {message ? (
          <>
            <Textarea
              readOnly
              aria-label="Message à envoyer"
              className="min-h-40 px-3 py-2 text-sm"
              value={message}
              onFocus={(event) => event.currentTarget.select()}
            />
            <p role="status" className="min-h-5 text-sm text-muted-foreground">
              {copyState === "copied" ? "Message copié." : null}
              {copyState === "refused"
                ? "La copie a été refusée par le navigateur : sélectionnez le texte et copiez-le à la main."
                : null}
            </p>
            <DialogFooter>
              <Button type="button" onClick={() => void handleCopy(message)}>
                {copyState === "copied" ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                Copier
              </Button>
            </DialogFooter>
          </>
        ) : (
          <p className="text-sm text-foreground">
            Rien à demander au technicien pour le moment : ce qui reste à régler, le bureau peut le faire seul.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
