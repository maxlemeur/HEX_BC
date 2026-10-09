"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import type { ConfirmOptions } from "./confirm-types";

export default function ConfirmDialog({
  options,
  onSettle,
}: {
  options: ConfirmOptions | null;
  onSettle: (value: boolean) => void;
}) {
  return (
    <AlertDialog
      open={options !== null}
      onOpenChange={(open) => {
        if (!open) onSettle(false);
      }}
    >
      {options ? (
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{options.title}</AlertDialogTitle>
            {options.description ? (
              <AlertDialogDescription>{options.description}</AlertDialogDescription>
            ) : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{options.cancelLabel ?? "Annuler"}</AlertDialogCancel>
            <Button
              size="lg"
              variant={options.tone === "danger" ? "danger-solid" : "primary"}
              onClick={() => onSettle(true)}
            >
              {options.confirmLabel ?? "Confirmer"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}
