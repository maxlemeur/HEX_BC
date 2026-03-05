"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { TakeoffUploadForm } from "@/components/takeoff/TakeoffUploadForm";

type LaunchMetreDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  draftVersionId: string | null;
  hasAnyVersion: boolean;
};

export function LaunchMetreDialog({
  open,
  onOpenChange,
  projectId,
  draftVersionId,
  hasAnyVersion,
}: LaunchMetreDialogProps) {
  const router = useRouter();
  const toast = useToast();
  const isUploadingRef = useRef(false);
  const [isUploading, setIsUploading] = useState(false);

  const handleSuccess = useCallback(
    () => {
      isUploadingRef.current = false;
      setIsUploading(false);
      onOpenChange(false);
      toast.success({
        title: "Extraction lancee",
        description: "Redirection vers les extractions...",
      });
      router.push(`/dashboard/affaires/${projectId}/takeoff`);
    },
    [onOpenChange, toast, router, projectId],
  );

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        closeOnOverlayClick={!isUploading}
        closeOnEscapeKey={!isUploading}
      >
        <Modal.Header>
          <Modal.Title>Lancer un metre</Modal.Title>
          <Modal.Close />
        </Modal.Header>
        <Modal.Body>
          {draftVersionId ? (
            <TakeoffUploadForm
              versionId={draftVersionId}
              compact
              onSuccess={handleSuccess}
            />
          ) : hasAnyVersion ? (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--slate-600)]">
                La version courante n&apos;est pas un brouillon.
              </p>
              <Link
                href={`/dashboard/estimates/new?projectId=${projectId}`}
                className="btn btn-secondary btn-sm mt-4 inline-flex"
              >
                Creer une nouvelle version
              </Link>
            </div>
          ) : (
            <div className="py-6 text-center">
              <p className="text-sm text-[var(--slate-600)]">
                Aucune version trouvee.
              </p>
              <Link
                href={`/dashboard/estimates/new?projectId=${projectId}`}
                className="btn btn-secondary btn-sm mt-4 inline-flex"
              >
                Creer une premiere version
              </Link>
            </div>
          )}
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
