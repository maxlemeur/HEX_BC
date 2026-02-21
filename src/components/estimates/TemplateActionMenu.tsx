"use client";

type TemplateActionMenuProps = {
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  disabled?: boolean;
};

export function TemplateActionMenu({
  onRename,
  onDuplicate,
  onDelete,
  disabled,
}: TemplateActionMenuProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={onRename}
        disabled={disabled}
      >
        Renommer
      </button>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={onDuplicate}
        disabled={disabled}
      >
        Dupliquer
      </button>
      <button
        className="btn btn-danger btn-sm"
        type="button"
        onClick={onDelete}
        disabled={disabled}
      >
        Supprimer
      </button>
    </div>
  );
}
