"use client";

import { useTransition } from "react";
import { EllipsisIcon, LoaderIcon } from "lucide-react";

import { markApprovalQueueItemStateAction } from "@/app/dashboard/_actions/approval-queue";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui-legacy/Toast";
import type { ReviewerState } from "@/lib/approvals/server";

const STATE_OPTIONS: { value: ReviewerState; label: string }[] = [
  { value: "seen", label: "Vu" },
  { value: "review_laurent", label: "À revoir" },
  { value: "blocking", label: "Bloquant" },
  { value: "acceptable", label: "Acceptable" },
];

type ApprovalQueueStateActionsProps = {
  cycleId: string;
  currentState: ReviewerState | null;
  onStateChange?: (state: ReviewerState) => void;
};

/** Menu de triage d'une carte (clavier : flèches, Entrée, Échap). */
export function ApprovalQueueStateActions({
  cycleId,
  currentState,
  onStateChange,
}: ApprovalQueueStateActionsProps) {
  const [isPending, startTransition] = useTransition();
  const toast = useToast();

  const handleSelect = (state: ReviewerState) => {
    const label = STATE_OPTIONS.find((option) => option.value === state)?.label ?? state;
    startTransition(async () => {
      try {
        await markApprovalQueueItemStateAction({ cycleId, state });
        onStateChange?.(state);
        toast.success({ title: `Marqué comme « ${label} »` });
      } catch {
        toast.error({ title: "Le triage n’a pas pu être enregistré.", description: "Réessayez dans un instant." });
      }
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        render={
          <Button
            variant="outline"
            size="icon-sm"
            className="size-11 text-muted-foreground sm:size-8"
            aria-label="Actions de triage"
          />
        }
      >
        {isPending ? (
          <LoaderIcon aria-hidden="true" className="size-3.5 animate-spin motion-reduce:animate-none" />
        ) : (
          <EllipsisIcon aria-hidden="true" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto! min-w-44 p-1.5">
        <DropdownMenuRadioGroup value={currentState ?? ""}>
          <DropdownMenuLabel>États de triage</DropdownMenuLabel>
          {STATE_OPTIONS.map((option) => (
            <DropdownMenuRadioItem
              key={option.value}
              value={option.value}
              closeOnClick
              className="min-h-10 px-2.5 sm:min-h-8"
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
