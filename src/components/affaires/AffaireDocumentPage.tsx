"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { useToast } from "@/components/feedback/toast-provider";
import { AffaireDocumentDesk } from "./AffaireDocumentDesk";
import { useIntakeUploadFeedback, IntakeUploadFeedback } from "./IntakeUploadFeedback";
import { useAffaireDossier } from "./useAffaireDossier";
import type { IntakeDpgfCandidate } from "./unified-import-flow/types";

const UnifiedImportFlow = dynamic(
  () =>
    import("./UnifiedImportFlow").then((module) => module.UnifiedImportFlow),
  { ssr: false },
);

export function AffaireDocumentPage({
  projectId,
  projectName,
  workspace: serverWorkspace,
  canManage,
  takeoffEnabled,
}: {
  projectId: string;
  projectName: string;
  workspace: AffaireIntakeWorkspace;
  canManage: boolean;
  takeoffEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  // The workspace is the whole of what this page renders on the server: the reads keep it current
  // while documents are added or analysed, without refreshing the router.
  const dossier = useAffaireDossier(projectId, { workspace: serverWorkspace });
  const workspace = dossier.workspace ?? serverWorkspace;
  const uploadFeedback = useIntakeUploadFeedback(projectId, workspace.documents, dossier.reload);
  const [candidates, setCandidates] = useState<IntakeDpgfCandidate[] | null>(
    null,
  );
  function overview(anchor?: string) {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "overview");
    router.push(
      `/dashboard/affaires/${projectId}?${params}${anchor ? `#${anchor}` : ""}`,
    );
  }
  useEffect(() => {
    if (
      !new URLSearchParams(window.location.search).has("view") &&
      window.location.hash &&
      window.location.hash !== "#intake"
    ) {
      const params = new URLSearchParams(window.location.search);
      params.set("view", "overview");
      router.replace(
        `${window.location.pathname}?${params}${window.location.hash}`,
      );
    }
  }, [router]);
  if (candidates)
    return (
      <><IntakeUploadFeedback feedback={uploadFeedback} /><UnifiedImportFlow
        projectId={projectId}
        intakeDpgfCandidates={candidates}
        takeoffEnabled={takeoffEnabled}
        onCancel={() => setCandidates(null)}
        onComplete={(result) => {
          toast.success({
            title: "Import terminé",
            description: `${result.stats.insertedRows} ligne(s) insérée(s).`,
          });
          overview("dpgf");
          router.refresh();
        }}
      /></>
    );
  return (
    <AffaireDocumentDesk
      projectId={projectId}
      projectName={projectName}
      workspace={workspace}
      canManage={canManage}
      uploadFeedback={uploadFeedback}
      onReload={dossier.reload}
      onOverview={overview}
      onImportDpgf={(documentId) => {
        if (!canManage) return;
        const document = workspace.documents.find(
          (item) =>
            item.documentId === documentId &&
            item.uploadStatus === "uploaded" &&
            !item.isBeingDeleted &&
            item.detectedCategory === "dpgf" &&
            item.classificationStatus === "classified",
        );
        if (document)
          setCandidates([
            {
              documentId,
              fileName: document.fileName,
              label: document.fileName,
            },
          ]);
      }}
    />
  );
}
