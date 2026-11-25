"use client";

import { useRef, useState } from "react";
import { History, PencilLine, Settings, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const ITEM = "min-h-10 px-2";

/**
 * The rare actions on the whole request, behind one gear: its fields, the technician's previous requests and, last,
 * its deletion. The work of each step stays on the page.
 */
export function MaterialRequestOptions({
  canWrite,
  technicianName,
  hasOrderedLines,
  onEdit,
  onHistory,
  onDelete,
}: Readonly<{
  canWrite: boolean;
  technicianName: string | null;
  /** An order that stands keeps its request: the server refuses the deletion, said here before any click. */
  hasOrderedLines: boolean;
  onEdit: () => void;
  onHistory: () => void;
  /** Resolves with the reason when the request could not be deleted. */
  onDelete: () => Promise<string | null>;
}>) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <div className="shrink-0">
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label="Options de la demande"
          title="Options de la demande"
          className={buttonVariants({ variant: "outline", size: "icon-lg" })}
        >
          <Settings aria-hidden="true" className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72! max-w-[calc(100vw-2rem)] p-1.5">
          <DropdownMenuItem className={ITEM} onClick={onEdit}>
            <PencilLine aria-hidden="true" />
            {canWrite ? "Modifier la demande" : "Détails de la demande"}
          </DropdownMenuItem>
          {technicianName ? (
            <DropdownMenuItem className={ITEM} onClick={onHistory}>
              <History aria-hidden="true" />
              {`Demandes précédentes de ${technicianName}`}
            </DropdownMenuItem>
          ) : null}
          {canWrite ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={ITEM}
                variant="destructive"
                disabled={hasOrderedLines}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                <Trash2 aria-hidden="true" />
                <span className="flex min-w-0 flex-col">
                  <span>Supprimer la demande</span>
                  {hasOrderedLines ? <span className="text-xs text-muted-foreground">Des lignes sont déjà commandées</span> : null}
                </span>
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={confirming} onOpenChange={(open) => (deleting ? undefined : setConfirming(open))}>
        <AlertDialogContent finalFocus={trigger}>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer la demande ?</AlertDialogTitle>
            <AlertDialogDescription>La demande et ses lignes seront supprimées. Cette action est définitive.</AlertDialogDescription>
          </AlertDialogHeader>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
            <Button
              type="button"
              size="lg"
              variant="danger-solid"
              disabled={deleting}
              onClick={async () => {
                setDeleting(true);
                const refusal = await onDelete();
                setDeleting(false);
                if (refusal) setError(refusal);
              }}
            >
              <Trash2 aria-hidden="true" />
              Supprimer la demande
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
