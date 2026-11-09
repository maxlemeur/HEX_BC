"use client";

import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AffaireDocumentDesk } from "./AffaireDocumentDesk";
import "./AffaireDocumentsDrawer.css";

export function AffaireDocumentsDrawer({ open, onOpenChange, projectId, projectName, workspace, canManage, onImportDpgf, onOverview, documentScope, returnFocus, initialAddFiles = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  workspace: AffaireIntakeWorkspace;
  canManage: boolean;
  onImportDpgf: (documentId: string) => void;
  onOverview: (anchor?: string) => void;
  documentScope: string;
  returnFocus: RefObject<HTMLElement | null>;
  initialAddFiles?: boolean;
}) {
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" keepMounted finalFocus={returnFocus} className="affaire-documents-drawer">
      <SheetHeader>
        <SheetTitle>Documents du dossier</SheetTitle>
        <SheetDescription>{projectName}</SheetDescription>
      </SheetHeader>
      <AffaireDocumentDesk key={documentScope} projectId={projectId} projectName={projectName} workspace={workspace} canManage={canManage} onImportDpgf={onImportDpgf} onOverview={onOverview} initialAddFiles={initialAddFiles} />
    </SheetContent>
  </Sheet>;
}
