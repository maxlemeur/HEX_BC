"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { CoverageDimensionMutation } from "@/lib/estimates/source-coverage-contracts";

export function CoverageDimensionDialog({ disabled, onSave }: { disabled: boolean; onSave: (request: CoverageDimensionMutation) => void }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"zone" | "network">("zone");
  const [label, setLabel] = useState("");
  const [extent, setExtent] = useState("");
  return <>
    <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Ajouter une zone ou un réseau</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent size="md">
      <DialogHeader><DialogTitle>Déclarer un périmètre d’affaire</DialogTitle><DialogDescription>La zone ou le réseau possède sa propre identité. Un titre de section DPGF ne définit pas son étendue.</DialogDescription></DialogHeader>
      <label className="space-y-1 text-sm"><span>Type de périmètre</span><NativeSelect value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="zone">Zone</option><option value="network">Réseau</option></NativeSelect></label>
      <label className="space-y-1 text-sm"><span>Libellé du périmètre</span><Input value={label} maxLength={200} onChange={(event) => setLabel(event.target.value)} /></label>
      <label className="space-y-1 text-sm"><span>Étendue du périmètre</span><Textarea value={extent} maxLength={2000} onChange={(event) => setExtent(event.target.value)} /></label>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Annuler</Button><Button type="button" disabled={disabled || !label.trim()} onClick={() => {
        onSave({ operation: "create", dimensionId: crypto.randomUUID(), expectedRevision: 0, operationKey: crypto.randomUUID(), payload: { kind, label: label.trim(), extentNote: extent.trim() || null } });
        setOpen(false); setLabel(""); setExtent("");
      }}>Enregistrer le périmètre</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
