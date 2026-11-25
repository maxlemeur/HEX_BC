"use client";

import type { ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type AffaireConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
  confirmDisabled?: boolean;
  cancelDisabled?: boolean;
  errorMessage?: string | null;
  /** What the dialog shows under its message, before its buttons. */
  children?: ReactNode;
  secondaryAction?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Confirmation for affaire deletions and archives that stays open while the request runs
 * and shows the server error in place (useConfirm resolves before the request starts).
 * Same props as the legacy ConfirmModal, so the delete/archive hooks are unchanged.
 */
export function AffaireConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirmer",
  variant = "default",
  confirmDisabled = false,
  cancelDisabled = false,
  errorMessage,
  children,
  secondaryAction,
  onConfirm,
  onCancel,
}: Readonly<AffaireConfirmDialogProps>) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !cancelDisabled) {
          onCancel();
        }
      }}
    >
      {open ? (
        <AlertDialogContent className={secondaryAction ? "max-h-[90dvh] overflow-y-auto sm:max-w-2xl" : undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          {children}
          {errorMessage ? (
            <Alert variant="danger">
              <AlertDescription className="text-danger">{errorMessage}</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelDisabled}>Annuler</AlertDialogCancel>
            {secondaryAction}
            <Button
              size="lg"
              variant={variant === "danger" ? "danger-solid" : "primary"}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      ) : null}
    </AlertDialog>
  );
}
