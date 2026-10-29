"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { useToast } from "@/components/ui-legacy/Toast";
import { AffaireDocumentDesk } from "./AffaireDocumentDesk";
import type { IntakeDpgfCandidate } from "./unified-import-flow/types";

const UnifiedImportFlow = dynamic(
  () =>
    import("./UnifiedImportFlow").then((module) => module.UnifiedImportFlow),
  { ssr: false },
);

export function AffaireDocumentPage({
  projectId,
  projectName,
  workspace,
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
      <UnifiedImportFlow
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
      />
    );
  return (
    <AffaireDocumentDesk
      projectId={projectId}
      projectName={projectName}
      workspace={workspace}
      canManage={canManage}
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
