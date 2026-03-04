"use client";

import { useEffect, useState, useTransition } from "react";

import { quickCreateAffaire } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useUiMode } from "@/hooks/useUiMode";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ImportOption = {
  id: string;
  fileName: string;
  rowsCount: number | null;
};

type QuickCreateAffaireDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickCreateAffaireDialog({
  open,
  onOpenChange,
}: Readonly<QuickCreateAffaireDialogProps>) {
  const { isExpert } = useUiMode();
  const [isPending, startTransition] = useTransition();

  // Form state
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [reference, setReference] = useState("");

  // Expert mode — import
  const [imports, setImports] = useState<ImportOption[]>([]);
  const [isLoadingImports, setIsLoadingImports] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [versionTitle, setVersionTitle] = useState("");
  const [sectionTitle, setSectionTitle] = useState("");

  // Errors
  const [clientError, setClientError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  // Load available imports in expert mode
  useEffect(() => {
    if (!isExpert || !open) return;

    let mounted = true;

    async function load() {
      setIsLoadingImports(true);
      try {
        const res = await fetch("/api/imports", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();

        const rawItems = Array.isArray(json?.data)
          ? (json.data as unknown[])
          : Array.isArray(json)
            ? (json as unknown[])
            : [];

        const items: ImportOption[] = rawItems
          .filter((item): item is Record<string, unknown> => {
            if (!item || typeof item !== "object") return false;
            const entry = item as Record<string, unknown>;

            const status = typeof entry.status === "string" ? entry.status : null;
            const projectId =
              typeof entry.project_id === "string"
                ? entry.project_id
                : typeof entry.projectId === "string"
                  ? entry.projectId
                  : null;

            // Quick create accepts only unlinked imports with completed parsing.
            return status === "completed" && !projectId;
          })
          .map((item) => {
            const rowCount =
              typeof item.row_count === "number"
                ? item.row_count
                : typeof item.rows_count === "number"
                  ? item.rows_count
                  : typeof item.rowsCount === "number"
                    ? item.rowsCount
                    : null;

            return {
              id: item.id as string,
              fileName:
                (item.filename as string) ??
                (item.file_name as string) ??
                (item.fileName as string) ??
                "Import",
              rowsCount: rowCount,
            };
          });
        if (mounted) setImports(items);
      } catch {
        // Non-blocking — user can still create without import
      } finally {
        if (mounted) setIsLoadingImports(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, [isExpert, open]);

  useEffect(() => {
    if (!selectedImportId) return;
    const stillAvailable = imports.some((item) => item.id === selectedImportId);
    if (!stillAvailable) {
      setSelectedImportId(null);
    }
  }, [imports, selectedImportId]);

  // Reset form when dialog closes
  function handleOpenChange(next: boolean) {
    if (!next) {
      setProjectName("");
      setClientName("");
      setReference("");
      setSelectedImportId(null);
      setVersionTitle("");
      setSectionTitle("");
      setClientError(null);
      setServerError(null);
    }
    onOpenChange(next);
  }

  // Submit
  function handleSubmit() {
    const trimmedName = projectName.trim();
    if (!trimmedName) {
      setClientError("Le nom du projet est obligatoire.");
      return;
    }
    setClientError(null);
    setServerError(null);

    startTransition(async () => {
      try {
        await quickCreateAffaire({
          projectName: trimmedName,
          clientName: clientName.trim() || null,
          reference: reference.trim() || null,
          importId: selectedImportId,
          versionTitle: versionTitle.trim() || null,
          sectionTitle: sectionTitle.trim() || null,
        });
        // redirect() in server action is handled by Next.js automatically
      } catch (err) {
        // Next.js redirect throws NEXT_REDIRECT — let it propagate
        if (
          err instanceof Error &&
          (err.message.includes("NEXT_REDIRECT") || err.message.includes("redirect"))
        ) {
          throw err;
        }
        setServerError(
          err instanceof Error ? err.message : "Impossible de creer l'affaire."
        );
      }
    });
  }

  const canSubmit = projectName.trim().length > 0 && !isPending;

  return (
    <Modal.Root open={open} onOpenChange={handleOpenChange}>
      <Modal.Content className="max-w-lg">
        <Modal.Header>
          <Modal.Title>Nouvelle affaire</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <Input
            label="Nom du projet *"
            placeholder="Ex: Residence Les Jardins"
            value={projectName}
            onChange={(e) => {
              setProjectName(e.target.value);
              if (clientError) setClientError(null);
            }}
            error={clientError ?? undefined}
            aria-required="true"
            autoFocus
          />

          <Input
            label="Client"
            placeholder="Nom du client (optionnel)"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
          />

          <Input
            label="Reference"
            placeholder="Ref. projet (optionnel)"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />

          {/* Expert mode — import section */}
          {isExpert && (
            <details className="rounded-lg border border-slate-200 p-3">
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                Import DPGF (optionnel)
              </summary>

              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <label
                    htmlFor="qc-import-select"
                    className="block text-xs font-semibold text-slate-700"
                  >
                    Import disponible
                  </label>
                  {isLoadingImports ? (
                    <p className="text-xs text-slate-500">Chargement...</p>
                  ) : imports.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Aucun import termine disponible.
                    </p>
                  ) : (
                    <select
                      id="qc-import-select"
                      className="form-input form-select text-sm"
                      value={selectedImportId ?? ""}
                      onChange={(e) =>
                        setSelectedImportId(e.target.value || null)
                      }
                    >
                      <option value="">Sans import</option>
                      {imports.map((imp) => (
                        <option key={imp.id} value={imp.id}>
                          {imp.fileName}
                          {imp.rowsCount !== null
                            ? ` (${imp.rowsCount} lignes)`
                            : ""}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {selectedImportId && (
                  <>
                    <Input
                      label="Titre de la version"
                      placeholder="V1 (optionnel)"
                      value={versionTitle}
                      onChange={(e) => setVersionTitle(e.target.value)}
                    />
                    <Input
                      label="Titre de la section"
                      placeholder="Section principale (optionnel)"
                      value={sectionTitle}
                      onChange={(e) => setSectionTitle(e.target.value)}
                    />
                  </>
                )}
              </div>
            </details>
          )}

          {/* Server error */}
          {serverError && (
            <div role="alert" className="alert alert-error text-sm">
              {serverError}
            </div>
          )}
        </Modal.Body>

        <Modal.Footer>
          <Modal.Close>Annuler</Modal.Close>
          <Button
            variant="primary"
            size="sm"
            loading={isPending}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Creer l&apos;affaire
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}
