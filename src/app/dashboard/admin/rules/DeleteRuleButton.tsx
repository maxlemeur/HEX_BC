"use client";

import type { MouseEvent } from "react";
import { useFormStatus } from "react-dom";

import { useConfirm } from "@/components/feedback/confirm-provider";
import { Button } from "@/components/ui/button";

type DeleteRuleButtonProps = {
  /** Human label of the rule, e.g. "Marge minimum · Global". */
  ruleLabel: string;
};

/**
 * Submit button of the server-action delete form: asks for confirmation first, then submits
 * the enclosing form unchanged (the server action stays the single source of the deletion).
 */
export function DeleteRuleButton({ ruleLabel }: Readonly<DeleteRuleButtonProps>) {
  const confirm = useConfirm();
  const { pending } = useFormStatus();

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const form = event.currentTarget.form;
    if (!form) return;

    const confirmed = await confirm({
      title: "Supprimer la règle ?",
      description: `La règle « ${ruleLabel} » sera supprimée définitivement.`,
      confirmLabel: "Supprimer",
      tone: "danger",
    });
    if (!confirmed) return;

    form.requestSubmit();
  }

  return (
    <Button
      type="submit"
      variant="danger"
      size="md"
      loading={pending}
      onClick={(event) => void handleClick(event)}
    >
      Supprimer
    </Button>
  );
}
