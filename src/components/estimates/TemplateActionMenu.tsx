"use client";

import { CopyIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

type TemplateActionMenuProps = {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  disabled?: boolean;
  /** Name of the row, appended to the accessible names of the actions. */
  itemName?: string;
};

export function TemplateActionMenu({
  onRename,
  onDuplicate,
  onDelete,
  disabled,
  itemName,
}: TemplateActionMenuProps) {
  const suffix = itemName ? ` ${itemName}` : "";

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onRename}
        disabled={disabled}
        aria-label={`Renommer${suffix}`}
        leftIcon={<PencilIcon aria-hidden="true" />}
      >
        Renommer
      </Button>
      <Button
        variant="ghost"
        size="sm"
        type="button"
        onClick={onDuplicate}
        disabled={disabled}
        aria-label={`Dupliquer${suffix}`}
        leftIcon={<CopyIcon aria-hidden="true" />}
      >
        Dupliquer
      </Button>
      <Button
        variant="danger"
        size="sm"
        type="button"
        onClick={onDelete}
        disabled={disabled}
        aria-label={`Supprimer${suffix}`}
        leftIcon={<Trash2Icon aria-hidden="true" />}
      >
        Supprimer
      </Button>
    </div>
  );
}
