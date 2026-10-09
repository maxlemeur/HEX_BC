"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { CopyIcon, GitBranchIcon } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  createEstimateVariant,
  duplicateEstimateVersion,
} from "@/lib/estimates/client";
import { cn } from "@/lib/utils";

type DuplicateEstimateButtonProps = {
  versionId: string;
  className?: string;
};

export function DuplicateEstimateButton({
  versionId,
  className,
}: DuplicateEstimateButtonProps) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"duplicate" | "variant" | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const handleDuplicate = useCallback(async () => {
    if (!versionId || pendingAction) return;
    setActionError(null);
    setPendingAction("duplicate");

    try {
      const duplicatedVersionId = await duplicateEstimateVersion(versionId);

      router.push(`/dashboard/estimates/${duplicatedVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      );
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, router, versionId]);

  const handleCreateVariant = useCallback(async () => {
    if (!versionId || pendingAction) return;
    setActionError(null);
    setPendingAction("variant");

    try {
      const variantVersionId = await createEstimateVariant(versionId);

      router.push(`/dashboard/estimates/${variantVersionId}/edit`);
      router.refresh();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Une erreur est survenue."
      );
    } finally {
      setPendingAction(null);
    }
  }, [pendingAction, router, versionId]);

  const buttonClassName = cn("w-full justify-start", className);
  const isBusy = pendingAction !== null;

  return (
    <div className="flex flex-col items-stretch gap-1">
      <Button
        className={buttonClassName}
        variant="ghost"
        size="md"
        type="button"
        onClick={() => void handleDuplicate()}
        loading={pendingAction === "duplicate"}
        disabled={isBusy}
        leftIcon={<CopyIcon aria-hidden="true" />}
      >
        Dupliquer
      </Button>
      <Button
        className={buttonClassName}
        variant="ghost"
        size="md"
        type="button"
        onClick={() => void handleCreateVariant()}
        loading={pendingAction === "variant"}
        disabled={isBusy}
        leftIcon={<GitBranchIcon aria-hidden="true" />}
      >
        Créer une variante
      </Button>

      {actionError ? (
        <Alert variant="danger" className="px-3 py-2 text-xs">
          {actionError}
        </Alert>
      ) : null}
    </div>
  );
}
